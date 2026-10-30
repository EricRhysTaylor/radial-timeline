/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * Character lanes: thin lanes under Narrative's All Scenes ring that follow a
 * few characters through the book in the order a reader meets the scenes.
 *
 * A scene's Character list says who is in it, and its POV comes from the same
 * rule the synopsis uses (resolveScenePov). Which characters get a lane is
 * decided here, from the scenes alone, so the choice needs no stored setting.
 */

import type { TimelineItem } from '../../types';
import type { GlobalPovMode } from '../../types/settings';
import { resolveScenePov } from '../../utils/pov';
import { isSceneItem, sceneKey } from '../../utils/sceneHelpers';
import { CHARACTER_LANE_GAP, CHARACTER_LANE_HEIGHT, CHARACTER_LANE_PADDING } from '../layout/LayoutConstants';

/** Most lanes drawn; past four, titles in a busy wheel run out of room. */
export const MAX_CHARACTER_LANES = 4;

/** The characters a scene puts on the lanes. */
export interface SceneCharacters {
    /** Distinct names from Character, in list order. */
    present: string[];
    /** The names resolveScenePov marks as POV. */
    pov: Set<string>;
}

/** Character lanes are a Narrative feature, turned on in the POV settings. */
export function characterLanesActive(settings: { currentMode?: string; showCharacterLanes?: boolean }): boolean {
    return settings.showCharacterLanes === true && (settings.currentMode || 'narrative') === 'narrative';
}

/** One scene on the outer ring, with its slice and who is in it. */
export interface CharacterLaneEntry {
    scene: TimelineItem;
    startAngle: number;
    endAngle: number;
    characters: SceneCharacters;
}

/** Each scene once (a scene on several subplots is listed once per ring), with beats, backdrops and matter notes left out. */
export function laneScenes(scenes: TimelineItem[]): TimelineItem[] {
    const seen = new Set<string>();
    return scenes.filter(scene => {
        if (!isSceneItem(scene)) return false;
        const key = sceneKey(scene);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** The scenes on the outer ring in the order the wheel draws them, clockwise from 12 o'clock. */
export function collectCharacterLaneEntries(
    scenes: TimelineItem[],
    positions: Map<string, { startAngle: number; endAngle: number }>,
    globalPovMode: GlobalPovMode | undefined
): CharacterLaneEntry[] {
    const entries: CharacterLaneEntry[] = [];
    laneScenes(scenes).forEach(scene => {
        const position = positions.get(sceneKey(scene));
        if (!position) return;
        entries.push({
            scene,
            startAngle: position.startAngle,
            endAngle: position.endAngle,
            characters: readSceneCharacters(scene, globalPovMode)
        });
    });
    return entries.sort((a, b) => a.startAngle - b.startAngle);
}

export function readSceneCharacters(
    scene: Pick<TimelineItem, 'Character' | 'pov'>,
    globalPovMode: GlobalPovMode | undefined
): SceneCharacters {
    const names = (scene.Character || []).map(name => (typeof name === 'string' ? name.trim() : ''));
    const present = [...new Set(names.filter(name => name.length > 0))];
    const pov = new Set<string>();
    resolveScenePov(scene, { globalMode: globalPovMode }).characterMarkers.forEach(marker => {
        const name = names[marker.index];
        if (name) pov.add(name);
    });
    return { present, pov };
}

/**
 * The characters that get a lane, outermost first: the ones who hold POV in
 * the most scenes; if fewer than MAX_CHARACTER_LANES ever hold POV, the rest
 * are the ones who appear in the most scenes. Ties go to the character who
 * appears first. `scenes` must be in the order the wheel presents them.
 */
export function chooseLaneCharacters(scenes: SceneCharacters[]): string[] {
    const stats = new Map<string, { pov: number; appearances: number; first: number }>();
    scenes.forEach((scene, index) => {
        scene.present.forEach(name => {
            const entry = stats.get(name) ?? { pov: 0, appearances: 0, first: index };
            entry.appearances += 1;
            if (scene.pov.has(name)) entry.pov += 1;
            stats.set(name, entry);
        });
    });

    const all = Array.from(stats.entries());
    const povHolders = all
        .filter(([, entry]) => entry.pov > 0)
        .sort(([, a], [, b]) => b.pov - a.pov || a.first - b.first)
        .map(([name]) => name);
    const chosen = povHolders.slice(0, MAX_CHARACTER_LANES);
    if (chosen.length < MAX_CHARACTER_LANES) {
        const taken = new Set(chosen);
        all
            .filter(([name]) => !taken.has(name))
            .sort(([, a], [, b]) => b.appearances - a.appearances || a.first - b.first)
            .slice(0, MAX_CHARACTER_LANES - chosen.length)
            .forEach(([name]) => chosen.push(name));
    }
    return chosen;
}

/** Radial space the lanes take under the All Scenes ring; none without lanes. */
export function characterLaneBandWidth(laneCount: number): number {
    if (laneCount <= 0) return 0;
    return laneCount * CHARACTER_LANE_HEIGHT + (laneCount - 1) * CHARACTER_LANE_GAP + 2 * CHARACTER_LANE_PADDING;
}

/** Inner and outer radius of lane `index` (0 is outermost) under a ring whose inner edge is `ringInnerRadius`. */
export function characterLaneRadii(ringInnerRadius: number, index: number): { inner: number; outer: number } {
    const outer = ringInnerRadius - CHARACTER_LANE_PADDING - index * (CHARACTER_LANE_HEIGHT + CHARACTER_LANE_GAP);
    return { inner: outer - CHARACTER_LANE_HEIGHT, outer };
}
