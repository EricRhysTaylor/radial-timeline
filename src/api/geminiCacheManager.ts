/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
/**
 * Registry for Gemini context caching.
 *
 * Maps SHA-256 content fingerprints to Gemini cached content resource names.
 * Enables cross-question reuse: same corpus + same model + same system
 * prompt → same cache resource → no re-upload.
 *
 * The registry lives in memory, but every resource RT creates carries its
 * fingerprint in `displayName`. The first lookup that misses after a plugin
 * reload (or an API key change) lists the key's caches once and adopts the
 * live RT ones, so a reload reuses the still-billing cache instead of
 * orphaning it and paying to create a duplicate.
 */
import { createHash } from 'crypto';
import { createGeminiCache, listGeminiCaches } from './geminiApi';
import type { AIRequestControl } from '../ai/types';
import { estimateTokensFromChars, DEFAULT_CHARS_PER_TOKEN } from '../ai/estimates';

interface GeminiCacheEntry {
    cacheName: string;      // e.g. "cachedContents/abc123..."
    expiresAt: number;      // Date.now() + ttl
}

export interface GeminiCacheResult {
    cacheName: string;
    status: 'hit' | 'created';
    /**
     * Absolute expiry timestamp (ms since epoch) bound to the cache resource's
     * actual creation — does NOT extend on hits. Callers should surface this
     * to the UI so the countdown reflects the real resource lifetime.
     */
    expiresAt: number;
}

interface CredentialCacheState {
    entries: Map<string, GeminiCacheEntry>;
    adoption?: Promise<void>;
    pending: Map<string, Promise<GeminiCacheResult>>;
}

// Separate credential namespaces avoid cache adoption/key-switch races.
const stores = new Map<string, CredentialCacheState>();
const RT_CACHE_DISPLAY_PREFIX = 'rt-cache-';

/**
 * Gemini explicit caching minimum: 4,096 tokens on 3.x Flash and 3.1 Pro —
 * every Gemini model RT ships (ai.google.dev/gemini-api/docs/generate-content/caching,
 * checked 2026-10-03; the old 32,768 floor was the Gemini 1.5 limit).
 */
const GEMINI_MIN_CACHE_TOKENS = 4_096;
/**
 * A create call below the provider minimum is rejected, and a rejected cache
 * setup fails the run (no silent uncached retry). The size check runs on a
 * chars/token ESTIMATE, so it must clear the minimum with headroom.
 */
const GEMINI_CACHE_SIZE_SAFETY_FACTOR = 2;
const GEMINI_MIN_ESTIMATED_CACHE_TOKENS = GEMINI_MIN_CACHE_TOKENS * GEMINI_CACHE_SIZE_SAFETY_FACTOR;
/** Rough chars-per-token estimate (same formula used by aiClient.estimateTokens). */
// Alias of the canonical DEFAULT_CHARS_PER_TOKEN (ai/estimates). Kept as a
// named re-export so existing call sites read naturally; it is NOT a second
// value and must never be given one.
const CHARS_PER_TOKEN = DEFAULT_CHARS_PER_TOKEN;

/** Default cache TTL: 15 minutes. Long enough for multi-question sessions. */
const DEFAULT_TTL_SECONDS = 900;

/** 30-second safety margin — avoids racing the API expiration. */
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

/**
 * SHA-256 fingerprint of modelId + systemPrompt + stableContent.
 * Collision-proof — safe for cache key identity.
 */
function hashCacheKey(modelId: string, systemPrompt: string, stableContent: string): string {
    return createHash('sha256')
        .update(modelId).update('\n')
        .update(systemPrompt).update('\n')
        .update(stableContent)
        .digest('hex').slice(0, 16);
}

function hashApiKeyId(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

/**
 * Once per API key per plugin session: list the key's caches and register the
 * live ones RT created. Throws if the listing fails; the caller fails the run
 * the same way a failed create does, and the next call tries again.
 */
async function adoptProviderCaches(apiKey: string, state: CredentialCacheState, control?: AIRequestControl): Promise<void> {
    if (!state.adoption) {
        state.adoption = (async () => {
            const listings = await listGeminiCaches(apiKey, control);
            for (const listing of listings) {
                if (!listing.displayName?.startsWith(RT_CACHE_DISPLAY_PREFIX)) continue;
                const expiresAt = listing.expireTime ? Date.parse(listing.expireTime) : NaN;
                const entry = { cacheName: listing.name, expiresAt };
                if (!Number.isFinite(expiresAt) || !isEntryValid(entry)) continue;
                state.entries.set(listing.displayName.slice(RT_CACHE_DISPLAY_PREFIX.length), entry);
            }
        })();
        void state.adoption.catch(() => { state.adoption = undefined; });
    }
    await state.adoption;
}

/** Check whether a cache entry is still valid (with safety margin). */
function isEntryValid(entry: GeminiCacheEntry): boolean {
    return entry.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now();
}

/**
 * Get or create a Gemini cached content resource for the stable prefix.
 *
 * Returns `{ cacheName, status }` if caching is viable and successful,
 * or `null` if the stable prefix is too small for Gemini's minimum
 * token threshold. A live resource adopted from the provider (created before
 * a plugin reload) is a 'hit': this call reuses it.
 *
 * @throws if listing or creating the cache fails (the provider adapter fails
 * the run with a cache-setup error).
 */
export async function getOrCreateGeminiCache(
    apiKey: string,
    modelId: string,
    stableContent: string,
    systemPrompt?: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
    control?: AIRequestControl
): Promise<GeminiCacheResult | null> {
    control?.assertActive();
    const estimatedTokens = estimateTokensFromChars(stableContent.length, CHARS_PER_TOKEN);
    if (estimatedTokens < GEMINI_MIN_ESTIMATED_CACHE_TOKENS) return null;
    const fp = hashCacheKey(modelId, systemPrompt ?? '', stableContent); // SAFE: omitted system prompt means no system instruction
    const keyId = hashApiKeyId(apiKey);
    let state = stores.get(keyId);
    if (!state) {
        state = { entries: new Map(), pending: new Map() };
        stores.set(keyId, state);
    }
    const existing = state.pending.get(fp);
    if (existing) {
        const result = await existing;
        control?.assertActive();
        return { ...result, status: 'hit' };
    }
    const stateForRequest = state;
    const pending = (async (): Promise<GeminiCacheResult> => {
        await adoptProviderCaches(apiKey, stateForRequest, control);
        control?.assertActive();
        const hit = stateForRequest.entries.get(fp);
        if (hit && isEntryValid(hit)) return { cacheName: hit.cacheName, status: 'hit', expiresAt: hit.expiresAt };
        stateForRequest.entries.delete(fp);
        const cacheName = await createGeminiCache(
            apiKey, modelId, stableContent, ttlSeconds, systemPrompt, `${RT_CACHE_DISPLAY_PREFIX}${fp}`, control
        );
        const expiresAt = Date.now() + ttlSeconds * 1000;
        stateForRequest.entries.set(fp, { cacheName, expiresAt });
        return { cacheName, status: 'created', expiresAt };
    })();
    state.pending.set(fp, pending);
    try { return await pending; }
    finally { state.pending.delete(fp); }
}
