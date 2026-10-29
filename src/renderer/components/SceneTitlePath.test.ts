import { describe, expect, it } from 'vitest';
import { buildTextPath, isTitleFlipped } from './SceneTitlePath';
import { TEXTPATH_START_NUDGE_PX } from '../layout/LayoutConstants';

const parse = (d: string) => {
    const n = d.replace(/[MA]/g, ' ').trim().split(/\s+/).map(Number);
    return { startX: n[0], startY: n[1], sweep: n[6], endX: n[7], endY: n[8] };
};

describe('isTitleFlipped', () => {
    it('flips titles centred below the wheel and keeps those above upright', () => {
        // SVG y grows downward: +PI/2 is six o'clock, -PI/2 is twelve.
        expect(isTitleFlipped(Math.PI / 2 - 0.1, Math.PI / 2 + 0.1)).toBe(true);
        expect(isTitleFlipped(-Math.PI / 2 - 0.1, -Math.PI / 2 + 0.1)).toBe(false);
    });

    it('judges by where the slice sits after the wheel turns', () => {
        // A slice at six o'clock turned a half turn sits at twelve.
        expect(isTitleFlipped(Math.PI / 2 - 0.1, Math.PI / 2 + 0.1, Math.PI)).toBe(false);
    });
});

describe('buildTextPath', () => {
    it('runs a flipped title counter-clockwise from the end edge', () => {
        const radius = 500;
        const start = Math.PI / 3;
        const end = Math.PI / 2;
        const p = parse(buildTextPath(radius, start, end, true));
        expect(p.sweep).toBe(0);
        expect(Math.atan2(p.startY, p.startX)).toBeCloseTo(end - TEXTPATH_START_NUDGE_PX / radius, 6);
        expect(Math.atan2(p.endY, p.endX)).toBeCloseTo(start, 6);
    });

    it('runs an upright title clockwise from the start edge', () => {
        const p = parse(buildTextPath(500, -Math.PI / 2, -Math.PI / 3));
        expect(p.sweep).toBe(1);
    });
});
