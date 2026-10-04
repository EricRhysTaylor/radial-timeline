import { describe, expect, it } from 'vitest';
import {
    computeSampleRate,
    getLatestTimingEntry,
    predictTimingFromEntry,
    PREDICT_FLOOR_MS
} from './inquiryTimingPrediction';
import type { InquiryTimingHistoryEntry } from '../../types/settings';

describe('computeSampleRate', () => {
    it('returns null when duration is missing or non-positive', () => {
        const usage = { inputTokens: 10_000 };
        expect(computeSampleRate({ usage, durationMs: 0 })).toBeNull();
        expect(computeSampleRate({ usage, durationMs: -1 })).toBeNull();
        expect(computeSampleRate({ usage, durationMs: undefined })).toBeNull();
    });

    it('uses provider-reported input total when inputTokens is the canonical total', () => {
        // Real Anthropic/OpenAI/Gemini extract: inputTokens already includes
        // cached portions. Don't double-count.
        const result = computeSampleRate({
            usage: { inputTokens: 100_000, cacheCreationInputTokens: 99_950, cacheReadInputTokens: 0 },
            durationMs: 10_000
        });
        expect(result?.source).toBe('provider_usage');
        expect(result?.inputTokens).toBe(100_000);
        expect(result?.msPerInputToken).toBe(10_000 / 100_000);
    });

    it('records cache-heavy samples because observed wall time still reflects corpus reasoning', () => {
        // Real Gemini cache-hit shape: promptTokenCount=135_657 (total),
        // cachedContentTokenCount=135_634 (subset of that total).
        const result = computeSampleRate({
            usage: { inputTokens: 135_657, cacheReadInputTokens: 135_634, cacheCreationInputTokens: 0 },
            durationMs: 42_795
        });
        expect(result?.source).toBe('provider_usage');
        expect(result?.inputTokens).toBe(135_657);
        expect(result?.msPerInputToken).toBeCloseTo(42_795 / 135_657, 8);
    });

    it('reconstructs the total when inputTokens is missing/zero but cache fields are present', () => {
        // Defensive path: a legacy or partial usage payload with only cache fields.
        const result = computeSampleRate({
            usage: { inputTokens: 0, cacheReadInputTokens: 40, cacheCreationInputTokens: 60 },
            durationMs: 1_000
        });
        expect(result).not.toBeNull();
        expect(result?.source).toBe('provider_usage');
        expect(result?.inputTokens).toBe(100);
    });

    it('returns null when provider usage exists but every input field is zero', () => {
        const result = computeSampleRate({
            usage: { inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
            durationMs: 25_000
        });
        expect(result).toBeNull();
    });

    it('returns null when no provider usage is supplied at all', () => {
        const result = computeSampleRate({
            usage: undefined,
            durationMs: 25_000
        });
        expect(result).toBeNull();
    });

    it('returns null when provider usage yields no input tokens', () => {
        expect(computeSampleRate({
            usage: undefined,
            durationMs: 10_000
        })).toBeNull();
        expect(computeSampleRate({
            usage: { inputTokens: 0 },
            durationMs: 10_000
        })).toBeNull();
    });

    it('counts cache_creation as fresh work — priming a cache costs full input price and is processed', () => {
        // Anthropic cache-create shape: inputTokens (helper-aggregated) = 100_000,
        // cacheCreationInputTokens = 100_000 (the create payload portion).
        const result = computeSampleRate({
            usage: { inputTokens: 100_000, cacheCreationInputTokens: 100_000, cacheReadInputTokens: 0 },
            durationMs: 60_000
        });
        expect(result?.source).toBe('provider_usage');
        expect(result?.inputTokens).toBe(100_000);
        expect(result?.msPerInputToken).toBe(60_000 / 100_000);
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
