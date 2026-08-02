import { describe, expect, it } from 'vitest';
import { expandIntoGap, type SceneAngleData } from './SceneTitleExpansion';

const SEGMENT_END = 10;

function scene(id: string, startAngle: number, endAngle: number): SceneAngleData {
    return { id, startAngle, endAngle, innerRadius: 100, outerRadius: 120, isScene: true };
}

describe('expandIntoGap', () => {
    it('keeps the start angle pinned and grows into the gap ahead', () => {
        // Sequence layout: scenes at their outer-ring angles, gaps between.
        const elements = [scene('a', 0, 1), scene('b', 4, 5)];

        const result = expandIntoGap(elements, 'a', 2.5, SEGMENT_END);

        expect(result).toHaveLength(1);
        // The start angle IS the alignment — it must not move.
        expect(result[0].newStartAngle).toBe(0);
        expect(result[0].newEndAngle).toBe(2.5);
    });

    it('never overlaps the next scene', () => {
        const elements = [scene('a', 0, 1), scene('b', 2, 3)];

        // Wants 5 radians of growth; only 2 are free.
        const result = expandIntoGap(elements, 'a', 5, SEGMENT_END);

        expect(result[0].newEndAngle).toBe(2);
    });

    it('stops at the segment end when nothing follows', () => {
        const result = expandIntoGap([scene('a', 9, 9.2)], 'a', 4, SEGMENT_END);

        expect(result[0].newEndAngle).toBe(SEGMENT_END);
    });

    it('moves no other scene', () => {
        const elements = [scene('a', 0, 1), scene('b', 4, 5), scene('c', 7, 8)];

        const result = expandIntoGap(elements, 'a', 3, SEGMENT_END);

        expect(result.map(r => r.id)).toEqual(['a']);
    });

    it('does not expand a scene with no gap ahead', () => {
        // Consecutive scenes of the same subplot sit edge to edge.
        const elements = [scene('a', 0, 1), scene('b', 1, 2)];

        expect(expandIntoGap(elements, 'a', 3, SEGMENT_END)).toEqual([]);
    });

    it('reports no change when the scene already fills the gap', () => {
        const elements = [scene('a', 0, 2), scene('b', 2, 3)];

        expect(expandIntoGap(elements, 'a', 1.5, SEGMENT_END)).toEqual([]);
    });
});
