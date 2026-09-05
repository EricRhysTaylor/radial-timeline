import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildInquiryEstimateTrace, estimateExecutionPassCountFromPrompt } = vi.hoisted(() => ({
    buildInquiryEstimateTrace: vi.fn(),
    estimateExecutionPassCountFromPrompt: vi.fn()
}));
const { prepareRunEstimate } = vi.hoisted(() => ({
    prepareRunEstimate: vi.fn()
}));

vi.mock('../../inquiry/services/inquiryEstimateTrace', () => ({
    buildInquiryEstimateTrace
}));

vi.mock('../../inquiry/runner/InquiryRunnerService', () => ({
    InquiryRunnerService: class {
        estimateExecutionPassCountFromPrompt = estimateExecutionPassCountFromPrompt;
    }
}));

vi.mock('../runtime/aiClient', () => ({
    getAIClient: vi.fn(() => ({
        prepareRunEstimate
    }))
}));

import {
    buildCanonicalExecutionEstimate,
    buildCanonicalGossamerExecutionEstimate
} from './estimateTokensFromVault';

describe('buildCanonicalExecutionEstimate', () => {
    beforeEach(() => {
        buildInquiryEstimateTrace.mockReset();
        estimateExecutionPassCountFromPrompt.mockReset();
        prepareRunEstimate.mockReset();
    });

    it('uses provider-counted Anthropic tokens from the canonical trace', async () => {
        buildInquiryEstimateTrace.mockResolvedValue({
            systemPrompt: 'system',
            userPrompt: 'user prompt',
            evidenceText: 'evidence',
            tokenEstimate: {
                inputTokens: 54321,
                outputTokens: 2048,
                totalTokens: 56369,
                inputChars: 0,
                estimationMethod: 'anthropic_count',
                uncertaintyTokens: 512,
                effectiveInputCeiling: 90000,
                expectedPassCount: 1
            },
            outputTokenCap: 4096,
            response: null,
            sanitizationNotes: [],
            notes: []
        });
        estimateExecutionPassCountFromPrompt.mockReturnValue(3);

        const result = await buildCanonicalExecutionEstimate({
            plugin: {} as never,
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            questionText: 'Analyze this manuscript.',
            scope: 'book',
            scopeLabel: 'Book 1',
            manifestEntries: [],
            vault: {} as never,
            metadataCache: {} as never
        });

        expect(result).toEqual({
            estimatedTokens: 54321,
            method: 'anthropic_count',
            promptEnvelopeCharsAdded: 'system'.length + 'user prompt'.length,
            expectedPassCount: 3,
            maxOutputTokens: 4096
        });
    });

    it('keeps non-Anthropic traces on the existing heuristic method', async () => {
        buildInquiryEstimateTrace.mockResolvedValue({
            systemPrompt: 'system',
            userPrompt: 'user prompt',
            evidenceText: 'evidence',
            tokenEstimate: {
                inputTokens: 12000,
                outputTokens: 1024,
                totalTokens: 13024,
                inputChars: 0,
                estimationMethod: 'heuristic_chars',
                uncertaintyTokens: 3000,
                effectiveInputCeiling: 90000,
                expectedPassCount: 2
            },
            outputTokenCap: 2048,
            response: null,
            sanitizationNotes: [],
            notes: []
        });
        estimateExecutionPassCountFromPrompt.mockReturnValue(undefined);

        const result = await buildCanonicalExecutionEstimate({
            plugin: {} as never,
            provider: 'openai',
            modelId: 'gpt-5.4-mini',
            questionText: 'Analyze this manuscript.',
            scope: 'book',
            scopeLabel: 'Book 1',
            manifestEntries: [],
            vault: {} as never,
            metadataCache: {} as never
        });

        expect(result?.method).toBe('heuristic_chars');
        expect(result?.expectedPassCount).toBe(2);
    });
});

describe('buildCanonicalGossamerExecutionEstimate', () => {
    beforeEach(() => {
        prepareRunEstimate.mockReset();
    });

    it('uses the canonical prepared estimate when available', async () => {
        prepareRunEstimate.mockResolvedValue({
            ok: true,
            estimate: {
                tokenEstimateInput: 27500,
                tokenEstimateMethod: 'anthropic_count',
                systemPrompt: 'system',
                userPrompt: 'user prompt'
            }
        });

        const result = await buildCanonicalGossamerExecutionEstimate({
            plugin: {} as never,
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            promptText: 'Analyze beat momentum.'
        });

        expect(result).toEqual({
            estimatedTokens: 27500,
            method: 'anthropic_count',
            promptEnvelopeCharsAdded: 'system'.length + 'user prompt'.length
        });
    });

    it('throws when the canonical prepared estimate cannot be built', async () => {
        prepareRunEstimate.mockResolvedValue({
            ok: false,
            result: {
                error: 'preview unavailable',
                reason: 'preview unavailable'
            }
        });

        await expect(buildCanonicalGossamerExecutionEstimate({
            plugin: {} as never,
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            promptText: 'Analyze beat momentum.'
        })).rejects.toThrow('preview unavailable');
    });
});
