/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { formatNumber } from '../../utils/svg';
import { BEAT_LABEL_BREATHING_ROOM_PX } from '../layout/LayoutConstants';

type BeatLabelAdjustState = { retryId?: number; signature?: string; success?: boolean; lastAbortSignature?: string };
const beatLabelAdjustState = new WeakMap<HTMLElement, BeatLabelAdjustState>();

/** Beat labels proper — the "—" separators this module adds share the class but carry no text path. */
const BEAT_LABEL_SELECTOR = '.rt-storybeat-title:not(.rt-plot-dash-separator)';

/**
 * A label's start angle as the renderer placed it, before any overlap shift.
 * Recorded on the first layout so a later re-layout starts from the slice,
 * not from wherever the previous pass pushed the label.
 */
const LABEL_ORIGIN_ATTR = 'data-label-origin';

/** Measuring arc: long enough that no label clips, so its full length is measured. */
const MEASURE_ARC_SPAN = Math.PI / 2;

function readLabelGeometry(pathElement: SVGPathElement): { originalStartAngle: number; radius: number } | null {
    const d = pathElement.getAttribute('d');
    if (!d) return null;
    const arcMatch = d.match(/M\s+([-\d.]+)\s+([-\d.]+)\s+A\s+([-\d.]+)/);
    if (!arcMatch) return null;
    const radius = parseFloat(arcMatch[3]);
    const recordedOrigin = pathElement.getAttribute(LABEL_ORIGIN_ATTR);
    if (recordedOrigin !== null) return { originalStartAngle: parseFloat(recordedOrigin), radius };
    const originalStartAngle = Math.atan2(parseFloat(arcMatch[2]), parseFloat(arcMatch[1]));
    pathElement.setAttribute(LABEL_ORIGIN_ATTR, String(originalStartAngle));
    return { originalStartAngle, radius };
}

const TWO_PI = 2 * Math.PI;

/** An angle folded into [0, 2π). */
function ringAngle(angle: number): number {
    return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Labels in the order the overlap cascade walks them. The cascade only ever
 * pushes a label forward, so wherever it starts is a seam it cannot resolve:
 * the last label can run into the first. Start after the widest empty stretch
 * of ring rather than at a fixed angle — a fixed seam at 9 o'clock sat right
 * between All Is Lost and Dark Night of the Soul in a Save the Cat book.
 */
export function cascadeOrder<T extends { originalStartAngle: number; pathId: string }>(labels: T[]): T[] {
    const sorted = [...labels].sort((a, b) => {
        const delta = ringAngle(a.originalStartAngle) - ringAngle(b.originalStartAngle);
        return delta !== 0 ? delta : a.pathId.localeCompare(b.pathId);
    });
    let seam = 0;
    let widestGap = -1;
    sorted.forEach((label, i) => {
        const previous = sorted[(i - 1 + sorted.length) % sorted.length];
        const gap = sorted.length === 1 ? TWO_PI : ringAngle(label.originalStartAngle - previous.originalStartAngle);
        if (gap > widestGap) {
            widestGap = gap;
            seam = i;
        }
    });
    return [...sorted.slice(seam), ...sorted.slice(0, seam)];
}

function arcPath(radius: number, startAngle: number, span: number): string {
    const x1 = radius * Math.cos(startAngle);
    const y1 = radius * Math.sin(startAngle);
    const x2 = radius * Math.cos(startAngle + span);
    const y2 = radius * Math.sin(startAngle + span);
    const largeArc = span > Math.PI ? 1 : 0;
    return `M ${formatNumber(x1)} ${formatNumber(y1)} A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArc} 1 ${formatNumber(x2)} ${formatNumber(y2)}`;
}

/**
 * Swap every beat label on the ring between its beat-system name and the
 * author's In This Book name, then lay the ring out again: a longer name
 * pushes its neighbours along, so every label is re-measured, not just the
 * swapped ones. No-op when no beat carries an In This Book name.
 */
export function showBeatLabels(container: HTMLElement, names: 'in-book' | 'canonical'): void {
    const swappable = container.querySelectorAll<SVGTextElement>(`${BEAT_LABEL_SELECTOR}[data-beat-label-in-book]`);
    if (swappable.length === 0) return;

    const nameAttr = names === 'in-book' ? 'data-beat-label-in-book' : 'data-beat-label-canonical';
    swappable.forEach((label) => {
        const textPath = label.querySelector('textPath');
        const name = label.getAttribute(nameAttr);
        if (!textPath || name === null) return;
        textPath.textContent = name;
    });

    container.querySelectorAll<SVGTextElement>(BEAT_LABEL_SELECTOR).forEach((label) => {
        const pathId = label.querySelector('textPath')?.getAttribute('href')?.substring(1);
        const pathElement = pathId ? container.querySelector<SVGPathElement>(`#${pathId}`) : null;
        const geometry = pathElement ? readLabelGeometry(pathElement) : null;
        if (!pathElement || !geometry) return;
        pathElement.setAttribute('d', arcPath(geometry.radius, geometry.originalStartAngle, MEASURE_ARC_SPAN));
    });

    const state = beatLabelAdjustState.get(container);
    if (state) state.success = false;
    adjustBeatLabelsAfterRender(container);
}

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
    const labels = container.querySelectorAll(BEAT_LABEL_SELECTOR);
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

        const geometry = readLabelGeometry(pathElement);
        if (!geometry) return;

        labelData.push({
            element: textElement,
            textPath,
            pathElement,
            pathId,
            originalStartAngle: geometry.originalStartAngle,
            textLength,
            radius: geometry.radius
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

    const ringOrder = cascadeOrder(labelData);
    const [seamLabel] = ringOrder;

    let lastEnd = Number.NEGATIVE_INFINITY;
    const adjustments: Array<{ data: LabelData; newStartAngle: number; needsDash: boolean; dashAngle?: number; pathAngleSpan: number }> = [];

    ringOrder.forEach((data) => {
        const pathWidth = TEXT_START_OFFSET + data.textLength + EXTRA_BREATHING_ROOM;
        const pathAngleSpan = pathWidth / Math.max(1, data.radius);

        const textOnlyWidth = TEXT_START_OFFSET + data.textLength;
        const textAngleSpan = textOnlyWidth / Math.max(1, data.radius);

        // Unwrapped from the seam, so angles only grow along the cascade.
        let startAngle = seamLabel.originalStartAngle + ringAngle(data.originalStartAngle - seamLabel.originalStartAngle);
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
        pathElement.setAttribute('d', arcPath(radius, newStartAngle, pathAngleSpan));

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
