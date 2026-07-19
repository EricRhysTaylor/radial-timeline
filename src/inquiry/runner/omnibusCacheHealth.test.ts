import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '../../ai/usage/providerUsage';
import {
    accumulateOmnibusPassCost,
    createOmnibusCostAccumulator,
    estimateOmnibusCostRange,
    evaluateOmnibusCachePass,
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

describe('readOmnibusCacheProbe', () => {
    it('sums the cache-creation ttl buckets and reports signal presence', () => {
        const probe = readOmnibusCacheProbe(anthropicUsage({
            cacheCreation5mInputTokens: 0,
            cacheCreation1hInputTokens: 90_000
        }));
        expect(probe.cacheCreatedTokens).toBe(90_000);
        expect(probe.cacheReadTokens).toBe(0);
        expect(probe.hasCacheSignals).toBe(true);
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
            'claude-opus-4-8',
            anthropicUsage({ cacheCreationInputTokens: 90_000, cacheCreation1hInputTokens: 90_000 }),
            0
        );
        acc = accumulateOmnibusPassCost(
            acc,
            'anthropic',
            'claude-opus-4-8',
            anthropicUsage({ cacheReadInputTokens: 90_000 }),
            90_000
        );
        expect(acc.pricedPasses).toBe(2);
        expect(acc.totalCostUSD).toBeGreaterThan(0);
    });

    it('counts a pass as unpriced when the model id is missing', () => {
        let acc = createOmnibusCostAccumulator();
        acc = accumulateOmnibusPassCost(acc, 'anthropic', undefined, anthropicUsage({}), 0);
        expect(acc.unpricedPasses).toBe(1);
        expect(acc.pricedPasses).toBe(0);
        expect(acc.totalCostUSD).toBe(0);
    });

    it('counts a pass as unpriced when usage is absent', () => {
        let acc = createOmnibusCostAccumulator();
        acc = accumulateOmnibusPassCost(acc, 'anthropic', 'claude-opus-4-8', null, 0);
        expect(acc.unpricedPasses).toBe(1);
    });
});

describe('estimateOmnibusCostRange', () => {
    it('produces an uncached band above the cached band for a cache-priced model', () => {
        const range = estimateOmnibusCostRange({
            provider: 'anthropic',
            modelId: 'claude-opus-4-8',
            corpusInputTokens: 100_000,
            expectedOutputTokensPerQuestion: 2_000,
            questionCount: 6
        });
        expect(range).not.toBeNull();
        expect(range?.uncachedUSD).toBeGreaterThan(0);
        if (range?.cachedUSD !== undefined) {
            expect(range.cachedUSD).toBeLessThan(range.uncachedUSD);
        }
    });
});
