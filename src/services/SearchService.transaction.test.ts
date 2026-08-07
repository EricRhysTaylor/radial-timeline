import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { SearchService } from './SearchService';
import { createSearchState } from './searchState';

/**
 * Transactional lifecycle: a run may only commit if it is still the current
 * one. Every path that abandons a search — Clear, a newer search, view close —
 * must invalidate the in-flight run, or stale results resurrect themselves.
 */

type Deferred = {
    resolve: (scenes: TimelineItem[]) => void;
    reject: (error: Error) => void;
    promise: Promise<TimelineItem[]>;
};

function deferred(): Deferred {
    let resolve!: (scenes: TimelineItem[]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<TimelineItem[]>((res, rej) => { resolve = res; reject = rej; });
    return { resolve, reject, promise };
}

const scene = (path: string, synopsis: string): TimelineItem =>
    ({ path, title: path, synopsis, rawFrontmatter: {} } as TimelineItem);

const itemOfType = (path: string, synopsis: string, itemType: string): TimelineItem =>
    ({ path, title: path, synopsis, itemType, rawFrontmatter: {} } as TimelineItem);

function makeHarness() {
    const pending: Deferred[] = [];
    let refreshCount = 0;

    const plugin = {
        searchState: createSearchState(),
        settings: {} as Record<string, unknown>,
        getTimelineSceneData: () => {
            const d = deferred();
            pending.push(d);
            return d.promise;
        },
        getTimelineViews: () => [{
            refreshTimeline: () => { refreshCount += 1; },
            syncTimelineSearchControl: () => { /* no-op */ }
        }]
    };

    // SAFE: structural stub — the service only touches the members above.
    const service = new SearchService({} as never, plugin as never);
    return { service, plugin, pending, refreshCount: () => refreshCount };
}

// Let the .then chain drain.
const flush = () => new Promise(res => setTimeout(res, 0));

describe('SearchService transaction', () => {
    it('commits a run that is still current', async () => {
        const { service, plugin, pending } = makeHarness();

        service.performSearch('coast');
        expect(plugin.searchState.status).toBe('running');

        pending[0].resolve([scene('a.md', 'the coast'), scene('b.md', 'mountain')]);
        await flush();

        expect(plugin.searchState.active).toBe(true);
        expect(plugin.searchState.term).toBe('coast');
        expect([...plugin.searchState.hits.keys()]).toEqual(['a.md']);
    });

    it('discards a stale run that resolves after a newer search', async () => {
        const { service, plugin, pending } = makeHarness();

        service.performSearch('coast');
        service.performSearch('mountain');

        // The first (slow) run resolves last.
        pending[1].resolve([scene('b.md', 'mountain')]);
        await flush();
        pending[0].resolve([scene('a.md', 'the coast')]);
        await flush();

        expect(plugin.searchState.term).toBe('mountain');
        expect([...plugin.searchState.hits.keys()]).toEqual(['b.md']);
    });

    it('discards a run that resolves after Clear', async () => {
        const { service, plugin, pending } = makeHarness();

        service.performSearch('coast');
        service.clearSearch();

        pending[0].resolve([scene('a.md', 'the coast')]);
        await flush();

        expect(plugin.searchState.active).toBe(false);
        expect(plugin.searchState.term).toBe('');
        expect(plugin.searchState.hits.size).toBe(0);
    });

    it('discards a run that resolves after the view closed', async () => {
        // The view-close path resets state without going through the service.
        // If it does not also invalidate the run, the in-flight search commits
        // into a closed view and resurrects results that were just cleared.
        const { service, plugin, pending } = makeHarness();

        service.performSearch('coast');
        service.abandonSearch();

        pending[0].resolve([scene('a.md', 'the coast')]);
        await flush();

        expect(plugin.searchState.active).toBe(false);
        expect(plugin.searchState.term).toBe('');
        expect(plugin.searchState.hits.size).toBe(0);
    });

    it('abandonSearch does not refresh views — the view is going away', async () => {
        const { service, refreshCount } = makeHarness();

        service.performSearch('coast');
        const before = refreshCount();
        service.abandonSearch();

        expect(refreshCount()).toBe(before);
    });

    it('clears a stale error message when the search is abandoned', () => {
        const { service, plugin } = makeHarness();
        plugin.searchState.status = 'error';
        plugin.searchState.error = 'previous failure';

        service.abandonSearch();

        expect(plugin.searchState.status).toBe('idle');
        expect(plugin.searchState.error).toBeUndefined();
    });

    it('commits an empty result set when no scope is selected', async () => {
        // The alternative — quietly matching on a scope the author turned off —
        // would make the checkbox a lie. The panel's status line explains the
        // empty result.
        const { service, plugin, pending } = makeHarness();
        plugin.searchState.options = { timelineFields: false, body: false, llmAssist: false };

        service.performSearch('coast');
        await flush();

        expect(plugin.searchState.active).toBe(true);
        expect(plugin.searchState.term).toBe('coast');
        expect(plugin.searchState.hits.size).toBe(0);
        // No scene load was even requested.
        expect(pending).toHaveLength(0);
    });

    it('matches nothing from timeline fields once that scope is off', async () => {
        const { service, plugin, pending } = makeHarness();
        plugin.searchState.options = { timelineFields: false, body: true, llmAssist: false };

        service.performSearch('coast');
        pending[0].resolve([scene('a.md', 'the coast')]);
        await flush();

        // Body scope arrives in Stage 3; until then this scope contributes
        // nothing, and no other scope may stand in for it.
        expect(plugin.searchState.hits.size).toBe(0);
    });

    it('skips matter notes, which the timeline never draws', async () => {
        // Front/back matter is parsed for manuscript export but excluded from
        // the rendered rings. Matching it produces a hit that lights up
        // nothing — and inflates both the match count and the change signature.
        const { service, plugin, pending } = makeHarness();

        service.performSearch('dedication');
        pending[0].resolve([
            scene('scene.md', 'the dedication was read aloud'),
            itemOfType('front.md', 'dedication', 'Frontmatter'),
            itemOfType('back.md', 'dedication', 'Backmatter')
        ]);
        await flush();

        expect([...plugin.searchState.hits.keys()]).toEqual(['scene.md']);
    });

    it('still matches beats and backdrops, which do render', async () => {
        const { service, plugin, pending } = makeHarness();

        service.performSearch('storm');
        pending[0].resolve([
            ({
                path: 'beat.md', title: 'Beat', synopsis: 'storm', itemType: 'Beat',
                rawFrontmatter: { 'Beat Model': 'Save the Cat' }
            } as TimelineItem),
            itemOfType('backdrop.md', 'storm', 'Backdrop')
        ]);
        await flush();

        expect([...plugin.searchState.hits.keys()].sort()).toEqual(['backdrop.md', 'beat.md']);
    });

    it('resolves settings-derived inputs after the await, using the production mutation shape', async () => {
        // The settings UI mutates properties ON the settings object rather than
        // replacing it (ScenePropertiesSection reassigns
        // settings.hoverMetadataFields; the AI toggle flips
        // settings.enableAiSceneAnalysis). So this test mutates a property, not
        // the object.
        //
        // enableAiSceneAnalysis is the input that distinguishes the two
        // designs: it used to be read at call time while hover fields were read
        // after the await, splitting one run's inputs across two moments. Now
        // every input is resolved together, immediately before the synchronous
        // matching pass.
        const { service, plugin, pending } = makeHarness();
        plugin.settings.enableAiSceneAnalysis = false;

        service.performSearch('pacing lags');

        // The author enables AI scene analysis while the scene load is in flight.
        plugin.settings.enableAiSceneAnalysis = true;

        pending[0].resolve([
            ({
                path: 'a.md',
                title: 'A',
                currentSceneAnalysis: 'B / pacing lags in the middle',
                rawFrontmatter: {}
            } as TimelineItem)
        ]);
        await flush();

        // Resolved post-await, so the run sees the flag as it stands when the
        // matching pass actually runs. Under the old call-time capture this
        // scene would not have matched at all.
        expect([...plugin.searchState.hits.keys()]).toEqual(['a.md']);
    });

    it('applies one settings snapshot to every scene in a run', async () => {
        // The matching pass never awaits, so no scene can be matched under
        // different rules than another.
        const { service, plugin, pending } = makeHarness();
        plugin.settings.enableAiSceneAnalysis = true;

        service.performSearch('pacing lags');
        pending[0].resolve([
            ({ path: 'a.md', title: 'A', currentSceneAnalysis: 'pacing lags', rawFrontmatter: {} } as TimelineItem),
            ({ path: 'b.md', title: 'B', currentSceneAnalysis: 'pacing lags', rawFrontmatter: {} } as TimelineItem),
            ({ path: 'c.md', title: 'C', currentSceneAnalysis: 'pacing lags', rawFrontmatter: {} } as TimelineItem)
        ]);
        await flush();

        expect([...plugin.searchState.hits.keys()]).toEqual(['a.md', 'b.md', 'c.md']);
    });

    it('keeps prior results when a run fails, rather than blanking the timeline', async () => {
        const { service, plugin, pending } = makeHarness();

        service.performSearch('coast');
        pending[0].resolve([scene('a.md', 'the coast')]);
        await flush();

        service.performSearch('mountain');
        pending[1].reject(new Error('vault unavailable'));
        await flush();

        // A failed run reports itself but does not publish an empty result set
        // over results the author can still use.
        expect(plugin.searchState.status).toBe('error');
        expect(plugin.searchState.error).toBe('vault unavailable');
        expect(plugin.searchState.term).toBe('coast');
        expect(plugin.searchState.hits.has('a.md')).toBe(true);
    });
});
