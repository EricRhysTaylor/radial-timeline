import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';

vi.mock('./providerTransport', async () => ({
    ...await vi.importActual('./providerTransport'),
    requestProvider: async (options: unknown) => {
        const response = await obsidian.requestUrl(options as never);
        return { ...response, headers: {}, retryCount: 0 };
    }
}));

import { callGeminiApi, extractGeminiGroundingCitations } from './geminiApi';

const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');

describe('gemini grounding citation extraction', () => {
    it('keeps the API key out of URLs and places it in the authorization header', async () => {
        mockedRequestUrl.mockResolvedValue({ status: 200, text: '', json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Fixture answer' }] } }] } } as never);
        await callGeminiApi('fixture-key', 'gemini-3.8-flash', null, 'Synthetic fixture only');
        const sent = mockedRequestUrl.mock.calls.at(-1)?.[0] as { url: string; headers: Record<string, string> };
        expect(sent.url).not.toContain('fixture-key');
        expect(sent.url).not.toContain('key=');
        expect(sent.headers['x-goog-api-key']).toBe('fixture-key');
    });
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
