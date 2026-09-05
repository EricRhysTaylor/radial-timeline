import { describe, it, expect } from 'vitest';
import {
    buildPanelViewModel,
    formatExpectedPassesLabel,
    formatProviderInputSummary,
    formatTokenRowText,
    formatTotalRowText,
    sumLocalEstimateTokens,
    type BuildPanelInput,
    type FeatureForecastInput,
    type PanelSection,
    type PanelTokenEstimate
} from './aiPanelEstimate';
import { formatTokenHeadline, pickBestTokenEstimate } from '../../ai/estimates';

// ── Test fixtures ──────────────────────────────────────────────────

const baseAvailableForecast: Extract<FeatureForecastInput, { kind: 'available' }> = {
    kind: 'available',
    providerCount: { source: 'unavailable' },
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

const buildInput = (overrides: Partial<Extract<FeatureForecastInput, { kind: 'available' }>> = {}): BuildPanelInput => ({
    feature: 'inquiry',
    provider: 'google',
    modelId: 'gemini-3.5-flash',
    forecast: { ...baseAvailableForecast, ...overrides }
});

// ── Invariants (the spec the audit demanded) ───────────────────────

describe('aiPanelEstimate — invariants', () => {
    it('positive visible corpus can never produce a ~0k header (Gemini countTokens failure scenario)', () => {
        const vm = buildPanelViewModel(buildInput({ providerCount: { source: 'unavailable' } }));
        // The screenshot bug: header said ~0k while corpus showed ~135.2k.
        // With the new model, the provider count being unavailable does NOT
        // collapse the header — local estimate sums the visible parts and
        // discloses provenance.
        expect(vm.header.headline.source).toBe('local_estimate');
        if (vm.header.headline.source === 'unavailable') throw new Error('unreachable');
        expect(vm.header.headline.tokens).toBeGreaterThan(135_000);
        expect(formatTokenHeadline(vm.header.headline).numericText).not.toBe('—');
        expect(formatTokenHeadline(vm.header.headline).numericText).not.toBe('Unavailable');
        expect(vm.header.headlineDisclosure).toContain('Provider count unavailable');
    });

    it('when total is known, it is at least the visible local sum (overhead absorbs any positive delta)', () => {
        // Phrased as a non-negative-overhead invariant, not "Total === headline
        // literally forever." A future "Visible parts" row alongside Total is
        // still compatible — the constraint is just: known total ≥ visible sum,
        // and the delta surfaces as the Provider overhead row in the same source.
        const vm = buildPanelViewModel(buildInput({ providerCount: { source: 'unavailable' } }));
        const processing = vm.sections.find(s => s.title === 'Processing');
        expect(processing).toBeDefined();
        const totalItem = processing!.items.find(item => item.kind === 'total_row');
        expect(totalItem?.kind).toBe('total_row');
        if (totalItem?.kind !== 'total_row') throw new Error('unreachable');
        if (totalItem.estimate.source === 'unavailable') throw new Error('total should be local_estimate here');
        const visibleSum = sumLocalEstimateTokens(135_200, 11, 92, 1100, 964);
        expect(totalItem.estimate.tokens).toBeGreaterThanOrEqual(visibleSum);
    });

    it('provider-count unavailable uses local estimate with explicit local_estimate source', () => {
        const vm = buildPanelViewModel(buildInput({ providerCount: { source: 'unavailable' } }));
        expect(vm.header.headline.source).toBe('local_estimate');
        expect(vm.header.providerInputSummary.kind).toBe('known');
        if (vm.header.providerInputSummary.kind === 'known') {
            expect(vm.header.providerInputSummary.source).toBe('local_estimate');
        }
        const summary = formatProviderInputSummary(vm.header.providerInputSummary);
        expect(summary).toContain('local estimate');
    });

    it('truly empty forecast (no corpus + no prompt + no provider count) renders unavailable header and no token unit', () => {
        const vm = buildPanelViewModel(buildInput({
            providerCount: { source: 'unavailable' },
            corpusBreakdown: { scenesTokens: 0, outlineTokens: 0, referenceTokens: 0 },
            promptBreakdown: { requestTokens: 0, roleTemplateTokens: 0, instructionTokens: 0, outputContractTokens: 0, transformTokens: 0 }
        }));
        expect(vm.header.headline.source).toBe('unavailable');
        const headlineFmt = formatTokenHeadline(vm.header.headline);
        expect(headlineFmt.unitText).toBeNull();
        expect(headlineFmt.numericText).toBe('Unavailable');
        // Passes label discloses unavailable instead of "n/a".
        expect(formatExpectedPassesLabel(vm.header.expectedPasses)).toContain('unavailable');
    });

    it('expected passes discloses source — provider_count is authoritative, local_estimate is disclosed', () => {
        const providerVm = buildPanelViewModel(buildInput({
            providerCount: { source: 'provider_count', tokens: 140_000 },
            providerKnownPassCount: 1
        }));
        expect(providerVm.header.expectedPasses.kind).toBe('known');
        if (providerVm.header.expectedPasses.kind === 'known') {
            expect(providerVm.header.expectedPasses.source).toBe('provider_count');
        }
        expect(formatExpectedPassesLabel(providerVm.header.expectedPasses))
            .toBe('Expected structured passes · 1');

        const localVm = buildPanelViewModel(buildInput({ providerCount: { source: 'unavailable' } }));
        expect(localVm.header.expectedPasses.kind).toBe('known');
        if (localVm.header.expectedPasses.kind === 'known') {
            expect(localVm.header.expectedPasses.source).toBe('local_estimate');
        }
        expect(formatExpectedPassesLabel(localVm.header.expectedPasses))
            .toContain('local estimate');
    });

    it('overhead row is omitted unless known and positive', () => {
        // Case 1: provider count is exactly equal to local sum → no overhead.
        const localSum = sumLocalEstimateTokens(135_200, 11, 92, 1100, 964);
        const vm1 = buildPanelViewModel(buildInput({
            providerCount: { source: 'provider_count', tokens: localSum }
        }));
        const processing1 = vm1.sections.find(s => s.title === 'Processing')!;
        expect(processing1.items.some(item => item.kind === 'token_row' && item.row.label === 'Provider overhead'))
            .toBe(false);

        // Case 2: provider count exceeds local sum → overhead row present.
        const vm2 = buildPanelViewModel(buildInput({
            providerCount: { source: 'provider_count', tokens: localSum + 5000 }
        }));
        const processing2 = vm2.sections.find(s => s.title === 'Processing')!;
        const overheadRow = processing2.items.find(
            item => item.kind === 'token_row' && item.row.label === 'Provider overhead'
        );
        expect(overheadRow?.kind).toBe('token_row');

        // Case 3: provider count unavailable → no overhead row at all.
        const vm3 = buildPanelViewModel(buildInput({ providerCount: { source: 'unavailable' } }));
        const processing3 = vm3.sections.find(s => s.title === 'Processing')!;
        expect(processing3.items.some(item => item.kind === 'token_row' && item.row.label === 'Provider overhead'))
            .toBe(false);
    });

    it('token rows never display em-dash for unavailable — they collapse to the label only', () => {
        const row = {
            label: 'Provider overhead',
            estimate: { source: 'unavailable' } as PanelTokenEstimate
        };
        expect(formatTokenRowText(row)).toBe('Provider overhead');
        expect(formatTokenRowText(row)).not.toContain('—');
    });
});

// ── Source-precedence helpers ──────────────────────────────────────

describe('aiPanelEstimate — pickBestEstimate (delegates to shared pickBestTokenEstimate)', () => {
    it('prefers prior_run over provider_count and local_estimate', () => {
        // Real prior-run usage beats a pre-flight provider count — the
        // prior run actually saw what the model processed, while the
        // count is just a pre-flight estimate. See doctrine in
        // src/ai/estimates/tokenEstimate.ts.
        const result = pickBestTokenEstimate(
            { source: 'local_estimate', tokens: 100 },
            { source: 'provider_count', tokens: 200 },
            { source: 'prior_run', tokens: 300 }
        );
        expect(result).toEqual({ source: 'prior_run', tokens: 300 });
    });

    it('falls back from prior_run → provider_count → local_estimate', () => {
        const result = pickBestTokenEstimate(
            null,
            { source: 'provider_count', tokens: 50 },
            { source: 'local_estimate', tokens: 100 }
        );
        expect(result).toEqual({ source: 'provider_count', tokens: 50 });
    });

    it('treats local_estimate with zero tokens as no-signal (skips it)', () => {
        const result = pickBestTokenEstimate(
            { source: 'local_estimate', tokens: 0 },
            { source: 'prior_run', tokens: 75 }
        );
        expect(result).toEqual({ source: 'prior_run', tokens: 75 });
    });

    it('returns unavailable when no candidate has signal', () => {
        const result = pickBestTokenEstimate(
            null,
            { source: 'local_estimate', tokens: 0 },
            undefined
        );
        expect(result).toEqual({ source: 'unavailable' });
    });
});

// ── Cosmetic cleanups ──────────────────────────────────────────────

describe('aiPanelEstimate — cosmetic cleanups', () => {
    it('Gossamer and Inquiry use the same Outline/References "none" wording', () => {
        const inquiryVm = buildPanelViewModel({
            feature: 'inquiry',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: { ...baseAvailableForecast, outlineCount: 0, referenceCount: 0 }
        });
        const gossamerVm = buildPanelViewModel({
            feature: 'gossamer',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: { ...baseAvailableForecast, outlineCount: 0, referenceCount: 0 }
        });
        const findPlainTexts = (sections: PanelSection[], title: string) =>
            sections.find(s => s.title === title)?.items
                .filter(item => item.kind === 'plain_text')
                .map(item => (item as { text: string }).text) ?? [];
        const inquiryCorpus = findPlainTexts(inquiryVm.sections, 'Corpus');
        const gossamerCorpus = findPlainTexts(gossamerVm.sections, 'Corpus');
        expect(inquiryCorpus).toEqual(gossamerCorpus);
        expect(inquiryCorpus).toContain('Outline — none');
        expect(inquiryCorpus).toContain('References — none');
    });

    it('Inquiry and Gossamer both render Execution: 1 pass (no Single-pass wording)', () => {
        const vm = buildPanelViewModel({
            feature: 'gossamer',
            provider: 'google',
            modelId: 'gemini-3.5-flash',
            forecast: { ...baseAvailableForecast, providerCount: { source: 'provider_count', tokens: 140_000 }, providerKnownPassCount: 1 }
        });
        const processing = vm.sections.find(s => s.title === 'Processing')!;
        const execLine = processing.items.find(item => item.kind === 'plain_text');
        expect(execLine?.kind).toBe('plain_text');
        if (execLine?.kind === 'plain_text') {
            expect(execLine.text).toBe('Execution: 1 pass');
        }
    });

    it('Total row carries the same source as the headline (no false-zero contradicting visible parts)', () => {
        // Header and footer never disagree on provenance. This is the
        // shared-source invariant — it does NOT forbid a future separate
        // "Visible parts" row, only mixing provenance between header and
        // Total. The shared-source guarantee is what prevents the original
        // bug (provider count of 0 + visible local parts producing a
        // contradictory ~0k total).
        const vm = buildPanelViewModel(buildInput({ providerCount: { source: 'unavailable' } }));
        const processing = vm.sections.find(s => s.title === 'Processing')!;
        const totalItem = processing.items.find(item => item.kind === 'total_row');
        expect(totalItem?.kind).toBe('total_row');
        if (totalItem?.kind === 'total_row') {
            expect(totalItem.estimate.source).toBe(vm.header.headline.source);
            expect(formatTotalRowText(totalItem.estimate)).not.toContain('0k');
        }
    });
});

// ── Pending feature forecast ───────────────────────────────────────

describe('aiPanelEstimate — pending forecast', () => {
    it('renders explicit pending header instead of zero', () => {
        const vm = buildPanelViewModel({
            feature: 'inquiry',
            forecast: { kind: 'pending', reason: 'Inquiry corpus context is not loaded.' }
        });
        expect(vm.sections).toHaveLength(0);
        expect(vm.header.headline.source).toBe('unavailable');
        expect(vm.header.headlineDisclosure).toBe('Inquiry corpus context is not loaded.');
    });
});
