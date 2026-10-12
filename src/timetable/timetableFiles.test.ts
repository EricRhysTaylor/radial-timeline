import { describe, expect, it } from 'vitest';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    buildBookTimetableContent,
    buildSagaTimetableContent,
    findTimetableViewName,
    retargetFolderFilter,
    tableColumns,
    tableFileStem,
    TIMETABLE_VIEW_TYPE,
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

describe('findTimetableViewName', () => {
    it('finds the Timetable view even after the author reorders views', () => {
        expect(findTimetableViewName({ views: [{ type: 'table', name: 'Table' }, { type: TIMETABLE_VIEW_TYPE, name: 'My TT' }] })).toBe('My TT');
        expect(findTimetableViewName({ views: [{ type: 'table', name: 'Table' }] })).toBeNull();
    });
});
