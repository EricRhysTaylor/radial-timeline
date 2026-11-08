import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { CanvasSubplotChoice } from '../types/settings';
import {
    canvasChoicesNow,
    dropCanvasSubplotMemory,
    forgetBookSubplotMemory,
    forgetCards,
    normalizeCanvasSubplotMemory,
    rebaseCanvasSubplotMemory,
    rememberCardSubplot,
    saveCanvasSubplotMemory,
    subplotOfCard,
    waitingSubplots,
} from './canvasSubplotMemory';

const record = (canvases: Record<string, CanvasSubplotChoice[]>) => ({ schemaVersion: 1 as const, canvases });
const books = new Set(['book', 'other']);
const letters = (cards: string[], color = '#abcdef'): CanvasSubplotChoice => ({ bookId: 'book', subplot: 'Letters', color, cards });
const romance = (cards: string[], color = '#000003'): CanvasSubplotChoice => ({ bookId: 'book', subplot: 'Romance', color, cards });

describe('The subplots the card menu gave Canvas cards, as stored', () => {
    it('keeps valid choices, gives a card claimed twice to the later choice, and drops choices of removed books', () => {
        expect(normalizeCanvasSubplotMemory({ schemaVersion: 1, canvases: {
            'Ideas.canvas': [
                { bookId: 'book', subplot: ' Romance ', color: '#000003', cards: ['a', 'b', 'a', '', 7] },
                { bookId: 'book', subplot: 'Letters', color: '#ABCDEF', cards: ['b'] },
                { bookId: 'gone', subplot: 'Storm', color: '#123456', cards: ['c'] },
                { bookId: 'book', subplot: 'Empty', color: '#123456', cards: [] },
                { bookId: 'book', subplot: 'Red', color: 'red', cards: ['d'] },
                'junk',
            ],
            'Removed book.canvas': [{ bookId: 'gone', subplot: 'Storm', color: '#123456', cards: ['c'] }],
        } }, undefined, books)).toEqual(record({ 'Ideas.canvas': [romance(['a']), letters(['b'])] }));
        expect(normalizeCanvasSubplotMemory({ schemaVersion: 1, canvases: {} }, undefined, books)).toBeUndefined();
        expect(normalizeCanvasSubplotMemory(undefined, undefined, books)).toBeUndefined();
    });

    it('carries the first record’s new subplots in, standing for the cards on their Canvas that wear their color', () => {
        const first = { schemaVersion: 1, canvases: { 'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#ABCDEF' }, { bookId: 'gone', name: 'Storm', color: '#123456' }] } };
        const memory = normalizeCanvasSubplotMemory(undefined, first, books);
        expect(memory).toEqual(record({ 'Ideas.canvas': [{ bookId: 'book', subplot: 'Letters', color: '#abcdef' }] }));
        // Read against the Canvas, it holds the cards wearing its color that no other choice holds.
        expect(canvasChoicesNow(memory, 'Ideas.canvas', [{ id: 'a', hex: '#abcdef' }, { id: 'b', hex: '#000001' }, { id: 'c', hex: '#abcdef' }]))
            .toEqual([letters(['a', 'c'])]);
        // A name the current record already gives a card on that Canvas is not carried twice.
        expect(normalizeCanvasSubplotMemory(record({ 'Ideas.canvas': [letters(['a'], '#000009')] }), first, books)).toEqual(record({ 'Ideas.canvas': [letters(['a'], '#000009')] }));
    });

    it('keeps a record from a newer Radial Timeline exactly as found, reads it as empty, and refuses to write it', () => {
        const newer = { schemaVersion: 2, cards: { 'Ideas.canvas#a': { subplot: 'Letters' } } };
        expect(normalizeCanvasSubplotMemory(newer, undefined, books)).toBe(newer);
        expect(canvasChoicesNow(newer, 'Ideas.canvas', [{ id: 'a', hex: '#abcdef' }])).toEqual([]);
        expect(rebaseCanvasSubplotMemory(newer, 'Ideas.canvas', 'Moved.canvas')).toBe(newer);
        expect(dropCanvasSubplotMemory(newer, 'Ideas.canvas')).toBe(newer);
        expect(forgetBookSubplotMemory(newer, 'book')).toBe(newer);
        expect(() => rememberCardSubplot(newer, 'Ideas.canvas', [], { bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['a'] })).toThrow(/newer version/);
    });
});

describe('Reading the choices on the open Canvas', () => {
    it('keeps the cards still there that still wear the color the menu gave them', () => {
        const memory = record({ 'Ideas.canvas': [romance(['a', 'b', 'c']), letters(['d'])] });
        // b was recolored by hand; c was deleted.
        const now = canvasChoicesNow(memory, 'Ideas.canvas', [{ id: 'a', hex: '#000003' }, { id: 'b', hex: '#ff0000' }, { id: 'd', hex: '#abcdef' }]);
        expect(now).toEqual([romance(['a']), letters(['d'])]);
        expect(subplotOfCard(now, 'a', 'book')).toBe('Romance');
        expect(subplotOfCard(now, 'b', 'book')).toBeNull();
        expect(subplotOfCard(now, 'a', 'other')).toBeNull();
        expect(canvasChoicesNow(memory, 'Other.canvas', [{ id: 'a', hex: '#000003' }])).toEqual([]);
    });
});

describe('A book’s new subplots across its Canvases', () => {
    const exists = (name: string) => ['main plot', 'mara'].includes(name.toLowerCase());
    it('offers a new subplot named on one Canvas on every Canvas of the book, so no other Canvas can take its name or color', () => {
        const memory = record({
            'X.canvas': [letters(['x1'], '#000005')],
            'Y.canvas': [{ bookId: 'book', subplot: 'Mara', color: '#000002', cards: ['y1'] }],
            'Z.canvas': [{ bookId: 'other', subplot: 'Dreams', color: '#000006', cards: ['z1'] }],
        });
        expect(waitingSubplots(memory, 'book', exists, { canvasPath: 'Y.canvas', choices: [] })).toEqual([{ name: 'Letters', color: '#000005' }]);
    });
    it('reads the open Canvas as it stands now, and names each new subplot once', () => {
        const memory = record({ 'X.canvas': [letters(['x1'])], 'Y.canvas': [letters(['y1']), romance(['y2'], '#000009')] });
        // On Y, the Romance card was recolored by hand, so Y offers only what its cards still say.
        expect(waitingSubplots(memory, 'book', exists, { canvasPath: 'Y.canvas', choices: [letters(['y1'])] })).toEqual([{ name: 'Letters', color: '#abcdef' }]);
        expect(waitingSubplots(memory, 'book', name => name === 'Letters' || exists(name), { canvasPath: 'Y.canvas', choices: [letters(['y1'])] })).toEqual([]);
    });
});

describe('Remembering and forgetting cards', () => {
    it('gives cards a subplot, taking them from any other choice, and joins a choice of the same subplot and color', () => {
        const open = [romance(['a', 'b']), letters(['c'])];
        expect(rememberCardSubplot(record({ 'Ideas.canvas': open }), 'Ideas.canvas', open, { bookId: 'book', subplot: 'letters', color: '#ABCDEF', cards: ['a'] }))
            .toEqual(record({ 'Ideas.canvas': [romance(['b']), letters(['c', 'a'])] }));
        expect(rememberCardSubplot(undefined, 'New.canvas', [], { bookId: 'book', subplot: 'Storm', color: '#123456', cards: ['z'] }))
            .toEqual(record({ 'New.canvas': [{ bookId: 'book', subplot: 'Storm', color: '#123456', cards: ['z'] }] }));
        expect(() => rememberCardSubplot(undefined, 'New.canvas', [], { bookId: 'book', subplot: 'Storm', color: 'red', cards: ['z'] })).toThrow();
    });
    it('forgets cards that became scenes, and drops an empty Canvas and record', () => {
        const open = [romance(['a', 'b']), letters(['c'])];
        expect(forgetCards(record({ 'Ideas.canvas': open }), 'Ideas.canvas', open, ['a', 'c'])).toEqual(record({ 'Ideas.canvas': [romance(['b'])] }));
        expect(forgetCards(record({ 'Ideas.canvas': [letters(['c'])] }), 'Ideas.canvas', [letters(['c'])], ['c'])).toBeUndefined();
    });
});

describe('Choices follow their Canvases and books', () => {
    const memory = record({ 'Maps/Ideas.canvas': [letters(['a'])], 'Maps/Plot.canvas': [romance(['b'])], 'Old.canvas': [romance(['stale'])] });
    it('moves a renamed Canvas’s choices, which replace any left at the new path', () => {
        expect(rebaseCanvasSubplotMemory(memory, 'Maps/Ideas.canvas', 'Old.canvas')).toEqual(record({ 'Old.canvas': [letters(['a'])], 'Maps/Plot.canvas': [romance(['b'])] }));
        expect(rebaseCanvasSubplotMemory(memory, 'Maps', 'Canvases')).toEqual(record({ 'Canvases/Ideas.canvas': [letters(['a'])], 'Canvases/Plot.canvas': [romance(['b'])], 'Old.canvas': [romance(['stale'])] }));
    });
    it('drops a deleted Canvas, or every Canvas under a deleted folder', () => {
        expect(dropCanvasSubplotMemory(memory, 'Old.canvas')).toEqual(record({ 'Maps/Ideas.canvas': [letters(['a'])], 'Maps/Plot.canvas': [romance(['b'])] }));
        expect(dropCanvasSubplotMemory(memory, 'Maps')).toEqual(record({ 'Old.canvas': [romance(['stale'])] }));
        expect(dropCanvasSubplotMemory(record({ 'Old.canvas': [romance(['stale'])] }), 'Old.canvas')).toBeUndefined();
        // A file whose name starts like a folder is not inside it.
        expect(dropCanvasSubplotMemory(memory, 'Map')).toEqual(memory);
    });
    it('drops a removed book’s choices', () => {
        const mixed = record({ 'Ideas.canvas': [letters(['a']), { bookId: 'other', subplot: 'Dreams', color: '#000006', cards: ['b'] }] });
        expect(forgetBookSubplotMemory(mixed, 'book')).toEqual(record({ 'Ideas.canvas': [{ bookId: 'other', subplot: 'Dreams', color: '#000006', cards: ['b'] }] }));
        expect(forgetBookSubplotMemory(record({ 'Ideas.canvas': [letters(['a'])] }), 'book')).toBeUndefined();
    });
    it('puts the record back when settings cannot be saved', async () => {
        const plugin = { settings: { canvasSubplotMemory: record({ 'Ideas.canvas': [letters(['a'])] }) }, saveSettings: vi.fn(async () => { throw new Error('Disk full'); }) } as unknown as RadialTimelinePlugin;
        await expect(saveCanvasSubplotMemory(plugin, undefined)).rejects.toThrow('Disk full');
        expect(plugin.settings.canvasSubplotMemory).toEqual(record({ 'Ideas.canvas': [letters(['a'])] }));
    });
});
