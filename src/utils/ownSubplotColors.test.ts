import { describe, expect, it } from 'vitest';
import type { BookProfile } from '../types/settings';
import { normalizeBookProfile } from './books';
import {
    clearOwnSubplotColor,
    normalizeOwnSubplotColor,
    normalizeOwnSubplotColorsRecord,
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

    it('keeps a version 1 record and drops other versions, blank names and non-colors', () => {
        expect(normalizeOwnSubplotColorsRecord({ schemaVersion: 1, colors: { ' Romance ': '#E93147', '': '#000000', Family: 'blue' } }))
            .toEqual({ schemaVersion: 1, colors: { Romance: '#e93147' } });
        expect(normalizeOwnSubplotColorsRecord({ schemaVersion: 2, colors: { Romance: '#e93147' } })).toBeUndefined();
        expect(normalizeOwnSubplotColorsRecord({ schemaVersion: 1, colors: {} })).toBeUndefined();
        expect(normalizeOwnSubplotColorsRecord(undefined)).toBeUndefined();
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

    it('carries a color through a rename, and a merge keeps the surviving subplot’s color', () => {
        const target = book({ Romance: '#e93147', Letters: '#00ff00' });
        renameOwnSubplotColor(target, 'Romance', 'Love');
        expect(target.ownSubplotColors?.colors).toEqual({ Letters: '#00ff00', Love: '#e93147' });
        renameOwnSubplotColor(target, 'Love', 'Letters');
        expect(target.ownSubplotColors?.colors).toEqual({ Letters: '#00ff00' });
    });
});
