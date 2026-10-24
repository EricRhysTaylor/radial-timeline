import { describe, expect, it } from 'vitest';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    buildBookTimetableContent,
    buildSagaTimetableContent,
    countColumnFill,
    findTimetableViewName,
    retargetFolderFilter,
    retargetSagaFolderFilter,
    tableColumns,
    tableFileStem,
    TIMETABLE_VIEW_TYPE,
    withRecommendedColumns,
} from './timetableFiles';

const settings = { ...DEFAULT_SETTINGS, enableCustomMetadataMapping: false, actCount: 3 } as RadialTimelineSettings;
const names = { timetable: 'Timetable', table: 'Table', notOnTimeline: 'Not on the timeline', actBoard: 'Act board', statusBoard: 'Status board' };

describe('tableFileStem', () => {
    it('keeps the book title, made safe for file names', () => {
        expect(tableFileStem('Book 2 Saturn & Jupiter')).toBe('Book 2 Saturn & Jupiter');
        expect(tableFileStem('Draft: v2/final?')).toBe('Draft v2 final');
        expect(tableFileStem('  ')).toBe('Untitled');
    });
});

describe('tableColumns', () => {
    it('leaves out of the Timetable what its number cell and Rings column show', () => {
        const columns = tableColumns(settings);
        expect(columns.timetable[0]).toBe('file.name');
        expect(columns.timetable).toContain('When');
        expect(columns.timetable).toContain('Synopsis');
        expect(columns.timetable).not.toContain('Status');
        expect(columns.timetable).not.toContain('Subplot');
        expect(columns.timetable).not.toContain('Act');
        expect(columns.table).toContain('Act');
        expect(columns.table).toContain('Status');
        expect(columns.table).toContain('Subplot');
    });

    it('leads with When, Character, Place, Due and Words, and ends with Synopsis', () => {
        const { timetable } = tableColumns(settings);
        expect(timetable.slice(0, 6)).toEqual(['file.name', 'When', 'Character', 'Place', 'Due', 'Words']);
        expect(timetable[timetable.length - 1]).toBe('Synopsis');
    });

    it('starts without Duration, Chapter, Runtime and Iteration, which the built-in Table keeps', () => {
        const { timetable, table } = tableColumns(settings);
        for (const key of ['Duration', 'Chapter', 'Runtime', 'Iteration']) {
            expect(timetable).not.toContain(key);
            expect(table).toContain(key);
        }
    });

    it('leaves out columns fewer than half of the book’s scenes fill, but never When or Synopsis', () => {
        const scene = (extra: Record<string, unknown>) => ({ Class: 'Scene', When: '', Synopsis: '', Character: 'Mara', ...extra });
        const fill = countColumnFill([
            scene({ POV: 'Mara' }), scene({}), scene({}), scene({}), scene({}),
            { Class: 'Sketch', POV: 'Ilse' },
        ], settings);
        const { timetable } = tableColumns(settings, fill);
        expect(timetable).toContain('Character');
        expect(timetable).not.toContain('POV');
        expect(timetable).toContain('When');
        expect(timetable).toContain('Synopsis');
    });

    it('keeps every column while a book has too few scenes to tell', () => {
        const fill = countColumnFill([{ Class: 'Scene' }, { Class: 'Scene' }], settings);
        expect(tableColumns(settings, fill).timetable).toEqual(tableColumns(settings).timetable);
    });

    it('uses the author’s mapped key names', () => {
        const mapped = { ...settings, enableCustomMetadataMapping: true, frontmatterMappings: { 'Scene When': 'When' } } as RadialTimelineSettings;
        expect(tableColumns(mapped).timetable).toContain('Scene When');
    });
});

describe('buildBookTimetableContent', () => {
    it('writes the five views, filtered to the book folder', () => {
        const content = buildBookTimetableContent({ sourceFolder: 'Book 2 Saturn & Jupiter' }, settings, names, true);
        expect(content.filters).toEqual({ and: ['file.inFolder("Book 2 Saturn & Jupiter")', 'file.ext == "md"'] });
        expect(content.views.map(view => [view.type, view.name])).toEqual([
            [TIMETABLE_VIEW_TYPE, 'Timetable'],
            ['table', 'Table'],
            ['table', 'Not on the timeline'],
            ['kanban', 'Act board'],
            ['kanban', 'Status board'],
        ]);
        expect(content.views[2].filters).toEqual({ and: ['Class.isEmpty()'] });
        expect(content.views[3].groupOrder).toEqual([1, 2, 3, null]);
    });

    it('never lists a group order on the Timetable, which would hide unlisted acts', () => {
        const content = buildBookTimetableContent({ sourceFolder: 'B' }, settings, names, true);
        expect(content.views[0].groupBy).toEqual({ property: 'Act', direction: 'ASC' });
        expect(content.views[0].groupOrder).toBeUndefined();
        expect(content.views[1].groupOrder).toBeUndefined();
    });

    it('leaves the boards out where Obsidian has no kanban view', () => {
        expect(buildBookTimetableContent({ sourceFolder: 'B' }, settings, names, false).views).toHaveLength(3);
    });
});

describe('buildSagaTimetableContent', () => {
    it('covers every saga book', () => {
        const content = buildSagaTimetableContent([{ sourceFolder: 'Book 1' }, { sourceFolder: 'Book 2' }], settings, names);
        expect(content.filters).toEqual({ and: [{ or: ['file.inFolder("Book 1")', 'file.inFolder("Book 2")'] }, 'file.ext == "md"'] });
        expect(content.views[0].groupBy).toBeUndefined();
    });
});

describe('retargetFolderFilter', () => {
    it('replaces only the folder term RT wrote', () => {
        const content = 'filters:\n  and:\n    - file.inFolder("Book 2")\n    - Words > 0\nviews: []\n';
        expect(retargetFolderFilter(content, 'Book 2', 'Book 2 Saturn')).toBe('filters:\n  and:\n    - file.inFolder("Book 2 Saturn")\n    - Words > 0\nviews: []\n');
    });

    it('also finds the single-quoted form Obsidian may save', () => {
        expect(retargetFolderFilter("- file.inFolder('Book 2')", 'Book 2', 'B')).toBe('- file.inFolder("B")');
    });

    it('rewrites nothing when the author changed the filter', () => {
        expect(retargetFolderFilter('- file.inFolder("Elsewhere")', 'Book 2', 'B')).toBeNull();
    });
});

describe('retargetSagaFolderFilter', () => {
    const group = (...folders: string[]) => ({ or: folders.map(folder => `file.inFolder("${folder}")`) });

    it('adds a joining book and keeps the author’s own All views filters', () => {
        const parsed = {
            filters: { and: ['POV == "Kade"', group('Book 1', 'Book 2'), 'file.ext == "md"'] },
            views: [{ type: TIMETABLE_VIEW_TYPE, name: 'Timetable', order: ['file.name'] }],
        };
        expect(retargetSagaFolderFilter(parsed, ['Book 1', 'Book 2'], ['Book 1', 'Book 2', 'Book 3'])).toEqual({
            filters: { and: ['POV == "Kade"', group('Book 1', 'Book 2', 'Book 3'), 'file.ext == "md"'] },
            views: [{ type: TIMETABLE_VIEW_TYPE, name: 'Timetable', order: ['file.name'] }],
        });
    });

    it('follows the group into the one view the author moved it to', () => {
        const parsed = {
            filters: { and: ['file.ext == "md"'] },
            views: [
                { type: TIMETABLE_VIEW_TYPE, name: 'Timetable', filters: { and: ['Words > 0', group('Book 2', 'Book 1')] } },
                { type: 'table', name: 'Table' },
            ],
        };
        const next = retargetSagaFolderFilter(parsed, ['Book 1', 'Book 2'], ['Book 1']);
        expect(next?.filters).toEqual({ and: ['file.ext == "md"'] });
        expect(next?.views).toEqual([
            { type: TIMETABLE_VIEW_TYPE, name: 'Timetable', filters: { and: ['Words > 0', group('Book 1')] } },
            { type: 'table', name: 'Table' },
        ]);
    });

    it('also finds the single-quoted form Obsidian may save', () => {
        const parsed = { filters: { and: [{ or: ["file.inFolder('Book 1')", "file.inFolder('Book 2')"] }] } };
        expect(retargetSagaFolderFilter(parsed, ['Book 1', 'Book 2'], ['Book 3'])?.filters).toEqual({ and: [group('Book 3')] });
    });

    it('rewrites nothing when the author changed the group', () => {
        const extraTerm = { filters: { and: [{ or: ['file.inFolder("Book 1")', 'file.inFolder("Book 2")', 'file.inFolder("Notes")'] }] } };
        const droppedBook = { filters: { and: [group('Book 1')] } };
        expect(retargetSagaFolderFilter(extraTerm, ['Book 1', 'Book 2'], ['Book 3'])).toBeNull();
        expect(retargetSagaFolderFilter(droppedBook, ['Book 1', 'Book 2'], ['Book 3'])).toBeNull();
    });
});

describe('findTimetableViewName', () => {
    it('finds the Timetable view even after the author reorders views', () => {
        expect(findTimetableViewName({ views: [{ type: 'table', name: 'Table' }, { type: TIMETABLE_VIEW_TYPE, name: 'My TT' }] })).toBe('My TT');
        expect(findTimetableViewName({ views: [{ type: 'table', name: 'Table' }] })).toBeNull();
    });
});

describe('countColumnFill', () => {
    it('counts only scenes, and only values with something in them', () => {
        const fill = countColumnFill([
            { Class: 'Scene', Place: 'North Light', POV: '  ', Character: [] },
            { class: 'scene', place: 'Harbor Office', Character: ['Ilse'] },
            { Class: 'Sketch', Place: 'Lantern Row' },
            undefined,
        ], settings);
        expect(fill.scenes).toBe(2);
        expect(fill.filled.get('place')).toBe(2);
        expect(fill.filled.get('character')).toBe(1);
        expect(fill.filled.get('pov')).toBeUndefined();
    });
});

describe('withRecommendedColumns', () => {
    const parsed = {
        filters: { and: ['file.inFolder("B")'] },
        views: [
            { type: 'table', name: 'Table', order: ['file.name', 'Act'], columnSize: { 'note.Act': 60 } },
            { type: TIMETABLE_VIEW_TYPE, name: 'Timetable', order: ['file.name', 'Chapter'], columnSize: { 'note.Chapter': 200 }, sort: [{ property: 'file.name', direction: 'ASC' }] },
        ],
    };

    it('replaces only that view’s columns and drops its saved widths', () => {
        const next = withRecommendedColumns(parsed, 'Timetable', ['file.name', 'When']) as typeof parsed;
        expect(next.views[1]).toEqual({ type: TIMETABLE_VIEW_TYPE, name: 'Timetable', order: ['file.name', 'When'], sort: [{ property: 'file.name', direction: 'ASC' }] });
        expect(next.views[0]).toEqual(parsed.views[0]);
        expect(next.filters).toEqual(parsed.filters);
    });

    it('changes nothing when the file has no Timetable view of that name', () => {
        expect(withRecommendedColumns(parsed, 'Table', ['file.name'])).toBeNull();
        expect(withRecommendedColumns({ views: 'broken' }, 'Timetable', ['file.name'])).toBeNull();
    });
});
