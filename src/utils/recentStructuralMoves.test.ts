import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings, StructuralMoveHistoryEntry } from '../types/settings';
import {
    MAX_RECENT_STRUCTURAL_MOVES,
    appendRecentStructuralMove,
    getActiveRecentStructuralMoves,
    normalizeRecentStructuralMoves
} from './recentStructuralMoves';

function makeSettings(): RadialTimelineSettings {
    return {
        ...DEFAULT_SETTINGS,
        books: [
            { id: 'book-1', title: 'Book One', sourceFolder: 'Books/One' },
            { id: 'book-2', title: 'Book Two', sourceFolder: 'Books/Two' }
        ],
        activeBookId: 'book-1'
    };
}

function makeEntry(index: number, overrides: Partial<StructuralMoveHistoryEntry> = {}): StructuralMoveHistoryEntry {
    return {
        timestamp: new Date(Date.UTC(2026, 0, index, 12, 0, 0)).toISOString(),
        itemType: 'Scene',
        itemId: `scene_${index}`,
        itemLabel: `Scene ${index}`,
        summary: `Scene ${index} before Scene ${index + 1}`,
        ...overrides
    };
}

describe('recent structural moves', () => {
    it('keeps newest first and trims to the last twenty entries', () => {
        const settings = makeSettings();

        for (let i = 1; i <= 24; i += 1) {
            appendRecentStructuralMove(settings, makeEntry(i));
        }

        const entries = getActiveRecentStructuralMoves(settings);
        expect(entries).toHaveLength(MAX_RECENT_STRUCTURAL_MOVES);
        expect(entries.map((entry) => entry.itemId)).toEqual([
            'scene_24',
            'scene_23',
            'scene_22',
            'scene_21',
            'scene_20',
            'scene_19',
            'scene_18',
            'scene_17',
            'scene_16',
            'scene_15',
            'scene_14',
            'scene_13',
            'scene_12',
            'scene_11',
            'scene_10',
            'scene_9',
            'scene_8',
            'scene_7',
            'scene_6',
            'scene_5'
        ]);
    });

    it('stores history per active book', () => {
        const settings = makeSettings();
        appendRecentStructuralMove(settings, makeEntry(1));

        settings.activeBookId = 'book-2';
        appendRecentStructuralMove(settings, makeEntry(2, { itemId: 'scene_book_2' }));

        expect(getActiveRecentStructuralMoves(settings).map((entry) => entry.itemId)).toEqual(['scene_book_2']);

        settings.activeBookId = 'book-1';
        expect(getActiveRecentStructuralMoves(settings).map((entry) => entry.itemId)).toEqual(['scene_1']);
    });

    it('normalizes invalid rows away and preserves valid history', () => {
        const normalized = normalizeRecentStructuralMoves([
            makeEntry(1),
            { ...makeEntry(2), itemId: '   ' },
            { ...makeEntry(3), summary: '   ' }
        ] as StructuralMoveHistoryEntry[]);

        expect(normalized).toEqual([
            {
                ...makeEntry(1),
                renameCount: 0,
                crossedActs: false,
                rippleRename: false
            }
        ]);
    });
});
