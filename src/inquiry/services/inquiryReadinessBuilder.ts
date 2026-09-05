/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Pure functions for building Inquiry readiness/estimate UI state.
 *
 * ⚠️ GUARDRAIL: This module is aggressively pure.
 * - Zero references to plugin, DOM, or class instance state.
 * - Every function is (input: ExplicitStruct) => output.
 * - No Obsidian imports.
 * - Must be importable and testable with zero Obsidian dependencies.
 */

import type { InquiryScope } from '../state';
import type { InquiryEstimateSnapshot } from './inquiryEstimateSnapshot';
import type { TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';
import type { AIProviderId, AIRunAdvancedContext } from '../../ai/types';
import type { ResolvedInquiryEngine } from './inquiryModelResolver';
import type {
    TokenTier,
    InquiryPayloadStats,
    InquiryReadinessUiState,
    InquiryEnginePopoverState,
    PassPlanResult
} from '../types';
import { evaluateInquiryReadiness } from './readiness';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';
import { INQUIRY_MAX_OUTPUT_TOKENS } from '../constants';
import { PROVIDER_MAX_OUTPUT_TOKENS } from '../../constants/tokenLimits';
import { buildRTCorpusEstimate } from './buildRTCorpusEstimate';

// ── Constants ─────────────────────────────────────────────────────────

export const INQUIRY_INPUT_TOKENS_AMBER = 90000;
export const INQUIRY_INPUT_TOKENS_RED = 140000;

// ── Input structs ─────────────────────────────────────────────────────

export interface BuildReadinessUiStateInput {
    snapshot: InquiryEstimateSnapshot | null;
    scope: InquiryScope;
    scopeLabel: string;
    resolvedEngine: ResolvedInquiryEngine;
    hasCredential: boolean;
    payloadStats: InquiryPayloadStats;
    selectedSceneOverrideCount: number;
    hasAnyBodyEvidence: boolean;
    estimateSummaryOnlyTokens: number;
}

export interface BuildEnginePayloadSummaryInput {
    payloadStats: InquiryPayloadStats | null;
    scope: InquiryScope;
    scopeLabel: string;
}

export interface AdvisoryInputKeyParams {
    scope: InquiryScope;
    scopeLabel: string;
    provider: AIProviderId;
    modelId: string;
    estimatedInputTokens: number;
    estimateMethod: TokenEstimateMethod;
    estimateUncertaintyTokens: number;
    corpusFingerprint: string;
    overrideSummary: { active: boolean; classCount: number; itemCount: number; total: number };
    corpusFingerprintReused: boolean;
}

// ── Token tier ────────────────────────────────────────────────────────

export function getTokenTier(inputTokens: number): TokenTier {
    if (inputTokens >= INQUIRY_INPUT_TOKENS_RED) return 'red';
    if (inputTokens >= INQUIRY_INPUT_TOKENS_AMBER) return 'amber';
    return 'normal';
}

export function getTokenTierFromSnapshot(snapshot: InquiryEstimateSnapshot | null): TokenTier {
    if (!snapshot) return 'normal';
    return getTokenTier(snapshot.estimate.estimatedInputTokens);
}

// ── Format ────────────────────────────────────────────────────────────

export function formatTokenEstimate(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    if (safe >= 1000) {
        const rounded = Math.round(safe / 100) / 10;
        return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}k`;
    }
    return String(Math.round(safe));
}

// ── Engine payload summary ────────────────────────────────────────────

export function buildEnginePayloadSummary(input: BuildEnginePayloadSummaryInput): {
    text: string;
    inputTokens: number;
    tier: TokenTier;
} {
    const scopeLabel = input.scope === 'saga' ? 'Saga' : 'Book';
    const contextLabel = `${scopeLabel} ${input.scopeLabel}`;
    if (!input.payloadStats) {
        return {
            text: `Payload (${contextLabel}): Estimating…`,
            inputTokens: 0,
            tier: 'normal'
        };
    }
    const corpusEstimate = buildRTCorpusEstimate(input.payloadStats);
    const inputLabel = formatTokenEstimate(corpusEstimate.estimatedTokens);
    return {
        text: `Payload (${contextLabel}): ~${inputLabel} in`,
        inputTokens: corpusEstimate.estimatedTokens,
        tier: getTokenTier(corpusEstimate.estimatedTokens)
    };
}

// ── Popover state ─────────────────────────────────────────────────────

export function resolveEnginePopoverState(readinessUi: InquiryReadinessUiState): InquiryEnginePopoverState {
    if (readinessUi.readiness.state === 'ready') return 'ready';
    if (readinessUi.readiness.state === 'large') return 'multi-pass';
    return 'exceeds';
}

// ── Pass count / pass plan ────────────────────────────────────────────

export function estimateStructuredPassCount(readinessUi: InquiryReadinessUiState): number {
    if (Number.isFinite(readinessUi.expectedPassCount) && readinessUi.expectedPassCount > 0) {
        return Math.max(1, Math.floor(readinessUi.expectedPassCount));
    }
    return 1;
}

export function getCurrentPassPlan(
    readinessUi: InquiryReadinessUiState,
    lastAdvancedContext: AIRunAdvancedContext | null
): PassPlanResult {
    const multiPassExpected = readinessUi.readiness.exceedsBudget;
    if (!multiPassExpected) {
        return {
            multiPassExpected: false,
            estimatedPassCount: null,
            recentExactPassCount: null,
            displayPassCount: 1,
            multiPassTriggerReason: null
        };
    }
    const recentExactPassCount = typeof lastAdvancedContext?.executionPassCount === 'number' && lastAdvancedContext.executionPassCount > 1
        ? lastAdvancedContext.executionPassCount
        : null;
    const estimatedPassCount = estimateStructuredPassCount(readinessUi);
    const effectiveEstimate = estimatedPassCount;
    return {
        multiPassExpected: true,
        estimatedPassCount: effectiveEstimate,
        recentExactPassCount,
        displayPassCount: recentExactPassCount ?? effectiveEstimate,
        multiPassTriggerReason: lastAdvancedContext?.multiPassTriggerReason ?? null
    };
}

// ── Run scope label ───────────────────────────────────────────────────

export function buildRunScopeLabel(
    stats: InquiryPayloadStats,
    selectedSceneCount: number,
    scope: InquiryScope,
    scopeLabel: string
): string {
    const sceneMode = stats.sceneFullTextCount > 0
        ? 'Full Scenes'
        : stats.sceneSynopsisUsed > 0
            ? 'Summaries'
            : 'No scene evidence';
    const outlineCount = stats.bookOutlineCount + stats.sagaOutlineCount;
    const outlineMode = (stats.bookOutlineFullCount + stats.sagaOutlineFullCount) > 0
        ? 'Full'
        : (stats.bookOutlineSummaryCount + stats.sagaOutlineSummaryCount) > 0
            ? 'Summary'
            : '';

    if (scope === 'book' && selectedSceneCount > 0 && selectedSceneCount < Math.max(1, stats.sceneTotal)) {
        return `Run on ${selectedSceneCount} scenes (${sceneMode}).`;
    }

    if (scope === 'book') {
        const parts: string[] = [];
        if (outlineCount > 0) {
            parts.push(`Outline (${outlineMode || 'Exclude'})`);
        }
        if (stats.sceneTotal > 0) {
            parts.push(sceneMode);
        }
        return `Run on Book ${scopeLabel} (${parts.join(' + ')}).`;
    }

    return `Run on Saga ${scopeLabel} (${sceneMode}).`;
}

// ── Advisory input key ────────────────────────────────────────────────

export function buildAdvisoryInputKey(params: AdvisoryInputKeyParams): string {
    return [
        params.scope,
        params.scopeLabel,
        params.provider,
        params.modelId,
        Math.round(params.estimatedInputTokens / 5000) * 5000,
        params.estimateMethod,
        Math.round(params.estimateUncertaintyTokens / 1000) * 1000,
        params.corpusFingerprint,
        params.overrideSummary.active ? 1 : 0,
        params.overrideSummary.classCount,
        params.overrideSummary.itemCount,
        params.overrideSummary.total,
        params.corpusFingerprintReused ? 1 : 0
    ].join('|');
}

// ── Readiness UI state (main builder) ─────────────────────────────────

export function buildReadinessUiState(input: BuildReadinessUiStateInput): InquiryReadinessUiState {
    const { snapshot, scope, scopeLabel, resolvedEngine, hasCredential, payloadStats, selectedSceneOverrideCount } = input;
    const provider = resolvedEngine.provider === 'none' ? 'openai' as const : resolvedEngine.provider;
    const providerLabel = resolvedEngine.providerLabel;

    // If the engine itself is blocked (e.g. provider lacks Inquiry capability
    // floor), return a definitive blocked state — no model lookup, no
    // fabricated numbers.
    if (resolvedEngine.blocked) {
        return {
            pending: false,
            readiness: evaluateInquiryReadiness({
                hasEligibleModel: false,
                hasCredential,
                estimatedInputTokens: 0,
                safeInputBudget: 0,
                estimateUncertaintyTokens: 0
            }),
            estimateInputTokens: 0,
            estimateInputTokensSource: 'unavailable',
            expectedPassCount: 1,
            estimateMethod: 'heuristic_chars',
            estimateUncertaintyTokens: 0,
            safeInputBudget: 0,
            outputBudget: PROVIDER_MAX_OUTPUT_TOKENS[provider] ?? INQUIRY_MAX_OUTPUT_TOKENS,
            hasEligibleModel: false,
            hasCredential,
            provider,
            providerLabel,
            reason: resolvedEngine.blockReason || 'No model satisfies capability floor.',
            runScopeLabel: buildRunScopeLabel(payloadStats, selectedSceneOverrideCount, scope, scopeLabel),
            canSwitchToSummaries: false,
            canUseSelectedScenesOnly: false
        };
    }

    // If snapshot is not yet available, return a pending state.
    if (!snapshot) {
        return {
            pending: true,
            readiness: evaluateInquiryReadiness({
                hasEligibleModel: false,
                hasCredential,
                estimatedInputTokens: 0,
                safeInputBudget: 0,
                estimateUncertaintyTokens: 0
            }),
            estimateInputTokens: 0,
            estimateInputTokensSource: 'unavailable',
            expectedPassCount: 1,
            estimateMethod: 'heuristic_chars',
            estimateUncertaintyTokens: 0,
            safeInputBudget: 0,
            outputBudget: PROVIDER_MAX_OUTPUT_TOKENS[provider] ?? INQUIRY_MAX_OUTPUT_TOKENS,
            hasEligibleModel: false,
            hasCredential,
            provider,
            providerLabel,
            reason: 'Estimating…',
            runScopeLabel: buildRunScopeLabel(payloadStats, selectedSceneOverrideCount, scope, scopeLabel),
            canSwitchToSummaries: false,
            canUseSelectedScenesOnly: false
        };
    }

    const providerEstimateInputTokens = snapshot.estimate.estimatedInputTokens;
    const expectedPassCount = Math.max(1, Math.floor(snapshot.estimate.expectedPassCount));
    const estimateMethod: TokenEstimateMethod = snapshot.estimate.estimationMethod;
    const safeInputBudget = Math.max(0, Math.floor(snapshot.estimate.effectiveInputCeiling));
    const outputBudget = snapshot.estimate.maxOutputTokens;
    const estimateUncertaintyBudget = Math.max(0, Math.floor(snapshot.estimate.uncertaintyTokens));

    // Pressure-bar source: when the provider count succeeded, the
    // headline number IS the provider count. When it failed (e.g.
    // Gemini countTokens unavailable → method='unavailable',
    // providerEstimateInputTokens=0), the user still deserves to see
    // the request pressure for the local-known corpus sum (deterministic
    // chars/4). Without this fallback the minimap pressure bar has width
    // 0 and disappears entirely — which is the bug.
    //
    // Per RT doctrine: this is a labeled local estimate, NOT silently
    // promoted to provider truth. We expose `estimateInputTokensSource`
    // so downstream surfaces (minimap, log) can disclose the source.
    const localCorpusTokens = Math.max(0, Math.floor(snapshot.corpus.estimate.estimatedTokens));
    const providerCountAvailable = estimateMethod === 'anthropic_count'
        || estimateMethod === 'google_count'
        || estimateMethod === 'heuristic_chars';
    const usingLocalEstimateFallback = !providerCountAvailable
        && providerEstimateInputTokens <= 0
        && localCorpusTokens > 0;
    const estimateInputTokens = usingLocalEstimateFallback
        ? localCorpusTokens
        : providerEstimateInputTokens;
    const estimateInputTokensSource: 'provider_count' | 'local_estimate' | 'unavailable' =
        providerCountAvailable && providerEstimateInputTokens > 0
            ? 'provider_count'
            : usingLocalEstimateFallback
                ? 'local_estimate'
                : 'unavailable';

    // Model lookup — for metadata only, not for recomputing budgets.
    const model = BUILTIN_MODELS.find(m => m.id === resolvedEngine.modelId);
    const hasEligibleModel = safeInputBudget > 0;
    let reason = 'Fits safely - single pass.';

    const readiness = evaluateInquiryReadiness({
        hasEligibleModel,
        hasCredential,
        estimatedInputTokens: estimateInputTokens,
        safeInputBudget,
        estimateUncertaintyTokens: estimateUncertaintyBudget
    });

    const canSwitchToSummaries = input.hasAnyBodyEvidence
        && safeInputBudget > 0
        && input.estimateSummaryOnlyTokens <= safeInputBudget;
    const canUseSelectedScenesOnly = scope === 'book'
        && selectedSceneOverrideCount > 0
        && selectedSceneOverrideCount < Math.max(1, payloadStats.sceneTotal);

    if (readiness.cause === 'missing_key') {
        reason = `${providerLabel} key is missing. Add a saved key in AI settings.`;
    } else if (readiness.cause === 'capability_floor') {
        reason = `${providerLabel} cannot satisfy this Inquiry setup. Update Provider, Thinking Style, or Access level.`;
    } else if (readiness.state === 'large') {
        reason = 'Automatic analysis will run multiple structured passes.';
    }

    return {
        pending: false,
        readiness,
        estimateInputTokens,
        estimateInputTokensSource,
        expectedPassCount,
        estimateMethod,
        estimateUncertaintyTokens: estimateUncertaintyBudget,
        safeInputBudget,
        outputBudget,
        hasEligibleModel,
        hasCredential,
        provider,
        providerLabel,
        reason,
        model,
        runScopeLabel: buildRunScopeLabel(payloadStats, selectedSceneOverrideCount, scope, scopeLabel),
        canSwitchToSummaries,
        canUseSelectedScenesOnly
    };
}
