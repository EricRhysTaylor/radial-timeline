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

function makeHarness() {
    const pending: Deferred[] = [];
    let refreshCount = 0;

    const plugin = {
        searchState: createSearchState(),
        settings: {},
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
