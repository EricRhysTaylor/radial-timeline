import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import { normalizeBookProfile } from './books';
import {
    clearOwnSubplotColor,
    normalizeOwnSubplotColor,
    normalizeOwnSubplotColorsRecord,
    ownSubplotColorEntries,
    ownSubplotColorsWritable,
    renameOwnSubplotColor,
    setOwnSubplotColor,
} from './ownSubplotColors';

const book = (colors?: Record<string, string>): BookProfile => ({
    id: 'book', title: 'Book', sourceFolder: 'Book',
    ...(colors ? { ownSubplotColors: { schemaVersion: 1 as const, colors } } : {}),
});

describe('own subplot colors as stored', () => {
    it('stores hex colors as lower-case #rrggbb', () => {
        expect(normalizeOwnSubplotColor(' #E93147 ')).toBe('#e93147');
        expect(normalizeOwnSubplotColor('#a0f')).toBe('#aa00ff');
        expect(normalizeOwnSubplotColor('red')).toBeNull();
        expect(normalizeOwnSubplotColor('var(--canvas-color-1)')).toBeNull();
        expect(normalizeOwnSubplotColor(7)).toBeNull();
    });

    it('keeps a version 1 record, dropping blank names, non-colors and malformed records', () => {
        expect(normalizeOwnSubplotColorsRecord({ schemaVersion: 1, colors: { ' Romance ': '#E93147', '': '#000000', Family: 'blue' } }))
            .toEqual({ schemaVersion: 1, colors: { Romance: '#e93147' } });
        expect(normalizeOwnSubplotColorsRecord({ schemaVersion: 1, colors: {} })).toBeUndefined();
        expect(normalizeOwnSubplotColorsRecord({ schemaVersion: 0, colors: { Romance: '#e93147' } })).toBeUndefined();
        expect(normalizeOwnSubplotColorsRecord({ colors: { Romance: '#e93147' } })).toBeUndefined();
        expect(normalizeOwnSubplotColorsRecord(undefined)).toBeUndefined();
    });

    it('keeps a record from a newer Radial Timeline exactly as found, and never reads or rewrites it', () => {
        const newer = { schemaVersion: 2, palette: { Romance: { hex: '#E93147', theme: 'dark' } } };
        expect(normalizeOwnSubplotColorsRecord(newer)).toBe(newer);
        const loaded = normalizeBookProfile({ ...book(), ownSubplotColors: newer });
        expect(loaded.ownSubplotColors).toEqual(newer);
        expect(ownSubplotColorEntries(loaded)).toEqual([]);
        expect(ownSubplotColorsWritable(loaded)).toBe(false);
        expect(() => setOwnSubplotColor(loaded, 'Romance', '#00ff00')).toThrow(/newer version/);
        clearOwnSubplotColor(loaded, 'Romance');
        renameOwnSubplotColor(loaded, 'Romance', 'Love', { mergesInto: false, oldNameRemains: false });
        expect(loaded.ownSubplotColors).toEqual(newer);
    });

    it('survives the book profile normalization that runs on every settings load', () => {
        const loaded = normalizeBookProfile({ ...book(), ownSubplotColors: { schemaVersion: 1, colors: { Romance: '#E93147' } } });
        expect(loaded.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: '#e93147' } });
        expect('ownSubplotColors' in normalizeBookProfile(book())).toBe(false);
    });
});

describe('changing own subplot colors on a book', () => {
    it('sets, replaces and clears a color, dropping the record when the last one goes', () => {
        const target = book();
        setOwnSubplotColor(target, 'Romance', '#E93147');
        expect(target.ownSubplotColors).toEqual({ schemaVersion: 1, colors: { Romance: '#e93147' } });
        setOwnSubplotColor(target, 'Romance', '#00ff00');
        expect(target.ownSubplotColors?.colors.Romance).toBe('#00ff00');
        clearOwnSubplotColor(target, 'Romance');
        expect(target.ownSubplotColors).toBeUndefined();
    });

    it('refuses a color that is not hex rather than storing a stand-in', () => {
        expect(() => setOwnSubplotColor(book(), 'Romance', 'var(--canvas-color-1)')).toThrow();
        expect(() => setOwnSubplotColor(book(), ' ', '#e93147')).toThrow();
    });

    const renamed = { mergesInto: false, oldNameRemains: false };
    const colors = (target: BookProfile) => Object.fromEntries(ownSubplotColorEntries(target));

    it('carries a color through a rename to a new name', () => {
        const target = book({ Romance: '#e93147', Letters: '#00ff00' });
        renameOwnSubplotColor(target, 'Romance', 'Love', renamed);
        expect(colors(target)).toEqual({ Letters: '#00ff00', Love: '#e93147' });
    });

    it('keeps the merged subplot’s own color, never the renamed one’s', () => {
        const target = book({ Love: '#e93147', Letters: '#00ff00' });
        renameOwnSubplotColor(target, 'Love', 'Letters', { mergesInto: true, oldNameRemains: false });
        expect(colors(target)).toEqual({ Letters: '#00ff00' });
    });

    it('leaves a merged subplot on its palette slot rather than giving it the renamed one’s color', () => {
        const target = book({ Love: '#e93147' });
        renameOwnSubplotColor(target, 'Love', 'Family', { mergesInto: true, oldNameRemains: false });
        expect(target.ownSubplotColors).toBeUndefined();
    });

    it('copies the color when some scenes keep the old name, so both subplots keep it', () => {
        const target = book({ Romance: '#e93147' });
        renameOwnSubplotColor(target, 'Romance', 'Love', { mergesInto: false, oldNameRemains: true });
        expect(colors(target)).toEqual({ Romance: '#e93147', Love: '#e93147' });
        const merged = book({ Romance: '#e93147' });
        renameOwnSubplotColor(merged, 'Romance', 'Family', { mergesInto: true, oldNameRemains: true });
        expect(colors(merged)).toEqual({ Romance: '#e93147' });
    });
});
