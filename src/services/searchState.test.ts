import { describe, expect, it } from 'vitest';
import {
    createSearchState,
    isSearchHit,
    mergeSearchHit,
    searchHitPaths,
    type TimelineSearchHit
} from './searchState';

describe('createSearchState', () => {
    it('starts idle, inactive, and matching nothing', () => {
        const state = createSearchState();
        expect(state.active).toBe(false);
        expect(state.status).toBe('idle');
        expect(state.term).toBe('');
        expect(state.hits.size).toBe(0);
    });

    it('defaults to timeline fields only — the visible metadata', () => {
        const { options } = createSearchState();
        expect(options).toEqual({ timelineFields: true, body: false, llmAssist: false });
    });

    it('copies the options so callers cannot mutate the defaults', () => {
        const a = createSearchState();
        a.options.body = true;
        expect(createSearchState().options.body).toBe(false);
    });
});

describe('isSearchHit', () => {
    const state = createSearchState();
    state.hits.set('scene.md', { path: 'scene.md', source: 'timelineFields', evidence: [] });

    it('is false while the search is inactive, even with hits present', () => {
        state.active = false;
        expect(isSearchHit(state, 'scene.md')).toBe(false);
    });

    it('is true for a matched path once active', () => {
        state.active = true;
        expect(isSearchHit(state, 'scene.md')).toBe(true);
        expect(isSearchHit(state, 'other.md')).toBe(false);
    });

    it('is false for an undefined path', () => {
        state.active = true;
        expect(isSearchHit(state, undefined)).toBe(false);
    });
});

describe('mergeSearchHit', () => {
    const hit = (overrides: Partial<TimelineSearchHit>): TimelineSearchHit => ({
        path: 'scene.md',
        source: 'timelineFields',
        evidence: [],
        ...overrides
    });

    it('promotes source to "both" when a scene matches in two scopes', () => {
        const hits = new Map<string, TimelineSearchHit>();
        mergeSearchHit(hits, hit({ source: 'timelineFields' }));
        mergeSearchHit(hits, hit({ source: 'body', evidence: ['a passage'] }));
        expect(hits.get('scene.md')?.source).toBe('both');
    });

    it('keeps a single-scope match labeled with that scope', () => {
        const hits = new Map<string, TimelineSearchHit>();
        mergeSearchHit(hits, hit({ source: 'body', evidence: ['one'] }));
        mergeSearchHit(hits, hit({ source: 'body', evidence: ['two'] }));
        expect(hits.get('scene.md')?.source).toBe('body');
    });

    it('unions evidence without duplicating identical passages', () => {
        const hits = new Map<string, TimelineSearchHit>();
        mergeSearchHit(hits, hit({ source: 'body', evidence: ['same', 'first'] }));
        mergeSearchHit(hits, hit({ source: 'body', evidence: ['same', 'second'] }));
        expect(hits.get('scene.md')?.evidence).toEqual(['same', 'first', 'second']);
    });

    it('does not alias the caller\'s evidence array', () => {
        const hits = new Map<string, TimelineSearchHit>();
        const evidence = ['passage'];
        mergeSearchHit(hits, hit({ source: 'body', evidence }));
        evidence.push('added later');
        expect(hits.get('scene.md')?.evidence).toEqual(['passage']);
    });
});

describe('searchHitPaths', () => {
    it('returns the matched paths for change detection', () => {
        const state = createSearchState();
        state.hits.set('a.md', { path: 'a.md', source: 'body', evidence: [] });
        state.hits.set('b.md', { path: 'b.md', source: 'timelineFields', evidence: [] });
        expect(searchHitPaths(state)).toEqual(new Set(['a.md', 'b.md']));
    });
});
