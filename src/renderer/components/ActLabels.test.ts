import { describe, expect, it } from 'vitest';
import { renderActLabels } from './ActLabels';
import { getSegmentBoundaries } from '../utils/TimelineSegments';

const RADIUS = 790;

/** Clockwise angle from 12 o'clock, in [0, 2π). */
function clockAngle(x: number, y: number): number {
    const a = Math.atan2(y, x) + Math.PI / 2;
    return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function labelArcs(numActs: number): Array<{ start: number; end: number }> {
    const svg = renderActLabels({
        numActs,
        actLabels: [],
        outerMostOuterRadius: RADIUS,
        actLabelOffset: 0,
        maxStageColor: 'currentColor'
    });
    const re = /<path id="actPath-\d+" d="\s*M ([-\d.]+) ([-\d.]+)\s*A [-\d.]+ [-\d.]+ 0 0 1 ([-\d.]+) ([-\d.]+)/g;
    const arcs: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
        arcs.push({
            start: clockAngle(parseFloat(m[1]), parseFloat(m[2])),
            end: clockAngle(parseFloat(m[3]), parseFloat(m[4]))
        });
    }
    return arcs;
}

describe('renderActLabels', () => {
    // GitHub #31: labels used to end just before their spoke, which put each
    // one over the previous act's last scenes. A four-act book read as if its
    // scenes were in the wrong quadrant.
    it.each([3, 4, 5, 7, 12])('keeps every label inside its own act segment (%i acts)', numActs => {
        const arcs = labelArcs(numActs);
        expect(arcs).toHaveLength(numActs);
        arcs.forEach((arc, act) => {
            const { start, end } = getSegmentBoundaries(act, numActs);
            const segStart = start + Math.PI / 2;
            const segEnd = end + Math.PI / 2;
            const arcEnd = arc.end < arc.start ? arc.end + 2 * Math.PI : arc.end;
            // formatNumber rounds coordinates; allow that rounding at the spoke.
            expect(arc.start).toBeGreaterThan(segStart);
            expect(arcEnd).toBeLessThan(segEnd + 1e-3);
        });
    });

    it('anchors the label text at the start of its arc', () => {
        const svg = renderActLabels({
            numActs: 4,
            actLabels: ['Setup'],
            outerMostOuterRadius: RADIUS,
            actLabelOffset: 0,
            maxStageColor: 'currentColor'
        });
        expect(svg).toContain('startOffset="0" text-anchor="start">Setup</textPath>');
    });
});
