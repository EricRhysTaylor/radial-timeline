import { describe, expect, it } from 'vitest';
import { parseDescriptionParts, splitOverviewParagraphs } from './descriptionParser';

describe('splitOverviewParagraphs', () => {
    it('splits on double newlines', () => {
        expect(splitOverviewParagraphs('A\n\nB\n\nC')).toEqual(['A', 'B', 'C']);
    });

    it('trims whitespace and drops empty paragraphs', () => {
        expect(splitOverviewParagraphs('  A  \n\n\n\n  B  ')).toEqual(['A', 'B']);
    });

    it('returns empty array for empty string', () => {
        expect(splitOverviewParagraphs('')).toEqual([]);
    });
});

describe('parseDescriptionParts', () => {
    it('parses a typical builtin description with fields', () => {
        const desc = [
            'Emphasizes clear emotional beats and audience engagement.',
            '',
            'Use it when you want clean turning points.',
            '',
            'Best for: commercial fiction, screenplays',
            'Momentum profile: setup -> midpoint turn -> closing payoff',
        ].join('\n');

        const parts = parseDescriptionParts(desc);
        expect(parts.summary).toBe('Emphasizes clear emotional beats and audience engagement.');
        expect(parts.body).toEqual(['Use it when you want clean turning points.']);
        expect(parts.fields).toEqual([
            { label: 'Best for', value: 'commercial fiction, screenplays' },
            { label: 'Momentum profile', value: 'setup -> midpoint turn -> closing payoff' },
        ]);
    });

    it('returns summary only when description is a single line', () => {
        const parts = parseDescriptionParts('Short description.');
        expect(parts.summary).toBe('Short description.');
        expect(parts.body).toEqual([]);
        expect(parts.fields).toEqual([]);
    });

    it('handles description with no labeled fields', () => {
        const desc = 'Summary.\n\nBody paragraph one.\n\nBody paragraph two.';
        const parts = parseDescriptionParts(desc);
        expect(parts.summary).toBe('Summary.');
        expect(parts.body).toEqual(['Body paragraph one.', 'Body paragraph two.']);
        expect(parts.fields).toEqual([]);
    });

    it('handles empty description', () => {
        const parts = parseDescriptionParts('');
        expect(parts.summary).toBe('');
        expect(parts.body).toEqual([]);
        expect(parts.fields).toEqual([]);
    });

    it('parses all known labels', () => {
        const desc = [
            'Summary.',
            '',
            'Best for: X',
            'Momentum profile: Y',
            'Momentum: Z',
            'Start with: W',
        ].join('\n');

        const parts = parseDescriptionParts(desc);
        expect(parts.fields).toEqual([
            { label: 'Best for', value: 'X' },
            { label: 'Momentum profile', value: 'Y' },
            { label: 'Momentum', value: 'Z' },
            { label: 'Start with', value: 'W' },
        ]);
    });

    it('Classic Dramatic Structure description parses correctly', () => {
        const desc = [
            'Emphasizes scene pressure, turning points, decisions, and consequential outcomes.',
            '',
            'Use it when you want to stress-test whether each scene creates movement through conflict and change.',
            '',
            'Best for: literary fiction, drama, tightly edited scene work, revision passes',
            'Momentum profile: setup \u2192 complication \u2192 pressure \u2192 decision \u2192 outcome',
        ].join('\n');

        const parts = parseDescriptionParts(desc);
        expect(parts.summary).toBe('Emphasizes scene pressure, turning points, decisions, and consequential outcomes.');
        expect(parts.body).toEqual([
            'Use it when you want to stress-test whether each scene creates movement through conflict and change.',
        ]);
        expect(parts.fields).toHaveLength(2);
        expect(parts.fields[0].label).toBe('Best for');
        expect(parts.fields[1].label).toBe('Momentum profile');
    });

    it('Save The Cat description parses correctly', () => {
        const desc = [
            'Emphasizes clear emotional beats and audience engagement.',
            '',
            'Use it when you want clean turning points, visible reversals, and a strong sense of audience-facing momentum from setup through finale.',
            '',
            'Best for: commercial fiction, screenplays, high-concept genre',
            'Momentum profile: setup -> midpoint turn -> closing payoff',
        ].join('\n');

        const parts = parseDescriptionParts(desc);
        expect(parts.summary).toBe('Emphasizes clear emotional beats and audience engagement.');
        expect(parts.body).toHaveLength(1);
        expect(parts.fields).toHaveLength(2);
    });

    it("Hero's Journey description parses correctly", () => {
        const desc = [
            'Tracks departure, transformation, ordeal, and return.',
            '',
            'Use it when you want a mythic or identity-driven arc with visible inner and outer transformation.',
            '',
            'Best for: quest stories, speculative fiction, coming-of-age, transformational journeys',
            'Momentum profile: departure -> trials -> ordeal -> return with change',
        ].join('\n');

        const parts = parseDescriptionParts(desc);
        expect(parts.summary).toBe('Tracks departure, transformation, ordeal, and return.');
        expect(parts.body).toHaveLength(1);
        expect(parts.fields).toHaveLength(2);
    });
});
