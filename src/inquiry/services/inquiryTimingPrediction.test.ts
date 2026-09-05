import { describe, expect, it } from 'vitest';
import {
    blendSampleRate,
    computeSampleRate,
    computeTimingHistoryKey,
    normalizeEvidenceModeKey,
    predictTimingFromEntry,
    EWMA_NEW_WEIGHT,
    PREDICT_FLOOR_MS
} from './inquiryTimingPrediction';

describe('normalizeEvidenceModeKey', () => {
    it.each([
        ['Full Scene evidence', 'full'],
        ['Summary evidence', 'summary'],
        ['Mixed evidence', 'mixed'],
        ['Corpus evidence', 'corpus'],
        ['', 'unknown'],
        [undefined, 'unknown'],
        [null, 'unknown'],
        ['something else', 'unknown']
    ])('normalizes %j to %j', (input, expected) => {
        expect(normalizeEvidenceModeKey(input)).toBe(expected);
    });
});

describe('computeTimingHistoryKey', () => {
    it('joins provider, model, and mode with double-colon separators', () => {
        expect(computeTimingHistoryKey('Anthropic', 'claude-opus-4-7', 'full'))
            .toBe('anthropic::claude-opus-4-7::full');
    });

    it('lowercases provider and model so case differences do not split history', () => {
        expect(computeTimingHistoryKey('OPENAI', 'GPT-5.4', 'full'))
            .toBe('openai::gpt-5.4::full');
    });

    it('returns null when provider is missing', () => {
        expect(computeTimingHistoryKey('', 'gpt-5.5', 'full')).toBeNull();
        expect(computeTimingHistoryKey(undefined, 'gpt-5.5', 'full')).toBeNull();
    });

    it('returns null when model is missing', () => {
        expect(computeTimingHistoryKey('openai', '', 'full')).toBeNull();
        expect(computeTimingHistoryKey('openai', null, 'full')).toBeNull();
    });

    it('keys differently for each evidence mode so they do not overwrite', () => {
        const fullKey = computeTimingHistoryKey('anthropic', 'sonnet-4-6', 'full');
        const summaryKey = computeTimingHistoryKey('anthropic', 'sonnet-4-6', 'summary');
        expect(fullKey).not.toBe(summaryKey);
    });
});

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

describe('blendSampleRate (EWMA)', () => {
    it('returns the new rate when no previous average exists', () => {
        const result = blendSampleRate({ newRate: 0.05 });
        expect(result.avgMsPerInputToken).toBe(0.05);
        expect(result.samples).toBe(1);
    });

    it('blends with the previous average using EWMA_NEW_WEIGHT', () => {
        const result = blendSampleRate({
            previousAvg: 0.10,
            previousSampleCount: 5,
            newRate: 0.20
        });
        expect(EWMA_NEW_WEIGHT).toBe(0.75);
        expect(result.avgMsPerInputToken).toBeCloseTo(0.10 * 0.25 + 0.20 * 0.75, 6);
        expect(result.samples).toBe(6);
    });

    it('caps the stored sample count to the configured limit', () => {
        const result = blendSampleRate({
            previousAvg: 0.10,
            previousSampleCount: 999,
            newRate: 0.10,
            sampleCountCap: 19
        });
        expect(result.samples).toBe(20); // 19 (capped) + 1 new
    });

    it('treats invalid previousAvg as no history', () => {
        const result = blendSampleRate({ previousAvg: 0, newRate: 0.05 });
        expect(result.avgMsPerInputToken).toBe(0.05);
    });
});

describe('predictTimingFromEntry', () => {
    const validEntry = {
        samples: 5,
        avgMsPerInputToken: 0.20, // 200ms per 1k tokens — slow run
        lastDurationMs: 60_000,
        lastInputTokens: 300_000  // implies 0.20 ms/token (last sample agrees with avg)
    };

    it('returns null when there is no entry', () => {
        expect(predictTimingFromEntry(null, 100_000)).toBeNull();
        expect(predictTimingFromEntry(undefined, 100_000)).toBeNull();
    });

    it('returns null when the avg rate is zero or non-finite', () => {
        expect(predictTimingFromEntry({ ...validEntry, avgMsPerInputToken: 0 }, 100_000)).toBeNull();
        expect(predictTimingFromEntry({ ...validEntry, avgMsPerInputToken: NaN }, 100_000)).toBeNull();
    });

    it('returns null for non-positive token counts', () => {
        expect(predictTimingFromEntry(validEntry, 0)).toBeNull();
        expect(predictTimingFromEntry(validEntry, -1)).toBeNull();
    });

    it('blends the avg-rate prediction and the last-sample prediction 50/50', () => {
        // Avg says 0.20 ms/token. Last sample says 60_000/300_000 = 0.20 ms/token.
        // Both agree, so prediction for 200k tokens = 200_000 * 0.20 = 40_000ms central.
        const result = predictTimingFromEntry(validEntry, 200_000);
        expect(result).not.toBeNull();
        // Range: 0.8x to 1.2x of 40_000ms = 32-48 seconds
        expect(result!.minSeconds).toBeCloseTo(32, 1);
        expect(result!.maxSeconds).toBeCloseTo(48, 1);
    });

    it('does NOT let the last sample fully dominate when it disagrees with the avg', () => {
        // Avg says 0.20 ms/token (slow). Latest sample says 0.01 ms/token (fast).
        // Old preferLatestSample=true would have predicted 0.01 * tokens. New blend uses average too.
        const fastLastEntry = {
            samples: 5,
            avgMsPerInputToken: 0.20,
            lastDurationMs: 1_000,
            lastInputTokens: 100_000  // 0.01 ms/token
        };
        const result = predictTimingFromEntry(fastLastEntry, 300_000);
        // Avg path: 300_000 * 0.20 = 60_000ms
        // Last path: 300_000 * 0.01 = 3_000ms (floored to PREDICT_FLOOR_MS = 4_000ms in central calc)
        // Blend: 0.5*60_000 + 0.5*3_000 = 31_500ms (then floored to 4_000)
        // Range: 31_500 * 0.8 to 31_500 * 1.2 = 25.2..37.8s
        expect(result!.minSeconds).toBeGreaterThan(20);
        expect(result!.maxSeconds).toBeLessThan(40);
        // CRITICAL: under the old code this would have been 2.4-3.6 seconds.
        expect(result!.minSeconds).toBeGreaterThan(4);
    });

    it('floors the central prediction at PREDICT_FLOOR_MS', () => {
        // Tiny tokens × tiny rate would imply near-zero ms; floor kicks in.
        const result = predictTimingFromEntry(validEntry, 100); // 100 * 0.20 = 20ms
        expect(result!.minSeconds).toBeGreaterThanOrEqual(PREDICT_FLOOR_MS / 1000 * 0.8);
    });

    it('still produces a usable prediction when the last-sample fields are invalid', () => {
        const noLastEntry = {
            samples: 5,
            avgMsPerInputToken: 0.20,
            lastDurationMs: 0,
            lastInputTokens: 0
        };
        const result = predictTimingFromEntry(noLastEntry, 100_000);
        expect(result).not.toBeNull();
        // Pure avg path: 100_000 * 0.20 = 20_000ms central.
        expect(result!.minSeconds).toBeCloseTo(16, 1);
        expect(result!.maxSeconds).toBeCloseTo(24, 1);
    });
});
