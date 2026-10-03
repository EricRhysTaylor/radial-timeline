import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '../../ai/usage/providerUsage';
import { getActivePricingTable } from '../../ai/cost/providerPricing';
import {
    accumulateOmnibusPassCost,
    createOmnibusCostAccumulator,
    estimateOmnibusRunCost,
    evaluateOmnibusCachePass,
    readCacheWriteTokens,
    readOmnibusCacheProbe
} from './omnibusCacheHealth';

const anthropicUsage = (over: Partial<TokenUsage>): TokenUsage => ({
    inputTokens: 100_000,
    outputTokens: 2_000,
    rawInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    ...over
});

// Gemini usage as providerUsage reads it: `cachedContentTokenCount` lands in
// cacheReadInputTokens on the call that CREATED the explicit cache too.
const geminiUsage: TokenUsage = {
    inputTokens: 100_000,
    outputTokens: 2_000,
    totalTokens: 102_000,
    cacheReadInputTokens: 90_000
};

describe('readCacheWriteTokens', () => {
    it('reads the Anthropic total once instead of adding its own 5m/1h split to it', () => {
        expect(readCacheWriteTokens(anthropicUsage({
            cacheCreationInputTokens: 90_000,
            cacheCreation5mInputTokens: 0,
            cacheCreation1hInputTokens: 90_000
        }))).toBe(90_000);
    });

    it('sums the split only when the total is absent', () => {
        expect(readCacheWriteTokens({ cacheCreation5mInputTokens: 10_000, cacheCreation1hInputTokens: 80_000 })).toBe(90_000);
        expect(readCacheWriteTokens({ inputTokens: 5_000 })).toBe(0);
        expect(readCacheWriteTokens(null)).toBe(0);
    });
});

describe('readOmnibusCacheProbe', () => {
    it('counts an Anthropic cache write once and reports signal presence', () => {
        const probe = readOmnibusCacheProbe(anthropicUsage({
            cacheCreationInputTokens: 90_000,
            cacheCreation5mInputTokens: 0,
            cacheCreation1hInputTokens: 90_000
        }));
        expect(probe.cacheCreatedTokens).toBe(90_000);
        expect(probe.cacheReadTokens).toBe(0);
        expect(probe.hasCacheSignals).toBe(true);
    });

    it('treats Gemini cached content on the creating call as a write, not a reuse', () => {
        const created = readOmnibusCacheProbe(geminiUsage, 'created');
        expect(created.cacheReadTokens).toBe(0);
        expect(created.cacheCreatedTokens).toBe(90_000);
        expect(evaluateOmnibusCachePass({ passIndex: 1, probe: created, cacheArmedBefore: false }).health).toBe('armed');

        const hit = readOmnibusCacheProbe(geminiUsage, 'hit');
        expect(hit.cacheReadTokens).toBe(90_000);
        expect(evaluateOmnibusCachePass({ passIndex: 1, probe: hit, cacheArmedBefore: false }).health).toBe('reused');
    });

    it('arms on an OpenAI cache write, so a later pass with no read is a miss', () => {
        const openAiUsage = (over: Partial<TokenUsage>): TokenUsage => ({ inputTokens: 100_000, outputTokens: 2_000, cacheReadInputTokens: 0, ...over });
        const p1 = evaluateOmnibusCachePass({
            passIndex: 1,
            probe: readOmnibusCacheProbe(openAiUsage({ cacheCreationInputTokens: 95_000 }), 'created'),
            cacheArmedBefore: false
        });
        expect(p1.health).toBe('armed');
        const p2 = evaluateOmnibusCachePass({
            passIndex: 2,
            probe: readOmnibusCacheProbe(openAiUsage({ cacheCreationInputTokens: 0 })),
            cacheArmedBefore: p1.cacheArmed
        });
        expect(p2.health).toBe('miss');
        expect(p2.abort).toBe(true);
    });

    it('reports no cache signals when the payload carries none', () => {
        const probe = readOmnibusCacheProbe({ inputTokens: 5_000, outputTokens: 100 });
        expect(probe.hasCacheSignals).toBe(false);
        expect(probe.cacheReadTokens).toBe(0);
        expect(probe.cacheCreatedTokens).toBe(0);
    });

    it('treats null usage as no signal', () => {
        expect(readOmnibusCacheProbe(null).hasCacheSignals).toBe(false);
        expect(readOmnibusCacheProbe(undefined).hasCacheSignals).toBe(false);
    });
});

describe('evaluateOmnibusCachePass — happy path (created -> hit)', () => {
    it('question 1 arms the cache (created), question 2 reuses it (hit); no abort', () => {
        const p1 = evaluateOmnibusCachePass({
            passIndex: 1,
            probe: readOmnibusCacheProbe(anthropicUsage({ cacheCreationInputTokens: 90_000 })),
            cacheArmedBefore: false
        });
        expect(p1.health).toBe('armed');
        expect(p1.cacheArmed).toBe(true);
        expect(p1.abort).toBe(false);

        const p2 = evaluateOmnibusCachePass({
            passIndex: 2,
            probe: readOmnibusCacheProbe(anthropicUsage({ cacheReadInputTokens: 90_000 })),
            cacheArmedBefore: p1.cacheArmed
        });
        expect(p2.health).toBe('reused');
        expect(p2.abort).toBe(false);
    });

    it('question 1 legitimately reads a warm cache from a prior run (hit, not error)', () => {
        const p1 = evaluateOmnibusCachePass({
            passIndex: 1,
            probe: readOmnibusCacheProbe(anthropicUsage({ cacheReadInputTokens: 90_000 })),
            cacheArmedBefore: false
        });
        expect(p1.health).toBe('reused');
        expect(p1.cacheArmed).toBe(true);
        expect(p1.abort).toBe(false);
    });
});

describe('evaluateOmnibusCachePass — miss aborts', () => {
    it('aborts when an armed cache is not read on question 2 (full-price re-send)', () => {
        const decision = evaluateOmnibusCachePass({
            passIndex: 2,
            probe: readOmnibusCacheProbe(anthropicUsage({
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0
            })),
            cacheArmedBefore: true
        });
        expect(decision.health).toBe('miss');
        expect(decision.abort).toBe(true);
    });

    it('never aborts on question 1 even with no read and no create', () => {
        const decision = evaluateOmnibusCachePass({
            passIndex: 1,
            probe: readOmnibusCacheProbe(anthropicUsage({})),
            cacheArmedBefore: false
        });
        expect(decision.abort).toBe(false);
    });
});

describe('evaluateOmnibusCachePass — unknown-signal provider does not abort', () => {
    it('surfaces unknown and never aborts when the provider reports no cache fields', () => {
        for (const passIndex of [1, 2, 5]) {
            const decision = evaluateOmnibusCachePass({
                passIndex,
                probe: readOmnibusCacheProbe({ inputTokens: 50_000, outputTokens: 500 }),
                cacheArmedBefore: passIndex >= 2
            });
            expect(decision.health).toBe('unknown');
            expect(decision.abort).toBe(false);
        }
    });
});

describe('evaluateOmnibusCachePass — below-minimum corpus does not abort', () => {
    it('surfaces below_minimum when the arming pass reported neither created nor hit', () => {
        const p1 = evaluateOmnibusCachePass({
            passIndex: 1,
            probe: readOmnibusCacheProbe(anthropicUsage({})),
            cacheArmedBefore: false
        });
        expect(p1.health).toBe('below_minimum');
        expect(p1.cacheArmed).toBe(false);
        expect(p1.abort).toBe(false);

        // Question 2 on the same uncacheably-small corpus: still no abort,
        // because the cache was never armed (below_minimum, not a miss).
        const p2 = evaluateOmnibusCachePass({
            passIndex: 2,
            probe: readOmnibusCacheProbe(anthropicUsage({})),
            cacheArmedBefore: p1.cacheArmed
        });
        expect(p2.health).toBe('below_minimum');
        expect(p2.abort).toBe(false);
    });
});

describe('omnibus cost accumulator', () => {
    it('accumulates priced passes and totals a positive cost', () => {
        let acc = createOmnibusCostAccumulator();
        expect(acc.totalCostUSD).toBe(0);

        // Priming pass (created) then a read pass.
        acc = accumulateOmnibusPassCost(
            acc,
            'anthropic',
            'claude-opus-5',
            anthropicUsage({ cacheCreationInputTokens: 90_000, cacheCreation1hInputTokens: 90_000 }),
            'created'
        );
        acc = accumulateOmnibusPassCost(
            acc,
            'anthropic',
            'claude-opus-5',
            anthropicUsage({ cacheReadInputTokens: 90_000 }),
            'hit'
        );
        expect(acc.pricedPasses).toBe(2);
        expect(acc.totalCostUSD).toBeGreaterThan(0);
    });

    it('counts a pass as unpriced when the model id is missing', () => {
        let acc = createOmnibusCostAccumulator();
        acc = accumulateOmnibusPassCost(acc, 'anthropic', undefined, anthropicUsage({}), undefined);
        expect(acc.unpricedPasses).toBe(1);
        expect(acc.pricedPasses).toBe(0);
        expect(acc.totalCostUSD).toBe(0);
    });

    it('counts a pass as unpriced when usage is absent', () => {
        let acc = createOmnibusCostAccumulator();
        acc = accumulateOmnibusPassCost(acc, 'anthropic', 'claude-opus-5', null, undefined);
        expect(acc.unpricedPasses).toBe(1);
    });
});

describe('omnibus cost accumulator — Gemini cache provenance', () => {
    const rates = getActivePricingTable().google['gemini-3.1-pro-preview'];
    const outputUSD = (2_000 / 1e6) * rates.outputPer1M;

    it('prices the call that created the Gemini cache at the input rate, not the cache-read rate', () => {
        const created = accumulateOmnibusPassCost(createOmnibusCostAccumulator(), 'google', 'gemini-3.1-pro-preview', geminiUsage, 'created');
        expect(created.totalCostUSD).toBeCloseTo((100_000 / 1e6) * rates.inputPer1M + outputUSD, 10);
    });

    it('prices a real Gemini cache hit at the cache-read rate', () => {
        const hit = accumulateOmnibusPassCost(createOmnibusCostAccumulator(), 'google', 'gemini-3.1-pro-preview', geminiUsage, 'hit');
        expect(hit.totalCostUSD).toBeCloseTo(
            (10_000 / 1e6) * rates.inputPer1M + (90_000 / 1e6) * rates.cacheReadPer1M! + outputUSD,
            10
        );
    });
});

describe('estimateOmnibusRunCost', () => {
    const rates = getActivePricingTable().google['gemini-3.1-pro-preview'];
    const base = {
        provider: 'google' as const,
        modelId: 'gemini-3.1-pro-preview',
        corpusInputTokens: 100_000,
        expectedOutputTokensPerQuestion: 1_000,
        questionCount: 5,
        maxOutputTokensPerCall: 32_000,
        cacheAlreadyWarm: false
    };

    it('prices a combined run as one call that sends the corpus once', () => {
        const combined = estimateOmnibusRunCost({ ...base, combined: true });
        expect(combined.uncachedUSD).toBeCloseTo((100_000 / 1e6) * rates.inputPer1M + (5_000 / 1e6) * rates.outputPer1M, 10);
        expect(combined.cachedUSD).toBeUndefined();
        const sequential = estimateOmnibusRunCost({ ...base, combined: false });
        expect(sequential.uncachedUSD).toBeCloseTo(5 * ((100_000 / 1e6) * rates.inputPer1M + (1_000 / 1e6) * rates.outputPer1M), 10);
    });

    it('never prices a combined run against a warm single-question cache', () => {
        expect(estimateOmnibusRunCost({ ...base, combined: true, cacheAlreadyWarm: true }))
            .toEqual(estimateOmnibusRunCost({ ...base, combined: true }));
    });

    it('caps the combined call output at what one call may return', () => {
        const capped = estimateOmnibusRunCost({ ...base, combined: true, questionCount: 27, expectedOutputTokensPerQuestion: 4_000 });
        expect(capped.uncachedUSD).toBeCloseTo((100_000 / 1e6) * rates.inputPer1M + (32_000 / 1e6) * rates.outputPer1M, 10);
    });
});
