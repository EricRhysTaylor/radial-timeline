import { describe, expect, it } from 'vitest';
import { kebabSlug, slugifyToFileStem } from './slug';

describe('kebabSlug', () => {
    it('lowercases and turns every non-alphanumeric run into one hyphen', () => {
        expect(kebabSlug('  My Book: Part II!  ', 'book')).toBe('my-book-part-ii');
        expect(kebabSlug('a--b_-c', 'x')).toBe('a-b-c');
    });

    it('falls back when nothing survives', () => {
        expect(kebabSlug('!!!', 'timeline')).toBe('timeline');
        expect(kebabSlug('', 'campaign')).toBe('campaign');
        expect(kebabSlug('', '')).toBe('');
    });

    it('keeps an already-normalised secret id byte for byte', () => {
        expect(kebabSlug('rt-community-connection-secret', '')).toBe('rt-community-connection-secret');
    });
});

describe('slugifyToFileStem', () => {
    it('keeps case, drops forbidden characters, hyphenates whitespace', () => {
        expect(slugifyToFileStem('The Odyssey: Book 1 / Draft?')).toBe('The-Odyssey-Book-1-Draft');
    });

    it('uses the default fallback and an explicit one', () => {
        expect(slugifyToFileStem('///')).toBe('Manuscript');
        expect(slugifyToFileStem('///', 'template')).toBe('template');
    });
});
