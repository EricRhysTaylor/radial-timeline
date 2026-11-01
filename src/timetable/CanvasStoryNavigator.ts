import { Component, setIcon, TFile, type ItemView } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { buildTableRow, compareManuscriptRows } from './timetableModel';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';

type NodeData = { type?: string; file?: string; x?: number; y?: number; width?: number; height?: number };
type Canvas = { nodes?: Map<string, { getData?: () => NodeData }>; zoomToBbox?: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void; zoomToFit?: () => void };

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
        const update = (navigate: boolean, rescan = false): void => {
            if (rescan || !scenes.length) scenes = items();
            slider.max = String(Math.max(0, scenes.length - 1));
            slider.disabled = scenes.length === 0;
            const index = Math.min(Number(slider.value), scenes.length - 1);
            if (index < 0) return;
            const scene = scenes[index];
            label.setText(`${t('ui.subplotCanvas.navigatorPosition', { current: index + 1, total: scenes.length })} · ${scene.title}`);
            slider.setAttribute('aria-valuetext', scene.title);
            if (!navigate) return;
            const { x, y, width, height } = scene.data;
            if ([x, y, width, height].some(n => typeof n !== 'number' || !Number.isFinite(n))) return;
            const cx = x! + width! / 2, cy = y! + height! / 2;
            canvas()?.zoomToBbox?.({ minX: cx - 650, maxX: cx + 650, minY: cy - 350, maxY: cy + 350 });
        };
        this.events.registerDomEvent(slider, 'pointerdown', () => update(false, true));
        this.events.registerDomEvent(slider, 'focus', () => update(false, true));
        this.events.registerDomEvent(slider, 'input', () => update(true));
        this.events.registerDomEvent(fit, 'click', () => canvas()?.zoomToFit?.());
        // The Canvas can still be loading when its view is first attached.
        window.setTimeout(() => { if (this.root === root) update(false); }, 500);
    }
    destroy(): void { this.events.unload(); this.root?.remove(); this.root = null; }
}
