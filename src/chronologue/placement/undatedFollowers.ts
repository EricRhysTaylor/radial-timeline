/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Placement — Undated Followers
 *
 * An undated scene has no time of its own, so Chronologue shows it beside a
 * dated scene chosen by manuscript order (`buildChronologicalPlacements`). Drag
 * that dated scene and every scene placed beside it moves too, although only
 * one When is written. The modal names them, and offers to date them where
 * they stand so the dragged scene moves alone.
 */

import type { TimelineItem } from '../../types';
import { formatWhenForYaml, parseWhenField } from '../../utils/date';
import { buildChronologicalPlacements, sceneKey } from '../../utils/sceneHelpers';

/** Anchoring follows manuscript order, never the date itself — any valid date marks the scene dated. */
const ANY_DATE = new Date(0);

export interface UndatedFollower {
    scene: TimelineItem;
    /**
     * The When that pins the scene where the author sees it now: the time it is
     * shown at, as it will be stored. Null when that time cannot be stored
     * exactly, which rules out keeping it in place.
     */
    keepWhen: { when: Date; storedWhen: string } | null;
}

/**
 * Undated scenes that will move with the dragged scene once its When is written.
 *
 * Membership is judged on the arrangement the write produces, not the current
 * one: a scene dragged while undated becomes dated, and that alone can make it
 * the scene its undated manuscript neighbours are shown beside. The keep date
 * is read from the current arrangement — where each scene stands today.
 *
 * @param sequence - Chronologue order, from `buildChronologueSceneSequence`.
 * @param draggedPath - Vault path of the scene being placed.
 */
export function findUndatedFollowers(sequence: TimelineItem[], draggedPath: string): UndatedFollower[] {
    if (!sequence.some(scene => scene.path === draggedPath)) return [];

    const afterWrite = sequence.map(scene => (scene.path === draggedPath ? { ...scene, when: ANY_DATE } : scene));
    const placementsAfter = buildChronologicalPlacements(afterWrite);
    const placementsNow = buildChronologicalPlacements(sequence);

    // A dated scene is its own anchor, so anything else anchored to the
    // dragged scene is necessarily undated.
    return sequence
        .filter(scene => scene.path !== draggedPath
            && placementsAfter.get(sceneKey(scene))?.anchor?.path === draggedPath)
        .map(scene => ({ scene, keepWhen: storableTime(placementsNow.get(sceneKey(scene))?.time) }));
}

/**
 * The stored form of a placement time, if it reads back as the same instant.
 * When is written at minute precision, so a time carrying seconds would be
 * pinned a little earlier than where the scene stands — and could reorder
 * against a scene inside that minute.
 */
function storableTime(time: number | undefined): UndatedFollower['keepWhen'] {
    if (time === undefined || !Number.isFinite(time)) return null;
    const storedWhen = formatWhenForYaml(new Date(time));
    const when = parseWhenField(storedWhen);
    if (!when || when.getTime() !== time) return null;
    return { when, storedWhen };
}
