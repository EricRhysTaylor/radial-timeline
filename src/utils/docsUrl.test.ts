import { describe, expect, it } from 'vitest';
import { DOCS_URL, docsUrl } from './docsUrl';

describe('docsUrl', () => {
    it('maps a wiki page name to its docs page', () => {
        expect(docsUrl('Settings-Core')).toBe(`${DOCS_URL}/Settings-Core/`);
    });

    it('keeps the section anchor', () => {
        expect(docsUrl('Settings-Core#acts')).toBe(`${DOCS_URL}/Settings-Core/#acts`);
    });

    it('ignores a .md extension, before or without an anchor', () => {
        expect(docsUrl('Book-Designer.md')).toBe(`${DOCS_URL}/Book-Designer/`);
        expect(docsUrl('Settings-AI.md#api-keys')).toBe(`${DOCS_URL}/Settings-AI/#api-keys`);
    });

    it('treats no page, or Home, as the docs home', () => {
        expect(docsUrl()).toBe(`${DOCS_URL}/`);
        expect(docsUrl('Home')).toBe(`${DOCS_URL}/`);
    });
});
