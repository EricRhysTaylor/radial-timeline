import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    InquiryCorpusSnapshotController,
    type CorpusSnapshotHost,
} from './InquiryCorpusSnapshotController';
import type { InquiryCorpusSnapshot } from '../services/InquiryCorpusResolver';
import type { InquirySourcesSettings } from '../../types/settings';

// ─────────────────────────────────────────────────────────────────────────
//  Mocks
// ─────────────────────────────────────────────────────────────────────────

// We mock the underlying InquiryCorpusResolver so the controller's
// contract can be exercised without spinning up a real vault.
// Captures the constructor args + resolve calls for verification.

const resolveCalls: Array<{ args: unknown; mappings: Record<string, string> }> = [];
const resolverCtorCalls: Array<{ mappings: Record<string, string> }> = [];

vi.mock('../services/InquiryCorpusResolver', async () => {
    return {
        InquiryCorpusResolver: class MockInquiryCorpusResolver {
            constructor(_vault: unknown, _meta: unknown, public readonly mappings: Record<string, string>) {
                resolverCtorCalls.push({ mappings: { ...mappings } });
            }
            resolve(args: unknown): InquiryCorpusSnapshot {
                resolveCalls.push({ args, mappings: { ...this.mappings } });
                return {
                    scope: 'book',
                    resolvedRoots: [],
                    books: [],
                    scenes: [],
                    activeBookId: undefined,
                    bookResolved: true,
                } as InquiryCorpusSnapshot;
            }
        },
    };
});

// ─────────────────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────────────────

function makeHost(initial?: InquiryCorpusSnapshot): CorpusSnapshotHost {
    return { corpus: initial };
}

function makeSources(): InquirySourcesSettings {
    return {
        preset: 'default',
        scanRoots: [],
        classScope: [],
        classes: [],
        classCounts: {},
    } as unknown as InquirySourcesSettings;
}

function makeController(
    host: CorpusSnapshotHost,
    mappings: Record<string, string> = { class: 'Class', when: 'When' }
): InquiryCorpusSnapshotController {
    return new InquiryCorpusSnapshotController(
        host,
        { /* vault */ } as never,
        { /* metadataCache */ } as never,
        () => mappings
    );
}

beforeEach(() => {
    resolveCalls.length = 0;
    resolverCtorCalls.length = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
//  refresh() — the only public mutation
// ─────────────────────────────────────────────────────────────────────────

describe('InquiryCorpusSnapshotController.refresh', () => {
    it('writes the resolved snapshot to host.corpus and returns it', () => {
        const host = makeHost();
        const c = makeController(host);

        const result = c.refresh({
            scope: 'book',
            activeBookId: 'book-1',
            sources: makeSources(),
            bookProfiles: undefined,
        });

        expect(result).toBeTruthy();
        expect(host.corpus).toBe(result);
    });

    it('forwards scope / activeBookId / sources / bookProfiles to the resolver verbatim', () => {
        const host = makeHost();
        const c = makeController(host);
        const sources = makeSources();
        const bookProfiles = [{ id: 'b1' }] as never;

        c.refresh({
            scope: 'saga',
            activeBookId: 'b1',
            sources,
            bookProfiles,
        });

        expect(resolveCalls).toHaveLength(1);
        expect(resolveCalls[0].args).toEqual({
            scope: 'saga',
            activeBookId: 'b1',
            sources,
            bookProfiles,
        });
    });

    it('reconstructs a fresh resolver on every refresh (audit Risk #1)', () => {
        const host = makeHost();
        const c = makeController(host);

        c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });
        c.refresh({ scope: 'book', activeBookId: 'b', sources: makeSources(), bookProfiles: undefined });
        c.refresh({ scope: 'book', activeBookId: 'c', sources: makeSources(), bookProfiles: undefined });

        // Three refreshes → three constructor calls. No resolver caching.
        expect(resolverCtorCalls).toHaveLength(3);
    });

    it('reads frontmatter mappings on every refresh (closure pattern, audit Risk #1)', () => {
        // Settings can mutate between refreshes; the closure must see the
        // CURRENT mappings, not a frozen snapshot from construction.
        let mappings: Record<string, string> = { class: 'A' };
        const host = makeHost();
        const c = new InquiryCorpusSnapshotController(
            host,
            { /* vault */ } as never,
            { /* metadataCache */ } as never,
            () => mappings
        );

        c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });
        mappings = { class: 'B' }; // simulate a settings-driven change
        c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });

        expect(resolverCtorCalls).toHaveLength(2);
        expect(resolverCtorCalls[0].mappings).toEqual({ class: 'A' });
        expect(resolverCtorCalls[1].mappings).toEqual({ class: 'B' });
    });

    it('writes host.corpus BEFORE returning (write-through is observable in the caller)', () => {
        // Critical for the InquiryView reconcile chain: the reconcile reads
        // this.corpus.X immediately after calling controller.refresh().
        // The write must have happened by the time refresh() returns.
        const host = makeHost();
        const c = makeController(host);

        c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });

        expect(host.corpus).toBeTruthy();
        expect(host.corpus?.scope).toBe('book');
    });

    it('safe to call repeatedly (omnibus dual-call shape — audit Risk #5)', () => {
        const host = makeHost();
        const c = makeController(host);

        // Two consecutive calls, matching the runOmnibusInquiry pattern.
        c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });
        const second = c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });

        // Second call returns a fresh snapshot (not the first reference).
        // Both calls populated host.corpus.
        expect(host.corpus).toBe(second);
        expect(resolveCalls).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  getSnapshot() — read accessor
// ─────────────────────────────────────────────────────────────────────────

describe('InquiryCorpusSnapshotController.getSnapshot', () => {
    it('returns undefined before any refresh', () => {
        const host = makeHost();
        const c = makeController(host);
        expect(c.getSnapshot()).toBeUndefined();
    });

    it('returns the host.corpus value (reads through, not a frozen mirror)', () => {
        const host = makeHost();
        const c = makeController(host);

        c.refresh({ scope: 'book', activeBookId: 'a', sources: makeSources(), bookProfiles: undefined });
        const first = c.getSnapshot();

        // External mutation of host.corpus (e.g. a future co-controller)
        // is reflected by the accessor — no internal cache.
        const replacement = { ...first!, activeBookId: 'replaced' };
        host.corpus = replacement;

        expect(c.getSnapshot()).toBe(replacement);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Ownership boundary (matches the campaign's reflective doctrine checks)
// ─────────────────────────────────────────────────────────────────────────

describe('InquiryCorpusSnapshotController — ownership boundary', () => {
    it('public surface is exactly: refresh + getSnapshot', () => {
        const host = makeHost();
        const c = makeController(host);

        const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
        const methods = Object.getOwnPropertyNames(proto).filter(
            n => n !== 'constructor' && typeof (c as unknown as Record<string, unknown>)[n] === 'function'
        );

        expect(methods.sort()).toEqual(['getSnapshot', 'refresh']);
    });

    it('exposes no compute/estimate/hover/recompute methods (doctrine §5–6)', () => {
        const host = makeHost();
        const c = makeController(host);

        const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
        const names = Object.getOwnPropertyNames(proto);

        const forbidden = /^(compute|estimate|hover|recompute)/i;
        expect(names.filter(name => forbidden.test(name))).toEqual([]);
    });

    it('exposes no methods touching reconcile / persist / warning / scope / run (audit §3)', () => {
        // Slice 1 is snapshot-only. Any method whose name implies it
        // crosses into reconcile, persistence, warning, scope, or run
        // territory is scope creep into the deferred slices.
        const host = makeHost();
        const c = makeController(host);

        const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
        const names = Object.getOwnPropertyNames(proto);

        const forbidden = /(reconcile|persist|warning|scope[A-Z]|isRunning|abort|cache[A-Z]|runner)/i;
        expect(names.filter(name => forbidden.test(name))).toEqual([]);
    });
});
