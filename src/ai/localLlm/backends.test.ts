import { beforeEach, describe, expect, it, vi } from 'vitest';

const callOpenAiCompatibleLocalCompletion = vi.fn();

vi.mock('./transport', () => ({
    callOpenAiCompatibleLocalCompletion,
    fetchOpenAiCompatibleLocalModels: vi.fn()
}));

const BASE_REQUEST = {
    baseUrl: 'http://localhost:1234/v1',
    timeoutMs: 30000,
    modelId: 'qwen3-30b',
    userPrompt: 'Return {"status":"ok"} as valid JSON.'
};

describe('local LLM backend response_format translation', () => {
    beforeEach(() => {
        callOpenAiCompatibleLocalCompletion.mockReset();
        callOpenAiCompatibleLocalCompletion.mockResolvedValue({
            success: true,
            content: '{"status":"ok"}',
            responseData: {},
            requestPayload: {}
        });
    });

    it('translates json_object into LM Studio json_schema form', async () => {
        const { getLocalLlmBackend } = await import('./backends');
        await getLocalLlmBackend('lmStudio').complete({
            ...BASE_REQUEST,
            responseFormat: { type: 'json_object' }
        });

        expect(callOpenAiCompatibleLocalCompletion).toHaveBeenCalledTimes(1);
        expect(callOpenAiCompatibleLocalCompletion.mock.calls[0][0].responseFormat).toEqual({
            type: 'json_schema',
            json_schema: { name: 'response', schema: { type: 'object' } }
        });
    });

    it('keeps json_object for the Ollama backend', async () => {
        const { getLocalLlmBackend } = await import('./backends');
        await getLocalLlmBackend('ollama').complete({
            ...BASE_REQUEST,
            responseFormat: { type: 'json_object' }
        });

        expect(callOpenAiCompatibleLocalCompletion.mock.calls[0][0].responseFormat).toEqual({
            type: 'json_object'
        });
    });

    it('keeps json_object for the OpenAI-compatible backend', async () => {
        const { getLocalLlmBackend } = await import('./backends');
        await getLocalLlmBackend('openaiCompatible').complete({
            ...BASE_REQUEST,
            responseFormat: { type: 'json_object' }
        });

        expect(callOpenAiCompatibleLocalCompletion.mock.calls[0][0].responseFormat).toEqual({
            type: 'json_object'
        });
    });

    it('omits response_format entirely when none is requested', async () => {
        const { getLocalLlmBackend } = await import('./backends');
        await getLocalLlmBackend('lmStudio').complete({ ...BASE_REQUEST });

        expect(callOpenAiCompatibleLocalCompletion.mock.calls[0][0].responseFormat).toBeUndefined();
    });
});
