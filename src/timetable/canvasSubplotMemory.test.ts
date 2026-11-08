import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { CanvasSubplotChoice } from '../types/settings';
import {
    canvasChoicesNow,
    dropCanvasSubplotMemory,
    forgetBookSubplotMemory,
    forgetCards,
    keepCanvases,
    markSubplotsMade,
    normalizeCanvasSubplotMemory,
    rebaseCanvasSubplotMemory,
    rememberCardSubplot,
    rememberedCanvases,
    renameCanvasSubplotChoices,
    reviseCanvasChoices,
    saveCanvasSubplotMemory,
    subplotOfCard,
    waitingSubplots,
} from './canvasSubplotMemory';

const record = (canvases: Record<string, CanvasSubplotChoice[]>) => ({ schemaVersion: 1 as const, canvases });
const books = new Set(['book', 'other']);
/** Letters was named with New subplot…; Romance is a subplot the book has. */
const letters = (cards: string[], color = '#abcdef'): CanvasSubplotChoice => ({ bookId: 'book', subplot: 'Letters', color, cards, created: true });
const romance = (cards: string[], color = '#000003'): CanvasSubplotChoice => ({ bookId: 'book', subplot: 'Romance', color, cards });

describe('The subplots the card menu gave Canvas cards, as stored', () => {
    it('keeps valid choices, gives a card claimed twice to the later choice, and drops choices of removed books', () => {
        expect(normalizeCanvasSubplotMemory({ schemaVersion: 1, canvases: {
            'Ideas.canvas': [
                { bookId: 'book', subplot: ' Romance ', color: '#000003', cards: ['a', 'b', 'a', '', 7], created: 'yes' },
                { bookId: 'book', subplot: 'Letters', color: '#ABCDEF', cards: ['b'], created: true },
                { bookId: 'gone', subplot: 'Storm', color: '#123456', cards: ['c'] },
                { bookId: 'book', subplot: 'Empty', color: '#123456', cards: [] },
                { bookId: 'book', subplot: 'Red', color: 'red', cards: ['d'] },
                'junk',
            ],
            'Removed book.canvas': [{ bookId: 'gone', subplot: 'Storm', color: '#123456', cards: ['c'] }],
        } }, undefined, books)).toEqual({ record: record({ 'Ideas.canvas': [romance(['a']), letters(['b'])] }), legacyMerged: true });
        expect(normalizeCanvasSubplotMemory({ schemaVersion: 1, canvases: {} }, undefined, books).record).toBeUndefined();
        expect(normalizeCanvasSubplotMemory(undefined, undefined, books).record).toBeUndefined();
    });

    it('carries the first record’s new subplots in as New subplot… choices, standing for the cards on their Canvas that wear their color', () => {
        const first = { schemaVersion: 1, canvases: { 'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#ABCDEF' }, { bookId: 'gone', name: 'Storm', color: '#123456' }] } };
        const { record: memory, legacyMerged } = normalizeCanvasSubplotMemory(undefined, first, books);
        expect(legacyMerged).toBe(true);
        expect(memory).toEqual(record({ 'Ideas.canvas': [{ bookId: 'book', subplot: 'Letters', color: '#abcdef', created: true }] }));
        // Read against the Canvas, it holds the cards wearing its color.
        expect(canvasChoicesNow(memory, 'Ideas.canvas', [{ id: 'a', hex: '#abcdef' }, { id: 'b', hex: '#000001' }, { id: 'c', hex: '#abcdef' }]))
            .toEqual([letters(['a', 'c'])]);
        // A name the current record already gives a card on that Canvas is not carried twice.
        expect(normalizeCanvasSubplotMemory(record({ 'Ideas.canvas': [letters(['a'], '#000009')] }), first, books).record).toEqual(record({ 'Ideas.canvas': [letters(['a'], '#000009')] }));
    });

    it('keeps a record from a newer Radial Timeline exactly as found, leaves the first record for it, reads it as empty, and refuses to write it', () => {
        const newer = { schemaVersion: 2, cards: { 'Ideas.canvas#a': { subplot: 'Letters' } } };
        const first = { schemaVersion: 1, canvases: { 'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#abcdef' }] } };
        expect(normalizeCanvasSubplotMemory(newer, first, books)).toEqual({ record: newer, legacyMerged: false });
        expect(canvasChoicesNow(newer, 'Ideas.canvas', [{ id: 'a', hex: '#abcdef' }])).toEqual([]);
        expect(rememberedCanvases(newer)).toEqual([]);
        expect(rebaseCanvasSubplotMemory(newer, 'Ideas.canvas', 'Moved.canvas')).toBe(newer);
        expect(dropCanvasSubplotMemory(newer, 'Ideas.canvas')).toBe(newer);
        expect(forgetBookSubplotMemory(newer, 'book')).toBe(newer);
        expect(reviseCanvasChoices(newer, 'Ideas.canvas', [], true)).toBe(newer);
        expect(() => rememberCardSubplot(newer, 'Ideas.canvas', [], { bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['a'], created: true, at: 7 })).toThrow(/newer version/);
    });
});

describe('Reading the choices on a Canvas', () => {
    it('gives the subplot to the cards still there that wear its color, rests the recolored ones, and drops the deleted', () => {
        const memory = record({ 'Ideas.canvas': [romance(['a', 'b', 'c']), letters(['d'])] });
        // b was recolored (an undo, or by hand); c was deleted.
        const now = canvasChoicesNow(memory, 'Ideas.canvas', [{ id: 'a', hex: '#000003' }, { id: 'b', hex: '#ff0000' }, { id: 'd', hex: '#abcdef' }]);
        expect(now).toEqual([{ ...romance(['a']), dormant: ['b'] }, letters(['d'])]);
        expect(subplotOfCard(now, 'a', 'book')).toBe('Romance');
        expect(subplotOfCard(now, 'b', 'book')).toBeNull();
        expect(subplotOfCard(now, 'a', 'other')).toBeNull();
        expect(canvasChoicesNow(memory, 'Other.canvas', [{ id: 'a', hex: '#000003' }])).toEqual([]);
    });

    it('brings a subplot back when an undone color is redone', () => {
        const memory = record({ 'Ideas.canvas': [letters(['a', 'b'])] });
        // Undo: both cards go back to no color. The choice rests; nothing wears Letters.
        const undone = reviseCanvasChoices(memory, 'Ideas.canvas', [{ id: 'a', hex: null }, { id: 'b', hex: null }], false);
        expect(undone).toEqual(record({ 'Ideas.canvas': [{ ...letters([]), dormant: ['a', 'b'] }] }));
        expect(waitingSubplots(undone, 'book', () => false, { canvasPath: 'Other.canvas', choices: [] })).toEqual([]);
        // Redo: the color is back, and so is the subplot.
        const redone = canvasChoicesNow(undone, 'Ideas.canvas', [{ id: 'a', hex: '#abcdef' }, { id: 'b', hex: '#abcdef' }]);
        expect(redone).toEqual([letters(['a', 'b'])]);
        expect(subplotOfCard(redone, 'b', 'book')).toBe('Letters');
        // Opening the Canvas later, with the cards still uncolored, lets the choice go.
        expect(reviseCanvasChoices(undone, 'Ideas.canvas', [{ id: 'a', hex: null }, { id: 'b', hex: null }], true)).toBeUndefined();
    });

    it('gives a copied card, new id and same color, the one choice of that color on the Canvas', () => {
        const memory = record({ 'Ideas.canvas': [romance(['a']), letters(['d'])] });
        expect(canvasChoicesNow(memory, 'Ideas.canvas', [{ id: 'a', hex: '#000003' }, { id: 'a copy', hex: '#000003' }, { id: 'd', hex: '#abcdef' }]))
            .toEqual([romance(['a', 'a copy']), letters(['d'])]);
        // Two choices share the color (ring order moved it): a copy matches neither.
        const shared = record({ 'Ideas.canvas': [romance(['a']), { bookId: 'book', subplot: 'Family', color: '#000003', cards: ['f'] }] });
        expect(canvasChoicesNow(shared, 'Ideas.canvas', [{ id: 'a', hex: '#000003' }, { id: 'f', hex: '#000003' }, { id: 'copy', hex: '#000003' }]))
            .toEqual([romance(['a']), { bookId: 'book', subplot: 'Family', color: '#000003', cards: ['f'] }]);
    });

    it('stores a Canvas’s choices as its cards stand, and leaves the record alone when nothing changed', () => {
        const memory = record({ 'Ideas.canvas': [letters(['a'])], 'Other.canvas': [romance(['b'])] });
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', [{ id: 'a', hex: '#abcdef' }], false)).toBe(memory);
        // Its card was deleted, or became a sketch: Letters waits no longer.
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', [], false)).toEqual(record({ 'Other.canvas': [romance(['b'])] }));
        // Recolored, it rests until the Canvas opens again.
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', [{ id: 'a', hex: '#000009' }], true)).toEqual(record({ 'Other.canvas': [romance(['b'])] }));
        expect(reviseCanvasChoices(memory, 'Unknown.canvas', [], true)).toBe(memory);
    });

    it('leaves a Canvas as stored when its file was saved before the latest choice there, so a fresh choice survives a stale read', () => {
        // The menu gave b Romance at 1000 and a new card c the New subplot Letters at 2000;
        // the Canvas file read back was saved at 1500, before the save that carries c.
        const memory = record({ 'Ideas.canvas': [{ ...romance(['b']), at: 1000 }, { ...letters(['c']), at: 2000 }] });
        const stale = [{ id: 'b', hex: null }];
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', stale, true, 1500)).toBe(memory);
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', stale, false, 1500)).toBe(memory);
        // A file saved after the latest choice speaks for every card on it.
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', [{ id: 'c', hex: '#abcdef' }], true, 2500))
            .toEqual(record({ 'Ideas.canvas': [{ ...letters(['c']), at: 2000 }] }));
        // So does the open Canvas, read live.
        expect(reviseCanvasChoices(memory, 'Ideas.canvas', [{ id: 'c', hex: '#abcdef' }], true))
            .toEqual(record({ 'Ideas.canvas': [{ ...letters(['c']), at: 2000 }] }));
    });
});

describe('A book’s new subplots across its Canvases', () => {
    const exists = (name: string) => ['main plot', 'mara', 'love'].includes(name.toLowerCase());
    it('offers a subplot named with New subplot… on one Canvas on every Canvas of the book', () => {
        const memory = record({
            'X.canvas': [letters(['x1'], '#000005')],
            'Y.canvas': [{ bookId: 'book', subplot: 'Mara', color: '#000002', cards: ['y1'] }],
            'Z.canvas': [{ bookId: 'other', subplot: 'Dreams', color: '#000006', cards: ['z1'], created: true }],
        });
        expect(waitingSubplots(memory, 'book', exists, { canvasPath: 'Y.canvas', choices: [] })).toEqual([{ name: 'Letters', color: '#000005' }]);
    });
    it('never offers a renamed or removed subplot as new: only New subplot… choices name new subplots', () => {
        // Romance was renamed Love in the scenes; the cards given Romance name no new subplot.
        const memory = record({ 'X.canvas': [romance(['x1'])], 'Y.canvas': [{ bookId: 'book', subplot: 'Main Plot', color: '#000001', cards: ['y1'] }] });
        expect(waitingSubplots(memory, 'book', name => name === 'Love', { canvasPath: 'Y.canvas', choices: [] })).toEqual([]);
    });
    it('reads the open Canvas as it stands now, and names each new subplot once', () => {
        const memory = record({ 'X.canvas': [letters(['x1'])], 'Y.canvas': [letters(['y1']), { ...romance(['y2'], '#000009'), created: true, subplot: 'Storm' }] });
        // On Y, the Storm card was recolored by hand, so Y offers only what its cards still say.
        expect(waitingSubplots(memory, 'book', exists, { canvasPath: 'Y.canvas', choices: [letters(['y1'])] })).toEqual([{ name: 'Letters', color: '#abcdef' }]);
        expect(waitingSubplots(memory, 'book', name => name === 'Letters' || exists(name), { canvasPath: 'Y.canvas', choices: [letters(['y1'])] })).toEqual([]);
    });
    it('stops counting a new subplot as new on every Canvas once it has scenes, so a later rename never brings it back', () => {
        const memory = record({ 'X.canvas': [letters(['x1'])], 'Y.canvas': [letters(['y1']), romance(['y2'])] });
        const made = markSubplotsMade(memory, 'book', ['letters']);
        expect(made).toEqual(record({
            'X.canvas': [{ bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['x1'] }],
            'Y.canvas': [{ bookId: 'book', subplot: 'Letters', color: '#abcdef', cards: ['y1'] }, romance(['y2'])],
        }));
        expect(waitingSubplots(made, 'book', () => false, { canvasPath: 'X.canvas', choices: [] })).toEqual([]);
        expect(markSubplotsMade(memory, 'book', ['Romance'])).toBe(memory);
    });
});

describe('Remembering and forgetting cards', () => {
    it('gives cards a subplot, taking them from any other choice, and joins a choice of the same subplot and color', () => {
        const open = [romance(['a', 'b']), letters(['c'])];
        expect(rememberCardSubplot(record({ 'Ideas.canvas': open }), 'Ideas.canvas', open, { bookId: 'book', subplot: 'letters', color: '#ABCDEF', cards: ['a'], created: false, at: 7 }))
            .toEqual(record({ 'Ideas.canvas': [romance(['b']), { ...letters(['c', 'a']), at: 7 }] }));
        expect(rememberCardSubplot(undefined, 'New.canvas', [], { bookId: 'book', subplot: 'Storm', color: '#123456', cards: ['z'], created: true, at: 7 }))
            .toEqual(record({ 'New.canvas': [{ bookId: 'book', subplot: 'Storm', color: '#123456', cards: ['z'], created: true, at: 7 }] }));
        expect(rememberCardSubplot(undefined, 'New.canvas', [], { bookId: 'book', subplot: 'Mara', color: '#000002', cards: ['z'], created: false, at: 7 }))
            .toEqual(record({ 'New.canvas': [{ bookId: 'book', subplot: 'Mara', color: '#000002', cards: ['z'], at: 7 }] }));
        expect(() => rememberCardSubplot(undefined, 'New.canvas', [], { bookId: 'book', subplot: 'Storm', color: 'red', cards: ['z'], created: true, at: 7 })).toThrow();
    });
    it('gives a resting card a new subplot, taking it from the choice it rested in', () => {
        const open = [{ ...letters(['a']), dormant: ['b'] }];
        expect(rememberCardSubplot(record({ 'Ideas.canvas': open }), 'Ideas.canvas', open, { bookId: 'book', subplot: 'Romance', color: '#000003', cards: ['b'], created: false, at: 7 }))
            .toEqual(record({ 'Ideas.canvas': [letters(['a']), { ...romance(['b']), at: 7 }] }));
    });
    it('keeps a choice’s time through a load, and drops a time that is not one', () => {
        const stored = { schemaVersion: 1, canvases: { 'Ideas.canvas': [{ ...letters(['a']), at: 2000 }, { ...romance(['b']), at: 'soon' }] } };
        expect(normalizeCanvasSubplotMemory(stored, undefined, books).record).toEqual(record({ 'Ideas.canvas': [{ ...letters(['a']), at: 2000 }, romance(['b'])] }));
    });
    it('renames the cards’ subplot on every Canvas when the Subplot manager renames it', () => {
        const memory = record({ 'X.canvas': [romance(['x1'])], 'Y.canvas': [romance(['y1']), letters(['y2'])], 'Z.canvas': [{ ...romance(['z1']), bookId: 'other' }] });
        expect(renameCanvasSubplotChoices(memory, 'book', 'Romance', 'Love')).toEqual(record({
            'X.canvas': [{ ...romance(['x1']), subplot: 'Love' }],
            'Y.canvas': [{ ...romance(['y1']), subplot: 'Love' }, letters(['y2'])],
            'Z.canvas': [{ ...romance(['z1']), bookId: 'other' }],
        }));
        expect(renameCanvasSubplotChoices(memory, 'book', 'Storm', 'Rain')).toBe(memory);
    });
    it('forgets cards that became notes, and drops an empty Canvas and record', () => {
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
    it('drops a deleted Canvas, every Canvas under a deleted folder, and Canvases no longer in the vault', () => {
        expect(dropCanvasSubplotMemory(memory, 'Old.canvas')).toEqual(record({ 'Maps/Ideas.canvas': [letters(['a'])], 'Maps/Plot.canvas': [romance(['b'])] }));
        expect(dropCanvasSubplotMemory(memory, 'Maps')).toEqual(record({ 'Old.canvas': [romance(['stale'])] }));
        expect(dropCanvasSubplotMemory(record({ 'Old.canvas': [romance(['stale'])] }), 'Old.canvas')).toBeUndefined();
        // A file whose name starts like a folder is not inside it.
        expect(dropCanvasSubplotMemory(memory, 'Map')).toBe(memory);
        // Deleted outside Obsidian: found missing when Obsidian starts.
        expect(keepCanvases(memory, path => path !== 'Maps/Plot.canvas')).toEqual(record({ 'Maps/Ideas.canvas': [letters(['a'])], 'Old.canvas': [romance(['stale'])] }));
        expect(keepCanvases(memory, () => true)).toBe(memory);
        expect(rememberedCanvases(memory)).toEqual(['Maps/Ideas.canvas', 'Maps/Plot.canvas', 'Old.canvas']);
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
