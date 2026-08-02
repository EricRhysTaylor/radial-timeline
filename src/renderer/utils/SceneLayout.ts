import { PLOT_PIXEL_WIDTH } from '../layout/LayoutConstants';
import type { TimelineItem } from '../../types';
import { isBeatNote } from '../../utils/sceneHelpers';

export type PositionInfo = { startAngle: number; endAngle: number; angularSize: number };

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
