import { App, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { RadialTimelineView } from '../view/TimeLineView';
import { getActivePlanetaryProfile, convertFromEarth } from '../utils/planetaryTime';
import { collectHoverMetadataText, formatDateForDisplay } from '../utils/hoverMetadata';
import { frontmatterValueToText } from '../utils/frontmatter';
import type { RadialTimelineSettings } from '../types/settings';
import type { TimelineItem } from '../types';
import { mergeSearchHit, type TimelineSearchHit } from './searchState';

export interface TimelineSearchMatchOptions {
    includeCurrentSceneAnalysis?: boolean;
    planetaryLine?: string;
    /**
     * Settings, so the enabled hover-metadata fields can be resolved. Required
     * for the searched set to equal the rendered set; omitting it silently
     * narrows the search back to the hardcoded fields.
     */
    settings?: RadialTimelineSettings;
}

const containsWholePhrase = (haystack: string | undefined, phrase: string, isDate: boolean = false): boolean => {
    if (!haystack || !phrase || typeof haystack !== 'string') return false;
    const h = haystack.toLowerCase();
    const p = phrase.toLowerCase();
    if (isDate && h.includes('/')) {
        const datePattern = new RegExp(p.replace(/\//g, '\\/') + '(?:\\/|$)', 'i');
        return datePattern.test(h);
    }
    return h.includes(p);
};

/**
 * The visible date string, or '' when the scene has no usable date.
 *
 * `formatDateForDisplay` is strict about invalid Dates by design (the renderer
 * wants to know); search sees whatever the vault holds, so it checks first
 * rather than letting a malformed `When:` abort the whole run.
 */
function displayDateOrEmpty(when: Date | undefined): string {
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) return '';
    return formatDateForDisplay(when);
}

function appendSearchValue(fields: string[], value: unknown): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
        value.forEach(item => appendSearchValue(fields, item));
        return;
    }
    const text = frontmatterValueToText(value).trim();
    if (text) fields.push(text);
}

/**
 * Every string the timeline displays for a scene — the searchable set.
 *
 * This must stay equal to what the hover synopsis renders. Custom fields come
 * from `collectHoverMetadataText`, which is the same resolver and the same
 * formatter the renderer uses; do not re-derive them here.
 */
export function buildTimelineSearchTextFields(scene: TimelineItem, options: TimelineSearchMatchOptions = {}): string[] {
    const fields: string[] = [];

    appendSearchValue(fields, scene.title);
    appendSearchValue(fields, scene.synopsis);
    appendSearchValue(fields, scene.Character);
    appendSearchValue(fields, scene.subplot);
    appendSearchValue(fields, scene.Duration);

    if (options.includeCurrentSceneAnalysis) {
        appendSearchValue(fields, scene["currentSceneAnalysis"]);
    }

    appendSearchValue(fields, options.planetaryLine);

    // Custom hover-metadata fields, formatted exactly as displayed. Enabling a
    // field in hover metadata makes it searchable in the same action.
    if (options.settings) {
        for (const text of collectHoverMetadataText(options.settings, scene)) {
            fields.push(text);
        }
    }

    return fields;
}

export function timelineSceneMatchesSearch(scene: TimelineItem, phrase: string, options: TimelineSearchMatchOptions = {}): boolean {
    const textMatched = buildTimelineSearchTextFields(scene, options)
        .some(field => containsWholePhrase(field, phrase, false));
    if (textMatched) return true;

    const dateFieldNumeric = scene.when?.toLocaleDateString();
    const dateFieldDisplay = displayDateOrEmpty(scene.when);
    return containsWholePhrase(dateFieldNumeric, phrase, true) ||
        containsWholePhrase(dateFieldDisplay, phrase, false);
}

export class SearchService {
    private plugin: RadialTimelinePlugin;
    private app: App;

    /**
     * Monotonic run token. A run commits only if it is still the current one,
     * so a slow earlier search resolving after a newer search — or after Clear
     * — discards its work instead of overwriting live results.
     */
    private runId = 0;

    constructor(app: App, plugin: RadialTimelinePlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    openSearchPrompt(): void {
        void this.focusTimelineSearchInput();
    }

    private async focusTimelineSearchInput(): Promise<void> {
        let views = this.plugin.getTimelineViews();
        if (views.length === 0) {
            await this.plugin.getTimelineService().activateView();
            views = this.plugin.getTimelineViews();
        }

        const activeTimelineView = this.app.workspace.getActiveViewOfType(RadialTimelineView);
        const targetView = views.find(view => view === activeTimelineView) || views[0];
        if (!targetView) {
            new Notice('Open the timeline view to search scenes.');
            return;
        }

        window.setTimeout(() => targetView.focusTimelineSearchInput(), 50);
    }

    private syncTimelineSearchControls(): void {
        this.plugin.getTimelineViews().forEach(view => view.syncTimelineSearchControl());
    }

    private refreshTimelineViews(): void {
        this.plugin.getTimelineViews().forEach(view => view.refreshTimeline());
    }

    performSearch(term: string): void {
        const trimmed = term.trim();
        if (!trimmed) { this.clearSearch(); return; }

        // Claim this run. Anything already in flight is now stale.
        const myRun = ++this.runId;
        const state = this.plugin.searchState;
        state.status = 'running';
        state.error = undefined;

        // Frozen for the life of the run — a mid-flight settings change must not
        // make half the scenes match under different rules than the other half.
        const settings = this.plugin.settings;
        const includeCurrentSceneAnalysis = !!settings.enableAiSceneAnalysis;
        const planetaryProfile = getActivePlanetaryProfile(settings);

        void this.plugin.getTimelineSceneData()
            .then(scenes => {
                if (myRun !== this.runId) return; // superseded or cleared

                // Accumulate privately; the live state is untouched until commit.
                const hits = new Map<string, TimelineSearchHit>();

                scenes.forEach(scene => {
                    let planetaryLine: string | undefined;
                    if (planetaryProfile && scene.when) {
                        const conversion = convertFromEarth(scene.when, planetaryProfile);
                        if (conversion) {
                            const label = (planetaryProfile.label || 'LOCAL').toUpperCase();
                            planetaryLine = `${label}: ${conversion.formatted}`;
                        }
                    }

                    const matched = timelineSceneMatchesSearch(scene, trimmed, {
                        includeCurrentSceneAnalysis,
                        planetaryLine,
                        settings
                    });
                    if (matched && scene.path) {
                        mergeSearchHit(hits, { path: scene.path, source: 'timelineFields', evidence: [] });
                    }
                });

                if (myRun !== this.runId) return; // superseded while matching

                this.commit(trimmed, hits);
            })
            .catch(error => {
                if (myRun !== this.runId) return;
                const message = error instanceof Error ? error.message : String(error);
                state.status = 'error';
                state.error = message;
                console.error('[Search] Scene data load failed.', error);
                this.syncTimelineSearchControls();
            });
    }

    /** Atomically replace the committed results. */
    private commit(term: string, hits: Map<string, TimelineSearchHit>): void {
        const state = this.plugin.searchState;
        state.term = term;
        state.active = true;
        state.status = 'ready';
        state.error = undefined;
        state.hits = hits;
        this.syncTimelineSearchControls();
        this.refreshTimelineViews();
    }

    clearSearch(): void {
        // Invalidate any in-flight run so it cannot resurrect cleared results.
        this.runId += 1;

        const state = this.plugin.searchState;
        state.term = '';
        state.active = false;
        state.status = 'idle';
        state.error = undefined;
        state.hits = new Map();

        this.syncTimelineSearchControls();
        this.refreshTimelineViews();
    }
}
