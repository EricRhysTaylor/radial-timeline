import type { CanonicalModelRecord, ProviderSnapshotPayload } from '../types';
import { redactSensitiveValue } from '../credentials/redactSensitive';
import { requestJson } from '../../utils/requestUrlJson';

export interface ProviderSnapshotCache {
    fetchedAt: string;
    snapshot: ProviderSnapshotPayload;
}

export interface ProviderSnapshotOptions {
    enabled: boolean;
    forceRemote?: boolean;
    url: string;
    ttlMs?: number;
    fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
    readCache: () => Promise<string | null>;
    writeCache: (content: string) => Promise<void>;
}

export interface ProviderSnapshotLoadResult {
    source: 'remote' | 'cache' | 'none';
    snapshot: ProviderSnapshotPayload | null;
    fetchedAt?: string;
    warning?: string;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'google']);

function isCanonicalModelRecord(value: unknown): value is CanonicalModelRecord {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (!VALID_PROVIDERS.has(String(v.provider))) return false;
    if (typeof v.id !== 'string' || !v.id.trim()) return false;
    if (v.label !== undefined && typeof v.label !== 'string') return false;
    if (v.createdAt !== undefined && typeof v.createdAt !== 'string') return false;
    if (v.inputTokenLimit !== undefined && (typeof v.inputTokenLimit !== 'number' || !Number.isFinite(v.inputTokenLimit))) return false;
    if (v.outputTokenLimit !== undefined && (typeof v.outputTokenLimit !== 'number' || !Number.isFinite(v.outputTokenLimit))) return false;
    if (!v.raw || typeof v.raw !== 'object' || Array.isArray(v.raw)) return false;
    return true;
}

function parseSnapshotPayload(payload: unknown): ProviderSnapshotPayload | null {
    if (!payload || typeof payload !== 'object') return null;
    const parsed = payload as Record<string, unknown>;
    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null;
    if (!generatedAt) return null;

    const summaryObj = parsed.summary as Record<string, unknown> | undefined;
    const summary = summaryObj && typeof summaryObj === 'object'
        ? {
            openai: typeof summaryObj.openai === 'number' ? summaryObj.openai : 0,
            anthropic: typeof summaryObj.anthropic === 'number' ? summaryObj.anthropic : 0,
            google: typeof summaryObj.google === 'number' ? summaryObj.google : 0,
        }
        : { openai: 0, anthropic: 0, google: 0 };

    const rawModels = Array.isArray(parsed.models) ? parsed.models : [];
    const models = rawModels.filter(isCanonicalModelRecord);
    return {
        generatedAt,
        summary,
        models
    };
}

function parseCache(raw: string | null): ProviderSnapshotCache | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as ProviderSnapshotCache;
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.fetchedAt !== 'string') return null;
        const snapshot = parseSnapshotPayload(parsed.snapshot);
        if (!snapshot) return null;
        return {
            fetchedAt: parsed.fetchedAt,
            snapshot
        };
    } catch {
        return null; // SAFE: corrupt snapshot-cache JSON just means "no usable cache"; loadProviderSnapshot then fetches remotely or reports source 'none'
    }
}

function isCacheFresh(cache: ProviderSnapshotCache, ttlMs: number): boolean {
    const ts = Date.parse(cache.fetchedAt);
    if (!Number.isFinite(ts)) return false;
    return (Date.now() - ts) <= ttlMs;
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    return requestJson(url);
}

export async function loadProviderSnapshot(options: ProviderSnapshotOptions): Promise<ProviderSnapshotLoadResult> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const cached = parseCache(await options.readCache());

    if (cached && !options.forceRemote && isCacheFresh(cached, ttlMs)) {
        return { source: 'cache', snapshot: cached.snapshot, fetchedAt: cached.fetchedAt };
    }

    if (!options.enabled && cached) {
        return { source: 'cache', snapshot: cached.snapshot, fetchedAt: cached.fetchedAt };
    }

    if (!options.enabled) {
        return { source: 'none', snapshot: null };
    }

    try {
        const response = await fetchImpl(options.url);
        if (!response.ok) {
            if (cached) {
                return {
                    source: 'cache',
                    snapshot: cached.snapshot,
                    fetchedAt: cached.fetchedAt,
                    warning: `Provider snapshot fetch failed (${response.status}); using cached snapshot.`
                };
            }
            return {
                source: 'none',
                snapshot: null,
                warning: `Provider snapshot fetch failed (${response.status}); snapshot unavailable.`
            };
        }

        const payload = await response.json();
        const snapshot = parseSnapshotPayload(payload);
        if (!snapshot) {
            if (cached) {
                return {
                    source: 'cache',
                    snapshot: cached.snapshot,
                    fetchedAt: cached.fetchedAt,
                    warning: 'Provider snapshot payload invalid; using cached snapshot.'
                };
            }
            return {
                source: 'none',
                snapshot: null,
                warning: 'Provider snapshot payload invalid; snapshot unavailable.'
            };
        }

        const nextCache: ProviderSnapshotCache = {
            fetchedAt: new Date().toISOString(),
            snapshot
        };
        await options.writeCache(JSON.stringify(nextCache));
        return {
            source: 'remote',
            snapshot,
            fetchedAt: nextCache.fetchedAt
        };
    } catch (error) {
        const message = redactSensitiveValue(error instanceof Error ? error.message : String(error));
        if (cached) {
            return {
                source: 'cache',
                snapshot: cached.snapshot,
                fetchedAt: cached.fetchedAt,
                warning: `Provider snapshot unavailable (${message}); using cached snapshot.`
            };
        }
        return {
            source: 'none',
            snapshot: null,
            warning: `Provider snapshot unavailable (${message}); snapshot unavailable.`
        };
    }
}

export function findSnapshotModel(
    snapshot: ProviderSnapshotPayload | null,
    provider: CanonicalModelRecord['provider'],
    id: string
): CanonicalModelRecord | null {
    if (!snapshot) return null;
    return snapshot.models.find(model => model.provider === provider && model.id === id) ?? null;
}
