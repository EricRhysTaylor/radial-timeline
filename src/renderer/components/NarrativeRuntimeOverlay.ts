/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { formatNumber } from '../../utils/svg';
import { formatRuntimeValue } from '../../utils/runtimeEstimator';
import { arcPath } from '../layout/Paths';
import { buildNarrativeRuntimeTicks, type NarrativeRuntimeEntry } from '../utils/NarrativeRuntime';
import { renderChronologueOuterTicks } from '../utils/Chronologue';

export interface NarrativeRuntimeOverlayParams {
    entries: NarrativeRuntimeEntry[];
    /** Radius of the per-scene runtime arcs. */
    arcRadius: number;
    /** Radius of the cumulative runtime labels around the perimeter. */
    labelRadius: number;
    /** Inner and outer ends of the perimeter ticks. */
    tickStart: number;
    tickEnd: number;
}

const TWO_PI = Math.PI * 2;
/** A scene without a runtime shows a short red stub across this share of its slice. */
const MISSING_RUNTIME_STUB_RATIO = 0.20;
/** Gap kept clear at each side of a slice, in pixels along the arc. */
const SLICE_MARGIN_PX = 2;
/** Arc span a perimeter label path covers; long enough for "12:34:56". */
const PERIMETER_LABEL_SPAN_RAD = Math.PI / 6;
/** Labels start just past their tick. */
const PERIMETER_LABEL_NUDGE_RAD = 0.01;

/**
 * The Narrative runtime view. Each scene keeps its equal slice; inside it a
 * runtime arc fills the slice in proportion to that scene's runtime against the
 * longest scene, with a tick and its runtime at the arc's head. Around the
 * perimeter, ticks mark each scene start with the runtime presented before it,
 * and the closing tick carries the total.
 *
 * Each scene's group carries its path, runtime and slice angles, in narrative
 * order, so two-scene selection reads the same order the wheel draws.
 */
export function renderNarrativeRuntimeOverlay(params: NarrativeRuntimeOverlayParams): string {
    const { entries, arcRadius, labelRadius, tickStart, tickEnd } = params;
    if (entries.length === 0) return '';

    const longest = entries.reduce((max, entry) => Math.max(max, entry.runtimeSeconds ?? 0), 0);
    const marginAngle = SLICE_MARGIN_PX / arcRadius;

    const sceneGroups = entries.map((entry, index) => {
        const sliceStart = entry.startAngle + marginAngle;
        const sliceEnd = entry.endAngle - marginAngle;
        const available = sliceEnd - sliceStart;
        const seconds = entry.runtimeSeconds;
        const hasRuntime = seconds !== null && longest > 0;
        const span = available <= 0
            ? 0
            : hasRuntime
                ? available * Math.min(seconds / longest, 1)
                : available * MISSING_RUNTIME_STUB_RATIO;
        const arcEnd = sliceStart + span;

        let body = '';
        if (span > 0) {
            const arcClass = hasRuntime ? 'rt-duration-arc' : 'rt-duration-arc rt-duration-arc-unparseable';
            body += `<path d="${arcPath(arcRadius, sliceStart, arcEnd)}" class="${arcClass}" />`;
        }
        if (hasRuntime && span > 0) {
            body += renderRuntimeHead(arcRadius, arcEnd, formatRuntimeValue(seconds));
        }

        const path = entry.scene.path ? encodeURIComponent(entry.scene.path) : '';
        return `<g class="rt-runtime-scene" data-path="${path}" data-runtime-index="${index}" data-runtime-seconds="${seconds ?? 0}" data-start-angle="${entry.startAngle.toFixed(6)}" data-end-angle="${entry.endAngle.toFixed(6)}">${body}</g>`;
    });

    const ticks = buildNarrativeRuntimeTicks(entries);
    const tickSvg = renderChronologueOuterTicks({
        outerLabels: ticks.map(tick => ({
            name: tick.label ?? '',
            shortName: tick.label ?? '',
            angle: tick.angle,
            isMajor: tick.label !== null,
            isFirst: tick.isFirst,
            isLast: tick.isLast
        })),
        monthTickStart: tickStart,
        monthTickEnd: tickEnd
    });

    let labelDefs = '';
    let labelTexts = '';
    ticks.forEach((tick, index) => {
        if (tick.label === null) return;
        const pathId = `rt-runtime-label-path-${index}`;
        // The closing total ends at its tick so it never runs into the opening label.
        const start = tick.isLast
            ? tick.angle - PERIMETER_LABEL_NUDGE_RAD - PERIMETER_LABEL_SPAN_RAD
            : tick.angle + PERIMETER_LABEL_NUDGE_RAD;
        const end = start + PERIMETER_LABEL_SPAN_RAD;
        labelDefs += `<path id="${pathId}" d="${arcPath(labelRadius, start, end)}" fill="none" />`;
        let labelClass = 'rt-runtime-outer-label';
        if (tick.isFirst) labelClass += ' rt-runtime-outer-label-first';
        if (tick.isLast) labelClass += ' rt-runtime-outer-label-last';
        const offset = tick.isLast ? 'startOffset="100%" text-anchor="end"' : 'startOffset="0" text-anchor="start"';
        labelTexts += `<text class="${labelClass}"><textPath href="#${pathId}" ${offset}>${tick.label}</textPath></text>`;
    });

    return `<g class="rt-runtime-overlay">`
        + `<defs>${labelDefs}</defs>`
        + tickSvg
        + `<g class="rt-runtime-outer-labels">${labelTexts}</g>`
        + `<g class="rt-runtime-arcs">${sceneGroups.join('')}</g>`
        + `</g>`;
}

/** The tick and runtime label at the head of a scene's runtime arc. */
function renderRuntimeHead(arcRadius: number, arcEnd: number, label: string): string {
    // Tick: 3px inside the arc to 10px outside it.
    const tickInnerRadius = arcRadius - 3;
    const tickOuterRadius = arcRadius + 10;
    const tick = `<line x1="${formatNumber(tickInnerRadius * Math.cos(arcEnd))}" y1="${formatNumber(tickInnerRadius * Math.sin(arcEnd))}" x2="${formatNumber(tickOuterRadius * Math.cos(arcEnd))}" y2="${formatNumber(tickOuterRadius * Math.sin(arcEnd))}" class="rt-runtime-tick-mark" />`;

    // Label: just past the tick, reading outward along the radius; flipped on
    // the left half of the wheel so it never reads upside down.
    const labelAngle = arcEnd + 0.01;
    const labelRadius = arcRadius - 5;
    const labelX = formatNumber(labelRadius * Math.cos(labelAngle));
    const labelY = formatNumber(labelRadius * Math.sin(labelAngle));
    const normalizedAngle = ((labelAngle % TWO_PI) + TWO_PI) % TWO_PI;
    const isLeftSide = normalizedAngle > Math.PI * 0.5 && normalizedAngle < Math.PI * 1.5;
    const rotationDeg = labelAngle * 180 / Math.PI + (isLeftSide ? 180 : 0);
    const textAnchor = isLeftSide ? 'end' : 'start';
    const text = `<text x="${labelX}" y="${labelY}" text-anchor="${textAnchor}" dominant-baseline="middle" transform="rotate(${formatNumber(rotationDeg)}, ${labelX}, ${labelY})" class="rt-runtime-tick-label">${label}</text>`;

    return tick + text;
}
