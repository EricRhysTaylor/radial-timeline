/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Shared type definitions for the Inquiry subsystem.
 *
 * These types are used by InquiryView and the extracted service/builder modules.
 * Keeping them in a shared file avoids circular imports.
 */

import type { InquiryScope } from './state';
import type { InquiryReadinessResult } from './services/readiness';
import type { TokenEstimateMethod } from '../ai/tokens/inputTokenEstimate';
import type { AIProviderId, ModelInfo, RTCorpusTokenEstimate } from '../ai/types';
import type { CorpusManifestEntry } from './runner/types';

// ── Token tier ────────────────────────────────────────────────────────

export type TokenTier = 'normal' | 'amber' | 'red';

// ── Payload stats ─────────────────────────────────────────────────────

export type InquiryPayloadStats = {
    scope: InquiryScope;
    activeBookId?: string;
    sceneTotal: number;
    sceneSynopsisUsed: number;
    sceneSynopsisAvailable: number;
    sceneFullTextCount: number;
    sceneChars?: number;
    bookOutlineCount: number;
    bookOutlineSummaryCount: number;
    bookOutlineFullCount: number;
    sagaOutlineCount: number;
    sagaOutlineSummaryCount: number;
    sagaOutlineFullCount: number;
    outlineChars?: number;
    referenceCounts: { character: number; place: number; power: number; other: number; total: number };
    referenceByClass: Record<string, number>;
    referenceChars?: number;
    evidenceChars: number;
    resolvedRoots: string[];
    manifestFingerprint: string;
};

export type InquiryCurrentCorpusContext = {
    scope: InquiryScope;
    activeBookId?: string;
    scopeLabel: string;
    corpusFingerprint: string;
    cacheReuseFingerprint: string;
    corpus: RTCorpusTokenEstimate;
    /**
     * @internal Raw transport field — DO NOT gate UI labels on
     * `requestTokens > 0` directly. Always pair with `requestEstimateMethod`
     * (or convert via `tokenEstimateFromMethod` in `src/ai/estimates/`)
     * so that a `0` from a failed provider count cannot be confused with
     * "actually zero." UI surfaces must surface provenance to the user.
     * See doctrine in `src/ai/estimates/tokenEstimate.ts`.
     */
    requestTokens: number;
    /**
     * The provenance-bearing companion to `requestTokens`. When this is
     * `'unavailable'` the count call failed; when `undefined` the snapshot
     * is still building. UIs MUST inspect this before reading
     * `requestTokens`.
     */
    requestEstimateMethod?: TokenEstimateMethod;
    /**
     * When `requestEstimateMethod === 'unavailable'`, the actual provider
     * error message (e.g. "Gemini countTokens failed for
     * 'gemini-3.5-flash' — NOT_FOUND (HTTP 404): Model not found"). UI
     * tooltips should show this so the user understands *why* the count
     * failed without needing to open the dev console (which Obsidian
     * plugins are not supposed to write to anyway).
     */
    requestEstimateFailureMessage?: string;
    expectedPassCount: number;
    safeInputBudget: number;
    manifestEntries: CorpusManifestEntry[];
};

// ── Readiness UI state ────────────────────────────────────────────────

export type InquiryReadinessUiState = {
    pending: boolean;
    readiness: InquiryReadinessResult;
    /**
     * Token count used for pressure / minimap / advisory math. When the
     * provider count succeeded this is the provider number. When it
     * failed (e.g. Gemini countTokens unavailable), this falls back to
     * the deterministic local corpus chars/4 so the pressure bar never
     * disappears. The companion `estimateInputTokensSource` discloses
     * which.
     */
    estimateInputTokens: number;
    /**
     * Provenance of `estimateInputTokens`. Consumers must inspect this
     * before treating the number as authoritative provider truth.
     */
    estimateInputTokensSource: 'provider_count' | 'local_estimate' | 'unavailable';
    expectedPassCount: number;
    estimateMethod: TokenEstimateMethod;
    estimateUncertaintyTokens: number;
    safeInputBudget: number;
    outputBudget: number;
    hasEligibleModel: boolean;
    hasCredential: boolean;
    provider: AIProviderId;
    providerLabel: string;
    reason: string;
    model?: ModelInfo;
    runScopeLabel: string;
    canSwitchToSummaries: boolean;
    canUseSelectedScenesOnly: boolean;
};

// ── Engine popover state ──────────────────────────────────────────────

export type InquiryEnginePopoverState = 'ready' | 'multi-pass' | 'exceeds';

// ── Pass plan result ──────────────────────────────────────────────────

export type PassPlanResult = {
    multiPassExpected: boolean;
    estimatedPassCount: number | null;
    recentExactPassCount: number | null;
    displayPassCount: number;
    multiPassTriggerReason: string | null;
};
