/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { escapeXml, formatNumber } from '../../utils/svg';
import { CHARACTER_LANE_HEIGHT } from '../layout/LayoutConstants';
import { characterLaneRadii, type CharacterLaneEntry } from '../utils/CharacterLanes';
import { sceneArcPath } from './SceneArcs';

export interface CharacterLanesParams {
    entries: CharacterLaneEntry[];
    /** Lane characters, outermost first. */
    characters: string[];
    /** Inner edge of the All Scenes ring; the lanes hang just inside it. */
    ringInnerRadius: number;
    /** The All Scenes ring's index, so a mark can find its scene's cell. */
    outerRing: number;
}

/** Gap kept clear at each side of a slice, in pixels along the lane. */
const SLICE_MARGIN_PX = 1.5;

/**
 * One lane per character under the All Scenes ring, each in its own color.
 * Each scene the character is in gets a mark in its slice: full height when
 * they are the POV character, half height (on the lane's inner edge)
 * otherwise. Each mark carries its scene's path, so hovering it lights the
 * scene. The names are not drawn on the wheel; each lane group carries its
 * character's name, and the ring key lists them beside their colors.
 */
export function renderCharacterLanes(params: CharacterLanesParams): string {
    const { entries, characters, ringInnerRadius, outerRing } = params;
    if (characters.length === 0) return '';

    const lanes = characters.map((name, index) => {
        const { inner, outer } = characterLaneRadii(ringInnerRadius, index);
        const mid = (inner + outer) / 2;
        let lane = `<circle class="ert-character-lane-track" r="${formatNumber(mid)}" stroke-width="${CHARACTER_LANE_HEIGHT}" />`;

        const margin = SLICE_MARGIN_PX / mid;
        entries.forEach(entry => {
            if (!entry.characters.present.includes(name)) return;
            const start = entry.startAngle + margin;
            const end = entry.endAngle - margin;
            if (end <= start) return;
            const isPov = entry.characters.pov.has(name);
            const top = isPov ? outer : inner + CHARACTER_LANE_HEIGHT / 2;
            const path = entry.scene.path ? encodeURIComponent(entry.scene.path) : '';
            lane += `<path class="ert-character-lane-mark${isPov ? ' ert-character-lane-mark-pov' : ''}" d="${sceneArcPath(inner, top, start, end)}" data-path="${path}" />`;
        });

        return `<g class="ert-character-lane" data-lane="${index}" data-character="${escapeXml(name)}">${lane}</g>`;
    });

    return `<g class="ert-character-lanes" data-ring="${outerRing}">${lanes.join('')}</g>`;
}
