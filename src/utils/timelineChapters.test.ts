import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { normalizeBookProfile } from './books';
import {
    bookChapterContext,
    chapterFolderLevels,
    chapterFolderOf,
    collapseTimelineChapterMarkersByResolvedBoundary,
    parseChapterSourceOption,
    groupTimelineChapterMarkersByScenePath,
    PROPERTY_CHAPTER_CONTEXT,
    readSharedChapterTitle,
    resolveChapters,
    resolveTimelineChapterMarkers
} from './timelineChapters';

function makeItem(
    itemType: TimelineItem['itemType'],
    path: string,
    title: string,
    chapter?: unknown
): TimelineItem {
    return {
        itemType,
        path,
        title,
        date: '',
        rawFrontmatter: chapter === undefined ? {} : { Chapter: chapter }
    };
}

describe('Chapter source on a book profile', () => {
    it('survives settings normalization when it is a folder choice, and drops what cannot be followed', () => {
        const base = { id: 'b', title: 'B', sourceFolder: 'B' };
        expect(normalizeBookProfile({ ...base, chapterSource: { kind: 'folder', depth: 2 } }).chapterSource).toEqual({ kind: 'folder', depth: 2 });
        expect(normalizeBookProfile({ ...base, chapterSource: { kind: 'property' } }).chapterSource).toBeUndefined();
        expect(normalizeBookProfile({ ...base, chapterSource: { kind: 'folder', depth: 0 } } as never).chapterSource).toBeUndefined();
        expect(bookChapterContext(normalizeBookProfile({ ...base, chapterSource: { kind: 'folder', depth: 1 } })))
            .toEqual({ source: { kind: 'folder', depth: 1 }, bookFolder: 'B' });
    });
});

describe('resolveChapters', () => {
    const scene = (path: string, chapter?: string) => ({ path, rawFrontmatter: chapter === undefined ? {} : { Chapter: chapter } });
    const titles = (resolution: ReturnType<typeof resolveChapters>) => resolution.chapters.map(c => [c.title, c.scenePaths.length, c.split]);

    it('property: a marker opens a chapter that runs to the next, and a repeated title continues it', () => {
        const resolution = resolveChapters([
            scene('B/0.md'),
            scene('B/1.md', 'Homecoming'),
            scene('B/2.md', 'homecoming'),
            scene('B/3.md'),
            scene('B/4.md', 'Departure'),
        ], PROPERTY_CHAPTER_CONTEXT);
        expect(titles(resolution)).toEqual([['Homecoming', 3, false], ['Departure', 1, false]]);
        expect(resolution.chapterOf.has('B/0.md')).toBe(false);
        expect(resolution.chapterOf.get('B/3.md')).toBe(0);
    });

    it('folder: chapter folders directly under the book, names as titles, unnumbered', () => {
        const context = { source: { kind: 'folder' as const, depth: 1 }, bookFolder: 'Book' };
        const resolution = resolveChapters([
            scene('Book/Prologue.md'),
            scene('Book/The Arrival/01.md'),
            scene('Book/The Arrival/02.md'),
            scene('Book/The Escape/03.md'),
        ], context);
        expect(titles(resolution)).toEqual([['The Arrival', 2, false], ['The Escape', 1, false]]);
        expect(resolution.chapters[0].folder).toBe('Book/The Arrival');
        expect(resolution.chapterOf.has('Book/Prologue.md')).toBe(false);
    });

    it('folder: chapters inside act folders, at depth 2', () => {
        const context = { source: { kind: 'folder' as const, depth: 2 }, bookFolder: 'Book' };
        const resolution = resolveChapters([
            scene('Book/Act 1/The Arrival/01.md'),
            scene('Book/Act 1/The Escape/02.md'),
            scene('Book/Act 2/Homecoming/03.md'),
        ], context);
        expect(titles(resolution)).toEqual([['The Arrival', 1, false], ['The Escape', 1, false], ['Homecoming', 1, false]]);
    });

    it('folder: keeps scene order when a folder is interleaved, and flags the split', () => {
        const context = { source: { kind: 'folder' as const, depth: 1 }, bookFolder: 'Book' };
        const resolution = resolveChapters([
            scene('Book/The Arrival/01.md'),
            scene('Book/The Arrival/02.md'),
            scene('Book/The Escape/03.md'),
            scene('Book/The Arrival/04.md'),
        ], context);
        expect(titles(resolution)).toEqual([['The Arrival', 2, true], ['The Escape', 1, false], ['The Arrival', 1, true]]);
    });

    it('turns chapters into timeline markers at each opening scene', () => {
        const markers = resolveTimelineChapterMarkers([
            makeItem('Scene', 'B/1.md', '1 A', 'Homecoming'),
            makeItem('Scene', 'B/2.md', '2 B', 'Homecoming'),
            makeItem('Scene', 'B/3.md', '3 C', 'Departure'),
        ]);
        expect(markers.map(m => [m.title, m.resolvedTimelinePosition])).toEqual([['Homecoming', 1], ['Departure', 3]]);
    });

    it('lists folder names per level for the Chapter source choices', () => {
        expect(chapterFolderLevels([
            'Book/Act 1/The Arrival/01.md',
            'Book/Act 1/The Escape/02.md',
            'Book/Act 2/Homecoming/03.md',
            'Book/04.md',
        ], 'Book')).toEqual([['Act 1', 'Act 2'], ['The Arrival', 'The Escape', 'Homecoming']]);
        expect(parseChapterSourceOption('folder:2')).toEqual({ kind: 'folder', depth: 2 });
        expect(parseChapterSourceOption('property')).toEqual({ kind: 'property' });
    });

    it('finds the chapter folder at a depth, or none', () => {
        expect(chapterFolderOf('Book/Act 1/Ch/01.md', 'Book', 2)).toEqual({ folder: 'Book/Act 1/Ch', title: 'Ch' });
        expect(chapterFolderOf('Book/01.md', 'Book', 1)).toBeNull();
        expect(chapterFolderOf('Other/Ch/01.md', 'Book', 1)).toBeNull();
    });
});

describe('timelineChapters', () => {
    it('reads only non-empty Chapter strings from frontmatter', () => {
        expect(readSharedChapterTitle({ Chapter: '  Arrival  ' })).toBe('Arrival');
        expect(readSharedChapterTitle({ Chapter: '   ' })).toBeUndefined();
        expect(readSharedChapterTitle({ Chapter: 12 })).toBeUndefined();
        expect(readSharedChapterTitle({})).toBeUndefined();
    });

    it('resolves scene chapter markers and ignores beat/backdrop Chapter fields', () => {
        const items: TimelineItem[] = [
            makeItem('Beat', 'Beats/1.md', '1 Opening Beat', 'Prologue'),
            makeItem('Backdrop', 'Backdrop/1.md', '1.5 Storm Front', 'The Storm'),
            makeItem('Scene', 'Scenes/1.md', '2 Opening Scene'),
            makeItem('Scene', 'Scenes/2.md', '3 Second Scene', 'A Door Opens'),
            makeItem('Beat', 'Beats/2.md', '4 Final Beat', 'Unused ending marker'),
        ];

        const markers = resolveTimelineChapterMarkers(items);
        expect(markers).toEqual([
            {
                sourcePath: 'Scenes/2.md',
                sourceType: 'Scene',
                title: 'A Door Opens',
                resolvedScenePath: 'Scenes/2.md',
                resolvedTimelinePosition: 2,
            },
        ]);
    });

    it('groups scene markers by their source scene path', () => {
        const markers = resolveTimelineChapterMarkers([
            makeItem('Scene', 'Scenes/0.md', '1 Prologue', 'Before Dawn'),
            makeItem('Scene', 'Scenes/1.md', '2 Scene', 'The City Wakes'),
        ]);

        const grouped = groupTimelineChapterMarkersByScenePath(markers);
        expect(grouped['Scenes/0.md']?.map((marker) => marker.title)).toEqual(['Before Dawn']);
        expect(grouped['Scenes/1.md']?.map((marker) => marker.title)).toEqual(['The City Wakes']);
    });

    it('collapses chapter markers to the final resolved boundary marker for visualization', () => {
        const markers = resolveTimelineChapterMarkers([
            makeItem('Beat', 'Beats/1.md', '1 Beat', 'Before Dawn'),
            makeItem('Backdrop', 'Backdrop/1.md', '1.5 Front', 'Storm Warning'),
            makeItem('Scene', 'Scenes/1.md', '2 Scene', 'The City Wakes'),
            makeItem('Scene', 'Scenes/2.md', '3 Scene'),
        ]);

        expect(collapseTimelineChapterMarkersByResolvedBoundary(markers)).toEqual([
            {
                sourcePath: 'Scenes/1.md',
                sourceType: 'Scene',
                title: 'The City Wakes',
                resolvedScenePath: 'Scenes/1.md',
                resolvedTimelinePosition: 1,
            },
        ]);
    });
});
