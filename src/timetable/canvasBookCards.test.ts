import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import { bookCardFor, ringSlotsWith } from './canvasBookCards';

describe('Ring colors after new scenes join', () => {
    const scene = (...subplots: string[]) => ({ kind: 'scene', subplots });
    it('keeps Main Plot first, then orders rings by scene count', () => {
        const slots = ringSlotsWith([scene('Main Plot'), scene('Mara'), scene('Mara')], ['Tom', 'Tom', 'Tom']);
        expect([...slots]).toEqual([['Main Plot', 0], ['Tom', 1], ['Mara', 2]]);
    });
    it('leaves sketches out of the count', () => {
        expect(ringSlotsWith([{ kind: 'sketch', subplots: ['Mara'] }], ['Tom']).has('Mara')).toBe(false);
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
