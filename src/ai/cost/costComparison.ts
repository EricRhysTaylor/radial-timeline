/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Cost comparison table: which cloud models are priced, and what one
 * canonical Inquiry run costs on each, fresh and cached. Pure over the
 * pricing table and the inputs the caller hands in; no DOM, no settings.
 */

import type { AIProviderId, ModelInfo } from '../types';
import type { InquiryScope } from '../../inquiry/state';
import type { InquirySessionStore } from '../../inquiry/InquirySessionStore';
import type { TokenEstimateMethod } from '../tokens/inputTokenEstimate';
import { BUILTIN_MODELS } from '../registry/builtinModels';
import { getPickerModelsForProvider, PROVIDER_DISPLAY_LABELS } from '../registry/releaseChannels';
import { getActivePricingTable } from './providerPricing';
import { estimateCorpusCost, formatUsdCost } from './estimateCorpusCost';
import { tokenEstimateFromMethod } from '../estimates';
import { ANTHROPIC_REQUESTED_CACHE_TTL } from '../settings/aiSettings';

export type CostComparisonModel = {
    provider: AIProviderId;
    modelId: string;
    providerLabel: string;
    modelLabel: string;
};

export type CostComparisonRow = {
    model: CostComparisonModel;
    freshText: string;
    cachedText: string;
    passesText: string;
    promoLabel?: string;
};

export const COST_PROVIDER_ORDER: ReadonlyArray<Exclude<AIProviderId, 'none' | 'ollama'>> = ['anthropic', 'openai', 'google'];

export function costComparisonRowKey(provider: AIProviderId, modelId: string): string {
    return `${provider}::${modelId}`;
}

function supportsCostComparisonModel(provider: AIProviderId, modelId: string): boolean {
    if (provider === 'none' || provider === 'ollama') return false;
    return !!getActivePricingTable()[provider]?.[modelId];
}

/** Cloud models with a published price, in provider order. Local models never appear: they have no API charge. */
export function listCostComparisonModels(registryModels?: ModelInfo[]): CostComparisonModel[] {
    const models = registryModels?.length ? registryModels : BUILTIN_MODELS;
    return COST_PROVIDER_ORDER.flatMap(provider =>
        getPickerModelsForProvider(models, provider)
            .filter(model => !model.id.endsWith('-latest'))
            .filter(model => supportsCostComparisonModel(provider, model.id))
            .map(model => ({
                provider,
                modelId: model.id,
                providerLabel: PROVIDER_DISPLAY_LABELS[provider],
                modelLabel: model.label
            }))
    );
}

export type BillableUsage = { outputTokens?: number; inputTokens?: number; totalTokens?: number };

/**
 * Output tokens a provider bills for. Gemini reports thinking tokens only in
 * the total, so its billable output is the larger of the reported output and
 * total minus input.
 */
export function billableOutputTokensFromUsage(provider: AIProviderId, usage: BillableUsage | undefined): number | null {
    if (!usage || typeof usage.outputTokens !== 'number') return null;
    if (!Number.isFinite(usage.outputTokens) || usage.outputTokens <= 0) return null;
    if (
        provider === 'google'
        && typeof usage.inputTokens === 'number'
        && Number.isFinite(usage.inputTokens)
        && typeof usage.totalTokens === 'number'
        && Number.isFinite(usage.totalTokens)
    ) {
        return Math.max(usage.outputTokens, usage.totalTokens - usage.inputTokens);
    }
    return Math.floor(usage.outputTokens);
}

/** The Inquiry history the rows read: the store, the corpus scope, and the fingerprint a cache must match to count as active. */
export interface CostComparisonSessionContext {
    sessionStore: InquirySessionStore;
    scope: InquiryScope;
    cacheReuseFingerprint: string | null;
}

export function latestOutputSampleForModel(ctx: CostComparisonSessionContext | null, model: CostComparisonModel): number | null {
    if (!ctx || model.provider === 'ollama' || model.provider === 'none') return null;
    const session = ctx.sessionStore.getLatestSessionForEngineInScope(model.provider, model.modelId, ctx.scope);
    if (!session) return null;
    return billableOutputTokensFromUsage(model.provider, session.result.tokenUsage);
}

export function activeCacheReuseRatioForModel(ctx: CostComparisonSessionContext | null, model: CostComparisonModel): number | null {
    if (!ctx || !ctx.cacheReuseFingerprint) return null;
    if (model.provider === 'ollama' || model.provider === 'none') return null;
    const session = ctx.sessionStore.getLatestActiveCacheSessionForEngine(
        model.provider,
        model.modelId,
        { cacheReuseFingerprint: ctx.cacheReuseFingerprint, scope: ctx.scope }
    );
    if (!session?.cacheWindowExpiresAt || session.cacheWindowExpiresAt <= Date.now()) return null;
    if (typeof session.cachedStableRatio !== 'number' || !Number.isFinite(session.cachedStableRatio) || session.cachedStableRatio <= 0) return null;
    return Math.min(1, Math.max(0, session.cachedStableRatio));
}

export interface CostComparisonExecutionEstimate {
    estimatedTokens: number;
    method: TokenEstimateMethod;
    expectedPassCount?: number;
    maxOutputTokens?: number;
}

export interface CostComparisonDeps {
    session: CostComparisonSessionContext | null;
    /** The canonical Inquiry execution estimate for one engine; throws when no corpus is loaded. */
    estimateExecution: (provider: AIProviderId, modelId: string) => Promise<CostComparisonExecutionEstimate | null | undefined>;
    /** Learned output size for this engine at this input size, or null when nothing has been learned yet. */
    predictExpectedOutput: (provider: AIProviderId, modelId: string, inputTokens: number) => number | null;
    /** The configured cache window label for a provider, or null when it has none. */
    cacheWindowLabel: (provider: AIProviderId) => string | null;
}

function passesLabel(count: number): string {
    return `${count} ${count === 1 ? 'pass' : 'passes'}`;
}

/** One row per model. Refuses to price an unknown input and says so instead of showing a fabricated dollar figure. */
export async function buildCostComparisonRows(models: CostComparisonModel[], deps: CostComparisonDeps): Promise<CostComparisonRow[]> {
    return Promise.all(models.map(async model => {
        const executionEstimate = await deps.estimateExecution(model.provider, model.modelId);
        if (!executionEstimate?.expectedPassCount || !executionEstimate.maxOutputTokens) {
            throw new Error(`Canonical execution estimate unavailable for ${model.modelLabel}.`);
        }
        const passLabel = passesLabel(executionEstimate.expectedPassCount);
        // The typed estimate carries provenance: a failed provider count is
        // 'unavailable', not a zero that would round to a fake "$0.01".
        const inputEstimate = tokenEstimateFromMethod(executionEstimate.method, executionEstimate.estimatedTokens);
        if (inputEstimate.source === 'unavailable' || inputEstimate.source === 'pending') {
            return { model, freshText: 'Unavailable', cachedText: 'Unavailable', passesText: passLabel };
        }
        const learnedOutput = deps.predictExpectedOutput(model.provider, model.modelId, inputEstimate.tokens);
        const latestOutput = learnedOutput !== null ? learnedOutput : latestOutputSampleForModel(deps.session, model);
        if (latestOutput === null) {
            return { model, freshText: 'Output sample needed', cachedText: 'Output sample needed', passesText: passLabel };
        }
        const activeCacheReuseRatio = activeCacheReuseRatioForModel(deps.session, model);
        const cost = estimateCorpusCost(
            model.provider,
            model.modelId,
            inputEstimate.tokens,
            Math.min(latestOutput, executionEstimate.maxOutputTokens),
            executionEstimate.expectedPassCount,
            {
                // Anthropic Inquiry runs always request the 1h cache; pricing
                // the priming pass at the 5m rate would under-estimate by a third.
                ...(model.provider === 'anthropic' ? { cacheWriteTtl: ANTHROPIC_REQUESTED_CACHE_TTL } : {}),
                cacheReuseRatio: activeCacheReuseRatio !== null ? activeCacheReuseRatio : 0
            }
        );
        const cacheWindowLabel = deps.cacheWindowLabel(model.provider);
        const cachedSuffix = activeCacheReuseRatio !== null && cacheWindowLabel && typeof cost.cachedCostUSD === 'number' ? ` (${cacheWindowLabel})` : '';
        // Anthropic primes the cache on the first run, so the fresh figure
        // already carries the cache-write surcharge; say which window.
        const freshSuffix = model.provider === 'anthropic' && cacheWindowLabel ? ` (${cacheWindowLabel})` : '';
        const storageFootnote = model.provider === 'google' ? '**' : '';
        // A local chars/4 count is not a provider count; the label says so.
        const inputProvenanceSuffix = inputEstimate.source === 'local_estimate' ? ' (local input)' : '';
        return {
            model,
            freshText: `${formatUsdCost(cost.freshCostUSD)}${freshSuffix}${inputProvenanceSuffix}`,
            cachedText: activeCacheReuseRatio !== null && typeof cost.cachedCostUSD === 'number'
                ? `${formatUsdCost(cost.cachedCostUSD)}${cachedSuffix}${storageFootnote}${inputProvenanceSuffix}`
                : 'No active cache',
            passesText: passesLabel(cost.expectedPasses),
            promoLabel: cost.promo?.label
        };
    }));
}
