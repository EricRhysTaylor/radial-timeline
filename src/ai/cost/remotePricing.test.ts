import { describe, expect, it } from 'vitest';
import { loadRemotePricing } from './remotePricing';

const SAMPLE_PAYLOAD = {
    generatedAt: '2026-04-10T00:00:00.000Z',
    models: [
        {
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            inputPer1M: 3.0,
            outputPer1M: 15.0,
            cacheWrite5mPer1M: 3.75,
            cacheReadPer1M: 0.3
        },
        {
            provider: 'google',
            modelId: 'gemini-4-flash-preview',
            inputPer1M: 0,
            outputPer1M: 0,
            promo: {
                label: 'Free preview',
                expiresAt: '2026-06-01T00:00:00Z',
                standardInputPer1M: 1.5,
                standardOutputPer1M: 10.0
            }
        }
    ]
};

describe('loadRemotePricing', () => {
    it('uses fresh cache when available', async () => {
        const cache = JSON.stringify({
            fetchedAt: new Date().toISOString(),
            table: {
                anthropic: {
                    'claude-opus-4-7': { inputPer1M: 3, outputPer1M: 15 }
                }
            }
        });

        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => cache,
            writeCache: async () => undefined,
            fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
        });

        expect(result.source).toBe('cache');
        expect(result.table?.anthropic?.['claude-opus-4-7']?.inputPer1M).toBe(3);
    });

    it('falls back to cache when remote fetch fails', async () => {
        const stale = JSON.stringify({
            fetchedAt: '2000-01-01T00:00:00.000Z',
            table: {
                openai: {
                    'gpt-5.5': { inputPer1M: 3, outputPer1M: 10 }
                }
            }
        });

        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => stale,
            writeCache: async () => undefined,
            fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
        });

        expect(result.source).toBe('cache');
        expect(result.warning).toContain('using cached pricing');
    });

    it('returns builtin when disabled', async () => {
        const result = await loadRemotePricing({
            enabled: false,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async () => undefined
        });

        expect(result.source).toBe('builtin');
        expect(result.table).toBeNull();
    });

    it('stores and returns remote pricing when fetch succeeds', async () => {
        let written = '';
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async (content) => {
                written = content;
            },
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => SAMPLE_PAYLOAD
            })
        });

        expect(result.source).toBe('remote');
        expect(result.table?.anthropic?.['claude-opus-4-7']?.inputPer1M).toBe(3);
        expect(written.length).toBeGreaterThan(0);
    });

    it('parses promo fields from remote payload', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async () => undefined,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => SAMPLE_PAYLOAD
            })
        });

        const gemini = result.table?.google?.['gemini-4-flash-preview'];
        expect(gemini?.inputPer1M).toBe(0);
        expect(gemini?.outputPer1M).toBe(0);
        expect(gemini?.promo?.label).toBe('Free preview');
        expect(gemini?.promo?.expiresAt).toBe('2026-06-01T00:00:00Z');
        expect(gemini?.promo?.standardInputPer1M).toBe(1.5);
    });

    it('rejects entries with missing required fields', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async () => undefined,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    models: [
                        { provider: 'openai', modelId: 'gpt-5.5' },
                        { provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }
                    ]
                })
            })
        });

        expect(result.source).toBe('remote');
        // Only the valid entry should be present
        expect(Object.keys(result.table?.openai ?? {})).toEqual(['gpt-5.5']);
    });

    it('returns builtin when remote returns empty models', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async () => undefined,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ models: [] })
            })
        });

        expect(result.source).toBe('builtin');
        expect(result.table).toBeNull();
        expect(result.warning).toContain('no usable entries');
    });
});
