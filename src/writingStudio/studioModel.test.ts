import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { actStarts, beatAt, buildOutline, buildStudioBook, chapterTitleIsNumber, scopeRange, splitSceneTitle, stepTarget } from './studioModel';

function scene(path: string, title: string, extra: Partial<TimelineItem> & { chapter?: string } = {}): TimelineItem {
    const { chapter, ...rest } = extra;
    return {
        itemType: 'Scene',
        path,
        title,
        date: '',
        rawFrontmatter: chapter === undefined ? {} : { Chapter: chapter },
        ...rest,
    };
}

describe('Writing Studio book model', () => {
    it('orders scenes by manuscript order, not by the order they arrive', () => {
        const book = buildStudioBook([
            scene('B/10.md', '10 Later'),
            scene('A/2.md', '2 Second'),
            scene('C/1.md', '1 First'),
        ]);
        expect(book.scenes.map(s => s.title)).toEqual(['1 First', '2 Second', '10 Later']);
        expect(book.scenes.map(s => s.index)).toEqual([0, 1, 2]);
    });

    it('leaves out beats, backdrops and matter, and lists each scene once with all its subplots', () => {
        const book = buildStudioBook([
            scene('S/1.md', '1 Opening', { subplot: 'Main Plot' }),
            scene('S/1.md', '1 Opening', { subplot: 'Romance' }),
            { itemType: 'Beat', path: 'B/1.md', title: '1.5 Catalyst', date: '' },
            { itemType: 'Backdrop', path: 'D/1.md', title: 'Storm', date: '' },
            { itemType: 'Frontmatter', path: 'F/0.md', title: '0 Title', date: '' },
            scene('S/2.md', '2 Next', { subplot: 'Romance' }),
        ]);
        expect(book.scenes.map(s => s.path)).toEqual(['S/1.md', 'S/2.md']);
        expect(book.scenes[0].subplots).toEqual(['Main Plot', 'Romance']);
        expect(book.subplots[0]).toBe('Main Plot');
    });

    it('opens a chapter at each Chapter marker and continues it until the next', () => {
        const book = buildStudioBook([
            scene('S/1.md', '1 Prologue'),
            scene('S/2.md', '2 Arrival', { chapter: 'The Arrival' }),
            scene('S/3.md', '3 Docks'),
            scene('S/4.md', '4 Escape', { chapter: 'The Escape' }),
        ]);
        expect(book.chapters.map(c => [c.title, c.firstScene, c.lastScene])).toEqual([
            ['The Arrival', 1, 2],
            ['The Escape', 3, 3],
        ]);
        expect(book.scenes.map(s => s.chapter)).toEqual([null, 0, 0, 1]);
    });

    it('lets a repeated title continue its chapter (first occurrence wins)', () => {
        const book = buildStudioBook([
            scene('S/1.md', '1 A', { chapter: 'Homecoming' }),
            scene('S/2.md', '2 B', { chapter: 'homecoming' }),
            scene('S/3.md', '3 C', { chapter: 'Departure' }),
        ]);
        expect(book.chapters.map(c => c.title)).toEqual(['Homecoming', 'Departure']);
        expect(book.scenes.map(s => s.chapter)).toEqual([0, 0, 1]);
    });

    it('reads a draft with no chapter markers by scene', () => {
        const book = buildStudioBook([scene('S/1.md', '1 A'), scene('S/2.md', '2 B')]);
        expect(book.chapters).toEqual([]);
        expect(scopeRange(book, 'chapter', 1)).toEqual({ first: 0, last: 1 });
        expect(stepTarget(book, 'chapter', 0, 1)).toBeNull();
        expect(stepTarget(book, 'scene', 0, 1)).toBe(1);
    });

    it('splits the order prefix from a scene title', () => {
        expect(splitSceneTitle('3 First Ball')).toEqual({ prefix: '3', name: 'First Ball' });
        expect(splitSceneTitle('12.5 Interlude')).toEqual({ prefix: '12.5', name: 'Interlude' });
        expect(splitSceneTitle('Untitled')).toEqual({ prefix: null, name: 'Untitled' });
    });
});

describe('Writing Studio contents outline', () => {
    const beat = (path: string, title: string, actNumber: number): TimelineItem => ({ itemType: 'Beat', path, title, date: '', actNumber });
    const book = buildStudioBook([
        beat('B/0.md', '0.5 Opening Image', 1),
        scene('S/1.md', '1 Prologue', { actNumber: 1 }),
        scene('S/2.md', '2 Arrival', { actNumber: 1, chapter: 'The Arrival' }),
        beat('B/2.md', '2.5 Catalyst', 1),
        scene('S/3.md', '3 Docks', { actNumber: 1 }),
        beat('B/3.md', '3.5 Break Into Two', 1),
        scene('S/4.md', '4 Escape', { actNumber: 2, chapter: 'The Escape' }),
        scene('S/5.md', '5 Bridge', { actNumber: 3 }),
    ]);

    it('places each beat after the scene its order prefix follows', () => {
        expect(book.beats.map(b => [b.name, b.afterScene])).toEqual([
            ['Opening Image', -1],
            ['Catalyst', 1],
            ['Break Into Two', 2],
        ]);
    });

    it('gives each scene the beat it carries, or the stage it is in', () => {
        // A beat happens in the scene just before it: Opening Image comes before any scene,
        // Catalyst follows scene 2 (index 1) and Break Into Two follows scene 3 (index 2).
        expect([0, 1, 2, 3, 4].map(index => beatAt(book, index)?.name)).toEqual([
            'Opening Image', 'Catalyst', 'Break Into Two', 'Break Into Two', 'Break Into Two',
        ]);
    });

    it('puts no beat on a scene before the first beat\'s scene', () => {
        const late = buildStudioBook([
            scene('S/1.md', '1 Prologue'),
            scene('S/2.md', '2 Arrival'),
            { itemType: 'Beat', path: 'B/2.md', title: '2.5 Catalyst', date: '' },
            scene('S/3.md', '3 Docks'),
        ]);
        expect(beatAt(late, 0)).toBeNull();
        expect(beatAt(late, 1)?.name).toBe('Catalyst');
        expect(beatAt(late, 2)?.name).toBe('Catalyst');
    });

    it('nests scenes and in-chapter beats under chapters, inside acts', () => {
        const outline = buildOutline(book);
        expect(outline.map(act => act.act)).toEqual([1, 2, 3]);
        expect(outline[0].entries).toEqual([
            { kind: 'beat', beat: 0 },
            { kind: 'scene', scene: 0 },
            { kind: 'chapter', chapter: 0, continued: false, children: [
                { kind: 'scene', scene: 1 },
                { kind: 'beat', beat: 1 },
                { kind: 'scene', scene: 2 },
                // A beat happens in the scene before it, so the act's last beat stays in that scene's chapter.
                { kind: 'beat', beat: 2 },
            ] },
        ]);
        expect(outline[1].entries).toEqual([
            { kind: 'chapter', chapter: 1, continued: false, children: [{ kind: 'scene', scene: 3 }] },
        ]);
        // A chapter running into the next act shows again there, marked as continued.
        expect(outline[2].entries).toEqual([
            { kind: 'chapter', chapter: 1, continued: true, children: [{ kind: 'scene', scene: 4 }] },
        ]);
    });
});

describe('Writing Studio navigation', () => {
    const book = buildStudioBook([
        scene('S/1.md', '1 Prologue', { actNumber: 1 }),
        scene('S/2.md', '2 Arrival', { actNumber: 1, chapter: 'The Arrival' }),
        scene('S/3.md', '3 Docks', { actNumber: 1 }),
        scene('S/4.md', '4 Escape', { actNumber: 2, chapter: 'The Escape' }),
        scene('S/5.md', '5 Chase', { actNumber: 2 }),
    ]);

    it('narrows the reading scope to a scene or its chapter', () => {
        expect(scopeRange(book, 'book', 2)).toEqual({ first: 0, last: 4 });
        expect(scopeRange(book, 'chapter', 2)).toEqual({ first: 1, last: 2 });
        expect(scopeRange(book, 'chapter', 0)).toEqual({ first: 0, last: 0 });
        expect(scopeRange(book, 'scene', 4)).toEqual({ first: 4, last: 4 });
    });

    it('steps by chapter through chapter openings, the opening run included', () => {
        expect(stepTarget(book, 'chapter', 0, 1)).toBe(1);
        expect(stepTarget(book, 'chapter', 2, 1)).toBe(3);
        expect(stepTarget(book, 'chapter', 4, 1)).toBeNull();
        expect(stepTarget(book, 'chapter', 4, -1)).toBe(3);
        expect(stepTarget(book, 'chapter', 3, -1)).toBe(1);
        expect(stepTarget(book, 'chapter', 1, -1)).toBe(0);
        expect(stepTarget(book, 'chapter', 0, -1)).toBeNull();
    });

    it('steps by scene within the book edges', () => {
        expect(stepTarget(book, 'scene', 0, -1)).toBeNull();
        expect(stepTarget(book, 'scene', 4, 1)).toBeNull();
        expect(stepTarget(book, 'scene', 2, -1)).toBe(1);
    });

    it('finds each act\'s opening scene', () => {
        expect(actStarts(book)).toEqual([{ act: 1, scene: 0 }, { act: 2, scene: 3 }]);
    });
});

describe('Writing Studio chapter labels', () => {
    it('knows when a chapter title already names its number, so the label is not repeated', () => {
        for (const title of ['Chapter 1', 'CHAPTER III.', 'chapter twelve', ' Chapter Twenty-One ']) expect(chapterTitleIsNumber(title)).toBe(true);
        for (const title of ['The Arrival', 'Chapter 1: The Arrival', 'Chapter', 'Netherfield Park Is Let']) expect(chapterTitleIsNumber(title)).toBe(false);
    });
});
