import { Component, setIcon, TFile, type ItemView } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { buildTableRow, compareManuscriptRows } from './timetableModel';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { storyAxis, storyPosition } from './canvasNavigation';

type NodeData = { type?: string; file?: string; x?: number; y?: number; width?: number; height?: number };
type Canvas = { nodes?: Map<string, { getData?: () => NodeData }>; x?: number; y?: number; zoom?: number; setViewport?: (x: number, y: number, zoom: number) => void; zoomToFit?: () => void };

/** A navigator only for generated story maps; it does not alter the Canvas data. */
export class CanvasStoryNavigator {
    private root: HTMLElement | null = null;
    private path = '';
    private events = new Component();
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly view: ItemView) {}

    refresh(): void {
        const file = (this.view as unknown as { file?: TFile | null }).file;
        const path = file?.path ?? '';
        if (path === this.path) return;
        this.events.unload(); this.events = new Component(); this.events.load();
        this.root?.remove(); this.root = null; this.path = path;
        if (!path.startsWith('Radial Timeline/Story Maps/') || !path.endsWith('.canvas')) return;
        const root = this.view.contentEl.createDiv({ cls: 'ert-story-navigator' });
        this.root = root;
        const label = root.createDiv({ cls: 'ert-story-navigator__label', text: t('ui.subplotCanvas.navigator') });
        const slider = root.createEl('input', { cls: 'ert-story-navigator__slider', attr: { type: 'range', min: '0', max: '0', value: '0' } });
        const fit = root.createEl('button', { cls: 'clickable-icon ert-story-navigator__fit' });
        setAccessibleLabel(slider, t('ui.subplotCanvas.navigator'));
        setTooltip(fit, t('ui.subplotCanvas.navigatorFit'));
        setIcon(fit, 'maximize');
        const canvas = (): Canvas | undefined => (this.view as unknown as { canvas?: Canvas }).canvas;
        const items = (): Array<{ data: NodeData; title: string }> => {
            const unique = new Map<string, NodeData>();
            for (const node of canvas()?.nodes?.values() ?? []) {
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
        let dragViewport: { x: number; y: number; zoom: number; value: number } | null = null;
        const update = (navigate: boolean, rescan = false): void => {
            if (rescan || !scenes.length) { scenes = items(); cards = scenes.map(scene => scene.data); axis = storyAxis(cards); }
            slider.max = String(Math.max(0, (scenes.length - 1) * 100));
            slider.disabled = scenes.length === 0;
            const point = storyPosition(cards, Number(slider.value) / 100);
            if (!point) return;
            const index = point.index;
            const scene = scenes[index];
            label.setText(`${t('ui.subplotCanvas.navigatorPosition', { current: index + 1, total: scenes.length })} · ${scene.title}`);
            slider.setAttribute('aria-valuetext', scene.title);
            if (!navigate) return;
            const view = canvas();
            if (!axis || !view?.setViewport || !Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) return;
            const viewport = dragViewport ?? { x: view.x!, y: view.y!, zoom: view.zoom! };
            const fraction = Number(slider.value) / Math.max(1, Number(slider.max));
            const coordinate = dragViewport
                ? dragViewport[axis.axis] + (Number(slider.value) - dragViewport.value) / Math.max(1, Number(slider.max)) * (axis.max - axis.min)
                : axis.min + (axis.max - axis.min) * fraction;
            view.setViewport(axis.axis === 'x' ? coordinate : viewport.x, axis.axis === 'y' ? coordinate : viewport.y, viewport.zoom);
        };
        this.events.registerDomEvent(slider, 'pointerdown', () => {
            update(false, true);
            const view = canvas();
            dragViewport = view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.zoom)
                ? { x: view.x!, y: view.y!, zoom: view.zoom!, value: Number(slider.value) } : null;
        });
        this.events.registerDomEvent(slider, 'pointerup', () => { dragViewport = null; });
        this.events.registerDomEvent(slider, 'pointercancel', () => { dragViewport = null; });
        this.events.registerDomEvent(slider, 'focus', () => update(false, true));
        this.events.registerDomEvent(slider, 'input', () => update(true));
        this.events.registerDomEvent(fit, 'click', () => canvas()?.zoomToFit?.());
        // The Canvas can still be loading when its view is first attached.
        window.setTimeout(() => { if (this.root === root) update(false); }, 500);
    }
    destroy(): void { this.events.unload(); this.root?.remove(); this.root = null; }
}
