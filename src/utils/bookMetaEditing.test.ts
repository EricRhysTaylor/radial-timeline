import { describe, expect, it } from 'vitest';
import {
    applyBookMetaFieldUpdate,
    normalizeBookMetaEditValue,
} from './bookMetaEditing';

describe('bookMetaEditing', () => {
    it('normalizes required text fields', () => {
        expect(normalizeBookMetaEditValue('title', '  Example Title  ')).toEqual({
            ok: true,
            normalizedValue: 'Example Title',
        });
        expect(normalizeBookMetaEditValue('title', '   ').ok).toBe(false);
    });

    it('normalizes optional fields to null when blank', () => {
        expect(normalizeBookMetaEditValue('isbn', '   ')).toEqual({
            ok: true,
            normalizedValue: null,
        });
    });

    it('validates rights year as a 4-digit year', () => {
        expect(normalizeBookMetaEditValue('rights-year', '2026')).toEqual({
            ok: true,
            normalizedValue: 2026,
        });
        expect(normalizeBookMetaEditValue('rights-year', '26').ok).toBe(false);
    });

    it('applies nested BookMeta updates without scrambling other fields', () => {
        const frontmatter: Record<string, unknown> = {
            Class: 'BookMeta',
            Book: { title: 'Old Title', author: 'Author' },
            Rights: { copyright_holder: 'Old Holder', year: 2025 },
        };

        applyBookMetaFieldUpdate(frontmatter, 'title', 'New Title');
        applyBookMetaFieldUpdate(frontmatter, 'copyright-holder', 'New Holder');

        expect(frontmatter).toEqual({
            Class: 'BookMeta',
            Book: { title: 'New Title', author: 'Author' },
            Rights: { copyright_holder: 'New Holder', year: 2025 },
        });
    });

    it('removes optional nested fields cleanly when cleared', () => {
        const frontmatter: Record<string, unknown> = {
            Class: 'BookMeta',
            Identifiers: { isbn_paperback: '9780000000000' },
        };

        applyBookMetaFieldUpdate(frontmatter, 'isbn', null);

        expect(frontmatter).toEqual({
            Class: 'BookMeta',
        });
    });
});
