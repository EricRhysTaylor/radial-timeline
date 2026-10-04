import { describe, expect, it } from 'vitest';
import { estimateGossamerRunMs, GOSSAMER_FIRST_RUN_MS, type GossamerRunTiming } from './runTiming';

describe('shared Gossamer timing', () => {
    it('uses the first-run default before any observation', () => {
        expect(estimateGossamerRunMs(undefined)).toEqual({ durationMs: GOSSAMER_FIRST_RUN_MS, source: 'first_run_default' });
    });

    it('times every next signal from the latest request', () => {
        let previous: GossamerRunTiming | undefined;
        let expected = GOSSAMER_FIRST_RUN_MS;
        // The observed Odyssey sequence: Momentum, Tension, Activity, Interiority.
        for (const durationMs of [18815, 15208, 16849, 15663]) {
            expect(estimateGossamerRunMs(previous).durationMs).toBe(expected);
            previous = { schemaVersion: 2, durationMs };
            expected = durationMs;
        }
        expect(estimateGossamerRunMs(previous)).toEqual({ durationMs: 15663, source: 'latest_run' });
    });

    it('ignores manuscript-scaled and unusable observations', () => {
        // SAFE: persisted JSON can violate the TypeScript settings shape.
        const persisted = (value: unknown) => value as GossamerRunTiming;
        expect(estimateGossamerRunMs(persisted({ schemaVersion: 1, durationMs: 18000, manuscriptWords: 100000 })).source).toBe('first_run_default');
        for (const invalid of [0, -1, NaN, Infinity]) {
            expect(estimateGossamerRunMs({ schemaVersion: 2, durationMs: invalid }).source).toBe('first_run_default');
        }
    });
});
