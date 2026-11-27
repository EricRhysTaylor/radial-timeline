import { describe, expect, it } from 'vitest';
import { layoutNarrativeActLabel, renderActLabels } from './ActLabels';
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
    // Design choice: each label starts at its spoke and reads into its own act.
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

describe('Narrative Act labels', () => {
    const rim = 797;
    const viewBoxHalf = 800;
    const angleDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

    it.each([3, 4, 5, 7, 8, 12])('fits ordinary labels in their own exterior pocket (%i acts)', numActs => {
        for (let act = 0; act < numActs; act++) {
            const angles = getSegmentBoundaries(act, numActs);
            const fontSize = 26;
            const measure = (line: string) => Array.from(line).length * fontSize * 0.55;
            const title = 'Act ' + (act + 1);
            const label = layoutNarrativeActLabel({ title, ...angles, fontSize, rim, viewBoxHalf, measure });
            expect(label.lines.join(' ')).toBe(title);
            expect(label.inset).toBe(false);
            const halfWidth = Math.max(...label.lines.map(measure)) / 2;
            const halfHeight = fontSize * 1.14 * label.lines.length / 2;
            for (const x of [label.x - halfWidth, label.x + halfWidth]) {
                for (const y of [label.y - halfHeight, label.y + halfHeight]) {
                    expect(Math.abs(x)).toBeLessThan(viewBoxHalf);
                    expect(Math.abs(y)).toBeLessThan(viewBoxHalf);
                    expect(Math.hypot(x, y)).toBeGreaterThan(rim);
                    expect(Math.abs(angleDiff(Math.atan2(y, x), (angles.start + angles.end) / 2))).toBeLessThan((angles.end - angles.start) / 2);
                }
            }
        }
    });

    it.each([3, 5])('nudges the bottom label toward the starting spoke (%i acts)', numActs => {
        const act = (numActs - 1) / 2;
        const title = 'Act ' + (act + 1);
        const label = layoutNarrativeActLabel({
            title,
            ...getSegmentBoundaries(act, numActs),
            fontSize: 26,
            rim: 813,
            viewBoxHalf,
            measure: line => line.length * 14
        });
        expect(label.lines).toEqual([title]);
        expect(label.inset).toBe(false);
        expect(label.x).toBeGreaterThan(0);
        expect(label.y).toBeGreaterThan(0);
    });

    it('wraps a long custom title while keeping its full wording', () => {
        const title = 'The City Beneath the Silver Mountains';
        const fontSize = 26;
        const measure = (line: string) => Array.from(line).length * fontSize * 0.53;
        const label = layoutNarrativeActLabel({
            title, ...getSegmentBoundaries(0, 3), fontSize, rim, viewBoxHalf, measure
        });
        expect(label.lines).toHaveLength(2);
        expect(label.lines.join(' ')).toBe(title);
        expect(label.fontSize).toBe(fontSize);
        expect(label.inset).toBe(false);
    });

    it('leaves the bottom-left indicators clear when wrapping a label for the lower act', () => {
        const title = 'The City Beneath the Silver Mountains';
        const fontSize = 26;
        const measure = (line: string) => Array.from(line).length * fontSize * 0.53;
        const label = layoutNarrativeActLabel({
            title, ...getSegmentBoundaries(1, 3), fontSize, rim: 813, viewBoxHalf, measure
        });
        expect(label.lines.join(' ')).toBe(title);
        expect(label.inset).toBe(false);
        expect(label.x).toBeGreaterThan(0);
    });
});
