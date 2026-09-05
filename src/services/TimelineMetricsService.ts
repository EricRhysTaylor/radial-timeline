import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import { isSceneItem } from '../utils/sceneHelpers';
import { STAGE_ORDER } from '../utils/constants';
import { parseSceneTitle } from '../utils/text';
import { isCompleteStatus, normalizePublishStage } from '../progress/progressSnapshot';

const COMPLETION_ESTIMATE_WINDOW_DAYS = 30;

export interface CompletionEstimate {
    date: Date | null;
    total: number;
    remaining: number;
    rate: number;
    stage: string;
    staleness: 'fresh' | 'warn' | 'late' | 'stalled';
    lastProgressDate: Date | null;
    windowDays: number;
    labelText?: string;
    isFrozen?: boolean;
    /** Number of incomplete scenes in stages lower than the active stage */
    stragglerCount?: number;
}

/**
 * Timeline Metrics Service - Estimation and tick tracking system.
 * 
 * ESTIMATION/TICK TRACKING SYSTEM (this service):
 * - Calculates completion estimates based on pace (scenes per week)
 * - Tracks progress through stages (continuous, not binary)
 * - Shows tick marks on timeline with target dates
 * - Calculates staleness (warn/late/stalled) for pace tracking
 * - Much more nuanced - tracks continuous progress, not just completions
 * 
 * Used by:
 * - Timeline tick marks (target date ticks, estimation ticks)
 * - Completion estimate calculations
 * - Pace tracking and remaining scene counts
 * 
 * SEPARATE FROM: MilestonesService (stage completion milestones)
 * - MilestonesService: Binary detection (stage done or not)
 * - Shows hero cards in settings, pulsing indicator on timeline
 * - Celebration & encouragement, not progress tracking
 * 
 * Keep these systems separate - they serve different purposes:
 * - Estimation: Progress tracking & planning (continuous: pace, dates, remaining)
 * - Milestones: Celebration & encouragement (binary: stage done or not)
 */
export class TimelineMetricsService {
    private lastFreshEstimate: CompletionEstimate | null = null;

    constructor(private plugin: RadialTimelinePlugin) {}

    calculateCompletionEstimate(scenes: TimelineItem[]): CompletionEstimate | null {
        const sceneNotesOnly = scenes.filter(isSceneItem);
        if (sceneNotesOnly.length === 0) return null;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTime = today.getTime();
        const windowDays = COMPLETION_ESTIMATE_WINDOW_DAYS;
        const windowStartTime = todayTime - windowDays * 24 * 60 * 60 * 1000;

        const normalizeStage = (raw: unknown): (typeof STAGE_ORDER)[number] => {
            return normalizePublishStage(raw);
        };

        const isCompleted = (status: TimelineItem['status']): boolean => {
            return isCompleteStatus(status);
        };

        // Count recent completions per stage within the rolling window to detect active working stage
        const recentCompletionsByStage: Record<string, number> = {};
        for (const stage of STAGE_ORDER) {
            recentCompletionsByStage[stage] = 0;
        }
        
        sceneNotesOnly.forEach(scene => {
            if (!isCompleted(scene.status)) return;
            const dueStr = scene.due;
            if (!dueStr) return;
            try {
                const dueDate = new Date(dueStr + 'T00:00:00');
                dueDate.setHours(0, 0, 0, 0);
                const dueTime = dueDate.getTime();
                if (isNaN(dueTime)) return;
                if (dueTime >= windowStartTime && dueTime <= todayTime) {
                    const stage = normalizeStage(scene['Publish Stage']);
                    recentCompletionsByStage[stage]++;
                }
            } catch {
                // ignore parse errors
            }
        });

        // Determine active stage: prefer stage with most recent completions,
        // fall back to highest stage with incomplete work
        let activeStage: (typeof STAGE_ORDER)[number] = 'Zero';
        let maxRecentCompletions = 0;
        
        // Check stages from highest to lowest for recent activity
        for (const stage of [...STAGE_ORDER].reverse()) {
            if (recentCompletionsByStage[stage] > maxRecentCompletions) {
                maxRecentCompletions = recentCompletionsByStage[stage];
                activeStage = stage;
            }
        }
        
        // If no recent completions, fall back to highest stage with incomplete work
        if (maxRecentCompletions === 0) {
            const stageWithIncomplete = [...STAGE_ORDER].reverse().find(stage =>
                sceneNotesOnly.some(scene => normalizeStage(scene['Publish Stage']) === stage && !isCompleted(scene.status))
            );
            const stageWithAnyScenes = [...STAGE_ORDER].reverse().find(stage =>
                sceneNotesOnly.some(scene => normalizeStage(scene['Publish Stage']) === stage)
            );
            activeStage = stageWithIncomplete ?? stageWithAnyScenes ?? 'Zero';
        }
        
        const activeStageIndex = STAGE_ORDER.indexOf(activeStage);
        
        // Count scenes at active stage (for display purposes)
        const stageScenes = sceneNotesOnly.filter(scene => normalizeStage(scene['Publish Stage']) === activeStage);
        if (stageScenes.length === 0 && maxRecentCompletions === 0) return null;

        // Compute highest scene number across all scenes (any stage) as a floor for total count
        const seenForMax = new Set<string>();
        let highestPrefixNumber = 0;
        sceneNotesOnly.forEach(scene => {
            if (!scene.path || seenForMax.has(scene.path)) return;
            seenForMax.add(scene.path);
            const { number } = parseSceneTitle(scene.title || '', scene.number);
            if (number) {
                const n = parseFloat(String(number));
                if (!isNaN(n)) {
                    highestPrefixNumber = Math.max(highestPrefixNumber, n);
                }
            }
        });

        // Count remaining work for the active stage revision round
        // Remaining includes:
        //   1. Scenes AT active stage that are NOT complete (being worked on)
        //   2. Scenes at LOWER stages that ARE complete (waiting to be promoted and revised)
        // Stragglers are scenes at lower stages that are NOT complete (haven't finished their stage)
        
        const processedPaths = new Set<string>();
        let incompleteAtActiveStage = 0;
        let completedAtLowerStages = 0; // These are PENDING work for active stage
        let stragglerCount = 0; // incomplete scenes in stages LOWER than active (not ready yet)
        
        const currentStatusCounts: Record<string, number> = {};
        
        sceneNotesOnly.forEach(scene => {
            if (!scene.path || processedPaths.has(scene.path)) return;
            processedPaths.add(scene.path);
            
            const sceneStage = normalizeStage(scene['Publish Stage']);
            const sceneStageIndex = STAGE_ORDER.indexOf(sceneStage);
            const normalizedStatus = scene.status?.toString().trim().toLowerCase() || 'todo';
            const isSceneComplete = normalizedStatus === 'complete' || normalizedStatus === 'done' || normalizedStatus === 'completed';
            
            // Only count scenes at active stage or lower for this revision round
            if (sceneStageIndex > activeStageIndex) {
                // Scene is at a HIGHER stage than active - already past this revision round
                // These count as truly complete for our estimate
                if (isSceneComplete) {
                    currentStatusCounts['Completed'] = (currentStatusCounts['Completed'] || 0) + 1;
                }
                return;
            }
            
            if (sceneStageIndex === activeStageIndex) {
                // Scene is AT the active stage
                if (isSceneComplete) {
                    currentStatusCounts['Completed'] = (currentStatusCounts['Completed'] || 0) + 1;
                } else {
                    incompleteAtActiveStage++;
                    if (scene.due) {
                        try {
                            const dueDate = new Date(scene.due + 'T00:00:00');
                            if (!isNaN(dueDate.getTime()) && dueDate.getTime() < todayTime) {
                                currentStatusCounts['Due'] = (currentStatusCounts['Due'] || 0) + 1;
                            } else {
                                currentStatusCounts[normalizedStatus] = (currentStatusCounts[normalizedStatus] || 0) + 1;
                            }
                        } catch {
                            currentStatusCounts[normalizedStatus] = (currentStatusCounts[normalizedStatus] || 0) + 1;
                        }
                    } else {
                        currentStatusCounts[normalizedStatus] = (currentStatusCounts[normalizedStatus] || 0) + 1;
                    }
                }
            } else {
                // Scene is at a LOWER stage than active
                if (isSceneComplete) {
                    // Complete at lower stage = waiting to be promoted to active stage
                    // This is PENDING work for the active stage revision round
                    completedAtLowerStages++;
                    // Don't count as "Completed" for status display - it's pending
                } else {
                    // Incomplete at lower stage = straggler (hasn't finished that stage yet)
                    stragglerCount++;
                    currentStatusCounts[normalizedStatus] = (currentStatusCounts[normalizedStatus] || 0) + 1;
                }
            }
        });

        this.plugin.latestStatusCounts = currentStatusCounts;

        const totalScenesDeduped = processedPaths.size;
        const totalForEstimate = Math.max(totalScenesDeduped, Math.floor(highestPrefixNumber));
        
        // Remaining = incomplete at active stage + complete at lower stages (pending promotion)
        // Plus stragglers (incomplete at lower stages - will eventually need to be done too)
        const remainingScenes = incompleteAtActiveStage + completedAtLowerStages + stragglerCount;

        if (remainingScenes <= 0) {
            this.captureLatestStats(totalForEstimate, 0, 0);
            return null;
        }

        // Count completions across ALL stages within the rolling window (not just active stage)
        // This way, completing scenes in any stage contributes to the pace calculation
        const completedPathsWindow = new Set<string>();
        let completedWindow = 0;
        let lastProgressDate: Date | null = null;

        sceneNotesOnly.forEach(scene => {
            const scenePath = scene.path;
            if (!scenePath) return;
            if (!isCompleted(scene.status)) return;

            const dueStr = scene.due;
            if (!dueStr) return;

            try {
                const dueDate = new Date(dueStr + 'T00:00:00');
                dueDate.setHours(0, 0, 0, 0);
                const dueTime = dueDate.getTime();
                if (isNaN(dueTime)) return;

                if (!lastProgressDate || dueTime > lastProgressDate.getTime()) {
                    lastProgressDate = new Date(dueTime);
                }

                if (dueTime >= windowStartTime && dueTime <= todayTime) {
                    if (!completedPathsWindow.has(scenePath)) {
                        completedPathsWindow.add(scenePath);
                        completedWindow++;
                    }
                }
            } catch {
                // ignore parse errors
            }
        });

        const hasEnoughSamples = completedWindow >= 2; // require at least 2 completions for a confident pace
        const rawScenesPerDay = completedWindow > 0 ? (completedWindow / windowDays) : 0;
        const scenesPerDay = rawScenesPerDay; // still use raw pace for geometry placement
        const scenesPerWeek = scenesPerDay * 7;
        const daysNeeded = scenesPerDay > 0 ? remainingScenes / scenesPerDay : Number.POSITIVE_INFINITY;
        const estimatedDate = Number.isFinite(daysNeeded) && daysNeeded >= 0
            ? new Date(today.getTime() + Math.ceil(daysNeeded) * 24 * 60 * 60 * 1000)
            : null;

        const staleness = this.classifyStaleness(lastProgressDate, today);
        const labelText = (staleness === 'stalled' || !estimatedDate || !hasEnoughSamples) ? '?' : undefined;

        const result: CompletionEstimate = {
            date: estimatedDate,
            total: totalForEstimate,
            remaining: remainingScenes,
            rate: parseFloat(scenesPerWeek.toFixed(1)),
            stage: activeStage,
            staleness,
            lastProgressDate,
            windowDays,
            labelText,
            isFrozen: false,
            stragglerCount: stragglerCount > 0 ? stragglerCount : undefined
        };

        // Freeze to last fresh estimate if we have no valid rate/date but we had one before
        if (!estimatedDate || scenesPerDay <= 0 || !Number.isFinite(daysNeeded)) {
            const frozen = this.freezeToLastEstimate(activeStage, lastProgressDate, windowDays, stragglerCount);
            this.captureLatestStats(totalForEstimate, remainingScenes, scenesPerWeek);
            return frozen;
        }

        // Store as last fresh estimate for morale-friendly freezing
        this.lastFreshEstimate = { ...result, isFrozen: false, labelText: undefined };
        this.captureLatestStats(totalForEstimate, remainingScenes, scenesPerWeek);
        return result;
    }

    private captureLatestStats(total: number, remaining: number, rate: number): void {
        this.plugin.latestTotalScenes = total;
        this.plugin.latestRemainingScenes = remaining;
        this.plugin.latestScenesPerWeek = rate;
    }

    private freezeToLastEstimate(stage: string, lastProgressDate: Date | null, windowDays: number, stragglerCount?: number): CompletionEstimate | null {
        if (!this.lastFreshEstimate || this.lastFreshEstimate.stage !== stage) {
            return null;
        }
        const staleness = this.classifyStaleness(lastProgressDate, new Date());
        return {
            ...this.lastFreshEstimate,
            staleness,
            lastProgressDate: lastProgressDate ?? this.lastFreshEstimate.lastProgressDate,
            windowDays,
            labelText: '?',
            isFrozen: true,
            stragglerCount: stragglerCount && stragglerCount > 0 ? stragglerCount : undefined
        };
    }

    private classifyStaleness(lastProgressDate: Date | null, today: Date): CompletionEstimate['staleness'] {
        if (!lastProgressDate) return 'stalled';
        const msInDay = 24 * 60 * 60 * 1000;
        const daysSince = Math.floor((today.getTime() - lastProgressDate.getTime()) / msInDay);
        if (daysSince <= 7) return 'fresh';
        if (daysSince <= 10) return 'warn';
        if (daysSince <= 20) return 'late';
        return 'stalled';
    }

}
