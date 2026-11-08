import type { App } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { directoryEntryNamed, type DirectoryEntry, type PaletteChoice } from './canvasSubplotDirectory';

/** A new subplot's name and the palette color its cards wear. */
export interface NewSubplotChoice { name: string; color: string }

export interface NewSubplotOptions {
    bookTitle: string;
    /** The subplots a new name may not repeat. */
    directory: readonly DirectoryEntry[];
    /** The palette, free colors first (canvasSubplotDirectory.paletteChoices). */
    palette: readonly PaletteChoice[];
    /** A name to start with, such as one typed in Bring ideas into your book. */
    name?: string;
    /** The confirm button's label. */
    confirm: string;
    onChoose: (choice: NewSubplotChoice) => void;
}

/** Name a new subplot and give it a palette color no subplot wears yet. */
export class CanvasNewSubplotModal extends ErtModal {
    private name: string;
    private color: string | null;

    constructor(app: App, private readonly options: NewSubplotOptions) {
        super(app);
        this.name = options.name?.trim() ?? ''; // SAFE: no name to start with leaves the field blank
        this.color = options.palette.find(choice => !choice.usedBy.length)?.hex ?? null; // SAFE: null when every palette color is in use, which blocks Choose
    }

    /** Why the name cannot be used, or null when it can. */
    private nameProblem(): string | null {
        const taken = this.name ? directoryEntryNamed(this.options.directory, this.name) : null;
        return taken ? t('ui.canvasSketch.nameTaken', { subplot: taken.name }) : null;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.applyShell({ size: 'md' });
        this.mountHeader({
            badge: { text: t('ui.canvasSketch.badge') },
            title: t('ui.canvasSketch.newSubplotTitle'),
            subtitle: t('ui.canvasSketch.newSubplotSubtitle', { book: this.options.bookTitle }),
        });
        const nameRow = contentEl.createDiv({ cls: 'setting-item' });
        nameRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.subplotName') });
        const input = nameRow.createDiv({ cls: 'setting-item-control' }).createEl('input', { type: 'text', attr: { placeholder: t('ui.canvasSketch.subplotName') } });
        setAccessibleLabel(input, t('ui.canvasSketch.subplotName'));
        input.value = this.name;
        const problem = contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint' });

        const free = this.options.palette.filter(choice => !choice.usedBy.length);
        const used = this.options.palette.filter(choice => choice.usedBy.length);
        const swatches: Array<{ el: HTMLButtonElement; hex: string }> = [];
        if (free.length) {
            contentEl.createDiv({ cls: 'ert-section-title', text: t('ui.canvasSketch.paletteFree') });
            const grid = contentEl.createDiv({ cls: 'ert-canvas-subplot-palette' });
            for (const choice of free) {
                const el = grid.createEl('button', { cls: 'ert-canvas-subplot-palette__swatch', attr: { type: 'button' } });
                el.setCssProps({ '--ert-canvas-sketch-swatch': choice.hex });
                setAccessibleLabel(el, t('ui.colorsSection.ringLabel', { number: choice.slot + 1 }));
                el.addEventListener('click', () => { this.color = choice.hex; update(); });
                swatches.push({ el, hex: choice.hex });
            }
        } else {
            contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.canvasSketch.paletteFull') });
        }
        if (used.length) {
            contentEl.createDiv({ cls: 'ert-section-title', text: t('ui.canvasSketch.paletteUsed') });
            const list = contentEl.createDiv({ cls: 'ert-canvas-subplot-used' });
            for (const choice of used) {
                const item = list.createDiv({ cls: 'ert-canvas-sketch-ring-option ert-canvas-subplot-used__item' });
                item.createSpan({ cls: 'ert-canvas-sketch-swatch' }).setCssProps({ '--ert-canvas-sketch-swatch': choice.hex });
                item.createSpan({ text: choice.usedBy.join(', ') });
                setTooltip(item, t('ui.canvasSketch.paletteUsedBy', { subplots: choice.usedBy.join(', ') }));
            }
        }

        const actions = this.mountActions();
        actions.createEl('button', { text: t('ui.canvasSketch.cancel') }).addEventListener('click', () => this.close());
        const confirm = actions.createEl('button', { cls: 'ert-canvas-subplot-confirm mod-cta', text: this.options.confirm });
        const update = (): void => {
            const issue = this.nameProblem();
            problem.setText(issue ?? ''); // SAFE: no problem shows no message
            problem.toggle(!!issue);
            for (const swatch of swatches) swatch.el.toggleClass('is-active', swatch.hex === this.color);
            confirm.disabled = !this.name || !!issue || !this.color;
        };
        const choose = (): void => {
            if (confirm.disabled || !this.color) return;
            const color = this.color;
            this.close();
            this.options.onChoose({ name: this.name, color });
        };
        input.addEventListener('input', () => { this.name = input.value.trim(); update(); });
        input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            choose();
        });
        confirm.addEventListener('click', choose);
        update();
        window.setTimeout(() => input.focus(), 0);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
