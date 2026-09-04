/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Keyword/Regex Sweep
 * Heuristic refinement using explicit temporal language in scene text.
 */

import type { RepairSceneEntry, TemporalCue, WhenConfidence, TimeBucket } from './types';
import { TIME_BUCKET_HOURS } from './types';
import { parseWhenField } from '../utils/date';

// ============================================================================
// Temporal Cue Patterns
// ============================================================================

/**
 * Patterns for absolute date/time mentions.
 * These override any pattern-based assignment.
 */
const ABSOLUTE_DATE_PATTERNS: Array<{
    pattern: RegExp;
    extract: (match: RegExpMatchArray) => string | null;
}> = [
    // ISO format: 2085-04-01, 2085-4-1
    {
        pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
        extract: (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    },
    // Month Day, Year: "March 15, 2085", "March 15th, 2085"
    {
        pattern: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
        extract: (m) => {
            const monthMap: Record<string, string> = {
                january: '01', february: '02', march: '03', april: '04',
                may: '05', june: '06', july: '07', august: '08',
                september: '09', october: '10', november: '11', december: '12'
            };
            const month = monthMap[m[1].toLowerCase()];
            const day = m[2].padStart(2, '0');
            return `${m[3]}-${month}-${day}`;
        }
    },
    // Day Month Year: "15 March 2085", "15th March 2085"
    {
        pattern: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})\b/i,
        extract: (m) => {
            const monthMap: Record<string, string> = {
                january: '01', february: '02', march: '03', april: '04',
                may: '05', june: '06', july: '07', august: '08',
                september: '09', october: '10', november: '11', december: '12'
            };
            const month = monthMap[m[2].toLowerCase()];
            const day = m[1].padStart(2, '0');
            return `${m[3]}-${month}-${day}`;
        }
    }
];

/**
 * Patterns for time-of-day mentions.
 */
const TIME_PATTERNS: Array<{
    pattern: RegExp;
    bucket: TimeBucket;
    confidence: WhenConfidence;
}> = [
    // Explicit times
    { pattern: /\b(?:at\s+)?(\d{1,2})\s*(?::|\.)\s*(\d{2})\s*(am|pm)\b/i, bucket: 'morning', confidence: 'high' },
    { pattern: /\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i, bucket: 'morning', confidence: 'high' },
    
    // Morning indicators
    { pattern: /\b(?:that|this|the|early|next)\s+morning\b/i, bucket: 'morning', confidence: 'high' },
    { pattern: /\bat\s+dawn\b/i, bucket: 'morning', confidence: 'high' },
    { pattern: /\bat\s+sunrise\b/i, bucket: 'morning', confidence: 'high' },
    { pattern: /\bbreakfast\s+time\b/i, bucket: 'morning', confidence: 'med' },
    
    // Afternoon indicators
    { pattern: /\b(?:that|this|the|early|late)\s+afternoon\b/i, bucket: 'afternoon', confidence: 'high' },
    { pattern: /\bafter\s+lunch\b/i, bucket: 'afternoon', confidence: 'med' },
    { pattern: /\bmidday\b/i, bucket: 'afternoon', confidence: 'med' },
    { pattern: /\bnoon\b/i, bucket: 'afternoon', confidence: 'high' },
    
    // Evening indicators
    { pattern: /\b(?:that|this|the|early|late)\s+evening\b/i, bucket: 'evening', confidence: 'high' },
    { pattern: /\bat\s+dusk\b/i, bucket: 'evening', confidence: 'high' },
    { pattern: /\bat\s+sunset\b/i, bucket: 'evening', confidence: 'high' },
    { pattern: /\bdinner\s+time\b/i, bucket: 'evening', confidence: 'med' },
    { pattern: /\bsupper\s+time\b/i, bucket: 'evening', confidence: 'med' },
    
    // Night indicators
    { pattern: /\b(?:that|this|the|late)\s+night\b/i, bucket: 'night', confidence: 'high' },
    { pattern: /\bat\s+midnight\b/i, bucket: 'night', confidence: 'high' },
    { pattern: /\bafter\s+dark\b/i, bucket: 'night', confidence: 'med' },
    // Removed weak: "in the dark" — too ambiguous, not reliably temporal

    // Scene-header style bare labels: "Morning.", "Afternoon.", standalone or after a continuation marker
    { pattern: /(?:^|[.\n])\s*Morning\b\.?(?=\s|$)/m, bucket: 'morning', confidence: 'high' },
    { pattern: /(?:^|[.\n])\s*Afternoon\b\.?(?=\s|$)/m, bucket: 'afternoon', confidence: 'high' },
    { pattern: /(?:^|[.\n])\s*Evening\b\.?(?=\s|$)/m, bucket: 'evening', confidence: 'high' },
    { pattern: /(?:^|[.\n])\s*Night\b\.?(?=\s|$)/m, bucket: 'night', confidence: 'high' }
];

/**
 * Patterns for day jumps (relative day advancement).
 */
const DAY_JUMP_PATTERNS: Array<{
    pattern: RegExp;
    dayOffset: number | ((match: RegExpMatchArray) => number);
    confidence: WhenConfidence;
}> = [
    // Next day
    { pattern: /\bthe\s+next\s+day\b/i, dayOffset: 1, confidence: 'high' },
    { pattern: /\bthe\s+following\s+day\b/i, dayOffset: 1, confidence: 'high' },
    { pattern: /\bthe\s+next\s+morning\b/i, dayOffset: 1, confidence: 'high' },
    { pattern: /\bthe\s+following\s+morning\b/i, dayOffset: 1, confidence: 'high' },
    
    // Specific day counts
    { pattern: /\b(\d+)\s+days?\s+later\b/i, dayOffset: (m) => parseInt(m[1], 10), confidence: 'high' },
    { pattern: /\btwo\s+days?\s+later\b/i, dayOffset: 2, confidence: 'high' },
    { pattern: /\bthree\s+days?\s+later\b/i, dayOffset: 3, confidence: 'high' },
    { pattern: /\ba\s+few\s+days\s+later\b/i, dayOffset: 3, confidence: 'med' },
    // Removed weak: "several days later" — too imprecise for reliable offset
    
    // Weeks
    { pattern: /\b(\d+)\s+weeks?\s+later\b/i, dayOffset: (m) => parseInt(m[1], 10) * 7, confidence: 'high' },
    { pattern: /\ba\s+week\s+later\b/i, dayOffset: 7, confidence: 'high' },
    { pattern: /\bthe\s+next\s+week\b/i, dayOffset: 7, confidence: 'med' },
    { pattern: /\bthe\s+following\s+week\b/i, dayOffset: 7, confidence: 'med' },
    { pattern: /\btwo\s+weeks\s+later\b/i, dayOffset: 14, confidence: 'high' },
    // Removed weak: "a few weeks later" — too imprecise for reliable offset
    
    // Months
    { pattern: /\b(\d+)\s+months?\s+later\b/i, dayOffset: (m) => parseInt(m[1], 10) * 30, confidence: 'med' },
    { pattern: /\ba\s+month\s+later\b/i, dayOffset: 30, confidence: 'med' },
    { pattern: /\bthe\s+next\s+month\b/i, dayOffset: 30, confidence: 'med' },
    { pattern: /\bthe\s+following\s+month\b/i, dayOffset: 30, confidence: 'med' },
    
    // Years
    { pattern: /\b(\d+)\s+years?\s+later\b/i, dayOffset: (m) => parseInt(m[1], 10) * 365, confidence: 'med' },
    { pattern: /\ba\s+year\s+later\b/i, dayOffset: 365, confidence: 'med' },
    { pattern: /\bthe\s+next\s+year\b/i, dayOffset: 365, confidence: 'med' },
    { pattern: /\bthe\s+following\s+year\b/i, dayOffset: 365, confidence: 'med' }
];

/**
 * Patterns for continuity (same time or immediately after).
 */
const CONTINUITY_PATTERNS: Array<{
    pattern: RegExp;
    minuteOffset: number;
    confidence: WhenConfidence;
}> = [
    { pattern: /\bimmediately\s+after\b/i, minuteOffset: 5, confidence: 'high' },
    { pattern: /\bmoments\s+later\b/i, minuteOffset: 5, confidence: 'high' },
    { pattern: /\bseconds\s+later\b/i, minuteOffset: 1, confidence: 'high' },
    { pattern: /\bminutes\s+later\b/i, minuteOffset: 10, confidence: 'med' },
    { pattern: /\ba\s+few\s+minutes\s+later\b/i, minuteOffset: 10, confidence: 'med' },
    { pattern: /\bhalf\s+an?\s+hour\s+later\b/i, minuteOffset: 30, confidence: 'high' },
    { pattern: /\ban?\s+hour\s+later\b/i, minuteOffset: 60, confidence: 'high' },
    { pattern: /\b(\d+)\s+hours?\s+later\b/i, minuteOffset: 60, confidence: 'high' },
    { pattern: /\bat\s+the\s+same\s+time\b/i, minuteOffset: 0, confidence: 'med' },
    // Removed weak/ambiguous: "still", "meanwhile" — too vague, no temporal direction

    // Day continuation markers — "Continued" indicates same day as previous scene
    { pattern: /\bday\s+\d+\s+continued\b/i, minuteOffset: 0, confidence: 'high' },
    { pattern: /\bthe\s+\d+(?:st|nd|rd|th)\s+day\s+continued\b/i, minuteOffset: 0, confidence: 'high' },
    { pattern: /\bthe\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+day\s+continued\b/i, minuteOffset: 0, confidence: 'high' },
    { pattern: /(?:^|[.\n])\s*continued\b\.?(?=\s|$)/im, minuteOffset: 0, confidence: 'med' }
];

// ============================================================================
// Main Keyword Sweep Function
// ============================================================================

export interface KeywordSweepOptions {
    /** Maximum characters to scan from scene body (0 = unlimited) */
    excerptWindow?: number;
    
    /** Include scene synopsis in scan */
    includeSynopsis?: boolean;
}

const DEFAULT_OPTIONS: KeywordSweepOptions = {
    // No truncation: scan the full scene body. Detection is local and
    // deterministic, so cost is negligible even on long scenes, and missing
    // a cue because it lives past an arbitrary cap erodes author trust.
    excerptWindow: 0,
    includeSynopsis: true
};

/**
 * Keyword/Regex Sweep
 * 
 * Refines pattern-based dates using explicit temporal language
 * found in scene text. This is a lightweight deterministic layer.
 * 
 * Resolution priority:
 * 1. Absolute date mentions → exact When
 * 2. Day jump cues → advance date from previous
 * 3. Time-of-day mentions → adjust time bucket
 * 4. Continuity markers → small offset from previous
 * 5. No cues found → keep the pattern result
 * 
 * @param entries - RepairSceneEntry array from the pattern scaffold
 * @param getSceneText - Function to retrieve scene body text
 * @param options - Sweep configuration
 * @returns Modified entries with keyword refinements
 */
export async function runKeywordSweep(
    entries: RepairSceneEntry[],
    getSceneText: (entry: RepairSceneEntry) => Promise<string>,
    options: KeywordSweepOptions = {}
): Promise<RepairSceneEntry[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const previousEntry = i > 0 ? entries[i - 1] : null;

        // Get text to scan
        let text = await getSceneText(entry);

        // Add synopsis if available and enabled
        if (opts.includeSynopsis && entry.scene.synopsis) {
            text = entry.scene.synopsis + '\n' + text;
        }

        // Apply excerpt window
        if (opts.excerptWindow && opts.excerptWindow > 0 && text.length > opts.excerptWindow) {
            text = text.substring(0, opts.excerptWindow);
        }

        // Find temporal cues
        const cues = extractTemporalCues(text);
        if (cues.length === 0) continue;

        // Always surface cues as editorial evidence, even on authored anchors.
        // The chips show the manuscript phrase; they are not a claim that the
        // cue drove the date.
        entry.cues = cues;

        // Authored anchors are never rewritten by cues — only their evidence
        // is surfaced. Skip the apply step.
        if (entry.source === 'authored') continue;

        // Apply cues to refine the When date
        const refinedWhen = applyCues(
            entry.proposedWhen,
            previousEntry?.proposedWhen ?? null,
            cues
        );

        if (refinedWhen) {
            entry.proposedWhen = refinedWhen.date;
            entry.source = 'keyword';
            entry.confidence = refinedWhen.confidence;
            entry.isChanged = entry.originalWhen === null ||
                refinedWhen.date.getTime() !== entry.originalWhen.getTime();
        }
    }
    
    // Re-detect temporal issues after refinement
    detectTemporalIssuesAfterSweep(entries);
    
    return entries;
}

/**
 * Extract all temporal cues from text.
 */
function extractTemporalCues(text: string): TemporalCue[] {
    const cues: TemporalCue[] = [];
    
    // Check absolute dates
    for (const { pattern, extract } of ABSOLUTE_DATE_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            const value = extract(match);
            if (value) {
                cues.push({
                    category: 'absolute',
                    match: match[0],
                    value,
                    confidence: 'high'
                });
            }
        }
    }
    
    // Check day jumps
    for (const { pattern, dayOffset, confidence } of DAY_JUMP_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            const offset = typeof dayOffset === 'function' ? dayOffset(match) : dayOffset;
            cues.push({
                category: 'dayJump',
                match: match[0],
                value: offset,
                confidence
            });
        }
    }
    
    // Check time-of-day
    for (const { pattern, bucket, confidence } of TIME_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            cues.push({
                category: 'sameDayTime',
                match: match[0],
                value: bucket,
                confidence
            });
        }
    }
    
    // Check continuity
    for (const { pattern, minuteOffset, confidence } of CONTINUITY_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            cues.push({
                category: 'continuity',
                match: match[0],
                value: minuteOffset,
                confidence
            });
        }
    }
    
    return cues;
}

/**
 * Apply cues to refine a When date.
 * Priority: absolute > dayJump > sameDayTime > continuity
 */
function applyCues(
    currentWhen: Date,
    previousWhen: Date | null,
    cues: TemporalCue[]
): { date: Date; confidence: WhenConfidence } | null {
    // Sort cues by priority and confidence
    const sortedCues = [...cues].sort((a, b) => {
        const priorityOrder: Record<string, number> = {
            absolute: 0,
            dayJump: 1,
            sameDayTime: 2,
            continuity: 3
        };
        const aPriority = priorityOrder[a.category] ?? 99;
        const bPriority = priorityOrder[b.category] ?? 99;
        
        if (aPriority !== bPriority) return aPriority - bPriority;
        
        // Higher confidence first
        const confOrder: Record<WhenConfidence, number> = { high: 0, med: 1, low: 2 };
        return (confOrder[a.confidence] ?? 99) - (confOrder[b.confidence] ?? 99);
    });
    
    if (sortedCues.length === 0) return null;
    
    const primaryCue = sortedCues[0];
    let result = new Date(currentWhen);
    let confidence = primaryCue.confidence;
    
    switch (primaryCue.category) {
        case 'absolute': {
            // Parse the absolute date
            const parsed = parseWhenField(primaryCue.value as string);
            if (parsed) {
                result = parsed;
            }
            break;
        }
        
        case 'dayJump': {
            // Apply day offset from previous scene's When
            const baseDate = previousWhen ?? currentWhen;
            result = new Date(baseDate);
            result.setDate(result.getDate() + (primaryCue.value as number));
            
            // Look for a time cue to apply
            const timeCue = sortedCues.find(c => c.category === 'sameDayTime');
            if (timeCue) {
                const bucket = timeCue.value as TimeBucket;
                result.setHours(TIME_BUCKET_HOURS[bucket], 0, 0, 0);
            } else {
                // Default to morning for day jumps
                result.setHours(TIME_BUCKET_HOURS.morning, 0, 0, 0);
            }
            break;
        }
        
        case 'sameDayTime': {
            // Keep same date, change time bucket
            const bucket = primaryCue.value as TimeBucket;
            result.setHours(TIME_BUCKET_HOURS[bucket], 0, 0, 0);
            break;
        }
        
        case 'continuity': {
            const baseDate = previousWhen ?? currentWhen;
            result = new Date(baseDate);
            result.setMinutes(result.getMinutes() + (primaryCue.value as number));

            const timeCue = sortedCues.find(c => c.category === 'sameDayTime');
            if (timeCue) {
                const bucket = timeCue.value as TimeBucket;
                result.setHours(TIME_BUCKET_HOURS[bucket], 0, 0, 0);
            }
            break;
        }
    }
    
    return { date: result, confidence };
}

/**
 * Re-detect temporal issues after keyword sweep.
 */
function detectTemporalIssuesAfterSweep(entries: RepairSceneEntry[]): void {
    if (entries.length < 2) return;
    
    // Calculate median gap for large gap detection
    const gaps: number[] = [];
    for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1].proposedWhen;
        const curr = entries[i].proposedWhen;
        gaps.push(curr.getTime() - prev.getTime());
    }
    
    if (gaps.length === 0) return;
    
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const largeGapThreshold = medianGap * 5;
    
    // Detect issues
    for (let i = 1; i < entries.length; i++) {
        // Reset flags first
        entries[i].hasBackwardTime = false;
        entries[i].hasLargeGap = false;
        entries[i].needsReview = entries[i].needsReview || false;

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

        // Large gap (only flag if threshold is meaningful)
        if (largeGapThreshold > 0 && gap > largeGapThreshold) {
            entries[i].hasLargeGap = true;
        }
    }
}

