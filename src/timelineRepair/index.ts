/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Module Exports
 */

// Types
export * from './types';

// Pattern Sync
export {
    runPatternSync,
    applyTimeBucket,
    shiftDays,
    shiftHours,
    detectTimeBucket,
    formatWhenForDisplay,
    formatTimeForDisplay,
    type PatternSyncOptions,
    type PatternSyncInput
} from './patternSync';

// Keyword Sweep
export {
    runKeywordSweep,
    parseAmPmTime,
    type KeywordSweepOptions
} from './keywordSweep';

// Pipeline
export {
    runRepairPipeline,
    collectScenesForRepair,
    type PipelineCallbacks
} from './RepairPipeline';

// Session Diff
export {
    createSession,
    editSceneWhen,
    shiftSceneDays,
    setSceneTimeBucket,
    shiftMultipleDays,
    setMultipleTimeBucket,
    editMultipleScenes,
    toggleRippleMode,
    toggleRippleIncludeAnchored,
    getRippleImpact,
    undo,
    redo,
    canUndo,
    canRedo,
    getEntriesNeedingReview,
    getEntriesWithBackwardTime,
    getEntriesBySource,
    getChangedCount,
    getNeedsReviewCount
} from './sessionDiff';

// Frontmatter Writer
export {
    prepareUpdates,
    writeFrontmatterUpdates,
    writeSessionChanges,
    previewUpdates,
    getChangeSummary,
    type WriteOptions
} from './frontmatterWriter';
