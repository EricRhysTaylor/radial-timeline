import { App, DropdownComponent, Notice, stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { ErtModal } from '../ui/ErtModal';
import { authorKeyFor } from './timetableFiles';
import { getConfiguredActCount } from '../utils/acts';
import { canvasTextCards, linkSketches, sketchTitle, type StoryCanvasData } from './canvasSketches';
import { hasPortalReferences } from './canvasPortals';
import { t } from '../i18n';

/** Minimal, runtime-checked surface of Obsidian's Canvas view. */
export interface OpenCanvas {
    getData(): StoryCanvasData;
    setData(data: StoryCanvasData): void;
    requestSave(pushHistory?: boolean): void;
}

export class CanvasSketchModal extends ErtModal {
    private readonly cards;
    private readonly selected = new Set<string>();
    private book: BookProfile;
    private busy = false;
    private act: number | null = null;

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, private readonly canvas: OpenCanvas, private readonly books: BookProfile[], activeBook: BookProfile, private readonly canvasIsOpen: () => boolean) {
        super(app);
        this.book = activeBook;
        this.cards = canvasTextCards(JSON.parse(JSON.stringify(canvas.getData())) as StoryCanvasData);
    }

    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.mountHeader({ badge: { text: t('ui.canvasSketch.badge') }, title: t('ui.canvasSketch.title'), subtitle: t('ui.canvasSketch.subtitle') });
        const destination = this.contentEl.createDiv({ cls: 'setting-item' });
        destination.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.book') });
        const dropdown = new DropdownComponent(destination.createDiv({ cls: 'setting-item-control' }));
        for (const book of this.books) dropdown.addOption(book.id, book.title);
        dropdown.setValue(this.book.id).onChange(id => { this.book = this.books.find(book => book.id === id) ?? this.book; });
        const actRow = this.contentEl.createDiv({ cls: 'setting-item' });
        actRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.act') });
        const actSelect = new DropdownComponent(actRow.createDiv({ cls: 'setting-item-control' }));
        actSelect.addOption('', t('ui.canvasSketch.noAct'));
        for (let act = 1; act <= getConfiguredActCount(this.plugin.settings); act++) actSelect.addOption(String(act), t('ui.canvasSketch.actNumber', { act }));
        actSelect.setValue('').onChange(value => { this.act = value ? Number(value) : null; });
        const list = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-list' });
        if (!this.cards.length) list.createDiv({ text: t('ui.canvasSketch.empty') });
        const actions = this.mountActions();
        const cancel = actions.createEl('button', { text: t('ui.canvasSketch.cancel') });
        cancel.addEventListener('click', () => this.close());
        const submit = actions.createEl('button', { text: t('ui.canvasSketch.create'), cls: 'ert-canvas-sketch-submit mod-cta' });
        submit.disabled = true;
        for (const card of this.cards) {
            const label = list.createEl('label', { cls: 'ert-canvas-sketch-card' });
            const check = label.createEl('input', { type: 'checkbox' });
            const details = label.createDiv();
            details.createDiv({ cls: 'ert-canvas-sketch-title', text: sketchTitle(card.text ?? '') });
            const preview = (card.text ?? '').split(/\r?\n/).slice(1).join(' ').trim();
            if (preview) details.createDiv({ cls: 'ert-canvas-sketch-preview', text: preview.slice(0, 160) });
            check.addEventListener('change', () => {
                if (check.checked) this.selected.add(card.id); else this.selected.delete(card.id);
                submit.disabled = this.selected.size === 0;
            });
        }
        submit.addEventListener('click', () => {
            if (this.busy || !this.selected.size) return;
            this.busy = true;
            submit.disabled = true;
            cancel.disabled = true;
            void this.convert().finally(() => { this.busy = false; this.close(); });
        });
    }

    private async convert(): Promise<void> {
        if (!this.canvasIsOpen()) { new Notice(t('ui.canvasSketch.changed'), 8000); return; }
        const initial = JSON.parse(JSON.stringify(this.canvas.getData())) as StoryCanvasData;
        const cards = canvasTextCards(initial).filter(card => this.selected.has(card.id));
        if (cards.length !== this.selected.size || cards.some(card => this.cards.find(original => original.id === card.id)?.text !== card.text)) {
            new Notice(t('ui.canvasSketch.changed'), 8000);
            return;
        }
        const folder = this.book.sourceFolder.trim().replace(/\/$/, '');
        if (!folder || !this.app.vault.getFolderByPath(folder)) {
            new Notice(t('ui.canvasSketch.missingFolder'), 8000);
            return;
        }
        const paths = new Map<string, string>();
        try {
            // Replacing a card changes its ID. Cross-canvas portal edges can
            // refer to that ID in another file, so refuse rather than break them.
            if (await hasPortalReferences(this.app, initial, this.selected)) {
                new Notice(t('ui.canvasSketch.portalBlocked'), 10000);
                return;
            }
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            for (const card of cards) {
                const title = sketchTitle(card.text ?? '');
                let path = `${folder}/${title}.md`;
                for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${title} ${n}.md`;
                const frontmatter: Record<string, unknown> = { [authorKeyFor('Class', this.plugin.settings)]: 'Sketch' };
                if (this.act !== null) frontmatter[authorKeyFor('Act', this.plugin.settings)] = this.act;
                await this.app.vault.create(path, `---\n${stringifyYaml(frontmatter)}---\n\n${card.text ?? ''}`);
                paths.set(card.id, path);
            }
            // Never replace cards if the author (or another plugin) changed the map while files were being created.
            if (!this.canvasIsOpen() || JSON.stringify(initial) !== JSON.stringify(this.canvas.getData())) throw new Error(t('ui.canvasSketch.changed'));
            // Canvas retains the node class for an existing ID. New IDs let
            // the live view replace text cards, and make Canvas undo work.
            const replacements = new Map([...paths].map(([id, path]) => [id, { id: crypto.randomUUID().replace(/-/g, ''), path }]));
            try {
                this.canvas.setData(linkSketches(initial, replacements));
                const actual = this.canvas.getData();
                if ([...replacements.values()].some(({ id, path }) => !actual.nodes?.some(node => node.id === id && node.type === 'file' && node.file === path))) {
                    throw new Error(t('ui.canvasSketch.changed'));
                }
                this.canvas.requestSave(false);
            } catch (error) {
                this.canvas.setData(initial);
                this.canvas.requestSave(false);
                throw error;
            }
            new Notice(t('ui.canvasSketch.done', { count: paths.size }), 6000);
            this.plugin.refreshTimelineIfNeeded(null);
        } catch (error) {
            console.error('[Canvas sketches]', error);
            new Notice(t('ui.canvasSketch.failed', { count: paths.size, message: error instanceof Error ? error.message : String(error) }), 12000);
        }
    }
}
