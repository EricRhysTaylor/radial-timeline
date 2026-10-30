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
/** Name size on the wheel; taller than a lane, so the names step along the arc instead of stacking. */
const NAME_FONT_PX = 16;
/** Rough width of one character of a name, as a share of the font size. */
const NAME_CHAR_EM = 0.62;
/** Space between one name and the next along the arc, in pixels. */
const NAME_GAP_PX = 10;
const TWELVE_O_CLOCK = -Math.PI / 2;

/** Angle a name takes along a lane of radius `mid`. */
function nameSpan(name: string, mid: number): number {
    return (name.length * NAME_FONT_PX * NAME_CHAR_EM) / mid;
}

/**
 * Where a hovered mark's name goes: along its lane, starting just clockwise of
 * the mark's end, so the name sits beside the scene it labels.
 */
export function characterLaneNameBeside(mid: number, markEndAngle: number, name: string): string {
    const start = markEndAngle + NAME_GAP_PX / mid;
    return arcPath(mid, start, start + nameSpan(name, mid));
}

/**
 * One lane per character under the All Scenes ring, each in its own color.
 * Each scene the character is in gets a mark in its slice: full height when
 * they are the POV character, half height (on the lane's inner edge)
 * otherwise. Each mark carries its scene's path, so hovering it lights the
 * scene. Each lane group carries its character's name for the ring key,
 * which lists the names beside their colors. While the key is open, the names
 * also show on the wheel: each rides its own lane, stepping back from
 * 12 o'clock one after another so the larger text never stacks. Hovering a
 * mark shows its character's name right beside it instead.
 */
export function renderCharacterLanes(params: CharacterLanesParams): string {
    const { entries, characters, ringInnerRadius, outerRing } = params;
    if (characters.length === 0) return '';

    let nameEnd = TWELVE_O_CLOCK;
    let names = '';
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
            lane += `<path class="ert-character-lane-mark${isPov ? ' ert-character-lane-mark-pov' : ''}" d="${sceneArcPath(inner, top, start, end)}" data-path="${path}" data-end="${formatNumber(end)}" />`;
        });

        const nameEndAngle = nameEnd - NAME_GAP_PX / mid;
        const nameStartAngle = nameEndAngle - nameSpan(name, mid);
        nameEnd = nameStartAngle;
        const pathId = `ert-character-lane-name-${index}`;
        names += `<path id="${pathId}" d="${arcPath(mid, nameStartAngle, nameEndAngle)}" fill="none" />`
            + `<text class="ert-character-lane-name" data-lane="${index}"><textPath href="#${pathId}" startOffset="100%" text-anchor="end">${escapeXml(name)}</textPath></text>`;

        return `<g class="ert-character-lane" data-lane="${index}" data-character="${escapeXml(name)}" data-radius="${formatNumber(mid)}">${lane}</g>`;
    });

    // The hovered mark's name; the scene hover fills it (AllScenesMode).
    const beside = `<g class="ert-character-lane-beside" display="none"><path id="ert-character-lane-beside-path" fill="none" />`
        + `<text class="ert-character-lane-name"><textPath href="#ert-character-lane-beside-path"></textPath></text></g>`;

    return `<g class="ert-character-lanes" data-ring="${outerRing}">${lanes.join('')}<g class="ert-character-lane-names">${names}</g>${beside}</g>`;
}
