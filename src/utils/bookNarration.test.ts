import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { BONUS_VAULTS } from '../settings/bonusVaults';
import type { BookProfile } from '../types/settings';
import { bookNarrationMode, migrateVaultNarrationDefault, normalizeBookProfile } from './books';
import { isNarrationValue, resolveScenePov } from './pov';
import { registerSampleBookProfiles } from './sampleVault';
import { buildTimelineSharePayload } from '../communityShare/timelineSharePayload';

const book = (id: string, extra: Partial<BookProfile> = {}): BookProfile => ({ id, title: id, sourceFolder: id, ...extra });

describe('vault narration default → each book', () => {
    it('gives every book without its own default the vault value, then removes the vault field', () => {
        const settings = {
            books: [book('one'), book('two', { narrationMode: 'first' })],
            globalPovMode: 'third',
        };
        expect(migrateVaultNarrationDefault(settings)).toBe(true);
        expect(settings.books.map(entry => entry.narrationMode)).toEqual(['third', 'first']);
        expect('globalPovMode' in settings).toBe(false);
        // Run again: nothing left to migrate.
        expect(migrateVaultNarrationDefault(settings)).toBe(false);
    });

    it('treats the old "off" value as not set and still removes the field', () => {
        const settings = { books: [book('one')], globalPovMode: 'off' };
        expect(migrateVaultNarrationDefault(settings)).toBe(true);
        expect(settings.books[0].narrationMode).toBeUndefined();
        expect('globalPovMode' in settings).toBe(false);
    });

    it('no longer ships a vault default', () => {
        expect('globalPovMode' in DEFAULT_SETTINGS).toBe(false);
    });
});

describe('book profiles', () => {
    it('keep a valid narration and store "not set" as no field at all', () => {
        expect(normalizeBookProfile(book('one', { narrationMode: 'omni' })).narrationMode).toBe('omni');
        expect('narrationMode' in normalizeBookProfile({ ...book('one'), narrationMode: 'off' } as unknown as BookProfile)).toBe(false);
        expect('narrationMode' in normalizeBookProfile({ ...book('one'), narrationMode: 'sideways' } as unknown as BookProfile)).toBe(false);
    });
});

describe('per-book resolution', () => {
    const saga = { books: [book('one', { narrationMode: 'first' }), book('two', { narrationMode: 'omni' })], activeBookId: 'one' };
    const marks = (scene: { Character: string[]; pov?: string; bookId?: string }, settings: { books: BookProfile[]; activeBookId?: string }) =>
        resolveScenePov(scene, { narrationMode: bookNarrationMode(scene, settings) });

    it('reads each saga scene by its own book, two books in two modes', () => {
        expect(marks({ Character: ['Watson'], bookId: 'one' }, saga)).toEqual({ syntheticEntries: [], characterMarkers: [{ index: 0, label: '1' }] });
        expect(marks({ Character: ['Odysseus'], bookId: 'two' }, saga)).toEqual({ syntheticEntries: [{ text: 'Omni', label: '3' }], characterMarkers: [] });
    });

    it('uses the active book on a book timeline, whose scenes carry no book id', () => {
        expect(bookNarrationMode({}, { ...saga, activeBookId: 'two' })).toBe('omni');
        expect(bookNarrationMode({}, { books: [book('solo')] })).toBeUndefined();
    });

    it('lets a scene override win over its book, and ignores a name', () => {
        expect(marks({ Character: ['Holmes'], bookId: 'one', pov: 'omni' }, saga).syntheticEntries).toEqual([{ text: 'Omni', label: '3' }]);
        expect(marks({ Character: ['Ana', 'Ben'], bookId: 'one', pov: 'two' }, saga).characterMarkers).toEqual([
            { index: 0, label: '1' }, { index: 1, label: '1' },
        ]);
        expect(marks({ Character: ['Holmes'], bookId: 'two', pov: 'Dr. Watson' }, saga).syntheticEntries).toEqual([{ text: 'Omni', label: '3' }]);
    });

    it('marks the first listed character ¹ when a book sets no narration', () => {
        expect(marks({ Character: ['Ana', 'Ben'] }, { books: [book('solo')] }).characterMarkers).toEqual([{ index: 0, label: '1' }]);
    });

    it('tells narration values from names', () => {
        for (const value of ['first', '3rd', 'third limited', 'Omniscient', 'two', 'all', '2']) expect(isNarrationValue(value)).toBe(true);
        for (const value of ['Dr. Watson', '[[Elizabeth Bennet]]', '', 'zero']) expect(isNarrationValue(value)).toBe(false);
    });
});

describe('Story Vaults', () => {
    const narrationOf = (id: string) => BONUS_VAULTS.find(vault => vault.id === id)?.books?.map(entry => entry.narrationMode);

    it('start each sample book with its narration', () => {
        expect(narrationOf('pride-and-prejudice')).toEqual(['third']);
        expect(narrationOf('sherlock-holmes')).toEqual(['first', 'first', 'first', 'first']);
        expect(narrationOf('odyssey')).toEqual(['omni']);
    });

    it('carry the narration into the book profile the import creates', () => {
        const registered = registerSampleBookProfiles([], [{ title: 'P&P', sourceFolder: 'Demo/P&P', narrationMode: 'third' }], 'Demo/P&P', () => 'pp');
        expect(registered.books[0].narrationMode).toBe('third');
    });
});

describe('Community share payload', () => {
    const share = (pov: string) => buildTimelineSharePayload({
        items: [{ path: 'a.md', title: 'A', date: '', subplot: 'Main Plot', itemType: 'Scene', pov }],
        bookMeta: null,
        book: { title: 'Book' },
        pluginVersion: '0.0.0',
        exportId: 'id',
        now: new Date('2026-11-07T00:00:00Z'),
    }).items[0];

    it('keeps the wire name pov for a narration value and never sends a character name', () => {
        expect(share('first').pov).toBe('first');
        expect(share('Dr. Watson')).not.toHaveProperty('pov');
    });
});
