import { Component, MarkdownView, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { sceneTimeLabel } from '../utils/sceneTimeLabel';
import type { SceneTimeService } from '../sceneTime/SceneTimeService';
import { SceneTimeModal } from '../sceneTime/SceneTimeModal';
import { elapsedLabel } from '../sceneTime/model';

/** Owns only the timing badges inserted into open markdown view headers. */
export class SceneTimeHeader extends Component {
    private readonly badges = new Map<MarkdownView, HTMLElement>();
    private running = false;

    constructor(private readonly plugin: RadialTimelinePlugin, private readonly timing: SceneTimeService) { super(); }

    onload(): void {
        this.running = true;
        this.register(this.timing.subscribe(() => this.refresh()));
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
                badge.setAttribute('role', 'button');
                badge.tabIndex = 0;
                const open = (): void => {
                    if (view.file) new SceneTimeModal(this.timing, view.file, () => view.getViewData()).open();
                };
                this.registerDomEvent(badge, 'click', open);
                this.registerDomEvent(badge, 'keydown', event => {
                    const key = (event as KeyboardEvent).key; // SAFE: registered for keydown on an HTML element.
                    if (key === 'Enter' || key === ' ') { event.preventDefault(); open(); }
                });
                header.insertBefore(badge, header.querySelector(':scope > .view-actions'));
                this.badges.set(view, badge);
            }
            const label = sceneTimeLabel(metadata.When, metadata.Duration);
            const snapshot = view.file && this.timing.snapshot(view.file, view.getViewData());
            if (snapshot) {
                const provisional = snapshot.estimated !== snapshot.elapsed;
                const total = provisional ? `~${elapsedLabel(snapshot.estimated)}` : snapshot.confirmed ? elapsedLabel(snapshot.elapsed) : '—';
                label.text += ` · Elapsed ${total}${snapshot.pending ? ` · ${snapshot.pending} cues` : ''}`;
                label.description += ` · ${elapsedLabel(snapshot.elapsed)} confirmed elapsed${provisional ? ` (~${elapsedLabel(snapshot.estimated)} including unconfirmed cues)` : ''}; ${snapshot.pending} unconfirmed cues. Optional: click to check elapsed story time.`;
                // Same leeway as the cue bar's duration line: red once confirmed time runs over, yellow while it rests on unconfirmed cues.
                const over = snapshot.duration?.status === 'over' ? snapshot.duration : null;
                const conflict = snapshot.conflict || !!over?.confirmed;
                badge.toggleClass('ert-time-over', conflict);
                badge.toggleClass('ert-time-over-provisional', !conflict && !!over);
                if (conflict) label.text += ' · Review timing';
                else if (over) {
                    label.text += ' · Check timing';
                    label.description += ` Unconfirmed time cues run past the declared ${elapsedLabel(over.planned)} duration.`;
                }
            }
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

    settingsChanged(): void {
        this.refresh();
        this.timing.scheduleRefresh();
    }

    onunload(): void {
        this.running = false;
        for (const badge of this.badges.values()) badge.remove();
        this.badges.clear();
    }
}
