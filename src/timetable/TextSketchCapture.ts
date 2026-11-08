import { Component, DropdownComponent, MarkdownView, Notice, TFile, normalizePath, setIcon, stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { getActiveBook, getBookIdForPath } from '../utils/books';
import { getConfiguredActCount } from '../utils/acts';
import { safeTitle } from '../utils/noteTitle';
import { authorKeyFor } from './timetableFiles';
import { buildTableRow } from './timetableModel';
import { planCanvasSketchAppend } from './canvasSketchOrdering';
import { SKETCH_ORDER } from './sketchPlacement';
import { setAccessibleLabel } from '../utils/domTooltip';

class TextSketchCaptureModal extends ErtModal {
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly text: string, private readonly source: TFile) { super(plugin.app); }
    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.mountHeader({ title: t('ui.timetable.captureSketchTitle'), subtitle: this.source.basename });
        const books = this.plugin.settings.books;
        const row = this.contentEl.createDiv({ cls: 'setting-item' });
        row.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.book') });
        const bookSelect = new DropdownComponent(row.createDiv({ cls: 'setting-item-control' }));
        for (const book of books) bookSelect.addOption(book.id, book.title || book.sourceFolder);
        bookSelect.setValue(getActiveBook(this.plugin.settings)?.id ?? books[0]?.id ?? '');
        const actRow = this.contentEl.createDiv({ cls: 'setting-item' });
        actRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.act') });
        const actSelect = new DropdownComponent(actRow.createDiv({ cls: 'setting-item-control' }));
        actSelect.addOption('', t('ui.canvasSketch.noAct'));
        for (let n = 1; n <= getConfiguredActCount(this.plugin.settings); n++) actSelect.addOption(String(n), t('ui.canvasSketch.actNumber', { act: n }));
        this.contentEl.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.captureSketchName') });
        const title = this.contentEl.createEl('input', { type: 'text', value: safeTitle(this.text.split(/\r?\n/)[0]).slice(0, 100) });
        setAccessibleLabel(title, t('ui.timetable.captureSketchName'));
        this.contentEl.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.captureSketchText') });
        const body = this.contentEl.createEl('textarea', { attr: { rows: '8' } });
        body.value = this.text;
        setAccessibleLabel(body, t('ui.timetable.captureSketchText'));
        const actions = this.mountActions();
        const cancel = actions.createEl('button', { text: t('common.cancel') });
        const submit = actions.createEl('button', { text: t('ui.timetable.captureSketchTitle'), cls: 'ert-text-sketch-submit mod-cta' });
        cancel.onclick = () => this.close();
        submit.onclick = () => {
            if (submit.disabled) return;
            submit.disabled = true;
            void (async () => {
                const book = books.find(item => item.id === bookSelect.getValue());
                const folder = normalizePath(book?.sourceFolder ?? '');
                if (!book || !folder || !this.app.vault.getFolderByPath(folder) || !body.value.trim()) throw new Error(t('ui.canvasSketch.missingFolder'));
                const act = actSelect.getValue() ? Number(actSelect.getValue()) : null;
                const items = this.app.vault.getMarkdownFiles().filter(file => getBookIdForPath(books, file.path) === book.id).map(file => {
                    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
                    return { row: buildTableRow(file.path, file.basename, frontmatter, this.plugin.settings), frontmatter };
                });
                const placement = planCanvasSketchAppend(items, act, null, 1);
                if (placement.missing.length) throw new Error(t('ui.timetable.outlineImportMissingOrder'));
                const name = safeTitle(title.value).slice(0, 100) || t('ui.timetable.newSketchName');
                let path = `${folder}/${name}.md`;
                for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${name} ${n}.md`;
                const fm: Record<string, unknown> = { [authorKeyFor('Class', this.plugin.settings)]: 'Sketch', [SKETCH_ORDER]: placement.ranks[0], Source: `[[${this.source.path.replace(/\.md$/i, '')}]]` };
                if (act !== null) fm[authorKeyFor('Act', this.plugin.settings)] = act;
                await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n${body.value}\n`);
                this.close();
                // This dialog opens from the timeline and the Timetable's other
                // layouts too, so the notice names the book, not the outline.
                new Notice(t('ui.timetable.captureSketchAdded', { book: book.title || book.sourceFolder }));
                this.plugin.refreshTimelineIfNeeded(null);
            })().catch((error: unknown) => { submit.disabled = false; new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000); });
        };
    }
}

export type DraggedSelection = { text: string; source: TFile };

/**
 * Accept a dragged selection from a vault note, without moving the source text.
 * Elements matching rowSelector place the text themselves: capture stands aside
 * over them, and the returned getter gives them the selection being dragged.
 */
export function registerTextSketchCapture(owner: Component, host: HTMLElement, plugin: RadialTimelinePlugin, rowSelector?: string): () => DraggedSelection | null {
    let capture: DraggedSelection | null = null;
    let pressedSelection: { text: string; source: TFile; container: HTMLElement } | null = null;
    const doc = host.ownerDocument;
    const target = host.createDiv({ cls: 'ert-text-sketch-drop', attr: { role: 'status' } });
    setIcon(target.createSpan(), 'file-plus-2');
    target.createSpan({ text: t('ui.timetable.captureSketchDrop') });
    const clear = () => { capture = null; target.removeClass('is-visible'); };
    const overRow = (event: DragEvent): boolean => !!rowSelector && event.target instanceof Element && !!event.target.closest(rowSelector);
    owner.registerDomEvent(doc, 'pointerdown', (event: PointerEvent) => {
        pressedSelection = null;
        const origin = event.target as Node | null;
        if (!origin) return;
        const view = plugin.app.workspace.getLeavesOfType('markdown')
            .map(leaf => leaf.view)
            .find((candidate): candidate is MarkdownView => candidate instanceof MarkdownView && candidate.containerEl.contains(origin));
        if (!view?.file) return;
        const selection = doc.getSelection();
        const inside = selection?.anchorNode && selection.focusNode && view.containerEl.contains(selection.anchorNode) && view.containerEl.contains(selection.focusNode);
        const text = view.getMode() === 'source' ? view.editor.getSelection() : inside ? selection.toString() : '';
        if (text.trim()) pressedSelection = { text, source: view.file, container: view.containerEl };
    }, true);
    owner.registerDomEvent(doc, 'dragstart', (event: DragEvent) => {
        clear();
        const origin = event.target as Node | null;
        // CodeMirror may clear its selection before the browser emits dragstart.
        if (origin && pressedSelection?.container.contains(origin)) {
            capture = { text: pressedSelection.text, source: pressedSelection.source };
        }
        pressedSelection = null;
    }, true);
    owner.registerDomEvent(host, 'dragover', (event: DragEvent) => {
        if (!capture) return;
        if (overRow(event)) { target.removeClass('is-visible'); return; }
        if (!target.isConnected) {
            const toolbar = host.querySelector<HTMLElement>('.ert-timetable-panels__toolbar');
            if (toolbar) toolbar.after(target); else host.appendChild(target);
        }
        target.addClass('is-visible');
        // The entire pane accepts note text; this also prevents the editor's
        // default move operation and keeps file/scene drags on their own paths.
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }, true);
    owner.registerDomEvent(host, 'drop', (event: DragEvent) => {
        if (!capture || overRow(event)) return;
        event.preventDefault(); event.stopPropagation();
        const { text, source } = capture;
        clear();
        new TextSketchCaptureModal(plugin, text, source).open();
    }, true);
    owner.registerDomEvent(doc, 'dragend', clear, true);
    owner.register(() => target.remove());
    return () => capture;
}
