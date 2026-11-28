import { describe, expect, it } from 'vitest';
import { withChapterHeadings, type TimetableLine, type TimetableRow } from './timetableModel';

function row(path: string, kind: TimetableRow['kind'] = 'scene'): TimetableLine {
    return { type: 'row', row: { path, basename: path, kind, className: null, prefix: null, act: 1, subplots: [], removedScene: false } };
}

describe('Timetable chapter headings', () => {
    const chapters = [
        { title: 'The Arrival', scenePaths: ['2', '3'] },
        { title: 'The Escape', scenePaths: ['4', '5'] },
    ];
    const chapterOf = new Map([['2', 0], ['3', 0], ['4', 1], ['5', 1]]);

    it('puts a heading above each chapter\'s first scene and tags the rows under it', () => {
        const lines = withChapterHeadings([row('1'), row('2'), row('beat', 'beat'), row('3'), row('4'), row('5')], chapterOf, chapters);
        expect(lines.map(line => line.type === 'chapter' ? `# ${line.title}` : line.type === 'row' ? `${line.row.path}:${line.chapter ?? '-'}` : line.type))
            .toEqual(['1:-', '# The Arrival', '2:0', 'beat:0', '3:0', '# The Escape', '4:1', '5:1']);
    });

    it('puts a beat in the chapter of the scene it follows, as Writing Studio does', () => {
        // A beat happens in the scene just before it: "break" follows 3 (The Arrival), "end" follows 4 (The Escape).
        const lines = withChapterHeadings([row('2'), row('3'), row('break', 'beat'), row('4'), row('end', 'beat'), { type: 'act', act: 2 }], chapterOf, chapters);
        const tags = lines.flatMap(line => line.type === 'row' ? [`${line.row.path}:${line.chapter ?? '-'}`] : []);
        expect(tags).toEqual(['2:0', '3:0', 'break:0', '4:1', 'end:1']);
    });

    it('leaves a beat outside any chapter when the scene before it is in none', () => {
        const lines = withChapterHeadings([row('1'), row('first', 'beat'), row('2')], chapterOf, chapters);
        const tags = lines.flatMap(line => line.type === 'row' ? [`${line.row.path}:${line.chapter ?? '-'}`] : []);
        expect(tags).toEqual(['1:-', 'first:-', '2:0']);
    });

    it('repeats a chapter heading after an act divider, marked continued', () => {
        const lines = withChapterHeadings([row('4'), { type: 'act', act: 2 }, row('5')], chapterOf, chapters);
        const headings = lines.filter(line => line.type === 'chapter');
        expect(headings.map(line => line.type === 'chapter' && [line.title, line.continued, line.firstPath])).toEqual([
            ['The Escape', false, '4'],
            ['The Escape', true, '4'],
        ]);
    });

    it('counts only the scenes under each heading, as Writing Studio\'s contents do', () => {
        const longChapters = [{ title: 'The Long Road', scenePaths: ['a', 'b', 'c'] }];
        const longOf = new Map([['a', 0], ['b', 0], ['c', 0]]);
        const lines = withChapterHeadings([row('a'), row('beat', 'beat'), row('b'), { type: 'act', act: 2 }, row('c')], longOf, longChapters);
        expect(lines.flatMap(line => line.type === 'chapter' ? [[line.continued, line.sceneCount]] : [])).toEqual([[false, 2], [true, 1]]);
    });

    it('marks a chapter continued when its act is laid out on its own, as a table grouped by act is', () => {
        const actTwoOnly = withChapterHeadings([row('5')], chapterOf, chapters);
        expect(actTwoOnly.flatMap(line => line.type === 'chapter' ? [[line.title, line.continued, line.firstPath]] : [])).toEqual([['The Escape', true, '4']]);
    });
});
