import { describe, expect, it } from 'vitest';
import { dedupeOuterRingOrderEntries, reorderScenesPreservingBeatGaps, type OuterRingOrderEntry } from './OuterRingDragController';

describe('dedupeOuterRingOrderEntries', () => {
    it('keeps only the first occurrence of each manuscript path', () => {
        const entries: OuterRingOrderEntry[] = [
            {
                sceneId: 'scene-1',
                path: 'Book/01 Scene One.md',
                basename: '01 Scene One',
                numberText: '1',
                subplot: 'Main Plot',
                ring: 3,
                itemType: 'Scene',
                startAngle: 0,
            },
            {
                sceneId: 'scene-1-duplicate',
                path: 'Book/01 Scene One.md',
                basename: '01 Scene One',
                numberText: '1',
                subplot: 'Main Plot',
                ring: 3,
                itemType: 'Scene',
                startAngle: 0.2,
            },
            {
                sceneId: 'scene-2',
                path: 'Book/02 Scene Two.md',
                basename: '02 Scene Two',
                numberText: '2',
                subplot: 'Main Plot',
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
                subplot: 'Main Plot',
                ring: 3,
                itemType: 'Scene',
                startAngle: 0,
            },
            {
                sceneId: 'beat-1',
                path: 'Book/01.01 Mid Beat.md',
                basename: '01.01 Mid Beat',
                numberText: '1.01',
                subplot: 'Main Plot',
                ring: 3,
                itemType: 'Beat',
                startAngle: 0.2,
            },
            {
                sceneId: 'scene-2',
                path: 'Book/02 Scene Two.md',
                basename: '02 Scene Two',
                numberText: '2',
                subplot: 'Main Plot',
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
