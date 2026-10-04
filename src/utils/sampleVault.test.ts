import { describe, expect, it } from 'vitest';
import { readSampleVaultManifest, registerSampleBookProfiles } from './sampleVault';

const novels = [
    ['A Study in Scarlet', '01 A Study in Scarlet'],
    ['The Sign of the Four', '02 The Sign of the Four'],
    ['The Hound of the Baskervilles', '03 The Hound of the Baskervilles'],
    ['The Valley of Fear', '04 The Valley of Fear']
].map(([title, source_folder]) => ({ title, source_folder }));

const manifest = { rt_sample_vault: true, schema_version: 1, display_name: 'Sherlock Holmes', books: novels };

describe('portable sample collections', () => {
    it('registers all four novels in order and opens Scarlet on a fresh install', () => {
        const config = readSampleVaultManifest(manifest)!;
        let id = 0;
        const registered = registerSampleBookProfiles([], config.books!, config.bookFolder!, () => `book-${++id}`);
        expect(registered.books.map(book => book.title)).toEqual(novels.map(book => book.title));
        expect(registered.books.map(book => book.sourceFolder)).toEqual(novels.map(book => book.source_folder));
        expect(registered.targetId).toBe('book-1');
    });

    it('keeps author IDs, edits, saga choice and unrelated books when reopened', () => {
        const config = readSampleVaultManifest(manifest)!;
        const existing = [
            { id: 'author-book', title: 'My Novel', sourceFolder: 'My Novel' },
            { id: 'my-scarlet', title: 'My Scarlet title', sourceFolder: novels[0].source_folder, includeInSaga: false }
        ];
        let id = 0;
        const first = registerSampleBookProfiles(existing, config.books!, config.bookFolder!, () => `new-${++id}`);
        const second = registerSampleBookProfiles(first.books, config.books!, config.bookFolder!, () => { throw new Error('Duplicate registration'); });
        expect(first.targetId).toBe('my-scarlet');
        expect(first.books.slice(0, 2)).toEqual(existing);
        expect(first.books).toHaveLength(5);
        expect(second).toEqual(first);
        expect(existing).toHaveLength(2);
    });

    it('retains the existing single-book manifest contract', () => {
        expect(readSampleVaultManifest({ rt_sample_vault: true, display_name: 'Pride & Prejudice', book_folder: 'Pride & Prejudice' }))
            .toEqual({ displayName: 'Pride & Prejudice', bookFolder: 'Pride & Prejudice' });
        expect(readSampleVaultManifest({ books: novels })).toBeNull();
    });

    it.each([
        { ...manifest, schema_version: 2 },
        { ...manifest, books: [] },
        { ...manifest, books: 'not a list' },
        { ...manifest, books: [null] },
        { ...manifest, books: [{ title: 'Bad', source_folder: '../Outside' }] },
        { ...manifest, books: [{ title: 'Bad', source_folder: '/Outside' }] },
        { ...manifest, books: [{ title: 'Bad', source_folder: '.obsidian' }] },
        { ...manifest, books: [novels[0], novels[0]] },
        { ...manifest, books: [novels[0], { title: 'Nested', source_folder: novels[0].source_folder + '/Nested' }] },
        { ...manifest, book_folder: 'Not in collection' }
    ])('refuses malformed or overlapping collections before registration', invalid => {
        expect(() => readSampleVaultManifest(invalid)).toThrow();
    });
});
