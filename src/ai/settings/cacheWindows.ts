import type { AICacheWindowSettings, AIProviderId, AiSettingsV1, AnthropicCacheTtl } from '../types';

export const ANTHROPIC_INQUIRY_CACHE_TTL: AnthropicCacheTtl = '1h';
export const GEMINI_CACHE_TTL_MIN_SECONDS = 60;
export const GEMINI_CACHE_TTL_DEFAULT_SECONDS = 900;
export const GEMINI_CACHE_TTL_MAX_SECONDS = 900;
export const OPENAI_IN_MEMORY_WINDOW_MINUTES_DEFAULT = 60;

export function normalizeGeminiCacheTtlSeconds(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return GEMINI_CACHE_TTL_DEFAULT_SECONDS;
    }
    return Math.max(
        GEMINI_CACHE_TTL_MIN_SECONDS,
        Math.min(GEMINI_CACHE_TTL_MAX_SECONDS, Math.round(value))
    );
}

export function normalizeOpenAiInMemoryWindowMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return OPENAI_IN_MEMORY_WINDOW_MINUTES_DEFAULT;
    }
    return Math.max(5, Math.min(60, Math.round(value)));
}

function getCacheWindows(aiSettings: AiSettingsV1): AICacheWindowSettings | undefined {
    return aiSettings.cacheWindows;
}

export function resolveProviderCacheWindowMs(provider: AIProviderId, aiSettings: AiSettingsV1): number | null {
    const windows = getCacheWindows(aiSettings);
    if (!windows) return null;
    if (provider === 'anthropic') {
        return ANTHROPIC_INQUIRY_CACHE_TTL === '1h'
            ? 60 * 60 * 1000
            : 5 * 60 * 1000;
    }
    if (provider === 'google') {
        return normalizeGeminiCacheTtlSeconds(windows.googleTtlSeconds) * 1000;
    }
    if (provider === 'openai') {
        return windows.openaiRetention === '24h'
            ? 24 * 60 * 60 * 1000
            : normalizeOpenAiInMemoryWindowMinutes(windows.openaiInMemoryWindowMinutes) * 60 * 1000;
    }
    return null;
}

export function formatProviderCacheTtlLabel(provider: AIProviderId, aiSettings: AiSettingsV1): string {
    const windows = getCacheWindows(aiSettings);
    if (!windows) return '';
    if (provider === 'anthropic') return ANTHROPIC_INQUIRY_CACHE_TTL;
    if (provider === 'openai') {
        return windows.openaiRetention === '24h'
            ? '24h'
            : `${normalizeOpenAiInMemoryWindowMinutes(windows.openaiInMemoryWindowMinutes)}m`;
    }
    if (provider === 'google') {
        const cacheSeconds = normalizeGeminiCacheTtlSeconds(windows.googleTtlSeconds);
        return cacheSeconds % 60 === 0
            ? `${cacheSeconds / 60}m`
            : `${cacheSeconds}s`;
    }
    return '';
}

export function formatProviderCacheWindowLabel(provider: AIProviderId, aiSettings: AiSettingsV1): string | null {
    const ttlLabel = formatProviderCacheTtlLabel(provider, aiSettings);
    return ttlLabel ? `${ttlLabel} cache window` : null;
}
