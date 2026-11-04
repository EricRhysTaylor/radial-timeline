import { Component, DropdownComponent, Notice, TFile, normalizePath, parseYaml, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { getActiveBook, getBookIdForPath } from '../utils/books';
import { internalDraggedFiles } from '../utils/obsidianInternals';
import { classifyForPromotion, filenamePrefix } from '../services/PromoteToSceneService';
import { setAccessibleLabel } from '../utils/domTooltip';
import { buildTableRow } from './timetableModel';
import { readSceneId } from '../utils/sceneIds';

/** Insert only the missing Class line, preserving all existing bytes. */
export function addNoteClass(content: string, kind: 'Scene' | 'Sketch', anchor?: string): string {
    const placement = anchor ? `Place after scene: ${JSON.stringify(anchor)}\n` : '';
    const start = content.match(/^---\s*\r?\n/);
    if (!start) return `---\nClass: ${kind}\n${placement}---\n\n${content}`;
    const tail = content.slice(start[0].length);
    const end = /^---\s*$/m.exec(tail);
    if (!end) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const raw = tail.slice(0, end.index);
    const parsed: unknown = parseYaml(raw);
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    if (parsed && Object.keys(parsed).some(key => key.toLowerCase() === 'class')) throw new Error(t('ui.timetable.noteDropHasClass'));
    if (anchor && parsed && Object.keys(parsed).some(key => key.toLowerCase() === 'place after scene')) throw new Error(t('ui.timetable.noteDropExistingPlacement'));
    const newline = start[0].endsWith('\r\n') ? '\r\n' : '\n';
    return `${start[0]}Class: ${kind}${newline}${placement.replace(/\n/g, newline)}${tail}`;
}

class NoteDropModal extends ErtModal {
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly file: TFile, private readonly initialBook?: string) { super(plugin.app); }
    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.mountHeader({ title: t('ui.timetable.noteDropTitle'), subtitle: this.file.path });
        const books = this.plugin.settings.books.filter(book => book.sourceFolder.trim() && this.app.vault.getFolderByPath(book.sourceFolder));
        if (!books.length) { this.contentEl.createDiv({ text: t('ui.canvasSketch.noBook') }); return; }
        const bookRow = this.contentEl.createDiv({ cls: 'setting-item' });
        bookRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.book') });
        const book = new DropdownComponent(bookRow.createDiv({ cls: 'setting-item-control' }));
        books.forEach(item => book.addOption(item.id, item.title || item.sourceFolder));
        book.setValue(books.find(item => item.id === this.initialBook)?.id ?? getBookIdForPath(books, this.file.path) ?? getActiveBook(this.plugin.settings)?.id ?? books[0].id);
        const kindRow = this.contentEl.createDiv({ cls: 'setting-item' });
        kindRow.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.noteDropType') });
        const kind = new DropdownComponent(kindRow.createDiv({ cls: 'setting-item-control' }));
        kind.addOption('Scene', t('ui.timetable.noteDropScene')); kind.addOption('Sketch', t('ui.timetable.noteDropSketch'));
        const numberRow = this.contentEl.createDiv({ cls: 'setting-item' });
        numberRow.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.noteDropNumber') });
        const number = numberRow.createDiv({ cls: 'setting-item-control' }).createEl('input', { type: 'text', attr: { placeholder: '72' } });
        setAccessibleLabel(number, t('ui.timetable.noteDropNumber'));
        const anchorRow = this.contentEl.createDiv({ cls: 'setting-item' });
        anchorRow.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.noteDropAfter') });
        anchorRow.createDiv({ cls: 'setting-item-description', text: t('ui.timetable.noteDropAnchorHint') });
        const anchor = new DropdownComponent(anchorRow.createDiv({ cls: 'setting-item-control' }));
        const updateAnchors = () => {
            const act = buildTableRow(this.file.path, this.file.basename, this.app.metadataCache.getFileCache(this.file)?.frontmatter, this.plugin.settings).act;
            const items = this.app.vault.getMarkdownFiles().filter(file => getBookIdForPath(this.plugin.settings.books, file.path) === book.getValue()).map(file => {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                return { file, row: buildTableRow(file.path, file.basename, fm, this.plugin.settings), id: readSceneId(fm) };
            });
            const counts = new Map<string, number>();
            for (const item of items) if (item.row.kind === 'scene' && item.id) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
            anchor.selectEl.empty(); anchor.addOption('', t('ui.timetable.noteDropEndAct'));
            items.filter(item => item.row.kind === 'scene' && item.row.act === act && item.id && counts.get(item.id) === 1)
                .sort((a, b) => a.file.basename.localeCompare(b.file.basename, undefined, { numeric: true }))
                .forEach(item => anchor.addOption(item.id!, item.file.basename));
        };
        const explanation = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint', text: t('ui.timetable.noteDropExplanation') });
        const update = () => { numberRow.hidden = kind.getValue() !== 'Scene' || !!filenamePrefix(this.file.basename); anchorRow.hidden = kind.getValue() !== 'Sketch'; };
        kind.onChange(update); book.onChange(updateAnchors); updateAnchors(); update();
        const actions = this.mountActions();
        actions.createEl('button', { text: t('common.cancel') }).onclick = () => this.close();
        const submit = actions.createEl('button', { text: t('ui.timetable.noteDropConfirm'), cls: 'ert-note-drop-confirm mod-cta' });
        submit.onclick = () => {
            submit.disabled = true;
            void (async () => {
                const chosen = books.find(item => item.id === book.getValue());
                if (!chosen) throw new Error(t('ui.canvasSketch.noBook'));
                const type = kind.getValue() === 'Sketch' ? 'Sketch' : 'Scene';
                const after = type === 'Sketch' ? anchor.getValue() || undefined : undefined;
                if (after) {
                    const act = buildTableRow(this.file.path, this.file.basename, this.app.metadataCache.getFileCache(this.file)?.frontmatter, this.plugin.settings).act;
                    const matches = this.app.vault.getMarkdownFiles().filter(file => {
                        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                        const row = buildTableRow(file.path, file.basename, fm, this.plugin.settings);
                        return getBookIdForPath(this.plugin.settings.books, file.path) === chosen.id && row.kind === 'scene' && row.act === act && readSceneId(fm) === after;
                    });
                    if (matches.length !== 1) throw new Error(t('ui.timetable.sketchPromotionAnchorProblem'));
                }
                const input = number.value.trim();
                if (type === 'Scene' && !filenamePrefix(this.file.basename) && !/^\d+(?:\.\d+)?$/.test(input)) throw new Error(t('ui.timetable.noteDropNumberRequired'));
                const oldPath = this.file.path;
                const belongs = getBookIdForPath(this.plugin.settings.books, oldPath) === chosen.id;
                const name = type === 'Scene' && !filenamePrefix(this.file.basename) ? `${input} ${this.file.name}` : this.file.name;
                const folder = belongs ? this.file.parent?.path ?? chosen.sourceFolder : chosen.sourceFolder;
                const destination = normalizePath(`${folder}/${name}`);
                if (destination !== oldPath && this.app.vault.getAbstractFileByPath(destination)) throw new Error(t('ui.timetable.noteDropExists'));
                const prefix = filenamePrefix(this.file.basename) ?? input;
                if (type === 'Scene' && this.app.vault.getMarkdownFiles().some(f => f !== this.file && getBookIdForPath(this.plugin.settings.books, f.path) === chosen.id && filenamePrefix(f.basename) === prefix && classifyForPromotion(this.app.metadataCache.getFileCache(f)?.frontmatter).kind === 'alreadyScene')) throw new Error(t('ui.timetable.noteDropNumberExists'));
                // Validate before a move and again inside vault.process for concurrent edits.
                addNoteClass(await this.app.vault.read(this.file), type, after);
                if (destination !== oldPath) await this.app.fileManager.renameFile(this.file, destination);
                try { await this.app.vault.process(this.file, content => addNoteClass(content, type, after)); }
                catch (error) { if (destination !== oldPath) await this.app.fileManager.renameFile(this.file, oldPath); throw error; }
                this.close(); this.plugin.refreshTimelineIfNeeded(null); new Notice(t('ui.timetable.noteDropDone'));
            })().catch((error: unknown) => { submit.disabled = false; explanation.setText(error instanceof Error ? error.message : String(error)); });
        };
    }
}

/** Handle file-explorer drags without intercepting selected text or existing scene drags. */
export function registerNoteDropCapture(owner: Component, host: HTMLElement, plugin: RadialTimelinePlugin, bookId: () => string | undefined): void {
    let explorerFile: TFile | null = null;
    const target = host.createDiv({ cls: 'ert-text-sketch-drop', attr: { role: 'status' } });
    if (target) { setIcon(target.createSpan(), 'file-plus-2'); target.createSpan({ text: t('ui.timetable.noteDropHint') }); }
    const dragged = (): TFile | null => {
        const candidates = explorerFile ? [explorerFile] : internalDraggedFiles(plugin.app);
        const files = [...new Map(candidates.filter((file): file is TFile => file instanceof TFile && file.extension.toLowerCase() === 'md').map(file => [file.path, file])).values()];
        if (files.length !== 1) return null;
        const classification = classifyForPromotion(plugin.app.metadataCache.getFileCache(files[0])?.frontmatter);
        return classification.kind === 'eligible' && !classification.fromSketch ? files[0] : null;
    };
    const clear = () => target?.removeClass('is-visible');
    // Obsidian can place a workspace drop overlay above the view, so the DOM
    // event target is not necessarily inside the view under the pointer.
    const isOverView = (event: DragEvent): boolean => {
        if (!host.isConnected) return false;
        const area = host.closest<HTMLElement>('.bases-view') ?? host;
        const rect = area.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };
    owner.registerDomEvent(host.ownerDocument, 'dragstart', (event: DragEvent) => {
        explorerFile = null;
        const element = event.target instanceof Element ? event.target : null;
        const source = element?.closest<HTMLElement>('.nav-file-title[data-path], .nav-file[data-path]');
        const path = source?.dataset.path;
        const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
        if (file instanceof TFile) explorerFile = file;
    }, true);
    owner.registerDomEvent(host.ownerDocument, 'dragover', (event: DragEvent) => {
        if (!isOverView(event) || !dragged()) { clear(); return; }
        if (target && !target.isConnected) host.appendChild(target);
        target?.addClass('is-visible');
        event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }, true);
    owner.registerDomEvent(host.ownerDocument, 'drop', (event: DragEvent) => {
        if (!isOverView(event)) { clear(); return; }
        const file = dragged(); clear();
        if (!file) return;
        event.preventDefault(); event.stopImmediatePropagation();
        window.setTimeout(() => new NoteDropModal(plugin, file, bookId()).open(), 0);
    }, true);
    owner.registerDomEvent(host.ownerDocument, 'dragend', () => { clear(); explorerFile = null; }, true);
    owner.register(() => target?.remove());
}
