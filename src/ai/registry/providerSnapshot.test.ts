import { describe, expect, it } from 'vitest';
import { loadProviderSnapshot } from './providerSnapshot';

describe('loadProviderSnapshot', () => {
    it('returns cached snapshot when remote is disabled', async () => {
        const cache = JSON.stringify({
            fetchedAt: new Date().toISOString(),
            snapshot: {
                generatedAt: new Date().toISOString(),
                summary: { openai: 1, anthropic: 0, google: 0 },
                models: [{ provider: 'openai', id: 'gpt-1', raw: { id: 'gpt-1' } }]
            }
        });
        const result = await loadProviderSnapshot({
            enabled: false,
            url: 'https://example.com/models.json',
            readCache: async () => cache,
            writeCache: async () => undefined
        });

        expect(result.source).toBe('cache');
        expect(result.snapshot?.models.length).toBe(1);
    });

    it('falls back to cache when remote fetch fails', async () => {
        const stale = JSON.stringify({
            fetchedAt: '2000-01-01T00:00:00.000Z',
            snapshot: {
                generatedAt: '2000-01-01T00:00:00.000Z',
                summary: { openai: 0, anthropic: 1, google: 0 },
                models: [{ provider: 'anthropic', id: 'claude-x', raw: { id: 'claude-x' } }]
            }
        });
        const result = await loadProviderSnapshot({
            enabled: true,
            url: 'https://example.com/models.json',
            readCache: async () => stale,
            writeCache: async () => undefined,
            fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
        });

        expect(result.source).toBe('cache');
        expect(result.warning).toContain('using cached snapshot');
    });
});

