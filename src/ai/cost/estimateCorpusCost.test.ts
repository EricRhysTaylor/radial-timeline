import { afterEach, describe, expect, it } from 'vitest';
import { estimateCorpusCost, estimateOmnibusCostRange, estimateUsageCost } from './estimateCorpusCost';
import { getActivePricingTable, mergeRemotePricing, resetPricingToBuiltin } from './providerPricing';

/*
 * estimateCorpusCost behaviour tests.
 *
 * These are intentionally invariant-based rather than dollar-pinned:
 * exact USD amounts are a function of the pricing table, which changes
 * when models rotate. We assert the SHAPE of the cost model (cache
 * reduces cost; multi-pass defaults to 50% reuse; 1h cache writes cost
 * more than 5m; missing pricing throws) so the suite stays useful
 * across pricing churn. One anchor test per provider pins a specific
 * dollar amount as a smoke against algorithmic regressions.
 */

describe('estimateCorpusCost', () => {
    it('anchor: claude-opus-4-8 no-cache cost matches input × inputPer1M + output × outputPer1M', () => {
        // 200k input × $5/M + 10k output × $25/M = $1.00 + $0.25 = $1.25.
        const result = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            200_000,
            10_000,
            1,
            { cacheReuseRatio: 0 }
        );
        expect(result.cacheReuseRatio).toBe(0);
        expect(result.freshCostUSD).toBeCloseTo(1.25, 6);
        // At reuse=0, cached and fresh paths produce the same number.
        expect(result.cachedCostUSD).toBeCloseTo(result.freshCostUSD, 6);
        expect(result.effectiveCostUSD).toBeCloseTo(result.cachedCostUSD!, 6);
    });

    it('partial cache reuse: cached cost is lower than fresh cost', () => {
        const result = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            200_000,
            10_000,
            1,
            { cacheReuseRatio: 0.5 }
        );
        expect(result.cacheReuseRatio).toBe(0.5);
        expect(result.cachedCostUSD).toBeLessThan(result.freshCostUSD);
    });

    it('full cache reuse: cached < fresh and neither goes negative', () => {
        const result = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            200_000,
            10_000,
            1,
            { cacheReuseRatio: 1 }
        );
        expect(result.cacheReuseRatio).toBe(1);
        expect(result.freshCostUSD).toBeGreaterThanOrEqual(0);
        expect(result.cachedCostUSD).toBeGreaterThanOrEqual(0);
        expect(result.cachedCostUSD).toBeLessThan(result.freshCostUSD);
    });

    it('multi-pass uses the explicit default cache reuse ratio (0.5)', () => {
        const result = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            400_000,
            20_000,
            3
        );
        expect(result.cacheReuseRatio).toBe(0.5);
        expect(result.cachedCostUSD).toBeLessThan(result.freshCostUSD);
        expect(result.effectiveCostUSD).toBeCloseTo(result.cachedCostUSD!, 6);
    });

    it('output-heavy estimates stay non-negative and cached <= fresh', () => {
        const result = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            20_000,
            120_000,
            1
        );
        expect(result.cacheReuseRatio).toBe(0.75);
        expect(result.freshCostUSD).toBeGreaterThanOrEqual(0);
        expect(result.cachedCostUSD).toBeLessThanOrEqual(result.freshCostUSD);
    });

    it('anthropic long-context pricing kicks in above the 200k threshold (where applicable)', () => {
        // Run two estimates at threshold ± 1; for models with long-context
        // tiers the longer one should be costlier per-token.
        const atThreshold = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            200_000,
            10_000,
            1,
            { cacheReuseRatio: 0 }
        );
        const aboveThreshold = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            250_000,
            10_000,
            1,
            { cacheReuseRatio: 0 }
        );
        // Larger input must cost more (regardless of tier kick-in).
        expect(aboveThreshold.freshCostUSD).toBeGreaterThan(atThreshold.freshCostUSD);
    });

    it('GPT-5.6 Sol cached runs cost less than fresh runs', () => {
        const result = estimateCorpusCost(
            'openai',
            'gpt-5.6-sol',
            61_600,
            8_000,
            1
        );
        expect(result.cacheReuseRatio).toBe(0.75);
        expect(result.cachedCostUSD).toBeLessThan(result.freshCostUSD);
    });

    it('OpenAI live usage with cached tokens prices at cached-input rate when available', () => {
        const result = estimateUsageCost('openai', 'gpt-5.6-sol', {
            inputTokens: 61_600,
            outputTokens: 8_000,
            cacheReadInputTokens: 46_200
        });
        expect(result).toMatchObject({
            inputTokens: 61_600,
            outputTokens: 8_000,
            cacheReadInputTokens: 46_200
        });
        // Cache-read cost should be lower than the raw input cost would have been.
        if (typeof result?.rawInputCostUSD === 'number' && typeof result?.cacheReadCostUSD === 'number') {
            expect(result.cacheReadCostUSD).toBeLessThan(result.rawInputCostUSD);
        }
        expect(result?.totalCostUSD).toBeGreaterThan(0);
    });

    it('GPT-5.6 Sol long-context cached usage stays internally consistent', () => {
        const result = estimateUsageCost('openai', 'gpt-5.6-sol', {
            inputTokens: 300_000,
            outputTokens: 10_000,
            cacheReadInputTokens: 225_000
        });
        if (typeof result?.inputCostUSD === 'number' && typeof result?.totalCostUSD === 'number') {
            expect(result.totalCostUSD).toBeGreaterThanOrEqual(result.inputCostUSD);
        }
        expect(result?.totalCostUSD).toBeGreaterThan(0);
    });

    it('Gemini 3.1 Pro Preview surfaces a separate cache-read line', () => {
        const result = estimateUsageCost('google', 'gemini-3.1-pro-preview', {
            inputTokens: 264_606,
            outputTokens: 5_409,
            cacheReadInputTokens: 264_584
        });
        // Cache-read pricing must flow through as its own number.
        expect(typeof result?.cacheReadCostUSD).toBe('number');
        expect(result?.cacheReadCostUSD).toBeGreaterThan(0);
        expect(result?.outputTokens).toBe(5_409);
        expect(result?.totalCostUSD).toBeGreaterThan(0);
    });

    it('prices Gemini "created" cache tokens at the input rate, not the read discount', () => {
        // Gemini reports cachedContentTokenCount on the CREATING call too, so a
        // first run looks like a 136k "cache read". It must NOT get the read
        // discount — those tokens were processed fresh to build the cache.
        const usage = {
            inputTokens: 135_723,
            outputTokens: 4_898,
            totalTokens: 140_621,
            cacheReadInputTokens: 135_700
        };
        // Flash table: input $1.50/M, output $9.00/M, cacheRead $0.15/M.
        const created = estimateUsageCost('google', 'gemini-3.5-flash', usage, 'created');
        const hit = estimateUsageCost('google', 'gemini-3.5-flash', usage, 'hit');

        // Created ≈ fresh: 135.7k @ $1.50/M + 4.9k @ $9/M ≈ $0.248.
        expect(created?.totalCostUSD).toBeCloseTo(0.2477, 2);
        // Hit gets the read discount on the cached prefix ≈ $0.064.
        expect(hit?.totalCostUSD).toBeCloseTo(0.0645, 2);
        // The created run must be materially pricier than a genuine reuse hit.
        expect((created?.totalCostUSD ?? 0)).toBeGreaterThan((hit?.totalCostUSD ?? 0) * 3);
    });

    it('Gemini recovers thinking-token output from totalTokens for legacy sessions', () => {
        const result = estimateUsageCost('google', 'gemini-3.1-pro-preview', {
            inputTokens: 264_606,
            outputTokens: 531,
            totalTokens: 270_015,
            cacheReadInputTokens: 264_584
        });
        // Recovered output should include thinking tokens: 270,015 - 264,606 = 5,409.
        expect(result?.outputTokens).toBe(5_409);
    });

    it('throws when pricing is missing', () => {
        expect(() => estimateCorpusCost(
            'openai',
            'missing-model',
            100_000,
            10_000,
            1
        )).toThrowError(/Missing provider pricing/);
    });

    // ── cacheWriteTtl parameter ──────────────────────────────────────────

    it('cacheWriteTtl=5m (default) produces a lower priming-pass cost than 1h', () => {
        const fiveMinute = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            200_000,
            10_000,
            1,
            { cacheReuseRatio: 0.5 }
        );
        const oneHour = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            200_000,
            10_000,
            1,
            { cacheReuseRatio: 0.5, cacheWriteTtl: '1h' }
        );
        expect(oneHour.freshCostUSD).toBeGreaterThan(fiveMinute.freshCostUSD);
    });

    it('1h vs 5m ratio is meaningfully > 1 — the screenshot-bug regression guard', () => {
        // Inquiry primes a 1h cache. If the panel reports 5m pricing the
        // estimate is materially low. This pins that the gap exists.
        const fiveMinute = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            300_000,
            3_500,
            1,
            { cacheReuseRatio: 0.75 }
        );
        const oneHour = estimateCorpusCost(
            'anthropic',
            'claude-opus-4-8',
            300_000,
            3_500,
            1,
            { cacheReuseRatio: 0.75, cacheWriteTtl: '1h' }
        );
        const ratio = oneHour.freshCostUSD / fiveMinute.freshCostUSD;
        expect(ratio).toBeGreaterThan(1.1);
        expect(ratio).toBeLessThan(2.0);
    });

    it('prices the priming pass at the input rate for providers with no explicit cache-write rate', () => {
        // GPT-5.6 Sol bills the first pass as ordinary input; automatic caching
        // has no separate write price. The TTL is irrelevant there, so asking
        // for 1h neither throws nor changes the number.
        const oneHour = estimateCorpusCost('openai', 'gpt-5.6-sol', 61_600, 8_000, 1, { cacheReuseRatio: 0.5, cacheWriteTtl: '1h' });
        const fiveMinute = estimateCorpusCost('openai', 'gpt-5.6-sol', 61_600, 8_000, 1, { cacheReuseRatio: 0.5, cacheWriteTtl: '5m' });
        expect(Number.isFinite(oneHour.freshCostUSD)).toBe(true);
        expect(oneHour.freshCostUSD).toBeGreaterThan(0);
        expect(oneHour.freshCostUSD).toBe(fiveMinute.freshCostUSD);
    });
});

// A model that prices cache writes explicitly, but only for the 5m TTL. The
// other TTL is ~1.6× different, so it must never be used as a stand-in.
const FIVE_MINUTE_ONLY_MODEL = 'rt-test-write-5m-only';
function installFiveMinuteOnlyPricing(): void {
    mergeRemotePricing({
        anthropic: {
            [FIVE_MINUTE_ONLY_MODEL]: { inputPer1M: 4, outputPer1M: 20, cacheWrite5mPer1M: 5, cacheReadPer1M: 0.4 }
        }
    }, 'remote');
}

describe('estimateCorpusCost never substitutes one cache-write TTL rate for another', () => {
    afterEach(() => resetPricingToBuiltin());

    it('is unavailable (throws) when the run requests a TTL the table has no write rate for', () => {
        installFiveMinuteOnlyPricing();
        expect(() => estimateCorpusCost('anthropic', FIVE_MINUTE_ONLY_MODEL, 100_000, 1_000, 1, { cacheReuseRatio: 0.5, cacheWriteTtl: '1h' }))
            .toThrowError(/unavailable/);
        const fiveMinute = estimateCorpusCost('anthropic', FIVE_MINUTE_ONLY_MODEL, 100_000, 1_000, 1, { cacheReuseRatio: 0.5, cacheWriteTtl: '5m' });
        // 50k uncached @ $4 + 50k written @ $5 + 1k output @ $20
        expect(fiveMinute.freshCostUSD).toBeCloseTo(0.2 + 0.25 + 0.02, 10);
    });

    it('leaves actual-usage cache-creation cost undefined when tokens were written at a TTL with no rate', () => {
        installFiveMinuteOnlyPricing();
        const oneHourWrite = estimateUsageCost('anthropic', FIVE_MINUTE_ONLY_MODEL, {
            inputTokens: 100_000, outputTokens: 1_000, rawInputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 100_000, cacheCreation1hInputTokens: 100_000
        });
        expect(oneHourWrite?.cacheCreationCostUSD).toBeUndefined();
        expect(oneHourWrite?.inputCostUSD).toBeUndefined();
        expect(oneHourWrite?.totalCostUSD).toBeUndefined();
        expect(oneHourWrite?.outputCostUSD).toBeCloseTo(0.02, 10);

        const fiveMinuteWrite = estimateUsageCost('anthropic', FIVE_MINUTE_ONLY_MODEL, {
            inputTokens: 100_000, outputTokens: 1_000, rawInputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 100_000, cacheCreation5mInputTokens: 100_000
        });
        expect(fiveMinuteWrite?.cacheCreationCostUSD).toBeCloseTo(0.5, 10);
        expect(fiveMinuteWrite?.totalCostUSD).toBeCloseTo(0.52, 10);
    });

    it('prices creation tokens with no per-TTL split at the TTL the run requested, and not at all without one', () => {
        const pricing = getActivePricingTable().anthropic['claude-opus-4-8'];
        const usage = { inputTokens: 10_000, outputTokens: 100, rawInputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 10_000 };
        expect(estimateUsageCost('anthropic', 'claude-opus-4-8', usage)?.cacheCreationCostUSD).toBeUndefined();
        expect(estimateUsageCost('anthropic', 'claude-opus-4-8', usage)?.totalCostUSD).toBeUndefined();
        expect(estimateUsageCost('anthropic', 'claude-opus-4-8', usage, undefined, '1h')?.cacheCreationCostUSD)
            .toBeCloseTo(0.01 * (pricing.cacheWrite1hPer1M as number), 10);
        expect(estimateUsageCost('anthropic', 'claude-opus-4-8', usage, undefined, '5m')?.cacheCreationCostUSD)
            .toBeCloseTo(0.01 * (pricing.cacheWrite5mPer1M as number), 10);
        // Requested TTL with no rate in the table is still unavailable.
        installFiveMinuteOnlyPricing();
        expect(estimateUsageCost('anthropic', FIVE_MINUTE_ONLY_MODEL, usage, undefined, '1h')?.cacheCreationCostUSD).toBeUndefined();
    });
});

describe('estimateOmnibusCostRange', () => {
    afterEach(() => resetPricingToBuiltin());

    it('matches the corpus-cost rate rules exactly: write once at the TTL rate, read N-1 times', () => {
        const pricing = getActivePricingTable().anthropic['claude-opus-4-8'];
        const range = estimateOmnibusCostRange({
            provider: 'anthropic', modelId: 'claude-opus-4-8',
            corpusInputTokens: 100_000, expectedOutputTokensPerQuestion: 2_000, questionCount: 6,
            cacheWriteTtl: '1h'
        });
        const output = 6 * (2_000 / 1e6) * pricing.outputPer1M;
        expect(range.uncachedUSD).toBeCloseTo(6 * 0.1 * pricing.inputPer1M + output, 10);
        expect(range.cachedUSD).toBeCloseTo(0.1 * (pricing.cacheWrite1hPer1M as number) + 5 * 0.1 * (pricing.cacheReadPer1M as number) + output, 10);
        expect(range.cachedUSD as number).toBeLessThan(range.uncachedUSD);
    });

    it('prices question 1 as a cache read when the cache is already warm', () => {
        const base = { provider: 'anthropic' as const, modelId: 'claude-opus-4-8', corpusInputTokens: 100_000, expectedOutputTokensPerQuestion: 2_000, questionCount: 6, cacheWriteTtl: '1h' as const };
        const cold = estimateOmnibusCostRange(base);
        const warm = estimateOmnibusCostRange({ ...base, cacheAlreadyWarm: true });
        expect(warm.uncachedUSD).toBe(cold.uncachedUSD);
        expect(warm.cachedUSD as number).toBeLessThan(cold.cachedUSD as number);
    });

    it('omits the cached band rather than guessing when the requested TTL has no write rate', () => {
        installFiveMinuteOnlyPricing();
        const base = { provider: 'anthropic' as const, modelId: FIVE_MINUTE_ONLY_MODEL, corpusInputTokens: 100_000, expectedOutputTokensPerQuestion: 1_000, questionCount: 3 };
        expect(estimateOmnibusCostRange({ ...base, cacheWriteTtl: '1h' }).cachedUSD).toBeUndefined();
        expect(estimateOmnibusCostRange({ ...base, cacheWriteTtl: '5m' }).cachedUSD).toBeCloseTo(0.5 + 2 * 0.04 + 3 * 0.02, 10);
        // A warm cache never writes, so the missing write rate does not matter.
        expect(estimateOmnibusCostRange({ ...base, cacheWriteTtl: '1h', cacheAlreadyWarm: true }).cachedUSD).toBeCloseTo(3 * 0.04 + 3 * 0.02, 10);
    });

    it('prices the priming question at the input rate for providers without an explicit write rate', () => {
        const pricing = getActivePricingTable().openai['gpt-5.6-sol'];
        const range = estimateOmnibusCostRange({ provider: 'openai', modelId: 'gpt-5.6-sol', corpusInputTokens: 50_000, expectedOutputTokensPerQuestion: 1_000, questionCount: 4, cacheWriteTtl: '1h' });
        const output = 4 * (1_000 / 1e6) * pricing.outputPer1M;
        expect(range.cachedUSD).toBeCloseTo(0.05 * pricing.inputPer1M + 3 * 0.05 * (pricing.cacheReadPer1M as number) + output, 10);
        expect(range.cachedUSD as number).toBeLessThan(range.uncachedUSD);
    });

    it('omits the cached band for a model with no cache-read rate at all', () => {
        mergeRemotePricing({ openai: { 'rt-test-no-cache': { inputPer1M: 1, outputPer1M: 2 } } }, 'remote');
        const range = estimateOmnibusCostRange({ provider: 'openai', modelId: 'rt-test-no-cache', corpusInputTokens: 1_000_000, expectedOutputTokensPerQuestion: 0, questionCount: 2 });
        expect(range).toEqual({ uncachedUSD: 2 });
    });
});
