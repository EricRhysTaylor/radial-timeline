import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getEstimatedProgressRatio,
    PROGRESS_AT_ESTIMATE,
    PROGRESS_CEILING,
    SimulatedProgress
} from './simulatedProgress';

describe('estimated progress curve', () => {
    it('fills linearly to the estimate mark', () => {
        expect(getEstimatedProgressRatio(0, 60_000)).toBe(0);
        expect(getEstimatedProgressRatio(30_000, 60_000)).toBeCloseTo(PROGRESS_AT_ESTIMATE / 2, 6);
        expect(getEstimatedProgressRatio(60_000, 60_000)).toBeCloseTo(PROGRESS_AT_ESTIMATE, 6);
    });

    it('never claims the run is done while it overruns', () => {
        // Sherlock Inquiry Payoff: timed for 45.4s, answered at 84.9s.
        const atAnswer = getEstimatedProgressRatio(84_930, 45_370);
        expect(atAnswer).toBeGreaterThan(PROGRESS_AT_ESTIMATE);
        expect(atAnswer).toBeLessThan(PROGRESS_CEILING);
        expect(getEstimatedProgressRatio(3_600_000, 45_370)).toBeLessThanOrEqual(PROGRESS_CEILING);
    });

    it('keeps rising through an overrun', () => {
        const samples = [45_370, 60_000, 84_930, 120_000].map(ms => getEstimatedProgressRatio(ms, 45_370));
        samples.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(samples[index]));
    });

    it('treats a zero budget as one second', () => {
        expect(getEstimatedProgressRatio(1000, 0)).toBeCloseTo(PROGRESS_AT_ESTIMATE, 6);
    });
});

describe('SimulatedProgress', () => {
    afterEach(() => vi.useRealTimers());

    it('eases past the estimate without reaching 100% until completed', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        const update = vi.fn();
        const progress = new SimulatedProgress(update);
        progress.start(1000);
        vi.advanceTimersByTime(1000);
        // Ticks every 16ms, so the last update lands just before the estimate.
        expect(update.mock.lastCall?.[0]).toBeGreaterThan(PROGRESS_AT_ESTIMATE * 100 - 2);
        expect(update.mock.lastCall?.[0]).toBeLessThanOrEqual(PROGRESS_AT_ESTIMATE * 100);
        vi.advanceTimersByTime(5000);
        expect(update.mock.lastCall?.[0]).toBeLessThan(PROGRESS_CEILING * 100 + 1e-9);
        expect(update.mock.lastCall?.[0]).toBeGreaterThan(PROGRESS_AT_ESTIMATE * 100);
        expect(vi.getTimerCount()).toBe(1);
        progress.complete();
        expect(update).toHaveBeenLastCalledWith(100);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops without displaying completion when processing fails', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        const update = vi.fn();
        const progress = new SimulatedProgress(update);
        progress.start(1000);
        vi.advanceTimersByTime(500);
        progress.fail();
        expect(update.mock.calls.every(([percent]) => percent < 100)).toBe(true);
        expect(update).toHaveBeenLastCalledWith(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('restarts cleanly and stops on close', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        const progress = new SimulatedProgress(vi.fn());
        progress.start(1000);
        progress.start(1000);
        expect(vi.getTimerCount()).toBe(1);
        progress.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});
