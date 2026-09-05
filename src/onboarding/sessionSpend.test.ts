import { describe, it, expect } from 'vitest';
import {
    captureSpendFields,
    applySpendFields,
    SPEND_SESSION_KEYS,
    type SpendSessionFields
} from './sessionSpend';
import { resolveSpendLabel } from './spendLabel';

const LIVE: SpendSessionFields = {
    manuscriptChars: 699_512,
    chapterCount: 24,
    forecastSceneCount: 95,
    costProvider: 'anthropic' as const,
    costModelId: 'claude-haiku-4-5',
    costSubstitutedFrom: null
};

const blank = (): SpendSessionFields => ({
    manuscriptChars: 0,
    chapterCount: 0,
    forecastSceneCount: null,
    costProvider: null,
    costModelId: null,
    costSubstitutedFrom: null
});

describe('spend session round trip', () => {
    // REGRESSION — review round 3. The prior "resume" test hand-built a state
    // that already contained the pricing identity, so deleting the fields from
    // persist/restore would not have failed it. This drives the real pair.
    it('carries every spend field through capture and restore', () => {
        const restored = blank();
        applySpendFields(restored, captureSpendFields(LIVE));
        expect(restored).toEqual(LIVE);
    });

    it('covers every key of the type — no field can be silently dropped', () => {
        const snapshot = captureSpendFields(LIVE);
        expect(Object.keys(snapshot).sort()).toEqual([...SPEND_SESSION_KEYS].sort());
        // And every key actually round-trips a non-default value.
        for (const key of SPEND_SESSION_KEYS) {
            expect(snapshot[key]).toEqual(LIVE[key]);
        }
    });

    it('a resumed session can still price the run — the original defect', () => {
        const resumed = blank();
        applySpendFields(resumed, captureSpendFields(LIVE));
        const label = resolveSpendLabel(
            { aiAvailable: true, engine: 'cloud', ...resumed },
            () => 1.01,
            (v) => `~$${v.toFixed(2)}`
        );
        expect(label.kind).toBe('estimate');
    });

    it('a session that never resolved pricing hides rather than showing zero', () => {
        const resumed = blank();
        applySpendFields(resumed, captureSpendFields({ ...LIVE, costModelId: null }));
        const label = resolveSpendLabel(
            { aiAvailable: true, engine: 'cloud', ...resumed },
            () => 1.01,
            (v) => `~$${v.toFixed(2)}`
        );
        expect(label.kind).toBe('hidden');
    });
});
