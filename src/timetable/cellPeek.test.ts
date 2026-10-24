import { describe, expect, it } from 'vitest';
import { isCutOff, placePeek } from './cellPeek';

const viewport = { width: 1200, height: 800 };
const panel = { width: 400, height: 120 };

describe('placePeek', () => {
    it('hangs the panel under the cell, lined up with its left edge', () => {
        expect(placePeek({ left: 300, top: 200, bottom: 230 }, panel, viewport)).toEqual({ left: 300, top: 234 });
    });

    it('goes above the cell when there isn’t room below', () => {
        expect(placePeek({ left: 300, top: 700, bottom: 730 }, panel, viewport)).toEqual({ left: 300, top: 576 });
    });

    it('stays inside the window at its right edge', () => {
        expect(placePeek({ left: 1000, top: 200, bottom: 230 }, panel, viewport).left).toBe(792);
    });

    it('stays inside the window in a pane too short for either side', () => {
        const tall = { width: 400, height: 700 };
        expect(placePeek({ left: 4, top: 300, bottom: 330 }, tall, viewport)).toEqual({ left: 8, top: 92 });
    });
});

describe('isCutOff', () => {
    it('opens only for text that runs past its column', () => {
        expect(isCutOff({ scrollWidth: 620, clientWidth: 360 })).toBe(true);
        expect(isCutOff({ scrollWidth: 361, clientWidth: 360 })).toBe(false);
        expect(isCutOff({ scrollWidth: 120, clientWidth: 360 })).toBe(false);
    });
});
