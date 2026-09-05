import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';

import { callGeminiApi, countGeminiTokens, extractGeminiGroundingCitations } from './geminiApi';

const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');

describe('gemini grounding citation extraction', () => {
    beforeEach(() => {
        mockedRequestUrl.mockReset();
    });

    it('maps grounding supports and chunks into normalized citations', () => {
        const responseData = {
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Grounded answer.' }]
                    },
                    groundingMetadata: {
                        groundingChunks: [
                            {
                                web: {
                                    uri: 'https://example.com/world-guide',
                                    title: 'World Guide'
                                }
                            }
                        ],
                        groundingSupports: [
                            {
                                segment: {
                                    text: 'the Contest of Standards',
                                    startIndex: 42,
                                    endIndex: 66
                                },
                                groundingChunkIndices: [0]
                            }
                        ]
                    }
                }
            ]
        };

        expect(extractGeminiGroundingCitations(responseData)).toEqual([
            {
                attributionType: 'grounded',
                sourceLabel: 'World Guide',
                sourceId: 'https://example.com/world-guide',
                url: 'https://example.com/world-guide',
                title: 'World Guide',
                citedText: 'the Contest of Standards',
                startCharIndex: 42,
                endCharIndex: 66
            }
        ]);
    });

    it('falls back to chunk-level grounded citations when support segments are absent', () => {
        const responseData = {
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Grounded answer.' }]
                    },
                    groundingMetadata: {
                        groundingChunks: [
                            {
                                web: {
                                    uri: 'https://example.com/notes',
                                    title: 'Notes'
                                }
                            }
                        ]
                    }
                }
            ]
        };

        expect(extractGeminiGroundingCitations(responseData)).toEqual([
            {
                attributionType: 'grounded',
                sourceLabel: 'Notes',
                sourceId: 'https://example.com/notes',
                url: 'https://example.com/notes',
                title: 'Notes',
                citedText: undefined,
                startCharIndex: undefined,
                endCharIndex: undefined
            }
        ]);
    });

    it('requests google_search grounding when citations are enabled', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                candidates: [
                    {
                        content: {
                            parts: [{ text: 'Grounded answer.' }]
                        }
                    }
                ]
            }
        } as never);

        const response = await callGeminiApi(
            'test-key',
            'gemini-3.1-pro-preview',
            null,
            'Summarize the manuscript.',
            1024,
            0.2,
            undefined,
            undefined,
            undefined,
            true,
            true
        );

        expect(response.success).toBe(true);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body?: string };
        const parsed = JSON.parse(request.body ?? '{}') as { tools?: Array<Record<string, unknown>> };

        expect(parsed.tools).toEqual([{ google_search: {} }]);
    });

    it('countGeminiTokens wraps the request in generateContentRequest when a system prompt is supplied', async () => {
        // REGRESSION: the previous shape sent a top-level
        // `systemInstruction` alongside `contents`, which Google rejects
        // with HTTP 400 INVALID_ARGUMENT ("Invalid JSON payload received,
        // unknown name 'systemInstruction'"). The countTokens endpoint
        // only accepts systemInstruction nested inside
        // `generateContentRequest`. See the doc-comment in
        // src/api/geminiApi.ts near the body construction.
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: { totalTokens: 4242 }
        } as never);

        const result = await countGeminiTokens(
            'test-key',
            'models/gemini-3.1-pro-preview',
            'You are precise.',
            'Count this prompt please.'
        );

        expect(result).toEqual({
            provider: 'google',
            modelId: 'gemini-3.1-pro-preview',
            inputTokens: 4242,
            source: 'provider_count'
        });

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { url?: string; body?: string; method?: string };
        expect(request.method).toBe('POST');
        expect(request.url).toContain(':countTokens?key=test-key');
        expect(request.url).toContain('gemini-3.1-pro-preview');
        const parsed = JSON.parse(request.body ?? '{}');
        // No top-level systemInstruction — Google rejects that on
        // countTokens. The whole thing must be wrapped.
        expect(parsed.systemInstruction).toBeUndefined();
        expect(parsed.contents).toBeUndefined();
        expect(parsed.generateContentRequest).toEqual({
            model: 'models/gemini-3.1-pro-preview',
            contents: [{ role: 'user', parts: [{ text: 'Count this prompt please.' }] }],
            systemInstruction: { parts: [{ text: 'You are precise.' }] }
        });
    });

    it('countGeminiTokens uses the simple contents-only shape when no system prompt is provided', async () => {
        // No system prompt → no need to wrap; the simple form is shorter
        // and equivalent for counting message contents alone.
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: { totalTokens: 7 }
        } as never);

        await countGeminiTokens('test-key', 'gemini-3.1-pro-preview', null, 'hi');

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body?: string };
        const parsed = JSON.parse(request.body ?? '{}');
        expect(parsed.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
        expect(parsed.systemInstruction).toBeUndefined();
        expect(parsed.generateContentRequest).toBeUndefined();
    });

    it('countGeminiTokens throws on API errors so callers can fall back to heuristic', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 400,
            text: '',
            json: { error: { message: 'invalid model' } }
        } as never);

        await expect(
            countGeminiTokens('test-key', 'bad-model', null, 'hi')
        ).rejects.toThrow(/invalid model/);
    });

    it('countGeminiTokens throws on malformed responses missing totalTokens', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: { somethingElse: 'oops' }
        } as never);

        await expect(
            countGeminiTokens('test-key', 'gemini-3.1-pro-preview', null, 'hi')
        ).rejects.toThrow(/Invalid token count response/);
    });

    it('returns the exact Gemini request payload used for the run', async () => {
        mockedRequestUrl.mockResolvedValue({
            status: 200,
            text: '',
            json: {
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }]
                        }
                    }
                ]
            }
        } as never);

        const response = await callGeminiApi(
            'test-key',
            'gemini-2.0-flash',
            'You are precise.',
            'Return JSON.',
            256,
            0.2,
            {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' }
                },
                required: ['ok']
            },
            undefined,
            0.8,
            false,
            true
        );

        expect(response.success).toBe(true);
        expect(response.requestPayload).toEqual({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: 'Return JSON.' }]
                }
            ],
            generationConfig: {
                maxOutputTokens: 256,
                temperature: 0.2,
                topP: 0.8,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'object',
                    properties: {
                        ok: { type: 'boolean' }
                    },
                    required: ['ok']
                }
            },
            systemInstruction: {
                parts: [{ text: 'You are precise.' }]
            }
        });
    });
});
