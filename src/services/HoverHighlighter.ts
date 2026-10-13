import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { SceneHighlighter } from './SceneHighlighter';
import { bindToAllDocuments } from '../utils/documents';
import { leafForTabHeader } from '../utils/obsidianInternals';
import { publishCurrentNote } from '../timetable/timetableRegistry';

/**
 * Hovering a scene note in the file explorer, or its tab header, lights that
 * scene up on every open timeline, the same spotlight the wheel's own hover
 * and the Timetable use. Leaving clears it. Opening a scene note marks it as
 * open on the timeline (`openScenePaths`); it doesn't dim the rest of the
 * wheel while the author writes.
 */
export class HoverHighlighter {
    /** The scene note under the pointer in the explorer or a tab header, if any. */
    private hoveredPath: string | null = null;

    constructor(
        private app: App,
        private plugin: RadialTimelinePlugin,
        private highlighter: SceneHighlighter
    ) {}

    register(): void {
        // Hover targets (file explorer rows, tab headers) exist per window —
        // listen on every open document, including popouts opened later.
        bindToAllDocuments(this.plugin, (doc) => this.registerHoverListeners(doc));

        this.plugin.registerEvent(this.app.workspace.on('file-open', (file) => {
            // Open Timetables mark the open note's row.
            publishCurrentNote(file?.path ?? null);
            if (!file || !this.plugin.isSceneFile(file.path)) return;
            this.plugin.openScenePaths.add(file.path);
            this.plugin.refreshTimelineIfNeeded(null);
        }));
    }

    private registerHoverListeners(doc: Document): void {
        this.plugin.registerDomEvent(doc, 'mouseover', (evt: MouseEvent) => {
            const path = this.scenePathUnder(evt.target);
            if (!path || path === this.hoveredPath) return;
            this.hoveredPath = path;
            this.highlighter.spotlight(path);
        });
        this.plugin.registerDomEvent(doc, 'mouseout', (evt: MouseEvent) => {
            if (this.hoveredPath === null) return;
            if (this.scenePathUnder(evt.relatedTarget) === this.hoveredPath) return;
            this.hoveredPath = null;
            this.highlighter.spotlight(null);
        });
    }

    /** The scene note an explorer row or tab header stands for. */
    private scenePathUnder(target: EventTarget | null): string | null {
        const element = target instanceof Element ? target : null;
        if (!element) return null;
        let path: string | null = null;
        const explorerRow = element.closest('.nav-file-title');
        if (explorerRow) {
            path = explorerRow.getAttribute('data-path');
        } else {
            const tabHeader = element.closest('.workspace-tab-header');
            const state = tabHeader ? leafForTabHeader(this.app, tabHeader)?.getViewState() : undefined;
            const file = (state?.state as { file?: unknown } | undefined)?.file;
            if (state?.type === 'markdown' && typeof file === 'string') path = file;
        }
        return path && this.plugin.isSceneFile(path) ? path : null;
    }
}
