/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { formatNumber } from '../../utils/svg';
import type { TimelineItem } from '../../types';
import { parseWhenField, calculateTimeSpan, parseDuration, detectDiscontinuities, detectSceneOverlaps, prepareScenesForDiscontinuityDetection, calculateAutoDiscontinuityThreshold } from '../../utils/date';
import { parseRuntimeField, formatRuntimeValue } from '../../utils/runtimeEstimator';
import { sceneKey } from '../../utils/sceneHelpers';

export interface ChronologueSceneEntry {
    scene: TimelineItem;
    date: Date;
    sourceIndex: number;
}

/**
 * Build a de-duplicated, chronologue-friendly list of scene entries.
 * Scenes are uniquely identified by their path (preferred) or title+timestamp.
 */
export function collectChronologueSceneEntries(scenes: TimelineItem[]): ChronologueSceneEntry[] {
    const seenKeys = new Set<string>();
    const entries: ChronologueSceneEntry[] = [];

    scenes.forEach((scene, index) => {
        const whenDate =
            scene.when instanceof Date
                ? scene.when
                : parseWhenField(typeof scene.when === 'string' ? scene.when : '');
        if (!whenDate) return;

        const key = scene.path
            ? `path:${scene.path}`
            : `title:${scene.title ?? ''}::${whenDate.getTime()}`;

        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        entries.push({ scene, date: whenDate, sourceIndex: index });
    });

    return entries;
}


/**
 * Render the chronological timeline arc with proportional tick marks
 * This creates a 3px arc around the outer perimeter with tick marks positioned
 * based on actual time proportions, not scene positions.
 * 
 * @param scenes - Array of scenes sorted in manuscript order
 * @param outerRadius - Outer radius of the scene ring
 * @param scenePositions - Optional map of scene angular positions (manuscript order, keyed by scene path/title)
 */
export function renderChronologueTimelineArc(
    scenes: TimelineItem[],
    outerRadius: number,
    scenePositions?: Map<string, { startAngle: number; endAngle: number }>,
    _durationCapMs?: number | null, // DEPRECATED: cap slider removed, kept for API compatibility
    arcRadius: number = 758,  // Absolute radius for duration arcs
    precomputedEntries?: ChronologueSceneEntry[],
    useRuntimeMode: boolean = false
): string {
    const sceneEntries = precomputedEntries ?? collectChronologueSceneEntries(scenes);
    const validDates = sceneEntries.map(entry => entry.date);

    if (validDates.length === 0) {
        return ''; // No valid dates to render
    }
    
    // Calculate time span
    const timeSpan = calculateTimeSpan(validDates);
    
    let svg = '';
    
    // Render the chronologue timeline elements
    // Use the passed arcRadius directly (no longer calculating as offset)
    svg += `<g class="rt-chronologue-timeline-arc">`;
    
    // Level 4 - Scene Duration/Runtime Arcs (manuscript-order positions) - RENDER FIRST (behind ticks)
    if (scenePositions) {
        const durationSegments = renderDurationTickArcs({
            sceneEntries,
            arcRadius,
            timeSpanTotalMs: timeSpan.totalMs,
            scenePositions,
            useRuntimeMode
        });
        if (durationSegments) {
            svg += durationSegments;
        }
    }
    
    // Render time labels
    svg += `</g>`;
    
    return svg;
}

interface DurationTickArcParams {
    sceneEntries: ChronologueSceneEntry[];
    arcRadius: number;
    timeSpanTotalMs: number;
    scenePositions: Map<string, { startAngle: number; endAngle: number }>;
    useRuntimeMode?: boolean;
}

function renderDurationTickArcs(params: DurationTickArcParams): string | null {
    const { sceneEntries, arcRadius, timeSpanTotalMs, scenePositions, useRuntimeMode } = params;
    if (sceneEntries.length === 0 || timeSpanTotalMs <= 0) {
        return null;
    }
    
    const sortedEntries = sceneEntries
        .slice()
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Parse all durations/runtimes and categorize them
    interface DurationInfo {
        durationMs: number | null; // null = unparseable, 0 = no duration, >0 = valid
        rawDuration: string | undefined;
    }
    
    const parsedDurations: DurationInfo[] = sortedEntries.map(entry => {
        // In runtime mode, use Runtime field; otherwise use Duration
        const raw = useRuntimeMode ? entry.scene.Runtime : entry.scene.Duration;
        if (!raw) {
            return { durationMs: 0, rawDuration: raw }; // No field
        }
        
        if (useRuntimeMode) {
            // Parse Runtime (seconds-based) and convert to ms
            const seconds = parseRuntimeField(raw);
            if (seconds === null) {
                return { durationMs: null, rawDuration: raw }; // Unparseable
            }
            return { durationMs: seconds * 1000, rawDuration: raw };
        } else {
            // Parse Duration (ms-based)
            const value = parseDuration(raw);
            if (value === null) {
                return { durationMs: null, rawDuration: raw }; // Unparseable (e.g., "ongoing")
            }
            return { durationMs: value, rawDuration: raw };
        }
    });

    // Collect valid (parseable, positive) durations
    const validDurationValues: number[] = [];
    parsedDurations.forEach(info => {
        if (info.durationMs && info.durationMs > 0) {
            validDurationValues.push(info.durationMs);
        }
    });

    if (validDurationValues.length === 0 && !parsedDurations.some(d => d.durationMs === null || d.durationMs === 0)) {
        return null;
    }

    // Scale arcs proportionally: longest duration fills 100% of available arc space
    const observedMaxDurationMs = validDurationValues.length > 0
        ? Math.max(...validDurationValues)
        : 0;
    const scaleMs = observedMaxDurationMs > 0 ? observedMaxDurationMs : 1;

    // Detect overlaps (when scene.when + duration > nextScene.when)
    const overlapIndices = detectSceneOverlaps(sortedEntries.map(entry => ({
        when: entry.date,
        Duration: entry.scene.Duration
    })));

    const durationPaths: string[] = [];
    const runtimeLabels: string[] = []; // Runtime tick labels (mm:ss) at arc ends

    const TWO_PI = Math.PI * 2;
    const STUB_FILL_RATIO = 0.20; // Red stub fills 20% of scene arc
    const TICK_MARK_LENGTH = 6; // Short tick mark at arc end

    sortedEntries.forEach((entry, idx) => {
        const durationInfo = parsedDurations[idx];
        const durationMs = durationInfo.durationMs;
        
        // Where this scene sits on the outer ring — same canonical key the
        // renderer stored it under.
        const outerRingPosition = scenePositions.get(sceneKey(entry.scene));
        if (!outerRingPosition) {
            return;
        }

        // Add 2px margins on both sides of the duration arc
        const marginAngle = 2 / arcRadius; // Convert 2px to radians
        const startAngle = outerRingPosition.startAngle + marginAngle;
        const endAngle = outerRingPosition.endAngle - marginAngle;
        const availableAngle = endAngle - startAngle;
        
        if (availableAngle <= 0) return;

        let spanAngle: number;
        let isUnparseable = false;
        let isOngoing = false;
        let isOverlap = overlapIndices.has(idx);

        // Determine arc span based on duration type
        if (durationMs === null || durationMs === 0) {
            // Check if it's specifically "ongoing" (case-insensitive)
            if (durationInfo.rawDuration && durationInfo.rawDuration.toLowerCase().trim() === 'ongoing') {
                // "ongoing" fills the entire scene arc with standard color
                spanAngle = availableAngle;
                isOngoing = true;
                isOverlap = true;
            } else {
                // No duration field OR unparseable durations (e.g., "TBD", "unknown") - show red stub
                spanAngle = availableAngle * STUB_FILL_RATIO;
                isUnparseable = true;
            }
        } else {
            // Valid duration - proportional to selected cap (longest scene fills 100% if no cap)
            const ratio = scaleMs > 0 ? Math.min(durationMs / scaleMs, 1) : 1;
            spanAngle = availableAngle * ratio;
        }

        if (spanAngle <= 0) return;

        const arcStart = startAngle;
        const arcEnd = arcStart + spanAngle;
        const largeArcFlag = spanAngle > Math.PI ? 1 : 0;

        // Determine arc class and styling
        let arcClass = 'rt-duration-arc';
        if (isUnparseable) {
            arcClass += ' rt-duration-arc-unparseable'; // Red stub for unparseable
        }
        // In Runtime mode, overlaps don't apply (Runtime is scene duration, not temporal overlap)
        if (isOverlap && !useRuntimeMode) {
            arcClass += ' rt-duration-arc-overlap'; // Yellow dotted for overlaps and ongoing
        }
        if (isOngoing && !useRuntimeMode) {
            arcClass += ' rt-duration-arc-ongoing'; // Additional tag for ongoing durations (not for Runtime)
        }

        const x1 = formatNumber(arcRadius * Math.cos(arcStart));
        const y1 = formatNumber(arcRadius * Math.sin(arcStart));
        const x2 = formatNumber(arcRadius * Math.cos(arcEnd));
        const y2 = formatNumber(arcRadius * Math.sin(arcEnd));

        durationPaths.push(
            `<path d="M ${x1} ${y1} A ${formatNumber(arcRadius)} ${formatNumber(arcRadius)} 0 ${largeArcFlag} 1 ${x2} ${y2}" class="${arcClass}" />`
        );

        // In runtime mode, add tick mark and mm:ss label at arc end for valid runtimes
        if (useRuntimeMode && durationMs && durationMs > 0 && !isUnparseable) {
            const runtimeSeconds = durationMs / 1000;
            const runtimeLabel = formatRuntimeValue(runtimeSeconds);
            
            // Tick mark at arc end - positioned 3px inward, extended 4px outward
            const tickInnerRadius = arcRadius - 3; // 3px inward from arc
            const tickOuterRadius = arcRadius + TICK_MARK_LENGTH + 4; // 4px longer outward
            const tickInnerX = formatNumber(tickInnerRadius * Math.cos(arcEnd));
            const tickInnerY = formatNumber(tickInnerRadius * Math.sin(arcEnd));
            const tickOuterX = formatNumber(tickOuterRadius * Math.cos(arcEnd));
            const tickOuterY = formatNumber(tickOuterRadius * Math.sin(arcEnd));
            
            runtimeLabels.push(
                `<line x1="${tickInnerX}" y1="${tickInnerY}" x2="${tickOuterX}" y2="${tickOuterY}" class="rt-runtime-tick-mark" />`
            );
            
            // ═══════════════════════════════════════════════════════════════════
            // DURATION RUNTIME LABEL POSITIONING (e.g., "12:06" at end of scene arc)
            // ═══════════════════════════════════════════════════════════════════
            // 
            // LABEL_OFFSET_RAD: Angular offset from arc end (in radians)
            //   - Positive = clockwise (after arc end, toward next scene)
            //   - Negative = counter-clockwise (before arc end, toward scene start)
            //   - Current: 0.003 rad ≈ 0.17° - just past the tick mark
            //
            // labelRadius: Distance from center to label position
            //   - DECREASE = closer to center (inward toward arc)
            //   - INCREASE = further from center (outward away from arc)
            //   - arcRadius is the duration arc's radius (~758px)
            //   - Current: arcRadius - 2 = label starts 2px inside the arc
            //
            const LABEL_OFFSET_RAD = 0.01;
            const labelAngle = arcEnd + LABEL_OFFSET_RAD;
            const labelRadius = arcRadius - 5; // 2px inside the arc (DECREASE to move inward)
            const labelX = formatNumber(labelRadius * Math.cos(labelAngle));
            const labelY = formatNumber(labelRadius * Math.sin(labelAngle));
            
            // Rotation: text oriented radially (perpendicular to arc tangent)
            // rotationDeg = angle in degrees, text baseline follows the radius
            const normalizedAngle = ((labelAngle % TWO_PI) + TWO_PI) % TWO_PI;
            let rotationDeg = labelAngle * 180 / Math.PI;
            
            // Flip text on left side of circle (9 o'clock to 3 o'clock via bottom)
            // so it's always readable (not upside down)
            const isLeftSide = normalizedAngle > Math.PI * 0.5 && normalizedAngle < Math.PI * 1.5;
            // text-anchor controls which end of text is at the position:
            //   'start' = left edge of text at position (text extends rightward/outward)
            //   'end' = right edge of text at position (text extends leftward/inward)
            let textAnchor = 'start';
            if (isLeftSide) {
                rotationDeg += 180; // Flip text so it reads correctly
                textAnchor = 'end'; // Swap anchor to maintain visual consistency
            }
            
            runtimeLabels.push(
                `<text x="${labelX}" y="${labelY}" text-anchor="${textAnchor}" dominant-baseline="middle" transform="rotate(${formatNumber(rotationDeg)}, ${labelX}, ${labelY})" class="rt-runtime-tick-label">${runtimeLabel}</text>`
            );
        }
    });
    
    if (durationPaths.length === 0) {
        return null;
    }
    
    // Include runtime labels in the output if any
    const labelsGroup = runtimeLabels.length > 0 
        ? `<g class="rt-runtime-tick-labels">${runtimeLabels.join('')}</g>` 
        : '';
    
    return `<g class="rt-chronologue-duration-ticks">
        ${durationPaths.join('')}
        ${labelsGroup}
    </g>`;
}

/**
 * Map a time value to an angular position on the timeline arc
 */
function mapTimeToAngle(timeMs: number, startMs: number, endMs: number): number {
    const progress = (timeMs - startMs) / (endMs - startMs);
    return progress * 2 * Math.PI - Math.PI / 2; // Start at top (12 o'clock)
}

/**
 * Render elapsed time arc between two selected scenes (fallback when geometry not available)
 * Note: This is rarely used - the main path in ChronologueShiftController handles most cases
 */

/**
 * Arc 1: Chronological Timeline Backbone
 * Renders discontinuity symbols "∞" at large time gaps between consecutive scenes
 * 
 * @param scenes - Scenes with When dates (sorted chronologically)
 * @param outerRingInnerRadius - Inner radius of the outer scene ring
 * @param outerRingOuterRadius - Outer radius of the outer scene ring
 * @param discontinuityThreshold - Gap multiplier for discontinuity detection (default 3x median)
 * @param scenePositions - Map of scene angular positions (manuscript order, keyed by scene path/title)
 * @param precomputedEntries - Optional pre-computed chronologue scene entries
 * @param customThresholdMs - Optional: Absolute threshold in milliseconds. If provided, gaps larger than this are considered discontinuities.
 * @returns SVG string
 */
export function renderChronologicalBackboneArc(
    scenes: TimelineItem[],
    outerRingInnerRadius: number,
    outerRingOuterRadius: number,
    discontinuityThreshold: number = 3,
    scenePositions?: Map<string, { startAngle: number; endAngle: number }>,
    precomputedEntries?: ChronologueSceneEntry[],
    customThresholdMs?: number
): string {
    const sceneEntries = precomputedEntries ?? collectChronologueSceneEntries(scenes);
    if (sceneEntries.length === 0 || !scenePositions) return '';

    // USE THE SAME HELPER AS SETTINGS - SINGLE SOURCE OF TRUTH
    const preparedScenes = prepareScenesForDiscontinuityDetection(scenes);
    
    if (preparedScenes.length < 3) return '';
    
    // Calculate what the auto threshold would be
    const autoThreshold = calculateAutoDiscontinuityThreshold(scenes);
    
    // Use custom threshold if provided, otherwise use the calculated auto threshold
    const effectiveThreshold = customThresholdMs ?? autoThreshold;
    
    if (!effectiveThreshold || effectiveThreshold <= 0) {
        return '';
    }
    
    // Detect discontinuities using the effective threshold
    const discontinuityIndices = detectDiscontinuities(preparedScenes, effectiveThreshold);
    
    if (discontinuityIndices.length === 0) {
        return '';
    }
    
    // Build a map from timestamp to sceneEntry for positioning
    const timestampToEntry = new Map<number, ChronologueSceneEntry>();
    sceneEntries.forEach(entry => {
        if (entry.scene.itemType === 'Scene') {
            timestampToEntry.set(entry.date.getTime(), entry);
        }
    });
    
    // Place discontinuity markers at the exact middle of the outer scene ring (radially)
    const markerRadius = (outerRingInnerRadius + outerRingOuterRadius) / 2;
    
    let svg = `<g class="rt-chronologue-backbone-discontinuities">`;
    
    // Add discontinuity "∞" symbols at detected gaps
    discontinuityIndices.forEach(sceneIndex => {
        if (sceneIndex >= preparedScenes.length) return;
        
        const currScene = preparedScenes[sceneIndex];
        const nextScene = sceneIndex < preparedScenes.length - 1 ? preparedScenes[sceneIndex + 1] : null;
        
        // Check if adjacent scenes have very close timestamps
        const TIME_TOLERANCE_MS = 60000; // 1 minute
        const hasAdjacentSameTime = nextScene && 
            Math.abs(currScene.when.getTime() - nextScene.when.getTime()) < TIME_TOLERANCE_MS;
        
        if (hasAdjacentSameTime) {
            return;
        }
        
        // Find the scene entry for positioning
        const sceneEntry = timestampToEntry.get(currScene.when.getTime());
        if (!sceneEntry) return;
        
        // Where this scene sits on the outer ring — same canonical key the
        // renderer stored it under.
        const outerRingPosition = scenePositions.get(sceneKey(sceneEntry.scene));

        if (!outerRingPosition) return;
        
        // Position the "∞" at the MIDDLE of the scene arc (both angularly and radially)
        const midAngle = (outerRingPosition.startAngle + outerRingPosition.endAngle) / 2;
        
        const x = formatNumber(markerRadius * Math.cos(midAngle));
        const y = formatNumber(markerRadius * Math.sin(midAngle));
        
        // Calculate dynamic font size based on angular width of the scene slice
        const angularWidth = outerRingPosition.endAngle - outerRingPosition.startAngle;
        const arcLengthAtMarker = markerRadius * angularWidth; // Arc length in pixels
        
        // Scale font-size to fit within the slice: aim for 60% of arc length to prevent overflow
        // Clamp between 8px (minimum readable) and 20px (maximum for large slices)
        const dynamicFontSize = Math.max(8, Math.min(20, arcLengthAtMarker * 0.6));
        
        // Scale stroke-width proportionally: maintain stroke:font ratio of ~0.3
        const dynamicStrokeWidth = Math.max(2, Math.min(6, dynamicFontSize * 0.3));
        
        // Discontinuity symbol "∞" centered in the middle of the scene arc with dynamic sizing
        svg += `<text x="${x}" y="${y}" class="rt-discontinuity-marker" text-anchor="middle" dominant-baseline="middle" font-size="${formatNumber(dynamicFontSize)}" stroke-width="${formatNumber(dynamicStrokeWidth)}">∞</text>`;
    });
    
    svg += `</g>`;
    
    return svg;
}

/**
 * Arc 2: TimelineItem Duration Overlay
 * Renders colored arc segments showing each scene's duration
 * Red segments indicate temporal overlaps
 * 
 * @param scenes - Scenes with When dates and Duration fields (sorted chronologically)
 * @param outerRadius - Outer radius of scene ring
 * @returns SVG string
 */
export function renderSceneDurationArcs(
    scenes: TimelineItem[],
    outerRadius: number
): string {
    // Detect overlaps
    const overlapIndices = detectSceneOverlaps(scenes);
    
    // Parse dates and calculate time range
    const validScenes: { scene: TimelineItem; date: Date; index: number }[] = [];
    scenes.forEach((scene, index) => {
        const whenDate =
            scene.when instanceof Date
                ? scene.when
                : parseWhenField(typeof scene.when === 'string' ? scene.when : '');
        if (whenDate) {
            validScenes.push({ scene, date: whenDate, index });
        }
    });
    
    if (validScenes.length === 0) return '';
    
    const earliestMs = Math.min(...validScenes.map(s => s.date.getTime()));
    const latestMs = Math.max(...validScenes.map(s => s.date.getTime()));
    const totalMs = latestMs - earliestMs;
    
    if (totalMs === 0) return ''; // All scenes at same time
    
    const arcRadius = outerRadius + 9; // Position outside backbone arc
    const arcWidth = 3.5;
    
    let svg = `<g class="rt-scene-duration-arcs">`;
    
    validScenes.forEach(({ scene, date, index }) => {
        const durationMs = parseDuration(scene.Duration);
        if (!durationMs || durationMs === 0) return; // Skip scenes without duration
        
        // Calculate arc segment
        const startMs = date.getTime();
        const endMs = startMs + durationMs;
        
        const startAngle = mapTimeToAngle(startMs, earliestMs, latestMs);
        const endAngle = mapTimeToAngle(Math.min(endMs, latestMs), earliestMs, latestMs);
        
        // Determine color based on overlap
        const hasOverlap = overlapIndices.has(index);
        const color = hasOverlap ? 'var(--text-error)' : 'var(--text-success)';
        const opacity = Math.min(0.3 + (durationMs / (24 * 60 * 60 * 1000)) * 0.1, 0.8); // Opacity based on duration
        
        // Create arc path
        const largeArcFlag = (endAngle - startAngle) > Math.PI ? 1 : 0;
        const x1 = formatNumber(arcRadius * Math.cos(startAngle));
        const y1 = formatNumber(arcRadius * Math.sin(startAngle));
        const x2 = formatNumber(arcRadius * Math.cos(endAngle));
        const y2 = formatNumber(arcRadius * Math.sin(endAngle));
        
        const arcPath = `M ${x1} ${y1} A ${formatNumber(arcRadius)} ${formatNumber(arcRadius)} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
        
        svg += `<path d="${arcPath}" fill="none" stroke="${color}" stroke-width="${arcWidth}" opacity="${opacity}" class="rt-duration-arc ${hasOverlap ? 'rt-overlap' : ''}"/>`;
    });
    
    svg += `</g>`;
    
    return svg;
}
