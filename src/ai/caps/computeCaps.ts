import { PROVIDER_CAPS } from './providerCaps';
import type { AccessTier, AIProviderId, AIOverrides, ModelInfo } from '../types';

/**
 * Safety factor applied on top of the per-tier `maxInputTokens` before
 * reaching the provider.  Accounts for token-estimation imprecision
 * (char-based estimates can under-count vs real BPE tokenisation).
 *
 * 0.9 leaves ~10% headroom for BPE under-count, which is sufficient for
 * English prose (the primary Inquiry corpus type).  The per-tier
 * `safeUtilization` already provides an additional margin (0.7–0.9),
 * so the combined effective ceiling is contextWindow × safeUtil × 0.9.
 *
 * Used by both the aiClient pre-flight guard and the Inquiry execution
 * precheck so the two layers agree on the effective ceiling.
 */
export const INPUT_TOKEN_GUARD_FACTOR = 0.9;

export interface RetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    retryMalformedJson: boolean;
}

export interface ComputedCaps {
    maxInputTokens: number;
    maxOutputTokens: number;
    safeChunkThreshold: number;
    temperature: number;
    retryPolicy: RetryPolicy;
    requestPerMinute: number;
    thinkingBudgetTokens?: number;
    citationsEnabled?: boolean;
}

export interface ComputeCapsInput {
    provider: AIProviderId;
    model: ModelInfo;
    accessTier?: AccessTier;
    feature: string;
    overrides?: Partial<AIOverrides>;
    /** User-level toggle from AI settings. When false, citations are disabled regardless of provider/feature support. */
    userCitationsEnabled?: boolean;
}

function resolveModeMultiplier(mode?: 'auto' | 'high' | 'max'): number {
    if (mode === 'max') return 1;
    if (mode === 'high') return 0.9;
    return 0.75;
}

function resolveFeatureMultiplier(feature: string): number {
    const normalized = feature.toLowerCase();
    if (normalized.includes('inquiry')) return 1;
    if (normalized.includes('gossamer')) return 0.85;
    if (normalized.includes('apr')) return 0.5;
    if (normalized.includes('runtime')) return 0.4;
    return 0.7;
}

/** Extended thinking budget resolver.
 *  First ship: Anthropic + Inquiry + deep only. Returns undefined when disabled. */
function resolveThinkingBudget(
    provider: AIProviderId,
    feature: string,
    reasoningDepth?: 'standard' | 'deep'
): number | undefined {
    if (provider !== 'anthropic') return undefined;
    if (reasoningDepth !== 'deep') return undefined;
    if (!feature.toLowerCase().includes('inquiry')) return undefined;
    return 4096;
}

/** Citations resolver.
 *
 *  TEMPORARILY DISABLED ACROSS ALL PROVIDERS.
 *
 *  Citations are structurally incompatible with strict-JSON output on every
 *  provider we use:
 *    - Anthropic: citations attach only to text content blocks; tool_use returns
 *      tool_use.input with no text blocks, so citations have nowhere to anchor.
 *    - OpenAI: no document-citation API for Inquiry (file_citation/url_citation
 *      annotations require the Responses API's File Search / Web Search tools,
 *      which we do not invoke here).
 *    - Gemini: no per-document citation metadata exposed for our path.
 *
 *  Dropping forced tool_use to make Anthropic citations work introduced its
 *  own cascade of failures (extended thinking activated, parse-retry path
 *  stripped evidence and silently hallucinated). The complexity wasn't worth
 *  the result.
 *
 *  Sources still surface verbatim quotes via the per-finding `evidence_quote`
 *  schema field — the model self-attributes a quote per finding under strict
 *  JSON enforcement. That gives the same end-user experience without the
 *  provider-side gymnastics.
 *
 *  All downstream code (sanitizers, document-block emission, citation
 *  extraction, Sources rendering) is intact. To re-enable, restore the
 *  earlier provider/feature gate below — no other code path needs to change.
 */
export function resolveCitationsEnabled(
    _provider: AIProviderId,
    _feature: string,
    _userCitationsEnabled?: boolean
): boolean {
    return false;
}

function resolveDefaultTemperature(feature: string, reasoningDepth?: 'standard' | 'deep'): number {
    const normalized = feature.toLowerCase();
    if (normalized.includes('inquiry')) {
        return reasoningDepth === 'deep' ? 0.15 : 0.2;
    }
    if (normalized.includes('gossamer')) {
        return 0.45;
    }
    return 0.25;
}

export function computeCaps(input: ComputeCapsInput): ComputedCaps {
    if (input.provider === 'none') {
        return {
            maxInputTokens: 0,
            maxOutputTokens: 0,
            safeChunkThreshold: 0,
            temperature: 0,
            retryPolicy: { maxAttempts: 0, baseDelayMs: 0, retryMalformedJson: false },
            requestPerMinute: 0
        };
    }

    const providerCaps = PROVIDER_CAPS[input.provider];
    const tier = input.accessTier ?? 1;
    const tierCaps = providerCaps.tiers[tier];
    const modeMultiplier = resolveModeMultiplier(input.overrides?.maxOutputMode);
    const featureMultiplier = resolveFeatureMultiplier(input.feature);
    const modelMaxOutput = Math.max(1, input.model.maxOutput || providerCaps.providerMaxOutputTokens);

    const baseOutput = Math.min(
        providerCaps.providerMaxOutputTokens,
        tierCaps.maxOutputTokens,
        modelMaxOutput
    );

    const targetOutput = Math.max(
        512,
        Math.floor(baseOutput * modeMultiplier * featureMultiplier)
    );

    // Ceiling override (truncation retry): use the full model/provider output
    // ceiling, ignoring the rate-limit tier clamp and the mode/feature
    // multipliers. The tier governs request RATE, not per-request max_tokens,
    // and a lower cap saves nothing on cost — it only truncates large
    // structured replies. Still bounded by the provider/model hard maximum.
    const ceilingOutput = Math.max(512, Math.min(providerCaps.providerMaxOutputTokens, modelMaxOutput));
    const maxOutputTokens = input.overrides?.forceMaxOutputCeiling
        ? ceilingOutput
        : Math.min(baseOutput, targetOutput);
    const safeChunkThreshold = tierCaps.safeUtilization;
    const maxInputTokens = Math.max(1024, Math.floor((input.model.contextWindow || providerCaps.defaultInputTokens) * safeChunkThreshold));

    const retryPolicy: RetryPolicy = {
        maxAttempts: tierCaps.retryAttempts,
        baseDelayMs: input.provider === 'ollama' ? 600 : 400,
        retryMalformedJson: true
    };

    const thinkingBudgetTokens = resolveThinkingBudget(
        input.provider, input.feature, input.overrides?.reasoningDepth
    );

    // When extended thinking is enabled, Anthropic requires temperature=1.
    const temperature = thinkingBudgetTokens
        ? 1
        : (typeof input.overrides?.temperature === 'number'
            ? input.overrides.temperature
            : resolveDefaultTemperature(input.feature, input.overrides?.reasoningDepth));

    const citationsEnabled = resolveCitationsEnabled(input.provider, input.feature, input.userCitationsEnabled) || undefined;

    return {
        maxInputTokens,
        maxOutputTokens,
        safeChunkThreshold,
        temperature,
        retryPolicy,
        requestPerMinute: tierCaps.requestPerMinute,
        thinkingBudgetTokens,
        citationsEnabled
    };
}
