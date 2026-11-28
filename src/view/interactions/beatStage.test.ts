import { describe, expect, it } from 'vitest';
import { beatStagePaths, type RingItem } from './beatStage';

const scene = (path: string): RingItem => ({ kind: 'Scene', path });
const beat = (path: string): RingItem => ({ kind: 'Beat', path });

// Each beat follows the scene it happens in, as in the demo vaults (N.01 after scene N):
// Opening Image in scene 1, Catalyst in 3, Debate and Break into Two both in 5, Midpoint in 7.
const ring: RingItem[] = [
    scene('1'), beat('opening'), scene('2'),
    scene('3'), beat('catalyst'), scene('4'),
    scene('5'), beat('debate'), beat('break'), scene('6'),
    scene('7'), beat('midpoint'), scene('8'),
];

describe('a beat stage on the timeline', () => {
    it('runs from the beat\'s own scene up to the next beat\'s scene', () => {
        expect(beatStagePaths(ring, 'opening')).toEqual(['1', '2']);
        expect(beatStagePaths(ring, 'catalyst')).toEqual(['3', '4']);
        expect(beatStagePaths(ring, 'break')).toEqual(['5', '6']);
    });
    it('runs the last beat to the end of the book', () => {
        expect(beatStagePaths(ring, 'midpoint')).toEqual(['7', '8']);
    });
    it('keeps only its own scene when another beat follows in the same scene', () => {
        expect(beatStagePaths(ring, 'debate')).toEqual(['5']);
    });
    it('starts with the scenes after a beat that has no scene before it', () => {
        expect(beatStagePaths([beat('opening'), scene('1'), scene('2'), beat('catalyst')], 'opening')).toEqual(['1']);
    });
    it('is empty for a beat that is not on the ring', () => {
        expect(beatStagePaths(ring, 'missing')).toEqual([]);
    });
});
