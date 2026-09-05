import { describe, expect, it } from 'vitest';
import {
    PROVIDER_LABELS,
    formatLogTokenCount,
    formatLogUsageMetric,
    resolveLogProviderLabel,
    resolveLogModelLabel,
    resolveLogStatusLabel,
    resolveLogStatusDetail,
    buildLogOverrideLabel,
    buildLogSourceResultDetail,
    buildLogUsageDetailParts,
    buildLogUsageText,
    describeLogCorpusMode,
    resolveLogFailureReason,
    buildLogSuggestedFixes
} from './inquiryLogFields';
import type { InquiryResult } from '../state';
import type { CorpusManifest, InquiryRunTrace } from '../runner/types';
import type { TokenUsage } from '../../ai/usage/providerUsage';

const result = (p: Partial<InquiryResult>): InquiryResult => p as unknown as InquiryResult;
const trace = (p: Partial<InquiryRunTrace>): InquiryRunTrace => p as unknown as InquiryRunTrace;
const usage = (p: Partial<TokenUsage>): TokenUsage => p as unknown as TokenUsage;

describe('formatLogTokenCount', () => {
    it('non-finite/missing → "unknown"', () => {
        expect(formatLogTokenCount(undefined)).toBe('unknown');
        expect(formatLogTokenCount(null)).toBe('unknown');
        expect(formatLogTokenCount(Number.NaN)).toBe('unknown');
        expect(formatLogTokenCount(Number.POSITIVE_INFINITY)).toBe('unknown');
    });
    it('sub-1000 rounds to integer', () => {
        expect(formatLogTokenCount(0)).toBe('0');
        expect(formatLogTokenCount(123.7)).toBe('124');
        expect(formatLogTokenCount(999)).toBe('999');
    });
    it('1000+ collapses to Nk: tenths under 100, integer at/above 100; trailing .0 stripped', () => {
        expect(formatLogTokenCount(1000)).toBe('1k');
        expect(formatLogTokenCount(1500)).toBe('1.5k');
        expect(formatLogTokenCount(99499)).toBe('99.5k');
        expect(formatLogTokenCount(100000)).toBe('100k');
        expect(formatLogTokenCount(130134)).toBe('130k');
    });
    it('approximate prepends "~"', () => {
        expect(formatLogTokenCount(999, true)).toBe('~999');
        expect(formatLogTokenCount(1500, true)).toBe('~1.5k');
    });
});

describe('formatLogUsageMetric', () => {
    it('non-finite/missing → "unavailable" (not "unknown")', () => {
        expect(formatLogUsageMetric(undefined)).toBe('unavailable');
        expect(formatLogUsageMetric(null)).toBe('unavailable');
        expect(formatLogUsageMetric(Number.NaN)).toBe('unavailable');
    });
    it('finite values pass through formatLogTokenCount', () => {
        expect(formatLogUsageMetric(500)).toBe('500');
        expect(formatLogUsageMetric(130134)).toBe('130k');
    });
});

describe('resolveLogProviderLabel', () => {
    it('isSimulated → "Simulation"', () => {
        expect(resolveLogProviderLabel('openai', true)).toBe('Simulation');
        expect(resolveLogProviderLabel('', true)).toBe('Simulation');
    });
    it('known provider keys map via PROVIDER_LABELS', () => {
        expect(resolveLogProviderLabel('openai', false)).toBe(PROVIDER_LABELS.openai);
        expect(resolveLogProviderLabel('anthropic', false)).toBe(PROVIDER_LABELS.anthropic);
        expect(resolveLogProviderLabel('google', false)).toBe(PROVIDER_LABELS.google);
        expect(resolveLogProviderLabel('ollama', false)).toBe(PROVIDER_LABELS.ollama);
    });
    it('unknown providers pass through verbatim; empty → "Unknown"', () => {
        expect(resolveLogProviderLabel('custom-provider', false)).toBe('custom-provider');
        expect(resolveLogProviderLabel('', false)).toBe('Unknown');
    });
});

describe('resolveLogModelLabel', () => {
    it('simulated → "No provider call"', () => {
        expect(resolveLogModelLabel(result({}), 'whatever', true)).toBe('No provider call');
    });
    it('briefModelLabel wins when truthy', () => {
        expect(resolveLogModelLabel(result({ aiModelResolved: 'X' }), 'Display Name', false)).toBe('Display Name');
    });
    it('falls back through aiModelResolved → aiModelRequested → "unknown"', () => {
        expect(resolveLogModelLabel(result({ aiModelResolved: 'gpt-5.5' }), null, false)).toBe('gpt-5.5');
        expect(resolveLogModelLabel(result({ aiModelRequested: 'gpt-5.5' }), null, false)).toBe('gpt-5.5');
        expect(resolveLogModelLabel(result({}), null, false)).toBe('unknown');
        expect(resolveLogModelLabel(result({}), '', false)).toBe('unknown');
    });
});

describe('resolveLogStatusLabel', () => {
    it('degraded overrides status', () => {
        expect(resolveLogStatusLabel('success', true)).toBe('Degraded');
        expect(resolveLogStatusLabel('error', true)).toBe('Degraded');
    });
    it('non-degraded maps to Success/Failed/Simulated', () => {
        expect(resolveLogStatusLabel('success', false)).toBe('Success');
        expect(resolveLogStatusLabel('error', false)).toBe('Failed');
        expect(resolveLogStatusLabel('simulated', false)).toBe('Simulated');
    });
});

describe('resolveLogStatusDetail', () => {
    it('aiReason present → " (REASON)"', () => {
        expect(resolveLogStatusDetail(result({ aiReason: 'rate_limit' }))).toBe(' (rate_limit)');
    });
    it('no reason + non-success/non-degraded aiStatus → " (STATUS)"', () => {
        expect(resolveLogStatusDetail(result({ aiStatus: 'timeout' as never }))).toBe(' (timeout)');
    });
    it('no reason + success/degraded → empty', () => {
        expect(resolveLogStatusDetail(result({ aiStatus: 'success' as never }))).toBe('');
        expect(resolveLogStatusDetail(result({ aiStatus: 'degraded' as never }))).toBe('');
        expect(resolveLogStatusDetail(result({}))).toBe('');
    });
});

describe('buildLogOverrideLabel', () => {
    it('summary present → "On (classes: N, items: M)"', () => {
        expect(buildLogOverrideLabel({ classCount: 3, itemCount: 7 }, true))
            .toBe('On (classes: 3, items: 7)');
    });
    it('overrides active but no summary → "On"', () => {
        expect(buildLogOverrideLabel(null, true)).toBe('On');
    });
    it('no overrides → "None"', () => {
        expect(buildLogOverrideLabel(null, false)).toBe('None');
    });
});

describe('buildLogSourceResultDetail', () => {
    const vm = (items: { classLabel: string }[], totalCount?: number): ReturnType<typeof Object.assign> =>
        ({ items, totalCount: totalCount ?? items.length, hasContent: items.length > 0 });
    it('no content → "none surfaced"', () => {
        expect(buildLogSourceResultDetail(vm([]) as never)).toBe('none surfaced');
    });
    it('single item → "1 item · scene=1"', () => {
        expect(buildLogSourceResultDetail(vm([{ classLabel: 'Scene' }]) as never))
            .toBe('1 item · scene=1');
    });
    it('multiple items → counts ordered by desc count then class asc; labels lowercased', () => {
        const out = buildLogSourceResultDetail(vm([
            { classLabel: 'Scene' }, { classLabel: 'Scene' }, { classLabel: 'Outline' },
            { classLabel: 'Character' }, { classLabel: 'Character' }
        ]) as never);
        // scene=2, character=2 (tie → alpha) → 'character=2, scene=2', then outline=1
        expect(out).toBe('5 items · character=2, scene=2, outline=1');
    });
});

describe('buildLogUsageDetailParts', () => {
    it('null usage → []', () => {
        expect(buildLogUsageDetailParts(null)).toEqual([]);
    });
    it('includes only finite-number fields', () => {
        const u = usage({ rawInputTokens: 100, cacheReadInputTokens: 50 });
        expect(buildLogUsageDetailParts(u)).toEqual(['raw input=100', 'cache read=50']);
    });
    it('all three fields when all present', () => {
        const u = usage({ rawInputTokens: 100, cacheReadInputTokens: 50, cacheCreationInputTokens: 25 });
        expect(buildLogUsageDetailParts(u))
            .toEqual(['raw input=100', 'cache read=50', 'cache write=25']);
    });
});

describe('buildLogUsageText', () => {
    it('null usage → "not available"', () => {
        expect(buildLogUsageText(null)).toBe('not available');
    });
    it('full triplet formatted', () => {
        expect(buildLogUsageText(usage({ inputTokens: 1000, outputTokens: 200, totalTokens: 1200 })))
            .toBe('input=1k, output=200, total=1.2k');
    });
    it('missing fields → "unavailable" per field', () => {
        expect(buildLogUsageText(usage({ inputTokens: 500 })))
            .toBe('input=500, output=unavailable, total=unavailable');
    });
});

describe('describeLogCorpusMode', () => {
    const norm = (m: 'excluded' | 'summary' | 'full' | undefined): 'excluded' | 'summary' | 'full' =>
        m ?? 'excluded';
    const mf = (entries: { class: string; mode: 'excluded' | 'summary' | 'full' }[]): CorpusManifest =>
        ({ entries, classCounts: {} }) as unknown as CorpusManifest;

    it('null manifest → null', () => {
        expect(describeLogCorpusMode(null, 'scene', norm)).toBeNull();
    });
    it('no non-excluded entries for class → null', () => {
        expect(describeLogCorpusMode(mf([{ class: 'scene', mode: 'excluded' }]), 'scene', norm)).toBeNull();
        expect(describeLogCorpusMode(mf([]), 'scene', norm)).toBeNull();
    });
    it('all summary → "Summary"; all full → "Full Scene"', () => {
        expect(describeLogCorpusMode(mf([
            { class: 'scene', mode: 'summary' }, { class: 'scene', mode: 'summary' }
        ]), 'scene', norm)).toBe('Summary');
        expect(describeLogCorpusMode(mf([
            { class: 'scene', mode: 'full' }
        ]), 'scene', norm)).toBe('Full Scene');
    });
    it('mixed summary + full → "Mixed" (excluded ignored)', () => {
        expect(describeLogCorpusMode(mf([
            { class: 'scene', mode: 'summary' },
            { class: 'scene', mode: 'full' },
            { class: 'scene', mode: 'excluded' }
        ]), 'scene', norm)).toBe('Mixed');
    });
});

describe('resolveLogFailureReason', () => {
    const isErr = (r: InquiryResult) => r.aiStatus !== 'success' && r.aiStatus !== 'degraded';

    it('non-error result → null', () => {
        expect(resolveLogFailureReason(result({ aiStatus: 'success' as never }), trace({}), isErr)).toBeNull();
    });
    it('trace.response.error wins', () => {
        expect(resolveLogFailureReason(
            result({ aiStatus: 'error' as never, aiReason: 'truncated' }),
            trace({ response: { error: 'boom' } as never }),
            isErr
        )).toBe('boom');
    });
    it('falls back: notes[0] → result.summary → truncated literal → "AI request failed (REASON)." → "Unknown failure."', () => {
        expect(resolveLogFailureReason(
            result({ aiStatus: 'error' as never }), trace({ notes: ['first note'] }), isErr
        )).toBe('first note');
        expect(resolveLogFailureReason(
            result({ aiStatus: 'error' as never, summary: 'summary text' }), trace({}), isErr
        )).toBe('summary text');
        expect(resolveLogFailureReason(
            result({ aiStatus: 'error' as never, aiReason: 'truncated' }), trace({}), isErr
        )).toBe('Response exceeded maximum output tokens before completion.');
        expect(resolveLogFailureReason(
            result({ aiStatus: 'error' as never, aiReason: 'auth' }), trace({}), isErr
        )).toBe('AI request failed (auth).');
        expect(resolveLogFailureReason(
            result({ aiStatus: 'error' as never }), trace({}), isErr
        )).toBe('Unknown failure.');
    });
});

describe('buildLogSuggestedFixes', () => {
    const isErr = (r: InquiryResult) => r.aiStatus !== 'success' && r.aiStatus !== 'degraded';

    it('non-error → ["None."]', () => {
        expect(buildLogSuggestedFixes(result({ aiStatus: 'success' as never }), trace({}), isErr, () => null))
            .toEqual(['None.']);
    });
    it('packaging failure (multi_pass_failed / chunk_execution / synthesis / preflight) → 2 messages', () => {
        const out = buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never, aiReason: 'multi_pass_failed' }),
            trace({}), isErr, () => null
        );
        expect(out.length).toBe(2);
        expect(out[0]).toMatch(/multi-pass analysis/);
    });
    it('invalid structured output → 2 messages', () => {
        const out = buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never, aiReason: 'invalid_response' }),
            trace({}), isErr, () => null
        );
        expect(out[0]).toMatch(/valid structured output/);
    });
    it('truncated reason → reduce-scope message', () => {
        const out = buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never, aiReason: 'truncated' }),
            trace({}), isErr, () => null
        );
        expect(out).toEqual(['Reduce corpus scope and rerun.']);
    });
    it('rate_limit → "Retry later."', () => {
        expect(buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never, aiReason: 'rate_limit' }), trace({}), isErr, () => null
        )).toEqual(['Retry later.']);
    });
    it('auth → key/access guidance', () => {
        expect(buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never, aiReason: 'auth' }), trace({}), isErr, () => null
        )).toEqual(['Verify API key and provider access.']);
    });
    it('timeout/unavailable/unsupported_param → review-log guidance', () => {
        for (const reason of ['timeout', 'unavailable', 'unsupported_param']) {
            expect(buildLogSuggestedFixes(
                result({ aiStatus: 'error' as never, aiReason: reason }), trace({}), isErr, () => null
            )).toEqual(['Retry and review Inquiry Log for provider error details.']);
        }
    });
    it('unrecognized reason → fallback open-log guidance', () => {
        expect(buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never, aiReason: 'something_else' }), trace({}), isErr, () => null
        )).toEqual(['Open Inquiry Log for details, then retry.']);
    });
    it('packaging detection via failureStage (no aiReason match needed)', () => {
        const out = buildLogSuggestedFixes(
            result({ aiStatus: 'error' as never }),
            trace({ failureStage: 'synthesis' as never }),
            isErr, () => null
        );
        expect(out[0]).toMatch(/multi-pass analysis/);
    });
});
