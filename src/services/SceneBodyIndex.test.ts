import { describe, expect, it } from 'vitest';
import { findBodyMatches } from './SceneBodyIndex';

describe('findBodyMatches', () => {
    it('finds a match regardless of case', () => {
        expect(findBodyMatches('She reached the coast.', 'COAST')).toEqual(['coast']);
    });

    it('returns the text as the author wrote it, not as it was typed', () => {
        // Stage 6 re-locates these strings in the file, so they must be the
        // prose's own casing.
        expect(findBodyMatches('The Coast was cold.', 'coast')).toEqual(['Coast']);
    });

    it('collects distinct case variants once each', () => {
        const body = 'coast, Coast, COAST, coast again';
        expect(findBodyMatches(body, 'coast')).toEqual(['coast', 'Coast', 'COAST']);
    });

    it('treats regex metacharacters literally', () => {
        // An author's punctuation means itself; nothing needs escaping.
        expect(findBodyMatches('He paused (briefly) there.', '(briefly)')).toEqual(['(briefly)']);
        expect(findBodyMatches('a.b and axb', 'a.b')).toEqual(['a.b']);
        expect(findBodyMatches("Don't stop.", "Don't")).toEqual(["Don't"]);
    });

    it('matches across an em dash and other typography', () => {
        expect(findBodyMatches('the light — brief — faded', '— brief —')).toEqual(['— brief —']);
    });

    it('finds overlapping-adjacent occurrences without looping forever', () => {
        expect(findBodyMatches('aaaa', 'aa')).toEqual(['aa']);
    });

    it('returns nothing for an absent phrase', () => {
        expect(findBodyMatches('She reached the coast.', 'mountain')).toEqual([]);
    });

    it('returns nothing for an empty body or empty phrase', () => {
        expect(findBodyMatches('', 'coast')).toEqual([]);
        expect(findBodyMatches('the coast', '')).toEqual([]);
    });

    it('matches a multi-word phrase as a phrase', () => {
        // Same semantics as timeline-field search: the phrase means itself, not
        // its words in any order.
        expect(findBodyMatches('she reached the coast at dawn', 'the coast')).toEqual(['the coast']);
        expect(findBodyMatches('the dawn reached her coast', 'the coast')).toEqual([]);
    });
});
