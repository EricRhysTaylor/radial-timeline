import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { BONUS_VAULTS } from '../settings/bonusVaults';
import type { BookProfile } from '../types/settings';
import { bookNarrationMode, markNarrationChosen, migrateVaultNarrationDefault, normalizeBookProfile } from './books';
import { isNarrationValue, resolveScenePov } from './pov';
import { registerSampleBookProfiles } from './sampleVault';
import { buildTimelineSharePayload } from '../communityShare/timelineSharePayload';
import { buildTimelineDataExport } from '../services/export/TimelineExportService';

const book = (id: string, extra: Partial<BookProfile> = {}): BookProfile => ({ id, title: id, sourceFolder: id, ...extra });

describe('vault narration default → each book', () => {
    type MigrationSettings = Parameters<typeof migrateVaultNarrationDefault>[0];
    const vault = (books: BookProfile[], globalPovMode?: unknown): MigrationSettings =>
        ({ books, ...(globalPovMode === undefined ? {} : { globalPovMode }) });

    it('gives every book without its own default the vault value once, stamped, and keeps the vault value', () => {
        const settings = vault([book('one'), book('two', { narrationMode: 'first' })], 'third');
        expect(migrateVaultNarrationDefault(settings)).toBe(true);
        expect(settings.books.map(entry => entry.narrationMode)).toEqual(['third', 'first']);
        expect(settings.narrationDefaultsMigration).toEqual({ schemaVersion: 1, inheritedBookIds: ['one'] });
        // A 7.x device still reads the vault value through 8.0.
        expect(settings.globalPovMode).toBe('third');
        // Run again: the stamp says it is done.
        expect(migrateVaultNarrationDefault(settings)).toBe(false);
    });

    it('gives an inherited book its narration again after a 7.x device dropped it', () => {
        const settings = vault([book('one'), book('two')], 'third');
        migrateVaultNarrationDefault(settings);
        // 7.7 normalizes book profiles without the field it does not know, and saves.
        settings.books = settings.books.map(({ narrationMode: _dropped, ...rest }) => rest);
        expect(migrateVaultNarrationDefault(settings)).toBe(true);
        expect(settings.books.map(entry => entry.narrationMode)).toEqual(['third', 'third']);
    });

    it('leaves a narration the writer set since, including "not set", alone', () => {
        const settings = vault([book('one'), book('two')], 'third');
        migrateVaultNarrationDefault(settings);
        markNarrationChosen(settings, 'two');
        delete settings.books[1].narrationMode;
        expect(migrateVaultNarrationDefault(settings)).toBe(false);
        expect(settings.books[1].narrationMode).toBeUndefined();
        expect(settings.narrationDefaultsMigration).toEqual({ schemaVersion: 1, inheritedBookIds: ['one'] });
    });

    it('waits, unstamped, with no books or an unknown vault value, so a later book inherits', () => {
        const empty = vault([], 'third');
        expect(migrateVaultNarrationDefault(empty)).toBe(false);
        expect(empty.narrationDefaultsMigration).toBeUndefined();
        empty.books.push(book('later'));
        expect(migrateVaultNarrationDefault(empty)).toBe(true);
        expect(empty.books[0].narrationMode).toBe('third');

        const unknown = vault([book('one')], 'sideways');
        expect(migrateVaultNarrationDefault(unknown)).toBe(false);
        expect(unknown.narrationDefaultsMigration).toBeUndefined();
        expect(unknown.globalPovMode).toBe('sideways');
    });

    it('treats "off" or no vault value as not set, and keeps a record from a newer build', () => {
        const off = vault([book('one')], 'off');
        expect(migrateVaultNarrationDefault(off)).toBe(true);
        expect(off.books[0].narrationMode).toBeUndefined();
        expect(off.narrationDefaultsMigration).toEqual({ schemaVersion: 1, inheritedBookIds: [] });

        const newer = { ...vault([book('one')], 'third'), narrationDefaultsMigration: { schemaVersion: 2, future: true } };
        expect(migrateVaultNarrationDefault(newer)).toBe(false);
        expect(newer.books[0].narrationMode).toBeUndefined();
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

    it('tells narration values from names: every word must be a narration word', () => {
        for (const value of ['first', '3rd', 'third limited', 'Third person limited', 'close third', 'first-person', 'Omniscient', 'two', 'all', '2']) {
            expect(isNarrationValue(value)).toBe(true);
        }
        for (const value of ['Dr. Watson', '[[Elizabeth Bennet]]', '', 'zero', 'Third Officer Ames', 'first (Watson)', 'present tense', 'constructor', '李']) {
            expect(isNarrationValue(value)).toBe(false);
        }
    });

    it('marks the timeline the same way: a name that starts like a mode is ignored', () => {
        const scene = (pov: string) => resolveScenePov({ Character: ['Ames', 'Holmes'], pov }, { narrationMode: 'omni' });
        // The book's omniscient narration applies, not "third".
        expect(scene('Third Officer Ames')).toEqual({ syntheticEntries: [{ text: 'Omni', label: '3' }], characterMarkers: [] });
        expect(scene('close third').characterMarkers).toEqual([{ index: 0, label: '3' }]);
        expect(scene('third person limited').characterMarkers).toEqual([{ index: 0, label: '3' }]);
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

describe('manual timeline export', () => {
    const exported = (pov: string) => buildTimelineDataExport({
        items: [{ path: 'a.md', title: 'A', date: '', subplot: 'Main Plot', itemType: 'Scene', pov }],
        bookMeta: null,
        settings: { ...DEFAULT_SETTINGS, books: [book('one', { narrationMode: 'third' })], activeBookId: 'one' },
        pluginVersion: '0.0.0',
        exportId: 'id',
        now: new Date('2026-11-07T00:00:00Z'),
    });

    it('sends pov only for a narration value, which the website reads as the narration mode', () => {
        expect(exported('omni').items[0].pov).toBe('omni');
        expect(exported('Dr. Watson').items[0]).not.toHaveProperty('pov');
    });

    it('carries each book’s narration in the book profiles', () => {
        expect(exported('omni').renderConfig.books[0].narrationMode).toBe('third');
        expect(exported('omni').renderConfig).not.toHaveProperty('globalPovMode');
    });
});
