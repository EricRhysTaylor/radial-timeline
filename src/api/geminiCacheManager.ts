/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
/**
 * In-memory cache store for Gemini context caching.
 *
 * Maps SHA-256 content fingerprints to Gemini cached content resource names.
 * Enables cross-question reuse within a session: same corpus + same model
 * + same system prompt → same cache resource → no re-upload.
 */
import { createHash } from 'crypto';
import { createGeminiCache } from './geminiApi';
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

/** In-memory store: content fingerprint → cache resource */
const cacheStore = new Map<string, GeminiCacheEntry>();

/** Gemini context caching requires a minimum input token count (~32K). */
const GEMINI_MIN_CACHE_TOKENS = 32_768;
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

/** Check whether a cache entry is still valid (with safety margin). */
function isEntryValid(entry: GeminiCacheEntry): boolean {
    return entry.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now();
}

/** Remove expired entries from the store. */
export function pruneGeminiCacheStore(): void {
    const now = Date.now();
    for (const [key, entry] of cacheStore) {
        if (entry.expiresAt <= now) cacheStore.delete(key);
    }
}

/**
 * Pure in-memory check: does a valid cache entry exist for this content?
 *
 * No API calls, no side effects. Used by aiClient to determine whether
 * optimistic warm state is safe before execute().
 */
export function peekGeminiCache(
    modelId: string,
    systemPrompt: string,
    stableContent: string
): boolean {
    const estimatedTokens = estimateTokensFromChars(stableContent.length, CHARS_PER_TOKEN);
    if (estimatedTokens < GEMINI_MIN_CACHE_TOKENS) return false;
    const fp = hashCacheKey(modelId, systemPrompt, stableContent);
    const hit = cacheStore.get(fp);
    return !!hit && isEntryValid(hit);
}

/**
 * Get or create a Gemini cached content resource for the stable prefix.
 *
 * Returns `{ cacheName, status }` if caching is viable and successful,
 * or `null` if the stable prefix is too small for Gemini's minimum
 * token threshold.
 *
 * @throws if cache creation fails (caller should catch and fall back to uncached).
 */
export async function getOrCreateGeminiCache(
    apiKey: string,
    modelId: string,
    stableContent: string,
    systemPrompt?: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<GeminiCacheResult | null> {
    // Housekeeping: prune expired entries on each call
    pruneGeminiCacheStore();

    // Guard: skip cache for small stable prefixes (below Gemini min threshold)
    const estimatedTokens = estimateTokensFromChars(stableContent.length, CHARS_PER_TOKEN);
    if (estimatedTokens < GEMINI_MIN_CACHE_TOKENS) return null;

    const fp = hashCacheKey(modelId, systemPrompt ?? '', stableContent);
    const hit = cacheStore.get(fp);
    if (hit && isEntryValid(hit)) {
        return { cacheName: hit.cacheName, status: 'hit', expiresAt: hit.expiresAt };
    }
    cacheStore.delete(fp);      // expired or missing

    const cacheName = await createGeminiCache(
        apiKey, modelId, stableContent, ttlSeconds, systemPrompt
    );
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    cacheStore.set(fp, { cacheName, expiresAt });
    return { cacheName, status: 'created', expiresAt };
}
