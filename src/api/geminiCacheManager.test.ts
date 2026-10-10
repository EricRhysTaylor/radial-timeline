import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

vi.mock('./geminiApi', () => ({
    createGeminiCache: vi.fn(),
    listGeminiCaches: vi.fn()
}));

import { createGeminiCache, listGeminiCaches } from './geminiApi';

// The registry is module state; each test loads a fresh copy — the same thing
// a plugin reload does.
async function loadManager() {
    vi.resetModules();
    return import('./geminiCacheManager');
}

const MODEL = 'gemini-3.8-flash';
const SYSTEM = 'System role';
const CORPUS = 'manuscript '.repeat(4_000); // ~44K chars, comfortably above the minimum

/** The displayName the manager stamps on a cache for this exact content. */
function rtDisplayName(modelId: string, system: string, content: string): string {
    const fp = createHash('sha256').update(modelId).update('\n').update(system).update('\n').update(content)
        .digest('hex').slice(0, 16);
    return `rt-cache-${fp}`;
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describe('geminiCacheManager', () => {
    it('creates one resource for concurrent requests with identical content', async () => {
        const { getOrCreateGeminiCache } = await loadManager();
        const results = await Promise.all([1, 2, 3].map(() => getOrCreateGeminiCache('concurrent-key', MODEL, CORPUS, SYSTEM, 900)));
        expect(createGeminiCache).toHaveBeenCalledOnce();
        expect(results.map(result => result?.status)).toEqual(['created', 'hit', 'hit']);
    });

    it('keeps simultaneously used credential namespaces independent', async () => {
        vi.mocked(createGeminiCache).mockImplementation(async key => `cachedContents/${key}`);
        const { getOrCreateGeminiCache } = await loadManager();
        const results = await Promise.all(['account-A', 'account-B'].map(key => getOrCreateGeminiCache(key, MODEL, CORPUS, SYSTEM, 900)));
        expect(results.map(result => result?.cacheName)).toEqual(['cachedContents/account-A', 'cachedContents/account-B']);
        expect((await getOrCreateGeminiCache('account-A', MODEL, CORPUS, SYSTEM, 900))?.cacheName).toBe('cachedContents/account-A');
    });
    beforeEach(() => {
        vi.mocked(createGeminiCache).mockReset().mockResolvedValue('cachedContents/new');
        vi.mocked(listGeminiCaches).mockReset().mockResolvedValue([]);
    });

    it('stamps the content fingerprint on the caches it creates', async () => {
        const { getOrCreateGeminiCache } = await loadManager();
        const result = await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);
        expect(result?.status).toBe('created');
        expect(vi.mocked(createGeminiCache).mock.calls[0][5]).toBe(rtDisplayName(MODEL, SYSTEM, CORPUS));
    });

    it('after a reload, adopts the live cache it created instead of creating a duplicate', async () => {
        vi.mocked(listGeminiCaches).mockResolvedValue([
            { name: 'cachedContents/before-reload', displayName: rtDisplayName(MODEL, SYSTEM, CORPUS), model: `models/${MODEL}`, expireTime: inMinutes(10) }
        ]);
        const { getOrCreateGeminiCache } = await loadManager();

        const result = await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);

        expect(result).toMatchObject({ cacheName: 'cachedContents/before-reload', status: 'hit' });
        expect(createGeminiCache).not.toHaveBeenCalled();
    });

    it('lists once per key per session, then serves misses by creating', async () => {
        const { getOrCreateGeminiCache } = await loadManager();
        await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);
        const second = await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);
        await getOrCreateGeminiCache('key-1', MODEL, `${CORPUS} revised`, SYSTEM, 900);

        expect(second?.status).toBe('hit');
        expect(listGeminiCaches).toHaveBeenCalledTimes(1);
        expect(createGeminiCache).toHaveBeenCalledTimes(2);
    });

    it('ignores expired, near-expiry and non-RT caches', async () => {
        vi.mocked(listGeminiCaches).mockResolvedValue([
            { name: 'cachedContents/expiring', displayName: rtDisplayName(MODEL, SYSTEM, CORPUS), expireTime: inMinutes(0.2) },
            { name: 'cachedContents/someone-else', displayName: 'my-own-cache', expireTime: inMinutes(30) },
            { name: 'cachedContents/unnamed', expireTime: inMinutes(30) }
        ]);
        const { getOrCreateGeminiCache } = await loadManager();
        const result = await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);
        expect(result).toMatchObject({ cacheName: 'cachedContents/new', status: 'created' });
    });

    it('a different API key starts an empty registry and adopts its own caches', async () => {
        const { getOrCreateGeminiCache } = await loadManager();
        await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);
        vi.mocked(createGeminiCache).mockResolvedValue('cachedContents/key-2-cache');

        const result = await getOrCreateGeminiCache('key-2', MODEL, CORPUS, SYSTEM, 900);

        expect(result).toMatchObject({ cacheName: 'cachedContents/key-2-cache', status: 'created' });
        expect(listGeminiCaches).toHaveBeenCalledTimes(2);
    });

    it('surfaces a failed listing as an error and retries the adoption next call', async () => {
        vi.mocked(listGeminiCaches).mockRejectedValueOnce(new Error('quota'));
        const { getOrCreateGeminiCache } = await loadManager();

        await expect(getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900)).rejects.toThrow('quota');
        expect(createGeminiCache).not.toHaveBeenCalled();

        const retry = await getOrCreateGeminiCache('key-1', MODEL, CORPUS, SYSTEM, 900);
        expect(retry?.status).toBe('created');
        expect(listGeminiCaches).toHaveBeenCalledTimes(2);
    });

    it('skips caching below the provider minimum without any API call', async () => {
        const { getOrCreateGeminiCache } = await loadManager();
        expect(await getOrCreateGeminiCache('key-1', MODEL, 'short', SYSTEM, 900)).toBeNull();
        expect(listGeminiCaches).not.toHaveBeenCalled();
    });
});
