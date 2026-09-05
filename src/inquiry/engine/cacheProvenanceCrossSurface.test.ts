/**
 * Cross-surface cache-provenance fixtures.
 *
 * The bug this guards against: Gemini reports `cachedContentTokenCount > 0`
 * on EVERY call that supplies `cachedContent: …` — including the call
 * that created the resource. Inferring "cache reused" from that payload
 * field alone (the legacy behavior) painted first-time creation runs as
 * if a prior cache had been reused.
 *
 * The fix routes cache provenance from the cache manager
 * (clientCacheStatus 'hit' | 'created') all the way to the UI surfaces.
 * These fixtures pin that every surface honors the distinction.
 */
import { describe, it, expect } from 'vitest';
import { computeCachePillState } from './inquiryEngineRenderer';
import type { TokenUsage } from '../../ai/usage/providerUsage';

// Realistic Gemini cache-hit-shaped usage. The user's run summary
// showed: total prompt 140k, cached portion 136k.
const geminiCacheBilledUsage: TokenUsage = {
    inputTokens: 140_000,
    outputTokens: 200,
    totalTokens: 140_200,
    cacheReadInputTokens: 136_000
};

describe('Cache provenance cross-surface: Gemini first call (cache created)', () => {
    it('REGRESSION: identical usage payload as a reuse run; status="created" must NOT paint "reused"', () => {
        // The bug: previous code returned `Cache reused · 97%` for this
        // exact usage payload, because cacheRead > 0. The fix uses
        // cacheStatus from the cache manager to override.
        const pill = computeCachePillState(geminiCacheBilledUsage, 'created');
        expect(pill?.label).toBe('Cache armed');
        expect(pill?.state).toBe('primed');
        expect(pill?.tooltip).toContain('did NOT reuse a prior cache');
    });

    it('Tooltip explicitly tells the user a new resource was created (not reused)', () => {
        const pill = computeCachePillState(geminiCacheBilledUsage, 'created');
        expect(pill?.tooltip.toLowerCase()).toContain('created');
        expect(pill?.tooltip.toLowerCase()).toContain('armed');
        expect(pill?.label.toLowerCase()).not.toContain('reused');
    });
});

describe('Cache provenance cross-surface: Gemini later call (cache hit)', () => {
    it('cacheStatus="hit" produces the reused label, sized by cache_read percentage', () => {
        const pill = computeCachePillState(geminiCacheBilledUsage, 'hit');
        expect(pill?.label).toMatch(/^Cache reused · \d+%$/);
        expect(pill?.state).toBe('confirmed');
        // 136k cached / 140k total = 97%
        expect(pill?.label).toBe('Cache reused · 97%');
    });

    it('cacheStatus="hit" without a cacheRead payload still labels as reused (manager is authoritative)', () => {
        const minimalUsage: TokenUsage = { inputTokens: 140_000, outputTokens: 200, totalTokens: 140_200 };
        const pill = computeCachePillState(minimalUsage, 'hit');
        expect(pill?.label).toBe('Cache reused');
        expect(pill?.state).toBe('confirmed');
    });
});

describe('Cache provenance cross-surface: Anthropic (payload distinguishes)', () => {
    it('cacheStatus="created" overrides Anthropic payload too — manager is the source of truth', () => {
        // Anthropic creation payload has cache_creation > 0, cache_read = 0.
        // If cacheStatus='created' is supplied, use it (no surprise).
        const anthropicCreatePayload: TokenUsage = {
            inputTokens: 142_000,
            outputTokens: 200,
            totalTokens: 142_200,
            cacheCreationInputTokens: 136_000
        };
        const pill = computeCachePillState(anthropicCreatePayload, 'created');
        expect(pill?.label).toBe('Cache armed');
    });

    it('No cacheStatus + Anthropic create payload still works via payload-only fallback', () => {
        const anthropicCreatePayload: TokenUsage = {
            inputTokens: 142_000,
            outputTokens: 200,
            totalTokens: 142_200,
            cacheCreationInputTokens: 136_000
        };
        const pill = computeCachePillState(anthropicCreatePayload);
        expect(pill?.label).toBe('Cache created');
        expect(pill?.state).toBe('primed');
    });

    it('No cacheStatus + Anthropic hit payload still works via payload-only fallback', () => {
        const anthropicHitPayload: TokenUsage = {
            inputTokens: 142_000,
            outputTokens: 200,
            totalTokens: 142_200,
            cacheReadInputTokens: 136_000
        };
        const pill = computeCachePillState(anthropicHitPayload);
        expect(pill?.state).toBe('confirmed');
        expect(pill?.label).toMatch(/^Cache reused · /);
    });
});

describe('Cache provenance cross-surface: OpenAI (implicit caching)', () => {
    // OpenAI's response payload cannot distinguish create vs reuse on
    // its own — the API auto-caches prefixes and only reports cached_tokens
    // on subsequent reads. The provider's deriveCacheResult uses
    // promptCacheKeySupplied to infer 'created'. These cases confirm the
    // cache pill consumes that provenance correctly.

    it('OpenAI first call with cacheStatus="created" shows "Cache armed", not "No cache reuse"', () => {
        const usage: TokenUsage = { inputTokens: 5_000, outputTokens: 200, totalTokens: 5_200 };
        const pill = computeCachePillState(usage, 'created');
        expect(pill?.label).toBe('Cache armed');
        expect(pill?.state).toBe('primed');
    });

    it('OpenAI later call with cacheStatus="hit" + cached_tokens shows reuse percentage', () => {
        const usage: TokenUsage = {
            inputTokens: 5_000,
            outputTokens: 200,
            totalTokens: 5_200,
            cacheReadInputTokens: 4_500
        };
        const pill = computeCachePillState(usage, 'hit');
        expect(pill?.label).toBe('Cache reused · 90%');
        expect(pill?.state).toBe('confirmed');
    });

    it('OpenAI without a cache key → no cacheStatus → "No cache reuse" via payload fallback', () => {
        const usage: TokenUsage = { inputTokens: 5_000, outputTokens: 200, totalTokens: 5_200 };
        const pill = computeCachePillState(usage);
        expect(pill?.label).toBe('No cache reuse');
        expect(pill?.state).toBe('none');
    });
});

describe('Cache provenance cross-surface: Anthropic (payload distinguishes)', () => {
    // Anthropic's response payload distinguishes create from reuse via
    // cache_creation_input_tokens / cache_read_input_tokens — so the
    // pill works correctly with payload alone (no cacheStatus needed).
    // These cases pin that the new cacheStatus override is COMPATIBLE
    // with Anthropic's existing payload-driven path.

    it('Anthropic first call (cache_creation > 0, payload-only) → "Cache created"', () => {
        const usage: TokenUsage = {
            inputTokens: 142_000,
            outputTokens: 500,
            totalTokens: 142_500,
            cacheCreationInputTokens: 140_000
        };
        const pill = computeCachePillState(usage);
        expect(pill?.label).toBe('Cache created');
        expect(pill?.state).toBe('primed');
    });

    it('Anthropic first call with cacheStatus="created" supplied → "Cache armed" (manager wins)', () => {
        // When the cache manager supplies 'created', it overrides the
        // payload-derived "Cache created" wording with the unified
        // "Cache armed" copy used across all providers.
        const usage: TokenUsage = {
            inputTokens: 142_000,
            outputTokens: 500,
            totalTokens: 142_500,
            cacheCreationInputTokens: 140_000
        };
        const pill = computeCachePillState(usage, 'created');
        expect(pill?.label).toBe('Cache armed');
    });

    it('Anthropic reuse call (cache_read > 0, payload-only) → reuse percentage', () => {
        const usage: TokenUsage = {
            inputTokens: 142_000,
            outputTokens: 500,
            totalTokens: 142_500,
            cacheReadInputTokens: 140_000
        };
        const pill = computeCachePillState(usage);
        expect(pill?.label).toBe('Cache reused · 99%');
        expect(pill?.state).toBe('confirmed');
    });
});

describe('Cache provenance cross-surface: no cache attempted', () => {
    it('No usage, no cacheStatus → no pill', () => {
        expect(computeCachePillState(undefined)).toBeNull();
    });

    it('Usage present, no cacheStatus, no cache fields → "No cache reuse"', () => {
        const usage: TokenUsage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 };
        const pill = computeCachePillState(usage);
        expect(pill?.label).toBe('No cache reuse');
        expect(pill?.state).toBe('none');
    });
});
