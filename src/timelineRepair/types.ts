/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Core Types
 */

import type { TFile } from 'obsidian';
import type { TimelineItem } from '../types';
import { getFormattingLocale, t, tCount } from '../i18n';

// ============================================================================
// Pattern Presets
// ============================================================================

export type PatternPresetId = 'daily' | 'beats2' | 'beats3' | 'beats4' | 'weekly';

export interface IntervalPattern {
    type: 'interval';
    id: PatternPresetId;
    label: string;
    description: string;
}

export interface CyclePattern {
    type: 'cycle';
    id: PatternPresetId;
    label: string;
    description: string;
    sequence: TimeBucket[];
}

export type ScaffoldPattern = IntervalPattern | CyclePattern;

/** A cycle preset is labelled by its beat count and described by its bucket sequence ("Morning → Evening"). */
function cyclePattern(id: PatternPresetId, sequence: TimeBucket[]): CyclePattern {
    return {
        type: 'cycle',
        id,
        get label() { return tCount('beat', sequence.length); },
        get description() { return sequence.map(bucket => TIME_BUCKET_LABELS[bucket]).join(' \u2192 '); },
        sequence
    };
}

export const SCAFFOLD_PATTERNS: Record<PatternPresetId, ScaffoldPattern> = {
    daily: {
        type: 'interval',
        id: 'daily',
        get label() { return t('ui.types.patternDailyLabel'); },
        get description() { return t('ui.types.patternDailyDesc'); }
    },
    beats2: cyclePattern('beats2', ['morning', 'evening']),
    beats3: cyclePattern('beats3', ['morning', 'afternoon', 'evening']),
    beats4: cyclePattern('beats4', ['morning', 'afternoon', 'evening', 'night']),
    weekly: {
        type: 'interval',
        id: 'weekly',
        get label() { return t('ui.types.patternWeeklyLabel'); },
        get description() { return t('ui.types.patternWeeklyDesc'); }
    }
};

// ============================================================================
// Time Buckets
// ============================================================================

/**
 * Canonical time buckets for quick time assignment.
 * These are the "Morning / Afternoon / Evening / Night" shortcuts.
 */
export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export const TIME_BUCKET_HOURS: Record<TimeBucket, number> = {
    morning: 8,      // 08:00
    afternoon: 13,   // 13:00
    evening: 19,     // 19:00
    night: 23        // 23:00
};

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
    get morning() { return t('ui.types.bucketMorning'); },
    get afternoon() { return t('ui.types.bucketAfternoon'); },
    get evening() { return t('ui.types.bucketEvening'); },
    get night() { return t('ui.types.bucketNight'); }
};

/**
 * Human-readable elapsed time for a flashback / flash-forward row, expressed
 * relative to the surrounding "current" timeline. Negative deltaMs is a jump
 * backward in time ("earlier"); positive is forward ("later").
 *
 * Picks the largest unit that gives a meaningful integer:
 *   ≥ 1 year   → "N years earlier/later"
 *   ≥ 1 month  → "N months earlier/later"
 *   otherwise  → "N days earlier/later"
 */
export function formatFlashbackDelta(deltaMs: number): string {
    const absDays = Math.abs(deltaMs) / (1000 * 60 * 60 * 24);
    const years = absDays / 365.25;
    const months = absDays / 30.44;
    const span = years >= 1
        ? tCount('year', Math.round(years))
        : months >= 1
            ? tCount('month', Math.round(months))
            : tCount('day', Math.max(1, Math.round(absDays)));
    return deltaMs < 0
        ? t('ui.types.flashbackEarlier', { span })
        : t('ui.types.flashbackLater', { span });
}

/**
 * Pretty label for a date — combines the weekday name with the time-of-day
 * bucket so rows read naturally ("Saturday Evening", "Sunday Morning").
 * Overrides the bucket label when the time hits exactly noon (12:00) or
 * midnight (00:00).
 */
export function describeWhenLabel(date: Date, bucket: TimeBucket): string {
    const h = date.getHours();
    const m = date.getMinutes();
    const weekday = new Intl.DateTimeFormat(getFormattingLocale(), { weekday: 'long' }).format(date);

    let timeOfDay: string;
    if (m === 0 && h === 12) {
        timeOfDay = t('ui.types.noon');
    } else if (m === 0 && h === 0) {
        timeOfDay = t('ui.types.midnight');
    } else {
        timeOfDay = TIME_BUCKET_LABELS[bucket];
    }

    return t('ui.types.whenLabel', { weekday, timeOfDay });
}

// ============================================================================
// Provenance Metadata
// ============================================================================

/**
 * Source of the When value - tracks how it was derived.
 */
export type WhenSource = 'pattern' | 'keyword' | 'ai' | 'manual' | 'original' | 'authored';

/**
 * Confidence level in the inferred When value.
 */
export type WhenConfidence = 'high' | 'med' | 'low';

/**
 * Source of Duration value if inferred.
 */
export type DurationSource = 'inferred' | 'ai' | 'original';

// ============================================================================
// Keyword Cue Types
// ============================================================================

/**
 * Categories of temporal cues detected by the keyword sweep.
 */
export type TemporalCueCategory = 
    | 'absolute'      // Explicit date/time: "March 15, 2085"
    | 'sameDayTime'   // Same day, different time: "that evening"
    | 'dayJump'       // Day advancement: "the next day", "three weeks later"
    | 'continuity';   // Immediate continuation: "still", "immediately after"

export interface TemporalCue {
    category: TemporalCueCategory;
    match: string;           // The matched text
    value?: string | number; // Parsed value (date string, day offset, etc.)
    confidence: WhenConfidence;
}

// ============================================================================
// Repair Scene Entry
// ============================================================================

/**
 * Core data structure for a scene being processed by the repair wizard.
 * Contains original state, proposed changes, and metadata.
 */
export interface RepairSceneEntry {
    // Identity
    scene: TimelineItem;
    file: TFile;
    manuscriptIndex: number;
    
    // Original state (before repair)
    originalWhen: Date | null;
    originalWhenRaw?: string;  // Raw string from YAML for display
    
    // Proposed state (from analysis pipeline)
    proposedWhen: Date;
    
    // Edited state (user modifications in review modal)
    editedWhen: Date | null;
    
    // Provenance
    source: WhenSource;
    confidence: WhenConfidence;
    cues?: TemporalCue[];        // L2 keyword matches
    /**
     * WhenSource stamped in frontmatter by a previous scaffold apply. Only
     * machine stamps ('pattern' | 'keyword' | 'ai') are kept — they mark
     * dates that Ripple may shift even though they parse as existing.
     * Author-typed dates (no stamp, or 'manual'/'authored') act as ripple
     * anchors.
     */
    stampedWhenSource?: 'pattern' | 'keyword' | 'ai';
    
    // Flags
    needsReview: boolean;
    hasBackwardTime: boolean;    // When < previous scene's When
    hasLargeGap: boolean;        // Unusually large time gap from previous
    isFlashback: boolean;        // originalWhen is far from surrounding authored dates
    /** Human-readable delta for a flashback row, e.g. "5 years earlier". */
    flashbackLabel?: string;
    isChanged: boolean;          // proposedWhen differs from originalWhen
    
    // Duration (optional)
    originalDuration?: string;
    proposedDuration?: number;   // milliseconds
    durationSource?: DurationSource;
    durationOngoing?: boolean;
}

/**
 * Get the effective When date for a scene entry.
 * Priority: editedWhen > proposedWhen
 */
export function getEffectiveWhen(entry: RepairSceneEntry): Date {
    return entry.editedWhen ?? entry.proposedWhen;
}

// ============================================================================
// Session Diff Model
// ============================================================================

/**
 * A single edit operation in the undo stack.
 */
export interface EditOperation {
    type: 'single' | 'batch' | 'ripple';
    timestamp: number;
    
    // For single edits
    sceneIndex?: number;
    previousWhen?: Date;
    newWhen?: Date;
    
    // For batch/ripple edits
    changes?: Array<{
        sceneIndex: number;
        previousWhen: Date;
        newWhen: Date;
    }>;
}

/**
 * Session-local diff model for tracking changes before commit.
 */
export interface SessionDiffModel {
    entries: RepairSceneEntry[];
    undoStack: EditOperation[];
    redoStack: EditOperation[];
    
    // Ripple mode state
    rippleEnabled: boolean;
    /** Override: ripple also shifts authored anchor dates (flashbacks stay pinned). */
    rippleIncludeAnchored: boolean;

    // Dirty tracking
    hasUnsavedChanges: boolean;
}

// ============================================================================
// Pipeline Configuration
// ============================================================================

/**
 * Configuration for the repair analysis pipeline.
 */
export interface RepairPipelineConfig {
    // Anchor point — used as fallback when no authored dates exist,
    // and as the starting point when preserveAuthoredDates is false.
    anchorWhen: Date;
    anchorSceneIndex: number;  // Usually 0 (first scene)

    // When true, scenes with parsable existing When dates are preserved as
    // anchors and the scaffold fills only the gaps around them. When false,
    // every scene is rewritten from the configured anchor (legacy behavior).
    preserveAuthoredDates: boolean;
    
    // Pattern configuration
    patternPreset: PatternPresetId;
    
    // Deterministic cue refinement
    useTextCues: boolean;
}

// ============================================================================
// Pipeline Results
// ============================================================================

/**
 * Results from running the repair pipeline.
 */
export interface RepairPipelineResult {
    entries: RepairSceneEntry[];

    // Statistics
    totalScenes: number;
    scenesChanged: number;
    scenesNeedingReview: number;
    scenesWithBackwardTime: number;
    scenesWithLargeGaps: number;
    scenesAuthored: number;

    // Pass-specific stats
    patternApplied: number;
    cueRefined: number;
}

// ============================================================================
// Modal State
// ============================================================================

/**
 * State for the Timeline Repair Modal.
 */
export type ModalPhase = 'config' | 'analyzing' | 'review';

// ============================================================================
// Frontmatter Update Types
// ============================================================================

/**
 * A pending frontmatter update to be written.
 */
export interface FrontmatterUpdate {
    file: TFile;
    when: Date;
    /** Preserve day-only evidence instead of writing the parser's default clock time. */
    dateOnly?: boolean;
    /** Provenance for the When change log — never written to frontmatter. */
    whenSource: WhenSource;

    // Optional fields
    duration?: number;
    durationOngoing?: boolean;
}

/**
 * Result of batch frontmatter updates.
 */
export interface FrontmatterWriteResult {
    success: number;
    failed: number;
    errors: Array<{ file: TFile; error: string }>;
}
