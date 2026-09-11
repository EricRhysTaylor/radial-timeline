import { Component, MarkdownView, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { sceneTimeLabel } from '../utils/sceneTimeLabel';

/** Owns only the timing badges inserted into open markdown view headers. */
export class SceneTimeHeader extends Component {
    private readonly badges = new Map<MarkdownView, HTMLElement>();
    private running = false;

    constructor(private readonly plugin: RadialTimelinePlugin) { super(); }

    onload(): void {
        this.running = true;
        const { workspace, metadataCache, vault } = this.plugin.app;
        this.registerEvent(workspace.on('layout-change', () => this.refresh()));
        this.registerEvent(workspace.on('active-leaf-change', () => this.refresh()));
        this.registerEvent(workspace.on('file-open', () => this.refresh()));
        this.registerEvent(metadataCache.on('changed', () => this.refresh()));
        this.registerEvent(metadataCache.on('resolved', () => this.refresh()));
        this.registerEvent(vault.on('rename', () => this.refresh()));
        this.registerEvent(vault.on('delete', () => this.refresh()));
        workspace.onLayoutReady(() => this.refresh());
    }

    refresh(): void {
        if (!this.running) return;
        const open = new Set<MarkdownView>();
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) return;
            const raw = view.file && this.plugin.app.metadataCache.getFileCache(view.file)?.frontmatter;
            const metadata = raw ? normalizeFrontmatterKeys(raw, mappings) : undefined;
            if (metadata?.Class !== 'Scene') return;
            const header = view.containerEl.querySelector('.view-header');
            if (!header) return;
            open.add(view);
            let badge = this.badges.get(view);
            if (!badge || !header.contains(badge)) {
                badge?.remove();
                badge = header.createSpan({ cls: 'ert-scene-time' });
                header.insertBefore(badge, header.querySelector(':scope > .view-actions'));
                this.badges.set(view, badge);
            }
            const label = sceneTimeLabel(metadata.When, metadata.Duration);
            if (badge.textContent !== label.text) badge.setText(label.text);
            if (badge.getAttribute('aria-label') !== label.description) {
                badge.setAttribute('aria-label', label.description);
                setTooltip(badge, label.description);
            }
        });
        for (const [view, badge] of this.badges) {
            if (!open.has(view)) {
                badge.remove();
                this.badges.delete(view);
            }
        }
    }

    onunload(): void {
        this.running = false;
        for (const badge of this.badges.values()) badge.remove();
        this.badges.clear();
    }
}
