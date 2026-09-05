import { describe, expect, it } from 'vitest';
import type { AiSettingsV1 } from '../types';
import {
    formatProviderCacheTtlLabel,
    formatProviderCacheWindowLabel,
    normalizeGeminiCacheTtlSeconds,
    resolveProviderCacheWindowMs
} from './cacheWindows';

function settings(overrides: Partial<NonNullable<AiSettingsV1['cacheWindows']>> = {}): AiSettingsV1 {
    return {
        schemaVersion: 1,
        provider: 'google',
        modelPolicy: { type: 'latestStable' },
        overrides: {},
        aiAccessProfile: {},
        privacy: { allowTelemetry: false, allowProviderSnapshot: false },
        cacheWindows: {
            anthropicTtl: '1h',
            googleTtlSeconds: 900,
            openaiRetention: '24h',
            openaiInMemoryWindowMinutes: 60,
            ...overrides
        }
    } as unknown as AiSettingsV1;
}

describe('cache window settings helpers', () => {
    it('caps Gemini explicit cache TTL at the 15m session window', () => {
        expect(normalizeGeminiCacheTtlSeconds(86_400)).toBe(900);
        expect(formatProviderCacheTtlLabel('google', settings({ googleTtlSeconds: 86_400 }))).toBe('15m');
        expect(formatProviderCacheWindowLabel('google', settings({ googleTtlSeconds: 86_400 }))).toBe('15m cache window');
    });

    it('uses the same provider window policy for labels and expiry math', () => {
        expect(formatProviderCacheTtlLabel('anthropic', settings())).toBe('1h');
        expect(resolveProviderCacheWindowMs('anthropic', settings())).toBe(60 * 60 * 1000);
        expect(formatProviderCacheTtlLabel('openai', settings())).toBe('24h');
        expect(resolveProviderCacheWindowMs('openai', settings())).toBe(24 * 60 * 60 * 1000);
        expect(formatProviderCacheTtlLabel('google', settings())).toBe('15m');
        expect(resolveProviderCacheWindowMs('google', settings())).toBe(15 * 60 * 1000);
    });
});
