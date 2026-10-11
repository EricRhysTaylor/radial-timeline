import { describe, expect, it } from 'vitest';
import { arcPath } from './Paths';

/** [largeArcFlag, sweepFlag] of the single arc command. */
function arcFlags(path: string): [string, string] {
    const match = /A\s+[\d.-]+\s+[\d.-]+\s+0\s+(\d)\s+(\d)/.exec(path);
    if (!match) throw new Error(`no arc command in ${path}`);
    return [match[1], match[2]];
}

describe('arcPath', () => {
    const R = 100;
    const TOP = -Math.PI / 2;

    it('draws a forward span clockwise the short way', () => {
        expect(arcFlags(arcPath(R, TOP, TOP + Math.PI / 6))).toEqual(['0', '1']);
    });

    // Drag chrome: a drop behind the dragged scene must not sweep backwards,
    // which would picture the scene travelling back through the story.
    it('reaches an end behind the start the long way round, still clockwise', () => {
        expect(arcFlags(arcPath(R, TOP + Math.PI / 2, TOP + Math.PI / 4))).toEqual(['1', '1']);
    });

    it('takes the long way even for an end only just behind the start', () => {
        expect(arcFlags(arcPath(R, 1, 0.99))).toEqual(['1', '1']);
    });

    it('flags a forward span past a half turn', () => {
        // Pinned to 0, SVG would draw the short arc off the ring on the far side.
        expect(arcFlags(arcPath(R, TOP, TOP + Math.PI * 1.5))).toEqual(['1', '1']);
    });

    it('measures across the 12 o\'clock seam', () => {
        // Last scene of the ring to the first: a short clockwise hop over the top.
        expect(arcFlags(arcPath(R, (3 * Math.PI) / 2 - 0.2, TOP + 0.2))).toEqual(['0', '1']);
        // First scene back to the last: the whole ring, clockwise.
        expect(arcFlags(arcPath(R, TOP + 0.2, (3 * Math.PI) / 2 - 0.2))).toEqual(['1', '1']);
    });

    it('is unaffected by the overlay rotation offset', () => {
        // Rotated timelines add the same offset to both ends.
        const offset = -(2 * Math.PI) / 3;
        expect(arcFlags(arcPath(R, 2 + offset, 1 + offset))).toEqual(arcFlags(arcPath(R, 2, 1)));
    });
});
