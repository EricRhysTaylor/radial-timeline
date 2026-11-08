import { describe, expect, it } from 'vitest';
import { reviewSceneCountLabels } from './OnboardingModal';

describe('Import Review counts', () => {
    const chapter = 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.';

    it('counts the words of the text the note is written with, not "0 chars"', () => {
        // A structure-only import names no people or places; the row says how much text arrived.
        const labels = reviewSceneCountLabels({ body: chapter, frontmatter: { Character: [], Place: [] } });
        expect(labels).toEqual(['23 words']);
        expect(labels.join(' ')).not.toMatch(/\b0\b|chars/);
    });

    it('adds the people and places an import found, with plural forms', () => {
        expect(reviewSceneCountLabels({ body: chapter, frontmatter: { Character: ['[[Mr. Bennet]]'], Place: ['[[Longbourn]]', '[[Netherfield]]'] } }))
            .toEqual(['23 words', '1 character', '2 places']);
    });

    it('still reports the text of a scene whose extraction failed', () => {
        expect(reviewSceneCountLabels({ body: chapter, frontmatter: null })).toEqual(['23 words']);
    });
});
