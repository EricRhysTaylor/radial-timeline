import { describe, expect, it } from 'vitest';
import {
    finalizeInquiryBookResolution,
    isDraftVariantPath,
    isPathIncludedByInquiryBooks,
    resolveBookManagerInquiryBooks,
    type DiscoveredInquiryBookRoot
} from './bookResolution';

describe('bookResolution', () => {
    it('detects draft-style paths', () => {
        expect(isDraftVariantPath('Book 1')).toBe(false);
        expect(isDraftVariantPath('Book 1 - Draft 2')).toBe(true);
        expect(isDraftVariantPath('Series/Book 2 — revision')).toBe(true);
        expect(isDraftVariantPath('Series/Book 3/v2')).toBe(true);
    });

    it('excludes variants and nested candidates by default', () => {
        const discovered: DiscoveredInquiryBookRoot[] = [
            { rootPath: 'Book 1', detectedByName: true, detectedByOutline: false, bookNumber: 1 },
            { rootPath: 'Book 1 - Draft 2', detectedByName: true, detectedByOutline: false, bookNumber: 1 },
            { rootPath: 'Book 2', detectedByName: true, detectedByOutline: false, bookNumber: 2 },
            { rootPath: 'Book 2/Draft 1', detectedByName: false, detectedByOutline: true }
        ];

        const resolved = finalizeInquiryBookResolution(discovered);

        expect(resolved.includedRoots).toEqual(['Book 1', 'Book 2']);
        expect(resolved.excludedRoots).toEqual(['Book 1 - Draft 2', 'Book 2/Draft 1']);
        expect(resolved.hasVariantExclusions).toBe(true);
        expect(resolved.hasNestedExclusions).toBe(true);
    });

    it('allows manual include overrides for excluded variants', () => {
        const discovered: DiscoveredInquiryBookRoot[] = [
            { rootPath: 'Book 1', detectedByName: true, detectedByOutline: false, bookNumber: 1 },
            { rootPath: 'Book 1 - Draft 2', detectedByName: true, detectedByOutline: false, bookNumber: 1 }
        ];

        const resolved = finalizeInquiryBookResolution(discovered, {
            'Book 1 - Draft 2': true
        });

        expect(resolved.includedRoots).toEqual(['Book 1', 'Book 1 - Draft 2']);
        const draft = resolved.candidates.find(candidate => candidate.rootPath === 'Book 1 - Draft 2');
        expect(draft?.included).toBe(true);
        expect(draft?.status).toBe('included');
    });

    it('uses included candidates as material filter', () => {
        const discovered: DiscoveredInquiryBookRoot[] = [
            { rootPath: 'Book 1', detectedByName: true, detectedByOutline: false, bookNumber: 1 },
            { rootPath: 'Book 1 - Draft 2', detectedByName: true, detectedByOutline: false, bookNumber: 1 }
        ];
        const resolved = finalizeInquiryBookResolution(discovered);

        expect(isPathIncludedByInquiryBooks('Book 1/01 Scene.md', resolved.candidates)).toBe(true);
        expect(isPathIncludedByInquiryBooks('Book 1 - Draft 2/01 Scene.md', resolved.candidates)).toBe(false);
        expect(isPathIncludedByInquiryBooks('Character/Alice.md', resolved.candidates)).toBe(true);
    });

    it('sorts included books by sequence number instead of folder/title numbering', () => {
        const discovered: DiscoveredInquiryBookRoot[] = [
            { rootPath: 'Books/Book 9 Prequel - The General', detectedByName: false, detectedByOutline: false, detectedByProfile: true, bookNumber: 2 },
            { rootPath: 'Books/Shail + Trisan', detectedByName: false, detectedByOutline: false, detectedByProfile: true, bookNumber: 1 },
            { rootPath: 'Books/Book 2 Saturn & Jupiter', detectedByName: false, detectedByOutline: false, detectedByProfile: true, bookNumber: 3 }
        ];

        const resolved = finalizeInquiryBookResolution(discovered);

        expect(resolved.includedRoots).toEqual([
            'Books/Shail + Trisan',
            'Books/Book 9 Prequel - The General',
            'Books/Book 2 Saturn & Jupiter'
        ]);
    });

    it('uses Book Manager rows as the authoritative inquiry books', () => {
        const resolved = resolveBookManagerInquiryBooks([
            { id: 'book-1', title: 'Shail + Trisan', sourceFolder: 'Books/Shail + Trisan' },
            { id: 'book-2', title: 'Book 9 Prequel - The General', sourceFolder: 'Books/Book 9 Prequel - The General' },
            { id: 'book-3', title: 'Missing Folder', sourceFolder: '' }
        ]);

        expect(resolved.includedRoots).toEqual([
            'Books/Shail + Trisan',
            'Books/Book 9 Prequel - The General'
        ]);
        expect(resolved.includedBooks.map(book => book.bookNumber)).toEqual([1, 2]);
        expect(resolved.includedBooks.every(book => book.detectedBy === 'profile')).toBe(true);
    });
});
