import type { AIProviderId } from '../types';
import bundledPricingFile from '../../../scripts/models/pricing.json';

export type PricingSource = 'remote' | 'cache' | 'builtin';

export interface PromoPricing {
    label: string;
    expiresAt?: string;
    standardInputPer1M?: number;
    standardOutputPer1M?: number;
    standardCacheReadPer1M?: number;
    standardCacheStoragePer1MPerHour?: number;
}

export interface ProviderModelPricing {
    inputPer1M: number;
    outputPer1M: number;
    cacheWrite5mPer1M?: number;
    cacheWrite1hPer1M?: number;
    /**
     * Cache-write rate for providers with ONE cache lifetime (OpenAI GPT-5.6+:
     * 30m, 1.25× input). Anthropic prices writes per TTL instead
     * (`cacheWrite5mPer1M` / `cacheWrite1hPer1M`); a model carries one scheme,
     * never both.
     */
    cacheWritePer1M?: number;
    cacheReadPer1M?: number;
    /**
     * Per-1M-token, per-hour charge for holding content in the provider's
     * explicit cache (Gemini bills cache storage by the hour for the cache's
     * TTL, separately from input/output/read tokens). Omitted for providers
     * that do not bill storage (Anthropic, OpenAI).
     */
    cacheStoragePer1MPerHour?: number;
    longContext?: {
        thresholdInputTokens: number;
        inputPer1M: number;
        outputPer1M: number;
        cacheWrite5mPer1M?: number;
        cacheWrite1hPer1M?: number;
        cacheWritePer1M?: number;
        cacheReadPer1M?: number;
        cacheStoragePer1MPerHour?: number;
    };
    promo?: PromoPricing;
}

export type ProviderPricingTable = Partial<Record<AIProviderId, Record<string, ProviderModelPricing>>>;

export interface PricingMeta {
    source: PricingSource;
    fetchedAt?: string;
}

export interface ResolvedProviderModelPricing {
    inputPer1M: number;
    outputPer1M: number;
    cacheWrite5mPer1M?: number;
    cacheWrite1hPer1M?: number;
    cacheWritePer1M?: number;
    cacheReadPer1M?: number;
    cacheStoragePer1MPerHour?: number;
    pricingPhase: 'standard' | 'longContext';
    promo?: PromoPricing;
    meta: PricingMeta;
}

function isFinitePositiveOrZero(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const VALID_PROVIDERS = new Set<string>(['openai', 'anthropic', 'google']);

function isValidPromo(value: unknown): value is PromoPricing {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (typeof v.label !== 'string' || !v.label.trim()) return false;
    if (v.expiresAt !== undefined && typeof v.expiresAt !== 'string') return false;
    if (v.standardInputPer1M !== undefined && !isFinitePositiveOrZero(v.standardInputPer1M)) return false;
    if (v.standardOutputPer1M !== undefined && !isFinitePositiveOrZero(v.standardOutputPer1M)) return false;
    if (v.standardCacheReadPer1M !== undefined && !isFinitePositiveOrZero(v.standardCacheReadPer1M)) return false;
    if (v.standardCacheStoragePer1MPerHour !== undefined && !isFinitePositiveOrZero(v.standardCacheStoragePer1MPerHour)) return false;
    return true;
}

type LongContextPricing = NonNullable<ProviderModelPricing['longContext']>;

function isValidLongContext(value: unknown): value is LongContextPricing {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return isFinitePositiveOrZero(v.thresholdInputTokens)
        && isFinitePositiveOrZero(v.inputPer1M)
        && isFinitePositiveOrZero(v.outputPer1M);
}

interface RawPricingEntry {
    provider: string;
    modelId: string;
    inputPer1M: number;
    outputPer1M: number;
    [rate: string]: unknown;
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

const OPTIONAL_RATES = [
    'cacheWrite5mPer1M',
    'cacheWrite1hPer1M',
    'cacheWritePer1M',
    'cacheReadPer1M',
    'cacheStoragePer1MPerHour'
] as const;

function pickOptionalRates(source: Record<string, unknown>): Partial<Record<typeof OPTIONAL_RATES[number], number>> {
    const rates: Partial<Record<typeof OPTIONAL_RATES[number], number>> = {};
    for (const rate of OPTIONAL_RATES) {
        const value = source[rate];
        if (isFinitePositiveOrZero(value)) rates[rate] = value;
    }
    return rates;
}

function toModelPricing(entry: RawPricingEntry): ProviderModelPricing {
    const pricing: ProviderModelPricing = {
        inputPer1M: entry.inputPer1M,
        outputPer1M: entry.outputPer1M,
        ...pickOptionalRates(entry)
    };
    const lc = entry.longContext;
    if (isValidLongContext(lc)) {
        pricing.longContext = {
            thresholdInputTokens: lc.thresholdInputTokens,
            inputPer1M: lc.inputPer1M,
            outputPer1M: lc.outputPer1M,
            ...pickOptionalRates(lc)
        };
    }
    if (isValidPromo(entry.promo)) pricing.promo = entry.promo;
    return pricing;
}

/**
 * Parse the pricing file format (`scripts/models/pricing.json`): a `models`
 * array of `{ provider, modelId, rates… }`. The same parser reads the bundled
 * copy and the live copy the plugin fetches, so both always mean the same.
 * Returns the table and how many entries were rejected as invalid.
 */
export function parsePricingFile(payload: unknown): { table: ProviderPricingTable; rejected: number } {
    const table: ProviderPricingTable = {};
    if (!payload || typeof payload !== 'object') return { table, rejected: 0 };
    const rawModels = (payload as Record<string, unknown>).models;
    const models: unknown[] = Array.isArray(rawModels) ? rawModels : [];
    let rejected = 0;
    for (const raw of models) {
        if (!isValidPricingEntry(raw)) {
            rejected += 1;
            continue;
        }
        const provider = raw.provider as AIProviderId;
        if (!table[provider]) table[provider] = {};
        table[provider][raw.modelId] = toModelPricing(raw);
    }
    return { table, rejected };
}

function loadBundledPricing(): ProviderPricingTable {
    const { table, rejected } = parsePricingFile(bundledPricingFile);
    if (rejected > 0) {
        throw new Error(`scripts/models/pricing.json has ${rejected} invalid pricing entr${rejected === 1 ? 'y' : 'ies'}`);
    }
    return table;
}

/**
 * The price table that ships inside the plugin: `scripts/models/pricing.json`,
 * bundled at build time. That file is the only place prices are written; the
 * plugin also fetches its live copy from the repo (remotePricing.ts) so a price
 * fix reaches users without a release.
 */
export const BUILTIN_PRICING: ProviderPricingTable = loadBundledPricing();

let activePricing: ProviderPricingTable = structuredClone(BUILTIN_PRICING);
let activeMeta: PricingMeta = { source: 'builtin' };

export function isPromoActive(promo: PromoPricing | undefined): boolean {
    if (!promo) return false;
    if (!promo.expiresAt) return true;
    return Date.now() < Date.parse(promo.expiresAt);
}

export function getActivePricingTable(): ProviderPricingTable {
    return activePricing;
}

export interface ActivePromoInfo {
    provider: AIProviderId;
    modelId: string;
    promo: PromoPricing;
    inputPer1M: number;
    outputPer1M: number;
}

export function getActivePromos(): ActivePromoInfo[] {
    const promos: ActivePromoInfo[] = [];
    for (const [provider, models] of Object.entries(activePricing)) {
        if (!models) continue;
        for (const [modelId, pricing] of Object.entries(models)) {
            if (pricing.promo && isPromoActive(pricing.promo)) {
                promos.push({
                    provider: provider as AIProviderId,
                    modelId,
                    promo: pricing.promo,
                    inputPer1M: pricing.inputPer1M,
                    outputPer1M: pricing.outputPer1M
                });
            }
        }
    }
    return promos;
}

export function getActivePricingMeta(): PricingMeta {
    return activeMeta;
}

function mergeModelPricing(base: ProviderModelPricing | undefined, override: ProviderModelPricing): ProviderModelPricing {
    const mergedLongContext = override.longContext
        ? {
            ...(base?.longContext ?? {}),
            ...override.longContext
        }
        : base?.longContext;

    return {
        ...(base ?? {}),
        ...override,
        ...(mergedLongContext ? { longContext: mergedLongContext } : {})
    };
}

export function mergeRemotePricing(remote: ProviderPricingTable, source: PricingSource, fetchedAt?: string): void {
    const merged: ProviderPricingTable = structuredClone(BUILTIN_PRICING);
    for (const provider of Object.keys(remote) as AIProviderId[]) {
        const remoteModels = remote[provider];
        if (!remoteModels) continue;
        if (!merged[provider]) merged[provider] = {};
        for (const [modelId, pricing] of Object.entries(remoteModels)) {
            merged[provider][modelId] = mergeModelPricing(merged[provider][modelId], pricing);
        }
    }
    activePricing = merged;
    activeMeta = { source, fetchedAt };
}

export function resetPricingToBuiltin(): void {
    activePricing = structuredClone(BUILTIN_PRICING);
    activeMeta = { source: 'builtin' };
}

function formatPricingDate(isoDate: string): string {
    const d = new Date(isoDate);
    if (!Number.isFinite(d.getTime())) return '';
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hourModulo = hours % 12;
    const hour12 = hourModulo === 0 ? 12 : hourModulo;
    return `${month} ${day}, ${hour12}:${minutes}${ampm}`;
}

export function getPricingFreshnessLabel(meta: PricingMeta): string {
    if (meta.source === 'builtin') return 'Using fallback pricing';
    if (!meta.fetchedAt) return 'Using cached pricing';
    const ageMs = Date.now() - Date.parse(meta.fetchedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'Using cached pricing';
    const dateStr = formatPricingDate(meta.fetchedAt);
    const THREE_DAYS_MS = 72 * 60 * 60 * 1000;
    if (ageMs <= THREE_DAYS_MS) return `Pricing checked ${dateStr}`;
    return `Using cached pricing from ${dateStr}`;
}

export function getProviderPricing(
    provider: AIProviderId,
    modelId: string
): ProviderModelPricing {
    const providerPricing = activePricing[provider];
    const pricing = providerPricing?.[modelId];
    if (!pricing) {
        throw new Error(`Missing provider pricing for ${provider}:${modelId}`);
    }
    return pricing;
}

function resolveExpiredPromoRates(pricing: ProviderModelPricing): {
    inputPer1M: number;
    outputPer1M: number;
    cacheReadPer1M?: number;
    cacheStoragePer1MPerHour?: number;
} {
    const promo = pricing.promo;
    if (!promo) return pricing;
    if (isPromoActive(promo)) return pricing;
    return {
        inputPer1M: promo.standardInputPer1M ?? pricing.inputPer1M,
        outputPer1M: promo.standardOutputPer1M ?? pricing.outputPer1M,
        cacheReadPer1M: promo.standardCacheReadPer1M ?? pricing.cacheReadPer1M,
        cacheStoragePer1MPerHour: promo.standardCacheStoragePer1MPerHour ?? pricing.cacheStoragePer1MPerHour
    };
}

export function resolveProviderModelPricing(
    provider: AIProviderId,
    modelId: string,
    totalInputTokens: number
): ResolvedProviderModelPricing {
    const pricing = getProviderPricing(provider, modelId);
    const normalizedInputTokens = Number.isFinite(totalInputTokens)
        ? Math.max(0, Math.floor(totalInputTokens))
        : 0;
    const longContext = pricing.longContext;
    const promoActive = isPromoActive(pricing.promo);
    const promo = promoActive ? pricing.promo : undefined;
    const meta = activeMeta;
    const effectiveRates = resolveExpiredPromoRates(pricing);

    if (longContext && normalizedInputTokens > longContext.thresholdInputTokens) {
        return {
            inputPer1M: longContext.inputPer1M,
            outputPer1M: longContext.outputPer1M,
            cacheWrite5mPer1M: longContext.cacheWrite5mPer1M,
            cacheWrite1hPer1M: longContext.cacheWrite1hPer1M,
            cacheWritePer1M: longContext.cacheWritePer1M,
            cacheReadPer1M: longContext.cacheReadPer1M,
            cacheStoragePer1MPerHour: longContext.cacheStoragePer1MPerHour ?? pricing.cacheStoragePer1MPerHour,
            pricingPhase: 'longContext',
            promo,
            meta
        };
    }

    return {
        inputPer1M: effectiveRates.inputPer1M,
        outputPer1M: effectiveRates.outputPer1M,
        cacheWrite5mPer1M: pricing.cacheWrite5mPer1M,
        cacheWrite1hPer1M: pricing.cacheWrite1hPer1M,
        cacheWritePer1M: pricing.cacheWritePer1M,
        cacheReadPer1M: effectiveRates.cacheReadPer1M,
        cacheStoragePer1MPerHour: effectiveRates.cacheStoragePer1MPerHour,
        pricingPhase: 'standard',
        promo,
        meta
    };
}
