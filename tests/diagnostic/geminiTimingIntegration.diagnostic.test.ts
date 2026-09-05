/**
 * Diagnostic / regression test for the Gemini inquiry timing & cache bugs.
 *
 * Originally written to REPRODUCE the bugs; now pins the post-fix behavior so
 * the double-count regression cannot return.
 *
 * Run with:  npx vitest run tests/diagnostic/geminiTimingIntegration.diagnostic.test.ts
 */
import { describe, expect, it } from 'vitest';
import { extractTokenUsage } from '../../src/ai/usage/providerUsage';
import { computeSampleRate, predictTimingFromEntry } from '../../src/inquiry/services/inquiryTimingPrediction';

describe('Gemini provider → timing pipeline (real shapes)', () => {
    /**
     * Real Gemini cache-hit response shape (from providerUsage.test.ts:88).
     * promptTokenCount INCLUDES the cached portion; cachedContentTokenCount is
     * the part that came from the cache.
     */
    const geminiCacheHitResponse = {
        usageMetadata: {
            promptTokenCount: 264_606,
            candidatesTokenCount: 531,
            thoughtsTokenCount: 4_878,
            totalTokenCount: 270_015,
            cachedContentTokenCount: 264_584
        }
    };

    it('extractTokenUsage produces inputTokens that already includes cached portion', () => {
        const usage = extractTokenUsage('google', geminiCacheHitResponse);
        expect(usage).not.toBeNull();
        expect(usage?.inputTokens).toBe(264_606);
        expect(usage?.cacheReadInputTokens).toBe(264_584);
    });

    it('computeSampleRate uses the provider total (no double-count) for Gemini', () => {
        const usage = extractTokenUsage('google', geminiCacheHitResponse);
        const durationMs = 30_000;
        const rate = computeSampleRate({ usage, durationMs });
        expect(rate).not.toBeNull();
        // True provider total — NOT 264_606 + 264_584.
        expect(rate?.inputTokens).toBe(264_606);
        expect(rate?.msPerInputToken).toBeCloseTo(durationMs / 264_606, 8);
    });

    it('computeSampleRate uses provider total (no double-count) for OpenAI', () => {
        const usage = extractTokenUsage('openai', {
            usage: {
                input_tokens: 1200,
                output_tokens: 300,
                input_tokens_details: { cached_tokens: 900 }
            }
        });
        const rate = computeSampleRate({ usage, durationMs: 10_000 });
        expect(rate?.inputTokens).toBe(1200);
    });

    it('computeSampleRate uses provider total (no double-count) for Anthropic', () => {
        const usage = extractTokenUsage('anthropic', {
            usage: {
                input_tokens: 196,
                cache_read_input_tokens: 176_000,
                cache_creation_input_tokens: 12_000,
                output_tokens: 18_500
            }
        });
        // readAnthropicUsage pre-sums raw+cacheRead+cacheCreation into inputTokens.
        expect(usage?.inputTokens).toBe(188_196);
        const rate = computeSampleRate({ usage, durationMs: 60_000 });
        // computeSampleRate uses the pre-summed total directly, no double-count.
        expect(rate?.inputTokens).toBe(188_196);
    });

    it('REPRO: ETA returns null when estimatedInputTokens is 0 (countGeminiTokens failed)', () => {
        const entry = {
            samples: 3,
            avgMsPerInputToken: 0.0001,
            lastDurationMs: 30_000,
            lastInputTokens: 264_606
        };
        expect(predictTimingFromEntry(entry, 0)).toBeNull();
        expect(predictTimingFromEntry(entry, 100_000)).not.toBeNull();
    });
});
