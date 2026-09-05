/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { describe, it, expect } from 'vitest';
import {
    buildReadinessUiState,
    buildRunScopeLabel,
    buildEnginePayloadSummary,
    resolveEnginePopoverState,
    estimateStructuredPassCount,
    getCurrentPassPlan,
    buildAdvisoryInputKey,
    formatTokenEstimate,
    getTokenTier,
    getTokenTierFromSnapshot,
    INQUIRY_INPUT_TOKENS_AMBER,
    INQUIRY_INPUT_TOKENS_RED,
    type BuildReadinessUiStateInput
} from './inquiryReadinessBuilder';
import type { InquiryEstimateSnapshot } from './inquiryEstimateSnapshot';
import type { InquiryPayloadStats, InquiryReadinessUiState } from '../types';
import type { ResolvedInquiryEngine } from './inquiryModelResolver';
import type { TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<{
    estimatedInputTokens: number;
    effectiveInputCeiling: number;
    maxOutputTokens: number;
    expectedPassCount: number;
    estimationMethod: string;
    uncertaintyTokens: number;
    corpusFingerprint: string;
}>): InquiryEstimateSnapshot {
    return {
        version: 1,
        stateKey: 'test-key',
        computedAt: Date.now(),
        scope: 'book',
        activeBookId: 'book-1',
        resolvedEngine: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            modelLabel: 'Claude Sonnet',
            contextWindow: 200000
        },
        corpus: {
            scenes: [],
            outlines: [],
            references: [],
            sceneCount: 10,
            outlineCount: 1,
            referenceCount: 5,
            evidenceChars: 50000,
            corpusFingerprint: overrides.corpusFingerprint ?? 'fp-test',
            estimate: {
                sceneCount: 10,
                outlineCount: 1,
                referenceCount: 5,
                evidenceChars: 50000,
                estimatedTokens: 12500,
                method: 'rt_cleaned_corpus_exact',
                breakdown: {
                    scenesTokens: 10000,
                    outlineTokens: 1500,
                    referenceTokens: 1000
                }
            }
        },
        estimate: {
            estimatedInputTokens: overrides.estimatedInputTokens ?? 50000,
            effectiveInputCeiling: overrides.effectiveInputCeiling ?? 180000,
            maxOutputTokens: overrides.maxOutputTokens ?? 16384,
            expectedPassCount: overrides.expectedPassCount ?? 1,
            estimationMethod: (overrides.estimationMethod ?? 'heuristic_chars') as TokenEstimateMethod,
            uncertaintyTokens: overrides.uncertaintyTokens ?? 5000
        }
    };
}

function makeEngine(overrides?: Partial<ResolvedInquiryEngine>): ResolvedInquiryEngine {
    return {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        modelAlias: 'sonnet',
        modelLabel: 'Claude Sonnet',
        providerLabel: 'Anthropic',
        hasCredential: true,
        contextWindow: 200000,
        maxOutput: 16384,
        selectionReason: 'test',
        policySource: 'globalPolicy',
        ...overrides
    };
}

function makePayloadStats(overrides?: Partial<InquiryPayloadStats>): InquiryPayloadStats {
    return {
        scope: 'book',
        activeBookId: 'book-1',
        sceneTotal: 10,
        sceneSynopsisUsed: 0,
        sceneSynopsisAvailable: 0,
        sceneFullTextCount: 10,
        bookOutlineCount: 1,
        bookOutlineSummaryCount: 0,
        bookOutlineFullCount: 1,
        sagaOutlineCount: 0,
        sagaOutlineSummaryCount: 0,
        sagaOutlineFullCount: 0,
        referenceCounts: { character: 3, place: 2, power: 0, other: 0, total: 5 },
        referenceByClass: { Character: 3, Place: 2 },
        evidenceChars: 50000,
        resolvedRoots: ['/'],
        manifestFingerprint: 'fp-test',
        ...overrides
    };
}

function makeBaseInput(overrides?: Partial<BuildReadinessUiStateInput>): BuildReadinessUiStateInput {
    return {
        snapshot: makeSnapshot({}),
        scope: 'book',
        scopeLabel: 'Book A',
        resolvedEngine: makeEngine(),
        hasCredential: true,
        payloadStats: makePayloadStats(),
        selectedSceneOverrideCount: 0,
        hasAnyBodyEvidence: true,
        estimateSummaryOnlyTokens: 20000,
        ...overrides
    };
}

function makeReadinessUi(overrides?: Partial<InquiryReadinessUiState>): InquiryReadinessUiState {
    return {
        pending: false,
        readiness: {
            state: 'ready',
            cause: 'ok',
            pressureRatio: 0.3,
            pressureTone: 'normal',
            exceedsBudget: false,
            materiallyExceedsBudget: false
        },
        estimateInputTokens: 50000,
        expectedPassCount: 1,
        estimateMethod: 'heuristic_chars',
        estimateUncertaintyTokens: 5000,
        safeInputBudget: 180000,
        outputBudget: 16384,
        hasEligibleModel: true,
        hasCredential: true,
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        reason: 'Fits safely - single pass.',
        runScopeLabel: 'Run on Book A (Bodies).',
        canSwitchToSummaries: true,
        canUseSelectedScenesOnly: false,
        ...overrides
    };
}

// ── getTokenTier ──────────────────────────────────────────────────────

describe('getTokenTier', () => {
    it('returns normal below amber threshold', () => {
        expect(getTokenTier(50000)).toBe('normal');
    });

    it('returns amber at threshold', () => {
        expect(getTokenTier(INQUIRY_INPUT_TOKENS_AMBER)).toBe('amber');
    });

    it('returns amber between thresholds', () => {
        expect(getTokenTier(120000)).toBe('amber');
    });

    it('returns red at threshold', () => {
        expect(getTokenTier(INQUIRY_INPUT_TOKENS_RED)).toBe('red');
    });

    it('returns red above threshold', () => {
        expect(getTokenTier(200000)).toBe('red');
    });

    it('returns normal for zero', () => {
        expect(getTokenTier(0)).toBe('normal');
    });
});

// ── getTokenTierFromSnapshot ──────────────────────────────────────────

describe('getTokenTierFromSnapshot', () => {
    it('returns normal when snapshot is null', () => {
        expect(getTokenTierFromSnapshot(null)).toBe('normal');
    });

    it('returns tier based on snapshot input tokens', () => {
        expect(getTokenTierFromSnapshot(makeSnapshot({ estimatedInputTokens: 150000 }))).toBe('red');
    });
});

// ── formatTokenEstimate ───────────────────────────────────────────────

describe('formatTokenEstimate', () => {
    it('formats thousands with k suffix', () => {
        expect(formatTokenEstimate(50000)).toBe('50k');
    });

    it('formats fractional thousands', () => {
        expect(formatTokenEstimate(1500)).toBe('1.5k');
    });

    it('formats sub-thousand as integer', () => {
        expect(formatTokenEstimate(500)).toBe('500');
    });

    it('handles zero', () => {
        expect(formatTokenEstimate(0)).toBe('0');
    });

    it('handles NaN gracefully', () => {
        expect(formatTokenEstimate(NaN)).toBe('0');
    });

    it('handles Infinity gracefully', () => {
        expect(formatTokenEstimate(Infinity)).toBe('0');
    });

    it('handles exact 1000', () => {
        expect(formatTokenEstimate(1000)).toBe('1k');
    });
});

// ── resolveEnginePopoverState ─────────────────────────────────────────

describe('resolveEnginePopoverState', () => {
    it('returns ready when readiness state is ready', () => {
        expect(resolveEnginePopoverState(makeReadinessUi())).toBe('ready');
    });

    it('returns multi-pass when large', () => {
        expect(resolveEnginePopoverState(makeReadinessUi({
            readiness: {
                state: 'large',
                cause: 'multi_pass_expected',
                pressureRatio: 1.5,
                pressureTone: 'red',
                exceedsBudget: true,
                materiallyExceedsBudget: true
            }
        }))).toBe('multi-pass');
    });

    it('returns exceeds when blocked', () => {
        expect(resolveEnginePopoverState(makeReadinessUi({
            readiness: {
                state: 'blocked',
                cause: 'missing_key',
                pressureRatio: Infinity,
                pressureTone: 'red',
                exceedsBudget: true,
                materiallyExceedsBudget: true
            }
        }))).toBe('exceeds');
    });
});

// ── estimateStructuredPassCount ────────────────────────────────────────

describe('estimateStructuredPassCount', () => {
    it('returns 1 when expectedPassCount is zero', () => {
        expect(estimateStructuredPassCount(makeReadinessUi({
            expectedPassCount: 0
        }))).toBe(1);
    });

    it('returns 1 when expectedPassCount is negative', () => {
        expect(estimateStructuredPassCount(makeReadinessUi({
            expectedPassCount: -1
        }))).toBe(1);
    });

    it('passes through expectedPassCount from snapshot', () => {
        expect(estimateStructuredPassCount(makeReadinessUi({
            expectedPassCount: 3
        }))).toBe(3);
    });

    it('floors fractional expectedPassCount', () => {
        expect(estimateStructuredPassCount(makeReadinessUi({
            expectedPassCount: 2.7
        }))).toBe(2);
    });

    it('returns 1 for NaN expectedPassCount', () => {
        expect(estimateStructuredPassCount(makeReadinessUi({
            expectedPassCount: NaN
        }))).toBe(1);
    });
});

// ── getCurrentPassPlan ────────────────────────────────────────────────

describe('getCurrentPassPlan', () => {
    it('returns single-pass plan when not exceeding budget', () => {
        const plan = getCurrentPassPlan(makeReadinessUi(), null);
        expect(plan.multiPassExpected).toBe(false);
        expect(plan.displayPassCount).toBe(1);
    });

    it('returns multi-pass plan when exceeding budget', () => {
        const plan = getCurrentPassPlan(makeReadinessUi({
            readiness: {
                state: 'large',
                cause: 'multi_pass_expected',
                pressureRatio: 1.5,
                pressureTone: 'red',
                exceedsBudget: true,
                materiallyExceedsBudget: true
            },
            estimateInputTokens: 200000,
            expectedPassCount: 4,
            safeInputBudget: 100000
        }), null);
        expect(plan.multiPassExpected).toBe(true);
        expect(plan.estimatedPassCount).toBe(4);
        expect(plan.displayPassCount).toBe(4);
    });

    it('uses recent exact count when available', () => {
        const plan = getCurrentPassPlan(
            makeReadinessUi({
                readiness: {
                    state: 'large',
                    cause: 'multi_pass_expected',
                    pressureRatio: 2.5,
                    pressureTone: 'red',
                    exceedsBudget: true,
                    materiallyExceedsBudget: true
                },
                estimateInputTokens: 300000,
                safeInputBudget: 100000
            }),
            { executionPassCount: 4, multiPassTriggerReason: 'context_overflow' } as any
        );
        expect(plan.recentExactPassCount).toBe(4);
        expect(plan.displayPassCount).toBe(4);
        expect(plan.multiPassTriggerReason).toBe('context_overflow');
    });

    it('ignores executionPassCount of 1', () => {
        const plan = getCurrentPassPlan(
            makeReadinessUi({
                readiness: {
                    state: 'large',
                    cause: 'multi_pass_expected',
                    pressureRatio: 1.5,
                    pressureTone: 'red',
                    exceedsBudget: true,
                    materiallyExceedsBudget: true
                },
                estimateInputTokens: 150000,
                safeInputBudget: 100000
            }),
            { executionPassCount: 1 } as any
        );
        expect(plan.recentExactPassCount).toBeNull();
    });
});

// ── buildRunScopeLabel ────────────────────────────────────────────────

describe('buildRunScopeLabel', () => {
    it('shows scene selection when subset selected', () => {
        const label = buildRunScopeLabel(makePayloadStats(), 3, 'book', 'Book A');
        expect(label).toBe('Run on 3 scenes (Full Scenes).');
    });

    it('shows full book with bodies', () => {
        const label = buildRunScopeLabel(makePayloadStats(), 0, 'book', 'Book A');
        expect(label).toContain('Book A');
        expect(label).toContain('Full Scenes');
    });

    it('shows summaries when only summaries used', () => {
        const label = buildRunScopeLabel(
            makePayloadStats({ sceneFullTextCount: 0, sceneSynopsisUsed: 5 }),
            0, 'book', 'Book A'
        );
        expect(label).toContain('Summaries');
    });

    it('shows saga scope label', () => {
        const label = buildRunScopeLabel(makePayloadStats(), 0, 'saga', 'My Saga');
        expect(label).toContain('Saga My Saga');
    });

    it('includes outline info when outlines present', () => {
        const label = buildRunScopeLabel(makePayloadStats(), 0, 'book', 'Book A');
        expect(label).toContain('Outline');
    });
});

// ── buildEnginePayloadSummary ─────────────────────────────────────────

describe('buildEnginePayloadSummary', () => {
    it('returns estimating text when no payload stats', () => {
        const result = buildEnginePayloadSummary({ payloadStats: null, scope: 'book', scopeLabel: 'Book A' });
        expect(result.text).toContain('Estimating');
        expect(result.inputTokens).toBe(0);
        expect(result.tier).toBe('normal');
    });

    it('returns token summary from payload stats', () => {
        const result = buildEnginePayloadSummary({
            payloadStats: makePayloadStats({ evidenceChars: 200000 }),
            scope: 'book',
            scopeLabel: 'Book A'
        });
        expect(result.text).toContain('50k');
        expect(result.text).toContain('Book');
        expect(result.inputTokens).toBe(50000);
        expect(result.tier).toBe('normal');
    });

    it('uses saga label for saga scope', () => {
        const result = buildEnginePayloadSummary({
            payloadStats: makePayloadStats(),
            scope: 'saga',
            scopeLabel: 'My Saga'
        });
        expect(result.text).toContain('Saga My Saga');
    });
});

// ── buildAdvisoryInputKey ─────────────────────────────────────────────

describe('buildAdvisoryInputKey', () => {
    it('produces stable key for identical inputs', () => {
        const params = {
            scope: 'book' as const,
            scopeLabel: 'Book A',
            provider: 'anthropic' as const,
            modelId: 'claude-sonnet-4-20250514',
            estimatedInputTokens: 50000,
            estimateMethod: 'heuristic_chars' as const,
            estimateUncertaintyTokens: 5000,
            corpusFingerprint: 'fp-test',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
            corpusFingerprintReused: false
        };
        expect(buildAdvisoryInputKey(params)).toBe(buildAdvisoryInputKey({ ...params }));
    });

    it('changes when provider changes', () => {
        const base = {
            scope: 'book' as const,
            scopeLabel: 'Book A',
            provider: 'anthropic' as const,
            modelId: 'claude-sonnet-4-20250514',
            estimatedInputTokens: 50000,
            estimateMethod: 'heuristic_chars' as const,
            estimateUncertaintyTokens: 5000,
            corpusFingerprint: 'fp-test',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
            corpusFingerprintReused: false
        };
        const key1 = buildAdvisoryInputKey(base);
        const key2 = buildAdvisoryInputKey({ ...base, provider: 'openai' as const });
        expect(key1).not.toBe(key2);
    });

    it('quantizes token estimates to nearest 5000', () => {
        const base = {
            scope: 'book' as const,
            scopeLabel: 'Book A',
            provider: 'anthropic' as const,
            modelId: 'claude-sonnet-4-20250514',
            estimatedInputTokens: 50001,
            estimateMethod: 'heuristic_chars' as const,
            estimateUncertaintyTokens: 5000,
            corpusFingerprint: 'fp-test',
            overrideSummary: { active: false, classCount: 0, itemCount: 0, total: 0 },
            corpusFingerprintReused: false
        };
        // 50001 and 52499 both round to 50000
        const key1 = buildAdvisoryInputKey(base);
        const key2 = buildAdvisoryInputKey({ ...base, estimatedInputTokens: 52499 });
        expect(key1).toBe(key2);
    });
});

// ── buildReadinessUiState ─────────────────────────────────────────────

describe('buildReadinessUiState', () => {
    it('returns pending state when snapshot is null', () => {
        const result = buildReadinessUiState(makeBaseInput({ snapshot: null }));
        expect(result.pending).toBe(true);
        expect(result.estimateInputTokens).toBe(0);
        expect(result.reason).toBe('Estimating…');
    });

    it('returns ready state for normal payload', () => {
        const result = buildReadinessUiState(makeBaseInput());
        expect(result.pending).toBe(false);
        expect(result.readiness.state).toBe('ready');
        expect(result.hasEligibleModel).toBe(true);
    });

    it('preserves provider-counted estimate metadata from the snapshot', () => {
        const result = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({
                estimatedInputTokens: 64000,
                estimationMethod: 'anthropic_count',
                uncertaintyTokens: 256
            })
        }));
        expect(result.estimateInputTokens).toBe(64000);
        expect(result.estimateMethod).toBe('anthropic_count');
        expect(result.estimateUncertaintyTokens).toBe(256);
    });

    it('returns blocked state when credential missing', () => {
        const result = buildReadinessUiState(makeBaseInput({ hasCredential: false }));
        expect(result.readiness.cause).toBe('missing_key');
        expect(result.reason).toContain('key is missing');
    });

    it('returns large state when exceeding budget', () => {
        const result = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({ estimatedInputTokens: 300000, effectiveInputCeiling: 180000 })
        }));
        expect(result.readiness.state).toBe('large');
        expect(result.readiness.cause).toBe('multi_pass_expected');
    });

    it('sets canSwitchToSummaries when body evidence exists and summaries fit', () => {
        const result = buildReadinessUiState(makeBaseInput({
            hasAnyBodyEvidence: true,
            estimateSummaryOnlyTokens: 50000
        }));
        expect(result.canSwitchToSummaries).toBe(true);
    });

    it('canSwitchToSummaries false when no body evidence', () => {
        const result = buildReadinessUiState(makeBaseInput({
            hasAnyBodyEvidence: false
        }));
        expect(result.canSwitchToSummaries).toBe(false);
    });

    it('sets canUseSelectedScenesOnly when scene overrides present', () => {
        const result = buildReadinessUiState(makeBaseInput({
            selectedSceneOverrideCount: 3
        }));
        expect(result.canUseSelectedScenesOnly).toBe(true);
    });

    it('canUseSelectedScenesOnly false in saga scope', () => {
        const result = buildReadinessUiState(makeBaseInput({
            scope: 'saga',
            selectedSceneOverrideCount: 3
        }));
        expect(result.canUseSelectedScenesOnly).toBe(false);
    });

    it('includes run scope label', () => {
        const result = buildReadinessUiState(makeBaseInput());
        expect(result.runScopeLabel).toContain('Book A');
    });
});

// ── Pressure gauge data flow ─────────────────────────────────────────
// Simulates the exact data path that feeds the minimap pressure bar:
//   snapshot → buildReadinessUiState → pressureRatio → fillRatio → bar width

describe('pressure gauge data flow', () => {
    /** Replicate the minimap renderer's clamping logic. */
    function computeFillRatio(readinessUi: InquiryReadinessUiState): number {
        const ratio = Math.max(0, readinessUi.readiness.pressureRatio);
        return Math.min(ratio, 1);
    }

    it('produces non-zero fillRatio for a normal book corpus', () => {
        const ui = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({ estimatedInputTokens: 50000, effectiveInputCeiling: 180000 })
        }));
        expect(ui.pending).toBe(false);
        expect(ui.safeInputBudget).toBeGreaterThan(0);
        expect(ui.estimateInputTokens).toBeGreaterThan(0);
        expect(ui.readiness.pressureRatio).toBeGreaterThan(0);
        expect(ui.readiness.pressureRatio).toBeLessThan(1);
        const fill = computeFillRatio(ui);
        expect(fill).toBeGreaterThan(0);
        expect(fill).toBeLessThan(1);
    });

    it('produces fillRatio of 1 when over budget', () => {
        const ui = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({ estimatedInputTokens: 300000, effectiveInputCeiling: 180000 })
        }));
        expect(ui.readiness.pressureRatio).toBeGreaterThan(1);
        expect(computeFillRatio(ui)).toBe(1);
    });

    it('produces fillRatio of 1 when effectiveInputCeiling is 0 (no fallback to model caps)', () => {
        const ui = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({ estimatedInputTokens: 50000, effectiveInputCeiling: 0 })
        }));
        // Per RT Doctrine: no computeCaps fallback. effectiveInputCeiling = 0 means
        // safeInputBudget = 0, pressureRatio = Infinity, clamped to 1.
        expect(ui.safeInputBudget).toBe(0);
        expect(ui.readiness.pressureRatio).toBe(Number.POSITIVE_INFINITY);
        expect(computeFillRatio(ui)).toBe(1);
    });

    it('pending state produces zero fill (gauge should reset)', () => {
        const ui = buildReadinessUiState(makeBaseInput({ snapshot: null }));
        expect(ui.pending).toBe(true);
        // When pending, InquiryView resets the gauge — it does NOT call updatePressureGauge.
        // pressureRatio from pending state should be safe to check but won't be used.
        expect(ui.estimateInputTokens).toBe(0);
    });

    it('blocked state (missing key) still has renderable pressure data', () => {
        const ui = buildReadinessUiState(makeBaseInput({
            hasCredential: false,
            snapshot: makeSnapshot({ estimatedInputTokens: 50000, effectiveInputCeiling: 180000 })
        }));
        expect(ui.readiness.state).toBe('blocked');
        expect(ui.readiness.cause).toBe('missing_key');
        // Even blocked state should have valid pressure ratio for the bar
        expect(ui.readiness.pressureRatio).toBeGreaterThan(0);
        expect(Number.isFinite(ui.readiness.pressureRatio)).toBe(true);
        expect(computeFillRatio(ui)).toBeGreaterThan(0);
    });

    it('pass plan uses exceedsBudget for multi-pass expectation', () => {
        const ui = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({ estimatedInputTokens: 300000, effectiveInputCeiling: 180000, expectedPassCount: 3 })
        }));
        const plan = getCurrentPassPlan(ui, null);
        expect(plan.multiPassExpected).toBe(true);
        expect(plan.displayPassCount).toBeGreaterThan(1);
    });

    it('pass plan returns single pass when within budget', () => {
        const ui = buildReadinessUiState(makeBaseInput({
            snapshot: makeSnapshot({ estimatedInputTokens: 50000, effectiveInputCeiling: 180000 })
        }));
        const plan = getCurrentPassPlan(ui, null);
        expect(plan.multiPassExpected).toBe(false);
        expect(plan.displayPassCount).toBe(1);
    });
});
