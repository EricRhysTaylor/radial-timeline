import { describe, expect, it } from 'vitest';
import { parsePastedScene } from '../communityShare/sceneReleaseText';
import { noteLikeText, sceneExcerpt } from './sceneReleaseReview';

describe('sceneExcerpt', () => {
    it('gives the first line, and the last when there is more than one paragraph', () => {
        expect(sceneExcerpt(parsePastedScene('One.'))).toEqual({ first: 'One.', last: null });
        expect(sceneExcerpt(parsePastedScene('One.\n\nTwo.\n\nThree.'))).toEqual({ first: 'One.', last: 'Three.' });
    });

    it('cuts a long line at a word, with an ellipsis', () => {
        const long = `${'word '.repeat(60)}end`;
        const { first } = sceneExcerpt(parsePastedScene(long))!;
        expect(first.length).toBeLessThanOrEqual(141);
        expect(first.endsWith('word…')).toBe(true);
    });

    it('is null for a scene with no text', () => {
        expect(sceneExcerpt([])).toBeNull();
    });
});

describe('noteLikeText', () => {
    const note = (text: string) => noteLikeText(parsePastedScene(text));

    it('leaves ordinary prose alone, including words that only look like markers', () => {
        expect(note('She said todo lists were for cowards.\n\nThe tkachenko file was thin. XXL shirts. Note how it rained.')).toBeNull();
    });

    it('finds placeholders typed in capitals', () => {
        for (const marker of ['TODO', 'TBD', 'FIXME', 'XXX', 'TK']) {
            expect(note(`He opened the door. ${marker} describe the room.`)?.snippet).toContain(marker);
        }
    });

    it('finds bracketed reminders, template braces, web addresses and labelled notes', () => {
        expect(note('The letter arrived. [check the postmark]')?.snippet).toContain('[check the postmark]');
        expect(note('Hello {{name}}.')?.snippet).toContain('{{name}}');
        expect(note('Source https://example.com/page for this.')?.snippet).toContain('https://example.com/page');
        expect(note('Research: Victorian postal routes.')?.snippet).toContain('Research:');
    });

    it('quotes the first and counts the other paragraphs that have one', () => {
        expect(note('A [one].\n\nPlain.\n\nB TODO.\n\nC TK.')).toEqual({ snippet: 'A [one].', more: 2 });
    });
});
