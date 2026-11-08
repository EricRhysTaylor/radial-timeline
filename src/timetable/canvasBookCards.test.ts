import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import { bookCardFor, ringColorsWith } from './canvasBookCards';

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
