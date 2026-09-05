/**
 * Cross-surface invariant + source-grep guards for the canonical estimate
 * contract.
 *
 * These tests enforce the rules from the architectural audit:
 *   - Every AI-facing UI surface that gates on a token estimate must
 *     route through the typed `TokenEstimate` contract, NOT a raw
 *     `requestTokens > 0` check.
 *   - Cost-displaying surfaces must refuse to compute when the input
 *     estimate is unavailable. No fabricated near-zero costs.
 *   - The Gemini provider-count-unavailable fixture must produce honest
 *     state on every surface: no `~0k`, no indefinite `Estimating...`,
 *     no fake provider count.
 */
import { describe, it, expect } from 'vitest';
import {
    buildPanelViewModel,
    type FeatureForecastInput
} from '../../settings/sections/aiPanelEstimate';
import {
    tokenEstimateFromMethod,
    formatTokenHeadline,
    formatTokenShorthand
} from './';
import {
    formatCostHeadline,
    formatShortUsd
} from './costEstimate';

// Source-grep guards (pinning that production code routes through the
// canonical contract) live in src/settings/sections/AiSection.test.ts
// and src/inquiry/InquiryView.test.ts, which already import fs/path in
// the compliance baseline. Keeping this file pure-behavior avoids adding
// new node-core imports.

// ── Fixture: Gemini provider count unavailable + local corpus known ──

const geminiUnavailableForecast: Extract<FeatureForecastInput, { kind: 'available' }> = {
    kind: 'available',
    providerCount: tokenEstimateFromMethod('unavailable', 0),
    corpusBreakdown: { scenesTokens: 135_200, outlineTokens: 0, referenceTokens: 0 },
    promptBreakdown: {
        requestTokens: 11,
        roleTemplateTokens: 92,
        instructionTokens: 1100,
        outputContractTokens: 964,
        transformTokens: 0
    },
    sceneCount: 56,
    outlineCount: 0,
    referenceCount: 0,
    safeInputBudget: 200_000
};

describe('Cross-surface regression: Gemini provider count unavailable + local corpus known', () => {
    it('panel headline never reads ~0k or "Estimating…" — it must surface honest source', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: geminiUnavailableForecast
        });
        const headline = formatTokenHeadline(vm.header.headline);
        // Must not be ~0k.
        expect(headline.numericText).not.toMatch(/~0k|~0\.0k/);
        // Must not be the pending state ("Estimating…") — the snapshot
        // has completed, the count just failed.
        expect(headline.numericText).not.toBe('Estimating…');
        // Must be the local-estimate sum, with source provenance disclosed.
        expect(vm.header.headline.source).toBe('local_estimate');
        expect(vm.header.headlineDisclosure).toContain('Provider count unavailable');
    });

    it('panel Total row never reads ~0k while corpus is positive', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: geminiUnavailableForecast
        });
        const processing = vm.sections.find(s => s.title === 'Processing')!;
        const total = processing.items.find(item => item.kind === 'total_row');
        expect(total?.kind).toBe('total_row');
        if (total?.kind !== 'total_row') throw new Error('unreachable');
        expect(total.estimate.source).not.toBe('unavailable');
        expect(formatTokenShorthand(total.estimate)).not.toBe('—');
        // Sum is at least the visible corpus.
        if (total.estimate.source === 'local_estimate' || total.estimate.source === 'provider_count' || total.estimate.source === 'prior_run') {
            expect(total.estimate.tokens).toBeGreaterThanOrEqual(135_200);
        }
    });

    it('panel + Total + provider-input summary all carry the same source (no provenance drift)', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: geminiUnavailableForecast
        });
        const processing = vm.sections.find(s => s.title === 'Processing')!;
        const total = processing.items.find(item => item.kind === 'total_row');
        if (total?.kind !== 'total_row') throw new Error('unreachable');
        expect(total.estimate.source).toBe(vm.header.headline.source);
        if (vm.header.providerInputSummary.kind === 'known') {
            expect(vm.header.providerInputSummary.source).toBe(vm.header.headline.source);
        }
    });

    it('expected passes label discloses local_estimate source (not "n/a")', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: geminiUnavailableForecast
        });
        // Should compute passes from the local sum + disclose source.
        expect(vm.header.expectedPasses.kind).toBe('known');
        if (vm.header.expectedPasses.kind === 'known') {
            expect(vm.header.expectedPasses.source).toBe('local_estimate');
        }
    });
});

// ── Fixture: Gemini provider count succeeds (happy path) ──

describe('Cross-surface regression: provider count succeeds', () => {
    const happyForecast: Extract<FeatureForecastInput, { kind: 'available' }> = {
        ...geminiUnavailableForecast,
        providerCount: tokenEstimateFromMethod('google_count', 140_500),
        providerKnownPassCount: 1
    };

    it('panel headline reads provider count with no disclosure suffix', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: happyForecast
        });
        expect(vm.header.headline.source).toBe('provider_count');
        expect(vm.header.headlineDisclosure).toBeNull();
        const headline = formatTokenHeadline(vm.header.headline);
        expect(headline.numericText).toMatch(/^~\d/);
        expect(headline.unitText).toBe('tokens');
    });

    it('expected passes uses providerKnownPassCount as authoritative', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: happyForecast
        });
        if (vm.header.expectedPasses.kind === 'known') {
            expect(vm.header.expectedPasses.passes).toBe(1);
            expect(vm.header.expectedPasses.source).toBe('provider_count');
        }
    });
});

// ── Fixture: cost surfaces refuse to compute when input is unavailable ──

describe('Cost surfaces never fabricate near-zero costs from a failed token count', () => {
    it('tiny costs (sub-cent) render as <$0.01, not $0.00', () => {
        // The Gemini $0.01 bug: when countTokens fails and tokens = 0,
        // the pricing math produces ~$0.0001 which the legacy formatter
        // rounded to "$0.01" — looked authoritative but was fake. The
        // new floor surfaces sub-cent values honestly.
        expect(formatShortUsd(0.0001)).toBe('<$0.01');
        expect(formatShortUsd(0.005)).toBe('<$0.01');
    });

    it('unavailable cost estimate renders "Unavailable", never $0.00', () => {
        expect(formatCostHeadline({ source: 'unavailable' }, 'fresh')).toBe('Unavailable');
        expect(formatCostHeadline({ source: 'unavailable' }, 'cached')).toBe('Unavailable');
    });

    it('pending cost estimate renders "Estimating…", never a fake value', () => {
        expect(formatCostHeadline({ source: 'pending' }, 'fresh')).toBe('Estimating…');
    });
});

