import { Component, DropdownComponent, Notice, TFile, normalizePath, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { getActiveBook, getBookIdForPath } from '../utils/books';
import { internalDraggedFiles } from '../utils/obsidianInternals';
import { classifyForPromotion, filenamePrefix } from '../services/PromoteToSceneService';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { buildTableRow } from './timetableModel';
import { readSceneId } from '../utils/sceneIds';
import { TimelineNoteDropModal, type TimelineNoteTarget } from './TimelineNoteDrop';
import { authorKeyFor } from './timetableFiles';
import { addSceneIntakeTemplate, type SceneIntakeContext } from './sceneIntakeTemplate';
import { applyFrontmatterEdits, isBlankFrontmatterValue, readFrontmatterText, replaceValueEdit, yamlKey, type TextEdit } from '../utils/frontmatterText';
import { scenePropertySetLabel } from '../utils/yamlTemplateNormalize';
import { readAnchorWhen } from '../services/SceneInsertService';

export function sameSceneNumber(a: string | null, b: string | null): boolean {
    return !!a && !!b && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b);
}

/** Scenes a dropped note can follow: its own act's, or the whole book's when the note has no Act. */
export function noteDropAnchors<T extends { row: { kind: string; act: number | null }; id?: string | null }>(items: readonly T[], act: number | null): T[] {
    const counts = new Map<string, number>();
    for (const item of items) if (item.row.kind === 'scene' && item.id) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    return items.filter(item => item.row.kind === 'scene' && (act === null || item.row.act === act) && !!item.id && counts.get(item.id) === 1);
}

/**
 * The scene a note numbered `number` would follow, so it joins that scene's act
 * and date the way a scene added after it does. A note numbered before every
 * scene joins the first scene's act and takes no date from it.
 */
export function sceneBeforeNumber<T extends { prefix: string | null }>(scenes: readonly T[], number: string): { scene: T; precedes: boolean } | undefined {
    const value = Number(number);
    const numbered = scenes
        .filter((scene): scene is T & { prefix: string } => scene.prefix !== null && Number.isFinite(Number(scene.prefix)))
        .sort((a, b) => Number(a.prefix) - Number(b.prefix));
    const before = numbered.filter(scene => Number(scene.prefix) <= value).pop();
    if (before) return { scene: before, precedes: true };
    return numbered[0] ? { scene: numbered[0], precedes: false } : undefined;
}

/** Insert only the missing lines, preserving all existing bytes; an empty Class or Act is filled in place. */
export function addNoteClass(content: string, kind: 'Scene' | 'Sketch', anchor?: string, act?: { key: string; value: number }): string {
    const placementLines = (anchor ? [`Place after scene: ${JSON.stringify(anchor)}`] : []);
    const text = readFrontmatterText(content);
    if (!text) return `---\nClass: ${kind}\n${[...placementLines, ...(act ? [`${yamlKey(act.key)}: ${act.value}`] : [])].map(line => `${line}\n`).join('')}---\n\n${content}`;
    const find = (name: string) => text.fields.find(field => field.key.toLowerCase() === name.toLowerCase());
    const classField = find('class');
    if (classField && !isBlankFrontmatterValue(classField.value)) throw new Error(t('ui.timetable.noteDropHasClass'));
    if (anchor && find('place after scene')) throw new Error(t('ui.timetable.noteDropExistingPlacement'));
    const edits: TextEdit[] = [];
    if (classField) edits.push(replaceValueEdit(text, classField, kind));
    const lines = classField ? [...placementLines] : [`Class: ${kind}`, ...placementLines];
    if (act) {
        const actField = find(act.key);
        if (actField && !isBlankFrontmatterValue(actField.value)) throw new Error(t('ui.timetable.noteDropExistingPlacement'));
        if (actField) edits.push(replaceValueEdit(text, actField, String(act.value)));
        else lines.push(`${yamlKey(act.key)}: ${act.value}`);
    }
    if (lines.length) edits.push({ start: 0, end: 0, text: lines.map(line => line + text.newline).join('') });
    return applyFrontmatterEdits(text, edits);
}

class NoteDropModal extends ErtModal {
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly file: TFile, private readonly initialBook?: string, private readonly defaultKind: 'Scene' | 'Sketch' = 'Scene') { super(plugin.app); }
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
        kind.setValue(this.defaultKind);
        const propertiesRow = this.contentEl.createDiv({ cls: 'setting-item' });
        propertiesRow.createDiv({ cls: 'setting-item-name', text: t('ui.scenePropertiesSection.heading') });
        propertiesRow.createDiv({ cls: 'setting-item-control', text: scenePropertySetLabel(this.plugin.settings) });
        const numberRow = this.contentEl.createDiv({ cls: 'setting-item ert-note-drop-number' });
        numberRow.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.noteDropNumber') });
        const number = numberRow.createDiv({ cls: 'setting-item-control' }).createEl('input', { type: 'text', attr: { placeholder: '72' } });
        setAccessibleLabel(number, t('ui.timetable.noteDropNumber'));
        number.value = filenamePrefix(this.file.basename) ?? '';
        const anchorRow = this.contentEl.createDiv({ cls: 'setting-item ert-note-drop-anchor' });
        anchorRow.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.noteDropAfter') });
        anchorRow.createDiv({ cls: 'setting-item-description', text: t('ui.timetable.noteDropAnchorHint') });
        const anchor = new DropdownComponent(anchorRow.createDiv({ cls: 'setting-item-control' }));
        const noteAct = () => buildTableRow(this.file.path, this.file.basename, this.app.metadataCache.getFileCache(this.file)?.frontmatter, this.plugin.settings).act;
        const anchors = () => noteDropAnchors(this.app.vault.getMarkdownFiles().filter(file => getBookIdForPath(this.plugin.settings.books, file.path) === book.getValue()).map(file => {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            return { file, row: buildTableRow(file.path, file.basename, fm, this.plugin.settings), id: readSceneId(fm) };
        }), noteAct());
        const updateAnchors = () => {
            anchor.selectEl.empty(); anchor.addOption('', t('ui.timetable.noteDropEndAct'));
            anchors().sort((a, b) => a.file.basename.localeCompare(b.file.basename, undefined, { numeric: true }))
                .forEach(item => anchor.addOption(item.id!, item.file.basename));
        };
        const explanation = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint' });
        explanation.hide();
        const conflict = () => {
            const prefix = number.value.trim();
            return kind.getValue() === 'Scene' && this.app.vault.getMarkdownFiles().some(f => f !== this.file && getBookIdForPath(this.plugin.settings.books, f.path) === book.getValue() && sameSceneNumber(filenamePrefix(f.basename), prefix) && classifyForPromotion(this.app.metadataCache.getFileCache(f)?.frontmatter).kind === 'alreadyScene');
        };
        const update = () => {
            propertiesRow.hidden = kind.getValue() !== 'Scene';
            numberRow.hidden = kind.getValue() !== 'Scene';
            anchorRow.hidden = kind.getValue() !== 'Sketch';
            if (conflict()) { explanation.setText(t('ui.timetable.noteDropNumberExists')); explanation.show(); } else explanation.hide();
        };
        kind.onChange(update); book.onChange(() => { updateAnchors(); update(); }); number.oninput = update; updateAnchors(); update();
        const actions = this.mountActions();
        const help = actions.createEl('button', { cls: 'clickable-icon ert-note-drop-help', attr: { type: 'button' } });
        setIcon(help, 'circle-help');
        setAccessibleLabel(help, t('ui.timetable.noteDropExplanation'));
        setTooltip(help, t('ui.timetable.noteDropExplanation'));
        actions.createEl('button', { text: t('common.cancel') }).onclick = () => this.close();
        const submit = actions.createEl('button', { text: t('ui.timetable.noteDropConfirm'), cls: 'ert-note-drop-confirm mod-cta' });
        submit.onclick = () => {
            submit.disabled = true;
            void (async () => {
                const chosen = books.find(item => item.id === book.getValue());
                if (!chosen) throw new Error(t('ui.canvasSketch.noBook'));
                const type = kind.getValue() === 'Sketch' ? 'Sketch' : 'Scene';
                const after = type === 'Sketch' ? anchor.getValue() || undefined : undefined;
                let act: { key: string; value: number } | undefined;
                if (after) {
                    const match = anchors().find(item => item.id === after);
                    if (!match) throw new Error(t('ui.timetable.sketchPromotionAnchorProblem'));
                    // A note with no Act joins the act of the scene it now follows.
                    if (noteAct() === null && match.row.act !== null) act = { key: authorKeyFor('Act', this.plugin.settings), value: match.row.act };
                }
                const input = number.value.trim();
                if (type === 'Scene' && !/^\d+(?:\.\d+)?$/.test(input)) throw new Error(t('ui.timetable.noteDropNumberRequired'));
                const oldPath = this.file.path;
                const belongs = getBookIdForPath(this.plugin.settings.books, oldPath) === chosen.id;
                const originalPrefix = filenamePrefix(this.file.basename);
                const unnumbered = originalPrefix ? this.file.name.slice(originalPrefix.length).trimStart() : this.file.name;
                const name = type === 'Scene' ? `${input} ${unnumbered}` : this.file.name;
                const folder = belongs ? this.file.parent?.path ?? chosen.sourceFolder : chosen.sourceFolder;
                const destination = normalizePath(`${folder}/${name}`);
                if (destination !== oldPath && this.app.vault.getAbstractFileByPath(destination)) throw new Error(t('ui.timetable.noteDropExists'));
                const prefix = input;
                if (type === 'Scene' && this.app.vault.getMarkdownFiles().some(f => f !== this.file && getBookIdForPath(this.plugin.settings.books, f.path) === chosen.id && sameSceneNumber(filenamePrefix(f.basename), prefix) && classifyForPromotion(this.app.metadataCache.getFileCache(f)?.frontmatter).kind === 'alreadyScene')) throw new Error(t('ui.timetable.noteDropNumberExists'));
                // A numbered scene joins the act and date of the scene it follows.
                const intake: SceneIntakeContext = {};
                if (type === 'Scene') {
                    const scenes = this.app.vault.getMarkdownFiles()
                        .filter(f => f !== this.file && getBookIdForPath(this.plugin.settings.books, f.path) === chosen.id && classifyForPromotion(this.app.metadataCache.getFileCache(f)?.frontmatter).kind === 'alreadyScene')
                        .map(f => ({ file: f, prefix: filenamePrefix(f.basename) }));
                    const neighbor = sceneBeforeNumber(scenes, input);
                    if (neighbor) {
                        const row = buildTableRow(neighbor.scene.file.path, neighbor.scene.file.basename, this.app.metadataCache.getFileCache(neighbor.scene.file)?.frontmatter, this.plugin.settings);
                        intake.act = row.act ?? undefined;
                        if (neighbor.precedes) intake.when = await readAnchorWhen(this.app, this.plugin.settings, neighbor.scene.file);
                    }
                }
                // Validate before a move and again inside vault.process for concurrent edits.
                const prepare = (content: string) => {
                    const classified = addNoteClass(content, type, after, act);
                    return type === 'Scene' ? addSceneIntakeTemplate(classified, this.plugin.settings, intake) : classified;
                };
                prepare(await this.app.vault.read(this.file));
                if (destination !== oldPath) await this.app.fileManager.renameFile(this.file, destination);
                try { await this.app.vault.process(this.file, prepare); }
                catch (error) { if (destination !== oldPath) await this.app.fileManager.renameFile(this.file, oldPath); throw error; }
                this.close(); this.plugin.refreshTimelineIfNeeded(null); new Notice(t('ui.timetable.noteDropDone'));
            })().catch((error: unknown) => { submit.disabled = false; explanation.setText(error instanceof Error ? error.message : String(error)); explanation.show(); });
        };
    }
}

/** Handle file-explorer drags without intercepting selected text or existing scene drags. */
export function registerNoteDropCapture(owner: Component, host: HTMLElement, plugin: RadialTimelinePlugin, bookId: () => string | undefined, options?: { defaultKind?: 'Scene' | 'Sketch'; ownDropPoint?: (event: DragEvent) => boolean; acceptPoint?: (event: DragEvent) => boolean; rejectPoint?: (event: DragEvent) => string | undefined; timelinePoint?: (event: DragEvent) => { target: TimelineNoteTarget; element: Element } | undefined }): void {
    let explorerFile: TFile | null = null;
    let highlighted: Element | null = null;
    let sceneOutline: SVGElement | null = null;
    let lastTimeline: { target: TimelineNoteTarget; element: Element; x: number; y: number } | null = null;
    const target = host.createDiv({ cls: 'ert-text-sketch-drop', attr: { role: 'status' } });
    if (target) { setIcon(target.createSpan(), 'file-plus-2'); target.createSpan({ text: t('ui.timetable.noteDropHint') }); }
    const dragged = (): TFile | null => {
        const candidates = explorerFile ? [explorerFile] : internalDraggedFiles(plugin.app);
        const files = [...new Map(candidates.filter((file): file is TFile => file instanceof TFile && file.extension.toLowerCase() === 'md').map(file => [file.path, file])).values()];
        if (files.length !== 1) return null;
        const classification = classifyForPromotion(plugin.app.metadataCache.getFileCache(files[0])?.frontmatter);
        return classification.kind === 'eligible' && !classification.fromSketch ? files[0] : null;
    };
    const clear = () => { target?.removeClass('is-visible'); highlighted?.classList.remove('rt-drop-target'); highlighted = null; sceneOutline?.remove(); sceneOutline = null; lastTimeline = null; };
    const highlightTimeline = (element: Element) => {
        highlighted = element;
        element.classList.add('rt-drop-target');
        const svg = element.closest('svg');
        const path = element.matches('path') ? element : element.querySelector('path.rt-scene-path');
        if (!svg || !path) return;
        const outline = path.cloneNode(false) as SVGElement;
        outline.removeAttribute('id');
        outline.setAttribute('class', 'ert-note-drop-scene-outline');
        outline.setAttribute('pointer-events', 'none');
        const squares = svg.querySelector('.rt-number-squares');
        if (squares) squares.before(outline); else svg.appendChild(outline);
        sceneOutline = outline;
    };
    // Obsidian can place a workspace drop overlay above the view, so the DOM
    // event target is not necessarily inside the view under the pointer.
    const isOverView = (event: DragEvent): boolean => {
        if (!host.isConnected) return false;
        const area = host.closest<HTMLElement>('.bases-view') ?? host;
        const rect = area.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom && (options?.acceptPoint?.(event) ?? true);
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
        if (!isOverView(event) || !dragged() || options?.ownDropPoint?.(event)) { clear(); return; }
        if (options?.rejectPoint?.(event)) {
            clear(); event.preventDefault(); event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            return;
        }
        const timeline = options?.timelinePoint?.(event);
        if (timeline) {
            if (highlighted !== timeline.element) { clear(); highlightTimeline(timeline.element); }
            lastTimeline = { ...timeline, x: event.clientX, y: event.clientY };
            event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            return;
        }
        if (highlighted) clear();
        // Rendering replaces the timetable contents. Restore the indicator
        // immediately below its sticky toolbar, not after the last card/row.
        const toolbar = host.querySelector<HTMLElement>('.ert-timetable-panels__toolbar');
        if (toolbar && target.previousElementSibling !== toolbar) toolbar.after(target);
        else if (!toolbar && !target.isConnected) host.appendChild(target);
        target?.addClass('is-visible');
        event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }, true);
    owner.registerDomEvent(host.ownerDocument, 'drop', (event: DragEvent) => {
        if (!isOverView(event) || options?.ownDropPoint?.(event)) { clear(); return; }
        const file = dragged();
        const timeline = options?.timelinePoint?.(event) ?? (lastTimeline && Math.hypot(event.clientX - lastTimeline.x, event.clientY - lastTimeline.y) <= 8 ? lastTimeline : undefined);
        clear();
        if (!file) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const rejection = options?.rejectPoint?.(event);
        if (rejection) { new Notice(rejection, 8000); return; }
        if (timeline) {
            const id = bookId();
            if (!id) { new Notice(t('ui.canvasSketch.noBook')); return; }
            window.setTimeout(() => new TimelineNoteDropModal(plugin, file, id, timeline.target).open(), 0);
            return;
        }
        window.setTimeout(() => new NoteDropModal(plugin, file, bookId(), options?.defaultKind).open(), 0);
    }, true);
    owner.registerDomEvent(host.ownerDocument, 'dragend', () => { clear(); explorerFile = null; }, true);
    owner.register(() => { clear(); target?.remove(); });
}
