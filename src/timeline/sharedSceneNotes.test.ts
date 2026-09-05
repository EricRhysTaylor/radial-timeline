import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { SceneData } from '../sceneAnalysis/types';
import {
    mapSceneDataToSharedSceneNotes,
    mapSharedSceneNotesToTimelineItems,
    toRawWhenValue
} from './sharedSceneNotes';

function makeSceneData(path: string, frontmatter: Record<string, unknown>, body = ''): SceneData {
    return {
        file: makeFile(path),
        frontmatter,
        sceneNumber: null,
        body
    };
}

describe('shared scene notes', () => {
    it('sorts scoped scene notes in manuscript order and parses When consistently', () => {
        const notes = mapSceneDataToSharedSceneNotes([
            makeSceneData('Book/10 Later.md', { Class: 'Scene', When: 'not-a-date' }),
            makeSceneData('Book/2 Earlier.md', { Class: 'Scene', When: '2026-01-02 08:00', Summary: 'Summary text' }),
            makeSceneData('Book/3 Missing.md', { Class: 'Scene' })
        ]);

        expect(notes.map((note) => note.path)).toEqual([
            'Book/2 Earlier.md',
            'Book/3 Missing.md',
            'Book/10 Later.md'
        ]);
        expect(notes[0].whenParseIssue).toBeNull();
        expect(notes[1].whenParseIssue).toBe('missing_when');
        expect(notes[2].whenParseIssue).toBe('invalid_when');
        expect(notes[0].summary).toBe('Summary text');
    });

    it('maps shared scene notes to one timeline item per scene note', () => {
        const timelineItems = mapSharedSceneNotesToTimelineItems(mapSceneDataToSharedSceneNotes([
            makeSceneData('Book/1 One.md', { Class: 'Scene', When: '2026-01-01 08:00', Synopsis: 'Opening' }),
            makeSceneData('Book/2 Two.md', { Class: 'Scene' })
        ]));

        expect(timelineItems).toHaveLength(2);
        expect(timelineItems[0].title).toBe('1 One');
        expect(timelineItems[0].when).toBeInstanceOf(Date);
        expect(timelineItems[1].missingWhen).toBe(true);
        expect(timelineItems[1].synopsis).toBeUndefined();
    });

    it('normalizes Date-based When values back to raw local strings', () => {
        const raw = toRawWhenValue(new Date(2026, 0, 5, 13, 45, 0, 0));
        expect(raw).toBe('2026-01-05 13:45');
    });
});
