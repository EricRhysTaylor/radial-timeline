import { describe, expect, it } from 'vitest';
import { extractTokenUsage } from './providerUsage';

describe('extractTokenUsage', () => {
    it('aggregates Anthropic cache-aware input fields into full input totals', () => {
        const usage = extractTokenUsage('anthropic', {
            usage: {
                input_tokens: 196,
                cache_read_input_tokens: 176000,
                cache_creation_input_tokens: 12000,
                output_tokens: 18500
            }
        });

        expect(usage).toEqual({
            inputTokens: 188196,
            outputTokens: 18500,
            totalTokens: 206696,
            rawInputTokens: 196,
            cacheReadInputTokens: 176000,
            cacheCreationInputTokens: 12000,
            cacheCreation5mInputTokens: undefined,
            cacheCreation1hInputTokens: undefined
        });
    });

    it('preserves Anthropic cache creation tokens by ttl when available', () => {
        const usage = extractTokenUsage('anthropic', {
            usage: {
                input_tokens: 196,
                cache_read_input_tokens: 176000,
                cache_creation: {
                    ephemeral_5m_input_tokens: 10000,
                    ephemeral_1h_input_tokens: 2000
                },
                output_tokens: 18500
            }
        });

        expect(usage).toEqual({
            inputTokens: 188196,
            outputTokens: 18500,
            totalTokens: 206696,
            rawInputTokens: 196,
            cacheReadInputTokens: 176000,
            cacheCreationInputTokens: 12000,
            cacheCreation5mInputTokens: 10000,
            cacheCreation1hInputTokens: 2000
        });
    });

    it('returns Anthropic output usage without inventing input totals when input fields are missing', () => {
        const usage = extractTokenUsage('anthropic', {
            usage: {
                output_tokens: 18500
            }
        });

        expect(usage).toEqual({
            inputTokens: undefined,
            outputTokens: 18500,
            totalTokens: undefined,
            rawInputTokens: undefined,
            cacheReadInputTokens: undefined,
            cacheCreationInputTokens: undefined
        });
    });

    it('extracts OpenAI cached token usage from Responses-style details', () => {
        const usage = extractTokenUsage('openai', {
            usage: {
                input_tokens: 1200,
                output_tokens: 300,
                input_tokens_details: {
                    cached_tokens: 900
                }
            }
        });

        expect(usage).toEqual({
            inputTokens: 1200,
            outputTokens: 300,
            totalTokens: 1500,
            cacheReadInputTokens: 900
        });
    });

    it('extracts GPT-5.6+ cache_write_tokens as cache-creation usage', () => {
        // Live gpt-6.1-sol shape (2026-10-03 probe, question 1 of a shared corpus).
        const usage = extractTokenUsage('openai', {
            usage: {
                input_tokens: 6090,
                output_tokens: 40,
                total_tokens: 6130,
                input_tokens_details: {
                    cache_write_tokens: 6069,
                    cached_tokens: 0
                }
            }
        });

        expect(usage).toEqual({
            inputTokens: 6090,
            outputTokens: 40,
            totalTokens: 6130,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 6069
        });
    });

    it('includes Gemini thinking tokens in billed output usage', () => {
        const usage = extractTokenUsage('google', {
            usageMetadata: {
                promptTokenCount: 264_606,
                candidatesTokenCount: 531,
                thoughtsTokenCount: 4_878,
                totalTokenCount: 270_015,
                cachedContentTokenCount: 264_584
            }
        });

        expect(usage).toEqual({
            inputTokens: 264_606,
            outputTokens: 5_409,
            totalTokens: 270_015,
            cacheReadInputTokens: 264_584
        });
    });
});
