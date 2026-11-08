/*
 * =============================================================================
 * MILESTONE INDICATOR
 * =============================================================================
 *
 * Milestone payload types computed by MilestonesService and carried on the
 * render options. The timeline no longer draws an indicator for them.
 * =============================================================================
 */

export type MilestoneType = 
    | 'stage-zero-complete'
    | 'stage-author-complete'
    | 'stage-house-complete'
    | 'stage-press-complete'
    // Legacy alias retained for compatibility with older milestone payloads
    | 'book-complete'
    | 'staleness-warn'
    | 'staleness-late'
    | 'staleness-stalled';

export interface MilestoneInfo {
    type: MilestoneType;
    stage?: string;
}
