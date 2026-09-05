import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { buildPartContainerSummaries } from './SetPartModal';

function scene(title: string, part?: unknown): TimelineItem {
    return {
        itemType: 'Scene',
        path: `Scenes/${title}.md`,
        title,
        date: '',
        rawFrontmatter: part === undefined ? {} : { Part: part },
    };
}

describe('buildPartContainerSummaries', () => {
    it('numbers parts sequentially by marker order, matching the export', () => {
        const summaries = buildPartContainerSummaries([
            scene('1 First', true),
            scene('2 Second'),
            scene('3 Third', 'The Crossing'),
        ]);

        expect(summaries.map(part => [part.numeral, part.title])).toEqual([
            ['I', undefined],
            ['II', 'The Crossing'],
        ]);
    });

    it('reports the scene range each part covers', () => {
        const summaries = buildPartContainerSummaries([
            scene('1 First', true),
            scene('2 Second'),
            scene('3 Third', true),
        ]);

        expect(summaries[0]).toMatchObject({ start: 1, end: 2, sceneCount: 2 });
        expect(summaries[1]).toMatchObject({ start: 3, end: 3, sceneCount: 1 });
    });

    it('gathers scenes before the first marker into an unparted container', () => {
        // A prologue ahead of Part I is legitimate — the same shape as scenes
        // before the first chapter.
        const summaries = buildPartContainerSummaries([
            scene('1 Prologue'),
            scene('2 First', true),
        ]);

        expect(summaries[0]).toMatchObject({ isUnparted: true, sceneCount: 1 });
        expect(summaries[1]).toMatchObject({ numeral: 'I', sceneCount: 1 });
    });

    it('ignores an empty Part value, which is not a marker', () => {
        const summaries = buildPartContainerSummaries([scene('1 First', '')]);
        expect(summaries).toHaveLength(1);
        expect(summaries[0].isUnparted).toBe(true);
    });

    it('returns nothing for a book with no scenes', () => {
        expect(buildPartContainerSummaries([])).toEqual([]);
    });
});
