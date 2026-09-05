import type { AIProviderId, AnthropicCacheTtl } from '../types';
import { resolveProviderModelPricing, isPromoActive, type PromoPricing, type ResolvedProviderModelPricing } from './providerPricing';
import type { TokenUsage } from '../usage/providerUsage';

export interface CorpusCostEstimate {
    provider: AIProviderId;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    expectedPasses: number;
    cacheReuseRatio: number;
    freshCostUSD: number;
    cachedCostUSD?: number;
    effectiveCostUSD?: number;
    promo?: PromoPricing;
}

export interface UsageCostEstimate {
    inputTokens?: number;
    outputTokens?: number;
    rawInputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheCreation5mInputTokens?: number;
    cacheCreation1hInputTokens?: number;
    rawInputCostUSD?: number;
    cacheReadCostUSD?: number;
    cacheCreationCostUSD?: number;
    inputCostUSD?: number;
    outputCostUSD?: number;
    totalCostUSD?: number;
}

export interface EstimateCorpusCostOptions {
    /** 0-1 fraction of input expected to be served from provider cache on repeat/multi-pass execution. */
    cacheReuseRatio?: number;
    /**
     * Which TTL the run will request when priming the provider cache.
     * Anthropic charges 1h writes at ~2× input price and 5m writes at ~1.25×;
     * picking the wrong one produces a ~33% under- or over-estimate on the
     * priming pass. Defaults to '5m' to preserve the historical conservative
     * estimate for non-Anthropic-Inquiry callers; Inquiry-on-Anthropic must
     * pass '1h' to match ANTHROPIC_REQUESTED_CACHE_TTL.
     */
    cacheWriteTtl?: AnthropicCacheTtl;
}

const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_MULTI_PASS_CACHE_REUSE_RATIO = 0.5;
const DEFAULT_REPEAT_RUN_CACHE_REUSE_RATIO = 0.75;

function isRate(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Price tokens at a known rate. Callers must check the rate exists first; an unknown rate is "unavailable", never $0. */
function toUsd(tokens: number, ratePer1M: number): number {
    if (!Number.isFinite(tokens)) return 0;
    return (tokens / TOKENS_PER_MILLION) * ratePer1M;
}

function clampCacheReuseRatio(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(1, Math.max(0, value));
}

/**
 * Providers that bill cache writes at their own rate (Anthropic). Providers
 * without an explicit write rate (OpenAI, Gemini) bill the priming pass at
 * the ordinary input rate — that is their pricing, not a substitution.
 */
function hasExplicitCacheWritePricing(pricing: ResolvedProviderModelPricing): boolean {
    return isRate(pricing.cacheWrite5mPer1M) || isRate(pricing.cacheWrite1hPer1M);
}

/**
 * The per-1M cache-write rate for the run's requested TTL, or undefined when
 * the table has no rate for that TTL. Anthropic bills 1h writes at ~1.6× the
 * 5m rate, so the other TTL is not a stand-in; a missing rate makes the
 * estimate unavailable rather than quietly wrong.
 */
function resolveCacheWriteRatePer1M(
    pricing: ResolvedProviderModelPricing,
    cacheWriteTtl: AnthropicCacheTtl
): number | undefined {
    const rate = cacheWriteTtl === '1h' ? pricing.cacheWrite1hPer1M : pricing.cacheWrite5mPer1M;
    return isRate(rate) ? rate : undefined;
}

/**
 * What one pass that PRIMES the provider cache costs for `tokens` input
 * tokens: the explicit write rate where the provider has one, otherwise the
 * ordinary input rate. Undefined when the provider prices writes explicitly
 * but not for the requested TTL.
 */
function primingInputCostUSD(
    pricing: ResolvedProviderModelPricing,
    tokens: number,
    cacheWriteTtl: AnthropicCacheTtl
): number | undefined {
    if (!hasExplicitCacheWritePricing(pricing)) return toUsd(tokens, pricing.inputPer1M);
    const rate = resolveCacheWriteRatePer1M(pricing, cacheWriteTtl);
    return rate === undefined ? undefined : toUsd(tokens, rate);
}

export function resolveEstimatedCacheReuseRatio(
    expectedPasses: number,
    override?: number
): number {
    const explicit = clampCacheReuseRatio(override);
    if (typeof explicit === 'number') return explicit;
    return expectedPasses > 1
        ? DEFAULT_MULTI_PASS_CACHE_REUSE_RATIO
        : DEFAULT_REPEAT_RUN_CACHE_REUSE_RATIO;
}

function buildEstimatedInputCostUSD(params: {
    provider: AIProviderId;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    expectedPasses: number;
    cacheReuseRatio: number;
    scenario: 'fresh' | 'cached';
    cacheWriteTtl: AnthropicCacheTtl;
}): number | undefined {
    const pricing = resolveProviderModelPricing(params.provider, params.modelId, params.inputTokens);
    const reusedInputTokens = Math.max(0, Math.floor(params.inputTokens * params.cacheReuseRatio));
    const uncachedInputTokens = Math.max(0, params.inputTokens - reusedInputTokens);
    const cacheReadRate = pricing.cacheReadPer1M;
    if (params.scenario === 'cached' && !isRate(cacheReadRate)) return undefined;

    let scenarioInputCostUSD: number | undefined;
    if (params.scenario === 'cached' && isRate(cacheReadRate)) {
        scenarioInputCostUSD = toUsd(uncachedInputTokens, pricing.inputPer1M) + toUsd(reusedInputTokens, cacheReadRate);
    } else if (isRate(cacheReadRate)) {
        // Fresh run on a cache-capable model: the reused share is written to
        // the cache this pass, at the provider's write price for the TTL.
        const priming = primingInputCostUSD(pricing, reusedInputTokens, params.cacheWriteTtl);
        if (priming === undefined) return undefined;
        scenarioInputCostUSD = toUsd(uncachedInputTokens, pricing.inputPer1M) + priming;
    } else {
        scenarioInputCostUSD = toUsd(params.inputTokens, pricing.inputPer1M);
    }
    const outputCostUSD = toUsd(params.outputTokens, pricing.outputPer1M);
    return (scenarioInputCostUSD + outputCostUSD) * params.expectedPasses;
}

export function estimateCorpusCost(
    provider: AIProviderId,
    modelId: string,
    executionInputTokens: number,
    expectedOutputTokens: number,
    expectedPasses: number,
    options?: EstimateCorpusCostOptions
): CorpusCostEstimate {
    const inputTokens = Math.max(0, Math.floor(executionInputTokens));
    const outputTokens = Math.max(0, Math.floor(expectedOutputTokens));
    const passes = Math.max(1, Math.floor(expectedPasses));
    const cacheReuseRatio = resolveEstimatedCacheReuseRatio(passes, options?.cacheReuseRatio);
    const cacheWriteTtl: AnthropicCacheTtl = options?.cacheWriteTtl ?? '5m';
    const freshCostUSD = buildEstimatedInputCostUSD({
        provider,
        modelId,
        inputTokens,
        outputTokens,
        expectedPasses: passes,
        cacheReuseRatio,
        scenario: 'fresh',
        cacheWriteTtl
    });
    if (typeof freshCostUSD !== 'number' || !Number.isFinite(freshCostUSD)) {
        throw new Error(`Fresh cost estimate unavailable for ${provider}:${modelId}`);
    }
    const cachedCostUSD = buildEstimatedInputCostUSD({
        provider,
        modelId,
        inputTokens,
        outputTokens,
        expectedPasses: passes,
        cacheReuseRatio,
        scenario: 'cached',
        cacheWriteTtl
    });

    const pricing = resolveProviderModelPricing(provider, modelId, inputTokens);
    const promo = isPromoActive(pricing.promo) ? pricing.promo : undefined;

    return {
        provider,
        modelId,
        inputTokens,
        outputTokens,
        expectedPasses: passes,
        cacheReuseRatio,
        freshCostUSD,
        cachedCostUSD,
        effectiveCostUSD: cachedCostUSD,
        promo
    };
}

export function estimateUsageCost(
    provider: AIProviderId,
    modelId: string,
    usage?: TokenUsage | null,
    /**
     * Whether the run REUSED a prior cache ('hit') or CREATED one this run
     * ('created'). Required for providers like Gemini that report
     * `cachedContentTokenCount` on the creating call too: on a 'created' run
     * those tokens were processed fresh, so they must be priced at the input
     * rate, NOT the cache-read discount. Omit when unknown (treated as a read,
     * preserving prior behavior for providers that only report true reuse).
     */
    cacheProvenance?: 'hit' | 'created',
    /**
     * The cache-write TTL the run REQUESTED. Prices creation tokens the
     * provider reported without a per-TTL split (older responses). Omit when
     * unknown; those tokens are then unpriced rather than guessed.
     */
    requestedCacheWriteTtl?: AnthropicCacheTtl
): UsageCostEstimate | null {
    if (!usage) return null;
    const totalInputTokens = typeof usage.inputTokens === 'number'
        ? usage.inputTokens
        : [usage.rawInputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens]
            .filter((value): value is number => typeof value === 'number')
            .reduce((sum, value) => sum + value, 0);
    const pricing = resolveProviderModelPricing(provider, modelId, totalInputTokens);
    const hasExplicitCacheWrite = hasExplicitCacheWritePricing(pricing);
    // On a 'created' run, the "cache read" tokens were processed fresh to build
    // the cache, so they bill at the input rate. On a reuse 'hit' (or unknown),
    // they bill at the discounted cache-read rate.
    const cacheReadRatePer1M = cacheProvenance === 'created'
        ? pricing.inputPer1M
        : pricing.cacheReadPer1M;
    const cacheReadInputTokenCount = typeof usage.cacheReadInputTokens === 'number' ? usage.cacheReadInputTokens : 0;
    const cacheCreationInputTokenCount = typeof usage.cacheCreationInputTokens === 'number' ? usage.cacheCreationInputTokens : 0;
    const cacheCreation5mInputTokens = usage.cacheCreation5mInputTokens;
    const cacheCreation1hInputTokens = usage.cacheCreation1hInputTokens;
    const cacheCreation5mInputTokenCount = typeof cacheCreation5mInputTokens === 'number' ? cacheCreation5mInputTokens : 0;
    const cacheCreation1hInputTokenCount = typeof cacheCreation1hInputTokens === 'number' ? cacheCreation1hInputTokens : 0;
    const hasPositiveCacheRead = cacheReadInputTokenCount > 0;
    const cacheCreationKnownByTtl = cacheCreation5mInputTokenCount + cacheCreation1hInputTokenCount;
    const cacheCreationFallbackTokens = Math.max(0, cacheCreationInputTokenCount - cacheCreationKnownByTtl);
    const hasPositiveCacheCreation = cacheCreationKnownByTtl > 0 || cacheCreationFallbackTokens > 0;
    const inferredRawInputTokens = typeof usage.rawInputTokens === 'number'
        ? usage.rawInputTokens
        : (typeof usage.inputTokens === 'number'
            ? Math.max(0, usage.inputTokens - cacheReadInputTokenCount - cacheCreationInputTokenCount)
            : undefined);
    const hasDetailedInputUsage = typeof inferredRawInputTokens === 'number'
        || typeof usage.cacheReadInputTokens === 'number'
        || typeof usage.cacheCreationInputTokens === 'number'
        || typeof cacheCreation5mInputTokens === 'number'
        || typeof cacheCreation1hInputTokens === 'number';

    const rawInputCostUSD = hasDetailedInputUsage && typeof inferredRawInputTokens === 'number'
        ? toUsd(inferredRawInputTokens, pricing.inputPer1M)
        : undefined;
    const cacheReadCostUSD = typeof usage.cacheReadInputTokens === 'number' && isRate(cacheReadRatePer1M)
        ? toUsd(usage.cacheReadInputTokens, cacheReadRatePer1M)
        : undefined;
    // Each creation bucket is priced only at its own TTL's rate. Creation
    // tokens the provider did not attribute to a TTL are priced at the TTL
    // the run requested, and left unpriced when that is unknown too.
    const unattributedRate = requestedCacheWriteTtl
        ? resolveCacheWriteRatePer1M(pricing, requestedCacheWriteTtl)
        : undefined;
    const canPriceCacheCreation = hasExplicitCacheWrite
        && (cacheCreation5mInputTokenCount === 0 || isRate(pricing.cacheWrite5mPer1M))
        && (cacheCreation1hInputTokenCount === 0 || isRate(pricing.cacheWrite1hPer1M))
        && (cacheCreationFallbackTokens === 0 || unattributedRate !== undefined);
    const cacheCreationCostUSD = canPriceCacheCreation
        ? (
            (isRate(pricing.cacheWrite5mPer1M) ? toUsd(cacheCreation5mInputTokenCount, pricing.cacheWrite5mPer1M) : 0)
            + (isRate(pricing.cacheWrite1hPer1M) ? toUsd(cacheCreation1hInputTokenCount, pricing.cacheWrite1hPer1M) : 0)
            + (unattributedRate !== undefined ? toUsd(cacheCreationFallbackTokens, unattributedRate) : 0)
        )
        : undefined;
    const rawInputCostForTotal = typeof rawInputCostUSD === 'number' ? rawInputCostUSD : 0;
    const cacheReadCostForTotal = typeof cacheReadCostUSD === 'number' ? cacheReadCostUSD : 0;
    const cacheCreationCostForTotal = typeof cacheCreationCostUSD === 'number' ? cacheCreationCostUSD : 0;
    const canPriceDetailedInput = hasDetailedInputUsage
        && (typeof inferredRawInputTokens !== 'number' || typeof rawInputCostUSD === 'number')
        && (!hasPositiveCacheRead || typeof cacheReadCostUSD === 'number')
        && (!hasPositiveCacheCreation || typeof cacheCreationCostUSD === 'number');
    const inputCostUSD = hasDetailedInputUsage
        ? (canPriceDetailedInput
            ? (
                rawInputCostForTotal
                + cacheReadCostForTotal
                + cacheCreationCostForTotal
            )
            : undefined)
        : (typeof usage.inputTokens === 'number'
            ? toUsd(usage.inputTokens, pricing.inputPer1M)
            : undefined);
    const billableOutputTokens = typeof usage.outputTokens === 'number'
        ? (provider === 'google' && typeof usage.inputTokens === 'number' && typeof usage.totalTokens === 'number'
            ? Math.max(usage.outputTokens, usage.totalTokens - usage.inputTokens)
            : usage.outputTokens)
        : undefined;
    const outputCostUSD = typeof billableOutputTokens === 'number'
        ? toUsd(billableOutputTokens, pricing.outputPer1M)
        : undefined;
    const totalCostUSD = typeof inputCostUSD === 'number' && typeof outputCostUSD === 'number'
        ? inputCostUSD + outputCostUSD
        : undefined;

    return {
        inputTokens: usage.inputTokens,
        outputTokens: billableOutputTokens,
        rawInputTokens: usage.rawInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cacheCreation5mInputTokens,
        cacheCreation1hInputTokens,
        rawInputCostUSD,
        cacheReadCostUSD,
        cacheCreationCostUSD,
        inputCostUSD,
        outputCostUSD,
        totalCostUSD
    };
}

export interface OmnibusCostRange {
    /** Every question re-sends the corpus at full input price (the miss case). */
    uncachedUSD: number;
    /**
     * Question 1 writes the cache, questions 2..N read it (the healthy case) —
     * or, with `cacheAlreadyWarm`, all N questions read a cache primed by a
     * prior run inside its still-open TTL window. Omitted when the model has
     * no cache-read rate, or prices writes explicitly but not for the
     * requested TTL.
     */
    cachedUSD?: number;
}

/**
 * Pre-run cost band for the omnibus plan modal: the healthy (cached) total vs
 * the costly (uncached) total for `questionCount` questions against a corpus
 * of `corpusInputTokens`. Same rate rules as `estimateCorpusCost`: no rate is
 * ever stood in for by another.
 */
export function estimateOmnibusCostRange(params: {
    provider: AIProviderId;
    modelId: string;
    corpusInputTokens: number;
    expectedOutputTokensPerQuestion: number;
    questionCount: number;
    cacheAlreadyWarm?: boolean;
    cacheWriteTtl?: AnthropicCacheTtl;
}): OmnibusCostRange {
    const inputTokens = Math.max(0, Math.floor(params.corpusInputTokens));
    const outputTokens = Math.max(0, Math.floor(params.expectedOutputTokensPerQuestion));
    const n = Math.max(1, Math.floor(params.questionCount));
    const cacheWriteTtl: AnthropicCacheTtl = params.cacheWriteTtl ?? '5m';
    const pricing = resolveProviderModelPricing(params.provider, params.modelId, inputTokens);

    const outputCost = toUsd(outputTokens, pricing.outputPer1M) * n;
    const uncachedUSD = toUsd(inputTokens, pricing.inputPer1M) * n + outputCost;

    const cacheReadRate = pricing.cacheReadPer1M;
    if (!isRate(cacheReadRate)) return { uncachedUSD };
    if (params.cacheAlreadyWarm) {
        return { uncachedUSD, cachedUSD: toUsd(inputTokens, cacheReadRate) * n + outputCost };
    }
    const priming = primingInputCostUSD(pricing, inputTokens, cacheWriteTtl);
    if (priming === undefined) return { uncachedUSD };
    return { uncachedUSD, cachedUSD: priming + toUsd(inputTokens, cacheReadRate) * (n - 1) + outputCost };
}

export interface CacheStorageCostEstimate {
    storedTokens: number;
    ttlSeconds: number;
    ratePer1MPerHour: number;
    costUSD: number;
}

/**
 * Estimate the provider's explicit-cache STORAGE charge — billed per stored
 * token, per hour, for the cache's full TTL, independent of how often it is
 * read. Only Gemini bills this today; providers without a
 * `cacheStoragePer1MPerHour` rate return `null` (no storage charge to surface).
 */
export function estimateCacheStorageCost(
    provider: AIProviderId,
    modelId: string,
    storedTokens: number,
    ttlSeconds: number
): CacheStorageCostEstimate | null {
    if (!Number.isFinite(storedTokens) || storedTokens <= 0) return null;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return null;
    const pricing = resolveProviderModelPricing(provider, modelId, storedTokens);
    const ratePer1MPerHour = pricing.cacheStoragePer1MPerHour;
    if (!isRate(ratePer1MPerHour)) return null;
    const hours = ttlSeconds / 3600;
    const costUSD = (storedTokens / TOKENS_PER_MILLION) * ratePer1MPerHour * hours;
    return { storedTokens, ttlSeconds, ratePer1MPerHour, costUSD };
}

export function formatUsdCost(value: number): string {
    return `$${value.toFixed(2)}`;
}

export function formatExactUsdCost(value: number): string {
    if (!Number.isFinite(value) || value < 0) return 'unavailable';
    if (value === 0) return '$0.00';
    if (value >= 1) return `$${value.toFixed(2)}`;
    if (value >= 0.01) return `$${value.toFixed(3)}`;
    if (value >= 0.001) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(6)}`;
}

export function formatApproxUsdCost(value: number): string {
    const digits = value >= 10 ? 0 : 1;
    return `~$${value.toFixed(digits)}`;
}
