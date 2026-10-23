/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * Narrative runtime: how long the book runs in the order it is presented.
 *
 * Runtime belongs to narrative order — the order a reader or listener meets the
 * scenes — so every sum here walks the outer ring as the wheel draws it. Slices
 * keep their equal angular extents; runtime is drawn inside each slice and never
 * resizes it.
 */

import type { TimelineItem } from '../../types';
import { parseRuntimeField, formatRuntimeValue } from '../../utils/runtimeEstimator';
import { sceneKey } from '../../utils/sceneHelpers';

/** One scene on the outer ring, with where its slice sits and how long it runs. */
export interface NarrativeRuntimeEntry {
    scene: TimelineItem;
    startAngle: number;
    endAngle: number;
    /** Runtime in seconds; null when the scene has no positive, readable Runtime. */
    runtimeSeconds: number | null;
}

/** A perimeter tick for the runtime view; labelled ticks carry the cumulative runtime. */
export interface NarrativeRuntimeTick {
    angle: number;
    label: string | null;
    isFirst?: boolean;
    isLast?: boolean;
}

/**
 * Smallest angle between two labelled ticks, and between a labelled tick and the
 * closing total. A seven-character label ("1:23:45") at the perimeter radius
 * spans roughly 0.07 rad, so this keeps neighbouring labels clear of each other.
 */
export const NARRATIVE_RUNTIME_LABEL_GAP_RAD = 0.09;

/** A scene's Runtime in seconds, or null when it is missing, unreadable or zero. */
export function readSceneRuntimeSeconds(scene: Pick<TimelineItem, 'Runtime'>): number | null {
    const parsed = parseRuntimeField(scene.Runtime);
    return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * The scenes on the outer ring in narrative order. The ring runs clockwise from
 * 12 o'clock in the order the wheel presents the book, so slice angle is the
 * order; beats and other items carry no runtime and are left out.
 */
export function collectNarrativeRuntimeEntries(
    scenes: TimelineItem[],
    positions: Map<string, { startAngle: number; endAngle: number }>
): NarrativeRuntimeEntry[] {
    const seen = new Set<string>();
    const entries: NarrativeRuntimeEntry[] = [];
    scenes.forEach(scene => {
        if (scene.itemType !== 'Scene') return;
        const key = sceneKey(scene);
        if (seen.has(key)) return;
        const position = positions.get(key);
        if (!position) return;
        seen.add(key);
        entries.push({
            scene,
            startAngle: position.startAngle,
            endAngle: position.endAngle,
            runtimeSeconds: readSceneRuntimeSeconds(scene)
        });
    });
    return entries.sort((a, b) => a.startAngle - b.startAngle);
}

/**
 * Runtime presented before each scene, and the book's total. The first scene
 * starts at zero; scenes without a runtime add nothing.
 */
export function runtimeBeforeEachScene(runtimes: Array<number | null>): { before: number[]; total: number } {
    let total = 0;
    const before = runtimes.map(seconds => {
        const start = total;
        total += seconds !== null && seconds > 0 ? seconds : 0;
        return start;
    });
    return { before, total };
}

/**
 * Runtime of every scene from one selected scene to the other, both included,
 * in narrative order. The two indices may come in either order.
 */
export function inclusiveRuntimeBetween(runtimes: Array<number | null>, indexA: number, indexB: number): number {
    const from = Math.min(indexA, indexB);
    const to = Math.max(indexA, indexB);
    let total = 0;
    for (let i = from; i <= to; i++) {
        const seconds = runtimes[i];
        if (seconds !== null && seconds !== undefined && seconds > 0) total += seconds;
    }
    return total;
}

/**
 * Perimeter ticks for the runtime view: one at each scene's start, labelled with
 * the runtime presented before it, and a closing tick at the end of the last
 * scene labelled with the total. Labels are spaced at least
 * NARRATIVE_RUNTIME_LABEL_GAP_RAD apart; the rest stay unlabelled ticks.
 */
export function buildNarrativeRuntimeTicks(entries: NarrativeRuntimeEntry[]): NarrativeRuntimeTick[] {
    if (entries.length === 0) return [];
    const { before, total } = runtimeBeforeEachScene(entries.map(entry => entry.runtimeSeconds));
    const endAngle = entries[entries.length - 1].endAngle;
    const ticks: NarrativeRuntimeTick[] = [];
    let lastLabelledAngle = Number.NEGATIVE_INFINITY;

    entries.forEach((entry, index) => {
        const isFirst = index === 0;
        const clearOfPrevious = entry.startAngle - lastLabelledAngle >= NARRATIVE_RUNTIME_LABEL_GAP_RAD;
        const clearOfTotal = endAngle - entry.startAngle >= NARRATIVE_RUNTIME_LABEL_GAP_RAD;
        if (isFirst || (clearOfPrevious && clearOfTotal)) {
            ticks.push({ angle: entry.startAngle, label: formatRuntimeValue(before[index]), isFirst: isFirst || undefined });
            lastLabelledAngle = entry.startAngle;
        } else {
            ticks.push({ angle: entry.startAngle, label: null });
        }
    });

    ticks.push({ angle: endAngle, label: formatRuntimeValue(total), isLast: true });
    return ticks;
}
