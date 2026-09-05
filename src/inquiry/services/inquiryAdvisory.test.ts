import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';
import type { ModelInfo } from '../../ai/types';
import type { ResolvedInquiryEngine } from './inquiryModelResolver';
import { computeInquiryAdvisoryContext } from './inquiryAdvisory';

function getModel(modelId: string) {
    const model = BUILTIN_MODELS.find(entry => entry.id === modelId);
    if (!model) throw new Error(`Missing builtin model: ${modelId}`);
    return model;
}

function buildResolvedEngine(model: ModelInfo, providerLabel?: string): ResolvedInquiryEngine {
    return {
        provider: model.provider,
        modelId: model.id,
        modelAlias: model.alias,
        modelLabel: model.label,
        providerLabel: providerLabel ?? model.provider,
        hasCredential: true,
        contextWindow: model.contextWindow,
        maxOutput: model.maxOutput,
        selectionReason: 'test',
        policySource: 'globalPolicy'
    };
}

describe('computeInquiryAdvisoryContext', () => {
    it('does not surface sources_preferred recommendation while inline citations are paused', () => {
        // Inline provider-level citations are temporarily disabled across all
        // providers (see resolveCitationsEnabled). The advisor used to nudge
        // OpenAI users toward Anthropic for citation-backed analysis; with
        // citations off everywhere, that nudge would mislead. The advisor
        // should suppress the sources_preferred branch and fall through to
        // other reason codes (or return null).
        const currentModel = getModel('gpt-5.5');
        const advisory = computeInquiryAdvisoryContext({
            scope: 'book',
            scopeLabel: 'B1',
            resolvedEngine: buildResolvedEngine(currentModel, 'OpenAI'),
            currentModel,
            models: BUILTIN_MODELS,
            estimatedInputTokens: 300000,
            corpusFingerprint: 'fp-1',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
        });

        if (advisory) {
            expect(advisory.recommendation.reasonCode).not.toBe('sources_preferred');
        }
    });

    it('returns null when the current engine already has sources and fits in one pass', () => {
        const currentModel = getModel('claude-opus-4-8');
        const advisory = computeInquiryAdvisoryContext({
            scope: 'book',
            scopeLabel: 'B1',
            resolvedEngine: buildResolvedEngine(currentModel, 'Anthropic'),
            currentModel,
            models: BUILTIN_MODELS,
            estimatedInputTokens: 300000,
            corpusFingerprint: 'fp-2',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
        });

        expect(advisory).toBeNull();
    });

    it('returns corpus reuse recommendation when fingerprint is reused and current engine lacks reuse', () => {
        const currentModel = getModel('llama3');
        const advisory = computeInquiryAdvisoryContext({
            scope: 'book',
            scopeLabel: 'B1',
            resolvedEngine: buildResolvedEngine(currentModel, 'Ollama'),
            currentModel,
            models: [currentModel, getModel('gemini-3.1-pro-preview')],
            estimatedInputTokens: 12000,
            corpusFingerprint: 'fp-reuse',
            corpusFingerprintReused: true,
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
        });

        expect(advisory).not.toBeNull();
        expect(advisory?.recommendation.reasonCode).toBe('cost_reuse_preferred');
        expect(advisory?.recommendation.provider).toBe('google');
        expect(advisory?.recommendation.options).toHaveLength(1);
    });

    it('returns precision recommendation for deep analysis questions when another engine is stronger', () => {
        const openAiStrong = getModel('gpt-5.5');
        const currentModel: ModelInfo = {
            ...openAiStrong,
            id: 'gpt-5.2-precision-lite-test',
            alias: 'gpt-5.2-precision-lite-test',
            label: 'GPT-5.2 Precision Lite Test',
            capabilities: openAiStrong.capabilities.filter(capability => capability !== 'reasoningStrong')
        };
        const advisory = computeInquiryAdvisoryContext({
            scope: 'book',
            scopeLabel: 'B1',
            resolvedEngine: buildResolvedEngine(currentModel, 'OpenAI'),
            currentModel,
            models: [currentModel, getModel('gemini-3.1-pro-preview')],
            estimatedInputTokens: 10000,
            corpusFingerprint: 'fp-precision',
            corpusFingerprintReused: false,
            questionText: 'Compare thematic contradictions and evaluate the causal tradeoffs across this arc.',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
        });

        expect(advisory).not.toBeNull();
        expect(advisory?.recommendation.reasonCode).toBe('precision_analysis_preferred');
        expect(advisory?.recommendation.provider).toBe('google');
        expect(advisory?.recommendation.options).toHaveLength(1);
    });

    it('does not suggest a single-pass switch for only a minor pass-count gain', () => {
        const currentModel = getModel('claude-opus-4-8');
        const advisory = computeInquiryAdvisoryContext({
            scope: 'book',
            scopeLabel: 'B1',
            resolvedEngine: buildResolvedEngine(currentModel, 'Anthropic'),
            currentModel,
            models: BUILTIN_MODELS,
            estimatedInputTokens: 220000,
            corpusFingerprint: 'fp-pass-threshold',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
        });

        expect(advisory).toBeNull();
    });

    it('returns null when no meaningful advisory advantage exists', () => {
        const currentModel = getModel('claude-opus-4-8');
        const advisory = computeInquiryAdvisoryContext({
            scope: 'book',
            scopeLabel: 'B1',
            resolvedEngine: buildResolvedEngine(currentModel, 'Anthropic'),
            currentModel,
            models: BUILTIN_MODELS,
            estimatedInputTokens: 30000,
            corpusFingerprint: 'fp-3',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
        });

        expect(advisory).toBeNull();
    });

    // "keeps createdAt stable" test removed in the 2026-05-22 catalog
    // trim: it depended on a small-context model (gpt-5.1, 200k window)
    // being forced to multi-pass while a 1M-context Anthropic model
    // handled the same corpus in one pass. With the trimmed catalog,
    // every cloud model has a >= 1M context window, so the trigger
    // condition (context-size disparity) no longer occurs. The
    // createdAt-stability mechanic itself is still exercised by the
    // session reload tests in InquirySessionStore.reload.test.ts.
});
