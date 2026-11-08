import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import {
    forgetPendingSubplots,
    normalizeCanvasPendingSubplots,
    pendingSubplotsOn,
    rebasePendingSubplotCanvases,
    rememberPendingSubplot,
    savePendingSubplots,
} from './canvasPendingSubplots';

const letters = { bookId: 'book', name: 'Letters', color: '#abcdef' };
const storm = { bookId: 'book', name: 'Storm', color: '#123456' };
const record = (canvases: Record<string, Array<{ bookId: string; name: string; color: string }>>) => ({ schemaVersion: 1 as const, canvases });

describe('New subplots remembered on a Canvas, as stored', () => {
    it('keeps a version 1 record, cleaning entries and dropping malformed ones', () => {
        expect(normalizeCanvasPendingSubplots({ schemaVersion: 1, canvases: {
            'Ideas.canvas': [
                { bookId: 'book', name: ' Letters ', color: '#ABCDEF' },
                { bookId: 'book', name: 'letters', color: '#000001' },
                { bookId: 'book', name: 'Echo', color: '#abcdef' },
                { bookId: 'other', name: 'Letters', color: '#abcdef' },
                { bookId: '', name: 'No book', color: '#000002' },
                { bookId: 'book', name: '  ', color: '#000003' },
                { bookId: 'book', name: 'Red', color: 'red' },
                'junk',
            ],
            'Empty.canvas': [{ bookId: 'book', name: 'Red', color: 'red' }],
            '': [letters],
        } })).toEqual(record({
            'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#abcdef' }, { bookId: 'other', name: 'Letters', color: '#abcdef' }],
        }));
        expect(normalizeCanvasPendingSubplots({ schemaVersion: 1, canvases: {} })).toBeUndefined();
        expect(normalizeCanvasPendingSubplots({ canvases: { 'Ideas.canvas': [letters] } })).toBeUndefined();
        expect(normalizeCanvasPendingSubplots(undefined)).toBeUndefined();
    });

    it('keeps a record from a newer Radial Timeline exactly as found, reads it as empty, and refuses to write it', () => {
        const newer = { schemaVersion: 2, canvases: { 'Ideas.canvas': { Letters: { hex: '#abcdef', book: 'book' } } } };
        expect(normalizeCanvasPendingSubplots(newer)).toBe(newer);
        expect(pendingSubplotsOn(newer, 'Ideas.canvas', 'book')).toEqual([]);
        expect(rebasePendingSubplotCanvases(newer, 'Ideas.canvas', 'Moved.canvas')).toBe(newer);
        expect(() => rememberPendingSubplot(newer, 'Ideas.canvas', letters, () => true)).toThrow(/newer version/);
        expect(() => forgetPendingSubplots(newer, 'Ideas.canvas', 'book', ['Letters'], () => true)).toThrow(/newer version/);
    });

    it('reads one book’s new subplots on one Canvas', () => {
        const stored = record({ 'Ideas.canvas': [letters, { ...storm, bookId: 'other' }], 'Other.canvas': [storm] });
        expect(pendingSubplotsOn(stored, 'Ideas.canvas', 'book')).toEqual([letters]);
        expect(pendingSubplotsOn(stored, 'Missing.canvas', 'book')).toEqual([]);
        expect(pendingSubplotsOn(undefined, 'Ideas.canvas', 'book')).toEqual([]);
    });
});

describe('Remembering and forgetting new subplots', () => {
    it('adds a new subplot, replacing one with its name or its color, and drops those no card wears now', () => {
        const stored = record({ 'Ideas.canvas': [letters, storm, { bookId: 'book', name: 'Gone', color: '#000009' }, { bookId: 'other', name: 'Kept', color: '#000009' }] });
        const waiting = (entry: { color: string }) => entry.color !== '#000009';
        expect(rememberPendingSubplot(stored, 'Ideas.canvas', { bookId: 'book', name: 'letters', color: '#FEDCBA' }, waiting)).toEqual(record({
            'Ideas.canvas': [storm, { bookId: 'other', name: 'Kept', color: '#000009' }, { bookId: 'book', name: 'letters', color: '#fedcba' }],
        }));
        expect(rememberPendingSubplot(stored, 'Ideas.canvas', { bookId: 'book', name: 'Rain', color: '#123456' }, () => true).canvases['Ideas.canvas'].map(entry => entry.name))
            .toEqual(['Letters', 'Gone', 'Kept', 'Rain']);
        expect(rememberPendingSubplot(undefined, 'New.canvas', letters, () => true)).toEqual(record({ 'New.canvas': [letters] }));
        expect(() => rememberPendingSubplot(undefined, 'New.canvas', { ...letters, color: 'red' }, () => true)).toThrow();
    });

    it('forgets a book’s new subplots once their scenes exist, and drops an empty Canvas and record', () => {
        const stored = record({ 'Ideas.canvas': [letters, storm, { ...letters, bookId: 'other' }] });
        expect(forgetPendingSubplots(stored, 'Ideas.canvas', 'book', ['LETTERS'], () => true)).toEqual(record({ 'Ideas.canvas': [storm, { ...letters, bookId: 'other' }] }));
        expect(forgetPendingSubplots(record({ 'Ideas.canvas': [letters] }), 'Ideas.canvas', 'book', ['Letters'], () => true)).toBeUndefined();
        expect(forgetPendingSubplots(stored, 'Other.canvas', 'book', ['Letters'], () => true)).toEqual(stored);
    });

    it('follows a renamed Canvas or folder, never overwriting a Canvas already at the new path', () => {
        const stored = record({ 'Maps/Ideas.canvas': [letters], 'Maps/Plot.canvas': [storm], 'Other.canvas': [storm] });
        expect(rebasePendingSubplotCanvases(stored, 'Maps/Ideas.canvas', 'Maps/Book one.canvas')).toEqual(record({ 'Maps/Book one.canvas': [letters], 'Maps/Plot.canvas': [storm], 'Other.canvas': [storm] }));
        expect(rebasePendingSubplotCanvases(stored, 'Maps', 'Canvases')).toEqual(record({ 'Canvases/Ideas.canvas': [letters], 'Canvases/Plot.canvas': [storm], 'Other.canvas': [storm] }));
        expect(rebasePendingSubplotCanvases(stored, 'Maps/Ideas.canvas', 'Other.canvas')).toEqual(stored);
    });

    it('puts the record back when settings cannot be saved', async () => {
        const plugin = { settings: { canvasPendingSubplots: record({ 'Ideas.canvas': [letters] }) }, saveSettings: vi.fn(async () => { throw new Error('Disk full'); }) } as unknown as RadialTimelinePlugin;
        await expect(savePendingSubplots(plugin, undefined)).rejects.toThrow('Disk full');
        expect(plugin.settings.canvasPendingSubplots).toEqual(record({ 'Ideas.canvas': [letters] }));
    });
});
