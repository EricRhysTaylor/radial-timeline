import { PLOT_PIXEL_WIDTH } from '../layout/LayoutConstants';
import type { TimelineItem } from '../../types';
import { isBeatNote, sceneKey } from '../../utils/sceneHelpers';

export type PositionInfo = { startAngle: number; endAngle: number; angularSize: number };

/** Angular gaps below this are not worth a DOM node. */
const MIN_VOID_SPAN = 0.001;

export function computePositions(innerR: number, outerR: number, startAngle: number, endAngle: number, items: TimelineItem[]): Map<number, PositionInfo> {
    const middleRadius = (innerR + outerR) / 2;
    const plotAngularWidth = PLOT_PIXEL_WIDTH / middleRadius;
    const totalAngularSpace = endAngle - startAngle;
    const plotCount = items.filter(it => isBeatNote(it)).length;
    const plotTotalAngularSpace = plotCount * plotAngularWidth;
    const sceneCount = items.filter(it => !isBeatNote(it)).length;
    const sceneAngularSize = sceneCount > 0 ? (totalAngularSpace - plotTotalAngularSpace) / sceneCount : 0;

    let current = startAngle;
    const positions = new Map<number, PositionInfo>();
    items.forEach((it, idx) => {
        if (isBeatNote(it)) {
            positions.set(idx, { startAngle: current, endAngle: current + plotAngularWidth, angularSize: plotAngularWidth });
            current += plotAngularWidth;
        } else {
            positions.set(idx, { startAngle: current, endAngle: current + sceneAngularSize, angularSize: sceneAngularSize });
            current += sceneAngularSize;
        }
    });
    return positions;
}

/**
 * Sequence layout: give each item the angle its counterpart holds in the
 * all-scenes outer ring, so a subplot ring shows where its scenes actually fall
 * in the manuscript.
 *
 * An item with no counterpart gets no position and is skipped by the caller.
 * That only happens if a subplot ring holds a scene the outer ring does not,
 * which the outer ring's construction rules out — placing it at a guessed angle
 * would be a lie about where the scene sits.
 */
export function alignPositionsToOuterRing(
    items: TimelineItem[],
    outerPositionByKey: Map<string, PositionInfo>
): Map<number, PositionInfo> {
    const positions = new Map<number, PositionInfo>();
    items.forEach((item, idx) => {
        const position = outerPositionByKey.get(sceneKey(item));
        if (position) positions.set(idx, position);
    });
    return positions;
}

/**
 * The unoccupied arcs of a ring — everything between `startAngle` and
 * `endAngle` that no item covers.
 *
 * Fill layout leaves at most one span, at the end. Sequence layout leaves one
 * wherever the subplot has no scene, and those gaps are the point: they show
 * the stretches of manuscript this subplot is absent from.
 */
export function computeVoidSpans(
    positions: Iterable<PositionInfo>,
    startAngle: number,
    endAngle: number
): Array<{ startAngle: number; endAngle: number }> {
    const occupied = Array.from(positions).sort((a, b) => a.startAngle - b.startAngle);
    const spans: Array<{ startAngle: number; endAngle: number }> = [];
    let cursor = startAngle;

    occupied.forEach(position => {
        if (position.startAngle - cursor > MIN_VOID_SPAN) {
            spans.push({ startAngle: cursor, endAngle: position.startAngle });
        }
        if (position.endAngle > cursor) cursor = position.endAngle;
    });

    if (endAngle - cursor > MIN_VOID_SPAN) {
        spans.push({ startAngle: cursor, endAngle });
    }
    return spans;
}
