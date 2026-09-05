import { App, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { RadialTimelineView } from '../view/TimeLineView';
import { getActivePlanetaryProfile, convertFromEarth } from '../utils/planetaryTime';
import { collectHoverMetadataText, formatDateForDisplay } from '../utils/hoverMetadata';
import { isRenderedOnTimeline } from '../utils/sceneHelpers';
import { frontmatterValueToText } from '../utils/frontmatter';
import type { RadialTimelineSettings } from '../types/settings';
import type { TimelineItem } from '../types';
import { hasSearchScope, mergeSearchHit, type TimelineSearchHit } from './searchState';
import { SceneBodyIndex, findBodyMatches } from './SceneBodyIndex';
import {
    ConceptSearchService,
    type CancelToken,
    type ConceptSearchScene
} from './ConceptSearchService';
import { getLocalLlmAvailability } from '../ai/localLlm/availability';
import { getCanonicalLocalLlmSettings } from '../ai/localLlm/settings';
import type { TimelineSearchOptions } from './searchState';

export interface TimelineSearchMatchOptions {
    planetaryLine?: string;
    /**
     * Settings, so the enabled hover-metadata fields can be resolved.
     *
     * Deliberately **required**: this is what makes the searched set equal the
     * rendered set. If it were optional, a future caller could omit it and
     * silently narrow the search back to the hardcoded fields — the exact bug
     * this parameter exists to fix, reintroduced without a compile error.
     */
    settings: RadialTimelineSettings;
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
export function buildTimelineSearchTextFields(scene: TimelineItem, options: TimelineSearchMatchOptions): string[] {
    const fields: string[] = [];

    appendSearchValue(fields, scene.title);
    appendSearchValue(fields, scene.synopsis);
    appendSearchValue(fields, scene.Character);
    appendSearchValue(fields, scene.subplot);
    appendSearchValue(fields, scene.Duration);

    // The AI Pulse analysis is deliberately NOT searched. It is commentary
    // *about* a scene — a grade and editorial notes — not something the scene
    // contains, and it is not reliably about that scene in particular. Matching
    // it would light up a scene because a critique of it mentioned a meal.
    appendSearchValue(fields, options.planetaryLine);

    // Custom hover-metadata fields, formatted exactly as displayed. Enabling a
    // field in hover metadata makes it searchable in the same action.
    for (const text of collectHoverMetadataText(options.settings, scene)) {
        fields.push(text);
    }

    return fields;
}

export function timelineSceneMatchesSearch(scene: TimelineItem, phrase: string, options: TimelineSearchMatchOptions): boolean {
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

    private readonly bodyIndex: SceneBodyIndex;
    private readonly conceptSearch: ConceptSearchService;
    /** Shared with the in-flight concept run so the panel can stop it. */
    private cancelToken: CancelToken = { cancelled: false };
    /** Aborts the request in flight, so a stopped sweep stops the server too. */
    private cancelController = new AbortController();

    constructor(app: App, plugin: RadialTimelinePlugin) {
        this.app = app;
        this.plugin = plugin;
        this.bodyIndex = new SceneBodyIndex(app);
        this.conceptSearch = new ConceptSearchService(plugin);

        // Cached bodies are keyed by mtime, so an edit is caught on the next
        // read. Rename and delete are not — the path itself becomes wrong, so
        // the entry has to go.
        plugin.registerEvent(app.vault.on('rename', (file, oldPath) => {
            this.bodyIndex.invalidate(oldPath);
            this.bodyIndex.invalidate(file.path);
        }));
        plugin.registerEvent(app.vault.on('delete', (file) => {
            this.bodyIndex.invalidate(file.path);
        }));
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

        // No scope selected means the search has nowhere to look. Commit an
        // empty result set rather than quietly matching on a scope the author
        // turned off — the panel's status line explains the empty result.
        if (!hasSearchScope(state.options)) {
            this.commit(trimmed, new Map());
            return;
        }

        // Read once, up front. Safe against drift because changing an option
        // re-runs the search, which invalidates this run — and because the panel
        // *replaces* the options object rather than mutating it, so this
        // reference stays the one this run was started with.
        const options = state.options;

        void this.plugin.getTimelineSceneData()
            .then(async scenes => {
                if (myRun !== this.runId) return; // superseded or cleared

                // Only items the timeline actually draws can show a match.
                const searchable = scenes.filter(scene => isRenderedOnTimeline(scene));

                // Body text is the run's only remaining async input, so it is
                // gathered here — before the settings capture below, which must
                // sit immediately ahead of the synchronous pass.
                const bodies = options.body
                    ? await this.bodyIndex.load(searchable)
                    : null;

                if (myRun !== this.runId) return; // superseded during body reads

                // Every settings-derived input is resolved here, at one instant,
                // with no await between this point and the end of the matching
                // pass. That pass never yields, so no scene can be matched under
                // different rules than another.
                //
                // Resolving these earlier would split the run's inputs across an
                // await: the AI-analysis flag and planetary profile would be
                // captured at one moment while the hover-metadata fields —
                // reassigned wholesale by the settings UI — would be read at
                // another. Holding a reference to `plugin.settings` is not a
                // freeze; the object is mutated in place.
                const settings = this.plugin.settings;
                const planetaryProfile = getActivePlanetaryProfile(settings);

                if (options.llmAssist) {
                    await this.runConceptSearch({
                        myRun, term: trimmed, searchable, bodies, settings,
                        planetaryProfile, options
                    });
                    return;
                }

                // Accumulate privately; the live state is untouched until commit.
                const hits = new Map<string, TimelineSearchHit>();

                searchable.forEach(scene => {
                    if (!scene.path) return;

                    const planetaryLine = this.planetaryLineFor(scene, planetaryProfile);

                    if (options.timelineFields) {
                        const matched = timelineSceneMatchesSearch(scene, trimmed, {
                            planetaryLine,
                            settings
                        });
                        if (matched) {
                            mergeSearchHit(hits, { path: scene.path, source: 'timelineFields', evidence: [] });
                        }
                    }

                    // Both scopes contribute: a scene matching in each is one hit
                    // labelled 'both', never one scope silently standing in for
                    // the other.
                    if (bodies) {
                        const evidence = findBodyMatches(bodies.get(scene.path) ?? '', trimmed);
                        if (evidence.length > 0) {
                            mergeSearchHit(hits, { path: scene.path, source: 'body', evidence });
                        }
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

    /**
     * The concept path: gate on a live availability check, build the corpus
     * from the selected scopes, then let the model propose and the quotes
     * decide.
     */
    private async runConceptSearch(input: {
        myRun: number;
        term: string;
        searchable: TimelineItem[];
        bodies: Map<string, string> | null;
        settings: RadialTimelineSettings;
        planetaryProfile: ReturnType<typeof getActivePlanetaryProfile>;
        options: TimelineSearchOptions;
    }): Promise<void> {
        const { myRun, term, searchable, bodies, settings, options } = input;
        const state = this.plugin.searchState;

        // Forced, not cached: the author is committing to a run, and a stale
        // "available" would fail confusingly a minute later.
        const availability = await getLocalLlmAvailability(this.plugin, { force: true });
        if (myRun !== this.runId) return;
        if (!availability.available) {
            this.fail(availability.reason ?? 'No local model is available.');
            return;
        }

        const corpus: ConceptSearchScene[] = searchable
            .filter(scene => !!scene.path)
            .map(scene => {
                const fieldsText = options.timelineFields
                    ? buildTimelineSearchTextFields(scene, {
                        planetaryLine: this.planetaryLineFor(scene, input.planetaryProfile),
                        settings
                    }).join(' · ')
                    : undefined;
                const bodyText = options.body ? bodies?.get(scene.path as string) : undefined;
                return { path: scene.path as string, fieldsText, bodyText };
            })
            // A scene contributing no text would just spend tokens.
            .filter(scene => !!scene.fieldsText || !!scene.bodyText);

        this.cancelController = new AbortController();
        this.cancelToken = { cancelled: false, signal: this.cancelController.signal };
        const cancel = this.cancelToken;

        // Published as the sweep runs rather than held to the end. A run over a
        // whole manuscript takes minutes; an author staring at an unchanged
        // timeline has no way to tell work from a hang, and cannot start
        // reading the matches that already exist.
        const hits = new Map<string, TimelineSearchHit>();

        try {
            const outcome = await this.conceptSearch.run({
                query: term,
                scenes: corpus,
                localLlm: getCanonicalLocalLlmSettings(this.plugin),
                cancel,
                onProgress: (progress) => {
                    if (myRun !== this.runId) return;
                    state.progress = progress;
                    this.syncTimelineSearchControls();
                },
                onHit: (hit) => {
                    if (myRun !== this.runId) return;
                    mergeSearchHit(hits, hit);
                    this.publishPartial(term, hits);
                }
            });

            if (myRun !== this.runId) return;
            this.commit(term, hits, outcome.droppedClaims, outcome.cancelled, outcome.unreadableScenes);
        } catch (error) {
            if (myRun !== this.runId) return;
            const message = error instanceof Error ? error.message : String(error);
            console.error('[Search] Concept search failed.', error);
            // Matches already published stay: they were verified before the
            // failure and are no less true for what came after.
            this.fail(message);
        }
    }

    /**
     * Make the matches found so far visible without ending the run.
     *
     * Status stays `running`, so the panel keeps showing progress and the Cancel
     * button, while the timeline lights up scene by scene.
     */
    private publishPartial(term: string, hits: Map<string, TimelineSearchHit>): void {
        const state = this.plugin.searchState;
        state.term = term;
        state.active = true;
        state.hits = new Map(hits);
        this.syncTimelineSearchControls();
        this.refreshTimelineViews();
    }

    /**
     * Report a failure without publishing an empty result set — whatever the
     * author had on screen is still usable, and blanking it would punish them
     * for a failure that was not theirs.
     */
    private fail(message: string): void {
        const state = this.plugin.searchState;
        state.status = 'error';
        state.error = message;
        state.progress = undefined;
        this.syncTimelineSearchControls();
    }

    private planetaryLineFor(
        scene: TimelineItem,
        profile: ReturnType<typeof getActivePlanetaryProfile>
    ): string | undefined {
        if (!profile || !scene.when) return undefined;
        const conversion = convertFromEarth(scene.when, profile);
        if (!conversion) return undefined;
        return `${(profile.label || 'LOCAL').toUpperCase()}: ${conversion.formatted}`;
    }

    /** Stop an in-flight concept run, including the request already sent. */
    cancelSearch(): void {
        this.cancelToken.cancelled = true;
        this.cancelController.abort();
    }

    /** Atomically replace the committed results. */
    private commit(
        term: string,
        hits: Map<string, TimelineSearchHit>,
        droppedClaims?: number,
        stoppedEarly?: boolean,
        unreadableScenes?: number
    ): void {
        const state = this.plugin.searchState;
        state.term = term;
        state.active = true;
        state.status = 'ready';
        state.error = undefined;
        state.progress = undefined;
        state.droppedClaims = droppedClaims;
        state.stoppedEarly = stoppedEarly;
        state.unreadableScenes = unreadableScenes;
        state.hits = hits;
        this.syncTimelineSearchControls();
        this.refreshTimelineViews();
    }

    /**
     * Invalidate any in-flight run and drop all results.
     *
     * Owning `runId` here is the whole point of the transaction. A caller that
     * reset the state object directly would leave the run token untouched, and
     * the in-flight search would sail through its guard and commit into the
     * state that was just cleared.
     */
    private reset(): void {
        this.runId += 1;
        // Stop a concept run scheduling more passes, and abort the one in
        // flight — clearing a search should not leave the server working.
        this.cancelToken.cancelled = true;
        this.cancelController.abort();

        const state = this.plugin.searchState;
        state.term = '';
        state.active = false;
        state.status = 'idle';
        state.error = undefined;
        state.progress = undefined;
        state.droppedClaims = undefined;
        state.stoppedEarly = undefined;
        state.unreadableScenes = undefined;
        state.hits = new Map();
    }

    clearSearch(): void {
        this.reset();
        this.syncTimelineSearchControls();
        this.refreshTimelineViews();
    }

    /**
     * Clear search because the view is going away.
     *
     * Same invalidation as `clearSearch`, without the sync/refresh — refreshing
     * a closing view is pointless and re-entering render during unload invites
     * side effects.
     */
    abandonSearch(): void {
        this.reset();
    }
}
