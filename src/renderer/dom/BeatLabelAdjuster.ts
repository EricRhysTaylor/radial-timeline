/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { formatNumber } from '../../utils/svg';
import { BEAT_LABEL_BREATHING_ROOM_PX } from '../layout/LayoutConstants';

type BeatLabelAdjustState = { retryId?: number; signature?: string; success?: boolean; lastAbortSignature?: string };
const beatLabelAdjustState = new WeakMap<HTMLElement, BeatLabelAdjustState>();

function getLabelSignature(container: HTMLElement): string {
    const ids = Array.from(container.querySelectorAll('.rt-storybeat-title textPath'))
        .map((tp) => (tp as SVGTextPathElement).getAttribute('href') || '')
        .join('|');
    return ids;
}

function bringChapterMarkersToFront(container: HTMLElement): void {
    const markerLayer = container.querySelector<SVGGElement>('#timeline-rotatable > .ert-chapter-markers');
    const rotatable = markerLayer?.parentElement;
    if (markerLayer && rotatable) {
        rotatable.appendChild(markerLayer);
    }
}

/**
 * Measures and adjusts plot label positions after SVG is rendered
 * Uses actual SVG getComputedTextLength() for perfect accuracy
 */
export function adjustBeatLabelsAfterRender(container: HTMLElement, attempt: number = 0): void {
    const state = beatLabelAdjustState.get(container) || {};
    if (!container.isConnected) return;
    const labels = container.querySelectorAll('.rt-storybeat-title');
    if (labels.length === 0) {
        bringChapterMarkersToFront(container);
        return;
    }

    const SPACE_BEFORE_DASH = 6;
    const SPACE_AFTER_DASH = 4;
    const TEXT_START_OFFSET = 2;
    const EXTRA_BREATHING_ROOM = BEAT_LABEL_BREATHING_ROOM_PX;

    interface LabelData {
        element: SVGTextElement;
        textPath: SVGTextPathElement;
        pathElement: SVGPathElement;
        pathId: string;
        originalStartAngle: number;
        textLength: number;
        radius: number;
    }

    const svgRoot = container.querySelector('svg.radial-timeline-svg');
    const isHidden = !svgRoot || svgRoot.getBoundingClientRect().width === 0 || container.ownerDocument.visibilityState === 'hidden';
    const MAX_ATTEMPTS = 10;
    const signature = getLabelSignature(container);

    if (state.signature !== signature) {
        state.signature = signature;
        state.success = false;
        if (state.retryId) cancelAnimationFrame(state.retryId);
        beatLabelAdjustState.set(container, state);
    }

    if (state.signature === signature && state.success) {
        return;
    }

    if (isHidden && attempt < MAX_ATTEMPTS) {
        const rafId = window.requestAnimationFrame(() => adjustBeatLabelsAfterRender(container, attempt + 1));
        state.retryId = rafId;
        beatLabelAdjustState.set(container, state);
        return;
    }

    const labelData: LabelData[] = [];
    let measurableCount = 0;
    labels.forEach((label) => {
        const textElement = label as SVGTextElement;
        const textPath = textElement.querySelector('textPath') as SVGTextPathElement;
        if (!textPath) return;

        const pathId = textPath.getAttribute('href')?.substring(1);
        if (!pathId) return;

        const pathElement = container.querySelector(`#${pathId}`) as SVGPathElement;
        if (!pathElement) return;

        const textLength = textPath.getComputedTextLength();
        if (textLength === 0) {
            return;
        }
        measurableCount++;

        const d = pathElement.getAttribute('d');
        if (!d) return;
        const arcMatch = d.match(/M\s+([-\d.]+)\s+([-\d.]+)\s+A\s+([-\d.]+)/);
        if (!arcMatch) return;

        const x = parseFloat(arcMatch[1]);
        const y = parseFloat(arcMatch[2]);
        const radius = parseFloat(arcMatch[3]);
        const originalStartAngle = Math.atan2(y, x);

        labelData.push({
            element: textElement,
            textPath,
            pathElement,
            pathId,
            originalStartAngle,
            textLength,
            radius
        });
    });

    if (measurableCount < labels.length && attempt < MAX_ATTEMPTS) {
        state.signature = signature;
        state.success = false;
        beatLabelAdjustState.set(container, state);
        window.setTimeout(() => adjustBeatLabelsAfterRender(container, attempt + 1), 50);
        return;
    }

    if (measurableCount === 0 && attempt >= MAX_ATTEMPTS) {
        state.lastAbortSignature = signature;
        beatLabelAdjustState.set(container, state);
        return;
    }

    labelData.sort((a, b) => {
        if (a.originalStartAngle === b.originalStartAngle) return a.pathId.localeCompare(b.pathId);
        return a.originalStartAngle - b.originalStartAngle;
    });

    let lastEnd = Number.NEGATIVE_INFINITY;
    const adjustments: Array<{ data: LabelData; newStartAngle: number; needsDash: boolean; dashAngle?: number; pathAngleSpan: number }> = [];

    labelData.forEach((data) => {
        const pathWidth = TEXT_START_OFFSET + data.textLength + EXTRA_BREATHING_ROOM;
        const pathAngleSpan = pathWidth / Math.max(1, data.radius);

        const textOnlyWidth = TEXT_START_OFFSET + data.textLength;
        const textAngleSpan = textOnlyWidth / Math.max(1, data.radius);

        let startAngle = data.originalStartAngle;
        let needsDash = false;
        let dashAngle: number | undefined;

        if (startAngle < lastEnd) {
            const shift = lastEnd - startAngle;
            startAngle += shift + (EXTRA_BREATHING_ROOM / Math.max(1, data.radius));
            needsDash = true;
            dashAngle = startAngle - (SPACE_BEFORE_DASH / Math.max(1, data.radius));
        }

        lastEnd = startAngle + textAngleSpan + (SPACE_AFTER_DASH / Math.max(1, data.radius));
        adjustments.push({ data, newStartAngle: startAngle, needsDash, dashAngle, pathAngleSpan });
    });

    adjustments.forEach(({ data, newStartAngle, needsDash, dashAngle, pathAngleSpan }) => {
        const pathElement = data.pathElement;
        const radius = data.radius;
        const endAngle = newStartAngle + pathAngleSpan;

        const x1 = radius * Math.cos(newStartAngle);
        const y1 = radius * Math.sin(newStartAngle);
        const x2 = radius * Math.cos(endAngle);
        const y2 = radius * Math.sin(endAngle);
        const largeArc = pathAngleSpan > Math.PI ? 1 : 0;

        const newPath = `M ${formatNumber(x1)} ${formatNumber(y1)} A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArc} 1 ${formatNumber(x2)} ${formatNumber(y2)}`;
        pathElement.setAttribute('d', newPath);

        if (needsDash && typeof dashAngle === 'number') {
            const dashRadius = radius + 1;
            const dashAngleMid = dashAngle;
            const x = dashRadius * Math.cos(dashAngleMid);
            const y = dashRadius * Math.sin(dashAngleMid);
            const deg = (dashAngleMid + Math.PI / 2) * 180 / Math.PI;

            let separator = container.querySelector(`#plot-separator-${data.pathId}`) as SVGTextElement;
            if (!separator) {
                separator = container.ownerDocument.win.createSvg('text');
                separator.setAttribute('id', `plot-separator-${data.pathId}`);
                separator.setAttribute('class', 'rt-storybeat-title rt-plot-dash-separator');
                separator.setAttribute('text-anchor', 'middle');
                separator.setAttribute('dy', '-3');
                separator.textContent = '—';
                data.pathElement.parentElement?.appendChild(separator);
            }
            separator.setAttribute('transform', `translate(${formatNumber(x)}, ${formatNumber(y)}) rotate(${formatNumber(deg)})`);
        } else {
            const separator = container.querySelector(`#plot-separator-${data.pathId}`);
            separator?.remove();
        }
    });

    bringChapterMarkersToFront(container);
    state.success = true;
    beatLabelAdjustState.set(container, state);
}
