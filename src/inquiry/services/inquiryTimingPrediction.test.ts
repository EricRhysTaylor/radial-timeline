import { describe, expect, it } from 'vitest';
import {
    getInquiryTimingSample,
    getLatestTimingEntry,
    predictTimingFromEntry,
    PREDICT_FLOOR_MS
} from './inquiryTimingPrediction';
import type { InquiryTimingHistoryEntry } from '../../types/settings';

describe('latest Inquiry timing sample', () => {
    it('uses the canonical provider total without adding cached tokens twice', () => {
        const usage = { inputTokens: 135_657, cacheReadInputTokens: 135_634 };
        expect(getInquiryTimingSample(usage, 42_795)).toEqual({ durationMs: 42_795, inputTokens: 135_657 });
    });

    it('skips missing usage, cache-only reports, and invalid observations', () => {
        expect(getInquiryTimingSample(undefined, 10_000)).toBeNull();
        expect(getInquiryTimingSample({ inputTokens: undefined }, 10_000)).toBeNull();
        for (const invalid of [0, -1, NaN, Infinity, undefined]) {
            expect(getInquiryTimingSample({ inputTokens: 1000 }, invalid)).toBeNull();
            expect(getInquiryTimingSample({ inputTokens: invalid }, 1000)).toBeNull();
        }
    });
});

describe('shared latest Inquiry observation', () => {
    const observation = (duration: number, updatedAt: string): InquiryTimingHistoryEntry => ({
        lastDurationMs: duration,
        lastInputTokens: 220000,
        updatedAt
    });

    it('immediately updates the next prediction after each completed Odyssey question', () => {
        let history: Record<string, InquiryTimingHistoryEntry> = {};
        for (const [index, duration] of [159564, 72671, 160206].entries()) {
            history = { latest: observation(duration, `2026-10-04T01:${24 + index * 3}:00Z`) };
            const range = predictTimingFromEntry(getLatestTimingEntry(history), 220000)!;
            expect((range.minSeconds + range.maxSeconds) / 2).toBeCloseTo(duration / 1000, 6);
        }
    });

    it('uses the newest existing bucket immediately regardless of model or evidence mode', () => {
        const earlier = observation(50000, '2026-10-04T01:24:00Z');
        const newest = observation(160206, '2026-10-04T01:30:00Z');
        expect(getLatestTimingEntry({
            'openai::earlier::summary': earlier,
            'anthropic::current::full': newest
        })).toBe(newest);
    });

    it('ignores obsolete weighted averages in an existing saved observation', () => {
        const legacy = { ...observation(160206, '2026-10-04T01:30:00Z'), samples: 3, avgMsPerInputToken: 0.01 };
        const range = predictTimingFromEntry(legacy, 220000)!;
        expect((range.minSeconds + range.maxSeconds) / 2).toBeCloseTo(160.206, 6);
    });

    it('skips invalid observations instead of letting them displace usable history', () => {
        const usable = observation(160206, '2026-10-04T01:30:00Z');
        expect(getLatestTimingEntry({
            usable,
            empty: { ...observation(0, '2026-10-04T01:31:00Z') },
            badDate: observation(50000, 'invalid')
        })).toBe(usable);
        expect(getLatestTimingEntry({})).toBeNull();
        expect(getLatestTimingEntry(undefined)).toBeNull();
    });
});

describe('persisted timing boundary', () => {
    it('ignores malformed or unsupported observations without losing valid legacy history', () => {
        const usable = { lastDurationMs: 10000, lastInputTokens: 1000, updatedAt: '2026-10-04T01:30:00Z' };
        // SAFE: persisted JSON can violate the TypeScript settings shape.
        const history = { usable, broken: null, future: { ...usable, schemaVersion: 2 } } as unknown as Record<string, InquiryTimingHistoryEntry>;
        expect(getLatestTimingEntry(history)).toBe(usable);
    });

    it('rejects overflowing predictions rather than scheduling an infinite estimate', () => {
        expect(predictTimingFromEntry({ lastDurationMs: Number.MAX_VALUE, lastInputTokens: 1, updatedAt: '2026-10-04T01:30:00Z' }, 1000)).toBeNull();
    });
});

describe('latest-run size scaling', () => {
    const entry: InquiryTimingHistoryEntry = {
        lastDurationMs: 160000,
        lastInputTokens: 220000,
        updatedAt: '2026-10-04T01:30:00Z'
    };

    it('scales the latest duration for larger and smaller inputs', () => {
        const twice = predictTimingFromEntry(entry, 440000)!;
        const half = predictTimingFromEntry(entry, 110000)!;
        expect((twice.minSeconds + twice.maxSeconds) / 2).toBe(320);
        expect((half.minSeconds + half.maxSeconds) / 2).toBe(80);
    });

    it('returns no prediction without a valid duration and input size', () => {
        expect(predictTimingFromEntry(null, 100000)).toBeNull();
        expect(predictTimingFromEntry(undefined, 100000)).toBeNull();
        for (const invalid of [0, -1, NaN, Infinity]) {
            expect(predictTimingFromEntry(entry, invalid)).toBeNull();
            expect(predictTimingFromEntry({ ...entry, lastDurationMs: invalid }, 100000)).toBeNull();
            expect(predictTimingFromEntry({ ...entry, lastInputTokens: invalid }, 100000)).toBeNull();
        }
    });

    it('retains the existing minimum animation time for tiny inputs', () => {
        const range = predictTimingFromEntry(entry, 1)!;
        expect(range.minSeconds).toBeGreaterThanOrEqual(PREDICT_FLOOR_MS / 1000);
    });
});
