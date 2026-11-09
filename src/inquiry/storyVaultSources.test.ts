import { describe, expect, it } from 'vitest';
import { TFile, type MetadataCache, type Vault } from 'obsidian';
import type { InquirySourcesSettings } from '../types/settings';
import { isImportedStoryBook, storyBookInquirySources } from './storyVaultSources';

const book = 'Demo Projects/The Odyssey/The Odyssey';
const manifestPath = 'Demo Projects/The Odyssey/Sample Vault Config.md';

function fixture(frontmatter: Record<string, unknown>) {
    const manifest = new TFile(manifestPath);
    const vault = { getAbstractFileByPath: (path: string) => path === manifestPath ? manifest : null } as unknown as Vault;
    const cache = { getFileCache: () => ({ frontmatter }) } as unknown as MetadataCache;
    return { vault, cache };
}

describe('imported Story Vault Inquiry sources', () => {
    const manifest = { rt_sample_vault: true, schema_version: 1, books: [{ title: 'The Odyssey', source_folder: book }] };

    it('recognizes only the declared book in book scope, including existing imports', () => {
        const { vault, cache } = fixture(manifest);
        expect(isImportedStoryBook(vault, cache, 'book', book)).toBe(true);
        expect(isImportedStoryBook(vault, cache, 'saga', book)).toBe(false);
        expect(isImportedStoryBook(vault, cache, 'book', 'Author/Book')).toBe(false);
        expect(isImportedStoryBook(vault, cache, 'book', `${book}/Other`)).toBe(false);
        expect(isImportedStoryBook(vault, cache, 'book', 'Demo Projects/Other/Book')).toBe(false);
    });

    it('does not recognize malformed or undeclared manifests', () => {
        for (const fm of [{}, { ...manifest, schema_version: 2 }, { ...manifest, books: [{ title: 'Author', source_folder: 'Author/Book' }] }]) {
            const { vault, cache } = fixture(fm);
            expect(isImportedStoryBook(vault, cache, 'book', book)).toBe(false);
        }
    });

    it('enables only sample scenes without mutating the author rules', () => {
        const sources: InquirySourcesSettings = {
            classScope: ['outline'], scanRoots: ['Author'],
            classes: [
                { className: 'scene', enabled: false, bookScope: 'excluded', sagaScope: 'excluded', referenceScope: 'excluded' },
                { className: 'outline', enabled: true, bookScope: 'summary', sagaScope: 'excluded', referenceScope: 'excluded' }
            ]
        };
        const original = structuredClone(sources);
        const effective = storyBookInquirySources(sources);
        expect(sources).toEqual(original);
        expect(effective.classScope).toEqual(['outline', 'scene']);
        expect(effective.classes?.find(c => c.className === 'scene')).toMatchObject({ enabled: true, bookScope: 'full', sagaScope: 'excluded' });
        expect(effective.classes?.find(c => c.className === 'outline')).toEqual(original.classes?.[1]);
        expect(effective.scanRoots).toEqual(['Author']);
    });

    it('preserves an already enabled summary mode', () => {
        const sources: InquirySourcesSettings = { classScope: ['/'], classes: [{ className: 'scene', enabled: true, bookScope: 'summary', sagaScope: 'full', referenceScope: 'excluded' }] };
        expect(storyBookInquirySources(sources).classes?.[0]).toEqual(sources.classes?.[0]);
        expect(storyBookInquirySources(sources).classScope).toEqual(['/']);
    });
});
