import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCredential, countAnthropicTokens, countGeminiTokens } = vi.hoisted(() => ({
    getCredential: vi.fn(),
    countAnthropicTokens: vi.fn(),
    countGeminiTokens: vi.fn()
}));

vi.mock('../credentials/credentials', () => ({
    getCredential
}));

vi.mock('../../api/anthropicApi', () => ({
    countAnthropicTokens
}));

vi.mock('../../api/geminiApi', () => ({
    countGeminiTokens
}));

import {
    describeTokenEstimateMethod,
    estimateInputTokens
} from './inputTokenEstimate';

describe('estimateInputTokens', () => {
    beforeEach(() => {
        getCredential.mockReset();
        countAnthropicTokens.mockReset();
        countGeminiTokens.mockReset();
    });

    it('uses Anthropic provider counts when available', async () => {
        getCredential.mockResolvedValue('test-key');
        countAnthropicTokens.mockResolvedValue({
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            inputTokens: 43210,
            source: 'provider_count'
        });

        const result = await estimateInputTokens({
            plugin: {} as never,
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            systemPrompt: 'system',
            userPrompt: 'user',
            safeInputBudget: 100000
        });

        expect(result).toEqual({
            inputTokens: 43210,
            method: 'anthropic_count',
            uncertaintyTokens: 500
        });
        expect(countAnthropicTokens).toHaveBeenCalledWith(
            'test-key',
            'claude-opus-4-7',
            'system',
            'user',
            undefined,
            undefined,
            undefined,
            undefined
        );
    });

    it('throws when Anthropic counting fails — no silent fallback', async () => {
        // Per RT doctrine (code-doctrine.md §2, inquiry-critical-path-rules.md §8),
        // a failed provider count must NOT be substituted with the chars/4
        // heuristic. The function must throw so the caller can surface
        // "Token count unavailable" rather than fabricating a number.
        getCredential.mockResolvedValue('test-key');
        countAnthropicTokens.mockRejectedValue(new Error('counting unavailable'));

        await expect(estimateInputTokens({
            plugin: {} as never,
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            systemPrompt: 'system',
            userPrompt: 'user prompt',
            evidenceDocuments: [{ title: 'Scene 1', content: 'Evidence text' }],
            safeInputBudget: 100000
        })).rejects.toThrow('counting unavailable');
    });

    it('throws when Anthropic API key is missing — no silent fallback', async () => {
        getCredential.mockResolvedValue('');

        await expect(estimateInputTokens({
            plugin: {} as never,
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            systemPrompt: 'system',
            userPrompt: 'user prompt'
        })).rejects.toThrow(/Anthropic API key unavailable/);
        expect(countAnthropicTokens).not.toHaveBeenCalled();
    });

    it('keeps OpenAI on the chars/4 heuristic path — no local tokenizer is shipped', async () => {
        const result = await estimateInputTokens({
            plugin: {} as never,
            provider: 'openai',
            modelId: 'gpt-5.5',
            systemPrompt: 'system',
            userPrompt: 'user prompt'
        });

        expect(result.method).toBe('heuristic_chars');
        expect(getCredential).not.toHaveBeenCalled();
        expect(countAnthropicTokens).not.toHaveBeenCalled();
        expect(countGeminiTokens).not.toHaveBeenCalled();
    });

    it('keeps Ollama on the heuristic path (no remote tokenizer)', async () => {
        const result = await estimateInputTokens({
            plugin: {} as never,
            provider: 'ollama',
            modelId: 'llama-3',
            systemPrompt: 'system',
            userPrompt: 'user prompt'
        });

        expect(result.method).toBe('heuristic_chars');
        expect(getCredential).not.toHaveBeenCalled();
        expect(countAnthropicTokens).not.toHaveBeenCalled();
        expect(countGeminiTokens).not.toHaveBeenCalled();
    });

    it('uses Gemini provider counts for google models when a key is configured', async () => {
        getCredential.mockResolvedValue('test-key');
        countGeminiTokens.mockResolvedValue({
            provider: 'google',
            modelId: 'gemini-3.1-pro-preview',
            inputTokens: 12345,
            source: 'provider_count'
        });

        const result = await estimateInputTokens({
            plugin: {} as never,
            provider: 'google',
            modelId: 'gemini-3.1-pro-preview',
            systemPrompt: 'system',
            userPrompt: 'user',
            safeInputBudget: 100000
        });

        expect(result).toEqual({
            inputTokens: 12345,
            method: 'google_count',
            uncertaintyTokens: 500
        });
        expect(countGeminiTokens).toHaveBeenCalledWith(
            'test-key',
            'gemini-3.1-pro-preview',
            'system',
            'user'
        );
    });

    it('throws when Gemini count fails — no silent fallback', async () => {
        // Same doctrine as the Anthropic path: provider-count failure
        // is surfaced as a throw, never substituted with chars/4.
        getCredential.mockResolvedValue('test-key');
        countGeminiTokens.mockRejectedValue(new Error('gemini network error'));

        await expect(estimateInputTokens({
            plugin: {} as never,
            provider: 'google',
            modelId: 'gemini-3.1-pro-preview',
            systemPrompt: 'system',
            userPrompt: 'user prompt'
        })).rejects.toThrow('gemini network error');
    });

    it('throws when Gemini API key is missing — no silent fallback', async () => {
        getCredential.mockResolvedValue('');

        await expect(estimateInputTokens({
            plugin: {} as never,
            provider: 'google',
            modelId: 'gemini-3.1-pro-preview',
            systemPrompt: 'system',
            userPrompt: 'user prompt'
        })).rejects.toThrow(/Gemini API key unavailable/);
        expect(countGeminiTokens).not.toHaveBeenCalled();
    });
});

describe('describeTokenEstimateMethod', () => {
    it('labels provider counts, heuristic chars, and unavailable distinctly', () => {
        expect(describeTokenEstimateMethod('anthropic_count')).toBe('Anthropic provider count');
        expect(describeTokenEstimateMethod('google_count')).toBe('Gemini provider count');
        expect(describeTokenEstimateMethod('heuristic_chars')).toBe('Heuristic estimate');
        expect(describeTokenEstimateMethod('unavailable')).toBe('Provider count unavailable');
    });
});
