import { App, DropdownComponent, Notice, TFile, stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types';
import { ErtModal } from '../ui/ErtModal';
import { getConfiguredActCount } from '../utils/acts';
import { getBookIdForPath } from '../utils/books';
import { safeTitle } from '../utils/noteTitle';
import { setAccessibleLabel } from '../utils/domTooltip';
import { authorKeyFor } from './timetableFiles';
import { buildTableRow } from './timetableModel';
import { SKETCH_ORDER } from './sketchPlacement';
import { planCanvasSketchAppend } from './canvasSketchOrdering';
import { parseOutlineHeadings, type OutlineImportEntry } from './outlineImport';

/** Preview a Markdown outline and create independent, source-linked sketches. */
export class OutlineImportModal extends ErtModal {
    private sketchLevel = 2;
    private actLevel: number | null = null;
    private entries: OutlineImportEntry[] = [];
    private selected = new Set<string>();
    private busy = false;

    constructor(app: App, private readonly plugin: RadialTimelinePlugin, private readonly book: BookProfile, private readonly source: TFile, private readonly snapshot: string) {
        super(app);
        const count = getConfiguredActCount(plugin.settings);
        const levels = [1, 2, 3, 4, 5, 6].map(level => ({ level, entries: parseOutlineHeadings(snapshot, level, null, count) }));
        this.sketchLevel = levels.reduce((best, level) => level.entries.length > best.entries.length ? level : best).level;
        if (this.sketchLevel > 1 && parseOutlineHeadings(snapshot, this.sketchLevel, this.sketchLevel - 1, count).some(entry => entry.act !== null)) this.actLevel = this.sketchLevel - 1;
    }

    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.mountHeader({ badge: { text: 'OUTLINE' }, title: 'Create sketches from outline', subtitle: `${this.source.basename} → ${this.book.title}. Review the proposed entries before creating them. The original document stays unchanged.` });
        const controls = this.contentEl.createDiv({ cls: 'ert-outline-import-controls' });
        const headingLabel = controls.createEl('label', { text: 'Sketch heading level' });
        const heading = new DropdownComponent(headingLabel);
        for (let level = 1; level <= 6; level++) heading.addOption(String(level), `Heading ${level}`);
        heading.setValue(String(this.sketchLevel));
        const actLabel = controls.createEl('label', { text: 'Act heading level' });
        const acts = new DropdownComponent(actLabel);
        acts.addOption('', 'No act headings');
        for (let level = 1; level <= 6; level++) acts.addOption(String(level), `Heading ${level} (Act 1, Act 2…)`);
        acts.setValue(this.actLevel ? String(this.actLevel) : '');
        this.contentEl.createDiv({ cls: 'ert-outline-import-hint', text: 'Only headings named Act 1, Act 2, and so on assign acts automatically. Text outside the chosen sections is left in the source document.' });
        const existing = this.app.vault.getMarkdownFiles().some(file => {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            return getBookIdForPath(this.plugin.settings.books, file.path) === this.book.id
                && typeof fm?.Source === 'string' && fm.Source === `[[${this.source.path.replace(/\.md$/i, '')}]]`;
        });
        if (existing) this.contentEl.createDiv({ cls: 'ert-outline-import-hint', text: 'This book already has sketches linked to this document. Review your selection to avoid creating duplicates.' });
        const selectionTools = this.contentEl.createDiv({ cls: 'ert-outline-import-selection' });
        const selectAll = selectionTools.createEl('button', { text: 'Select all' });
        const selectNone = selectionTools.createEl('button', { text: 'Clear selection' });
        const list = this.contentEl.createDiv({ cls: 'ert-outline-import-list' });
        const actions = this.mountActions();
        const cancel = actions.createEl('button', { text: 'Cancel' });
        const create = actions.createEl('button', { text: 'Create sketches', cls: 'ert-outline-import-submit mod-cta' });
        cancel.addEventListener('click', () => this.close());
        const render = () => {
            list.empty();
            if (!this.entries.length) list.createDiv({ cls: 'ert-outline-import-hint', text: 'No headings at this level. Choose another level or add Markdown headings to the document.' });
            for (const [index, entry] of this.entries.entries()) {
                const row = list.createDiv({ cls: 'ert-outline-import-row' });
                const check = row.createEl('input', { type: 'checkbox' });
                setAccessibleLabel(check, `Include ${entry.title}`);
                check.checked = this.selected.has(entry.id);
                const details = row.createDiv({ cls: 'ert-outline-import-details' });
                const title = details.createEl('input', { type: 'text', value: entry.title });
                setAccessibleLabel(title, `Title for entry ${index + 1}`);
                title.addEventListener('input', () => { entry.title = title.value; });
                if (entry.body) {
                    if (/^\s*>\s*\[!/m.test(entry.body)) details.createDiv({ cls: 'ert-outline-import-hint', text: 'Contains a callout. Review the full text before creating.' });
                    details.createDiv({ cls: 'ert-outline-import-preview', text: entry.body.slice(0, 220) });
                    const full = details.createEl('details', { cls: 'ert-outline-import-full' });
                    full.createEl('summary', { text: 'Review or edit full text' });
                    const editor = full.createEl('textarea', { cls: 'ert-outline-import-editor', attr: { rows: '6' } });
                    setAccessibleLabel(editor, `Text for ${entry.title}`);
                    editor.value = entry.body;
                    editor.addEventListener('input', () => { entry.body = editor.value; });
                }
                const act = new DropdownComponent(row);
                act.addOption('', 'Unassigned');
                for (let n = 1; n <= getConfiguredActCount(this.plugin.settings); n++) act.addOption(String(n), `Act ${n}`);
                act.setValue(entry.act === null ? '' : String(entry.act)).onChange(value => { entry.act = value ? Number(value) : null; });
                check.addEventListener('change', () => { if (check.checked) this.selected.add(entry.id); else this.selected.delete(entry.id); create.disabled = this.selected.size === 0; });
            }
            create.disabled = this.selected.size === 0;
        };
        const reparse = () => {
            this.entries = parseOutlineHeadings(this.snapshot, this.sketchLevel, this.actLevel, getConfiguredActCount(this.plugin.settings));
            this.selected = new Set(this.entries.map(entry => entry.id));
            render();
        };
        selectAll.addEventListener('click', () => { this.selected = new Set(this.entries.map(entry => entry.id)); render(); });
        selectNone.addEventListener('click', () => { this.selected.clear(); render(); });
        heading.onChange(value => { this.sketchLevel = Number(value); reparse(); });
        acts.onChange(value => { this.actLevel = value ? Number(value) : null; reparse(); });
        reparse();
        create.addEventListener('click', () => {
            if (this.busy || !this.selected.size) return;
            this.busy = true; create.disabled = true; cancel.disabled = true;
            void this.convert().then(success => { if (success) this.close(); }).finally(() => { this.busy = false; create.disabled = this.selected.size === 0; cancel.disabled = false; });
        });
    }

    private async convert(): Promise<boolean> {
        const chosen = this.entries.filter(entry => this.selected.has(entry.id));
        const folder = this.book.sourceFolder.trim().replace(/\/$/, '');
        if (!folder || !this.app.vault.getFolderByPath(folder)) { new Notice('The book folder is unavailable.', 8000); return false; }
        try {
            if (this.app.vault.getAbstractFileByPath(this.source.path) !== this.source || await this.app.vault.read(this.source) !== this.snapshot) {
                new Notice('The source document changed. Reopen the importer to review it again.', 8000); return false;
            }
        } catch (error) {
            new Notice(`Cannot read the source document: ${error instanceof Error ? error.message : String(error)}`, 8000); return false;
        }
        const items = this.app.vault.getMarkdownFiles().filter(file => getBookIdForPath(this.plugin.settings.books, file.path) === this.book.id).map(file => {
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            return { row: buildTableRow(file.path, file.basename, frontmatter, this.plugin.settings), frontmatter };
        });
        const ranks = new Map<number | null, number[]>();
        try {
            for (const act of new Set(chosen.map(entry => entry.act))) {
                const placement = planCanvasSketchAppend(items, act, null, chosen.filter(entry => entry.act === act).length);
                if (placement.missing.length) throw new Error('Some existing sketches have no placement order. Reorder them in the Timetable before adding these entries.');
                ranks.set(act, placement.ranks);
            }
        } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 10000); return false; }
        let created = 0;
        try {
            for (const entry of chosen) {
                const title = safeTitle(entry.title).slice(0, 100) || 'Untitled sketch';
                let path = `${folder}/${title}.md`;
                for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${title} ${n}.md`;
                const fm: Record<string, unknown> = { [authorKeyFor('Class', this.plugin.settings)]: 'Sketch', [SKETCH_ORDER]: ranks.get(entry.act)?.shift(), Source: `[[${this.source.path.replace(/\.md$/i, '')}]]` };
                if (entry.act !== null) fm[authorKeyFor('Act', this.plugin.settings)] = entry.act;
                await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n${entry.body}${entry.body ? '\n' : ''}`);
                created++;
            }
            new Notice(`Created ${created} ${created === 1 ? 'sketch' : 'sketches'} from ${this.source.basename}.`, 6000);
            return true;
        } catch (error) {
            new Notice(`Created ${created} sketches before stopping: ${error instanceof Error ? error.message : String(error)}. Review those notes before trying again.`, 12000);
            return created > 0;
        }
    }
}
