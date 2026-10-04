import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateGossamerRunMs, type GossamerRunTiming } from './runTiming';
import { SimulatedProgress } from '../utils/simulatedProgress';

describe('shared Gossamer timing', () => {
    it('uses a one-minute initial estimate before any observation', () => {
        expect(estimateGossamerRunMs(100000)).toBe(60000);
    });

    it('updates every next trace immediately on the same manuscript', () => {
        let previous: GossamerRunTiming | undefined;
        let expected = 60000;
        // The observed Odyssey sequence: Momentum, Tension, Activity, Interiority.
        for (const durationMs of [18815, 15208, 16849, 15663]) {
            expect(estimateGossamerRunMs(100000, previous)).toBe(expected);
            previous = { schemaVersion: 1, durationMs, manuscriptWords: 100000 };
            expected = durationMs;
        }
        expect(estimateGossamerRunMs(100000, previous)).toBe(15663);
    });

    it('scales the observation proportionally for a different manuscript size', () => {
        const previous: GossamerRunTiming = { schemaVersion: 1, durationMs: 20000, manuscriptWords: 100000 };
        expect(estimateGossamerRunMs(200000, previous)).toBe(40000);
        expect(estimateGossamerRunMs(50000, previous)).toBe(10000);
    });

    it('bounds the animation estimate at five seconds and five minutes', () => {
        const previous: GossamerRunTiming = { schemaVersion: 1, durationMs: 20000, manuscriptWords: 100000 };
        expect(estimateGossamerRunMs(1, previous)).toBe(5000);
        expect(estimateGossamerRunMs(10000000, previous)).toBe(300000);
    });

    it('ignores unusable timing or size instead of animating with an invalid duration', () => {
        const previous: GossamerRunTiming = { schemaVersion: 1, durationMs: 20000, manuscriptWords: 100000 };
        for (const invalid of [0, -1, NaN, Infinity]) {
            expect(estimateGossamerRunMs(invalid, previous)).toBe(60000);
            expect(estimateGossamerRunMs(100000, { ...previous, durationMs: invalid })).toBe(60000);
            expect(estimateGossamerRunMs(100000, { ...previous, manuscriptWords: invalid })).toBe(60000);
        }
    });
});

describe('Gossamer estimated progress overrun', () => {
    afterEach(() => vi.useRealTimers());

    it('holds below 100% past the estimate and completes only when explicitly finished', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        const update = vi.fn();
        const progress = new SimulatedProgress(update);
        progress.start({ durationMs: 1000, startPercent: 0, maxPercent: 95, jitter: 0, completeOnDuration: false });
        vi.advanceTimersByTime(3000);
        expect(update.mock.calls.every(([percent]) => percent < 100)).toBe(true);
        expect(update).toHaveBeenLastCalledWith(95);
        progress.complete();
        expect(update).toHaveBeenLastCalledWith(100);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops without displaying completion when processing fails', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        const update = vi.fn();
        const progress = new SimulatedProgress(update);
        progress.start({ durationMs: 1000, maxPercent: 95, jitter: 0, completeOnDuration: false });
        vi.advanceTimersByTime(2000);
        progress.fail();
        expect(update.mock.calls.every(([percent]) => percent < 100)).toBe(true);
        expect(update).toHaveBeenLastCalledWith(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
