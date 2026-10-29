/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { SCENE_TITLE_INSET } from '../layout/LayoutConstants';
import { buildTextPath, FLIPPED_TITLE_DY, isTitleFlipped } from '../components/SceneTitlePath';
import { getRotationStepDegrees } from '../utils/TimelineSegments';

/** The turn currently applied to `#timeline-rotatable`, in radians. */
export function getTimelineRotationRad(svg: SVGSVGElement): number {
    if (svg.getAttribute('data-rotated') !== 'true') return 0;
    const segmentCount = parseInt(svg.getAttribute('data-segment-count') || svg.getAttribute('data-num-acts') || '3', 10);
    return -getRotationStepDegrees(segmentCount) * Math.PI / 180;
}

/**
 * Lay a scene group's title along the given angles, upright for where the
 * slice sits on screen. Hover expansion and rotation both come through here,
 * so a title never reverts to the render-time orientation.
 */
export function applySceneTitleGeometry(
    group: Element,
    startAngle: number,
    endAngle: number,
    rotationRad: number
): void {
    const textPath = group.querySelector('path[id^="textPath-"]');
    if (!textPath) return;
    const innerR = Number(group.getAttribute('data-inner-r')) || 0;
    const outerR = Number(group.getAttribute('data-outer-r')) || 0;
    const insetAttr = group.getAttribute('data-title-inset');
    const titleInset = insetAttr ? Number(insetAttr) : SCENE_TITLE_INSET;
    const radius = Math.max(innerR, outerR - titleInset);
    const flipped = isTitleFlipped(startAngle, endAngle, rotationRad);

    textPath.setAttribute('d', buildTextPath(radius, startAngle, endAngle, flipped));
    const title = group.querySelector('.rt-scene-title');
    if (!title) return;
    if (flipped) title.setAttribute('dy', FLIPPED_TITLE_DY);
    else title.removeAttribute('dy');
}

/** Re-orient every scene title after the timeline layer turns. */
export function orientSceneTitles(svg: SVGSVGElement): void {
    const rotationRad = getTimelineRotationRad(svg);
    svg.querySelectorAll('.rt-scene-group').forEach(group => {
        const startAngle = Number(group.getAttribute('data-start-angle-raw') ?? group.getAttribute('data-start-angle'));
        const endAngle = Number(group.getAttribute('data-end-angle-raw') ?? group.getAttribute('data-end-angle'));
        if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) return;
        applySceneTitleGeometry(group, startAngle, endAngle, rotationRad);
    });
}
