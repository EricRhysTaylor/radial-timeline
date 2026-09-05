import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';

import {
    buildAnthropicDispatchDiagnostics,
    buildAnthropicUserContent,
    callAnthropicApi,
    countAnthropicTokens,
    normalizeAnthropicTokenCountResponse,
    sanitizeAnthropicOutputSchema
} from './anthropicApi';

const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');

type ParsedRequestBody = {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    thinking?: unknown;
    output_config?: {
        effort?: string;
        format?: { type?: string; schema?: Record<string, unknown> };
    };
    tools?: unknown;
    tool_choice?: unknown;
};

function lastRequestBody(): ParsedRequestBody {
    const request = mockedRequestUrl.mock.calls.at(-1)?.[0] as { body?: string };
    return JSON.parse(request?.body ?? '{}') as ParsedRequestBody;
}

function mockTextResponse(text: string, extra: Record<string, unknown> = {}): void {
    mockedRequestUrl.mockResolvedValue({
        status: 200,
        text: '',
        json: {
            content: [{ type: 'text', text }],
            ...extra
        }
    } as never);
}

describe('anthropic token counting', () => {
    beforeEach(() => {
        mockedRequestUrl.mockReset();
    });

    it('builds a count_tokens request and returns a canonical provider-count result', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                input_tokens: 4321
            }
        } as never);

        const result = await countAnthropicTokens(
            'test-key',
            'claude-opus-4-8',
            'System rules',
            'User prompt body'
        );

        expect(result).toEqual({
            provider: 'anthropic',
            modelId: 'claude-opus-4-8',
            inputTokens: 4321,
            source: 'provider_count'
        });

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { url?: string; body?: string; headers?: Record<string, string> };
        const body = JSON.parse(request.body ?? '{}') as {
            model?: string;
            system?: Array<{ type?: string; text?: string }>;
            messages?: Array<{ role?: string; content?: Array<{ type?: string; text?: string }> }>;
        };

        expect(request.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
        expect(request.headers?.['anthropic-version']).toBe('2023-06-01');
        expect(body.model).toBe('claude-opus-4-8');
        expect(body.system).toEqual([{ type: 'text', text: 'System rules' }]);
        expect(body.messages?.[0]?.role).toBe('user');
        expect(body.messages?.[0]?.content?.[0]).toEqual({ type: 'text', text: 'User prompt body' });
    });

    it('includes the structured tool schema in count_tokens requests for JSON runs', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                input_tokens: 896
            }
        } as never);

        await countAnthropicTokens(
            'test-key',
            'claude-opus-4-8',
            'System rules',
            'Return {"answer":"ACK"}.',
            false,
            undefined,
            undefined,
            {
                type: 'object',
                properties: {
                    answer: { type: 'string' }
                },
                required: ['answer'],
                additionalProperties: false
            }
        );

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body?: string };
        const body = JSON.parse(request.body ?? '{}') as {
            tools?: Array<{ name?: string; input_schema?: Record<string, unknown> }>;
            tool_choice?: { type?: string; name?: string };
        };

        expect(body.tools).toEqual([{
            name: 'record_structured_response',
            // Verbose description prevents Opus 4.7+ from wrapping the tool
            // input in a $PARAMETER_NAME envelope (smoke-discovered 2026-05-23).
            description: expect.stringContaining('Do NOT wrap the response in any envelope') as unknown as string,
            input_schema: {
                type: 'object',
                properties: {
                    answer: { type: 'string' }
                },
                required: ['answer'],
                additionalProperties: false
            }
        }]);
        expect(body.tool_choice).toEqual({
            type: 'tool',
            name: 'record_structured_response'
        });
    });

    it('omits the structured tool schema when citations are enabled (citations + tool_use are mutually exclusive on Anthropic)', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                input_tokens: 1024
            }
        } as never);

        await countAnthropicTokens(
            'test-key',
            'claude-opus-4-8',
            'System rules',
            'Return JSON per the schema in the prompt.',
            true,
            undefined,
            undefined,
            {
                type: 'object',
                properties: {
                    answer: { type: 'string' }
                },
                required: ['answer'],
                additionalProperties: false
            }
        );

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body?: string };
        const body = JSON.parse(request.body ?? '{}') as {
            tools?: unknown;
            tool_choice?: unknown;
        };

        // Citations attach only to text content blocks. Forcing a tool call
        // produces a tool_use block with no text — citations would have nowhere
        // to anchor. Anthropic's docs make this incompatibility explicit.
        expect(body.tools).toBeUndefined();
        expect(body.tool_choice).toBeUndefined();
    });

    it('rejects token count responses that omit input_tokens', () => {
        expect(normalizeAnthropicTokenCountResponse({
            total_tokens: 987
        }, 'claude-opus-4-8')).toBeNull();
    });
});

describe('sanitizeAnthropicOutputSchema', () => {
    it('strips unsupported numeric and string-length constraints and stamps additionalProperties:false', () => {
        const sanitized = sanitizeAnthropicOutputSchema({
            type: 'object',
            properties: {
                score: { type: 'number', minimum: 0, maximum: 10, multipleOf: 0.5 },
                label: { type: 'string', minLength: 1, maxLength: 40 },
                nested: {
                    type: 'object',
                    properties: {
                        n: { type: 'integer', minimum: 1 }
                    },
                    required: ['n']
                }
            },
            required: ['score', 'label']
        });

        expect(sanitized).toEqual({
            type: 'object',
            additionalProperties: false,
            properties: {
                score: { type: 'number' },
                label: { type: 'string' },
                nested: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        n: { type: 'integer' }
                    },
                    required: ['n']
                }
            },
            required: ['score', 'label']
        });
    });
});

describe('Claude Fable 5 always-on-thinking request shape', () => {
    const SCHEMA = {
        type: 'object',
        properties: { answer: { type: 'string', maxLength: 10 } },
        required: ['answer'],
        additionalProperties: false
    };

    beforeEach(() => {
        mockedRequestUrl.mockReset();
    });

    it('routes structured output through output_config.format (no forced tool) and omits the thinking field', async () => {
        mockTextResponse('{"answer":"ACK"}', { stop_reason: 'end_turn' });

        await callAnthropicApi(
            'test-key',
            'claude-fable-5-1',
            'System rules',
            'Return JSON per schema.',
            4000,
            true,
            undefined,
            undefined,
            8192,
            false,
            undefined,
            SCHEMA
        );

        const body = lastRequestBody();
        // No forced tool: incompatible with always-on thinking.
        expect(body.tools).toBeUndefined();
        expect(body.tool_choice).toBeUndefined();
        // Structured output via output_config.format (json_schema), sanitized.
        expect(body.output_config?.format?.type).toBe('json_schema');
        expect(body.output_config?.format?.schema).toEqual({
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false
        });
        // Effort emitted even on the schema path; thinking field never emitted.
        expect(body.output_config?.effort).toBe('high');
        expect(body.thinking).toBeUndefined();
        // Headroom applied on the schema path too; temperature/top_p omitted.
        expect(body.max_tokens).toBe(4000 + 8192);
        expect(body.temperature).toBeUndefined();
        expect(body.top_p).toBeUndefined();
    });

    it('emits output_config.effort without a thinking field on the text path', async () => {
        mockTextResponse('done', { stop_reason: 'end_turn' });

        await callAnthropicApi(
            'test-key',
            'claude-fable-5-1',
            'System rules',
            'Write a paragraph.',
            4000,
            true,
            undefined,
            undefined,
            2048
        );

        const body = lastRequestBody();
        expect(body.thinking).toBeUndefined();
        expect(body.output_config?.effort).toBe('medium');
        expect(body.output_config?.format).toBeUndefined();
        // Floor headroom (8000) applies when the budget is smaller.
        expect(body.max_tokens).toBe(4000 + 8000);
    });

    it('defaults effort to medium when no thinking budget is supplied', async () => {
        mockTextResponse('done', { stop_reason: 'end_turn' });

        await callAnthropicApi('test-key', 'claude-fable-5-1', null, 'Hi', 4000, true);

        expect(lastRequestBody().output_config?.effort).toBe('medium');
    });

    it('surfaces a zero-data-retention hint on a Fable 400 with no obvious request problem', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 400,
            text: '',
            json: { type: 'error', error: { type: 'invalid_request_error', message: 'Bad request.' } }
        } as never);

        const result = await callAnthropicApi('test-key', 'claude-fable-5-1', null, 'Hi', 4000, true);
        expect(result.success).toBe(false);
        expect(result.error).toContain('zero data retention');
        expect(result.error).toContain('30-day data retention');
    });

    it('does NOT add the retention hint when the 400 names a concrete parameter problem', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 400,
            text: '',
            json: { type: 'error', error: { type: 'invalid_request_error', message: 'temperature is not supported for this model.' } }
        } as never);

        const result = await callAnthropicApi('test-key', 'claude-fable-5-1', null, 'Hi', 4000, true);
        expect(result.error).not.toContain('zero data retention');
    });
});

describe('Claude Opus 5 thinking-defaults-on request shape', () => {
    const SCHEMA = {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false
    };

    beforeEach(() => {
        mockedRequestUrl.mockReset();
    });

    it('keeps the forced tool + tool_choice structured path but explicitly disables thinking', async () => {
        // Opus 5 runs adaptive thinking when the `thinking` field is omitted —
        // the opposite of 4.8. The forced-tool structured path depends on
        // thinking being off, so the adapter must emit thinking:{type:'disabled'}
        // (accepted at the default effort `high`) instead of omitting the field.
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                content: [{ type: 'tool_use', name: 'record_structured_response', input: { answer: 'ACK' } }],
                stop_reason: 'tool_use'
            }
        } as never);

        await callAnthropicApi(
            'test-key',
            'claude-opus-5',
            'System rules',
            'Return JSON.',
            4000,
            true,
            undefined,
            undefined,
            8192,
            false,
            undefined,
            SCHEMA
        );

        const body = lastRequestBody();
        expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_structured_response' });
        expect(body.output_config).toBeUndefined();
        expect(body.thinking).toEqual({ type: 'disabled' });
        // No thinking headroom on the structured path — thinking is off.
        expect(body.max_tokens).toBe(4000);
    });

    it('explicitly disables thinking on budget-less prose requests', async () => {
        mockTextResponse('done', { stop_reason: 'end_turn' });

        await callAnthropicApi('test-key', 'claude-opus-5', null, 'Hi', 4000, true);

        const body = lastRequestBody();
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body.output_config).toBeUndefined();
        expect(body.max_tokens).toBe(4000);
    });

    it('uses adaptive thinking + effort when a thinking budget is requested', async () => {
        mockTextResponse('done', { stop_reason: 'end_turn' });

        await callAnthropicApi(
            'test-key',
            'claude-opus-5',
            'System rules',
            'Think it through.',
            4000,
            true,
            undefined,
            undefined,
            8192
        );

        const body = lastRequestBody();
        expect(body.thinking).toEqual({ type: 'adaptive' });
        expect(body.output_config?.effort).toBe('high');
        expect(body.max_tokens).toBe(4000 + 8192);
        expect(body.temperature).toBeUndefined();
        expect(body.top_p).toBeUndefined();
    });
});

describe('Opus structured-output path is unchanged by the Fable addition', () => {
    beforeEach(() => {
        mockedRequestUrl.mockReset();
    });

    it('keeps the forced tool + tool_choice path for Opus 4.8 and never emits output_config.format', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                content: [{ type: 'tool_use', name: 'record_structured_response', input: { answer: 'ACK' } }],
                stop_reason: 'tool_use'
            }
        } as never);

        await callAnthropicApi(
            'test-key',
            'claude-opus-4-8',
            'System rules',
            'Return JSON.',
            4000,
            true,
            undefined,
            undefined,
            8192,
            false,
            undefined,
            { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }
        );

        const body = lastRequestBody();
        expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_structured_response' });
        expect(body.output_config).toBeUndefined();
        // hasJsonSchema → thinking stays off on the legacy path.
        expect(body.thinking).toBeUndefined();
        expect(body.max_tokens).toBe(4000);
    });
});

describe('buildAnthropicUserContent', () => {
    it('emits document blocks without requiring a cache delimiter', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Analyze the attached manuscript evidence.',
            citationsEnabled: true,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene evidence text' }
            ]
        });

        expect(content).toEqual([
            { type: 'text', text: 'Analyze the attached manuscript evidence.' },
            {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: 'Scene evidence text' },
                title: 'Scene S1',
                citations: { enabled: true }
            }
        ]);
    });

    it('preserves the trailing volatile block when a cache delimiter is present', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Stable instructions\n<<<CACHE_BREAK>>>\nVolatile question',
            citationsEnabled: true,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene evidence text' }
            ]
        });

        expect(content).toHaveLength(3);
        expect(content[0]).toEqual({ type: 'text', text: 'Stable instructions' });
        expect(content[1]).toMatchObject({
            type: 'document',
            title: 'Scene S1',
            citations: { enabled: true }
        });
        expect(content[2]).toEqual({ type: 'text', text: 'Volatile question' });
    });

    it('builds dispatch diagnostics from the cacheable prefix and volatile tail separately', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Stable instructions\n<<<CACHE_BREAK>>>\nVolatile question',
            citationsEnabled: true,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene evidence text' }
            ]
        });

        const diagnostics = buildAnthropicDispatchDiagnostics(content);

        expect(diagnostics.requestedCacheTtl).toBe('none');
        expect(diagnostics.hasCacheablePrefix).toBe(false);
        expect(diagnostics.documentBlockCount).toBe(0);
        expect(diagnostics.documentChars).toBe(0);
        expect(diagnostics.stableTextChars).toBe(0);
        expect(diagnostics.volatileTextChars).toBe('Stable instructions\nVolatile question'.length);
        expect(diagnostics.cachePrefixFingerprint).toBe('none');
        expect(diagnostics.volatileTextFingerprint).not.toBe('none');
        expect(diagnostics.blockShape).toBe('text>document>text');
    });

    it('records the requested cache ttl in dispatch diagnostics', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Stable instructions\n<<<CACHE_BREAK>>>\nVolatile question',
            citationsEnabled: true,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene evidence text' }
            ],
            cacheTtl: '1h'
        });

        const diagnostics = buildAnthropicDispatchDiagnostics(content, '1h');

        expect(diagnostics.requestedCacheTtl).toBe('1h');
    });

    it('emits evidence as plain text blocks when citations are disabled', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Analyze the attached manuscript evidence.',
            citationsEnabled: false,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene one body' },
                { title: 'Scene S2', content: 'Scene two body' }
            ]
        });

        expect(content).toEqual([
            { type: 'text', text: 'Analyze the attached manuscript evidence.' },
            { type: 'text', text: '## Scene S1\nScene one body' },
            { type: 'text', text: '## Scene S2\nScene two body' }
        ]);
    });

    it('places cache_control on the last evidence block when ttl is set and citations off', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Stable instructions\n<<<CACHE_BREAK>>>\nVolatile question',
            citationsEnabled: false,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene one body' },
                { title: 'Scene S2', content: 'Scene two body' }
            ],
            cacheTtl: '1h'
        });

        expect(content).toHaveLength(4);
        expect(content[0]).toEqual({ type: 'text', text: 'Stable instructions' });
        expect(content[1]).toEqual({ type: 'text', text: '## Scene S1\nScene one body' });
        expect(content[2]).toEqual({
            type: 'text',
            text: '## Scene S2\nScene two body',
            cache_control: { type: 'ephemeral', ttl: '1h' }
        });
        expect(content[3]).toEqual({ type: 'text', text: 'Volatile question' });
    });

    it('omits the trailing volatile block when no delimiter is present and citations off', () => {
        const content = buildAnthropicUserContent({
            userPrompt: 'Just instructions, no delimiter.',
            citationsEnabled: false,
            evidenceDocuments: [
                { title: 'Scene S1', content: 'Scene one body' }
            ]
        });

        expect(content).toEqual([
            { type: 'text', text: 'Just instructions, no delimiter.' },
            { type: 'text', text: '## Scene S1\nScene one body' }
        ]);
    });
});
