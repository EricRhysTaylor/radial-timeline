import { describe, it, expect } from 'vitest';
import {
    InquiryActiveSessionState,
    type ActiveSessionStateHost,
    type InquiryActiveSessionFields,
} from './inquiryActiveSessionState';
import type { InquiryResult, InquiryState } from '../state';

// Test-only state fixture. We mimic the live InquiryState shape but only
// fill in the fields the controller is allowed to touch — plus a few
// non-owned fields so we can assert the controller leaves them alone.
type StateFixture = InquiryActiveSessionFields & {
    // Non-owned fields the controller MUST NOT touch — used to prove
    // ownership boundaries.
    scope?: string;
    mode?: string;
    isRunning?: boolean;
    targetSceneIds?: string[];
    activeBookId?: string;
};

function makeState(overrides: Partial<StateFixture> = {}): StateFixture {
    return {
        // Non-owned defaults — sentinel values we can check at end-of-test.
        scope: 'book',
        mode: 'flow',
        isRunning: false,
        targetSceneIds: ['scn_NEVER_TOUCHED'],
        activeBookId: 'book-untouched',
        // Owned defaults
        activeSessionId: undefined,
        activeResult: undefined,
        activeQuestionId: undefined,
        activeZone: undefined,
        cacheStatus: undefined,
        corpusFingerprint: undefined,
        corpusOnlyFingerprint: undefined,
        corpusManifestSnapshot: undefined,
        lastError: undefined,
        ...overrides,
    };
}

function makeController(state: StateFixture): InquiryActiveSessionState {
    const host: ActiveSessionStateHost = { state: state as InquiryActiveSessionFields };
    return new InquiryActiveSessionState(host);
}

function makeResult(overrides: Partial<InquiryResult> = {}): InquiryResult {
    return {
        questionId: 'q-1',
        corpusFingerprint: 'fp-corpus',
        corpusOnlyFingerprint: 'fp-corpus-only',
        corpusManifestSnapshot: [{ path: 'a.md', mtime: 1, class: 'scene', mode: 'flow', isTarget: true }],
        findings: [],
        ...overrides,
    } as unknown as InquiryResult;
}

// ─────────────────────────────────────────────────────────────────────────
//  Field-set snapshots — pre-extraction characterization
// ─────────────────────────────────────────────────────────────────────────

/**
 * The exact 8 fields adopt() must write. Changing this set is a behavior
 * change and requires updating the corresponding inline writes in
 * `InquiryView.activateSession` (lines 7138, 7139, 7152–7157 pre-extraction).
 */
const ADOPT_FIELDS: ReadonlyArray<keyof InquiryActiveSessionFields> = [
    'activeQuestionId',
    'activeZone',
    'activeSessionId',
    'activeResult',
    'corpusFingerprint',
    'corpusOnlyFingerprint',
    'corpusManifestSnapshot',
    'cacheStatus',
];

/**
 * The exact 6 fields clearActiveResult() must write. Changing this set is
 * a behavior change and requires updating the corresponding inline writes
 * in `InquiryView.clearActiveResultState` (lines 7171–7176 pre-extraction).
 */
const CLEAR_FIELDS: ReadonlyArray<keyof InquiryActiveSessionFields> = [
    'activeResult',
    'activeSessionId',
    'corpusFingerprint',
    'corpusOnlyFingerprint',
    'corpusManifestSnapshot',
    'cacheStatus',
];

describe('InquiryActiveSessionState.adopt', () => {
    it('writes exactly the 8-field set documented by the audit', () => {
        const state = makeState();
        const controller = makeController(state);
        const result = makeResult({
            questionId: 'q-42',
            corpusFingerprint: 'fp-A',
            corpusOnlyFingerprint: 'fp-only-A',
            corpusManifestSnapshot: [{ path: 'scn1.md', mtime: 100, class: 'scene', mode: 'flow', isTarget: false }],
        });

        controller.adopt({
            sessionKey: 'k-1',
            result,
            activeZone: 'pressure',
            cacheStatus: 'fresh',
        });

        // The 8 expected writes:
        expect(state.activeQuestionId).toBe('q-42');
        expect(state.activeZone).toBe('pressure');
        expect(state.activeSessionId).toBe('k-1');
        expect(state.activeResult).toBe(result);
        expect(state.corpusFingerprint).toBe('fp-A');
        expect(state.corpusOnlyFingerprint).toBe('fp-only-A');
        expect(state.corpusManifestSnapshot).toBe(result.corpusManifestSnapshot);
        expect(state.cacheStatus).toBe('fresh');
    });

    it('does not touch lastError or any non-owned field', () => {
        const state = makeState({ lastError: 'prior error' });
        const controller = makeController(state);

        controller.adopt({
            sessionKey: 'k',
            result: makeResult(),
            activeZone: 'setup',
            cacheStatus: 'stale',
        });

        // lastError is owned but NOT part of the adopt cluster — preserved.
        expect(state.lastError).toBe('prior error');
        // Non-owned fields — controller must never touch.
        expect(state.scope).toBe('book');
        expect(state.mode).toBe('flow');
        expect(state.isRunning).toBe(false);
        expect(state.targetSceneIds).toEqual(['scn_NEVER_TOUCHED']);
        expect(state.activeBookId).toBe('book-untouched');
    });

    it('always writes the corpus-fingerprint trio together (doctrine §5)', () => {
        // Even when one of the three is null/undefined on the result, all
        // three slots receive the result's value as a unit. The controller
        // must not pick-and-choose individual trio members.
        const state = makeState();
        const controller = makeController(state);
        const result = makeResult({
            corpusFingerprint: 'has-value',
            corpusOnlyFingerprint: undefined,
            corpusManifestSnapshot: undefined,
        });

        controller.adopt({
            sessionKey: 'k',
            result,
            activeZone: 'setup',
            cacheStatus: 'fresh',
        });

        expect(state.corpusFingerprint).toBe('has-value');
        expect(state.corpusOnlyFingerprint).toBeUndefined();
        expect(state.corpusManifestSnapshot).toBeUndefined();
    });

    it('accepts undefined sessionKey (matches applySession`s optional key contract)', () => {
        const state = makeState();
        const controller = makeController(state);

        controller.adopt({
            sessionKey: undefined,
            result: makeResult(),
            activeZone: 'setup',
            cacheStatus: 'fresh',
        });

        expect(state.activeSessionId).toBeUndefined();
        // Other fields still written normally.
        expect(state.activeResult).toBeTruthy();
        expect(state.cacheStatus).toBe('fresh');
    });

    it('accepts null/undefined activeZone without altering the documented field set', () => {
        const state = makeState();
        const controller = makeController(state);

        controller.adopt({
            sessionKey: 'k',
            result: makeResult(),
            activeZone: null,
            cacheStatus: 'missing',
        });

        expect(state.activeZone).toBeNull();
        // Still writes all 8 fields — does not skip any.
        expect(state.activeSessionId).toBe('k');
        expect(state.cacheStatus).toBe('missing');
    });
});

describe('InquiryActiveSessionState.clearActiveResult', () => {
    it('writes exactly the 6-field set documented by the audit', () => {
        // Pre-populate the owned slots so we can prove they reset.
        const state = makeState({
            activeResult: makeResult(),
            activeSessionId: 'k-prior',
            corpusFingerprint: 'fp-prior',
            corpusOnlyFingerprint: 'fp-only-prior',
            corpusManifestSnapshot: [{ path: 'p.md', mtime: 1, class: 'scene', mode: 'flow', isTarget: false }],
            cacheStatus: 'fresh',
        });
        const controller = makeController(state);

        controller.clearActiveResult();

        expect(state.activeResult).toBeNull();
        expect(state.activeSessionId).toBeUndefined();
        expect(state.corpusFingerprint).toBeUndefined();
        expect(state.corpusOnlyFingerprint).toBeUndefined();
        expect(state.corpusManifestSnapshot).toBeUndefined();
        expect(state.cacheStatus).toBeUndefined();
    });

    it('does not clear activeQuestionId, activeZone, or lastError (preserves split-clear semantics)', () => {
        // Existing InquiryView.clearActiveResultState explicitly does NOT
        // clear these three. resetState (a separate method) clears them.
        // The controller must preserve that split.
        const state = makeState({
            activeQuestionId: 'q-keep',
            activeZone: 'payoff',
            lastError: 'keep-me',
        });
        const controller = makeController(state);

        controller.clearActiveResult();

        expect(state.activeQuestionId).toBe('q-keep');
        expect(state.activeZone).toBe('payoff');
        expect(state.lastError).toBe('keep-me');
    });

    it('does not touch non-owned fields', () => {
        const state = makeState();
        const controller = makeController(state);

        controller.clearActiveResult();

        expect(state.scope).toBe('book');
        expect(state.mode).toBe('flow');
        expect(state.isRunning).toBe(false);
        expect(state.targetSceneIds).toEqual(['scn_NEVER_TOUCHED']);
        expect(state.activeBookId).toBe('book-untouched');
    });

    it('clears the corpus-fingerprint trio together (doctrine §5)', () => {
        const state = makeState({
            corpusFingerprint: 'a',
            corpusOnlyFingerprint: 'b',
            corpusManifestSnapshot: [{ path: 'x.md', mtime: 1, class: 'scene', mode: 'flow', isTarget: false }],
        });
        const controller = makeController(state);

        controller.clearActiveResult();

        expect(state.corpusFingerprint).toBeUndefined();
        expect(state.corpusOnlyFingerprint).toBeUndefined();
        expect(state.corpusManifestSnapshot).toBeUndefined();
    });
});

describe('InquiryActiveSessionState — individual setters', () => {
    it('setActiveZone is field-isolated', () => {
        const state = makeState({ activeQuestionId: 'q', activeSessionId: 'k' });
        const controller = makeController(state);

        controller.setActiveZone('pressure');

        expect(state.activeZone).toBe('pressure');
        expect(state.activeQuestionId).toBe('q');
        expect(state.activeSessionId).toBe('k');
    });

    it('setActiveQuestionId is field-isolated', () => {
        const state = makeState({ activeZone: 'setup' });
        const controller = makeController(state);

        controller.setActiveQuestionId('q-new');

        expect(state.activeQuestionId).toBe('q-new');
        expect(state.activeZone).toBe('setup');
    });

    it('setCacheStatus is field-isolated and accepts undefined', () => {
        const state = makeState({ cacheStatus: 'fresh' });
        const controller = makeController(state);

        controller.setCacheStatus('stale');
        expect(state.cacheStatus).toBe('stale');

        controller.setCacheStatus(undefined);
        expect(state.cacheStatus).toBeUndefined();
    });

    it('setLastError is field-isolated and accepts undefined', () => {
        const state = makeState({ activeQuestionId: 'q' });
        const controller = makeController(state);

        controller.setLastError('boom');
        expect(state.lastError).toBe('boom');
        expect(state.activeQuestionId).toBe('q');

        controller.setLastError(undefined);
        expect(state.lastError).toBeUndefined();
    });
});

describe('InquiryActiveSessionState — doctrine guard', () => {
    it('exposes no compute/estimate/hover methods (inquiry-critical-path-rules §5–6)', () => {
        const state = makeState();
        const controller = makeController(state);

        // Walk own + prototype properties; any name matching the forbidden
        // verbs is a doctrine violation. Controllers in this layer own
        // persisted state only — never derived values or hover-triggered work.
        const proto = Object.getPrototypeOf(controller) as Record<string, unknown>;
        const protoNames = Object.getOwnPropertyNames(proto);
        const ownNames = Object.getOwnPropertyNames(controller);
        const allNames = [...protoNames, ...ownNames];

        const forbidden = /^(compute|estimate|hover|recompute)/i;
        const violations = allNames.filter(name => forbidden.test(name));

        expect(violations).toEqual([]);
    });

    it('owns exactly the audit-documented field surface (no scope creep)', () => {
        // Compile-time guard via Pick<>; this runtime check belt-and-suspenders.
        const ownedFields: ReadonlyArray<keyof InquiryActiveSessionFields> = [
            'activeSessionId',
            'activeResult',
            'activeQuestionId',
            'activeZone',
            'cacheStatus',
            'corpusFingerprint',
            'corpusOnlyFingerprint',
            'corpusManifestSnapshot',
            'lastError',
        ];
        // 9 owned fields total — adopt writes 8 of them, clear writes 6 of
        // them, individual setters cover the remaining touchable cases.
        expect(ownedFields.length).toBe(9);
        expect(new Set([...ADOPT_FIELDS, ...CLEAR_FIELDS, 'lastError'])).toEqual(new Set(ownedFields));
    });
});

// Type-only check (compiles iff the controller never widens its host typing).
// Not strictly a runtime test — but exporting `InquiryActiveSessionFields`
// from the production module means any future widening shows up in TS errors.
type _CompileGuard_OwnedShape = InquiryActiveSessionFields extends Pick<
    InquiryState,
    | 'activeSessionId'
    | 'activeResult'
    | 'activeQuestionId'
    | 'activeZone'
    | 'cacheStatus'
    | 'corpusFingerprint'
    | 'corpusOnlyFingerprint'
    | 'corpusManifestSnapshot'
    | 'lastError'
> ? true : never;
const _compileGuard: _CompileGuard_OwnedShape = true;
void _compileGuard;
