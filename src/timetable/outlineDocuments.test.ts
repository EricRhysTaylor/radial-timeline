import { describe, expect, it } from 'vitest';
import { outlineDocumentPaths } from './outlineDocuments';

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
});
