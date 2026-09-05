/**
 * Pure cache-health decision logic for the Inquiry Omnibus sequential run.
 *
 * The Omnibus command runs each enabled question sequentially against a
 * byte-identical cached corpus prefix: question 1 arms the provider
 * prompt-cache, questions 2..N reuse it. The ONE scenario the tool must never
 * silently allow is a question >=2 coming back with NO cache read — that means
 * the full corpus was re-billed at input price, which is exactly what makes the
 * tool costly. Per RT doctrine we fail clearly (abort the remaining questions)
 * rather than degrade silently.
 *
 * This module is intentionally pure: no DOM, no plugin, no I/O. It maps the
 * provider's token-usage payload to a health signal and an abort decision, and
 * accumulates the running cost from actual per-response usage. All enforcement
 * wiring lives in InquiryView.runOmnibusSequential; all UI lives in
 * InquiryOmnibusModal. Kept here so the decision is unit-testable in isolation.
 */
import type { TokenUsage } from '../../ai/usage/providerUsage';
import type { AIProviderId } from '../../ai/types';
import { estimateUsageCost } from '../../ai/cost/estimateCorpusCost';
import { ANTHROPIC_REQUESTED_CACHE_TTL } from '../../ai/settings/aiSettings';

export type OmnibusCacheHealth =
    /** cache_read tokens > 0 — healthy reuse (or a warm cache from a prior run). */
    | 'reused'
    /** This pass wrote a cache entry — healthy prime (expected on question 1). */
    | 'armed'
    /**
     * Provider reported cache fields, but nothing ever armed the cache. The
     * corpus is below the model's minimum cacheable prefix (Fable 5: 2048,
     * Opus 4.8: 4096 tokens). Not a fault — surface, never abort.
     */
    | 'below_minimum'
    /** Provider reported no cache signals at all — cannot enforce. Surface. */
    | 'unknown'
    /**
     * The cache WAS armed on an earlier pass, yet this pass (>=2) read nothing:
     * a full-price corpus re-send. This is the costly scenario — abort.
     */
    | 'miss';

export interface OmnibusCacheProbe {
    cacheReadTokens: number;
    cacheCreatedTokens: number;
    /** True when the provider returned at least one cache-related usage field. */
    hasCacheSignals: boolean;
}

/**
 * Read the cache-relevant token counts out of a provider usage payload. Mirrors
 * the fields the Anthropic adapter surfaces (cache_read_input_tokens and the
 * cache_creation ephemeral 5m/1h buckets). Absence of every field means the
 * provider gives us no cache signal to enforce on.
 */
export function readOmnibusCacheProbe(usage: TokenUsage | null | undefined): OmnibusCacheProbe {
    const cacheReadTokens = usage?.cacheReadInputTokens ?? 0; // SAFE: an absent cache-read counter means nothing was served from cache
    const cacheCreatedTokens = (usage?.cacheCreationInputTokens ?? 0) // SAFE: providers omit cache counters when nothing was cached, so 0 is the true count
        + (usage?.cacheCreation5mInputTokens ?? 0) // SAFE: a usage block without the 5m tier means zero 5m-cached tokens
        + (usage?.cacheCreation1hInputTokens ?? 0); // SAFE: a usage block without the 1h tier means zero 1h-cached tokens
    const hasCacheSignals = !!usage && (
        typeof usage.cacheReadInputTokens === 'number'
        || typeof usage.cacheCreationInputTokens === 'number'
        || typeof usage.cacheCreation5mInputTokens === 'number'
        || typeof usage.cacheCreation1hInputTokens === 'number'
    );
    return { cacheReadTokens, cacheCreatedTokens, hasCacheSignals };
}

export interface OmnibusCacheDecision {
    health: OmnibusCacheHealth;
    /** Carry-forward: whether the cache is armed after this pass. */
    cacheArmed: boolean;
    /** True only for the costly miss scenario that must terminate the run. */
    abort: boolean;
}

/**
 * Evaluate one completed question's cache result. Pure — the caller threads
 * `cacheArmedBefore` from the prior decision so "below minimum" (never armed)
 * can be distinguished from "miss" (armed, then re-sent at full price).
 */
export function evaluateOmnibusCachePass(params: {
    /** 1-based position of this question within the run. */
    passIndex: number;
    probe: OmnibusCacheProbe;
    cacheArmedBefore: boolean;
}): OmnibusCacheDecision {
    const { passIndex, probe, cacheArmedBefore } = params;

    // A real cache read is unambiguous health, on any pass (question 1 may
    // legitimately read a warm cache left by a prior run).
    if (probe.cacheReadTokens > 0) {
        return { health: 'reused', cacheArmed: true, abort: false };
    }
    // No cache-related usage fields at all → the provider/model gives us no
    // signal we can enforce on. Surface "unknown", never abort.
    if (!probe.hasCacheSignals) {
        return { health: 'unknown', cacheArmed: cacheArmedBefore, abort: false };
    }
    // Fields present, no read, but this pass wrote a cache entry → armed.
    if (probe.cacheCreatedTokens > 0) {
        return { health: 'armed', cacheArmed: true, abort: false };
    }
    // Fields present, neither read nor created.
    if (!cacheArmedBefore) {
        // Nothing has armed the cache across the run so far → the corpus is
        // below the model's minimum cacheable prefix. Not a fault; surface.
        return { health: 'below_minimum', cacheArmed: false, abort: false };
    }
    // The cache WAS armed on an earlier pass, yet this pass read nothing: a
    // full-price corpus re-send. Abort the remaining questions on pass >=2.
    if (passIndex >= 2) {
        return { health: 'miss', cacheArmed: cacheArmedBefore, abort: true };
    }
    return { health: 'unknown', cacheArmed: cacheArmedBefore, abort: false };
}

export interface OmnibusCostAccumulator {
    totalCostUSD: number;
    pricedPasses: number;
    unpricedPasses: number;
}

export function createOmnibusCostAccumulator(): OmnibusCostAccumulator {
    return { totalCostUSD: 0, pricedPasses: 0, unpricedPasses: 0 };
}

/**
 * Add one completed pass's actual cost to the running total, priced from its
 * real token-usage payload. `cacheReadTokens` selects the cost provenance so
 * reused tokens bill at the cache-read rate and freshly-processed tokens at the
 * input rate. Passes whose cost cannot be resolved (unknown model, unpriced
 * provider, missing usage) are counted as unpriced rather than silently zeroed.
 */
export function accumulateOmnibusPassCost(
    acc: OmnibusCostAccumulator,
    provider: AIProviderId,
    modelId: string | undefined,
    usage: TokenUsage | null | undefined,
    cacheReadTokens: number
): OmnibusCostAccumulator {
    if (!modelId || !usage) {
        return { ...acc, unpricedPasses: acc.unpricedPasses + 1 };
    }
    const provenance: 'hit' | 'created' = cacheReadTokens > 0 ? 'hit' : 'created';
    let cost: number | undefined;
    try {
        cost = estimateUsageCost(provider, modelId, usage, provenance, ANTHROPIC_REQUESTED_CACHE_TTL)?.totalCostUSD;
    } catch {
        cost = undefined;
    }
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
        return { ...acc, unpricedPasses: acc.unpricedPasses + 1 };
    }
    return {
        totalCostUSD: acc.totalCostUSD + cost,
        pricedPasses: acc.pricedPasses + 1,
        unpricedPasses: acc.unpricedPasses
    };
}

/**
 * Human-readable, doctrine-style explanation for a cache-miss abort. Names the
 * offending question, the expected-vs-actual cache behavior, the tokens billed
 * at full price, the remaining questions that would also be uncached, and the
 * likely causes.
 */
export function buildOmnibusCacheMissMessage(params: {
    passIndex: number;
    totalQuestions: number;
    questionLabel: string;
    fullPriceInputTokens: number;
    remainingQuestions: number;
    cacheTtlLabel: string;
}): string {
    const tokens = Math.max(0, Math.round(params.fullPriceInputTokens)).toLocaleString();
    const remaining = Math.max(0, params.remainingQuestions);
    const remainingClause = remaining > 0
        ? `Terminated before running the remaining ${remaining} question${remaining === 1 ? '' : 's'}, which would each have re-billed the full corpus at input price.`
        : 'No further questions remained.';
    return [
        `Omnibus aborted: cache miss on question ${params.passIndex} of ${params.totalQuestions} (${params.questionLabel}).`,
        `Expected the cached corpus to be reused (cache_read > 0); the provider reported cache_read = 0, so the entire corpus (~${tokens} input tokens) was billed at full input price.`,
        remainingClause,
        `Likely causes: the cacheable prefix was not byte-identical to question 1, the cache expired (TTL ${params.cacheTtlLabel}), or the question 1 arming call was refused/failed (a refusal persists no usable cache entry).`
    ].join(' ');
}
