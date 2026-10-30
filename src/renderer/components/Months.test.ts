import { describe, expect, it } from 'vitest';
import { outerLabelArc, renderMonthLabelDefs } from './Months';
import { renderOuterLabelTexts } from '../utils/Chronologue';

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
