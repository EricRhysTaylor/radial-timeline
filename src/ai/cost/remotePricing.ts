import type { AIProviderId } from '../types';
import type { ProviderModelPricing, ProviderPricingTable, PromoPricing } from './providerPricing';
import { requestJson } from '../../utils/requestUrlJson';

export interface RemotePricingCache {
    fetchedAt: string;
    table: ProviderPricingTable;
}

export interface RemotePricingOptions {
    enabled: boolean;
    url: string;
    ttlMs?: number;
    fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
    readCache: () => Promise<string | null>;
    writeCache: (content: string) => Promise<void>;
}

export interface RemotePricingLoadResult {
    source: 'remote' | 'cache' | 'builtin';
    table: ProviderPricingTable | null;
    fetchedAt?: string;
    warning?: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const VALID_PROVIDERS = new Set<string>(['openai', 'anthropic', 'google']);

function isFinitePositiveOrZero(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidPromo(value: unknown): value is PromoPricing {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (typeof v.label !== 'string' || !v.label.trim()) return false;
    if (v.expiresAt !== undefined && typeof v.expiresAt !== 'string') return false;
    if (v.standardInputPer1M !== undefined && !isFinitePositiveOrZero(v.standardInputPer1M)) return false;
    if (v.standardOutputPer1M !== undefined && !isFinitePositiveOrZero(v.standardOutputPer1M)) return false;
    return true;
}

interface RawPricingEntry {
    provider: string;
    modelId: string;
    inputPer1M: number;
    outputPer1M: number;
    cacheWrite5mPer1M?: number;
    cacheWrite1hPer1M?: number;
    cacheReadPer1M?: number;
    longContext?: {
        thresholdInputTokens: number;
        inputPer1M: number;
        outputPer1M: number;
        cacheWrite5mPer1M?: number;
        cacheWrite1hPer1M?: number;
        cacheReadPer1M?: number;
    };
    promo?: unknown;
}

type LongContextPricing = NonNullable<ProviderModelPricing['longContext']>;

function isValidLongContext(value: unknown): value is LongContextPricing {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return isFinitePositiveOrZero(v.thresholdInputTokens)
        && isFinitePositiveOrZero(v.inputPer1M)
        && isFinitePositiveOrZero(v.outputPer1M);
}

function isValidPricingEntry(value: unknown): value is RawPricingEntry {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (typeof v.provider !== 'string' || !VALID_PROVIDERS.has(v.provider)) return false;
    if (typeof v.modelId !== 'string' || !v.modelId.trim()) return false;
    if (!isFinitePositiveOrZero(v.inputPer1M)) return false;
    if (!isFinitePositiveOrZero(v.outputPer1M)) return false;
    return true;
}

function toModelPricing(entry: RawPricingEntry): ProviderModelPricing {
    const pricing: ProviderModelPricing = {
        inputPer1M: entry.inputPer1M,
        outputPer1M: entry.outputPer1M
    };
    if (isFinitePositiveOrZero(entry.cacheWrite5mPer1M)) pricing.cacheWrite5mPer1M = entry.cacheWrite5mPer1M;
    if (isFinitePositiveOrZero(entry.cacheWrite1hPer1M)) pricing.cacheWrite1hPer1M = entry.cacheWrite1hPer1M;
    if (isFinitePositiveOrZero(entry.cacheReadPer1M)) pricing.cacheReadPer1M = entry.cacheReadPer1M;
    const lc = entry.longContext;
    if (isValidLongContext(lc)) {
        pricing.longContext = {
            thresholdInputTokens: lc.thresholdInputTokens,
            inputPer1M: lc.inputPer1M,
            outputPer1M: lc.outputPer1M,
            ...(isFinitePositiveOrZero(lc.cacheWrite5mPer1M) ? { cacheWrite5mPer1M: lc.cacheWrite5mPer1M } : {}),
            ...(isFinitePositiveOrZero(lc.cacheWrite1hPer1M) ? { cacheWrite1hPer1M: lc.cacheWrite1hPer1M } : {}),
            ...(isFinitePositiveOrZero(lc.cacheReadPer1M) ? { cacheReadPer1M: lc.cacheReadPer1M } : {})
        };
    }
    if (isValidPromo(entry.promo)) pricing.promo = entry.promo;
    return pricing;
}

function parseRemotePayload(payload: unknown): ProviderPricingTable | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const rawModels = Array.isArray(record.models) ? record.models : [];
    const entries = rawModels.filter(isValidPricingEntry);
    if (!entries.length) return null;

    const table: ProviderPricingTable = {};
    for (const entry of entries) {
        const provider = entry.provider as AIProviderId;
        if (!table[provider]) table[provider] = {};
        table[provider][entry.modelId] = toModelPricing(entry);
    }
    return table;
}

function parseCache(raw: string | null): RemotePricingCache | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as RemotePricingCache;
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.fetchedAt !== 'string') return null;
        if (!parsed.table || typeof parsed.table !== 'object') return null;
        return parsed;
    } catch {
        return null; // SAFE: corrupt/legacy pricing-cache JSON just means "no usable cache"; caller falls through to a fresh remote fetch, with the bundled pricing table as the floor
    }
}

function isCacheFresh(cache: RemotePricingCache, ttlMs: number): boolean {
    if (ttlMs <= 0) return false;
    const ts = Date.parse(cache.fetchedAt);
    if (!Number.isFinite(ts)) return false;
    return (Date.now() - ts) < ttlMs;
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    return requestJson(url);
}

export async function loadRemotePricing(options: RemotePricingOptions): Promise<RemotePricingLoadResult> {
    if (!options.enabled) {
        return { source: 'builtin', table: null };
    }

    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const cached = parseCache(await options.readCache());

    if (cached && isCacheFresh(cached, ttlMs)) {
        return { source: 'cache', table: cached.table, fetchedAt: cached.fetchedAt };
    }

    try {
        const response = await fetchImpl(options.url);
        if (!response.ok) {
            if (cached) {
                return {
                    source: 'cache',
                    table: cached.table,
                    fetchedAt: cached.fetchedAt,
                    warning: `Remote pricing fetch failed (${response.status}); using cached pricing.`
                };
            }
            return {
                source: 'builtin',
                table: null,
                warning: `Remote pricing fetch failed (${response.status}); using built-in pricing.`
            };
        }

        const payload = await response.json();
        const table = parseRemotePayload(payload);
        if (!table) {
            if (cached) {
                return {
                    source: 'cache',
                    table: cached.table,
                    fetchedAt: cached.fetchedAt,
                    warning: 'Remote pricing returned no usable entries; using cached pricing.'
                };
            }
            return {
                source: 'builtin',
                table: null,
                warning: 'Remote pricing returned no usable entries; using built-in pricing.'
            };
        }

        const nextCache: RemotePricingCache = {
            fetchedAt: new Date().toISOString(),
            table
        };
        try {
            await options.writeCache(JSON.stringify(nextCache));
        } catch (writeError) {
            const writeMsg = writeError instanceof Error ? writeError.message : String(writeError);
            console.warn(`[RT] Remote pricing fetched successfully but cache write failed: ${writeMsg}`);
        }
        return { source: 'remote', table, fetchedAt: nextCache.fetchedAt };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (cached) {
            return {
                source: 'cache',
                table: cached.table,
                fetchedAt: cached.fetchedAt,
                warning: `Remote pricing unavailable (${message}); using cached pricing.`
            };
        }
        return {
            source: 'builtin',
            table: null,
            warning: `Remote pricing unavailable (${message}); using built-in pricing.`
        };
    }
}
