import { describe, expect, it } from 'vitest';
import { outlineDocumentPaths, outlineReferenceType, planOutlineReferences } from './outlineDocuments';

describe('outline document discovery', () => {
    const notes = [
        { path: 'Book A/Outline.md', bookId: 'a', className: 'Outline' },
        { path: 'Book B/Outline.md', bookId: 'b', className: 'Outline' },
        { path: 'Book A/Scene.md', bookId: 'a', className: 'Scene' },
    ];
    it('discovers only outline notes in the selected book, plus explicitly linked external notes', () => {
        expect(outlineDocumentPaths('a', notes, ['Shared/Series.md', 'Book A/Outline.md'])).toEqual(['Book A/Outline.md', 'Shared/Series.md']);
    });
    it('does not discover vault-wide notes when no book is selected', () => {
        expect(outlineDocumentPaths(undefined, notes, [])).toEqual([]);
    });
    it('recognizes existing class labels without guessing from the filename', () => {
        expect([' Outline ', 'SCENE', 'Sketch', 'Character', 'Place', 'Beat', undefined].map(outlineReferenceType))
            .toEqual(['outline', 'scene', 'sketch', 'character', 'place', 'note', 'note']);
    });
    it('detects notes already displayed and duplicate items in a batch', () => {
        expect(planOutlineReferences(['a.md', 'b.md', 'b.md'], ['a.md'])).toEqual({ add: ['b.md'], duplicates: ['a.md'] });
    });
});
