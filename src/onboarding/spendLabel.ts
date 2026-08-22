/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Spend-label decision logic, extracted from OnboardingModal so it can be
 * tested.
 *
 * It lived inside the modal, where nothing could reach it, and two rounds of
 * external review found lifecycle defects there that a 3,000-test suite could
 * not catch — a resumed session silently lost its price, and the pre-split
 * figure persisted after the scene count arrived. Both were decisions, not
 * rendering. Decisions belong somewhere testable.
 *
 * The rendering half stays in the modal; this returns what to say, not how.
 */

export interface SpendLabelState {
    /** False in structure-only mode — no AI runs, so no spend to report. */
    aiAvailable: boolean;
    engine: 'local' | 'cloud';
    /** Null whenever cloud pricing identity is unknown (e.g. not yet resolved). */
    costProvider: string | null;
    costModelId: string | null;
    manuscriptChars: number;
    /** Null until the split reports how many scenes the run will create. */
    forecastSceneCount: number | null;
}

export type SpendLabel =
    | { kind: 'hidden' }
    | { kind: 'free'; text: string; ariaLabel: string }
    | { kind: 'floor'; text: string; ariaLabel: string }
    | { kind: 'estimate'; text: string; ariaLabel: string };

/**
 * Decide what the pill should say.
 *
 * `priceFor` is injected so this stays pure and the cost path can be exercised
 * without provider pricing tables. It returns null when pricing genuinely
 * cannot be resolved — which must render NOTHING rather than a zero, because a
 * zero reads as "free" and free is the most expensive thing this UI could
 * wrongly imply.
 */
export function resolveSpendLabel(
    state: SpendLabelState,
    priceFor: (sceneCount: number) => number | null,
    formatUsd: (value: number) => string
): SpendLabel {
    if (!state.aiAvailable) return { kind: 'hidden' };

    if (state.engine === 'local') {
        return {
            kind: 'free',
            text: 'Free · local model',
            ariaLabel: 'Estimated cost: free, this run uses your local model'
        };
    }

    // Cloud without a resolved model or without a measured manuscript cannot be
    // priced. Say nothing.
    if (!state.costProvider || !state.costModelId || state.manuscriptChars <= 0) {
        return { kind: 'hidden' };
    }

    if (state.forecastSceneCount !== null) {
        const exact = priceFor(state.forecastSceneCount);
        if (exact === null) return { kind: 'hidden' };
        return {
            kind: 'estimate',
            text: `Est. ${formatUsd(exact)}`,
            ariaLabel: `Estimated cost for this run: ${formatUsd(exact)}`
        };
    }

    // Pre-split: a chapter can hold any number of scenes, so there is no honest
    // ceiling to quote. One scene per chapter is a true lower bound.
    const floor = priceFor(1);
    if (floor === null) return { kind: 'hidden' };
    return {
        kind: 'floor',
        text: `Est. from ${formatUsd(floor)}`,
        ariaLabel: `Estimated cost for this run: from ${formatUsd(floor)}. The figure narrows once scenes are confirmed.`
    };
}
