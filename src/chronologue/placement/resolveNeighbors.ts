/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Placement — Neighbour Resolution
 *
 * Dropping on scene B means "place immediately before B". The bounding scenes
 * are read from the chronological sequence WITH THE DRAGGED SCENE REMOVED —
 * without that removal, dragging a scene backwards computes its bounds from a
 * sequence that still holds it at its old slot, and the bounds come out wrong.
 */

import { parseDuration } from '../../utils/date';
import type { PlacementInterval, PlacementNeighbor, SeamChoice } from './types';

/** Minimal shape the resolver needs — a TimelineItem satisfies it. */
export interface PlacementSceneInput {
    path?: string;
    title?: string;
    when?: Date;
    Duration?: string;
}

export type NeighborResolution =
    | { kind: 'ok'; interval: PlacementInterval }
    /** Dropped on the first scene: on a circle, "before first" and "after last" are the same arc. */
    | { kind: 'seam' }
    /** Dropping here would not move the scene. */
    | { kind: 'noop' }
    /** A bounding scene has no readable When, so the interval has no numeric edge. */
    | { kind: 'undated'; sceneTitle: string }
    | { kind: 'not_found' };

/** Fallback span for an open bound when the sequence is too short to have a median gap. */
const DEFAULT_OPEN_SPAN_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the interval a drop lands in.
 *
 * @param sequence - Chronologue order, from `buildChronologueSceneSequence`.
 * @param draggedPath - Vault path of the scene being dragged.
 * @param targetPath - Vault path of the scene it was dropped on.
 * @param seamChoice - Which end the author meant, for first-scene drops.
 */
export function resolvePlacementNeighbors(
    sequence: PlacementSceneInput[],
    draggedPath: string,
    targetPath: string,
    seamChoice: SeamChoice | null = null
): NeighborResolution {
    if (draggedPath === targetPath) return { kind: 'noop' };

    const originalIndex = sequence.findIndex(scene => scene.path === draggedPath);
    if (originalIndex === -1) return { kind: 'not_found' };

    // The dragged scene must not bound itself.
    const remaining = sequence.filter(scene => scene.path !== draggedPath);
    const targetIndex = remaining.findIndex(scene => scene.path === targetPath);
    if (targetIndex === -1) return { kind: 'not_found' };

    const openSpanMs = medianGapMs(remaining);

    // The seam is tested BEFORE the interior no-op. Dropping the first scene on
    // the second one reads as an interior no-op, but it is the only gesture that
    // can reach the seam for that scene — swallowing it as a no-op would leave
    // the first scene with no way to reach the end of the chronology.
    if (targetIndex === 0) {
        if (seamChoice === null) return { kind: 'seam' };
        if (seamChoice === 'before-first') {
            // Already first: there is nothing in front of it to move ahead of.
            if (originalIndex === 0) return { kind: 'noop' };
            return buildInterval(null, remaining[0], openSpanMs);
        }
        // Already last: it is where "after the closing scene" would put it.
        if (originalIndex === sequence.length - 1) return { kind: 'noop' };
        return buildInterval(remaining[remaining.length - 1], null, openSpanMs);
    }

    // Already sitting immediately before the target: nothing to place.
    if (sequence[originalIndex + 1]?.path === targetPath) return { kind: 'noop' };

    return buildInterval(remaining[targetIndex - 1], remaining[targetIndex], openSpanMs);
}

/** Both seam intervals, for the modal's before-first / after-last toggle. */
export function resolveSeamIntervals(
    sequence: PlacementSceneInput[],
    draggedPath: string
): { beforeFirst: NeighborResolution; afterLast: NeighborResolution } {
    const remaining = sequence.filter(scene => scene.path !== draggedPath);
    const firstPath = remaining[0]?.path ?? ''; // SAFE: empty path yields not_found below, which the caller already handles
    return {
        beforeFirst: resolvePlacementNeighbors(sequence, draggedPath, firstPath, 'before-first'),
        afterLast: resolvePlacementNeighbors(sequence, draggedPath, firstPath, 'after-last')
    };
}

function buildInterval(
    lower: PlacementSceneInput | null,
    upper: PlacementSceneInput | null,
    openSpanMs: number
): NeighborResolution {
    const lowerNeighbor = lower ? toNeighbor(lower) : null;
    if (lower && !lowerNeighbor) return { kind: 'undated', sceneTitle: describeScene(lower) };

    const upperNeighbor = upper ? toNeighbor(upper) : null;
    if (upper && !upperNeighbor) return { kind: 'undated', sceneTitle: describeScene(upper) };

    if (!lowerNeighbor && !upperNeighbor) return { kind: 'not_found' };

    const lowerMs = lowerNeighbor
        ? lowerNeighbor.when.getTime()
        : upperNeighbor!.when.getTime() - openSpanMs;
    const upperMs = upperNeighbor
        ? upperNeighbor.when.getTime()
        : lowerNeighbor!.when.getTime() + openSpanMs;

    return { kind: 'ok', interval: { lowerMs, upperMs, lowerNeighbor, upperNeighbor } };
}

function toNeighbor(scene: PlacementSceneInput): PlacementNeighbor | null {
    if (!(scene.when instanceof Date) || Number.isNaN(scene.when.getTime())) return null;
    return {
        path: scene.path ?? '', // SAFE: identity is only used for display here; the interval is numeric
        title: describeScene(scene),
        when: scene.when,
        durationMs: parseDuration(scene.Duration)
    };
}

function describeScene(scene: PlacementSceneInput): string {
    const title = scene.title?.trim();
    if (title) return title;
    const basename = scene.path?.split('/').pop();
    return basename ?? 'Untitled scene'; // SAFE: UX label for a scene with neither title nor path
}

/**
 * Median gap between dated scenes — the span used to extend an open bound so
 * "before the first scene" has somewhere to put a date. Derived from the
 * manuscript's own rhythm rather than an arbitrary constant.
 */
function medianGapMs(sequence: PlacementSceneInput[]): number {
    const times = sequence
        .map(scene => scene.when)
        .filter((when): when is Date => when instanceof Date && !Number.isNaN(when.getTime()))
        .map(when => when.getTime())
        .sort((a, b) => a - b);

    const gaps: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
        const gap = times[i] - times[i - 1];
        if (gap > 0) gaps.push(gap);
    }
    if (gaps.length === 0) return DEFAULT_OPEN_SPAN_MS;

    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
}
