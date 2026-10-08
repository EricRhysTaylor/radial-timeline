import { describe, expect, it } from 'vitest';
import {
    dedupeOuterRingOrderEntries,
    describeSubplots,
    planRingDropOrder,
    planRingDropSubplots,
    reorderScenesPreservingBeatGaps,
    type OuterRingOrderEntry,
} from './OuterRingDragController';

describe('dedupeOuterRingOrderEntries', () => {
    it('keeps only the first occurrence of each manuscript path', () => {
        const entries: OuterRingOrderEntry[] = [
            {
                sceneId: 'scene-1',
                path: 'Book/01 Scene One.md',
                basename: '01 Scene One',
                numberText: '1',
                act: 0,
                ring: 3,
                itemType: 'Scene',
                startAngle: 0,
            },
            {
                sceneId: 'scene-1-duplicate',
                path: 'Book/01 Scene One.md',
                basename: '01 Scene One',
                numberText: '1',
                act: 0,
                ring: 3,
                itemType: 'Scene',
                startAngle: 0.2,
            },
            {
                sceneId: 'scene-2',
                path: 'Book/02 Scene Two.md',
                basename: '02 Scene Two',
                numberText: '2',
                act: 0,
                ring: 3,
                itemType: 'Scene',
                startAngle: 0.4,
            },
        ];

        const deduped = dedupeOuterRingOrderEntries(entries);
        expect(deduped).toHaveLength(2);
        expect(deduped.map(entry => entry.path)).toEqual([
            'Book/01 Scene One.md',
            'Book/02 Scene Two.md',
        ]);
        expect(deduped[0]?.sceneId).toBe('scene-1');
    });
});

describe('reorderScenesPreservingBeatGaps', () => {
    it('keeps gap beats between scene slots when reordering scenes', () => {
        const entries: OuterRingOrderEntry[] = [
            {
                sceneId: 'scene-1',
                path: 'Book/01 Scene One.md',
                basename: '01 Scene One',
                numberText: '1',
                act: 0,
                ring: 3,
                itemType: 'Scene',
                startAngle: 0,
            },
            {
                sceneId: 'beat-1',
                path: 'Book/01.01 Mid Beat.md',
                basename: '01.01 Mid Beat',
                numberText: '1.01',
                act: 0,
                ring: 3,
                itemType: 'Beat',
                startAngle: 0.2,
            },
            {
                sceneId: 'scene-2',
                path: 'Book/02 Scene Two.md',
                basename: '02 Scene Two',
                numberText: '2',
                act: 0,
                ring: 3,
                itemType: 'Scene',
                startAngle: 0.4,
            },
        ];

        const reordered = reorderScenesPreservingBeatGaps(entries, 'scene-2', 'scene-1');
        expect(reordered.map((entry) => entry.path)).toEqual([
            'Book/02 Scene Two.md',
            'Book/01.01 Mid Beat.md',
            'Book/01 Scene One.md',
        ]);
    });
});

// The Lighthouse sample around the Act 1/2 boundary, as the outer ring orders it.
function lighthouse(): OuterRingOrderEntry[] {
    const rows: Array<[string, number, 'Scene' | 'Beat']> = [
        ['9 Scene', 0, 'Scene'],
        ['10 Scene', 0, 'Scene'],
        ['10.01 Debate', 0, 'Beat'],
        ['11 Scene', 1, 'Scene'],
        ['11.01 Break into Two', 1, 'Beat'],
        ['12 Scene', 1, 'Scene'],
        ['12.01 B Story', 1, 'Beat'],
        ['13 Scene', 1, 'Scene'],
        ['14 Scene', 1, 'Scene'],
        ['14.01 Fun and Games', 1, 'Beat'],
        ['15 Scene', 1, 'Scene'],
        ['21 Scene', 2, 'Scene'],
    ];
    return rows.map(([basename, act, itemType], index) => ({
        sceneId: `id-${basename}`,
        path: `Book/${basename}.md`,
        basename,
        numberText: basename.split(' ')[0],
        act,
        ring: 3,
        itemType,
        startAngle: index * 0.1,
    }));
}

const names = (entries: OuterRingOrderEntry[]): string[] => entries.map((entry) => entry.basename);

describe('planRingDropOrder', () => {
    it('keeps manuscript order for a subplot-ring drop in the same act, whatever the drop angle', () => {
        // Sequence alignment leaves a gap in another subplot's ring at scene 11's
        // angle; dropping scene 14 there used to insert it before 11 (14 became 11).
        const order = lighthouse();
        const at11 = order.find((entry) => entry.basename === '11 Scene')!.startAngle;
        expect(names(planRingDropOrder(order, 'Book/14 Scene.md', { act: 1, startAngle: at11, isOuterRing: false })))
            .toEqual(names(order));
    });

    it('puts a scene first in a later act when dropped on that act of a subplot ring', () => {
        const result = names(planRingDropOrder(lighthouse(), 'Book/10 Scene.md', { act: 1, startAngle: 99, isOuterRing: false }));
        expect(result.slice(0, 4)).toEqual(['9 Scene', '10.01 Debate', '10 Scene', '11 Scene']);
    });

    it('puts a scene last in an earlier act when dropped on that act of a subplot ring', () => {
        const result = names(planRingDropOrder(lighthouse(), 'Book/14 Scene.md', { act: 0, startAngle: 0, isOuterRing: false }));
        expect(result.slice(0, 5)).toEqual(['9 Scene', '10 Scene', '10.01 Debate', '14 Scene', '11 Scene']);
    });

    it('still inserts by angle for an empty act on the outer ring', () => {
        const order = lighthouse();
        const at21 = order.find((entry) => entry.basename === '21 Scene')!.startAngle;
        const result = names(planRingDropOrder(order, 'Book/12 Scene.md', { act: 2, startAngle: at21, isOuterRing: true }));
        expect(result.slice(-2)).toEqual(['12 Scene', '21 Scene']);
    });
});

describe('planRingDropSubplots', () => {
    it('moves a scene from one subplot to another', () => {
        expect(planRingDropSubplots(['The Shipwreck'], "The Keeper's Letters")).toEqual(["The Keeper's Letters"]);
    });

    it('keeps Main Plot alongside the new subplot', () => {
        expect(planRingDropSubplots(['Main Plot', 'The Shipwreck'], "The Keeper's Letters")).toEqual(['Main Plot', "The Keeper's Letters"]);
    });

    it('changes nothing when the scene is already in the target subplot', () => {
        expect(planRingDropSubplots(['The Shipwreck', "The Keeper's Letters"], 'The Shipwreck')).toBeUndefined();
    });
});

describe('describeSubplots', () => {
    it("names the scene's own subplots, and Main Plot when it has none", () => {
        expect(describeSubplots(['The Shipwreck'])).toBe('The Shipwreck');
        expect(describeSubplots(['Main Plot', 'The Shipwreck'])).toBe('Main Plot, The Shipwreck');
        expect(describeSubplots([])).toBe('Main Plot');
    });
});
