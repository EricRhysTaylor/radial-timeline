import { Component, DropdownComponent, ItemView, Notice, TFile, normalizePath, stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { safeTitle } from '../utils/noteTitle';
import { authorKeyFor } from './timetableFiles';
import { addSceneIntakeTemplate } from './sceneIntakeTemplate';
import { bookSubplotName } from './canvasBookCards';
import { findSafeSceneInsertionPrefix, scenePrefixBefore } from '../services/SceneInsertService';
import { mapScenes } from './StoryMapReviewModal';
import { diffStoryMap } from './storyMapDiff';
import { isStoryMapProvenance, matchingBaseline } from './storyMapProvenance';
import { planCanvasTextDrop, type CanvasDropProblem } from './canvasTextDropPlan';
import { insertCanvasSceneCard } from './canvasTextDropLayout';
import { registerTextSketchCapture, type DraggedSelection } from './TextSketchCapture';
import type { StoryCanvasData } from './canvasSketches';
import { isStoryMapPath } from './storyMapPaths';

type CanvasNode = { nodeEl?: HTMLElement; getData?: () => { file?: string; x?: number; y?: number; width?: number; height?: number } };
type Canvas = { nodes?: Map<string, CanvasNode>; getData?: () => StoryCanvasData; setData?: (data: StoryCanvasData) => void; requestSave?: () => void };
type CanvasView = ItemView & { file?: TFile | null; canvas?: Canvas };
type Point = { x: number; y: number };
const uid = () => crypto.randomUUID().replace(/-/g, '');
const dropProblemKeys: Record<CanvasDropProblem, string> = {
    invalidPosition: 'ui.timetable.canvasDropInvalidPosition',
    overlappingLanes: 'ui.timetable.canvasDropOverlappingLanes',
    unassignedLane: 'ui.timetable.canvasDropUnassignedLane',
    splitScene: 'ui.timetable.canvasDropSplitScene',
    noScenes: 'ui.timetable.canvasDropNoScenes',
    outOfOrder: 'ui.timetable.canvasDropOutOfOrder',
    hiddenScenes: 'ui.timetable.canvasDropHiddenScenes',
    missingAct: 'ui.timetable.canvasDropMissingAct',
};

/** Use a rendered node as a ruler; Canvas' viewport transform is not public API. */
export function canvasPoint(canvas: Canvas, event: Pick<DragEvent, 'clientX' | 'clientY'>): Point | null {
    for (const item of canvas.nodes?.values() ?? []) {
        const node = item.getData?.();
        const box = item.nodeEl?.getBoundingClientRect();
        if (!node || !box || typeof node.x !== 'number' || typeof node.y !== 'number' || typeof node.width !== 'number' || typeof node.height !== 'number' || node.width <= 0 || node.height <= 0) continue;
        const sx = box.width / node.width, sy = box.height / node.height;
        if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || Math.abs(sx - sy) > Math.max(sx, sy) * 0.05) continue;
        return { x: node.x + (event.clientX - box.left) / sx, y: node.y + (event.clientY - box.top) / sy };
    }
    return null;
}

class CanvasTextDropModal extends ErtModal {
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly view: CanvasView, private readonly droppedText: DraggedSelection, private readonly point: Point) { super(plugin.app); }
    onOpen(): void {
        this.applyShell({ size: 'lg' });
        const path = this.view.file?.path;
        const canvas = this.view.canvas;
        const record = path ? this.plugin.settings.storyMapProvenance?.[path] : undefined;
        if (path && !isStoryMapProvenance(record)) {
            this.mountHeader({ title: t('ui.timetable.canvasDropUnavailable') });
            this.contentEl.createEl('p', { text: t('ui.timetable.canvasDropLegacy') }); return;
        }
        if (!path || !canvas?.getData || !canvas.setData || !canvas.requestSave || !isStoryMapProvenance(record)) {
            this.mountHeader({ title: t('ui.timetable.canvasDropUnavailable') }); return;
        }
        const book = this.plugin.settings.books.find(item => item.id === record.bookId);
        if (!book || !this.app.vault.getFolderByPath(book.sourceFolder)) { this.mountHeader({ title: t('ui.canvasSketch.noBook') }); return; }
        const original = canvas.getData();
        const snapshot = JSON.stringify(original);
        const recordSnapshot = JSON.stringify(record);
        const baseline = matchingBaseline(record.generated, original);
        const flipped = !!record.orientationFlipped !== baseline.transposed;
        const vertical = record.layout === 'vertical' ? !flipped : flipped;
        const scenes = mapScenes(this.plugin, { ...record, act: null, subplot: null });
        const target = planCanvasTextDrop(original, baseline.data, scenes, this.point, vertical);
        if (target.kind === 'ambiguous') {
            this.mountHeader({ title: t('ui.timetable.canvasDropUnavailable') });
            this.contentEl.createEl('p', { text: t(dropProblemKeys[target.reason]) }); return;
        }
        this.mountHeader({ title: target.kind === 'scene' ? t('ui.timetable.canvasDropScene') : t('ui.timetable.captureSketchTitle'), subtitle: book.title || book.sourceFolder });
        if (target.kind === 'scene') {
            const changes = diffStoryMap(record.scenes, mapScenes(this.plugin, record));
            if (changes.added.length || changes.removed.length || changes.actChanged.length || changes.subplotsChanged.length || changes.orderChanged) {
                this.contentEl.createEl('p', { text: t('ui.timetable.canvasDropStale') }); return;
            }
            const position = target.after ? `${t('ui.timetable.timelineDropAfterLabel')}: ${target.after.split('/').pop()?.replace(/\.md$/i, '')}` : t('ui.timetable.canvasDropBeginning');
            this.contentEl.createEl('p', { text: `${target.subplot} · ${position}` });
            this.contentEl.createEl('p', { text: t('ui.timetable.canvasDropShift') });
        }
        let chosenAct = target.kind === 'scene' ? target.act : 0;
        let actSelect: DropdownComponent | null = null;
        if (target.kind === 'scene') {
            const allowedActs = record.act === null ? target.actChoices : target.actChoices.filter(act => act === record.act);
            if (!allowedActs.length) { this.contentEl.createEl('p', { text: t('ui.timetable.canvasDropScopedAct') }); return; }
            chosenAct = allowedActs[0];
            const actRow = this.contentEl.createDiv({ cls: 'setting-item' });
            actRow.createDiv({ cls: 'setting-item-name', text: t('ui.canvasSketch.act') });
            actSelect = new DropdownComponent(actRow.createDiv({ cls: 'setting-item-control' }));
            for (const act of allowedActs) actSelect.addOption(String(act), t('ui.canvasSketch.actNumber', { act }));
            actSelect.setValue(String(chosenAct));
        }
        this.contentEl.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.canvasDropName') });
        const title = this.contentEl.createEl('input', { type: 'text', value: safeTitle(this.droppedText.text.split(/\r?\n/)[0]).slice(0, 100) });
        this.contentEl.createDiv({ cls: 'setting-item-name', text: t('ui.timetable.captureSketchText') });
        const body = this.contentEl.createEl('textarea', { attr: { rows: '8' } }); body.value = this.droppedText.text;
        const status = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint' });
        const actions = this.mountActions();
        actions.createEl('button', { text: t('common.cancel') }).onclick = () => this.close();
        const submit = actions.createEl('button', { text: target.kind === 'scene' ? t('ui.timetable.canvasDropScene') : t('ui.timetable.captureSketchTitle'), cls: 'ert-canvas-drop-submit mod-cta' });
        let proposedPrefix: string | null = null;
        if (target.kind === 'scene') {
            let revision = 0;
            const refresh = () => {
                const currentRevision = ++revision;
                submit.disabled = true; proposedPrefix = null;
                const after = target.after && chosenAct === target.act ? target.after : null;
                void this.plugin.getSceneData({ sourcePath: book.sourceFolder }).then(items => {
                const prefix = after ? findSafeSceneInsertionPrefix(items, after) : target.before ? scenePrefixBefore(items, target.before) : null;
                if (!prefix) throw new Error(t('ui.timetable.timelineDropNoNumber'));
                // Check whether the layout can be changed without touching manual work.
                insertCanvasSceneCard(original, baseline.data, { laneId: target.laneId, nodeId: '__preview_node__', edgeId: () => '__preview_edge__', path: '__preview__', beforePath: target.before, vertical, keepHeading: !after });
                if (currentRevision !== revision) return;
                proposedPrefix = prefix;
                status.setText(t('ui.timetable.canvasDropPosition', { number: prefix, before: target.before?.split('/').pop()?.replace(/\.md$/i, '') ?? t('ui.timetable.canvasDropEnd') }));
                submit.disabled = false;
                }).catch((error: unknown) => { if (currentRevision === revision) status.setText(error instanceof Error ? error.message : String(error)); });
            };
            actSelect?.onChange(value => { chosenAct = Number(value); refresh(); });
            refresh();
        }
        let noteCreated = false;
        submit.onclick = () => { submit.disabled = true; void (async () => {
            if (!body.value.trim()) throw new Error(t('ui.timetable.canvasDropEmpty'));
            if (this.view.file?.path !== path || JSON.stringify(canvas.getData!()) !== snapshot || JSON.stringify(this.plugin.settings.storyMapProvenance?.[path]) !== recordSnapshot) throw new Error(t('ui.timetable.timelineDropChanged'));
            const name = safeTitle(title.value).slice(0, 100) || t('ui.timetable.newSketchName');
            const fm: Record<string, unknown> = { [authorKeyFor('Class', this.plugin.settings)]: target.kind === 'scene' ? 'Scene' : 'Sketch', Source: `[[${this.droppedText.source.path.replace(/\.md$/i, '')}]]` };
            let destination: string;
            let nextCanvas: StoryCanvasData;
            let nextBaseline: StoryCanvasData | null = null;
            if (target.kind === 'scene') {
                const latest = mapScenes(this.plugin, { ...record, act: null, subplot: null });
                if (JSON.stringify(latest) !== JSON.stringify(scenes)) throw new Error(t('ui.timetable.timelineDropChanged'));
                const items = await this.plugin.getSceneData({ sourcePath: book.sourceFolder });
                const after = target.after && chosenAct === target.act ? target.after : null;
                const prefix = after ? findSafeSceneInsertionPrefix(items, after) : target.before ? scenePrefixBefore(items, target.before) : null;
                if (!prefix || prefix !== proposedPrefix) throw new Error(t('ui.timetable.timelineDropNoNumber'));
                destination = normalizePath(`${book.sourceFolder}/${prefix} ${name}.md`);
                if (this.app.vault.getAbstractFileByPath(destination)) throw new Error(t('ui.timetable.noteDropExists'));
                fm[authorKeyFor('Act', this.plugin.settings)] = chosenAct;
                fm[authorKeyFor('Subplot', this.plugin.settings)] = [bookSubplotName(target.subplot, book)];
                const layout = insertCanvasSceneCard(original, baseline.data, { laneId: target.laneId, nodeId: uid(), edgeId: uid, path: destination, beforePath: target.before, vertical, keepHeading: !after });
                nextCanvas = layout.data; nextBaseline = layout.baseline;
            } else {
                destination = normalizePath(`${book.sourceFolder}/${name}.md`);
                for (let n = 2; this.app.vault.getAbstractFileByPath(destination); n++) destination = normalizePath(`${book.sourceFolder}/${name} ${n}.md`);
                nextCanvas = { ...original, nodes: [...(original.nodes ?? []), { id: uid(), type: 'file', file: destination, x: Math.round(this.point.x), y: Math.round(this.point.y), width: 300, height: 170 }] };
            }
            const raw = `---\n${stringifyYaml(fm)}---\n\n${body.value}\n`;
            const content = target.kind === 'scene' ? addSceneIntakeTemplate(raw, this.plugin.settings, { act: chosenAct }) : raw;
            if (JSON.stringify(canvas.getData!()) !== snapshot || JSON.stringify(this.plugin.settings.storyMapProvenance?.[path]) !== recordSnapshot) throw new Error(t('ui.timetable.timelineDropChanged'));
            await this.app.vault.create(destination, content);
            noteCreated = true;
            try { canvas.setData!(nextCanvas); canvas.requestSave!(); }
            catch (error) { throw new Error(t('ui.timetable.canvasDropRecovery', { path: destination, message: error instanceof Error ? error.message : String(error) })); }
            if (target.kind === 'scene' && nextBaseline) {
                const mapped = { path: destination, act: chosenAct, subplots: [target.subplot] };
                const updatedScenes = [...record.scenes];
                const after = updatedScenes.findIndex(item => item.path === target.after);
                // The record may be a scoped subplot, where the global anchor is absent.
                const before = target.before ? updatedScenes.findIndex(item => item.path === target.before) : -1;
                updatedScenes.splice(before >= 0 ? before : after >= 0 ? after + 1 : updatedScenes.length, 0, mapped);
                this.plugin.settings.storyMapProvenance = { ...this.plugin.settings.storyMapProvenance, [path]: { ...record, orientationFlipped: flipped, generated: nextBaseline, scenes: updatedScenes } };
                try { await this.plugin.saveSettings(); } catch (error) { console.error('[Canvas text drop] Could not save map details', error); new Notice(t('ui.timetable.canvasDropTrackingFailed'), 10000); }
            }
            this.plugin.refreshTimelineIfNeeded(null);
            this.close(); new Notice(t('ui.timetable.noteDropDone'));
        })().catch((error: unknown) => { submit.disabled = noteCreated; status.setText(error instanceof Error ? error.message : String(error)); }); };
    }
}

export function registerCanvasTextDrop(owner: Component, view: ItemView, plugin: RadialTimelinePlugin): void {
    const canvasView = view as CanvasView;
    view.contentEl.addClass('ert-canvas-text-drop-host');
    owner.register(() => view.contentEl.removeClass('ert-canvas-text-drop-host'));
    const marker = view.contentEl.createDiv({ cls: 'ert-canvas-text-drop-marker' });
    marker.hide();
    owner.register(() => marker.remove());
    let hoverScenes: ReturnType<typeof mapScenes> | null = null;
    registerTextSketchCapture(owner, view.contentEl, plugin, undefined, {
        accept: () => !!canvasView.file?.path && isStoryMapPath(canvasView.file.path),
        onClear: () => { marker.hide(); hoverScenes = null; },
        onOver: (event, banner) => {
            const label = banner.lastElementChild;
            const path = canvasView.file?.path;
            const record = path ? plugin.settings.storyMapProvenance?.[path] : undefined;
            const canvas = canvasView.canvas;
            if (!isStoryMapProvenance(record) || !canvas?.getData) return;
            const point = canvasPoint(canvas, event);
            if (!point) { if (label) label.textContent = t('ui.timetable.canvasDropViewPosition'); marker.hide(); return; }
            const current = canvas.getData();
            const baseline = matchingBaseline(record.generated, current);
            const flipped = !!record.orientationFlipped !== baseline.transposed;
            const vertical = record.layout === 'vertical' ? !flipped : flipped;
            hoverScenes ??= mapScenes(plugin, { ...record, act: null, subplot: null });
            const target = planCanvasTextDrop(current, baseline.data, hoverScenes, point, vertical);
            if (target.kind !== 'scene') {
                if (label) label.textContent = t(target.kind === 'sketch' ? 'ui.timetable.captureSketchDrop' : dropProblemKeys[target.reason]);
                marker.hide(); return;
            }
            if (label) label.textContent = target.after ? t('ui.timetable.canvasDropOverScene', { subplot: target.subplot, scene: target.after.split('/').pop()?.replace(/\.md$/i, '') ?? '' }) : t('ui.timetable.canvasDropBeginning');
            const lane = canvas.nodes?.get(target.laneId)?.nodeEl?.getBoundingClientRect();
            const anchor = [...(canvas.nodes?.values() ?? [])].find(node => node.getData?.().file === (target.before ?? target.after))?.nodeEl?.getBoundingClientRect();
            if (!lane || !anchor) { marker.hide(); return; }
            const host = view.contentEl.getBoundingClientRect();
            marker.setCssProps({
                '--ert-drop-left': `${(vertical ? lane.left : (target.before ? anchor.left : anchor.right)) - host.left}px`,
                '--ert-drop-top': `${(vertical ? (target.before ? anchor.top : anchor.bottom) : lane.top) - host.top}px`,
                '--ert-drop-width': `${vertical ? lane.width : 4}px`,
                '--ert-drop-height': `${vertical ? 4 : lane.height}px`,
            });
            marker.show();
        },
        onDrop: (selection, event) => {
            const point = canvasView.canvas && canvasPoint(canvasView.canvas, event);
            if (!point) { new Notice(t('ui.timetable.canvasDropViewPosition'), 10000); return; }
            new CanvasTextDropModal(plugin, canvasView, selection, point).open();
        },
    });
}
