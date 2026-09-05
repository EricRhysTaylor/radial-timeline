import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { alignPositionsToOuterRing, computePositions, computeVoidSpans, type PositionInfo } from './SceneLayout';

function scene(path: string): TimelineItem {
    return { title: path, path, date: '', subplot: 'Betrayal', actNumber: 1 } as TimelineItem;
}

function position(startAngle: number, endAngle: number): PositionInfo {
    return { startAngle, endAngle, angularSize: endAngle - startAngle };
}

describe('alignPositionsToOuterRing', () => {
    it('gives each scene the angle its outer-ring counterpart holds', () => {
        const outer = new Map<string, PositionInfo>([
            ['a.md', position(0, 1)],
            ['b.md', position(1, 2)],
            ['c.md', position(2, 3)]
        ]);

        // A subplot holding the first and third scenes leaves the middle empty.
        const aligned = alignPositionsToOuterRing([scene('a.md'), scene('c.md')], outer);

        expect(aligned.get(0)).toEqual(position(0, 1));
        expect(aligned.get(1)).toEqual(position(2, 3));
    });

    it('places no scene that the outer ring does not hold', () => {
        const aligned = alignPositionsToOuterRing(
            [scene('a.md'), scene('ghost.md')],
            new Map([['a.md', position(0, 1)]])
        );

        expect(aligned.has(0)).toBe(true);
        expect(aligned.has(1)).toBe(false);
    });
});

describe('computeVoidSpans', () => {
    const START = 0;
    const END = 3;

    it('leaves one trailing span for a fill layout', () => {
        const positions = computePositions(700, 760, START, END, [scene('a.md'), scene('b.md')]);
        expect(computeVoidSpans(positions.values(), START, END)).toEqual([]);

        // Half-filled ring: the remainder is one span at the end.
        const half = new Map([[0, position(START, 1.5)]]);
        expect(computeVoidSpans(half.values(), START, END)).toEqual([
            { startAngle: 1.5, endAngle: END }
        ]);
    });

    it('opens a span wherever a sequence layout has no scene', () => {
        const positions = [position(0, 1), position(2, 3)];

        expect(computeVoidSpans(positions, START, END)).toEqual([
            { startAngle: 1, endAngle: 2 }
        ]);
    });

    it('opens a leading span when the ring starts empty', () => {
        expect(computeVoidSpans([position(1, 3)], START, END)).toEqual([
            { startAngle: 0, endAngle: 1 }
        ]);
    });

    it('ignores gaps too small to be worth a DOM node', () => {
        expect(computeVoidSpans([position(0, 1), position(1.0005, 3)], START, END)).toEqual([]);
    });

    it('spans the whole ring when nothing is placed', () => {
        expect(computeVoidSpans([], START, END)).toEqual([
            { startAngle: START, endAngle: END }
        ]);
    });
});
