import { describe, expect, it } from 'vitest';
import {
    buildGossamerCacheWindow,
    formatGossamerCacheClock,
    formatGossamerCacheCostHint,
    formatGossamerCachePillLabel,
    isGossamerCacheWindowOpen,
    type GossamerCacheWindow
} from './cacheWindow';
import { buildDefaultAiSettings } from '../ai/settings/aiSettings';
import type { AIRunAdvancedContext } from '../ai/types';

const AI_SETTINGS = buildDefaultAiSettings();

const ctx = (over: Partial<AIRunAdvancedContext>): AIRunAdvancedContext => ({
    roleTemplateName: '',
    provider: 'anthropic',
    modelAlias: '',
    modelLabel: 'Claude',
    modelSelectionReason: '',
    availabilityStatus: 'visible',
    maxInputTokens: 0,
    maxOutputTokens: 0,
    reuseState: 'eligible',
    featureModeInstructions: '',
    finalPrompt: '',
    ...over
});

describe('buildGossamerCacheWindow', () => {
    const RETURNED = 1_000_000;

    it('returns null when the cache was not engaged (idle / missing reuseState)', () => {
        expect(buildGossamerCacheWindow(ctx({ reuseState: 'idle' }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(ctx({ reuseState: undefined }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(null, RETURNED, AI_SETTINGS)).toBeNull();
    });

    it('returns null for non-caching providers', () => {
        expect(buildGossamerCacheWindow(ctx({ provider: 'ollama' }), RETURNED, AI_SETTINGS)).toBeNull();
        expect(buildGossamerCacheWindow(ctx({ provider: 'none' }), RETURNED, AI_SETTINGS)).toBeNull();
    });

    it('trusts the provider-reported expiry (Gemini cachedContent) when present', () => {
        const expiresAt = RETURNED + 12 * 60_000;
        const win = buildGossamerCacheWindow(
            ctx({ provider: 'google', cacheExpiresAt: expiresAt, reuseState: 'warm' }),
            RETURNED,
            AI_SETTINGS
        );
        expect(win?.expiresAt).toBe(expiresAt);
        expect(win?.provider).toBe('google');
    });

    it('derives expiry from the provider TTL when none is reported (Anthropic)', () => {
        const win = buildGossamerCacheWindow(ctx({ provider: 'anthropic' }), RETURNED, AI_SETTINGS);
        expect(win).not.toBeNull();
        // Anthropic window is fixed at 1h.
        expect(win!.expiresAt).toBe(RETURNED + 60 * 60_000);
    });

    it('ignores a stale provider expiry that is already in the past', () => {
        const win = buildGossamerCacheWindow(
            ctx({ provider: 'google', cacheExpiresAt: RETURNED - 5_000 }),
            RETURNED,
            AI_SETTINGS
        );
        // Falls back to the derived Gemini TTL rather than the stale expiry.
        expect(win).not.toBeNull();
        expect(win!.expiresAt).toBeGreaterThan(RETURNED);
    });
});

describe('formatGossamerCacheClock', () => {
    const win = (expiresAt: number): GossamerCacheWindow => ({
        provider: 'anthropic',
        modelLabel: 'Claude',
        armedAt: 0,
        expiresAt
    });

    it('renders MM:SS under an hour', () => {
        expect(formatGossamerCacheClock(win(10 * 60_000), 0)).toBe('10:00');
        expect(formatGossamerCacheClock(win(90_000), 0)).toBe('01:30');
    });

    it('renders H:MM:SS at or above an hour', () => {
        expect(formatGossamerCacheClock(win(60 * 60_000), 0)).toBe('1:00:00');
    });

    it('returns null once the window has closed', () => {
        expect(formatGossamerCacheClock(win(1_000), 2_000)).toBeNull();
        expect(formatGossamerCacheClock(null, 0)).toBeNull();
        expect(isGossamerCacheWindowOpen(win(1_000), 2_000)).toBe(false);
    });

    it('builds the short pill label', () => {
        expect(formatGossamerCachePillLabel(win(5 * 60_000), 0)).toBe('Cache 05:00');
        expect(formatGossamerCachePillLabel(win(1_000), 2_000)).toBeNull();
    });
});

describe('formatGossamerCacheCostHint', () => {
    const base: GossamerCacheWindow = { provider: 'anthropic', modelLabel: 'Claude', armedAt: 0, expiresAt: 1 };

    it('returns null when no cost was captured', () => {
        expect(formatGossamerCacheCostHint(base)).toBeNull();
        expect(formatGossamerCacheCostHint(null)).toBeNull();
    });

    it('reports the factual last-run cost with cache status', () => {
        const hit = formatGossamerCacheCostHint({ ...base, lastRunCostUSD: 0.157, cacheStatus: 'hit' });
        expect(hit).toBe('last run $0.157 · cache hit');
        const created = formatGossamerCacheCostHint({ ...base, lastRunCostUSD: 2.43, cacheStatus: 'created' });
        expect(created).toBe('last run $2.43 · cache created');
    });

    it('omits status when unknown, and never projects future runs', () => {
        const hint = formatGossamerCacheCostHint({ ...base, lastRunCostUSD: 0.157 });
        expect(hint).toBe('last run $0.157');
        expect(hint).not.toContain('next');
        expect(hint).not.toContain('~');
    });
});
