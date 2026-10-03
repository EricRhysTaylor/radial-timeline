import { describe, expect, it } from 'vitest';
import type { AIRunResult } from '../ai/types';
import { buildUsageCostBreakdown, extractTokenUsage } from '../ai/log';
import { buildPulseUsageReport, summarizePulseUsage } from './usage';

const run = (patch: Partial<AIRunResult> = {}): AIRunResult => ({
    provider: 'anthropic', modelRequested: 'claude-opus-5-5', modelResolved: 'claude-opus-5-5',
    aiStatus: 'success', content: '{}', warnings: [], reason: 'test',
    responseData: { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } },
    ...patch
});

describe('Pulse completion accounting', () => {
    it('uses canonical provider usage/pricing for costs and reports cache hits', () => {
        const result = run();
        const report = buildPulseUsageReport(result);
        expect(report.costUSD).toBe(buildUsageCostBreakdown(result.provider, result.modelResolved,
            extractTokenUsage(result.provider, result.responseData))?.totalCostUSD);
        expect(report.costUSD).toBeGreaterThan(0);
        expect(report.cache).toBe('hit');
        expect(report.cacheDetail).toContain('900');
        expect(report.partial).toBe(false);
    });
    it('keeps missing usage, pricing, and missing input unavailable', () => {
        for (const result of [null, run({ responseData: null }), run({ modelResolved: 'unknown-model' }),
            run({ responseData: { usage: { output_tokens: 20 } } })]) {
            expect(buildPulseUsageReport(result)).toMatchObject({ costUSD: null, partial: true });
        }
        expect(buildPulseUsageReport(run({ responseData: { usage: { input_tokens: 100, output_tokens: 20 } } })).cache).toBe('unavailable');
    });
    it('distinguishes explicit zero cache activity from unavailable cache counters', () => {
        const report = buildPulseUsageReport(run({ responseData: { usage: {
            input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0
        } } }));
        expect(report.cache).toBe('none');
        expect(report.cacheDetail).toContain('no provider cache');
    });
    it('reports cache writes and Gemini creation truth instead of treating creation as a discounted hit', () => {
        expect(buildPulseUsageReport(run({ responseData: { usage: {
            input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 900
        } } })).cache).toBe('created');
        const result = run({ provider: 'google', modelResolved: 'gemini-3.1-pro-preview',
            responseData: { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, cachedContentTokenCount: 900 } },
            advancedContext: { cacheStatus: 'created' } as AIRunResult['advancedContext'] });
        expect(buildPulseUsageReport(result).cache).toBe('created');
        expect(buildPulseUsageReport(result).cacheDetail).toContain('CREATED');
        expect(buildPulseUsageReport(result).costUSD).toBe(buildUsageCostBreakdown('google', 'gemini-3.1-pro-preview',
            extractTokenUsage('google', result.responseData), 'created')?.totalCostUSD);
    });
    it('never charges again for an RT memory-cache result', () => {
        const report = buildPulseUsageReport(run({ servedFromCache: true, retryCount: 2 }));
        expect(report).toMatchObject({ costUSD: 0, cache: 'local', partial: false });
        expect(summarizePulseUsage([report]).costUSD).toBe(0);
    });
    it('includes failed responses, marks retry/pass coverage partial and does not deduplicate repeated calls', () => {
        const good = buildPulseUsageReport(run());
        const failed = buildPulseUsageReport(run({ aiStatus: 'error', retryCount: 1 }));
        const summary = summarizePulseUsage([good, failed, good, buildPulseUsageReport(null)]);
        expect(summary).toMatchObject({ count: 4, partial: true, hits: 3, unavailable: 1 });
        expect(summary.costUSD).toBeCloseTo(good.costUSD! * 3);
        expect(buildPulseUsageReport(run({ advancedContext: { executionPassCount: 2 } as AIRunResult['advancedContext'] })).partial).toBe(true);
    });
    it('has no fabricated zero total when no priced usage is available', () => {
        expect(summarizePulseUsage([]).costUSD).toBeNull();
        expect(summarizePulseUsage([buildPulseUsageReport(null)]).costUSD).toBeNull();
    });
});
