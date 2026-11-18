import { describe, expect, it } from 'vitest';
import { outerLabelArc, renderMonthLabelDefs } from './Months';
import { buildChronologueOuterLabels, fitChronologueLabels, renderOuterLabelTexts } from '../utils/Chronologue';

const parse = (d: string) => {
    const n = d.replace(/[MA]/g, ' ').trim().split(/\s+/).map(Number);
    return { startX: n[0], startY: n[1], sweep: n[6], endX: n[7], endY: n[8] };
};

// SVG y grows downward: +PI/2 is six o'clock, -PI/2 is twelve.
const sixOClock = { name: 'Nov 8', shortName: 'Nov 8', angle: Math.PI / 2 };
const twelveOClock = { name: 'Aug 30', shortName: 'Aug 30', angle: -Math.PI / 2 + 0.3 };

describe('outerLabelArc', () => {
    it('flips date labels below the wheel and keeps those above upright', () => {
        expect(outerLabelArc(sixOClock).flipped).toBe(true);
        expect(outerLabelArc(twelveOClock).flipped).toBe(false);
    });

    it('keeps the first and last dates clockwise', () => {
        expect(outerLabelArc({ ...sixOClock, isFirst: true }).flipped).toBe(false);
        expect(outerLabelArc({ ...sixOClock, isLast: true }).flipped).toBe(false);
    });

    it('places Chronologue boundary labels on opposite sides of twelve even when dated scenes are elsewhere', () => {
        const first = outerLabelArc({ ...sixOClock, isFirst: true, boundaryAtSeam: true });
        const last = outerLabelArc({ ...sixOClock, isLast: true, boundaryAtSeam: true });
        expect(first.startAngle).toBeCloseTo(-Math.PI / 2 + 0.01);
        expect(last.endAngle).toBeCloseTo(-Math.PI / 2 - 0.01);
        const { boundaryLabelsHtml } = renderOuterLabelTexts({ outerLabels: [
            { ...sixOClock, isFirst: true, boundaryAtSeam: true },
            { ...sixOClock, isLast: true, boundaryAtSeam: true },
        ], isChronologueMode: true, currentMonthIndex: 0 });
        expect(boundaryLabelsHtml).toContain('startOffset="0" text-anchor="start"');
        expect(boundaryLabelsHtml).toContain('startOffset="100%" text-anchor="end"');
    });
});

describe('renderMonthLabelDefs', () => {
    it('runs a flipped label path counter-clockwise back to its tick', () => {
        const defs = renderMonthLabelDefs({ months: [sixOClock, twelveOClock], monthLabelRadius: 500, chronologueDateRadius: 520 });
        const [flipped, upright] = [...defs.matchAll(/ d="([^"]+)"/g)].map(m => parse(m[1]));
        const { startAngle, endAngle } = outerLabelArc(sixOClock);
        expect(flipped.sweep).toBe(0);
        expect(Math.atan2(flipped.startY, flipped.startX)).toBeCloseTo(endAngle, 3);
        expect(Math.atan2(flipped.endY, flipped.endX)).toBeCloseTo(startAngle, 3);
        expect(upright.sweep).toBe(1);
    });
});

describe('renderOuterLabelTexts', () => {
    it('ends a flipped label at its tick and starts an upright one there', () => {
        const { labelsSvg } = renderOuterLabelTexts({ outerLabels: [sixOClock, twelveOClock], isChronologueMode: true, currentMonthIndex: 0 });
        const anchors = [...labelsSvg.matchAll(/<textPath href="#monthLabelPath-(\d)" ([^>]+)>/g)].map(m => m[2]);
        expect(anchors[0]).toBe('startOffset="100%" text-anchor="end"');
        expect(anchors[1]).toBe('startOffset="0" text-anchor="start"');
    });
});

describe('perimeter label spacing', () => {
    it('does not impose a fixed label count when all labels have room', () => {
        const labels = Array.from({ length: 30 }, (_, i) => ({ name: `${i}`, shortName: `${i}`, angle: -Math.PI / 2 + i * 2 * Math.PI / 30, isMajor: true }));
        expect(fitChronologueLabels(labels, 3000).filter(label => label.isMajor)).toHaveLength(30);
    });
    it('keeps boundary labels and suppresses overlapping dates', () => {
        const labels = [
            { name: 'Start', shortName: 'Start', angle: -Math.PI / 2, isMajor: true, isFirst: true },
            { name: 'A long date', shortName: 'A long date', angle: -Math.PI / 2 + 0.3, isMajor: true },
            { name: 'Another date', shortName: 'Another date', angle: -Math.PI / 2 + 0.31, isMajor: true },
            { name: 'End', shortName: 'End', angle: 4, isMajor: true, isLast: true },
        ];
        const fitted = fitChronologueLabels(labels, 760);
        expect(fitted[0].shortName).toBe('Start');
        expect(fitted[3].shortName).toBe('End');
        expect(fitted.slice(1, 3).filter(label => label.isMajor)).toHaveLength(1);
    });
});


describe('compressed Chronologue boundary dates', () => {
    it('puts the first and last dates on opposite sides of the seam when all scenes are dated', () => {
        const scenes = Array.from({ length: 15 }, (_, index) => {
            const when = new Date(1811, 0, 1 + index * 7, 9);
            return { path: `${index}.md`, title: `${index} Scene`, itemType: 'Scene' as const, date: '', when, whenHasClock: true,
                rawFrontmatter: { When: `${when.getFullYear()}-${String(when.getMonth()+1).padStart(2,'0')}-${String(when.getDate()).padStart(2,'0')} 09:00` } };
        });
        const labels = buildChronologueOuterLabels({} as never, scenes, 700, 760, true);
        const first = labels.find(label => label.isFirst)!;
        const last = labels.find(label => label.isLast)!;
        expect(first.boundaryAtSeam).toBe(true);
        expect(last.boundaryAtSeam).toBe(true);
        expect(outerLabelArc(first).startAngle).toBeGreaterThan(-Math.PI / 2);
        expect(outerLabelArc(last).endAngle).toBeLessThan(-Math.PI / 2);
    });
});
