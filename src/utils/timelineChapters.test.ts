import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import {
    collapseTimelineChapterMarkersByResolvedBoundary,
    groupTimelineChapterMarkersByScenePath,
    readSharedChapterTitle,
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
