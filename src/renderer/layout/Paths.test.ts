import { describe, expect, it } from 'vitest';
import { arcPath } from './Paths';

/** [largeArcFlag, sweepFlag] of the single arc command. */
function arcFlags(path: string): [string, string] {
    const match = /A\s+[\d.-]+\s+[\d.-]+\s+0\s+(\d)\s+(\d)/.exec(path);
    if (!match) throw new Error(`no arc command in ${path}`);
    return [match[1], match[2]];
}

const CLOCKWISE = '1';
const COUNTER_CLOCKWISE = '0';

describe('arcPath', () => {
    const R = 100;
    /** Ring positions: the book opens at 12 o'clock and closes there a full turn later. */
    const OPENING = -Math.PI / 2;
    const CLOSING = (3 * Math.PI) / 2;

    it('runs clockwise to a later point', () => {
        expect(arcFlags(arcPath(R, OPENING + 1, OPENING + 1.5))).toEqual(['0', CLOCKWISE]);
    });

    it('runs counter-clockwise to an earlier point', () => {
        expect(arcFlags(arcPath(R, OPENING + 1.5, OPENING + 1))).toEqual(['0', COUNTER_CLOCKWISE]);
    });

    // Drag chrome: the arc shows a scene's move through the book. Crossing the
    // seam would mean reaching an earlier scene by running past the last one.
    describe('never crosses the seam at the book\'s opening', () => {
        it('takes a move from the close back to the opening counter-clockwise, the long way round', () => {
            expect(arcFlags(arcPath(R, CLOSING - 0.2, OPENING + 0.2))).toEqual(['1', COUNTER_CLOCKWISE]);
        });

        it('takes a move from the opening to the close clockwise, the long way round', () => {
            expect(arcFlags(arcPath(R, OPENING + 0.2, CLOSING - 0.2))).toEqual(['1', CLOCKWISE]);
        });

        it('keeps a short backward move short', () => {
            expect(arcFlags(arcPath(R, CLOSING - 0.2, CLOSING - 0.5))).toEqual(['0', COUNTER_CLOCKWISE]);
        });
    });

    it('flags a span past a half turn in either direction', () => {
        // Pinned to 0, SVG would draw the short arc off the ring on the far side.
        expect(arcFlags(arcPath(R, OPENING, OPENING + Math.PI * 1.5))).toEqual(['1', CLOCKWISE]);
        expect(arcFlags(arcPath(R, OPENING + Math.PI * 1.5, OPENING))).toEqual(['1', COUNTER_CLOCKWISE]);
    });
});
