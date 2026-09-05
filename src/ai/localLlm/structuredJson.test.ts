import { describe, expect, it } from 'vitest';
import { runStructuredJsonPipeline } from './structuredJson';

describe('runStructuredJsonPipeline', () => {
    const schema = {
        type: 'object',
        properties: {
            status: { type: 'string' }
        },
        required: ['status']
    };

    it('accepts a valid structured JSON success path', async () => {
        const result = await runStructuredJsonPipeline({
            providerLabel: 'Local LLM',
            schema,
            jsonMode: 'response_format',
            maxRetries: 1,
            runner: {
                async run() {
                    return {
                        content: '{"status":"ok"}',
                        responseData: { ok: true },
                        requestPayload: { ok: true }
                    };
                }
            },
            systemPrompt: 'Return only JSON.',
            userPrompt: 'Return {"status":"ok"}'
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.content).toBe('{"status":"ok"}');
            expect(result.repairCount).toBe(0);
        }
    });

    it('fails explicitly on malformed JSON instead of attempting a repair pass', async () => {
        let calls = 0;
        const result = await runStructuredJsonPipeline({
            providerLabel: 'Local LLM',
            schema,
            jsonMode: 'prompt_only',
            maxRetries: 1,
            runner: {
                async run() {
                    calls += 1;
                    return {
                        content: '```json\n{"status": }\n```',
                        responseData: { repaired: false },
                        requestPayload: { repaired: false }
                    };
                }
            },
            systemPrompt: 'Return only JSON.',
            userPrompt: 'Return {"status":"ok"}'
        });

        expect(calls).toBe(1);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.stage).toBe('initial');
            expect(result.repairCount).toBe(0);
            expect(result.error).toContain('Invalid JSON');
        }
    });

    it('fails explicitly when malformed JSON is returned', async () => {
        const result = await runStructuredJsonPipeline({
            providerLabel: 'Local LLM',
            schema,
            jsonMode: 'prompt_only',
            maxRetries: 1,
            runner: {
                async run() {
                    return {
                        content: '{"status": }',
                        responseData: { ok: false },
                        requestPayload: { ok: false }
                    };
                }
            },
            systemPrompt: 'Return only JSON.',
            userPrompt: 'Return {"status":"ok"}'
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.stage).toBe('initial');
            expect(result.error).toContain('Invalid JSON');
        }
    });
});
