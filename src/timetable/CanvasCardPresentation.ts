import { Component, getFrontMatterInfo, ItemView, Menu, setIcon, TFile, type View } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { authorKeyFor } from './timetableFiles';
import { synopsisKey } from './panelSynopsis';
import { t } from '../i18n';
import { getBookIdForPath } from '../utils/books';
import { markTimetableRows, onLinkedScene } from './timetableRegistry';
import { CanvasStoryNavigator } from './CanvasStoryNavigator';
import { linkedSceneViewport } from './canvasNavigation';
import { buildTableRow, sceneVitals } from './timetableModel';
import { computeCacheableValues } from '../renderer/utils/Precompute';
import type { PluginRendererFacade } from '../utils/sceneHelpers';
import { normalizeSubplotColorIndex } from '../renderer/utils/subplotColors';
import { cardSubplots } from './canvasCardSubplots';
import { setTooltip } from '../utils/domTooltip';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { outlineReferenceType, type OutlineReferenceType } from './outlineDocuments';

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

function portrait(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown>): string | null {
    const characters = readFrontmatterProperty(fm, authorKeyFor('Character', plugin.settings));
    const first: unknown = Array.isArray(characters) ? characters[0] : characters;
    if (typeof first !== 'string' || !first.trim()) return null;
    const link = first.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    const character = plugin.app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!character) return null;
    const imageValue = readFrontmatterProperty(plugin.app.metadataCache.getFileCache(character)?.frontmatter, 'Image');
    if (typeof imageValue !== 'string') return null;
    const imagePath = imageValue.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    const image = plugin.app.metadataCache.getFirstLinkpathDest(imagePath, character.path);
    return image && /^(png|jpe?g|gif|webp|avif)$/i.test(image.extension) ? plugin.app.vault.getResourcePath(image) : null;
}

class CanvasCards {
    private mode: Mode = 'preview';
    private readonly cards = new Map<HTMLElement, { overlay: HTMLElement; signature: string }>();
    private observer: MutationObserver;
    private timer: number | undefined;
    private revision = 0;
    private stopped = false;
    private showOverdue = true;
    private followTimeline = true;
    private followTimer: number | undefined;
    private readonly ringColors = new Map<string, Promise<Map<string, number>>>();
    readonly action: HTMLElement;
    private readonly unlink: () => void;
    private readonly events = new Component();
    private readonly navigator: CanvasStoryNavigator;

    constructor(private plugin: RadialTimelinePlugin, private view: ItemView) {
        this.view.containerEl.addClass('ert-canvas-card-view');
        this.navigator = new CanvasStoryNavigator(plugin, view);
        this.action = view.addAction('layout-template', t('ui.canvasSketch.cardViews'), event => {
            const menu = new Menu();
            const choices: Array<[Mode, string]> = [
                ['preview', t('ui.canvasSketch.cardPreview')], ['title', t('ui.canvasSketch.cardTitle')], ['full', t('ui.canvasSketch.cardFull')],
            ];
            for (const [mode, label] of choices) menu.addItem(item => item.setTitle(label).setChecked(this.mode === mode).onClick(() => {
                this.mode = mode;
                this.view.containerEl.toggleClass('ert-canvas-card-view', mode !== 'full');
                this.schedule();
            }));
            menu.addSeparator();
            menu.addItem(item => item.setTitle(t('ui.canvasSketch.showOverdue')).setIcon('calendar-clock').setChecked(this.showOverdue).onClick(() => {
                this.showOverdue = !this.showOverdue;
                this.schedule();
            }));
            menu.addItem(item => item.setTitle(t('ui.canvasSketch.followTimeline')).setIcon('locate-fixed').setChecked(this.followTimeline).onClick(() => {
                this.followTimeline = !this.followTimeline;
                if (this.followTimer) window.clearTimeout(this.followTimer);
            }));
            menu.showAtMouseEvent(event);
        });
        this.unlink = onLinkedScene((path, color, source) => {
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
            if (source !== 'timeline' || !path || !this.followTimeline || !matches.length) return;
            this.followTimer = window.setTimeout(() => {
                if (!canvas?.setViewport || !Number.isFinite(canvas.x) || !Number.isFinite(canvas.y) || !Number.isFinite(canvas.zoom)) return;
                const target = linkedSceneViewport(matches, { x: canvas.x!, y: canvas.y!, zoom: canvas.zoom! });
                if (target) canvas.setViewport(target.x, target.y, target.zoom);
            }, 350);
        });
        this.events.load();
        this.events.registerDomEvent(view.containerEl, 'click', event => {
            if (!(event.target instanceof Element)) return;
            const nodes = (this.view as CanvasView).canvas?.nodes;
            if (!(nodes instanceof Map)) return;
            for (const node of nodes.values()) {
                if (!node.nodeEl?.contains(event.target)) continue;
                const data = node.getData?.();
                const path = data?.type === 'file' ? data.file : undefined;
                const color = path ? this.plugin.highlightSceneOnTimeline(path) : null;
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

    invalidateColors(): void { this.ringColors.clear(); this.schedule(); }

    private colorsForBook(bookId: string): Promise<Map<string, number>> {
        const existing = this.ringColors.get(bookId);
        if (existing) return existing;
        const book = this.plugin.settings.books.find(item => item.id === bookId);
        const pending = book ? this.plugin.getSceneData({ sourcePath: book.sourceFolder }).then(scenes =>
            computeCacheableValues(this.plugin as unknown as PluginRendererFacade, scenes.map(scene => ({ ...scene, bookId, bookIndex: 0 }))).colorIndexBySubplot
        ) : Promise.resolve(new Map<string, number>());
        this.ringColors.set(bookId, pending);
        return pending;
    }

    private remove(node: HTMLElement): void {
        this.cards.get(node)?.overlay.remove();
        this.cards.delete(node);
        node.removeClass('ert-canvas-story-node');
    }

    private async refresh(): Promise<void> {
        const revision = ++this.revision;
        this.navigator.refresh();
        const nodes = (this.view as CanvasView).canvas?.nodes;
        const keep = new Set<HTMLElement>();
        if (this.mode !== 'full' && nodes instanceof Map) {
            const groups = [...nodes.values()].map(node => node.getData?.()).filter((data): data is NodeData => data?.type === 'group');
            for (const node of nodes.values()) {
                const data = node.getData?.();
                const el = node.nodeEl;
                if (!el || data?.type !== 'file' || !data.file || data.subpath) continue;
                const file = this.plugin.app.vault.getAbstractFileByPath(data.file);
                if (!(file instanceof TFile) || file.extension !== 'md') continue;
                keep.add(el);
                const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {}; // SAFE: a note without YAML has no cached frontmatter; empty = no properties
                const kindValue = readFrontmatterProperty(fm, authorKeyFor('Class', this.plugin.settings));
                const bookId = getBookIdForPath(this.plugin.settings.books, file.path);
                const kind = bookId && typeof kindValue === 'string' ? kindValue.trim() : t('ui.canvasSketch.cardLabel');
                const image = portrait(this.plugin, file, fm);
                const row = bookId ? buildTableRow(file.path, file.basename, fm, this.plugin.settings) : null;
                const slots = bookId && row && (row.kind === 'scene' || row.kind === 'sketch') ? await this.colorsForBook(bookId) : new Map<string, number>();
                const subplotNames = row?.subplots.filter(name => slots.has(name)) ?? []; // SAFE: a card outside every book has no row and shows no subplot chips
                const shownSubplots = cardSubplots(data, groups, subplotNames);
                const overdue = this.showOverdue && row?.kind === 'scene' && sceneVitals(fm, this.plugin.settings, new Date()).due.kind === 'late';
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
                const number = row?.kind === 'scene' ? row.prefix : null;
                const signature = JSON.stringify([this.mode, title, kind, number, image, description, file.path, shownSubplots.map(name => [name, slots.get(name)]), overdue]);
                const existing = this.cards.get(el);
                if (existing?.signature === signature && el.contains(existing.overlay)) continue;
                this.remove(el);
                const cardType = outlineReferenceType(kind);
                const overlay = el.createDiv({ cls: `ert-canvas-story-card${cardType === 'sketch' ? ' is-sketch' : ''}` });
                const header = overlay.createDiv({ cls: 'ert-canvas-story-card__header' });
                const artwork = header.createDiv({ cls: 'ert-canvas-story-card__art' });
                if (image) artwork.createEl('img', { attr: { src: image, alt: '' } });
                else setIcon(artwork, CARD_ICONS[cardType]);
                const heading = header.createDiv({ cls: 'ert-canvas-story-card__heading' });
                const meta = heading.createDiv({ cls: 'ert-canvas-story-card__meta' });
                if (shownSubplots.length) {
                    overlay.setCssProps({ '--ert-canvas-subplot': `var(--rt-subplot-colors-${normalizeSubplotColorIndex(slots.get(shownSubplots[0])!)})` });
                    overlay.addClass('has-subplot');
                    const markers = meta.createDiv({ cls: 'ert-canvas-story-card__subplots' });
                    for (const name of shownSubplots.slice(0, 3)) {
                        const marker = markers.createSpan({ cls: 'ert-canvas-story-card__subplot' });
                        setTooltip(marker, name);
                        marker.setCssProps({ '--ert-canvas-subplot': `var(--rt-subplot-colors-${normalizeSubplotColorIndex(slots.get(name)!)})` });
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
                this.cards.set(el, { overlay, signature });
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
    workspace.onLayoutReady(refresh);
    plugin.register(() => { running = false; for (const controller of controllers.values()) controller.destroy(); controllers.clear(); });
}
