import { Component, setIcon, TFile, type ItemView } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { buildTableRow, compareManuscriptRows } from './timetableModel';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { isStoryActHeading, selectedCanvasBounds, storyActHeadingLabel, storyAxis, storyKeyStep, storyPosition, storyProgress } from './canvasNavigation';
import { placeKeyPanel, renderLegendSurface, wireLegendTrigger, type LegendSection } from '../view/interactions/LegendPanel';
import { readSubplotColorHex, readSubplotColorValue, subplotColorCss, SUBPLOT_COLOR_SLOTS, type SubplotColor } from '../renderer/utils/subplotColors';
import { getActiveBook } from '../utils/books';
import { getMainPlotName } from '../utils/mainPlot';
import { cardColor } from './canvasCardSubplots';

type NodeData = { type?: string; file?: string; text?: string; x?: number; y?: number; width?: number; height?: number };
type CanvasColor = string | undefined;
type Canvas = { nodes?: Map<string, { nodeEl?: HTMLElement; getData?: () => NodeData }>; selection?: Set<{ getData?: () => NodeData & { color?: CanvasColor }; setColor?: (color: string) => void }>; requestSave?: () => void; x?: number; y?: number; zoom?: number; setViewport?: (x: number, y: number, zoom: number) => void; zoomToFit?: () => void; zoomToBbox?: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void };

/**
 * The Radial Timeline bar on a Canvas. Generated story maps get the scene
 * slider; any map gets the Settings swatches while text cards are selected,
 * and the key to how a map becomes a timeline.
 */
export class CanvasStoryNavigator {
    private root: HTMLElement | null = null;
    private colors: HTMLElement | null = null;
    /** The palette slots, then a swatch for each of the active book's subplots that wears its own color. */
    private swatches: Array<{ el: HTMLButtonElement; color: SubplotColor }> = [];
    private path = '';
    private storyMap = false;
    private hasBookCards = false;
    private events = new Component();
    private readonly actLabels = new Map<HTMLElement, HTMLElement>();
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly view: ItemView, private readonly ringColors: (bookId: string) => Promise<Map<string, SubplotColor>>) {}

    private canvas(): Canvas | undefined { return (this.view as unknown as { canvas?: Canvas }).canvas; }

    /** The selected cards a color can mean something on: ideas, never Act cards or linked notes. */
    private selectedIdeas() {
        const selected = this.canvas()?.selection;
        return selected instanceof Set ? [...selected].filter(node => {
            const data = node.getData?.();
            return data?.type === 'text' && !(typeof data.text === 'string' && isStoryActHeading(data.text)); // SAFE: a card with no text is no heading
        }) : [];
    }

    private paint(color: SubplotColor): void {
        const value = readSubplotColorHex(this.view.containerEl.doc, color);
        for (const node of this.selectedIdeas()) node.setColor?.(value);
        this.canvas()?.requestSave?.();
        this.updateBar();
    }

    private addSwatch(strip: HTMLElement, color: SubplotColor): HTMLButtonElement {
        const el = strip.createEl('button', { cls: 'ert-story-navigator__swatch', attr: { type: 'button' } });
        el.setCssProps({ '--ert-story-swatch': subplotColorCss(color) });
        el.addEventListener('click', () => this.paint(color)); // SAFE: the listener lives and goes with its swatch
        this.swatches.push({ el, color });
        return el;
    }

    /**
     * Swatches read as Settings does: Main Plot, then the book's rings that
     * wear palette colors, then the free ring numbers. A subplot with its own
     * color follows with a swatch of that color, so cards painted with it
     * join that subplot.
     */
    private async labelSwatches(): Promise<void> {
        const book = getActiveBook(this.plugin.settings);
        const rings = book ? await this.ringColors(book.id) : new Map<string, SubplotColor>();
        if (!this.colors) return;
        const names = new Map<number, string>();
        for (const [name, color] of rings) if (color.kind === 'slot') names.set(color.slot, name);
        this.swatches = this.swatches.filter(swatch => {
            if (swatch.color.kind === 'slot') return true;
            swatch.el.remove();
            return false;
        });
        for (const [name, color] of rings) {
            if (color.kind === 'own') this.addSwatch(this.colors, color).dataset.subplot = name;
        }
        for (const { el, color } of this.swatches) {
            const label = color.kind === 'own'
                ? el.dataset.subplot ?? '' // SAFE: every own-color swatch is stamped with its subplot just above
                : names.get(color.slot) ?? (color.slot === 0 ? getMainPlotName() : t('ui.colorsSection.ringLabel', { number: color.slot + 1 }));
            setAccessibleLabel(el, label);
            setTooltip(el, label);
        }
    }

    private updateBar(): void {
        if (!this.root || !this.colors) return;
        const ideas = this.selectedIdeas();
        const coloring = ideas.length > 0;
        if (coloring && this.colors.isShown() === false) this.labelSwatches().catch((error: unknown) => console.error('[Canvas] Could not label ring swatches', error));
        this.colors.toggle(coloring);
        this.root.toggle(this.plugin.settings.books.some(book => book.sourceFolder.trim()) && (this.storyMap || this.hasBookCards || coloring));
        const colors = new Set(ideas.map(node => cardColor(node.getData?.() ?? {}) ?? undefined)); // SAFE: no data or no color = uncolored
        const shared = colors.size === 1 ? [...colors][0] : undefined;
        this.swatches.forEach(({ el, color }) => el.toggleClass('is-active', !!shared && shared === readSubplotColorValue(this.view.containerEl.doc, color).toLowerCase()));
    }

    private mountColors(root: HTMLElement): void {
        const strip = root.createDiv({ cls: 'ert-story-navigator__colors' });
        this.colors = strip;
        strip.hide();
        this.swatches = [];
        for (let slot = 0; slot < SUBPLOT_COLOR_SLOTS; slot++) this.addSwatch(strip, { kind: 'slot', slot });
    }

    private keySections(): LegendSection[] {
        return [
            {
                title: t('ui.canvasSketch.keyWorkflow'),
                rows: [
                    { icon: 'square-dashed', label: t('ui.canvasSketch.keySelect'), detail: t('ui.canvasSketch.keySelectDetail') },
                    { icon: 'palette', label: t('ui.canvasSketch.keyColor'), detail: t('ui.canvasSketch.keyColorDetail') },
                    { icon: 'book-open', label: t('ui.canvasSketch.keyActs'), detail: t('ui.canvasSketch.keyActsDetail') },
                    { icon: 'pencil-line', label: t('ui.canvasSketch.keyConvert'), detail: t('ui.canvasSketch.keyConvertDetail') },
                ],
            },
            {
                title: t('ui.canvasSketch.keyMap'),
                rows: [
                    { dot: 'var(--rt-subplot-colors-1)', label: t('ui.canvasSketch.keyEdge'), detail: t('ui.canvasSketch.keyEdgeDetail') },
                    { icon: 'layout-template', label: t('ui.canvasSketch.cardViews'), detail: t('ui.canvasSketch.keyCardViewDetail') },
                    { icon: 'arrow-big-up', label: t('ui.canvasSketch.keyHover'), detail: t('ui.canvasSketch.keyHoverDetail') },
                    ...(this.storyMap ? [
                        { icon: 'zoom-to-selection', label: t('ui.subplotCanvas.navigatorSelection') },
                        { icon: 'maximize', label: t('ui.subplotCanvas.navigatorFit') },
                    ] : []),
                ],
            },
        ];
    }

    private mountKey(root: HTMLElement): void {
        const button = root.createEl('button', {
            cls: 'ert-timeline-legend__trigger ert-story-navigator__key clickable-icon',
            // No aria-label: Obsidian would show it as a second tooltip over the key panel.
            attr: { type: 'button', 'aria-expanded': 'false' },
        });
        setIcon(button, 'asterisk');
        const panel = root.doc.body.createDiv({ cls: 'ert-timeline-legend ert-timeline-legend--compact ert-timetable-key', attr: { role: 'tooltip' } });
        this.events.register(() => panel.remove());
        wireLegendTrigger(this.events, button, panel, () => {
            renderLegendSurface(panel, { title: t('ui.canvasSketch.keyTitle'), badge: t('ui.canvasSketch.badge'), sections: this.keySections() });
            placeKeyPanel(button, panel);
        }, this.plugin.app.workspace);
    }

    refresh(hasBookCards: boolean): void {
        this.hasBookCards = hasBookCards;
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
        if (path !== this.path) {
            this.events.unload(); this.events = new Component(); this.events.load();
            this.root?.remove(); this.path = path; this.storyMap = isStoryMap;
            const root = this.view.contentEl.createDiv({ cls: 'ert-story-navigator' });
            root.toggleClass('is-story-map', isStoryMap);
            this.root = root;
            if (isStoryMap) this.mountNavigation(root);
            this.mountColors(root);
            this.mountKey(root);
            this.events.registerInterval(window.setInterval(() => this.updateBar(), 250));
        }
        this.updateBar();
    }

    /** The scene slider and zoom buttons of a generated story map. */
    private mountNavigation(root: HTMLElement): void {
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
        const canvas = (): Canvas | undefined => this.canvas();
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
        this.events.registerDomEvent(slider, 'keydown', (event: KeyboardEvent) => {
            const next = storyKeyStep(Number(slider.value), Number(slider.max), event.key);
            if (next === null) return;
            event.preventDefault();
            slider.value = String(next);
            update(true);
        });
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
        this.events.unload(); this.root?.remove(); this.root = null; this.colors = null;
        for (const [el, overlay] of this.actLabels) {
            overlay.remove(); el.removeClass('ert-story-act-heading', 'ert-story-act-heading--bold');
        }
        this.actLabels.clear();
    }
}
