/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { SCENE_TITLE_INSET } from '../layout/LayoutConstants';
import { buildTextPath, FLIPPED_TITLE_DY, isTitleFlipped } from '../components/SceneTitlePath';

/**
 * Lay a scene group's title along the given angles, upright for where the
 * slice sits. Hover expansion moves a slice's edges, which can carry its
 * midpoint across the horizontal, so the orientation is decided again here.
 */
export function applySceneTitleGeometry(group: Element, startAngle: number, endAngle: number): void {
    const textPath = group.querySelector('path[id^="textPath-"]');
    if (!textPath) return;
    const innerR = Number(group.getAttribute('data-inner-r')) || 0;
    const outerR = Number(group.getAttribute('data-outer-r')) || 0;
    const insetAttr = group.getAttribute('data-title-inset');
    const titleInset = insetAttr ? Number(insetAttr) : SCENE_TITLE_INSET;
    const radius = Math.max(innerR, outerR - titleInset);
    const flipped = isTitleFlipped(startAngle, endAngle);

    textPath.setAttribute('d', buildTextPath(radius, startAngle, endAngle, flipped));
    const title = group.querySelector('.rt-scene-title');
    if (!title) return;
    if (flipped) title.setAttribute('dy', FLIPPED_TITLE_DY);
    else title.removeAttribute('dy');
}
