import { describe, expect, it } from 'vitest';
import { convertAuthorQueriesToWordComments } from './authorQueryComments';

const opts = { author: 'Eric Rhys Taylor', date: '2026-10-07T12:00:00Z' };
const span = (id: number, text: string, author = 'Eric Rhys Taylor') =>
    `[${text}]{.comment-start id="${id}" author="${author}" date="2026-10-07T12:00:00Z"}[]{.comment-end id="${id}"}`;

describe('convertAuthorQueriesToWordComments', () => {
    it('turns an inline %%query:%% marker into a point comment where it sat', () => {
        const input = 'She turned. %%query: Is this beat too abrupt?%% The lights went out.';
        expect(convertAuthorQueriesToWordComments(input, opts))
            .toBe(`She turned. ${span(1, 'Is this beat too abrupt?')} The lights went out.`);
    });

    it('still converts the legacy %%ai:%% spelling', () => {
        const input = 'Prose %%ai: Does the motif return?%% more.';
        expect(convertAuthorQueriesToWordComments(input, opts)).toBe(`Prose ${span(1, 'Does the motif return?')} more.`);
    });

    it('numbers several queries in order', () => {
        const out = convertAuthorQueriesToWordComments('%%query: One?%% a %%query: Two?%%', opts);
        expect(out).toContain(span(1, 'One?'));
        expect(out).toContain(span(2, 'Two?'));
    });

    it('moves a query on its own line to the end of the paragraph above', () => {
        const input = 'First paragraph ends here.\n\n%%query: Too slow?%%\n\nNext paragraph.';
        const out = convertAuthorQueriesToWordComments(input, opts);
        expect(out).toContain(`First paragraph ends here.${span(1, 'Too slow?')}`);
        expect(out).toContain('Next paragraph.');
        expect(out.split('\n').some(line => line.trim().startsWith('[Too slow?]'))).toBe(false);
    });

    it('keeps a query that opens the document in place', () => {
        const out = convertAuthorQueriesToWordComments('%%query: Opening right?%%\n\nPara.', opts);
        expect(out.startsWith(span(1, 'Opening right?'))).toBe(true);
    });

    it('collapses a query that wraps across lines', () => {
        const out = convertAuthorQueriesToWordComments('Prose. %%query:\n  Should the   motif\n  return?\n%%', opts);
        expect(out).toBe(`Prose. ${span(1, 'Should the motif return?')}`);
    });

    it('escapes Markdown in the question so it reads as plain text', () => {
        const out = convertAuthorQueriesToWordComments('x %%query: Is *this* [too] much?%%', opts);
        expect(out).toContain('[Is \\*this\\* \\[too\\] much?]{.comment-start');
    });

    it('escapes quotes in the author name', () => {
        const out = convertAuthorQueriesToWordComments('x %%query: Q?%%', { ...opts, author: 'A "B" C' });
        expect(out).toContain('author="A \\"B\\" C"');
    });

    it('falls back to "Author" when the book has no author', () => {
        const out = convertAuthorQueriesToWordComments('x %%query: Q?%%', { date: opts.date });
        expect(out).toContain(span(1, 'Q?', 'Author'));
    });

    it('drops an empty query', () => {
        expect(convertAuthorQueriesToWordComments('a %%query:   %% b', opts)).toBe('a  b');
    });

    it('leaves ordinary comments and text without queries untouched', () => {
        const input = 'Prose %% a plain note %% more.';
        expect(convertAuthorQueriesToWordComments(input, opts)).toBe(input);
    });

    it('leaves markers inside fenced code alone', () => {
        const input = '```\n%%query: not a query%%\n```\n\nProse %%query: Real?%%';
        const out = convertAuthorQueriesToWordComments(input, opts);
        expect(out).toContain('```\n%%query: not a query%%\n```');
        expect(out).toContain(`Prose ${span(1, 'Real?')}`);
    });
});
