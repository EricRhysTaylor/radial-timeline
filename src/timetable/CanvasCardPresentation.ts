import { Component, getFrontMatterInfo, ItemView, Menu, setIcon, TFile, type Events, type View } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { authorKeyFor } from './timetableFiles';
import { synopsisKey } from './panelSynopsis';
import { t } from '../i18n';
import { bookCardFor, bookRingColors } from './canvasBookCards';
import { markTimetableRows, onLinkedScene } from './timetableRegistry';
import { CanvasStoryNavigator } from './CanvasStoryNavigator';
import { linkedSceneViewport } from './canvasNavigation';
import { buildTableRow, sceneVitals } from './timetableModel';
import { SUBPLOT_COLORS_CHANGED_EVENT, subplotColorCss, type SubplotColor } from '../renderer/utils/subplotColors';
import { cardSubplots } from './canvasCardSubplots';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { panelPlaceImage, panelSceneImage } from './panelPlaceImage';
import { coverPosition } from './panelFocus';
import {
    addStoryCardImageMenu, cardImages, STORY_IMAGES_CHANGED_EVENT, storyCardImages, storyImageFocus, storyImageStrategy,
    type CardImage, type PlaceTextBacking,
} from './storyCardImages';
import { imageSubjectName } from './storyImageMatching';
import { storyCharacterSelections } from './storyImageSelection';
import { explicitCardImage, showStoryImageMenu } from './storyImageMenu';
import { storyImageChoice } from './storyImageStore';
import { resolveStoryPortrait } from './storyPortrait';
import { outlineReferenceType, type OutlineReferenceType } from './outlineDocuments';
import { getActiveBook } from '../utils/books';
import { addSubplotColorMenu, ideaCards, type CanvasCardNode } from './CanvasSubplotMenu';
import { addMenuChoices } from './menuChoices';

type Mode = 'full' | 'preview' | 'title';
const CARD_ICONS: Record<OutlineReferenceType, string> = {
    scene: 'clapperboard', sketch: 'pencil', outline: 'list-tree', character: 'user-round', place: 'map-pin', note: 'notebook-pen',
};
type NodeData = { type?: string; file?: string; subpath?: string; label?: string; x?: number; y?: number; width?: number; height?: number };
type CanvasNode = { nodeEl?: HTMLElement; getData?: () => NodeData };
type CanvasView = View & { canvas?: { nodes?: Map<string, CanvasNode>; x?: number; y?: number; zoom?: number; setViewport?: (x: number, y: number, zoom: number) => void } };

function plainText(text: string): string {
    return text.replace(/!\[\[[^\]]+\]\]/g, '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s*#{1,6}\s+/gm, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
}

function portrait(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown>, imageFiles: readonly TFile[], selected: string | undefined): CardImage | null {
    const characters = readFrontmatterProperty(fm, authorKeyFor('Character', plugin.settings));
    const first: unknown = Array.isArray(characters) ? (characters.find(value => imageSubjectName(value) === selected) ?? characters[0]) : characters;
    if (typeof first !== 'string' || !first.trim()) return null;
    const image = resolveStoryPortrait(plugin.app, file.path, first, imageFiles);
    return image ? { url: plugin.app.vault.getResourcePath(image), path: image.path } : null;
}

/** The veil over a place background, near and far edges, for each Background treatment (Panels' text backing). */
const VEILS: Record<PlaceTextBacking, [string, string]> = { subtle: ['84%', '58%'], balanced: ['92%', '72%'], strong: ['96%', '86%'] };

class CanvasCards {
    private mode: Mode = 'preview';
    private hasBookCards = false;
    private readonly cards = new Map<HTMLElement, { overlay: HTMLElement; signature: string; cleanup: Array<() => void> }>();
    private observer: MutationObserver;
    private timer: number | undefined;
    private revision = 0;
    private stopped = false;
    private showOverdue = true;
    private followTimeline = true;
    private followTimer: number | undefined;
    private timelinePinned = false;
    private readonly ringColors = new Map<string, Promise<Map<string, SubplotColor>>>();
    /** The same ring colors once read, for the card menu, which cannot wait. */
    private readonly settledRingColors = new Map<string, Map<string, SubplotColor>>();
    readonly action: HTMLElement;
    private readonly unlink: () => void;
    private readonly events = new Component();
    private readonly navigator: CanvasStoryNavigator;

    constructor(private plugin: RadialTimelinePlugin, private view: ItemView) {
        this.navigator = new CanvasStoryNavigator(plugin, view);
        // The card image groups are the Timetable Panels menu's own (storyCardImages), and so are their settings.
        this.action = view.addAction('image', t('ui.canvasSketch.cardViews'), () => {
            const menu = new Menu().setUseNativeMenu(false);
            const modes: Array<[Mode, string]> = [
                ['preview', t('ui.canvasSketch.cardPreview')], ['title', t('ui.canvasSketch.cardTitle')], ['full', t('ui.canvasSketch.cardFull')],
            ];
            addMenuChoices(menu, t('ui.canvasSketch.menuCardContent'), modes.map(([mode, label]) => ({
                label, checked: this.mode === mode, run: () => { this.mode = mode; this.schedule(); },
            })));
            addStoryCardImageMenu(menu, this.plugin);
            addMenuChoices(menu, t('ui.canvasSketch.menuTimeline'), [
                { label: t('ui.canvasSketch.showOverdue'), checked: this.showOverdue, run: () => { this.showOverdue = !this.showOverdue; this.schedule(); } },
                { label: t('ui.canvasSketch.followTimeline'), checked: this.followTimeline, run: () => {
                    this.followTimeline = !this.followTimeline;
                    if (this.followTimer) window.clearTimeout(this.followTimer);
                } },
            ]);
            const rect = this.action.getBoundingClientRect();
            menu.showAtPosition({ x: rect.right, y: rect.bottom, width: rect.width, left: true }, this.action.ownerDocument);
        });
        this.action.hide();
        this.unlink = onLinkedScene((path, color, source) => {
            if (source === 'timeline' || (source === 'other' && this.timelinePinned)) return;
            if (source === 'timeline-pin') this.timelinePinned = true;
            if (this.followTimer) window.clearTimeout(this.followTimer);
            const canvas = (this.view as CanvasView).canvas;
            const nodes = canvas?.nodes;
            if (!(nodes instanceof Map)) return;
            const matches: NodeData[] = [];
            for (const node of nodes.values()) {
                const data = node.getData?.();
                const linked = !!path && data?.type === 'file' && data.file === path;
                node.nodeEl?.toggleClass('ert-canvas-linked', linked);
                if (linked) {
                    matches.push(data);
                    if (node.nodeEl) {
                        if (color) node.nodeEl.style.setProperty('--ert-canvas-linked-color', color);
                        else node.nodeEl.style.removeProperty('--ert-canvas-linked-color');
                    }
                }
            }
            if (source !== 'timeline-pin' || !path || !this.followTimeline || !matches.length) return;
            this.followTimer = window.setTimeout(() => {
                if (!canvas?.setViewport || !Number.isFinite(canvas.x) || !Number.isFinite(canvas.y) || !Number.isFinite(canvas.zoom)) return;
                const target = linkedSceneViewport(matches, { x: canvas.x!, y: canvas.y!, zoom: canvas.zoom! });
                if (target) canvas.setViewport(target.x, target.y, target.zoom);
            }, 350);
        });
        this.events.load();
        this.events.registerDomEvent(view.containerEl.win, STORY_IMAGES_CHANGED_EVENT, () => this.schedule());
        this.events.registerDomEvent(view.containerEl.win, SUBPLOT_COLORS_CHANGED_EVENT, () => this.invalidateColors());
        this.events.registerDomEvent(view.containerEl, 'click', event => {
            if (!this.hasBookCards || !(event.target instanceof Element)) return;
            const nodes = (this.view as CanvasView).canvas?.nodes;
            if (!(nodes instanceof Map)) return;
            for (const node of nodes.values()) {
                if (!node.nodeEl?.contains(event.target)) continue;
                const data = node.getData?.();
                const path = data?.type === 'file' ? data.file : undefined;
                const color = path ? this.plugin.highlightSceneOnTimeline(path) : null;
                this.timelinePinned = false;
                markTimetableRows(path ?? null, color, true);
                break;
            }
        });
        this.observer = new MutationObserver(mutations => {
            if (mutations.some(mutation => !mutation.target.instanceOf(Element) || !mutation.target.closest('.ert-story-navigator'))) this.schedule();
        });
        this.observer.observe(view.containerEl, { childList: true, subtree: true });
        this.schedule();
    }

    schedule(): void {
        if (this.stopped || this.timer) return;
        this.timer = window.setTimeout(() => { this.timer = undefined; void this.refresh(); }, 80);
    }

    invalidateColors(): void { this.ringColors.clear(); this.settledRingColors.clear(); this.schedule(); }

    private colorsForBook(bookId: string): Promise<Map<string, SubplotColor>> {
        const existing = this.ringColors.get(bookId);
        if (existing) return existing;
        const book = this.plugin.settings.books.find(item => item.id === bookId);
        const pending = book ? bookRingColors(this.plugin, book) : Promise.resolve(new Map<string, SubplotColor>());
        this.ringColors.set(bookId, pending);
        pending.then(colors => {
            if (this.ringColors.get(bookId) === pending) this.settledRingColors.set(bookId, colors);
        }).catch((error: unknown) => console.error('[Canvas] Could not read the book’s ring colors', error));
        return pending;
    }

    /** The view this controller presents. */
    get canvasView(): ItemView { return this.view; }

    /**
     * A book's ring colors when they are already read, for menus that must be
     * built at once. Undefined while they are still being read; the read is
     * started so the next menu has them.
     */
    ringColorsNow(bookId: string): Map<string, SubplotColor> | undefined {
        const settled = this.settledRingColors.get(bookId);
        if (!settled) void this.colorsForBook(bookId);
        return settled;
    }

    private remove(node: HTMLElement): void {
        const card = this.cards.get(node);
        card?.cleanup.forEach(stop => stop());
        card?.overlay.remove();
        this.cards.delete(node);
        node.removeClass('ert-canvas-story-node');
    }

    private bookCards(): Array<{ data: NodeData; el: HTMLElement; file: TFile; bookId: string }> {
        const nodes = (this.view as CanvasView).canvas?.nodes;
        if (!(nodes instanceof Map)) return [];
        return [...nodes.values()].flatMap(node => {
            const data = node.getData?.();
            const card = bookCardFor(this.plugin.settings.books, data);
            const file = card && this.plugin.app.vault.getAbstractFileByPath(card.path);
            return data && node.nodeEl && card && file instanceof TFile ? [{ data, el: node.nodeEl, file, bookId: card.bookId }] : [];
        });
    }

    private async refresh(): Promise<void> {
        const revision = ++this.revision;
        const imageFiles = this.plugin.app.vault.getFiles();
        const nodes = (this.view as CanvasView).canvas?.nodes;
        const bookCards = this.bookCards();
        this.navigator.refresh(bookCards.length > 0);
        // The card menu lists the active book's subplots the moment it opens,
        // so they are read ahead on a Canvas with idea cards to color.
        const activeBook = getActiveBook(this.plugin.settings);
        if (activeBook?.sourceFolder.trim() && nodes instanceof Map && ideaCards(nodes.values()).length > 0) this.ringColorsNow(activeBook.id);
        const imageSelections = bookCards.length ? storyCharacterSelections(this.plugin, imageFiles, storyImageStrategy(this.plugin.settings), new Set(bookCards.map(card => card.bookId))) : new Map<string, string>();
        const cardSettings = storyCardImages(this.plugin.settings);
        this.hasBookCards = bookCards.length > 0;
        this.action.toggle(this.hasBookCards);
        this.view.containerEl.toggleClass('ert-canvas-card-view', this.hasBookCards && this.mode !== 'full');
        const keep = new Set<HTMLElement>();
        if (this.mode !== 'full' && nodes instanceof Map) {
            const groups = [...nodes.values()].map(node => node.getData?.()).filter((data): data is NodeData => data?.type === 'group');
            for (const { data, el, file, bookId } of bookCards) {
                keep.add(el);
                const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {}; // SAFE: a note without YAML has no cached frontmatter; empty = no properties
                const kindValue = readFrontmatterProperty(fm, authorKeyFor('Class', this.plugin.settings));
                const kind = typeof kindValue === 'string' ? kindValue.trim() : t('ui.canvasSketch.cardLabel');
                const row = buildTableRow(file.path, file.basename, fm, this.plugin.settings);
                const overrideImage = explicitCardImage(this.plugin, file);
                const choice = storyImageChoice(this.plugin, file.path);
                const selected = choice.character ?? imageSelections.get(file.path);
                const chosenImage: CardImage | null = overrideImage ? { url: this.plugin.app.vault.getResourcePath(overrideImage), path: overrideImage.path } : null;
                const story = row.kind === 'scene' || row.kind === 'sketch';
                const combination = cardSettings.combination;
                const place = story && (combination === 'place' || combination === 'combined' || combination === 'layered') && (row.kind === 'scene' || !!choice.placeImage || !!readFrontmatterProperty(fm, 'Place image'))
                    ? panelPlaceImage(this.plugin.app, file, fm, authorKeyFor('Place', this.plugin.settings), imageFiles, choice.placeImage) : null;
                const artwork = (combination === 'artwork' || combination === 'combined') && row.kind === 'scene' ? panelSceneImage(this.plugin.app, file, fm) : null;
                const castValue = readFrontmatterProperty(fm, authorKeyFor('Character', this.plugin.settings));
                const hasCharacters = (Array.isArray(castValue) ? castValue : [castValue]).some(name => typeof name === 'string' && name.trim().length > 0);
                const shown = story ? cardImages(combination, row.kind === 'sketch' ? 'sketch' : 'scene', {
                    character: chosenImage ?? (row.kind === 'scene' ? portrait(this.plugin, file, fm, imageFiles, selected) : null),
                    place, artwork, hasCharacters, chosen: !!overrideImage,
                }) : null;
                const focusOf = (image: CardImage | null | undefined) => image ? storyImageFocus(this.plugin.settings, image.path) : null;
                const ringColors = row.kind === 'scene' || row.kind === 'sketch' ? await this.colorsForBook(bookId) : new Map<string, SubplotColor>();
                const subplotNames = row.subplots.filter(name => ringColors.has(name));
                const colorOf = (name: string): string => subplotColorCss(ringColors.get(name)!); // SAFE: subplotNames keeps only names the book's rings hold
                const shownSubplots = cardSubplots(data, groups, subplotNames);
                const overdue = this.showOverdue && row.kind === 'scene' && sceneVitals(fm, this.plugin.settings, new Date()).due.kind === 'late';
                let preview = '';
                if (this.mode === 'preview') {
                    if (typeof kindValue === 'string' && kindValue.trim().toLowerCase() === 'scene') {
                        const synopsis: unknown = fm[synopsisKey(fm, this.plugin.settings)];
                        preview = typeof synopsis === 'string' ? synopsis : '';
                    } else {
                        const content = await this.plugin.app.vault.cachedRead(file);
                        const info = getFrontMatterInfo(content);
                        preview = content.slice(info.exists ? info.contentStart : 0).trim();
                        const firstLine = preview.split('\n')[0]?.replace(/^\s*#+\s*/, '').trim();
                        if (firstLine === file.basename) preview = preview.includes('\n') ? preview.slice(preview.indexOf('\n') + 1) : '';
                    }
                }
                if (this.stopped || revision !== this.revision) return;
                const title = file.basename.replace(/^\d+(?:\.\d+)?\s+/, '');
                const description = plainText(preview);
                const number = row.kind === 'scene' ? row.prefix : null;
                const signature = JSON.stringify([this.mode, title, kind, number, cardSettings, shown, chosenImage?.url, [shown?.cover, shown?.companion, shown?.backdrop].map(focusOf), selected, choice, description, file.path, shownSubplots.map(name => [name, colorOf(name)]), overdue]);
                const existing = this.cards.get(el);
                if (existing?.signature === signature && el.contains(existing.overlay)) continue;
                this.remove(el);
                const cardType = outlineReferenceType(kind);
                const overlay = el.createDiv({ cls: `ert-canvas-story-card${cardType === 'sketch' ? ' is-sketch' : ''}` });
                const cleanup: Array<() => void> = [];
                if (row.kind === 'scene' || row.kind === 'sketch') {
                    const imageOptions = overlay.createEl('button', { cls: 'ert-canvas-story-card__image-menu', attr: { type: 'button' } });
                    setAccessibleLabel(imageOptions, t('ui.timetable.storyImageChoose'));
                    setIcon(imageOptions, 'image-plus');
                    setTooltip(imageOptions, t('ui.timetable.storyImageChoose'));
                    imageOptions.onclick = event => { event.stopPropagation(); showStoryImageMenu(this.plugin, file, fm, imageFiles, event, () => this.schedule(), selected ?? undefined); };
                    imageOptions.onpointerdown = event => event.stopPropagation();
                }
                const backdropImage = shown?.backdrop;
                if (backdropImage) {
                    overlay.addClass('has-place-background');
                    const [near, far] = VEILS[cardSettings.backing];
                    overlay.setCssProps({ '--ert-canvas-veil-near': near, '--ert-canvas-veil-far': far });
                    const backdrop = overlay.createDiv({ cls: 'ert-canvas-story-card__backdrop', attr: { 'aria-hidden': 'true' } });
                    const backdropEl = backdrop.createEl('img', { attr: { src: backdropImage.url, alt: '', draggable: 'false' } });
                    const placeFocus = storyImageFocus(this.plugin.settings, backdropImage.path);
                    backdropEl.setCssProps({ '--ert-place-focus-x': `${placeFocus.x * 100}%`, '--ert-place-focus-y': `${placeFocus.y * 100}%` });
                    this.events.registerDomEvent(backdropEl, 'error', () => { backdrop.remove(); overlay.removeClass('has-place-background'); });
                }
                if (cardSettings.portraitShape === 'landscape') overlay.addClass('has-landscape-portrait');
                const header = overlay.createDiv({ cls: 'ert-canvas-story-card__header' });
                // One tile per image, cropped at its shared focus point (a Fill crop) or shown whole (Fit).
                const tile = (image: CardImage | null | undefined, icon: string) => {
                    const art = header.createDiv({ cls: 'ert-canvas-story-card__art' });
                    if (!image) { setIcon(art, icon); return; }
                    const img = art.createEl('img', { attr: { src: image.url, alt: '' } });
                    img.toggleClass('is-fit', cardSettings.fit === 'fit');
                    this.events.registerDomEvent(img, 'error', () => { img.remove(); setIcon(art, icon); });
                    if (cardSettings.fit !== 'fill') return;
                    const point = storyImageFocus(this.plugin.settings, image.path);
                    // Layout sizes, not screen sizes: the Canvas zoom scales the card without changing them.
                    const position = () => {
                        const at = coverPosition(img.clientWidth, img.clientHeight, img.naturalWidth, img.naturalHeight, point);
                        img.setCssProps({ '--ert-image-x': `${at.x}px`, '--ert-image-y': `${at.y}px` });
                    };
                    this.events.registerDomEvent(img, 'load', position);
                    const resize = new ResizeObserver(position);
                    resize.observe(img);
                    cleanup.push(() => resize.disconnect());
                    if (img.complete) position();
                };
                if (!shown) tile(chosenImage, CARD_ICONS[cardType]);
                else if (shown.showCover) {
                    tile(shown.cover, shown.placeholderIcon);
                    if (shown.companion) tile(shown.companion, 'user-round');
                }
                const heading = header.createDiv({ cls: 'ert-canvas-story-card__heading' });
                const meta = heading.createDiv({ cls: 'ert-canvas-story-card__meta' });
                if (shownSubplots.length) {
                    overlay.setCssProps({ '--ert-canvas-subplot': colorOf(shownSubplots[0]) });
                    overlay.addClass('has-subplot');
                    const markers = meta.createDiv({ cls: 'ert-canvas-story-card__subplots' });
                    for (const name of shownSubplots.slice(0, 3)) {
                        const marker = markers.createSpan({ cls: 'ert-canvas-story-card__subplot' });
                        setTooltip(marker, name);
                        marker.setCssProps({ '--ert-canvas-subplot': colorOf(name) });
                    }
                    if (shownSubplots.length > 3) {
                        const more = markers.createSpan({ cls: 'ert-canvas-story-card__subplot-more', text: `+${shownSubplots.length - 3}` });
                        setTooltip(more, shownSubplots.slice(3).join(', '));
                    }
                }
                if (kind) meta.createDiv({ cls: 'ert-canvas-story-card__kind', text: number ? `${kind} ${number}` : kind });
                heading.createDiv({ cls: 'ert-canvas-story-card__title', text: title });
                if (overdue) {
                    const badge = overlay.createDiv({ cls: 'ert-canvas-story-card__overdue' });
                    setTooltip(badge, t('ui.timetable.keyOverdueDetail'));
                    setIcon(badge, 'calendar-x');
                    badge.createSpan({ text: t('ui.timetable.statusOverdue') });
                }
                if (this.mode === 'preview' && description) overlay.createDiv({ cls: 'ert-canvas-story-card__preview', text: description });
                el.addClass('ert-canvas-story-node');
                this.cards.set(el, { overlay, signature, cleanup });
            }
        }
        if (revision !== this.revision) return;
        for (const el of this.cards.keys()) if (!keep.has(el)) this.remove(el);
    }

    destroy(): void {
        this.stopped = true;
        this.revision++;
        if (this.timer) window.clearTimeout(this.timer);
        if (this.followTimer) window.clearTimeout(this.followTimer);
        this.observer.disconnect();
        this.unlink();
        this.events.unload();
        this.navigator.destroy();
        this.view.containerEl.removeClass('ert-canvas-card-view');
        for (const el of this.cards.keys()) this.remove(el);
        this.action.remove();
    }
}

export function registerCanvasCardPresentation(plugin: RadialTimelinePlugin): void {
    const controllers = new Map<View, CanvasCards>();
    let running = true;
    const refresh = (): void => {
        if (!running) return;
        const open = new Set<View>();
        plugin.app.workspace.iterateAllLeaves(leaf => {
            const view = leaf.view;
            if (!(view instanceof ItemView) || view.getViewType() !== 'canvas') return;
            open.add(view);
            const existing = controllers.get(view);
            if (existing && view.containerEl.contains(existing.action)) { existing.schedule(); return; }
            existing?.destroy();
            controllers.set(view, new CanvasCards(plugin, view));
        });
        for (const [view, controller] of controllers) if (!open.has(view)) { controller.destroy(); controllers.delete(view); }
    };
    const workspace = plugin.app.workspace;
    plugin.registerEvent(workspace.on('layout-change', refresh));
    plugin.registerEvent(workspace.on('active-leaf-change', refresh));
    plugin.registerEvent(workspace.on('file-open', refresh));
    plugin.registerEvent(plugin.app.metadataCache.on('changed', () => { for (const controller of controllers.values()) controller.invalidateColors(); refresh(); }));
    // Radial Timeline: Color by subplot, on one card or a selection. Canvas
    // passes its own (undocumented) node and canvas objects.
    const menuFor = (menu: unknown, canvas: unknown, nodes: () => Iterable<CanvasCardNode>): void => {
        if (!(menu instanceof Menu) || !canvas) return;
        const controller = [...controllers.values()].find(candidate => (candidate.canvasView as CanvasView).canvas === canvas);
        if (!controller) return;
        addSubplotColorMenu(menu, {
            plugin,
            view: controller.canvasView,
            // Its methods are optional in CanvasForMenu, and each use checks for them.
            canvas,
            ringsNow: bookId => controller.ringColorsNow(bookId),
        }, nodes());
    };
    const canvasEvents: Events = workspace; // Canvas menu events are not in Workspace's typed event list.
    plugin.registerEvent(canvasEvents.on('canvas:node-menu', (menu: unknown, node: unknown) => {
        const card = node as (CanvasCardNode & { canvas?: unknown }) | null;
        menuFor(menu, card?.canvas, () => card ? [card] : []);
    }));
    plugin.registerEvent(canvasEvents.on('canvas:selection-menu', (menu: unknown, canvas: unknown) => {
        const selection = (canvas as { selection?: unknown } | null)?.selection;
        menuFor(menu, canvas, () => selection instanceof Set ? selection as Set<CanvasCardNode> : []);
    }));
    workspace.onLayoutReady(refresh);
    plugin.register(() => { running = false; for (const controller of controllers.values()) controller.destroy(); controllers.clear(); });
}
