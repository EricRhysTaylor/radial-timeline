/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Placement — Validator
 *
 * The one guarantee this feature makes: the scene lands in the slot the modal
 * promised. That is only true if the check runs on the STORED form, not the
 * in-memory Date — `formatWhenForYaml` truncates to minutes, so a candidate
 * 45 seconds inside a bound is written exactly ON it, and
 * `sortScenesChronologically` then resolves the tie by manuscript index rather
 * than by the drop position.
 */

import { formatWhenForYaml, parseWhenField } from '../../utils/date';
import type { OverlapWarning, PlacementInterval, PlacementVerdict } from './types';

/**
 * Minimum interval width. Two minutes guarantees at least one whole minute
 * strictly between the bounds once seconds are truncated.
 */
export const MIN_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Validate a candidate timestamp against the drop interval.
 *
 * @param candidate - Proposed date, from a generator, the custom field, or (Phase 2) an engine.
 * @param interval - The open interval the drop must land strictly inside.
 * @param draggedDurationMs - Parsed `Duration` of the dragged scene, or null.
 */
export function validatePlacement(
    candidate: Date | null,
    interval: PlacementInterval,
    draggedDurationMs: number | null
): PlacementVerdict {
    if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime())) {
        return {
            kind: 'rejected',
            reason: 'unparsable',
            message: 'That is not a date Radial Timeline can read.'
        };
    }

    if (interval.upperMs - interval.lowerMs < MIN_INTERVAL_MS) {
        return {
            kind: 'rejected',
            reason: 'no_room',
            message: 'These scenes are less than two minutes apart — there is no room between them.'
        };
    }

    // Round-trip through the stored form. This is the whole point of the check.
    const storedWhen = formatWhenForYaml(candidate);
    const readBack = parseWhenField(storedWhen);
    if (!readBack) {
        return {
            kind: 'rejected',
            reason: 'unparsable',
            message: 'That date cannot be stored in the When field.'
        };
    }

    const storedMs = readBack.getTime();
    if (storedMs <= interval.lowerMs || storedMs >= interval.upperMs) {
        return {
            kind: 'rejected',
            reason: 'outside_bounds',
            message: describeOutOfBounds(storedMs, interval)
        };
    }

    return {
        kind: 'ok',
        storedWhen,
        when: readBack,
        overlapWarning: detectOverlap(storedMs, interval, draggedDurationMs)
    };
}

function describeOutOfBounds(storedMs: number, interval: PlacementInterval): string {
    const atLower = storedMs === interval.lowerMs;
    const atUpper = storedMs === interval.upperMs;
    if (atLower || atUpper) {
        const twin = atLower ? interval.lowerNeighbor : interval.upperNeighbor;
        const twinLabel = twin ? `"${twin.title}"` : 'a neighbouring scene'; // SAFE: an open bound has no scene to name
        return `Stored to the minute this matches ${twinLabel} exactly, so the scene would not land where you dropped it.`;
    }
    return 'That date falls outside the two scenes you dropped between.';
}

/**
 * Duration collisions. Reported, never blocking — an author intercutting two
 * scenes is doing this on purpose.
 */
function detectOverlap(
    storedMs: number,
    interval: PlacementInterval,
    draggedDurationMs: number | null
): OverlapWarning | null {
    const previous = interval.lowerNeighbor;
    if (previous && previous.durationMs !== null && previous.durationMs > 0) {
        const previousEnd = previous.when.getTime() + previous.durationMs;
        if (previousEnd > storedMs) {
            return {
                kind: 'previous_runs_past',
                neighborTitle: previous.title,
                overlapMs: previousEnd - storedMs
            };
        }
    }

    const next = interval.upperNeighbor;
    if (next && draggedDurationMs !== null && draggedDurationMs > 0) {
        const draggedEnd = storedMs + draggedDurationMs;
        const nextStart = next.when.getTime();
        if (draggedEnd > nextStart) {
            return {
                kind: 'dragged_runs_past',
                neighborTitle: next.title,
                overlapMs: draggedEnd - nextStart
            };
        }
    }

    return null;
}
