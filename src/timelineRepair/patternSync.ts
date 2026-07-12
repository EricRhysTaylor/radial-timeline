/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Pattern Sync
 * Deterministic baseline timeline assignment based on manuscript order.
 */

import type { TFile } from 'obsidian';
import type { TimelineItem } from '../types';
import { parseWhenField } from '../utils/date';
import {
    type PatternPresetId,
    type RepairSceneEntry,
    type TimeBucket,
    TIME_BUCKET_HOURS,
    SCAFFOLD_PATTERNS,
    formatFlashbackDelta
} from './types';

/**
 * Read a machine WhenSource stamp left in frontmatter by a previous scaffold
 * apply. Only scaffold stamps count — they mark dates ripple may shift even
 * though they parse as existing. Anything else (absent, 'manual', 'authored')
 * means the author owns the date.
 */
function readScaffoldStamp(scene: TimelineItem): 'pattern' | 'keyword' | 'ai' | undefined {
    const raw = scene.rawFrontmatter?.WhenSource;
    return raw === 'pattern' || raw === 'keyword' || raw === 'ai' ? raw : undefined;
}

// ============================================================================
// Pattern Generators
// ============================================================================

/**
 * Get the next date based on pattern preset.
 * 
 * @param currentDate - Current date in the sequence
 * @param beatIndex - Current beat index (for multi-beat patterns)
 * @param presetId - The pattern preset to use
 * @returns Object with next date and updated beat index
 */
function getNextPatternDate(
    currentDate: Date,
    beatIndex: number,
    presetId: PatternPresetId
): { date: Date; beatIndex: number } {
    const result = new Date(currentDate);
    const pattern = SCAFFOLD_PATTERNS[presetId];
    
    if (pattern.type === 'interval') {
        if (presetId === 'weekly') {
            result.setDate(result.getDate() + 7);
        } else {
            // default to daily
            result.setDate(result.getDate() + 1);
        }
        return { date: result, beatIndex: 0 };
    }
    
    // Cycle pattern
    const nextBeat = (beatIndex + 1) % pattern.sequence.length;
    const bucket = pattern.sequence[nextBeat];
    result.setHours(TIME_BUCKET_HOURS[bucket], 0, 0, 0);
    
    // If we wrapped around, advance the day
    if (nextBeat === 0) {
        result.setDate(result.getDate() + 1);
    }
    
    return { date: result, beatIndex: nextBeat };
}

/**
 * Get the initial beat index for a given anchor date and preset.
 * Determines which beat in the cycle the anchor falls on based on its hour.
 */
export function getInitialBeatIndex(anchorDate: Date, presetId: PatternPresetId): number {
    const pattern = SCAFFOLD_PATTERNS[presetId];
    if (pattern.type === 'interval') return 0;
    
    const bucket = detectTimeBucket(anchorDate);
    const index = pattern.sequence.indexOf(bucket);
    
    // If exact bucket not in sequence, default to 0, or could do a closest match, 
    // but returning 0 is safe.
    return index >= 0 ? index : 0;
}

// ============================================================================
// Main Pattern Sync Function
// ============================================================================

export interface PatternSyncOptions {
    /** The anchor date to start the pattern from (fallback when no authored dates) */
    anchorWhen: Date;

    /** Which scene index to anchor (usually 0) */
    anchorSceneIndex?: number;

    /** The pattern preset to use */
    patternPreset: PatternPresetId;

    /**
     * When true, scenes with a parsable existing When are preserved as anchors;
     * the pattern walk fills only the gaps between them.
     */
    preserveAuthoredDates?: boolean;
}

export interface PatternSyncInput {
    scene: TimelineItem;
    file: TFile;
    manuscriptIndex: number;
}

/**
 * Pattern Sync
 * 
 * Assigns When dates to scenes sequentially based on manuscript order
 * using a deterministic pattern. This creates a clean temporal baseline
 * that can be optionally refined by simple text cues.
 * 
 * Guarantees:
 * - Extremely fast (no text parsing, no API calls)
 * - Deterministic output for same input
 * - Every scene gets a When date
 * - Chronologue immediately becomes usable
 * 
 * @param scenes - Scenes in manuscript order with file references
 * @param options - Pattern configuration
 * @returns Array of RepairSceneEntry with pattern-assigned dates
 */
export function runPatternSync(
    scenes: PatternSyncInput[],
    options: PatternSyncOptions
): RepairSceneEntry[] {
    const { anchorWhen, patternPreset, anchorSceneIndex = 0, preserveAuthoredDates = false } = options;

    if (scenes.length === 0) {
        return [];
    }

    // Pass 1: parse original When for every scene so we can identify anchors.
    type ParsedScene = PatternSyncInput & {
        originalWhen: Date | null;
        originalWhenRaw?: string;
    };
    const parsed: ParsedScene[] = scenes.map(s => {
        const result: ParsedScene = { ...s, originalWhen: null };
        const when = s.scene.when;
        if (when instanceof Date && !isNaN(when.getTime())) {
            result.originalWhen = when;
        } else if (typeof when === 'string') {
            result.originalWhenRaw = when;
            const p = parseWhenField(when);
            if (p) result.originalWhen = p;
        }
        return result;
    });

    // Authored anchor indices, in manuscript order (only when preserve mode is on
    // and the date actually parsed).
    const authoredIndices = preserveAuthoredDates
        ? parsed.flatMap((p, i) => (p.originalWhen ? [i] : []))
        : [];

    // Build proposedWhen + source for every scene.
    const proposed: Array<{ when: Date; source: 'pattern' | 'authored' }> = new Array(scenes.length);

    if (authoredIndices.length === 0) {
        // No authored anchors (or preserve mode off) — legacy walk from configured anchor.
        let beatIndex = getInitialBeatIndex(anchorWhen, patternPreset);
        let currentDate = new Date(anchorWhen);
        for (let i = 0; i < scenes.length; i++) {
            if (i === anchorSceneIndex) {
                proposed[i] = { when: new Date(anchorWhen), source: 'pattern' };
                currentDate = new Date(anchorWhen);
                beatIndex = getInitialBeatIndex(anchorWhen, patternPreset);
            } else if (i < anchorSceneIndex) {
                const offset = anchorSceneIndex - i;
                const d = new Date(anchorWhen);
                d.setDate(d.getDate() - offset);
                proposed[i] = { when: d, source: 'pattern' };
            } else {
                const next = getNextPatternDate(currentDate, beatIndex, patternPreset);
                proposed[i] = { when: next.date, source: 'pattern' };
                beatIndex = next.beatIndex;
                currentDate = next.date;
            }
        }
    } else {
        // Anchored gap-fill: every authored scene keeps its date; the walker
        // restarts at each anchor and fills forward to the next anchor (or end).
        for (const idx of authoredIndices) {
            proposed[idx] = { when: new Date(parsed[idx].originalWhen as Date), source: 'authored' };
        }

        // Scenes before the first anchor: walk backward from it.
        const firstAnchor = authoredIndices[0];
        const firstAnchorDate = parsed[firstAnchor].originalWhen as Date;
        for (let i = firstAnchor - 1; i >= 0; i--) {
            const offset = firstAnchor - i;
            const d = new Date(firstAnchorDate);
            d.setDate(d.getDate() - offset);
            proposed[i] = { when: d, source: 'pattern' };
        }

        // Walk forward between consecutive anchors and after the last anchor.
        for (let a = 0; a < authoredIndices.length; a++) {
            const startIdx = authoredIndices[a];
            const endIdx = a + 1 < authoredIndices.length ? authoredIndices[a + 1] : scenes.length;
            if (endIdx <= startIdx + 1) continue;

            const startDate = parsed[startIdx].originalWhen as Date;
            let beatIndex = getInitialBeatIndex(startDate, patternPreset);
            let currentDate = new Date(startDate);
            for (let i = startIdx + 1; i < endIdx; i++) {
                const next = getNextPatternDate(currentDate, beatIndex, patternPreset);
                proposed[i] = { when: next.date, source: 'pattern' };
                beatIndex = next.beatIndex;
                currentDate = next.date;
            }
        }
    }

    // Pass 2: build entries.
    const entries: RepairSceneEntry[] = parsed.map((p, i) => {
        const slot = proposed[i];
        const proposedWhen = slot.when;
        const isChanged = slot.source === 'authored'
            ? false
            : (p.originalWhen === null || proposedWhen.getTime() !== p.originalWhen.getTime());

        return {
            scene: p.scene,
            file: p.file,
            manuscriptIndex: p.manuscriptIndex,

            originalWhen: p.originalWhen,
            originalWhenRaw: p.originalWhenRaw,
            proposedWhen,
            editedWhen: null,

            source: slot.source,
            stampedWhenSource: readScaffoldStamp(p.scene),
            confidence: 'high',

            needsReview: false,
            hasBackwardTime: false,
            hasLargeGap: false,
            isFlashback: false,
            isChanged
        };
    });

    detectFlashbacks(entries);
    detectTemporalIssues(entries);

    return entries;
}

/**
 * Mark scenes whose original (authored) When is far away in time from the
 * authored dates around them in manuscript order. These are typically narrative
 * flashbacks (or flash-forwards) where the time jump is intentional and should
 * not be flagged as a backward-time error.
 *
 * Heuristic: window-based median. For each entry with a parsable originalWhen,
 * collect the years of up to 5 authored neighbors on each side; if this entry's
 * year differs from the median by FLASHBACK_YEAR_THRESHOLD or more, it's a
 * flashback. Driven by originalWhen so it works regardless of preserve/replace
 * mode.
 */
const FLASHBACK_YEAR_THRESHOLD = 3;
const FLASHBACK_WINDOW = 5;

function detectFlashbacks(entries: RepairSceneEntry[]): void {
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.originalWhen) continue;

        const timestamps: number[] = [];
        for (let j = i - 1; j >= 0 && timestamps.length < FLASHBACK_WINDOW; j--) {
            const w = entries[j].originalWhen;
            if (w) timestamps.push(w.getTime());
        }
        for (let j = i + 1; j < entries.length && timestamps.length < FLASHBACK_WINDOW * 2; j++) {
            const w = entries[j].originalWhen;
            if (w) timestamps.push(w.getTime());
        }
        if (timestamps.length < 2) continue;

        const sorted = [...timestamps].sort((a, b) => a - b);
        const medianTs = sorted[Math.floor(sorted.length / 2)];
        const medianYear = new Date(medianTs).getFullYear();
        const yearDiff = entry.originalWhen.getFullYear() - medianYear;

        if (Math.abs(yearDiff) >= FLASHBACK_YEAR_THRESHOLD) {
            entry.isFlashback = true;
            entry.flashbackLabel = formatFlashbackDelta(entry.originalWhen.getTime() - medianTs);
        }
    }
}

/**
 * Detect temporal issues in the sequence:
 * - Backward time: scene's When is before previous scene's When
 * - Large gaps: unusually large time gaps between scenes
 */
function detectTemporalIssues(entries: RepairSceneEntry[]): void {
    if (entries.length < 2) return;
    
    // Calculate median gap for large gap detection
    const gaps: number[] = [];
    for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1].proposedWhen;
        const curr = entries[i].proposedWhen;
        gaps.push(curr.getTime() - prev.getTime());
    }
    
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const largeGapThreshold = medianGap * 5; // 5x median is "large"
    
    // Detect issues
    for (let i = 1; i < entries.length; i++) {
        // Flashback rows expect time jumps; suppress conflicting alerts.
        if (entries[i].isFlashback || entries[i - 1].isFlashback) continue;

        const prevWhen = entries[i - 1].proposedWhen;
        const currWhen = entries[i].proposedWhen;
        const gap = currWhen.getTime() - prevWhen.getTime();

        // Backward time
        if (gap < 0) {
            entries[i].hasBackwardTime = true;
            entries[i].needsReview = true;
        }

        // Large gap
        if (gap > largeGapThreshold && largeGapThreshold > 0) {
            entries[i].hasLargeGap = true;
        }
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Apply a time bucket to a date, keeping the same date but changing the time.
 */
export function applyTimeBucket(date: Date, bucket: TimeBucket): Date {
    const result = new Date(date);
    result.setHours(TIME_BUCKET_HOURS[bucket], 0, 0, 0);
    return result;
}

/**
 * Shift a date by a number of days.
 */
export function shiftDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

/**
 * Shift a date by a number of hours.
 */
export function shiftHours(date: Date, hours: number): Date {
    const result = new Date(date);
    result.setHours(result.getHours() + hours);
    return result;
}

/**
 * Detect which time bucket a date falls into.
 */
export function detectTimeBucket(date: Date): TimeBucket {
    const hour = date.getHours();
    if (hour < 11) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
}

/**
 * Format a When date for display in the review modal.
 */
export function formatWhenForDisplay(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Format just the time portion for compact display.
 */
export function formatTimeForDisplay(date: Date): string {
    const hour = date.getHours();
    const minute = date.getMinutes();
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    
    if (minute === 0) {
        return `${hour12}${ampm}`;
    }
    return `${hour12}:${String(minute).padStart(2, '0')}${ampm}`;
}
