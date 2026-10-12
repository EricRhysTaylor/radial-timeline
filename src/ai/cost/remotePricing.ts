import { parsePricingFile, type ProviderPricingTable } from './providerPricing';
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
function parseRemotePayload(payload: unknown): ProviderPricingTable | null {
    const { table } = parsePricingFile(payload);
    return Object.keys(table).length > 0 ? table : null;
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
