import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import {
    characterLaneBandWidth,
    characterLaneRadii,
    characterLanesActive,
    chooseLaneCharacters,
    collectCharacterLaneEntries,
    readSceneCharacters,
    type SceneCharacters
} from './CharacterLanes';
import { computeRingGeometry } from '../layout/Rings';
import { CHARACTER_LANE_HEIGHT, CHARACTER_LANE_PADDING } from '../layout/LayoutConstants';

const scene = (present: string[], pov: string[] = present.slice(0, 1)): SceneCharacters => ({ present, pov: new Set(pov) });

describe('readSceneCharacters', () => {
    it('makes the first character POV by default and keeps the list order', () => {
        const read = readSceneCharacters({ Character: ['Elizabeth', 'Darcy'] }, 'off');
        expect(read.present).toEqual(['Elizabeth', 'Darcy']);
        expect([...read.pov]).toEqual(['Elizabeth']);
    });

    it('follows a scene count override', () => {
        const read = readSceneCharacters({ Character: ['Elizabeth', 'Darcy', 'Jane'], pov: 'two' }, 'third');
        expect([...read.pov]).toEqual(['Elizabeth', 'Darcy']);
    });

    it('marks no POV character in omniscient mode', () => {
        expect(readSceneCharacters({ Character: ['Elizabeth'] }, 'omni').pov.size).toBe(0);
    });

    it('trims names and drops blanks and repeats', () => {
        expect(readSceneCharacters({ Character: [' Jane ', '', 'Jane'] }, 'off').present).toEqual(['Jane']);
    });
});

describe('chooseLaneCharacters', () => {
    it('ranks POV holders by POV scenes, ahead of characters who only appear', () => {
        const scenes = [
            scene(['Darcy', 'Elizabeth']),
            scene(['Elizabeth', 'Darcy']),
            scene(['Elizabeth', 'Collins']),
            scene(['Collins', 'Charlotte']),
        ];
        // Elizabeth: 2 POV; Darcy and Collins: 1 POV each, Darcy first; Charlotte only appears.
        expect(chooseLaneCharacters(scenes)).toEqual(['Elizabeth', 'Darcy', 'Collins', 'Charlotte']);
    });

    it('fills from appearances when fewer than four ever hold POV', () => {
        const scenes = [
            scene(['Narrator', 'Ana', 'Ben']),
            scene(['Narrator', 'Ben', 'Cy']),
            scene(['Narrator', 'Ben', 'Dee', 'Eve']),
        ];
        // Ben appears 3 times; Ana, Cy, Dee and Eve once each, so the earliest (Ana, Cy) win.
        expect(chooseLaneCharacters(scenes)).toEqual(['Narrator', 'Ben', 'Ana', 'Cy']);
    });

    it('caps at four lanes and returns none for a book without characters', () => {
        expect(chooseLaneCharacters([scene(['A', 'B', 'C', 'D', 'E'], ['A', 'B', 'C', 'D', 'E'])])).toHaveLength(4);
        expect(chooseLaneCharacters([scene([])])).toEqual([]);
    });
});

describe('collectCharacterLaneEntries', () => {
    it('keeps each scene once, in wheel order, and leaves out beats', () => {
        const a = { path: 'a.md', itemType: 'Scene', Character: ['Ana'] } as TimelineItem;
        const b = { path: 'b.md', itemType: 'Scene', Character: ['Ben'] } as TimelineItem;
        const beat = { path: 'beat.md', itemType: 'Beat' } as TimelineItem;
        const positions = new Map([
            ['a.md', { startAngle: 1, endAngle: 2 }],
            ['b.md', { startAngle: 0, endAngle: 1 }],
            ['beat.md', { startAngle: 2, endAngle: 3 }],
        ]);
        const entries = collectCharacterLaneEntries([a, b, a, beat], positions, 'off');
        expect(entries.map(entry => entry.scene.path)).toEqual(['b.md', 'a.md']);
    });
});

describe('characterLanesActive', () => {
    it('applies only in Narrative mode, once turned on', () => {
        expect(characterLanesActive({ currentMode: 'narrative', showCharacterLanes: true })).toBe(true);
        expect(characterLanesActive({ showCharacterLanes: true })).toBe(true);
        expect(characterLanesActive({ currentMode: 'chronologue', showCharacterLanes: true })).toBe(false);
        expect(characterLanesActive({ currentMode: 'progress', showCharacterLanes: true })).toBe(false);
        expect(characterLanesActive({ currentMode: 'narrative' })).toBe(false);
    });
});

describe('character lane geometry', () => {
    it('reserves the band just inside the outermost ring and keeps the core where it was', () => {
        const base = { size: 1600, innerRadius: 200, subplotOuterRadius: 766, outerRadius: 800, numRings: 7, monthTickTerminal: 0, monthTextInset: 0 };
        const band = characterLaneBandWidth(4);
        const plain = computeRingGeometry(base);
        const inset = computeRingGeometry({ ...base, outerRingInset: band });

        expect(inset.lineInnerRadius).toBe(plain.lineInnerRadius);
        expect(inset.ringStartRadii[0]).toBe(200);
        const last = base.numRings - 1;
        expect(inset.ringStartRadii[last] + inset.ringWidths[last]).toBeCloseTo(766, 6);
        const gap = inset.ringStartRadii[last] - (inset.ringStartRadii[last - 1] + inset.ringWidths[last - 1]);
        expect(gap).toBeCloseTo(band, 6);

        // Lanes fit the gap: the outermost below the ring, the innermost above the next ring.
        const outerRingInner = inset.ringStartRadii[last];
        expect(characterLaneRadii(outerRingInner, 0).outer).toBe(outerRingInner - CHARACTER_LANE_PADDING);
        expect(characterLaneRadii(outerRingInner, 3).inner).toBeCloseTo(outerRingInner - band + CHARACTER_LANE_PADDING, 6);
        expect(characterLaneRadii(outerRingInner, 3).outer - characterLaneRadii(outerRingInner, 3).inner).toBe(CHARACTER_LANE_HEIGHT);
    });

    it('takes no space without lanes', () => {
        expect(characterLaneBandWidth(0)).toBe(0);
    });
});
