import type { BookProfile } from '../types/settings';
import { createBookId, normalizeBookProfile } from './books';

export interface SampleBookDefinition {
    title: string;
    sourceFolder: string;
}

export interface SampleVaultConfig {
    displayName?: string;
    bookFolder?: string;
    books?: SampleBookDefinition[];
}

/** Explicit collection manifests use version 1; older single-book notes stay readable. */
export function readSampleVaultManifest(fm: Record<string, unknown>): SampleVaultConfig | null {
    if (fm.rt_sample_vault !== true) return null;
    const config: SampleVaultConfig = {
        displayName: typeof fm.display_name === 'string' ? fm.display_name.trim() : undefined,
        bookFolder: typeof fm.book_folder === 'string' ? fm.book_folder.trim() : undefined
    };
    if (!('books' in fm)) return config;
    if (fm.schema_version !== 1 || !Array.isArray(fm.books) || !fm.books.length) {
        throw new Error('The sample collection needs schema_version: 1 and a nonempty books list.');
    }
    config.books = fm.books.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid book in the sample collection.');
        const book = entry as Record<string, unknown>;
        const title = typeof book.title === 'string' ? book.title.trim() : '';
        const sourceFolder = typeof book.source_folder === 'string' ? book.source_folder.trim() : '';
        if (!title || !sourceFolder || sourceFolder.includes('\\')
            || sourceFolder.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
            throw new Error('Each sample book needs a title and a vault-relative manuscript folder.');
        }
        return { title, sourceFolder };
    });
    const folders = config.books.map(book => book.sourceFolder);
    if (folders.some((folder, index) => folders.some((other, otherIndex) =>
        index !== otherIndex && (folder === other || folder.startsWith(`${other}/`))))) {
        throw new Error('Sample manuscript folders must be distinct and must not overlap.');
    }
    config.bookFolder = config.bookFolder || folders[0];
    if (!folders.includes(config.bookFolder)) {
        throw new Error('The sample opening book must be listed in the collection.');
    }
    return config;
}

/** Add missing books once, retaining the author's existing profiles and order. */
export function registerSampleBookProfiles(
    existing: BookProfile[],
    definitions: SampleBookDefinition[],
    openingFolder: string,
    nextId: () => string = createBookId
): { books: BookProfile[]; targetId: string } {
    const books = [...existing];
    for (const definition of definitions) {
        if (books.some(book => book.sourceFolder.trim().replace(/\/+$/, '') === definition.sourceFolder)) continue;
        books.push(normalizeBookProfile({ id: nextId(), ...definition }));
    }
    const target = books.find(book => book.sourceFolder.trim().replace(/\/+$/, '') === openingFolder);
    if (!target) throw new Error('The sample opening book is missing.');
    return { books, targetId: target.id };
}
