import { describe, expect, it } from 'vitest';
import { beatStagePaths, type RingItem } from './beatStage';

const scene = (path: string): RingItem => ({ kind: 'Scene', path });
const beat = (path: string): RingItem => ({ kind: 'Beat', path });

// Opening Image before scene 1; Catalyst after scene 2; Debate and Break into Two back to back; Midpoint last.
const ring: RingItem[] = [
    beat('opening'), scene('1'), scene('2'),
    beat('catalyst'), scene('3'),
    beat('debate'), beat('break'), scene('4'), scene('5'),
    beat('midpoint'), scene('6'),
];

describe('a beat stage on the timeline', () => {
    it('runs from the beat marker up to the next beat', () => {
        expect(beatStagePaths(ring, 'opening')).toEqual(['1', '2']);
        expect(beatStagePaths(ring, 'catalyst')).toEqual(['3']);
        expect(beatStagePaths(ring, 'break')).toEqual(['4', '5']);
    });
    it('runs the last beat to the end of the book', () => {
        expect(beatStagePaths(ring, 'midpoint')).toEqual(['6']);
    });
    it('is empty for a beat followed straight away by another', () => {
        expect(beatStagePaths(ring, 'debate')).toEqual([]);
    });
    it('is empty for a beat that is not on the ring', () => {
        expect(beatStagePaths(ring, 'missing')).toEqual([]);
    });
});
