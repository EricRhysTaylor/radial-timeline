import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/openaiApi', () => ({
    callOpenAiResponsesApi: vi.fn()
}));

vi.mock('../credentials/credentials', () => ({
    getCredential: vi.fn().mockResolvedValue('test-key')
}));

import { callOpenAiResponsesApi } from '../../api/openaiApi';
import { OpenAIProvider } from './openaiProvider';

describe('OpenAIProvider', () => {
    beforeEach(() => {
        vi.mocked(callOpenAiResponsesApi).mockReset();
    });

    it('asks the Responses adapter for a cache breakpoint unless provider reuse is bypassed', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: {}
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        await provider.generateText({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return a short answer.'
        });
        await provider.generateText({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return a short answer.',
            bypassProviderReuse: true
        });

        expect(callOpenAiResponsesApi).toHaveBeenNthCalledWith(
            1,
            'test-key',
            'gpt-6.1-sol',
            'You are precise.',
            'Return a short answer.',
            undefined,
            undefined,
            undefined,
            undefined,
            true,
            undefined
        );
        expect(vi.mocked(callOpenAiResponsesApi).mock.calls[1][8]).toBe(false);
    });

    it('passes prompt cache keys through to the OpenAI Responses adapter', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: {}
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        await provider.generateText({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return a short answer.',
            promptCacheKey: 'rt:inquiry:book-b1'
        });

        expect(vi.mocked(callOpenAiResponsesApi).mock.calls[0][9]).toBe('rt:inquiry:book-b1');
    });

    it('marks OpenAI cache hits only when cached token usage is present', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: '{"ok":true}',
            responseData: {
                usage: {
                    input_tokens: 1200,
                    output_tokens: 300,
                    input_tokens_details: {
                        cached_tokens: 900,
                        cache_write_tokens: 0
                    }
                }
            }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateJson({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return JSON.',
            jsonSchema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' }
                },
                required: ['ok'],
                additionalProperties: false
            }
        });

        expect(result.success).toBe(true);
        expect(result.cacheUsed).toBe(true);
        expect(result.cacheStatus).toBe('hit');
    });

    it('reports cacheStatus="created" when the provider reports cache_write_tokens', async () => {
        // Live shape from gpt-6.1-sol (2026-10-03 probe): question 1 writes the
        // corpus prefix; nothing is read yet.
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: '{"ok":true}',
            responseData: {
                usage: {
                    input_tokens: 6090,
                    output_tokens: 40,
                    input_tokens_details: { cache_write_tokens: 6069, cached_tokens: 0 }
                }
            }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Stable\n<<<CACHE_BREAK>>>\nQuestion'
        });

        expect(result.success).toBe(true);
        expect(result.cacheStatus).toBe('created');
        // cacheUsed=false keeps reuseState='eligible' downstream: armed, not
        // a confirmed warm read.
        expect(result.cacheUsed).toBe(false);
    });

    it('claims no cache status when the provider reports neither a read nor a write', async () => {
        // A cache key alone proves nothing: below the 1,024-token minimum, or
        // with no breakpoint, nothing is written.
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: {
                usage: {
                    input_tokens: 500,
                    output_tokens: 100,
                    input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 }
                }
            }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Hi.',
            promptCacheKey: 'rt:inquiry:book-b1'
        });

        expect(result.success).toBe(true);
        expect(result.cacheStatus).toBeUndefined();
        expect(result.cacheUsed).toBeUndefined();
    });

    it('OpenAI failed run does NOT claim "created" (a failure didn\'t prime anything)', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: false,
            content: null,
            responseData: { error: { message: 'rate_limited' } },
            error: 'rate_limited'
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-6.1-sol',
            systemPrompt: 'You are precise.',
            userPrompt: 'Hi.',
            promptCacheKey: 'rt:inquiry:book-b1'
        });

        expect(result.success).toBe(false);
        expect(result.cacheStatus).toBeUndefined();
        expect(result.cacheUsed).toBeUndefined();
    });
});
