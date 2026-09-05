/*
 * Pure-function computation for the briefing footer button enabled/inert
 * states. The view applies the result to its DOM elements; this module
 * only knows the rules.
 *
 * Rules pinned by characterization in briefingFooterButtonState.test.ts.
 */

export interface BriefingFooterStateInput {
    /** Inquiry is currently in a guidance lockout (blocks all destructive ops). */
    lockout: boolean;
    /** A run is in flight. */
    running: boolean;
    /** Number of sessions in the briefing list. */
    sessionCount: number;
    /** Corpus has user-applied overrides that the Reset button can revert. */
    hasCorpusOverrides: boolean;
    /** Purge scanner reports at least one scene with action items to purge. */
    purgeAvailable: boolean;
}

export interface BriefingFooterButtonState {
    clearDisabled: boolean;
    clearInert: boolean;
    resetDisabled: boolean;
    purgeDisabled: boolean;
    purgeInert: boolean;
}

export function computeBriefingFooterButtonState(input: BriefingFooterStateInput): BriefingFooterButtonState {
    const canClear = input.sessionCount > 0;
    const canPurge = input.purgeAvailable;
    return {
        clearDisabled: input.lockout || input.running || !canClear,
        clearInert: !canClear,
        resetDisabled: input.lockout || input.running || !input.hasCorpusOverrides,
        purgeDisabled: input.lockout || input.running || !canPurge,
        purgeInert: !canPurge,
    };
}
