import { describe, expect, it } from 'vitest';
import {
    countWords,
    getScenePrefixNumber,
    normalizeStatus,
    parseSceneTitle,
    parseSceneTitleComponents,
    splitIntoBalancedLinesOptimal,
    stripObsidianComments,
    stripWikiLinks,
    truncateToWordLimit
} from './text';

describe('parseSceneTitle', () => {
    it('prefers the frontmatter scene number and strips a leading number from the title', () => {
        expect(parseSceneTitle('12 The Storm', 12)).toEqual({ number: '12', text: 'The Storm' });
        expect(parseSceneTitle('The Storm', 3)).toEqual({ number: '3', text: 'The Storm' });
    });

    it('falls back to the numeric prefix, normalising leading zeros, and escapes XML', () => {
        expect(parseSceneTitle('007 Bond & Co')).toEqual({ number: '7', text: 'Bond &amp; Co' });
        expect(parseSceneTitle('12.3 Aside')).toEqual({ number: '12.3', text: 'Aside' });
        expect(parseSceneTitle('Untitled')).toEqual({ number: '', text: 'Untitled' });
        expect(parseSceneTitle('')).toEqual({ number: '0', text: '' });
    });
});

describe('parseSceneTitleComponents', () => {
    it('uses frontmatter fields when given and only cleans the title', () => {
        expect(parseSceneTitleComponents('4 Arrival   2024-01-02', 4, '2024-01-02', '1h')).toEqual({
            sceneNumber: '4', title: 'Arrival', date: '2024-01-02', duration: '1h'
        });
    });

    it('parses number and trailing date from the raw title when frontmatter is absent', () => {
        expect(parseSceneTitleComponents('04 Arrival   Jan 2')).toEqual({
            sceneNumber: '4', title: 'Arrival', date: 'Jan 2', duration: ''
        });
        expect(parseSceneTitleComponents('Arrival').title).toBe('Arrival');
    });
});

describe('getScenePrefixNumber', () => {
    it('reads the frontmatter number first, then the title prefix', () => {
        expect(getScenePrefixNumber('9 Late', 2)).toBe('2');
        expect(getScenePrefixNumber('09 Late')).toBe('9');
        expect(getScenePrefixNumber('Late')).toBeNull();
        expect(getScenePrefixNumber(null)).toBeNull();
    });
});

describe('normalizeStatus', () => {
    it('maps the accepted spellings and leaves unknown values to the caller', () => {
        expect(normalizeStatus(undefined)).toBe('Todo');
        expect(normalizeStatus('')).toBe('Todo');
        expect(normalizeStatus(['Complete'])).toBe('Completed');
        expect(normalizeStatus('In Progress')).toBe('Working');
        expect(normalizeStatus('TBD')).toBe('Todo');
        expect(normalizeStatus('Due')).toBeNull();
    });
});

describe('text cleanup helpers', () => {
    it('strips Obsidian comments and wiki link syntax', () => {
        expect(stripObsidianComments('a %%hidden\nlines%% b')).toBe('a  b');
        expect(stripWikiLinks('See [[Place|the town]] and [[Hero]]')).toBe('See the town and Hero');
    });

    it('truncates by word count with an ellipsis and counts words by whitespace', () => {
        expect(truncateToWordLimit('one two three four', 2)).toBe('one two...');
        expect(truncateToWordLimit('one two', 5)).toBe('one two');
        expect(countWords('  one   two\nthree ')).toBe(3);
        expect(countWords('')).toBe(0);
    });
});

describe('splitIntoBalancedLinesOptimal', () => {
    it('keeps short text on one line and never leaves a one-word orphan', () => {
        expect(splitIntoBalancedLinesOptimal('one two three', 100)).toEqual(['one two three']);
        const lines = splitIntoBalancedLinesOptimal('alpha beta gamma delta epsilon zeta eta theta iota kappa', 160);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join(' ')).toBe('alpha beta gamma delta epsilon zeta eta theta iota kappa');
        expect(lines[lines.length - 1].split(' ').length).toBeGreaterThan(1);
    });
});
