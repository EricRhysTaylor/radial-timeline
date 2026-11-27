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

    it('leaves a beat between two chapters outside both, as Writing Studio does', () => {
        const lines = withChapterHeadings([row('2'), row('3'), row('break', 'beat'), row('4'), row('end', 'beat'), { type: 'act', act: 2 }], chapterOf, chapters);
        const tags = lines.flatMap(line => line.type === 'row' ? [`${line.row.path}:${line.chapter ?? '-'}`] : []);
        expect(tags).toEqual(['2:0', '3:0', 'break:-', '4:1', 'end:-']);
    });

    it('repeats a chapter heading after an act divider, marked continued', () => {
        const lines = withChapterHeadings([row('4'), { type: 'act', act: 2 }, row('5')], chapterOf, chapters);
        const headings = lines.filter(line => line.type === 'chapter');
        expect(headings.map(line => line.type === 'chapter' && [line.title, line.continued, line.firstPath])).toEqual([
            ['The Escape', false, '4'],
            ['The Escape', true, '4'],
        ]);
    });
});
