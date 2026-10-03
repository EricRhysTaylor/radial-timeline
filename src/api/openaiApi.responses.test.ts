import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import {
    buildOpenAiResponsesInput,
    callOpenAiApi,
    callOpenAiResponsesApi,
    extractOpenAiAnnotationCitations,
    extractOpenAiResponsesContent,
    normalizeOpenAiResponsesResponseData,
    normalizeOpenAiResponsesUsage
} from './openaiApi';

describe('openai responses normalization', () => {
    it('extracts text from output_text and message content blocks', () => {
        const responseData = {
            output_text: 'Top-level summary',
            output: [
                {
                    type: 'message',
                    content: [
                        { type: 'output_text', text: 'Detail A' },
                        { type: 'output_text', output_text: 'Detail B' }
                    ]
                }
            ]
        };
        expect(extractOpenAiResponsesContent(responseData)).toBe('Top-level summary\n\nDetail A\n\nDetail B');
    });

    it('maps Responses usage fields into chat-style usage fields', () => {
        const usage = normalizeOpenAiResponsesUsage({
            input_tokens: 1200,
            output_tokens: 300
        });
        expect(usage).toEqual({
            prompt_tokens: 1200,
            completion_tokens: 300,
            total_tokens: 1500
        });
    });

    it('normalizes Responses payload into providerRouter-compatible shape', () => {
        const raw = {
            id: 'resp_123',
            status: 'completed',
            usage: {
                input_tokens: 12,
                output_tokens: 8
            }
        };

        const normalized = normalizeOpenAiResponsesResponseData(raw, 'gpt-6.1-sol', 'hello world') as Record<string, unknown>;
        const usage = normalized.usage as Record<string, unknown>;
        const choices = normalized.choices as Record<string, unknown>[];
        const firstChoice = choices[0];
        const message = firstChoice.message as Record<string, unknown>;

        expect(normalized.model).toBe('gpt-6.1-sol');
        expect(usage.prompt_tokens).toBe(12);
        expect(usage.completion_tokens).toBe(8);
        expect(usage.total_tokens).toBe(20);
        expect(message.content).toBe('hello world');
    });

    it('extracts OpenAI file citation annotations from Responses output', () => {
        const raw = {
            output: [
                {
                    type: 'message',
                    content: [
                        {
                            type: 'output_text',
                            text: 'The manuscript beat pivots at midpoint.',
                            annotations: [
                                {
                                    type: 'file_citation',
                                    file_id: 'file_123',
                                    filename: 'midpoint.md',
                                    quote: 'beat pivots at midpoint'
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        expect(extractOpenAiAnnotationCitations(raw)).toEqual([
            {
                attributionType: 'tool_file',
                sourceLabel: 'midpoint.md',
                sourceId: 'file_123',
                fileId: 'file_123',
                filename: 'midpoint.md',
                citedText: 'beat pivots at midpoint',
                startCharIndex: undefined,
                endCharIndex: undefined
            }
        ]);
    });

    it('extracts OpenAI URL citation annotations from Chat-style response payloads', () => {
        const raw = {
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: [
                            {
                                type: 'output_text',
                                text: 'Reference: style guide.',
                                annotations: [
                                    {
                                        type: 'url_citation',
                                        url: 'https://example.com/style-guide',
                                        title: 'Style Guide'
                                    }
                                ]
                            }
                        ]
                    }
                }
            ]
        };

        expect(extractOpenAiAnnotationCitations(raw)).toEqual([
            {
                attributionType: 'tool_url',
                sourceLabel: 'Style Guide',
                sourceId: 'https://example.com/style-guide',
                url: 'https://example.com/style-guide',
                title: 'Style Guide',
                citedText: undefined,
                startCharIndex: undefined,
                endCharIndex: undefined
            }
        ]);
    });

    it('returns the exact Responses request payload used for the run', async () => {
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: '',
            json: {
                id: 'resp_123',
                status: 'completed',
                output_text: 'Structured answer.'
            }
        } as never);

        const response = await callOpenAiResponsesApi(
            'test-key',
            'gpt-6.1-sol',
            'You are precise.',
            'Return JSON.',
            512,
            {
                type: 'json_schema',
                json_schema: {
                    name: 'ai_result',
                    schema: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' }
                        },
                        required: ['ok']
                    }
                }
            },
            0.1,
            0.9,
            true,
            'rt:inquiry:book-b1'
        );

        expect(response.success).toBe(true);
        expect(response.requestPayload).toEqual({
            model: 'gpt-6.1-sol',
            prompt_cache_options: { mode: 'explicit' },
            input: [
                {
                    role: 'system',
                    content: [{ type: 'input_text', text: 'You are precise.' }]
                },
                {
                    role: 'user',
                    content: [{ type: 'input_text', text: 'Return JSON.' }]
                }
            ],
            max_output_tokens: 512,
            text: {
                format: {
                    type: 'json_schema',
                    name: 'ai_result',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' }
                        },
                        required: ['ok']
                    }
                }
            },
            prompt_cache_key: 'rt:inquiry:book-b1'
        });
        expect(response.adapterNotes).toContain('Stripped temperature for OpenAI Responses request: model does not support sampling controls.');
        expect(response.adapterNotes).toContain('Stripped top_p for OpenAI Responses request: model does not support sampling controls.');
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    // Background-mode test removed in the 2026-05-22 catalog trim: the
    // gpt-5.4-pro family was the only model in
    // OPENAI_BACKGROUND_RESPONSE_MODEL_IDS, and the set is now empty. The
    // background-poll plumbing in callOpenAiResponsesApi is intact; when
    // a future model is added to that set, re-add a test row here
    // exercising the queue→retrieve flow.

    it('fails hard when OpenAI rejects structured text.format instead of retrying without it', async () => {
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');
        mockedRequestUrl.mockReset();
        mockedRequestUrl.mockResolvedValue({
            status: 400,
            text: '',
            json: {
                error: {
                    message: 'text.format is not supported for this model.'
                }
            }
        } as never);

        const response = await callOpenAiResponsesApi(
            'test-key',
            'gpt-6.1-sol',
            'You are precise.',
            'Return JSON.',
            512,
            {
                type: 'json_schema',
                json_schema: {
                    name: 'ai_result',
                    schema: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' }
                        },
                        required: ['ok']
                    }
                }
            }
        );

        expect(response.success).toBe(false);
        expect(response.error).toContain('rejected structured text.format');
        expect(response.adapterNotes).toEqual([
            'OpenAI Responses text.format was rejected by the model or endpoint; RT did not retry without structured-format enforcement.'
        ]);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('fails hard when the legacy chat endpoint rejects response_format instead of retrying without it', async () => {
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');
        mockedRequestUrl.mockReset();
        mockedRequestUrl.mockResolvedValue({
            status: 400,
            text: '',
            json: {
                error: {
                    message: 'response_format is not supported for this model.'
                }
            }
        } as never);

        const response = await callOpenAiApi(
            'test-key',
            'gpt-4.1',
            'You are precise.',
            'Return JSON.',
            256,
            undefined,
            { type: 'json_object' },
            0.2,
            0.9
        );

        expect(response.success).toBe(false);
        expect(response.error).toContain('rejected response_format');
        expect(response.adapterNotes).toEqual([
            'Legacy OpenAI chat response_format was rejected by the model or endpoint; RT did not retry without JSON-mode enforcement.'
        ]);
        expect(response.requestPayload).toEqual({
            model: 'gpt-4.1',
            messages: [
                { role: 'system', content: 'You are precise.' },
                { role: 'user', content: 'Return JSON.' }
            ],
            max_completion_tokens: 256,
            response_format: { type: 'json_object' },
            temperature: 0.2,
            top_p: 0.9
        });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });
});

describe('openai responses prompt caching (GPT-5.6+ explicit breakpoints)', () => {
    it('splits the cache break into a breakpointed stable block and a volatile block', () => {
        const input = buildOpenAiResponsesInput(
            'gpt-6.1-sol',
            'Role template',
            'Instructions\n\nEVIDENCE:\ncorpus text\n\n<<<CACHE_BREAK>>>\n\nUser Question:\nWhat changes?',
            true
        );
        expect(input).toEqual([
            { role: 'system', content: [{ type: 'input_text', text: 'Role template' }] },
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: 'Instructions\n\nEVIDENCE:\ncorpus text',
                        prompt_cache_breakpoint: { mode: 'explicit' }
                    },
                    { type: 'input_text', text: 'User Question:\nWhat changes?' }
                ]
            }
        ]);
        expect(JSON.stringify(input)).not.toContain('<<<CACHE_BREAK>>>');
    });

    it('keeps the stable block byte-identical across different questions', () => {
        const prompt = (question: string) => `Stable corpus\n<<<CACHE_BREAK>>>\n${question}`;
        const first = buildOpenAiResponsesInput('gpt-6.1-sol', 'Role', prompt('Q1'), true);
        const second = buildOpenAiResponsesInput('gpt-6.1-sol', 'Role', prompt('A different Q2'), true);
        expect(first[1].content[0]).toEqual(second[1].content[0]);
        expect(first[1].content[1]).not.toEqual(second[1].content[1]);
    });

    it('omits the breakpoint when provider reuse is bypassed, and still strips the delimiter', () => {
        const input = buildOpenAiResponsesInput('gpt-6.1-sol', null, 'Stable\n<<<CACHE_BREAK>>>\nQuestion', false);
        expect(input).toEqual([{
            role: 'user',
            content: [
                { type: 'input_text', text: 'Stable' },
                { type: 'input_text', text: 'Question' }
            ]
        }]);
    });

    it('sends one plain block with no breakpoint for prompts without a cache break (Pulse)', () => {
        const input = buildOpenAiResponsesInput('gpt-6.1-sol', 'Role', 'Triplet prompt', true);
        expect(input[1]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'Triplet prompt' }] });
    });

    it('sends explicit cache mode on every request so one-off calls write no cache', async () => {
        vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: '',
            json: { id: 'resp_1', status: 'completed', output_text: 'ok' }
        } as never);
        const response = await callOpenAiResponsesApi('test-key', 'gpt-6.1-sol', null, 'Triplet prompt', 256);
        const payload = response.requestPayload as Record<string, unknown>;
        expect(payload.prompt_cache_options).toEqual({ mode: 'explicit' });
        expect(JSON.stringify(payload.input)).not.toContain('prompt_cache_breakpoint');
        expect(payload).not.toHaveProperty('prompt_cache_retention');
    });
});
