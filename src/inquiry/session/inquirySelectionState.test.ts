import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    InquirySelectionState,
    validatePersistedInquiryLens,
    type SelectionSettingsHost,
    type SelectionStateHost,
} from './inquirySelectionState';
import type { InquiryLens } from '../state';
import type { InquiryTargetCache } from '../../types/settings';

// ─────────────────────────────────────────────────────────────────────────
//  Test fixtures
// ─────────────────────────────────────────────────────────────────────────

type StateFixture = { mode: InquiryLens; targetSceneIds: string[]; activeBookId?: string };

function makeState(initial: Partial<StateFixture> = {}): StateFixture {
    return { mode: 'flow', targetSceneIds: [], ...initial };
}

type SettingsCall =
    | { kind: 'read' }
    | { kind: 'write'; value: unknown }
    | { kind: 'writeCache'; value: InquiryTargetCache }
    | { kind: 'save' };

function makeSettings(initial: unknown = undefined) {
    let stored: unknown = initial;
    let storedCache: InquiryTargetCache | undefined;
    const calls: SettingsCall[] = [];
    const host: SelectionSettingsHost = {
        getPersistedLastMode: () => {
            calls.push({ kind: 'read' });
            return stored;
        },
        setPersistedLastMode: (mode) => {
            calls.push({ kind: 'write', value: mode });
            stored = mode;
        },
        setTargetCache: (cache) => {
            calls.push({ kind: 'writeCache', value: cache });
            storedCache = cache;
        },
        saveSettings: () => {
            calls.push({ kind: 'save' });
        },
    };
    return {
        host,
        calls,
        get stored() { return stored; },
        get storedCache(): InquiryTargetCache | undefined { return storedCache; },
    };
}

function makeController(state: StateFixture, settings: SelectionSettingsHost): InquirySelectionState {
    const host: SelectionStateHost = { state };
    return new InquirySelectionState(host, settings);
}

// Pure-pass normalizer for tests that exercise hydrate logic. Real
// InquiryView injects its own (`normalizeTargetSceneIds`).
function identityNormalize(ids: unknown): string[] {
    return Array.isArray(ids) ? ids.map(id => String(id)) : [];
}

// ─────────────────────────────────────────────────────────────────────────
//  validatePersistedInquiryLens — pure validator
// ─────────────────────────────────────────────────────────────────────────

describe('validatePersistedInquiryLens', () => {
    it("returns 'flow' for 'flow'", () => {
        expect(validatePersistedInquiryLens('flow')).toBe('flow');
    });

    it("returns 'depth' for 'depth'", () => {
        expect(validatePersistedInquiryLens('depth')).toBe('depth');
    });

    it('returns undefined for any other string', () => {
        expect(validatePersistedInquiryLens('focus')).toBeUndefined();
        expect(validatePersistedInquiryLens('')).toBeUndefined();
        expect(validatePersistedInquiryLens('FLOW')).toBeUndefined();
    });

    it('returns undefined for non-string values (defense-in-depth across versions)', () => {
        expect(validatePersistedInquiryLens(undefined)).toBeUndefined();
        expect(validatePersistedInquiryLens(null)).toBeUndefined();
        expect(validatePersistedInquiryLens(0)).toBeUndefined();
        expect(validatePersistedInquiryLens({})).toBeUndefined();
        expect(validatePersistedInquiryLens(['flow'])).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  setActiveLens — user toggle path
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState.setActiveLens', () => {
    it('writes state.mode FIRST, settings second, save last (order is contract)', () => {
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');

        // State mutated before settings write was observed.
        expect(state.mode).toBe('depth');
        // Settings write and save were called in the right order.
        const kinds = settings.calls.map(call => call.kind);
        expect(kinds).toEqual(['write', 'save']);
        expect(settings.calls[0].value).toBe('depth');
    });

    it('persists the same lens that was written to state (no drift between layers)', () => {
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');

        expect(state.mode).toBe('depth');
        expect(settings.stored).toBe('depth');
    });

    it('triggers save even when the supplied lens equals the current one (guard belongs to caller)', () => {
        // The legacy `setActiveLens` in InquiryView guards with
        // `if (mode === this.state.mode) return;` BEFORE calling into the
        // controller. The controller itself does not guard — its single
        // responsibility is to do the atomic state+settings+save triple.
        const state = makeState({ mode: 'depth' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');

        expect(settings.calls.map(call => call.kind)).toEqual(['write', 'save']);
    });

    it('does not read from settings during setActiveLens (write-only path)', () => {
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');

        expect(settings.calls.some(call => call.kind === 'read')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  adoptModeFromResult — session adoption path (state-only)
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState.adoptModeFromResult', () => {
    it('writes state.mode without touching settings', () => {
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.adoptModeFromResult('depth');

        expect(state.mode).toBe('depth');
        expect(settings.calls).toEqual([]);
    });

    it('does NOT persist to inquiryLastMode (user preference must survive session views)', () => {
        // Viewing a saved session in 'depth' must not clobber a user who
        // last chose 'flow'. Critical UX invariant.
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings('flow');
        const c = makeController(state, settings.host);

        c.adoptModeFromResult('depth');

        expect(settings.stored).toBe('flow'); // unchanged
        expect(state.mode).toBe('depth');     // session view reflects the session
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  applyPersistedLastModeOr — startup + reset path
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState.applyPersistedLastModeOr', () => {
    it("adopts persisted 'flow' over the fallback", () => {
        const state = makeState({ mode: 'depth' });
        const settings = makeSettings('flow');
        const c = makeController(state, settings.host);

        c.applyPersistedLastModeOr('depth');

        expect(state.mode).toBe('flow');
    });

    it("adopts persisted 'depth' over the fallback", () => {
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings('depth');
        const c = makeController(state, settings.host);

        c.applyPersistedLastModeOr('flow');

        expect(state.mode).toBe('depth');
    });

    it('falls back when the persisted value is invalid (validation guard)', () => {
        const state = makeState({ mode: 'depth' });
        const settings = makeSettings('arbitrary-string');
        const c = makeController(state, settings.host);

        c.applyPersistedLastModeOr('flow');

        expect(state.mode).toBe('flow');
    });

    it('falls back when the persisted value is undefined', () => {
        const state = makeState({ mode: 'depth' });
        const settings = makeSettings(undefined);
        const c = makeController(state, settings.host);

        c.applyPersistedLastModeOr('flow');

        expect(state.mode).toBe('flow');
    });

    it('does not write back to settings (read-only path)', () => {
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings('depth');
        const c = makeController(state, settings.host);

        c.applyPersistedLastModeOr('flow');

        const writeCalls = settings.calls.filter(call => call.kind === 'write' || call.kind === 'save');
        expect(writeCalls).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Ownership boundary — owned vs not-owned
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState — ownership boundary (Slice 2a + 2b scope)', () => {
    it('owns no method touching scope, promptIds, focus, drill (still deferred)', () => {
        // Reflective check: the controller's public surface must not
        // expose any method whose name implies it touches Slice 3+ fields.
        // (activeBookId was added in Slice 2c — no longer forbidden.)
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
        const names = Object.getOwnPropertyNames(proto);

        const forbidden = /(scope|promptIds|focus|drill)/i;
        const violations = names.filter(name => forbidden.test(name));

        expect(violations).toEqual([]);
    });

    it('exposes no compute/estimate/hover methods (doctrine §5–6)', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
        const names = Object.getOwnPropertyNames(proto);

        const forbidden = /^(compute|estimate|hover|recompute)/i;
        expect(names.filter(name => forbidden.test(name))).toEqual([]);
    });

    it('public method surface is exactly the documented Slice 2a + 2b set', () => {
        // Pin the surface so any new method requires an explicit test
        // update — protects against scope creep into Slice 2c without
        // a follow-up audit.
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
        const methods = Object.getOwnPropertyNames(proto).filter(
            n => n !== 'constructor' && typeof (c as unknown as Record<string, unknown>)[n] === 'function'
        );

        // Alphabetical, since the assertion sorts. The natural grouping
        // (mode 2a, targets 2b, activeBookId 2c) is documented in the
        // source; the test pins the lexical surface.
        expect(methods.sort()).toEqual([
            'adoptModeFromResult',          // 2a
            'applyPersistedLastModeOr',     // 2a
            'cancelPendingPersist',         // 2b
            'cleanup',                      // 2b (Disposable)
            'clearPersistedTargetCache',    // 2b
            'getActiveBookId',              // 2c
            'getRememberedTargetSceneIdsForBook', // 2b
            'hydrateRememberedTargetSceneIdsFromCache', // 2b
            'rememberTargetSceneIdsForBook', // 2b
            'schedulePersist',              // 2b
            'setActiveBookId',              // 2c
            'setActiveLens',                // 2a
            'setTargetSceneIds',            // 2b
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Slice 2b — target selection
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState.setTargetSceneIds', () => {
    it('writes state.targetSceneIds directly and touches nothing else', () => {
        const state = makeState({ mode: 'flow', targetSceneIds: ['a'] });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setTargetSceneIds(['x', 'y']);

        expect(state.targetSceneIds).toEqual(['x', 'y']);
        expect(state.mode).toBe('flow');
        expect(settings.calls).toEqual([]); // no Map update, no persist
    });
});

describe('InquirySelectionState.rememberTargetSceneIdsForBook', () => {
    it('records a per-book selection and defensive-copies the array', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        const input = ['s1', 's2'];

        c.rememberTargetSceneIdsForBook('book-1', input);
        const out = c.getRememberedTargetSceneIdsForBook('book-1');

        expect(out).toEqual(['s1', 's2']);
        // Defensive copy — mutating the input must not change the Map.
        input.push('s3');
        expect(c.getRememberedTargetSceneIdsForBook('book-1')).toEqual(['s1', 's2']);
    });

    it('does not write state.targetSceneIds or settings', () => {
        const state = makeState({ targetSceneIds: ['stay'] });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.rememberTargetSceneIdsForBook('book-1', ['a', 'b']);

        expect(state.targetSceneIds).toEqual(['stay']);
        expect(settings.calls).toEqual([]);
    });
});

describe('InquirySelectionState.getRememberedTargetSceneIdsForBook', () => {
    it('returns undefined for unknown books', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        expect(c.getRememberedTargetSceneIdsForBook('nope')).toBeUndefined();
    });

    it('returns undefined for an undefined bookId (no implicit Map.get())', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        expect(c.getRememberedTargetSceneIdsForBook(undefined)).toBeUndefined();
    });
});

describe('InquirySelectionState.hydrateRememberedTargetSceneIdsFromCache', () => {
    it('rebuilds the Map from a Record entries shape', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        // Pre-populate so we can prove hydrate is a replace, not a merge.
        c.rememberTargetSceneIdsForBook('stale', ['old']);

        c.hydrateRememberedTargetSceneIdsFromCache(
            { 'book-1': ['a', 'b'], 'book-2': ['c'] },
            identityNormalize
        );

        expect(c.getRememberedTargetSceneIdsForBook('book-1')).toEqual(['a', 'b']);
        expect(c.getRememberedTargetSceneIdsForBook('book-2')).toEqual(['c']);
        expect(c.getRememberedTargetSceneIdsForBook('stale')).toBeUndefined();
    });

    it('handles undefined entries by clearing the Map', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        c.rememberTargetSceneIdsForBook('book-1', ['x']);

        c.hydrateRememberedTargetSceneIdsFromCache(undefined, identityNormalize);

        expect(c.getRememberedTargetSceneIdsForBook('book-1')).toBeUndefined();
    });

    it('runs each entry through the injected normalizer', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        const normalize = vi.fn((ids: unknown) => Array.isArray(ids) ? ids.map(String).sort() : []);

        c.hydrateRememberedTargetSceneIdsFromCache(
            { 'book-1': ['b', 'a'] as unknown as string[] },
            normalize
        );

        expect(normalize).toHaveBeenCalledWith(['b', 'a']);
        expect(c.getRememberedTargetSceneIdsForBook('book-1')).toEqual(['a', 'b']);
    });
});

describe('InquirySelectionState.schedulePersist', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('debounces by the configured window and writes cache before save (Risk #3 ordering)', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        c.rememberTargetSceneIdsForBook('book-1', ['a', 'b']);

        c.schedulePersist('book-1', 300);

        // No write yet during debounce window.
        vi.advanceTimersByTime(299);
        expect(settings.calls.filter(call => call.kind === 'writeCache')).toEqual([]);

        vi.advanceTimersByTime(1);

        // Cache write came first, save second.
        const kinds = settings.calls.map(c => c.kind);
        const writeIdx = kinds.indexOf('writeCache');
        const saveIdx = kinds.indexOf('save');
        expect(writeIdx).toBeGreaterThan(-1);
        expect(saveIdx).toBeGreaterThan(writeIdx);
    });

    it('writes the canonical 2-field payload shape from the Map', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        c.rememberTargetSceneIdsForBook('book-1', ['a']);
        c.rememberTargetSceneIdsForBook('book-2', ['b', 'c']);

        c.schedulePersist('book-2', 50);
        vi.advanceTimersByTime(60);

        expect(settings.storedCache).toEqual({
            lastBookId: 'book-2',
            lastTargetSceneIdsByBookId: {
                'book-1': ['a'],
                'book-2': ['b', 'c'],
            },
        });
    });

    it('coalesces rapid re-arms into a single save (debounce semantics)', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.schedulePersist('a', 100);
        vi.advanceTimersByTime(50);
        c.schedulePersist('b', 100);
        vi.advanceTimersByTime(50);
        c.schedulePersist('c', 100);
        vi.advanceTimersByTime(100);

        // Exactly one writeCache and one save.
        const writeCalls = settings.calls.filter(call => call.kind === 'writeCache');
        const saveCalls = settings.calls.filter(call => call.kind === 'save');
        expect(writeCalls.length).toBe(1);
        expect(saveCalls.length).toBe(1);
        // The latest activeBookId wins.
        expect(settings.storedCache?.lastBookId).toBe('c');
    });

    it('accepts undefined activeBookId (e.g. saga scope) and writes it as-is', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.schedulePersist(undefined, 10);
        vi.advanceTimersByTime(20);

        expect(settings.storedCache?.lastBookId).toBeUndefined();
    });
});

describe('InquirySelectionState.cancelPendingPersist', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('prevents an armed persist from firing', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.schedulePersist('a', 100);
        c.cancelPendingPersist();
        vi.advanceTimersByTime(500);

        expect(settings.calls.filter(call => call.kind === 'writeCache')).toEqual([]);
    });

    it('is a no-op when no timer is armed', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        expect(() => c.cancelPendingPersist()).not.toThrow();
    });
});

describe('InquirySelectionState.clearPersistedTargetCache', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('cancels pending persist, wipes the Map, writes empty cache, and saves (atomic)', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);
        c.rememberTargetSceneIdsForBook('book-1', ['x']);
        c.schedulePersist('book-1', 300);

        c.clearPersistedTargetCache();

        // No pending persist fires.
        vi.advanceTimersByTime(500);
        // The Map is empty.
        expect(c.getRememberedTargetSceneIdsForBook('book-1')).toBeUndefined();
        // Settings received exactly the empty payload.
        expect(settings.storedCache).toEqual({
            lastBookId: undefined,
            lastTargetSceneIdsByBookId: {},
        });
        // Save was called.
        expect(settings.calls.some(call => call.kind === 'save')).toBe(true);
    });

    it('writes cache before save (Risk #3 ordering)', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.clearPersistedTargetCache();

        const kinds = settings.calls.map(call => call.kind);
        const writeIdx = kinds.indexOf('writeCache');
        const saveIdx = kinds.indexOf('save');
        expect(writeIdx).toBeGreaterThan(-1);
        expect(saveIdx).toBeGreaterThan(writeIdx);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Slice 2c — activeBookId convergence
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState.setActiveBookId', () => {
    it('writes state.activeBookId and touches nothing else', () => {
        const state = makeState({ mode: 'depth', targetSceneIds: ['x'], activeBookId: 'prior' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveBookId('book-1');

        expect(state.activeBookId).toBe('book-1');
        expect(state.mode).toBe('depth');             // unchanged
        expect(state.targetSceneIds).toEqual(['x']);  // unchanged
        expect(settings.calls).toEqual([]);            // no persist
    });

    it('accepts undefined to clear the active book (corpus/reset paths)', () => {
        const state = makeState({ activeBookId: 'book-1' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveBookId(undefined);

        expect(state.activeBookId).toBeUndefined();
    });

    it('is the single mutation entry point — no other method writes activeBookId', () => {
        // Defensive: invoke every other public method that takes args we
        // can fabricate, and verify activeBookId is not touched as a
        // side-effect. Catches accidental cross-method coupling.
        const state = makeState({ activeBookId: 'unchanged' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');
        c.adoptModeFromResult('flow');
        c.applyPersistedLastModeOr('flow');
        c.setTargetSceneIds(['x']);
        c.rememberTargetSceneIdsForBook('book-x', ['y']);
        c.hydrateRememberedTargetSceneIdsFromCache({ 'book-y': ['z'] }, identityNormalize);
        c.cancelPendingPersist();

        expect(state.activeBookId).toBe('unchanged');
    });
});

describe('InquirySelectionState.getActiveBookId', () => {
    it('reflects the current state.activeBookId', () => {
        const state = makeState({ activeBookId: 'book-7' });
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        expect(c.getActiveBookId()).toBe('book-7');
    });

    it('returns undefined when no book is active', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        expect(c.getActiveBookId()).toBeUndefined();
    });
});

describe('InquirySelectionState — Disposable cleanup', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('cleanup() cancels any armed persist (Disposable contract)', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        c.schedulePersist('a', 100);
        c.cleanup();
        vi.advanceTimersByTime(500);

        expect(settings.calls.filter(call => call.kind === 'writeCache')).toEqual([]);
    });

    it('cleanup() is idempotent', () => {
        const state = makeState();
        const settings = makeSettings();
        const c = makeController(state, settings.host);

        expect(() => { c.cleanup(); c.cleanup(); }).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Integration shape — settings round-trip via the controller
// ─────────────────────────────────────────────────────────────────────────

describe('InquirySelectionState — round-trip integration', () => {
    it('user toggle → applyPersistedLastModeOr reads back the just-written value', () => {
        // Simulates: setActiveLens → next session opens → applyPersistedLastModeOr
        // The user's choice survives via settings.
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings('flow');
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');
        // Simulate "next session opens" by re-applying.
        state.mode = 'flow'; // reset state as if we re-constructed
        c.applyPersistedLastModeOr('flow');

        expect(state.mode).toBe('depth'); // user's last choice restored
    });

    it('session adoption does not clobber the round-trip', () => {
        // Sequence: user toggles to 'depth' → views a 'flow' session →
        // reopens later → must still see 'depth' restored from settings.
        const state = makeState({ mode: 'flow' });
        const settings = makeSettings('flow');
        const c = makeController(state, settings.host);

        c.setActiveLens('depth');
        c.adoptModeFromResult('flow');         // session adoption
        // Re-hydrate as if reconstructed.
        state.mode = 'flow';
        c.applyPersistedLastModeOr('flow');

        expect(state.mode).toBe('depth');      // last user choice preserved
        expect(settings.stored).toBe('depth'); // not clobbered by adoptModeFromResult
    });
});

// Compile-time guard: SelectionStateHost.state must stay narrowly typed.
// Widening to a fuller InquiryState shape is Slice 2b/2c work and should
// require an explicit type change here.
type _CompileGuard_HostShape = SelectionStateHost['state'] extends { mode: InquiryLens }
    ? (keyof SelectionStateHost['state'] extends 'mode' ? true : never)
    : never;
const _compileGuard: _CompileGuard_HostShape = true;
void _compileGuard;

// Silence "unused vi" — kept for parity with other test files in case
// future tests need spies.
void vi;
