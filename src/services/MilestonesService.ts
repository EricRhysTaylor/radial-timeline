import type RadialTimelinePlugin from '../main';
import { TimelineItem } from '../types/timeline';
import { buildProgressSnapshot } from '../progress/progressSnapshot';
import type { MilestoneInfo } from '../renderer/components/MilestoneIndicator';

/**
 * Milestones Service - Single source of truth for stage completion milestones.
 * 
 * MILESTONES SYSTEM (this service):
 * - Detects when stages are COMPLETELY done (all scenes at that stage complete)
 * - Shows celebration hero cards in settings (ProgressSection)
 * - Shows pulsing indicator on timeline (above Help icon)
 * - Detects staleness warnings (author getting behind)
 * 
 * Used by:
 * - ProgressSection (Progress Tracker in settings - hero cards with quotes)
 * - Timeline indicator (pulsing icon above Help icon, bottom-right)
 * 
 * SEPARATE FROM: TimelineMetricsService (estimation/tick tracking system)
 * - TimelineMetricsService: Progress tracking, completion estimates, target dates
 * - Shows tick marks on timeline, calculates pace, estimates completion dates
 * - Much more nuanced - tracks progress through stages, not just completions
 * 
 * Keep these systems separate - they serve different purposes:
 * - Milestones: Celebration & encouragement (binary: stage done or not)
 * - Estimation: Progress tracking & planning (continuous: pace, dates, remaining)
 */
export class MilestonesService {
    constructor(private plugin: RadialTimelinePlugin) {}

    /**
     * Detect milestones for celebration or encouragement.
     * 
     * Milestone detection logic:
     * 1. Build the shared progress snapshot.
     * 2. Find the highest stage every scene has cleared.
     *    A scene clears a stage when it is complete at that stage or promoted above it.
     * 3. If any stage is cleared → celebrate that stage completion (Zero/Author/House/Press)
     * 4. If no completion → check for staleness warnings (author getting behind)
     * 
     * Priority: Book complete > Stage complete > Staleness encouragement
     * 
     * Note: This is binary detection (stage done or not), not continuous progress tracking.
     * For progress tracking, see TimelineMetricsService.calculateCompletionEstimate()
     */
    public detectMilestone(scenes: TimelineItem[]): MilestoneInfo | null {
        const snapshot = buildProgressSnapshot(scenes);
        if (snapshot.totalScenes === 0) return null;

        const completedStage = snapshot.highestCompletedStage;

        if (completedStage) {
            // Stage is completely done → show celebration milestone
            // This syncs with the hero cards in ProgressSection (Zero/Author/House/Press complete)
            if (completedStage === 'Press') {
                // Final celebration state (not a publish stage): all Press scenes complete = book complete.
                return { type: 'book-complete', stage: completedStage };
            } else if (completedStage === 'House') {
                return { type: 'stage-house-complete', stage: completedStage };
            } else if (completedStage === 'Author') {
                return { type: 'stage-author-complete', stage: completedStage };
            } else if (completedStage === 'Zero') {
                return { type: 'stage-zero-complete', stage: completedStage };
            }
        }

        // STEP 2: Check for staleness warnings (author getting behind)
        // This also syncs with ProgressSection which shows warn/late/stalled styling
        try {
            const estimate = this.plugin.calculateCompletionEstimate(scenes);
            if (estimate && estimate.staleness !== 'fresh') {
                if (estimate.staleness === 'stalled') {
                    return { type: 'staleness-stalled' };
                } else if (estimate.staleness === 'late') {
                    return { type: 'staleness-late' };
                } else if (estimate.staleness === 'warn') {
                    return { type: 'staleness-warn' };
                }
            }
        } catch {
            // Estimate calculation failed - skip staleness check
        }

        return null;
    }
}
