import { getFrontMatterInfo, ItemView, Menu, setIcon, TFile, type View } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { authorKeyFor } from './timetableFiles';
import { synopsisKey } from './panelSynopsis';
import { t } from '../i18n';

type Mode = 'full' | 'preview' | 'title';
type CanvasNode = { nodeEl?: HTMLElement; getData?: () => { type?: string; file?: string; subpath?: string } };
type CanvasView = View & { canvas?: { nodes?: Map<string, CanvasNode> } };

function value(fm: Record<string, unknown>, name: string): unknown {
    const key = Object.keys(fm).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? fm[key] : undefined;
}

function plainText(text: string): string {
    return text.replace(/!\[\[[^\]]+\]\]/g, '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s*#{1,6}\s+/gm, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
}

function portrait(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown>): string | null {
    const characters = value(fm, authorKeyFor('Character', plugin.settings));
    const first = Array.isArray(characters) ? characters[0] : characters;
    if (typeof first !== 'string' || !first.trim()) return null;
    const link = first.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    const character = plugin.app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!character) return null;
    const imageValue = value(plugin.app.metadataCache.getFileCache(character)?.frontmatter ?? {}, 'Image');
    if (typeof imageValue !== 'string') return null;
    const imagePath = imageValue.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    const image = plugin.app.metadataCache.getFirstLinkpathDest(imagePath, character.path);
    return image && /^(png|jpe?g|gif|webp|avif)$/i.test(image.extension) ? plugin.app.vault.getResourcePath(image) : null;
}

class CanvasCards {
    private mode: Mode = 'full';
    private readonly cards = new Map<HTMLElement, { overlay: HTMLElement; signature: string }>();
    private observer: MutationObserver;
    private timer: number | undefined;
    private revision = 0;
    private stopped = false;
    readonly action: HTMLElement;

    constructor(private plugin: RadialTimelinePlugin, private view: ItemView) {
        this.action = view.addAction('layout-template', t('ui.canvasSketch.cardViews'), event => {
            const menu = new Menu();
            const choices: Array<[Mode, string]> = [
                ['full', t('ui.canvasSketch.cardFull')], ['preview', t('ui.canvasSketch.cardPreview')], ['title', t('ui.canvasSketch.cardTitle')],
            ];
            for (const [mode, label] of choices) menu.addItem(item => item.setTitle(label).setChecked(this.mode === mode).onClick(() => {
                this.mode = mode;
                this.view.containerEl.toggleClass('ert-canvas-card-view', mode !== 'full');
                this.schedule();
            }));
            menu.showAtMouseEvent(event);
        });
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(view.containerEl, { childList: true, subtree: true });
    }

    schedule(): void {
        if (this.stopped || this.timer) return;
        this.timer = window.setTimeout(() => { this.timer = undefined; void this.refresh(); }, 80);
    }

    private remove(node: HTMLElement): void {
        this.cards.get(node)?.overlay.remove();
        this.cards.delete(node);
        node.removeClass('ert-canvas-story-node');
    }

    private async refresh(): Promise<void> {
        const revision = ++this.revision;
        const nodes = (this.view as CanvasView).canvas?.nodes;
        const keep = new Set<HTMLElement>();
        if (this.mode !== 'full' && nodes instanceof Map) {
            for (const node of nodes.values()) {
                const data = node.getData?.();
                const el = node.nodeEl;
                if (!el || data?.type !== 'file' || !data.file || data.subpath) continue;
                const file = this.plugin.app.vault.getAbstractFileByPath(data.file);
                if (!(file instanceof TFile) || file.extension !== 'md') continue;
                keep.add(el);
                const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
                const kindValue = value(fm, authorKeyFor('Class', this.plugin.settings));
                const kind = typeof kindValue === 'string' ? kindValue.trim() : '';
                const image = portrait(this.plugin, file, fm);
                let preview = '';
                if (this.mode === 'preview') {
                    if (kind.toLowerCase() === 'scene') {
                        const synopsis = fm[synopsisKey(fm, this.plugin.settings)];
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
                const signature = JSON.stringify([this.mode, title, kind, image, description, file.path]);
                const existing = this.cards.get(el);
                if (existing?.signature === signature && el.contains(existing.overlay)) continue;
                this.remove(el);
                const overlay = el.createDiv({ cls: 'ert-canvas-story-card' });
                const header = overlay.createDiv({ cls: 'ert-canvas-story-card__header' });
                const artwork = header.createDiv({ cls: 'ert-canvas-story-card__art' });
                if (image) artwork.createEl('img', { attr: { src: image, alt: '' } });
                else setIcon(artwork, 'notebook-pen');
                const heading = header.createDiv({ cls: 'ert-canvas-story-card__heading' });
                if (kind) heading.createDiv({ cls: 'ert-canvas-story-card__kind', text: kind });
                heading.createDiv({ cls: 'ert-canvas-story-card__title', text: title });
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
        this.observer.disconnect();
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
    plugin.registerEvent(plugin.app.metadataCache.on('changed', refresh));
    workspace.onLayoutReady(refresh);
    plugin.register(() => { running = false; for (const controller of controllers.values()) controller.destroy(); controllers.clear(); });
}
