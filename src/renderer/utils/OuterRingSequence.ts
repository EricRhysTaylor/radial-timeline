/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * OuterRingSequence — builds the all-scenes outer ring for one segment (act or
 * saga book): which items it contains, in what order, at what angles.
 *
 * This is the single source of truth for that sequence. The arcs and the number
 * squares are drawn in two separate passes over the same data; when each pass
 * built the list itself, the two copies had to be kept in lockstep by hand (the
 * old call sites carried a "CRITICAL: sort the same way as main rendering"
 * comment saying exactly that). Any divergence — a different dedupe key, a
 * different sort — silently detaches a square from its arc.
 */

import type { TimelineItem } from '../../types';
import { isBeatNote, sceneKey, sortScenes } from '../../utils/sceneHelpers';
import { resolveDominantScene } from '../components/SubplotDominanceIndicators';
import { computePositions, type PositionInfo } from './SceneLayout';

export interface OuterRingSequence {
    /** Deduped, dominance-resolved, sorted items in draw order. */
    items: TimelineItem[];
    /** Angular placement by index into `items`. */
    positions: Map<number, PositionInfo>;
    /**
     * Angular placement by canonical item key. This is what subplot rings read
     * to align with the outer ring, and what any later pass reads to find an
     * item's angle without re-deriving the sequence.
     */
    positionByKey: Map<string, PositionInfo>;
    /**
     * Scene paths whose stored dominant-subplot preference no longer matches any
     * candidate. The caller owns settings, so the caller clears them.
     */
    staleDominantPaths: string[];
}

export function buildOuterRingSequence(params: {
    scenes: TimelineItem[];
    /** Act index, or book index under saga scope. */
    segment: number;
    isSagaScope: boolean;
    /** When true the ring spans the full circle and holds every segment's items. */
    sortByWhen: boolean;
    forceChronological: boolean;
    includeBeats: boolean;
    masterSubplotOrder: string[];
    dominantSubplots?: Record<string, string>;
    innerR: number;
    outerR: number;
    startAngle: number;
    endAngle: number;
}): OuterRingSequence {
    const {
        scenes,
        segment,
        isSagaScope,
        sortByWhen,
        forceChronological,
        includeBeats,
        masterSubplotOrder,
        dominantSubplots,
        innerR,
        outerR,
        startAngle,
        endAngle
    } = params;

    const seenBeatKeys = new Set<string>();
    const combined: TimelineItem[] = [];
    const scenesByKey = new Map<string, TimelineItem[]>();

    scenes.forEach(item => {
        if (item.itemType === 'Backdrop') return;

        if (!sortByWhen) {
            const itemSegment = isSagaScope
                ? (typeof item.bookIndex === 'number' ? item.bookIndex : 0)
                : (item.actNumber !== undefined ? item.actNumber - 1 : 0);
            if (itemSegment !== segment) return;
        }

        if (isBeatNote(item)) {
            if (!includeBeats) return;
            const beatKey = `${String(item.title || '')}::${String(item.actNumber ?? '')}`;
            if (seenBeatKeys.has(beatKey)) return;
            seenBeatKeys.add(beatKey);
            combined.push(item);
            return;
        }

        // The same scene file appears once per subplot it belongs to; the outer
        // ring shows it once, under whichever subplot wins dominance below.
        const key = sceneKey(item);
        const group = scenesByKey.get(key);
        if (group) group.push(item);
        else scenesByKey.set(key, [item]);
    });

    const staleDominantPaths: string[] = [];
    scenesByKey.forEach(candidateScenes => {
        const scenePath = candidateScenes[0].path;
        const resolution = resolveDominantScene({
            scenePath,
            candidateScenes,
            masterSubplotOrder,
            dominantSubplots
        });
        if (scenePath && resolution.storedPreference && !resolution.preferenceMatched) {
            staleDominantPaths.push(scenePath);
        }
        combined.push(resolution.scene);
    });

    const items = sortScenes(combined, sortByWhen, forceChronological);
    const positions = computePositions(innerR, outerR, startAngle, endAngle, items);

    const positionByKey = new Map<string, PositionInfo>();
    items.forEach((item, idx) => {
        if (isBeatNote(item)) return;
        const position = positions.get(idx);
        if (position) positionByKey.set(sceneKey(item), position);
    });

    return { items, positions, positionByKey, staleDominantPaths };
}
