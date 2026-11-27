import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { buildStudioBook } from './studioModel';
import { wheelAngles, wheelVoidRuns } from './studioWheel';

function scene(path: string, title: string, actNumber: number, subplot: string): TimelineItem {
    return { itemType: 'Scene', path, title, date: '', actNumber, subplot, rawFrontmatter: {} };
}

describe('Writing Studio wheel', () => {
    const book = buildStudioBook([
        scene('S/1.md', '1 A', 1, 'Main Plot'),
        scene('S/2.md', '2 B', 1, 'Main Plot'),
        scene('S/3.md', '3 C', 1, 'Smugglers'),
        scene('S/4.md', '4 D', 2, 'Main Plot'),
        scene('S/5.md', '5 E', 2, 'Main Plot'),
        scene('S/6.md', '6 F', 2, 'Smugglers'),
    ]);

    it('merges a subplot ring\'s empty scenes into one void cell per run, split at acts', () => {
        expect(wheelVoidRuns(book, 'Smugglers')).toEqual([{ first: 0, last: 1 }, { first: 3, last: 4 }]);
        expect(wheelVoidRuns(book, 'Main Plot')).toEqual([{ first: 2, last: 2 }, { first: 5, last: 5 }]);
    });

    it('gives acts equal shares of the circle and scenes equal shares of their act', () => {
        const angles = wheelAngles(book);
        expect(angles[0].start).toBeCloseTo(-Math.PI / 2);
        expect(angles[3].start).toBeCloseTo(Math.PI / 2);
        expect(angles[5].end).toBeCloseTo(Math.PI * 1.5);
    });
});
