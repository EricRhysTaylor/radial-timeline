import { Component, setIcon, TFile, type ItemView } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { buildTableRow, compareManuscriptRows } from './timetableModel';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { selectedCanvasBounds, storyActHeadingLabel, storyAxis, storyPosition, storyProgress } from './canvasNavigation';

type NodeData = { type?: string; file?: string; text?: string; x?: number; y?: number; width?: number; height?: number };
type Canvas = { nodes?: Map<string, { nodeEl?: HTMLElement; getData?: () => NodeData }>; selection?: Set<{ getData?: () => NodeData }>; x?: number; y?: number; zoom?: number; setViewport?: (x: number, y: number, zoom: number) => void; zoomToFit?: () => void; zoomToBbox?: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void };

/** A navigator only for generated story maps; it does not alter the Canvas data. */
export class CanvasStoryNavigator {
    private root: HTMLElement | null = null;
    private path = '';
    private events = new Component();
    private readonly actLabels = new Map<HTMLElement, HTMLElement>();
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly view: ItemView) {}

    refresh(): void {
        const file = (this.view as unknown as { file?: TFile | null }).file;
        const path = file?.path ?? ''; // SAFE: a canvas view without a file is never a Story Map
        const isStoryMap = path.startsWith('Radial Timeline/Story Maps/') && path.endsWith('.canvas');
        const canvasView = (this.view as unknown as { canvas?: Canvas }).canvas;
        const visibleActNodes = new Set<HTMLElement>();
        for (const node of canvasView?.nodes?.values() ?? []) { // SAFE: Canvas internals are undocumented; no canvas or node map = nothing to mark
            const data = node.getData?.();
            const el = node.nodeEl;
            if (!el) continue;
            const label = isStoryMap && data?.type === 'text' && typeof data.text === 'string' ? storyActHeadingLabel(data.text) : null;
            el.toggleClass('ert-story-act-heading', !!label);
            el.toggleClass('ert-story-act-heading--bold', !!label && typeof data?.text === 'string' && data.text.trimStart().startsWith('**'));
            if (!label) continue;
            visibleActNodes.add(el);
            let overlay = this.actLabels.get(el);
            if (!overlay || !el.contains(overlay)) {
                overlay = el.createDiv({ cls: 'ert-story-act-label', attr: { 'aria-hidden': 'true' } });
                const heading = overlay.createDiv({ cls: 'ert-story-act-label__heading' });
                setIcon(heading.createSpan({ cls: 'ert-story-act-label__icon' }), 'book-open');
                heading.createSpan({ cls: 'ert-story-act-label__text' });
                overlay.createDiv({ cls: 'ert-story-act-label__description' });
                this.actLabels.set(el, overlay);
            }
            const text = overlay.querySelector('.ert-story-act-label__text');
            if (text && text.textContent !== label) text.textContent = label;
            const description = overlay.querySelector('.ert-story-act-label__description');
            const remainder = typeof data?.text === 'string' ? data.text.split('\n').slice(1).join('\n').trim() : '';
            if (description && description.textContent !== remainder) description.textContent = remainder;
        }
        for (const [el, overlay] of this.actLabels) {
            if (visibleActNodes.has(el)) continue;
            overlay.remove(); this.actLabels.delete(el);
        }
        if (path === this.path) return;
        this.events.unload(); this.events = new Component(); this.events.load();
        this.root?.remove(); this.root = null; this.path = path;
        if (!isStoryMap) return;
        const root = this.view.contentEl.createDiv({ cls: 'ert-story-navigator' });
        this.root = root;
        const label = root.createDiv({ cls: 'ert-story-navigator__label', text: t('ui.subplotCanvas.navigator') });
        const slider = root.createEl('input', { cls: 'ert-story-navigator__slider', attr: { type: 'range', min: '0', max: '0', value: '0' } });
        const selection = root.createEl('button', { cls: 'clickable-icon ert-story-navigator__fit' });
        selection.disabled = true;
        const fit = root.createEl('button', { cls: 'clickable-icon ert-story-navigator__fit' });
        setAccessibleLabel(slider, t('ui.subplotCanvas.navigator'));
        setTooltip(selection, t('ui.subplotCanvas.navigatorSelection'));
        setIcon(selection, 'zoom-to-selection');
        setTooltip(fit, t('ui.subplotCanvas.navigatorFit'));
        setIcon(fit, 'maximize');
        const canvas = (): Canvas | undefined => (this.view as unknown as { canvas?: Canvas }).canvas;
        const items = (): Array<{ data: NodeData; title: string }> => {
            const unique = new Map<string, NodeData>();
            for (const node of canvas()?.nodes?.values() ?? []) { // SAFE: Canvas internals are undocumented; no canvas or node map = no cards to list
                const data = node.getData?.();
                if (data?.type === 'file' && data.file && !unique.has(data.file)) unique.set(data.file, data);
            }
            return [...unique].flatMap(([path, data]) => {
                const scene = this.plugin.app.vault.getAbstractFileByPath(path);
                if (!(scene instanceof TFile)) return [];
                const row = buildTableRow(path, scene.basename, this.plugin.app.metadataCache.getFileCache(scene)?.frontmatter, this.plugin.settings);
                return row.kind === 'scene' ? [{ row, data, title: scene.basename }] : [];
            }).sort((a, b) => compareManuscriptRows(a.row, b.row));
        };
        let scenes: Array<{ data: NodeData; title: string }> = [];
        let cards: NodeData[] = [];
        let axis: ReturnType<typeof storyAxis> = null;
        let dragViewport: { x: number; y: number; zoom: number } | null = null;
        let lastLabel = '';
        let lastViewportCoordinate: number | null = null;
        const update = (navigate: boolean, rescan = false): void => {
            if (rescan || !scenes.length) {
                scenes = items(); cards = scenes.map(scene => scene.data); axis = storyAxis(cards);
                lastViewportCoordinate = null;
                slider.max = String(Math.max(0, (scenes.length - 1) * 100));
                slider.disabled = scenes.length === 0;
            }
            const point = storyPosition(cards, Number(slider.value) / 100);
            if (!point) return;
            const index = point.index;
            const scene = scenes[index];
            const nextLabel = `${t('ui.subplotCanvas.navigatorPosition', { current: index + 1, total: scenes.length })} · ${scene.title}`;
            if (nextLabel !== lastLabel) {
                label.setText(nextLabel);
                slider.setAttribute('aria-valuetext', scene.title);
                lastLabel = nextLabel;
            }
            if (!navigate) return;
            const view = canvas();
            if (!axis || !view?.setViewport || !Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) return;
            const viewport = dragViewport ?? { x: view.x!, y: view.y!, zoom: view.zoom! };
            const coordinate = point[axis.axis];
            view.setViewport(axis.axis === 'x' ? coordinate : viewport.x, axis.axis === 'y' ? coordinate : viewport.y, viewport.zoom);
        };
        const followViewport = (): void => {
            const selected = canvas()?.selection;
            selection.disabled = !(selected instanceof Set && selectedCanvasBounds([...selected].flatMap(node => node.getData?.() ?? []))); // SAFE: a node without the undocumented getData adds no bounds
            if (dragViewport || !axis) return;
            const view = canvas();
            const coordinate = view?.[axis.axis];
            if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate === lastViewportCoordinate) return;
            lastViewportCoordinate = coordinate;
            const position = storyProgress(cards, axis.axis, coordinate);
            if (position === null) return;
            const next = String(Math.round(position * 100));
            if (slider.value !== next) { slider.value = next; update(false); }
        };
        this.events.registerDomEvent(slider, 'pointerdown', () => {
            update(false, true);
            const view = canvas();
            dragViewport = view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.zoom)
                ? { x: view.x!, y: view.y!, zoom: view.zoom! } : null;
        });
        this.events.registerDomEvent(slider, 'pointerup', () => { if (dragViewport) update(true); dragViewport = null; });
        this.events.registerDomEvent(slider, 'pointercancel', () => { dragViewport = null; });
        this.events.registerDomEvent(slider, 'focus', () => { if (!dragViewport) update(false, true); });
        this.events.registerDomEvent(slider, 'input', () => update(true));
        this.events.registerDomEvent(selection, 'click', () => {
            const view = canvas();
            const selected = view?.selection;
            const bounds = selected instanceof Set ? selectedCanvasBounds([...selected].flatMap(node => node.getData?.() ?? [])) : null; // SAFE: a node without the undocumented getData adds no bounds
            if (bounds) view?.zoomToBbox?.(bounds);
        });
        this.events.registerDomEvent(fit, 'click', () => canvas()?.zoomToFit?.());
        this.events.registerInterval(window.setInterval(followViewport, 250));
        // The Canvas can still be loading when its view is first attached.
        window.setTimeout(() => { if (this.root === root) { update(false); followViewport(); } }, 500);
    }
    destroy(): void {
        this.events.unload(); this.root?.remove(); this.root = null;
        for (const [el, overlay] of this.actLabels) {
            overlay.remove(); el.removeClass('ert-story-act-heading', 'ert-story-act-heading--bold');
        }
        this.actLabels.clear();
    }
}
