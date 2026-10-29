/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { TEXTPATH_START_NUDGE_PX } from '../layout/LayoutConstants';

/**
 * Scene titles ride an arc at the title radius. A clockwise arc reads upright
 * across the top of the wheel and upside down across the bottom, so a title
 * whose visible midpoint sits below the centre runs counter-clockwise instead:
 * it starts at the scene's end edge and reads left to right.
 *
 * On the reversed arc the glyphs grow toward the centre from the baseline
 * rather than away from it. FLIPPED_TITLE_DY pushes them back out into the
 * band an upright title occupies (cap height less descender, about half an em).
 */
export const FLIPPED_TITLE_DY = '0.5em';

/**
 * True when the title should run counter-clockwise. `rotationRad` is the turn
 * applied to the timeline layer, so the test follows what is on screen.
 */
export function isTitleFlipped(startAngle: number, endAngle: number, rotationRad = 0): boolean {
    return Math.sin((startAngle + endAngle) / 2 + rotationRad) > 0;
}

/**
 * SVG path for a scene title. The path begins TEXTPATH_START_NUDGE_PX inside
 * the edge the title starts from: the start edge upright, the end edge flipped.
 */
export function buildTextPath(
    radius: number,
    startAngle: number,
    endAngle: number,
    flipped = false
): string {
    const formatNumber = (n: number) => n.toFixed(6);
    const nudge = TEXTPATH_START_NUDGE_PX / radius;
    const from = flipped ? endAngle - nudge : startAngle + nudge;
    const to = flipped ? startAngle : endAngle;
    const largeArcFlag = Math.abs(to - from) > Math.PI ? 1 : 0;
    const sweepFlag = flipped ? 0 : 1;

    return `M ${formatNumber(radius * Math.cos(from))} ${formatNumber(radius * Math.sin(from))} A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArcFlag} ${sweepFlag} ${formatNumber(radius * Math.cos(to))} ${formatNumber(radius * Math.sin(to))}`;
}
