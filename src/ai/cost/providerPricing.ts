import type { AIProviderId } from '../types';

export type PricingSource = 'remote' | 'cache' | 'builtin';

export interface PromoPricing {
    label: string;
    expiresAt?: string;
    standardInputPer1M?: number;
    standardOutputPer1M?: number;
}

export interface ProviderModelPricing {
    inputPer1M: number;
    outputPer1M: number;
    cacheWrite5mPer1M?: number;
    cacheWrite1hPer1M?: number;
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
    cacheReadPer1M?: number;
    cacheStoragePer1MPerHour?: number;
    pricingPhase: 'standard' | 'longContext';
    promo?: PromoPricing;
    meta: PricingMeta;
}

export const BUILTIN_PRICING: ProviderPricingTable = {
    anthropic: {
        // Drop-in upgrade at Opus 4.8 pricing: $5/$25 per MTok; cache write
        // 1.25× (5m) / 2× (1h), cache read 0.1× — multipliers unchanged.
        'claude-opus-5': {
            inputPer1M: 5.0,
            outputPer1M: 25.0,
            cacheWrite5mPer1M: 6.25,
            cacheWrite1hPer1M: 10.0,
            cacheReadPer1M: 0.5
        },
        // Continuity model (one generation back). Same pricing as Opus 5.
        'claude-opus-4-8': {
            inputPer1M: 5.0,
            outputPer1M: 25.0,
            cacheWrite5mPer1M: 6.25,
            cacheWrite1hPer1M: 10.0,
            cacheReadPer1M: 0.5
        },
        // Mid tier. Intro pricing $2/$10 per MTok runs to 2026-08-31, then
        // reverts to the $3/$15 standard carried in `promo` — resolveExpired-
        // PromoRates swaps input/output automatically, so this needs no future
        // edit. Cache rates are quoted at the STANDARD $3 input (write 1.25×/2×,
        // read 0.1×) because the cache fields are NOT promo-swapped: a small
        // over-estimate during the promo, exact after it lapses. Over-estimating
        // is the safe direction for anything that warns an author about spend.
        'claude-sonnet-5': {
            inputPer1M: 2.0,
            outputPer1M: 10.0,
            cacheWrite5mPer1M: 3.75,
            cacheWrite1hPer1M: 6.0,
            cacheReadPer1M: 0.3,
            promo: {
                label: 'Intro pricing',
                expiresAt: '2026-09-01T00:00:00Z',
                standardInputPer1M: 3.0,
                standardOutputPer1M: 15.0
            }
        },
        // Economy tier. Standard Anthropic cache multipliers on a $1 input:
        // write 5m 1.25×, 1h 2×, read 0.1×.
        'claude-haiku-4-5': {
            inputPer1M: 1.0,
            outputPer1M: 5.0,
            cacheWrite5mPer1M: 1.25,
            cacheWrite1hPer1M: 2.0,
            cacheReadPer1M: 0.1
        },
        // Premium always-on-thinking model. 2× Opus on input/output; cache
        // writes 5m $12.50, 1h $20.00 per MTok as on Fable 5. Cache reads are
        // the one price that moved: $0.25/MTok (0.025× input), a quarter of
        // Fable 5's $1.00 and half of Opus 5's $0.50.
        'claude-fable-5-1': {
            inputPer1M: 10.0,
            outputPer1M: 50.0,
            cacheWrite5mPer1M: 12.5,
            cacheWrite1hPer1M: 20.0,
            cacheReadPer1M: 0.25
        }
    },
    openai: {
        'gpt-5.5': {
            inputPer1M: 5.0,
            outputPer1M: 30.0,
            cacheReadPer1M: 0.5,
            longContext: {
                thresholdInputTokens: 272_000,
                inputPer1M: 10.0,
                outputPer1M: 45.0,
                cacheReadPer1M: 1.0
            }
        },
        // Economy second on the gpt-5 line.
        'gpt-5.4': {
            inputPer1M: 2.5,
            outputPer1M: 15.0,
            cacheReadPer1M: 0.25,
            longContext: {
                thresholdInputTokens: 272_000,
                inputPer1M: 5.0,
                outputPer1M: 22.5,
                cacheReadPer1M: 0.5
            }
        }
    },
    google: {
        'gemini-3.1-pro-preview': {
            inputPer1M: 2.0,
            outputPer1M: 12.0,
            cacheReadPer1M: 0.2,
            longContext: {
                thresholdInputTokens: 200_000,
                inputPer1M: 4.0,
                outputPer1M: 18.0,
                cacheReadPer1M: 0.4
            }
        },
        'gemini-3.5-flash': {
            inputPer1M: 1.5,
            outputPer1M: 9.0,
            cacheReadPer1M: 0.15,
            cacheStoragePer1MPerHour: 1.0
        }
    }
};

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

function resolveExpiredPromoRates(pricing: ProviderModelPricing): { inputPer1M: number; outputPer1M: number } {
    const promo = pricing.promo;
    if (!promo) return pricing;
    if (isPromoActive(promo)) return pricing;
    return {
        inputPer1M: promo.standardInputPer1M ?? pricing.inputPer1M,
        outputPer1M: promo.standardOutputPer1M ?? pricing.outputPer1M
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
        cacheReadPer1M: pricing.cacheReadPer1M,
        cacheStoragePer1MPerHour: pricing.cacheStoragePer1MPerHour,
        pricingPhase: 'standard',
        promo,
        meta
    };
}
