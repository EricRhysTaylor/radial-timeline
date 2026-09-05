import { describe, it, expect } from 'vitest';
import { resolveSpendLabel, type SpendLabelState } from './spendLabel';

const usd = (v: number) => `~$${v.toFixed(1)}`;
const price = (scenes: number) => 0.5 + scenes * 0.01;

const CLOUD: SpendLabelState = {
    aiAvailable: true,
    engine: 'cloud',
    costProvider: 'anthropic',
    costModelId: 'claude-haiku-4-5',
    manuscriptChars: 699_512,
    forecastSceneCount: null
};

describe('resolveSpendLabel', () => {
    it('says free — not "about $0" — on the local engine', () => {
        const label = resolveSpendLabel({ ...CLOUD, engine: 'local' }, price, usd);
        expect(label.kind).toBe('free');
        expect(label.kind === 'free' && label.text).toContain('Free');
    });

    it('hides entirely in structure-only mode', () => {
        expect(resolveSpendLabel({ ...CLOUD, aiAvailable: false }, price, usd).kind).toBe('hidden');
    });

    it('quotes a floor before the scene count is known', () => {
        const label = resolveSpendLabel(CLOUD, price, usd);
        expect(label.kind).toBe('floor');
        expect(label.kind === 'floor' && label.text).toContain('from');
    });

    it('collapses to a point estimate once scenes are known', () => {
        const label = resolveSpendLabel({ ...CLOUD, forecastSceneCount: 95 }, price, usd);
        expect(label.kind).toBe('estimate');
        expect(label.kind === 'estimate' && label.text).not.toContain('from');
    });

    // REGRESSION — external review, 2026-08-21. Resume does not re-run
    // preflight, so these fields were null on every resumed session and the
    // price silently vanished. A missing price reads as "free".
    it('hides rather than lying when the cloud model is unresolved', () => {
        expect(resolveSpendLabel({ ...CLOUD, costModelId: null }, price, usd).kind).toBe('hidden');
        expect(resolveSpendLabel({ ...CLOUD, costProvider: null }, price, usd).kind).toBe('hidden');
    });

    it('restores a real price from persisted session state alone', () => {
        // Exactly what OnboardingSession now carries — no preflight involved.
        const resumed: SpendLabelState = {
            aiAvailable: true,
            engine: 'cloud',
            costProvider: 'anthropic',
            costModelId: 'claude-haiku-4-5',
            manuscriptChars: 699_512,
            forecastSceneCount: 95
        };
        const label = resolveSpendLabel(resumed, price, usd);
        expect(label.kind).toBe('estimate');
    });

    it('renders nothing when pricing is unavailable — never a zero', () => {
        const label = resolveSpendLabel({ ...CLOUD, forecastSceneCount: 95 }, () => null, usd);
        expect(label.kind).toBe('hidden');
    });

    it('hides when the manuscript has not been measured', () => {
        expect(resolveSpendLabel({ ...CLOUD, manuscriptChars: 0 }, price, usd).kind).toBe('hidden');
    });
});
