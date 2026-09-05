import { describe, it, expect } from 'vitest';
import { extractBodyText, extractCountableBodyText } from './manuscript';

describe('extractBodyText keeps source content with minimal normalization', () => {
    it('preserves YAML frontmatter', () => {
        const input = '---\ntitle: My Scene\nstatus: draft\n---\nThe story begins here.';
        expect(extractBodyText(input)).toBe(input);
    });

    it('preserves HTML comments', () => {
        const input = 'Before <!-- hidden note --> after';
        expect(extractBodyText(input)).toBe('Before <!-- hidden note --> after');
    });

    it('preserves Obsidian comments (%%)', () => {
        const input = 'Visible text %%hidden comment%% more text';
        expect(extractBodyText(input)).toBe('Visible text %%hidden comment%% more text');
    });

    it('normalizes CRLF line endings and trims outer whitespace', () => {
        const input = '\r\n\r\nFirst line\r\nSecond line\r\n\r\n';
        expect(extractBodyText(input)).toBe('First line\nSecond line');
    });

    it('returns body unchanged when no normalization is needed', () => {
        const input = 'Just a plain paragraph.\nWith a second line.';
        expect(extractBodyText(input)).toBe('Just a plain paragraph.\nWith a second line.');
    });

    it('handles empty content', () => {
        expect(extractBodyText('')).toBe('');
    });
});

describe('extractCountableBodyText', () => {
    it('strips YAML frontmatter before counting', () => {
        const input = '---\ntitle: My Scene\nWords: 999\n---\nThe story begins here.';
        expect(extractCountableBodyText(input)).toBe('The story begins here.');
    });

    it('strips HTML and Obsidian comments before counting', () => {
        const input = 'Visible <!-- hidden --> text %%draft%% only';
        expect(extractCountableBodyText(input)).toBe('Visible  text  only');
    });
});
