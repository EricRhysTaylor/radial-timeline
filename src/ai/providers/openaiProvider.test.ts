import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/openaiApi', () => ({
    callOpenAiResponsesApi: vi.fn()
}));

vi.mock('../credentials/credentials', () => ({
    getCredential: vi.fn().mockResolvedValue('test-key')
}));

vi.mock('../settings/aiSettings', () => ({
    buildDefaultAiSettings: vi.fn(() => ({
        cacheWindows: {
            openaiRetention: '24h'
        }
    }))
}));

vi.mock('../settings/validateAiSettings', () => ({
    validateAiSettings: vi.fn(() => ({
        value: {
            cacheWindows: {
                openaiRetention: 'in_memory'
            }
        }
    }))
}));

import { callOpenAiResponsesApi } from '../../api/openaiApi';
import { OpenAIProvider } from './openaiProvider';

describe('OpenAIProvider', () => {
    beforeEach(() => {
        vi.mocked(callOpenAiResponsesApi).mockReset();
    });

    it('passes the configured OpenAI prompt cache retention through to Responses', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: {}
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        await provider.generateText({
            modelId: 'gpt-5.5',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return a short answer.'
        });

        expect(callOpenAiResponsesApi).toHaveBeenCalledWith(
            'test-key',
            'gpt-5.5',
            'You are precise.',
            'Return a short answer.',
            undefined,
            undefined,
            undefined,
            undefined,
            'in_memory',
            undefined
        );
    });

    it('passes prompt cache keys through to the OpenAI Responses adapter', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: {}
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        await provider.generateText({
            modelId: 'gpt-5.5',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return a short answer.',
            promptCacheKey: 'rt:inquiry:book-b1'
        });

        expect(callOpenAiResponsesApi).toHaveBeenCalledWith(
            'test-key',
            'gpt-5.5',
            'You are precise.',
            'Return a short answer.',
            undefined,
            undefined,
            undefined,
            undefined,
            'in_memory',
            'rt:inquiry:book-b1'
        );
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
                        cached_tokens: 900
                    }
                }
            }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateJson({
            modelId: 'gpt-5.5',
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

    // ── Cache provenance: 'created' when key supplied + no read ──
    //
    // Mirrors the Gemini fix. OpenAI's API does not give a "creation"
    // signal in the response (caching is implicit), but if we supplied
    // a promptCacheKey and the run succeeded with no cached reads,
    // the prefix is now armed for the next call.

    it('REGRESSION: OpenAI first call (cache key supplied, no cached_tokens) reports cacheStatus="created"', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: '{"ok":true}',
            responseData: {
                usage: {
                    input_tokens: 1200,
                    output_tokens: 300
                    // No input_tokens_details — cached_tokens is 0 / absent
                }
            }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-5.5',
            systemPrompt: 'You are precise.',
            userPrompt: 'Return a short answer.',
            promptCacheKey: 'rt:inquiry:book-b1'
        });

        expect(result.success).toBe(true);
        expect(result.cacheStatus).toBe('created');
        // cacheUsed=false keeps reuseState='eligible' downstream
        // (Settings preview shows "Cache armed", NOT "Warm cache
        // confirmed" which requires payload-proven reuse).
        expect(result.cacheUsed).toBe(false);
    });

    it('OpenAI call without a prompt cache key reports no cache status (no caching attempted)', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: {
                usage: { input_tokens: 500, output_tokens: 100 }
            }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-5.5',
            systemPrompt: 'You are precise.',
            userPrompt: 'Hi.'
        });

        expect(result.success).toBe(true);
        expect(result.cacheStatus).toBeUndefined();
        expect(result.cacheUsed).toBeUndefined();
    });

    it('OpenAI failed run with a cache key does NOT claim "created" (a failure didn\'t prime anything)', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: false,
            content: null,
            responseData: { error: { message: 'rate_limited' } },
            error: 'rate_limited'
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-5.5',
            systemPrompt: 'You are precise.',
            userPrompt: 'Hi.',
            promptCacheKey: 'rt:inquiry:book-b1'
        });

        expect(result.success).toBe(false);
        expect(result.cacheStatus).toBeUndefined();
        expect(result.cacheUsed).toBeUndefined();
    });

    it('OpenAI with bypassProviderReuse skips the "created" claim even when a key is set', async () => {
        vi.mocked(callOpenAiResponsesApi).mockResolvedValue({
            success: true,
            content: 'ok',
            responseData: { usage: { input_tokens: 1200, output_tokens: 100 } }
        });

        const provider = new OpenAIProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gpt-5.5',
            systemPrompt: 'You are precise.',
            userPrompt: 'Hi.',
            promptCacheKey: 'rt:inquiry:book-b1',
            bypassProviderReuse: true
        });

        expect(result.success).toBe(true);
        expect(result.cacheStatus).toBeUndefined();
        expect(result.cacheUsed).toBeUndefined();
    });
});
