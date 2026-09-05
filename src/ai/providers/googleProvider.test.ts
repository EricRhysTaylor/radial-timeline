import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/geminiApi', () => ({
    callGeminiApi: vi.fn()
}));

vi.mock('../../api/geminiCacheManager', () => ({
    getOrCreateGeminiCache: vi.fn()
}));

vi.mock('../credentials/credentials', () => ({
    getCredential: vi.fn().mockResolvedValue('test-key')
}));

vi.mock('../settings/aiSettings', () => ({
    buildDefaultAiSettings: vi.fn(() => ({
        cacheWindows: {
            googleTtlSeconds: 900
        }
    }))
}));

vi.mock('../settings/validateAiSettings', () => ({
    validateAiSettings: vi.fn(() => ({
        value: {
            cacheWindows: {
                googleTtlSeconds: 900
            }
        }
    }))
}));

import { callGeminiApi } from '../../api/geminiApi';
import { getOrCreateGeminiCache } from '../../api/geminiCacheManager';
import { CACHE_BREAK_DELIMITER } from '../prompts/composeEnvelope';
import { GoogleProvider } from './googleProvider';

describe('GoogleProvider', () => {
    beforeEach(() => {
        vi.mocked(callGeminiApi).mockReset();
        vi.mocked(getOrCreateGeminiCache).mockReset();
    });

    it('fails before dispatch when cached-content setup fails', async () => {
        vi.mocked(getOrCreateGeminiCache).mockRejectedValue(new Error('cache service unavailable'));

        const provider = new GoogleProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gemini-3.1-pro-preview',
            systemPrompt: 'You are precise.',
            userPrompt: `Stable prefix ${'x'.repeat(140000)}${CACHE_BREAK_DELIMITER}Volatile question`,
            citationsEnabled: false
        });

        expect(result.success).toBe(false);
        expect(result.aiStatus).toBe('rejected');
        expect(result.aiReason).toBe('cache_setup_failed');
        expect(result.error).toContain('Gemini cached content setup failed before dispatch');
        expect(result.diagnostics).toEqual(expect.objectContaining({
            cacheSetupFailed: true,
            cacheSetupMode: 'cached_content'
        }));
        expect(callGeminiApi).not.toHaveBeenCalled();
    });

    // ── Cache provenance: trust clientCacheStatus, not response heuristic ──
    //
    // The original bug: deriveCacheResult returned `cacheStatus: 'hit'`
    // whenever response.usageMetadata.cachedContentTokenCount > 0. But
    // Gemini reports cachedContentTokenCount on EVERY call that supplies
    // `cachedContent: …`, including the first call when the resource was
    // created in that same call. The cache manager is the only source
    // that knows create-vs-hit. These tests pin that.

    const buildPrompt = () => `Stable prefix ${'x'.repeat(140_000)}${CACHE_BREAK_DELIMITER}Volatile question`;

    const cachedResponse = (cachedContentTokenCount: number) => ({
        success: true,
        content: '{}',
        responseData: {
            usageMetadata: {
                promptTokenCount: 140_000,
                cachedContentTokenCount,
                candidatesTokenCount: 200,
                totalTokenCount: 140_200
            }
        }
    });

    it('REGRESSION: Gemini first call (cache created) reports cacheStatus="created", NOT "hit", even though cachedContentTokenCount > 0', async () => {
        vi.mocked(getOrCreateGeminiCache).mockResolvedValue({
            cacheName: 'cachedContents/abc123',
            status: 'created',
            expiresAt: Date.now() + 900_000
        });
        // Gemini reports cachedContentTokenCount > 0 on a creation call
        // (the freshly-created resource is billed at the cached rate).
        // The legacy bug treated this as a reuse.
        vi.mocked(callGeminiApi).mockResolvedValue(cachedResponse(135_825) as never);

        const provider = new GoogleProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gemini-3.5-flash',
            systemPrompt: 'You are precise.',
            userPrompt: buildPrompt(),
            citationsEnabled: false
        });

        expect(result.cacheStatus).toBe('created');
        // cacheUsed=false keeps reuseState='eligible' downstream rather
        // than incorrectly promoting to 'warm'.
        expect(result.cacheUsed).toBe(false);
    });

    it('Gemini later call (cache hit) reports cacheStatus="hit" + cacheUsed=true', async () => {
        vi.mocked(getOrCreateGeminiCache).mockResolvedValue({
            cacheName: 'cachedContents/abc123',
            status: 'hit',
            expiresAt: Date.now() + 600_000
        });
        vi.mocked(callGeminiApi).mockResolvedValue(cachedResponse(135_825) as never);

        const provider = new GoogleProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gemini-3.5-flash',
            systemPrompt: 'You are precise.',
            userPrompt: buildPrompt(),
            citationsEnabled: false
        });

        expect(result.cacheStatus).toBe('hit');
        expect(result.cacheUsed).toBe(true);
    });

    it('Gemini call without cached prefix (no cachedContentName) reports no cache status', async () => {
        // Short prompt — falls below the chars threshold so the cache
        // manager returns null (no cache attempted).
        vi.mocked(getOrCreateGeminiCache).mockResolvedValue(null);
        vi.mocked(callGeminiApi).mockResolvedValue({
            success: true,
            content: '{}',
            responseData: {
                usageMetadata: {
                    promptTokenCount: 500,
                    candidatesTokenCount: 200,
                    totalTokenCount: 700
                }
            }
        } as never);

        const provider = new GoogleProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gemini-3.5-flash',
            systemPrompt: 'You are precise.',
            userPrompt: `Short prompt${CACHE_BREAK_DELIMITER}Volatile question`,
            citationsEnabled: false
        });

        expect(result.cacheStatus).toBeUndefined();
        expect(result.cacheUsed).toBeUndefined();
    });

    it('REGRESSION: even a 100% cached-token response on first call does not promote to "hit"', async () => {
        // Extreme case: 100% of the prompt is cached (large stable prefix,
        // tiny volatile question). The legacy bug would still report this
        // as "hit". The fix must rely on clientCacheStatus.
        vi.mocked(getOrCreateGeminiCache).mockResolvedValue({
            cacheName: 'cachedContents/xyz',
            status: 'created',
            expiresAt: Date.now() + 900_000
        });
        vi.mocked(callGeminiApi).mockResolvedValue(cachedResponse(139_999) as never);

        const provider = new GoogleProvider({ settings: {} } as never);
        const result = await provider.generateText({
            modelId: 'gemini-3.5-flash',
            systemPrompt: 'You are precise.',
            userPrompt: buildPrompt(),
            citationsEnabled: false
        });

        expect(result.cacheStatus).toBe('created');
        expect(result.cacheUsed).toBe(false);
    });
});
