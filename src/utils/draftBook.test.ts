import { describe, expect, it } from 'vitest';
import type { Vault } from 'obsidian';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import { copyFolderRecursive, createBookCopyProfile, resolveDraftTarget } from './draftBook';
import { getSagaBooks, getBookIdForPath, normalizeBookProfile } from './books';
import type { BookProfile } from '../types/settings';
import { resolveBookManagerInquiryBooks } from '../inquiry/services/bookResolution';

const source: BookProfile = {
    id: 'original', title: 'Novel', sourceFolder: 'Books/Novel', fileStem: 'submission',
    bookPageOrder: ['note:Books/Novel/Preface.md', 'bookmeta:copyright'],
};
function memoryVault(onWrite?: (path: string, contents: Map<string, ArrayBuffer>) => void) {
    const contents = new Map<string, ArrayBuffer>([
        ['Books/Novel/Scene.md', new TextEncoder().encode('---\nID: scn_12345678\nClass: Scene\n---\nOriginal prose.').buffer],
        ['Books/Novel/image.png', new Uint8Array([0, 255, 12, 34]).buffer],
    ]);
    const folders = new Map<string, TFolder>(['Books', 'Books/Novel'].map(path => [path, new TFolder(path)]));
    const vault = {
        getAbstractFileByPath: (path: string) => folders.get(path) ?? (contents.has(path) ? new TFile(path) : null),
        getFiles: () => [...contents.keys()].map(path => new TFile(path)),
        getAllFolders: () => [...folders.values()],
        createFolder: async (path: string) => { folders.set(path, new TFolder(path)); },
        readBinary: async (file: TFile) => {
            const data = contents.get(file.path);
            if (!data) throw new Error('Missing file');
            return data.slice(0);
        },
        createBinary: async (path: string, data: ArrayBuffer) => {
            if (contents.has(path)) throw new Error('Already exists');
            contents.set(path, data.slice(0));
            onWrite?.(path, contents);
        },
    };
    return { contents, vault: vault as unknown as Vault };
}

describe('book copies preserve lineage and isolate book instances', () => {
    it.each(['submission-snapshot', 'working-draft'] as const)('creates an independent %s profile', kind => {
        const copy = createBookCopyProfile(source, 'Books/Novel — Copy', 'Copy', kind);
        expect(copy.id).not.toBe(source.id);
        expect(copy.copy).toMatchObject({ schemaVersion: 1, kind, sourceBookId: source.id });
        expect(copy.includeInSaga).toBe(false);
        expect(copy.fileStem).toBeUndefined();
        expect(copy.bookPageOrder).toEqual(['note:Books/Novel — Copy/Preface.md', 'bookmeta:copyright']);
        expect(source.bookPageOrder?.[0]).toBe('note:Books/Novel/Preface.md');
        expect(normalizeBookProfile(copy)).toEqual(copy);
    });

    it('excludes copies from saga but permits single-book analysis and explicit inclusion', () => {
        const copy = createBookCopyProfile(source, 'Books/Copy', 'Copy', 'submission-snapshot');
        const books = [source, copy];
        expect(getSagaBooks({ books }).map(book => book.id)).toEqual([source.id]);
        expect(resolveBookManagerInquiryBooks(books, 'saga').includedRoots).toEqual([source.sourceFolder]);
        expect(resolveBookManagerInquiryBooks(books, 'book').includedRoots).toEqual([source.sourceFolder, copy.sourceFolder]);
        copy.includeInSaga = true;
        expect(getSagaBooks({ books })).toHaveLength(2);
        expect(resolveBookManagerInquiryBooks(books, 'saga').includedRoots).toHaveLength(2);
    });

    it('keeps existing profiles included without guessing their purpose from names', () => {
        expect(getSagaBooks({ books: [{ ...source, title: 'Draft 2' }] })).toHaveLength(1);
    });

    it('finds instance identity independently of active book and refuses duplicate roots', () => {
        const copy = createBookCopyProfile(source, 'Books/Copy', 'Copy', 'working-draft');
        expect(getBookIdForPath([source, copy], 'Books/Copy/Scene.md')).toBe(copy.id);
        expect(getBookIdForPath([source, copy], 'Books/Novel/Scene.md')).toBe(source.id);
        expect(getBookIdForPath([source, { ...source, id: 'conflict' }], 'Books/Novel/Scene.md')).toBeUndefined();
    });

    it('copies identical Markdown and binary bytes without changing scene IDs or the source', async () => {
        const { vault, contents } = memoryVault();
        const before = contents.get('Books/Novel/Scene.md')!.slice(0);
        await copyFolderRecursive(vault, 'Books/Novel', 'Books/Novel — Copy');
        expect(contents.get('Books/Novel — Copy/Scene.md')).toEqual(before);
        expect(contents.get('Books/Novel/Scene.md')).toEqual(before);
        expect(contents.get('Books/Novel — Copy/image.png')).toEqual(contents.get('Books/Novel/image.png'));
        expect(resolveDraftTarget(vault, 'Books/Novel', 'Copy').destinationPath).toBe('Books/Novel — Copy 2');
    });

    it('reports a changing source instead of certifying a mixed-time copy', async () => {
        const { vault } = memoryVault((_path, contents) => {
            contents.set('Books/Novel/Scene.md', new TextEncoder().encode('changed while copying').buffer);
        });
        await expect(copyFolderRecursive(vault, 'Books/Novel', 'Books/Copy')).rejects.toThrow('verification failed');
    });

    it('detects source files added during copying', async () => {
        const { vault } = memoryVault((_path, contents) => {
            contents.set('Books/Novel/New.md', new TextEncoder().encode('new').buffer);
        });
        await expect(copyFolderRecursive(vault, 'Books/Novel', 'Books/Copy')).rejects.toThrow('Source files changed');
    });

    it('fails without deleting a partial copy when storage fails', async () => {
        const { vault, contents } = memoryVault(() => { throw new Error('disk full'); });
        await expect(copyFolderRecursive(vault, 'Books/Novel', 'Books/Copy')).rejects.toThrow('disk full');
        expect(contents.has('Books/Novel/Scene.md')).toBe(true);
        expect([...contents.keys()].some(path => path.startsWith('Books/Copy/'))).toBe(true);
    });

    it('refuses copies into the source, a parent, or an existing folder', async () => {
        const { vault } = memoryVault();
        await expect(copyFolderRecursive(vault, 'Books/Novel', 'Books/Novel/Sub')).rejects.toThrow('inside source');
        await expect(copyFolderRecursive(vault, 'Books/Novel', 'Books')).rejects.toThrow('contain source');
        await expect(copyFolderRecursive(vault, 'Books/Novel', 'Books/Novel')).rejects.toThrow('equal source');
    });
});
