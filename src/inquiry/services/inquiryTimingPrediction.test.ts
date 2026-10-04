import { describe, expect, it } from 'vitest';
import {
    FIRST_RUN_PASS_MS,
    getInquiryTimingSample,
    getLatestTimingEntry,
    getRunDurationRange,
    predictRunDuration,
    PREDICT_FLOOR_MS
} from './inquiryTimingPrediction';
import type { InquiryTimingHistory, InquiryTimingHistoryEntry } from '../../types/settings';

const observation = (passDurationMs: number): InquiryTimingHistoryEntry => ({
    schemaVersion: 2,
    passDurationMs,
    updatedAt: '2026-10-04T19:46:43Z'
});

describe('Inquiry timing sample', () => {
    it('keeps the time of one provider pass', () => {
        expect(getInquiryTimingSample(45_370, 1)).toEqual({ passDurationMs: 45_370 });
        expect(getInquiryTimingSample(180_000, 3)).toEqual({ passDurationMs: 60_000 });
    });

    it('rejects unusable durations and pass counts', () => {
        for (const invalid of [0, -1, NaN, Infinity, undefined, null]) {
            expect(getInquiryTimingSample(invalid, 1)).toBeNull();
        }
        for (const invalid of [0, -1, 1.5, NaN]) {
            expect(getInquiryTimingSample(45_000, invalid)).toBeNull();
        }
    });
});

describe('saved observation', () => {
    it('reads the latest schema-2 observation', () => {
        const latest = observation(45_370);
        expect(getLatestTimingEntry({ latest })).toBe(latest);
    });

    it('ignores input-scaled observations and malformed JSON', () => {
        // SAFE: persisted JSON can violate the TypeScript settings shape.
        const legacy = (value: unknown) => ({ latest: value }) as unknown as InquiryTimingHistory;
        expect(getLatestTimingEntry(legacy({ schemaVersion: 1, lastDurationMs: 84_930, lastInputTokens: 85_216, updatedAt: '2026-10-04T19:48:33Z' }))).toBeNull();
        expect(getLatestTimingEntry(legacy({ lastDurationMs: 74_719, lastInputTokens: 301_652, updatedAt: '2026-04-28T00:41:40Z' }))).toBeNull();
        expect(getLatestTimingEntry(legacy(null))).toBeNull();
        expect(getLatestTimingEntry(legacy({ schemaVersion: 2, passDurationMs: 0, updatedAt: 'x' }))).toBeNull();
        expect(getLatestTimingEntry(legacy({ schemaVersion: 2, passDurationMs: NaN, updatedAt: 'x' }))).toBeNull();
        expect(getLatestTimingEntry({})).toBeNull();
        expect(getLatestTimingEntry(undefined)).toBeNull();
    });
});

describe('run duration prediction', () => {
    it('times the next question from the latest question, whatever the manuscript size', () => {
        // Sherlock Book 1: Pressure took 45.4s, so Payoff is timed for 45.4s.
        expect(predictRunDuration(observation(45_370), 1)).toEqual({ durationMs: 45_370, source: 'latest_run' });
    });

    it('budgets every expected pass of a multi-pass request', () => {
        expect(predictRunDuration(observation(60_000), 3).durationMs).toBe(180_000);
    });

    it('uses a typical full-book answer when the vault has no observation yet', () => {
        expect(predictRunDuration(null, 1)).toEqual({ durationMs: FIRST_RUN_PASS_MS, source: 'first_run_default' });
        expect(predictRunDuration(null, 2).durationMs).toBe(FIRST_RUN_PASS_MS * 2);
    });

    it('keeps the minimum animation time for implausibly fast observations', () => {
        expect(predictRunDuration(observation(500), 1).durationMs).toBe(PREDICT_FLOOR_MS);
    });

    it('shows a rough range around the predicted time', () => {
        expect(getRunDurationRange(50_000)).toEqual({ minSeconds: 40, maxSeconds: 60 });
    });
});
