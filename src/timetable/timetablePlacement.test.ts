import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { timetableNarrativeOrder } from './timetablePlacement';

describe('standalone timetable placement order', () => {
    it('uses the full book, deduplicates paths, and orders beats with scenes by act', () => {
        const item = (path: string, itemType: 'Scene' | 'Beat', actNumber: number): TimelineItem => ({ path, itemType, actNumber, date: '' });
        const scenes = [item('Book/03 C.md', 'Scene', 2), item('Book/02 B.md', 'Scene', 1),
            item('Book/01.01 Beat.md', 'Beat', 1), item('Book/01 A.md', 'Scene', 1), item('Book/01 A.md', 'Scene', 1)];
        expect(timetableNarrativeOrder(scenes).map(entry => [entry.path, entry.act])).toEqual([
            ['Book/01 A.md', 0], ['Book/01.01 Beat.md', 0], ['Book/02 B.md', 0], ['Book/03 C.md', 1],
        ]);
    });
});
