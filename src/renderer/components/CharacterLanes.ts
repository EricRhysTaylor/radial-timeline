/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { escapeXml, formatNumber } from '../../utils/svg';
import { CHARACTER_LANE_HEIGHT } from '../layout/LayoutConstants';
import { characterLaneRadii, type CharacterLaneEntry } from '../utils/CharacterLanes';
import { arcPath } from '../layout/Paths';
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
/** Arc a lane's name may run along, ending at 12 o'clock. */
const LABEL_SPAN_RAD = Math.PI / 4;
const TWELVE_O_CLOCK = -Math.PI / 2;
/** A name stops this far short of 12 o'clock, clear of the act border there. */
const LABEL_END_INSET_PX = 6;

/**
 * One lane per character under the All Scenes ring. Each scene the character
 * is in gets a mark in its slice: full height when they are the POV
 * character, half height (on the lane's inner edge) otherwise. Each mark
 * carries its scene's path, so hovering it lights the scene.
 */
export function renderCharacterLanes(params: CharacterLanesParams): string {
    const { entries, characters, ringInnerRadius, outerRing } = params;
    if (characters.length === 0) return '';

    let tracks = '';
    let marks = '';
    let labels = '';

    characters.forEach((name, index) => {
        const { inner, outer } = characterLaneRadii(ringInnerRadius, index);
        const mid = (inner + outer) / 2;
        tracks += `<circle class="ert-character-lane-track" r="${formatNumber(mid)}" stroke-width="${CHARACTER_LANE_HEIGHT}" />`;

        const margin = SLICE_MARGIN_PX / mid;
        entries.forEach(entry => {
            if (!entry.characters.present.includes(name)) return;
            const start = entry.startAngle + margin;
            const end = entry.endAngle - margin;
            if (end <= start) return;
            const isPov = entry.characters.pov.has(name);
            const top = isPov ? outer : inner + CHARACTER_LANE_HEIGHT / 2;
            const path = entry.scene.path ? encodeURIComponent(entry.scene.path) : '';
            marks += `<path class="ert-character-lane-mark${isPov ? ' ert-character-lane-mark-pov' : ''}" d="${sceneArcPath(inner, top, start, end)}" data-path="${path}" data-lane="${index}" />`;
        });

        const pathId = `ert-character-lane-label-${index}`;
        const to = TWELVE_O_CLOCK - LABEL_END_INSET_PX / mid;
        labels += `<path id="${pathId}" d="${arcPath(mid, to - LABEL_SPAN_RAD, to)}" fill="none" />`
            + `<text class="ert-character-lane-label"><textPath href="#${pathId}" startOffset="100%" text-anchor="end">${escapeXml(name)}</textPath></text>`;
    });

    return `<g class="ert-character-lanes" data-ring="${outerRing}">`
        + `<g class="ert-character-lane-tracks">${tracks}</g>`
        + `<g class="ert-character-lane-marks">${marks}</g>`
        + `<g class="ert-character-lane-labels">${labels}</g>`
        + `</g>`;
}
