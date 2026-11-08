import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import type { SubplotColor } from '../renderer/utils/subplotColors';
import type { TimetableRow } from './timetableModel';
import { bookCardFor, bookSubplotChoices, ownColorsForNewSubplots, ringColorsWith } from './canvasBookCards';

describe('Ring colors after new scenes join', () => {
    const scene = (...subplots: string[]) => ({ kind: 'scene', subplots });
    it('keeps Main Plot first, then orders rings by scene count', () => {
        const colors = ringColorsWith([scene('Main Plot'), scene('Mara'), scene('Mara')], ['Tom', 'Tom', 'Tom'], new Map());
        expect([...colors]).toEqual([
            ['Main Plot', { kind: 'slot', slot: 0 }],
            ['Tom', { kind: 'slot', slot: 1 }],
            ['Mara', { kind: 'slot', slot: 2 }],
        ]);
    });
    it('leaves sketches out of the count', () => {
        expect(ringColorsWith([{ kind: 'sketch', subplots: ['Mara'] }], ['Tom'], new Map()).has('Mara')).toBe(false);
    });
    it('gives a new subplot with its own color no palette slot, so existing rings keep theirs', () => {
        const colors = ringColorsWith([scene('Main Plot'), scene('Mara')], ['Tom', 'Tom', 'Tom'], new Map([['Tom', '#e93147']]));
        expect(colors.get('Tom')).toEqual({ kind: 'own', color: '#e93147' });
        expect(colors.get('Mara')).toEqual({ kind: 'slot', slot: 1 });
    });
});

describe('A book’s subplots for a card color', () => {
    it('lists the timeline’s rings in ring order with their colors, Main Plot first, then subplots only sketches name', () => {
        const wheel = new Map<string, SubplotColor>([['Main Plot', { kind: 'slot', slot: 0 }], ['Romance', { kind: 'own', color: '#e93147' }], ['Mara', { kind: 'slot', slot: 1 }]]);
        const rows = [{ kind: 'sketch', subplots: ['Letters'] }, { kind: 'scene', subplots: ['Mara'] }] as TimetableRow[];
        expect(bookSubplotChoices(wheel, new Map([['Romance', '#e93147']]), rows)).toEqual([
            { name: 'Main Plot', color: { kind: 'slot', slot: 0 } },
            { name: 'Romance', color: { kind: 'own', color: '#e93147' } },
            { name: 'Mara', color: { kind: 'slot', slot: 1 } },
            { name: 'Letters', color: { kind: 'slot', slot: 2 } },
        ]);
    });
    it('keeps Main Plot first in a book with no scenes yet', () => {
        expect(bookSubplotChoices(new Map(), new Map(), [])).toEqual([{ name: 'Main Plot', color: { kind: 'slot', slot: 0 } }]);
    });
});

describe('Which new subplots keep their chosen color as their own', () => {
    const scene = (...subplots: string[]) => ({ kind: 'scene', subplots });
    const hexOf = (color: SubplotColor) => color.kind === 'own' ? color.color : `#00000${color.slot + 1}`;
    it('lets a new subplot wear its slot when ring order gives it exactly the palette color chosen', () => {
        // Main Plot holds slot 1, Mara slot 2; Tom joins last, on slot 3.
        const own = ownColorsForNewSubplots([scene('Main Plot'), scene('Mara'), scene('Mara')], ['Tom'], new Map(), new Map([['Tom', '#000003']]), hexOf);
        expect(own.size).toBe(0);
    });
    it('keeps the chosen color as its own when ring order would give it another slot', () => {
        expect([...ownColorsForNewSubplots([scene('Main Plot'), scene('Mara')], ['Tom'], new Map(), new Map([['Tom', '#000007']]), hexOf)]).toEqual([['Tom', '#000007']]);
    });
    it('keeps it as its own when taking the slot would move another ring’s color', () => {
        // Three Tom scenes put Tom ahead of Mara: on slot 2 it would push Mara from slot 2 to slot 3.
        expect([...ownColorsForNewSubplots([scene('Main Plot'), scene('Mara')], ['Tom', 'Tom', 'Tom'], new Map(), new Map([['Tom', '#000002']]), hexOf)]).toEqual([['Tom', '#000002']]);
    });
});

describe('Canvas book cards', () => {
    const books = [{ id: 'book-1', sourceFolder: 'Books/Pride' }] as BookProfile[];
    it('makes a card for a note inside a book', () => {
        expect(bookCardFor(books, { type: 'file', file: 'Books/Pride/1 Netherfield.md' })).toEqual({ path: 'Books/Pride/1 Netherfield.md', bookId: 'book-1' });
    });
    it('leaves a note outside every book to Obsidian', () => {
        expect(bookCardFor(books, { type: 'file', file: 'Recipes/Soup.md' })).toBeNull();
        expect(bookCardFor(books, { type: 'file', file: 'Books/Pride Notes/Soup.md' })).toBeNull();
        expect(bookCardFor([], { type: 'file', file: 'Books/Pride/1 Netherfield.md' })).toBeNull();
    });
    it('leaves text cards, groups, headings and other files to Obsidian', () => {
        expect(bookCardFor(books, { type: 'text' })).toBeNull();
        expect(bookCardFor(books, { type: 'group' })).toBeNull();
        expect(bookCardFor(books, { type: 'file', file: 'Books/Pride/1 Netherfield.md', subpath: '#Opening' })).toBeNull();
        expect(bookCardFor(books, { type: 'file', file: 'Books/Pride/map.png' })).toBeNull();
        expect(bookCardFor(books, undefined)).toBeNull();
    });
});
