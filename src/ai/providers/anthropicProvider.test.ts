import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/anthropicApi', () => ({
    callAnthropicApi: vi.fn()
}));

vi.mock('../credentials/credentials', () => ({
    getCredential: vi.fn().mockResolvedValue('test-key')
}));

vi.mock('../settings/aiSettings', () => ({
    buildDefaultAiSettings: vi.fn(() => ({})),
    ANTHROPIC_REQUESTED_CACHE_TTL: '1h'
}));

vi.mock('../settings/validateAiSettings', () => ({
    validateAiSettings: vi.fn(() => ({ value: {} }))
}));

import { callAnthropicApi } from '../../api/anthropicApi';
import { AnthropicProvider } from './anthropicProvider';

describe('AnthropicProvider output truncation', () => {
    beforeEach(() => {
        vi.mocked(callAnthropicApi).mockReset();
    });

    it('flags a max_tokens stop_reason as truncated (not a malformed-JSON success)', async () => {
        // Partial JSON returned because the response hit the output cap.
        vi.mocked(callAnthropicApi).mockResolvedValue({
            success: true,
            content: '{"findings":[{"ref_id":"scn_a1b2c3d4","headline":"cut off',
            responseData: {
                stop_reason: 'max_tokens',
                usage: { input_tokens: 71, output_tokens: 4000 }
            }
        } as never);

        const provider = new AnthropicProvider({ settings: {} } as never);
        const result = await provider.generateJson({
            modelId: 'claude-opus-4-7',
            systemPrompt: 'analyze',
            userPrompt: 'corpus',
            jsonSchema: { type: 'object' }
        } as never);

        // Truncation must NOT pass as success — it routes to the runner's
        // truncation recovery instead of failing downstream as bad JSON.
        expect(result.success).toBe(false);
        expect(result.aiStatus).toBe('rejected');
        expect(result.aiReason).toBe('truncated');
    });

    it('maps a pre-output refusal (stop_reason "refusal", empty content) to a terminal rejection', async () => {
        // Pre-output refusal: HTTP 200 but no usable content, so callAnthropicApi
        // reports success:false with its generic "invalid response" error.
        vi.mocked(callAnthropicApi).mockResolvedValue({
            success: false,
            content: null,
            responseData: {
                stop_reason: 'refusal',
                stop_details: { category: 'cyber' }
            },
            error: 'Invalid response structure from Anthropic.'
        } as never);

        const provider = new AnthropicProvider({ settings: {} } as never);
        const result = await provider.generateJson({
            modelId: 'claude-fable-5',
            systemPrompt: 'analyze',
            userPrompt: 'corpus',
            jsonSchema: { type: 'object' }
        } as never);

        expect(result.success).toBe(false);
        expect(result.aiStatus).toBe('rejected');
        expect(result.aiReason).toBe('refusal');
        // The category is surfaced and the message overrides the misleading
        // generic "invalid response" error.
        expect(result.error).toContain('category: cyber');
        expect(result.error).toContain('refuse');
    });

    it('maps a mid-stream refusal (stop_reason "refusal", partial content, null category) to a rejection', async () => {
        vi.mocked(callAnthropicApi).mockResolvedValue({
            success: true,
            content: 'partial text before refusal',
            responseData: {
                stop_reason: 'refusal',
                stop_details: { category: null }
            }
        } as never);

        const provider = new AnthropicProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'claude-fable-5',
            systemPrompt: 'write',
            userPrompt: 'prompt'
        } as never);

        expect(result.success).toBe(false);
        expect(result.aiStatus).toBe('rejected');
        expect(result.aiReason).toBe('refusal');
        // Null category → no "(category: …)" suffix, branch on stop_reason only.
        expect(result.error).not.toContain('category:');
        expect(result.error).toContain('refuse');
    });

    it('treats a normal end_turn stop_reason as success', async () => {
        vi.mocked(callAnthropicApi).mockResolvedValue({
            success: true,
            content: '{"findings":[]}',
            responseData: {
                stop_reason: 'end_turn',
                usage: { input_tokens: 71, output_tokens: 120 }
            }
        } as never);

        const provider = new AnthropicProvider({ settings: {} } as never);
        const result = await provider.generateJson({
            modelId: 'claude-opus-4-7',
            systemPrompt: 'analyze',
            userPrompt: 'corpus',
            jsonSchema: { type: 'object' }
        } as never);

        expect(result.success).toBe(true);
        expect(result.aiStatus).toBe('success');
        expect(result.aiReason).toBeUndefined();
    });
});
