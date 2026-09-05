/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * InquiryEstimateSnapshot — single source of truth for Inquiry token estimates.
 *
 * Every UI surface that displays token counts, pass expectations, or readiness
 * indicators reads from one immutable snapshot produced here.  The snapshot is
 * keyed by a deterministic state key so that identical corpus + engine states
 * produce identical estimates without recomputation.
 *
 * Invariants:
 *   - Snapshot is immutable once built.  Never mutated after return.
 *   - State key excludes question text — hovering between questions does NOT
 *     trigger recomputation.
 *   - Mode (flow/depth) is excluded — proven UI-only emphasis that does not
 *     affect corpus selection, evidence blocks, or prompt construction.
 *   - Material rules (class configs) are implicitly captured by corpusFingerprint
 *     because changing rules changes manifest entries → changes fingerprint.
 */

import type { MetadataCache, Vault } from 'obsidian';
import type { AIProviderId } from '../../ai/types';
import type { RTCorpusTokenEstimate } from '../../ai/types';
import type { TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';
import type { InquiryLens, InquiryScope, InquirySelectionMode } from '../state';
import type { ResolvedInquiryEngine } from './inquiryModelResolver';
import type { CorpusManifest, EvidenceParticipationRules, InquiryRunnerInput } from '../runner/types';
import type { InquiryRunnerService } from '../runner/InquiryRunnerService';
import { INQUIRY_CANONICAL_ESTIMATE_QUESTION, INQUIRY_MAX_OUTPUT_TOKENS } from '../constants';
import { PROVIDER_MAX_OUTPUT_TOKENS } from '../../constants/tokenLimits';
import { buildInquiryEstimateTrace } from './inquiryEstimateTrace';
import { summarizeScopedInquiryEntries } from './canonicalInquiryCorpus';
import { buildExactCorpusEstimateFromManifestEntries } from './buildExactCorpusEstimate';

// ── Version ─────────────────────────────────────────────────────────

export const ESTIMATE_SNAPSHOT_VERSION = 1 as const;

// ── Types ───────────────────────────────────────────────────────────

export interface InquiryEstimateSnapshot {
    readonly version: typeof ESTIMATE_SNAPSHOT_VERSION;
    readonly stateKey: string;
    readonly computedAt: number;

    readonly scope: InquiryScope;
    readonly activeBookId?: string;
    /**
     * Citations toggle state at snapshot build time. Included so that consumers
     * can detect drift if the snapshot was built before a setting change.
     * Also baked into stateKey so the service rebuilds on toggle.
     */
    readonly citationsEnabled: boolean;

    readonly resolvedEngine: {
        readonly provider: AIProviderId;
        readonly modelId: string;
        readonly modelLabel: string;
        readonly contextWindow: number;
    };

    readonly corpus: {
        readonly scenes: string[];       // file paths
        readonly outlines: string[];     // file paths
        readonly references: string[];   // file paths
        readonly sceneCount: number;
        readonly outlineCount: number;
        readonly referenceCount: number;
        readonly evidenceChars: number;
        // Full manifest fingerprint (includes modelId). Compared against
        // result.corpusFingerprint persisted by completed runs.
        readonly corpusFingerprint: string;
        // Model-free fingerprint of the corpus contents alone. Used to reuse the
        // corpus estimate across model switches (corpus chars are provider-
        // independent — only request envelope tokens depend on the model).
        readonly corpusOnlyFingerprint: string;
        readonly estimate: RTCorpusTokenEstimate;
    };

    readonly estimate: {
        readonly estimatedInputTokens: number;
        readonly effectiveInputCeiling: number;
        readonly maxOutputTokens: number;
        readonly expectedPassCount: number;
        readonly estimationMethod: TokenEstimateMethod;
        readonly uncertaintyTokens: number;
        /**
         * The most recent provider countTokens failure message, when
         * `estimationMethod === 'unavailable'`. Surfaced from the trace
         * notes so UI surfaces (the unavailable-pill tooltip, the
         * Inquiry Log) can show *why* the count is unavailable instead
         * of just *that* it is. Empty when the count succeeded.
         */
        readonly tokenCountFailureMessage?: string;
    };
}

// ── Snapshot builder params ─────────────────────────────────────────

export interface EstimateSnapshotParams {
    scope: InquiryScope;
    activeBookId?: string;
    targetSceneIds: string[];
    scopeLabel: string;
    manifest: CorpusManifest;
    payloadStats: {
        sceneCount: number;
        outlineCount: number;
        referenceCount: number;
        evidenceChars: number;
    };
    vault: Vault;
    metadataCache: MetadataCache;
    frontmatterMappings?: Record<string, string>;
    runner: InquiryRunnerService;
    engine: ResolvedInquiryEngine;
    overrideSummary: {
        active: boolean;
        classCount: number;
        itemCount: number;
        total: number;
    };
    rules: EvidenceParticipationRules;
    mode: InquiryLens;
    selectionMode: InquirySelectionMode;
    /**
     * Whether citation source-anchoring is enabled. Affects bytes-on-the-wire
     * for Anthropic (document blocks vs plain text) and cache reuse for
     * Gemini, so it is part of the snapshot identity.
     */
    citationsEnabled: boolean;
}

// ── State key ───────────────────────────────────────────────────────

/**
 * Compute a deterministic cache key for snapshot invalidation.
 *
 * Key components:
 *   scope | activeBookId | corpusFingerprint | provider | modelId | overrideClassCount | overrideItemCount | citationsEnabled
 *
 * Every dimension that changes bytes-on-the-wire (or the provider request
 * shape) must be in this key. If you add a new dimension, add it here AND in
 * EstimateSnapshotParams AND propagate from every requestSnapshot call site.
 *
 * Exclusions (with rationale):
 *   - Question text: Evidence chars (~200k) dwarf question length (~200 chars).
 *     Including it would trigger recomputation on hover — violates UX rule.
 *   - Mode (flow/depth): Proven UI-only emphasis. InquiryRunnerInput documents:
 *     "UI emphasis only; inquiry computation must always include both flow + depth
 *     regardless of lens."  buildEvidenceBlocks() ignores it.
 *   - Material rules (class configs): Implicitly captured by corpusFingerprint.
 *     Any rule change that affects the estimate changes the manifest entries,
 *     which changes the fingerprint.
 */
export function computeEstimateStateKey(params: {
    scope: InquiryScope;
    activeBookId?: string;
    corpusFingerprint: string;
    provider: AIProviderId;
    modelId: string;
    overrideClassCount: number;
    overrideItemCount: number;
    citationsEnabled: boolean;
}): string {
    return [
        params.scope,
        params.activeBookId ?? '',
        params.corpusFingerprint,
        params.provider,
        params.modelId,
        params.overrideClassCount,
        params.overrideItemCount,
        params.citationsEnabled ? 'cite' : 'nocite'
    ].join('|');
}

// ── Corpus ID extraction ────────────────────────────────────────────

function extractCorpusIds(manifest: CorpusManifest): {
    scenes: string[];
    outlines: string[];
    references: string[];
} {
    return summarizeScopedInquiryEntries(manifest.entries);
}

// ── Builder ─────────────────────────────────────────────────────────

/**
 * Build an immutable InquiryEstimateSnapshot.
 *
 * Uses the canonical estimate question so that the estimate is deterministic
 * per corpus state — hovering between user questions does not cause flicker.
 *
 * Internal flow:
 *   1. Compute state key from params
 *   2. Extract corpus ID lists from manifest entries
 *   3. Call runner.buildTrace() with INQUIRY_CANONICAL_ESTIMATE_QUESTION
 *   4. Extract trace.tokenEstimate (inputTokens, effectiveInputCeiling, etc.)
 *   5. Compute expectedPassCount via the same chunk planner used by execution
 *   6. Package and return frozen snapshot
 */
export async function buildInquiryEstimateSnapshot(
    params: EstimateSnapshotParams
): Promise<InquiryEstimateSnapshot> {
    const stateKey = computeEstimateStateKey({
        scope: params.scope,
        activeBookId: params.activeBookId,
        corpusFingerprint: params.manifest.fingerprint,
        provider: params.engine.provider,
        modelId: params.engine.modelId,
        overrideClassCount: params.overrideSummary.classCount,
        overrideItemCount: params.overrideSummary.itemCount,
        citationsEnabled: params.citationsEnabled
    });

    const corpusIds = extractCorpusIds(params.manifest);
    const corpusEstimate = await buildExactCorpusEstimateFromManifestEntries({
        entries: params.manifest.entries,
        vault: params.vault,
        metadataCache: params.metadataCache,
        frontmatterMappings: params.frontmatterMappings
    });

    // Build a trace using the canonical question to get a precise token estimate.
    const runnerInput: InquiryRunnerInput = {
        scope: params.scope,
        scopeLabel: params.scopeLabel,
        targetSceneIds: params.scope === 'book' ? params.targetSceneIds : [],
        selectionMode: params.selectionMode,
        activeBookId: params.activeBookId,
        mode: params.mode,
        questionId: 'estimate-snapshot',
        questionText: INQUIRY_CANONICAL_ESTIMATE_QUESTION,
        questionPromptForm: 'standard',
        questionZone: 'setup',
        corpus: params.manifest,
        rules: params.rules,
        ai: {
            provider: params.engine.provider === 'none' ? 'openai' : params.engine.provider,
            modelId: params.engine.modelId,
            modelLabel: params.engine.modelLabel
        },
        citationsEnabled: params.citationsEnabled
    };

    const trace = await buildInquiryEstimateTrace(params.runner, runnerInput);

    const estimatedInputTokens = trace.tokenEstimate.inputTokens;
    const effectiveInputCeiling = trace.tokenEstimate.effectiveInputCeiling;
    const estimationMethod = trace.tokenEstimate.estimationMethod;
    const uncertaintyTokens = trace.tokenEstimate.uncertaintyTokens;
    const expectedPassCount = params.runner.estimateExecutionPassCountFromPrompt(trace.userPrompt, {
        estimatedInputTokens,
        safeInputTokens: effectiveInputCeiling
    });
    // Extract the most recent countTokens failure message from the
    // trace's notes (populated by buildTokenEstimate's notesSink) so UI
    // surfaces can show *why* the count is unavailable, not just *that*.
    const tokenCountFailureMessage = estimationMethod === 'unavailable'
        ? (trace.notes || []).filter(note => /countTokens failed/i.test(note)).pop()
        : undefined;

    const snapshot: InquiryEstimateSnapshot = {
        version: ESTIMATE_SNAPSHOT_VERSION,
        stateKey,
        computedAt: Date.now(),

        scope: params.scope,
        activeBookId: params.activeBookId,
        citationsEnabled: params.citationsEnabled,

        resolvedEngine: {
            provider: params.engine.provider,
            modelId: params.engine.modelId,
            modelLabel: params.engine.modelLabel,
            contextWindow: params.engine.contextWindow,
        },

        corpus: {
            scenes: corpusIds.scenes,
            outlines: corpusIds.outlines,
            references: corpusIds.references,
            sceneCount: corpusEstimate.sceneCount,
            outlineCount: corpusEstimate.outlineCount,
            referenceCount: corpusEstimate.referenceCount,
            evidenceChars: corpusEstimate.evidenceChars,
            corpusFingerprint: params.manifest.fingerprint,
            corpusOnlyFingerprint: params.manifest.corpusOnlyFingerprint,
            estimate: corpusEstimate,
        },

        estimate: {
            estimatedInputTokens,
            effectiveInputCeiling,
            maxOutputTokens: params.engine.provider !== 'none'
                ? (PROVIDER_MAX_OUTPUT_TOKENS[params.engine.provider] ?? INQUIRY_MAX_OUTPUT_TOKENS)
                : INQUIRY_MAX_OUTPUT_TOKENS,
            expectedPassCount,
            estimationMethod,
            uncertaintyTokens,
            tokenCountFailureMessage,
        },
    };

    return snapshot;
}
