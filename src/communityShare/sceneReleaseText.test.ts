import { describe, expect, it } from 'vitest';
import {
    SCENE_MAX_BYTES,
    SCENE_MAX_WORDS,
    parsePastedScene,
    sceneBlocksFromNote,
    sceneTextHash,
    sceneTextJson,
    sceneTextProblem,
    sceneWordCount,
    type SceneBlock,
} from './sceneReleaseText';

const p = (...runs: Array<string | { em: string }>): SceneBlock => ({ kind: 'p', runs });
const BREAK: SceneBlock = { kind: 'break' };

describe('parsePastedScene (mirrors the website paste parser)', () => {
    it('makes one paragraph per line; blank lines only separate', () => {
        expect(parsePastedScene('First line.\nSecond line.\n\n\n\nThird line.')).toEqual([
            p('First line.'),
            p('Second line.'),
            p('Third line.'),
        ]);
    });

    it('reads *italic* anywhere and _italic_ at word edges', () => {
        expect(parsePastedScene('She said *no* and _meant it_.')).toEqual([
            p('She said ', { em: 'no' }, ' and ', { em: 'meant it' }, '.'),
        ]);
        expect(parsePastedScene('*Whole line.*')).toEqual([p({ em: 'Whole line.' })]);
    });

    it('leaves snake_case and a lone marker alone', () => {
        expect(parsePastedScene('The file was scene_draft_final and 2 * 3 is six.')).toEqual([
            p('The file was scene_draft_final and 2 * 3 is six.'),
        ]);
    });

    it('drops bold markers and keeps the words', () => {
        expect(parsePastedScene('A **bold** claim and a __second__ one.')).toEqual([
            p('A bold claim and a second one.'),
        ]);
    });

    it('turns a break line into one break', () => {
        for (const line of ['***', '* * *', '---', '___', '#', '*', '⁂', '~~~']) {
            expect(parsePastedScene(`Before.\n\n${line}\n\nAfter.`)).toEqual([p('Before.'), BREAK, p('After.')]);
        }
    });

    it('never leads, trails or doubles a break', () => {
        expect(parsePastedScene('***\nOne.\n***\n\n* * *\nTwo.\n***')).toEqual([p('One.'), BREAK, p('Two.')]);
    });

    it('drops frontmatter, Obsidian comments and HTML comments', () => {
        const pasted = [
            '---',
            'Class: Scene',
            'Synopsis: PRIVATE_SYNOPSIS',
            '---',
            'Kept. %% PRIVATE_NOTE %% Still kept.',
            '<!-- PRIVATE_HTML',
            'over two lines -->',
            'Last.',
        ].join('\n');
        const blocks = parsePastedScene(pasted);
        expect(blocks).toEqual([p('Kept.  Still kept.'), p('Last.')]);
        expect(JSON.stringify(blocks)).not.toMatch(/PRIVATE/);
    });

    it('drops a comment that only forms once an inner comment is removed', () => {
        const pasted = [
            'Kept. <!<!-- -->-- PRIVATE_HTML --> Still kept.',
            'Also %<!-- -->% PRIVATE_NOTE %<!-- -->% kept.',
            '<<!-- x -->!--<!-- y -->-- PRIVATE_NESTED --<!-- z -->>',
        ].join('\n');
        const blocks = parsePastedScene(pasted);
        expect(blocks).toEqual([p('Kept.  Still kept.'), p('Also  kept.')]);
        expect(JSON.stringify(blocks)).not.toMatch(/PRIVATE|<!--|--!?>|%%/);
    });

    it('drops a comment the author never closed, to the end of the text', () => {
        expect(parsePastedScene('Kept.\n%% PRIVATE_NOTE\nstill the note.')).toEqual([p('Kept.')]);
        expect(parsePastedScene('Kept. <!-- PRIVATE_HTML\nstill the comment.')).toEqual([p('Kept.')]);
        expect(parsePastedScene('One. %% a %% Two. %% PRIVATE_NOTE')).toEqual([p('One.  Two.')]);
    });

    it('ends an HTML comment at --!>', () => {
        const blocks = parsePastedScene('Kept. <!-- PRIVATE_HTML --!> Still kept.\nAlso <!<!-- -->-- PRIVATE_NESTED --!> kept.');
        expect(blocks).toEqual([p('Kept.  Still kept.'), p('Also  kept.')]);
        expect(JSON.stringify(blocks)).not.toMatch(/PRIVATE|<!--|--!?>|%%/);
    });

    it('takes the # off a heading', () => {
        expect(parsePastedScene('## The Storm\nIt rained.')).toEqual([p('The Storm'), p('It rained.')]);
    });

    it('normalizes line endings, a byte order mark, no-break spaces and control characters', () => {
        const bom = String.fromCharCode(0xfeff);
        const nbsp = String.fromCharCode(0xa0);
        const tab = String.fromCharCode(9);
        expect(parsePastedScene(`${bom}One${nbsp}two.\r\nThree${tab}four.\rFive.`)).toEqual([
            p('One two.'),
            p('Three four.'),
            p('Five.'),
        ]);
    });

    it('turns NUL, DEL and Unicode line separators into spaces and keeps other characters whole', () => {
        const [nul, del, lineSeparator] = [0, 0x7f, 0x2028].map(code => String.fromCharCode(code));
        expect(parsePastedScene(`A${nul}B${del}C${lineSeparator}D 🌊 é`)).toEqual([p('A B C D 🌊 é')]);
    });

    it('counts words across paragraphs, and none in a break', () => {
        expect(sceneWordCount([p('Hello ', { em: 'dear' }, ' world.'), BREAK, p('Second paragraph here.')])).toBe(6);
        expect(sceneWordCount([])).toBe(0);
    });
});

describe('the text hash', () => {
    const KNOWN: SceneBlock[] = [p('Hello ', { em: 'dear' }, ' world.'), BREAK, p('Second paragraph here.')];

    it('serializes with the website\'s key order', () => {
        expect(sceneTextJson(KNOWN)).toBe(
            '[{"kind":"p","runs":["Hello ",{"em":"dear"}," world."]},{"kind":"break"},{"kind":"p","runs":["Second paragraph here."]}]'
        );
    });

    it('matches the website\'s known answer', async () => {
        expect(await sceneTextHash(KNOWN)).toBe('1c6332d9736925a1057b70d9265cbbf37262f226bc452f80f228fce18bf5ba9b');
    });

    it('matches it for blocks the parser built', async () => {
        const parsed = parsePastedScene('Hello *dear* world.\n\n***\n\nSecond paragraph here.');
        expect(await sceneTextHash(parsed)).toBe('1c6332d9736925a1057b70d9265cbbf37262f226bc452f80f228fce18bf5ba9b');
    });

    it('changes when the text changes', async () => {
        expect(await sceneTextHash([p('Hello world.')])).not.toBe(await sceneTextHash([p('Hello, world.')]));
    });
});

describe('sceneBlocksFromNote (a scene note, cleaned for release)', () => {
    const note = [
        '---',
        'Class: Scene',
        'Synopsis: PRIVATE_SYNOPSIS',
        'Pending Edits: PRIVATE_EDITS',
        '---',
        'Mira opened the [[People/PRIVATE_FOLDER/Door|door]]. %% PRIVATE_NOTE %%',
        '',
        '%%query: PRIVATE_QUERY%%',
        '',
        '> [!note] PRIVATE_CALLOUT',
        '> PRIVATE_CALLOUT_BODY',
        '',
        'It was *cold*. ^private-block',
        '',
        '<!-- PRIVATE_HTML -->',
    ].join('\n');

    it('sends the prose and nothing else in the note', () => {
        const blocks = sceneBlocksFromNote(note);
        expect(blocks).toEqual([p('Mira opened the door.'), p('It was ', { em: 'cold' }, '.')]);
        const sent = JSON.stringify(blocks);
        expect(sent).not.toMatch(/PRIVATE/);
        expect(sent).not.toContain('private-block');
        expect(sent).not.toContain('Class');
    });

    it('keeps the text after a scene break that opens the note', () => {
        // The note's YAML is already gone, so this `---` pair is two scene
        // breaks, not a second YAML block to drop.
        const blocks = sceneBlocksFromNote('---\nClass: Scene\n---\n---\nKade: Get down!\n---\nThey ran.');
        expect(blocks).toEqual([p('Kade: Get down!'), BREAK, p('They ran.')]);
    });

    it('sends nothing after a comment the author never closed', () => {
        const blocks = sceneBlocksFromNote('---\nClass: Scene\n---\nMira ran. %% done %%\n\n%% PRIVATE_NOTE\n\nPRIVATE_MORE\n\n<!-- also open');
        expect(blocks).toEqual([p('Mira ran.')]);
        expect(JSON.stringify(blocks)).not.toMatch(/PRIVATE|<!--|%%/);
        expect(sceneBlocksFromNote('Prose. <!-- PRIVATE_HTML --!> More prose.')).toEqual([p('Prose.  More prose.')]);
    });

    it('is empty for a note with no prose', () => {
        expect(sceneBlocksFromNote('---\nClass: Scene\n---\n%% only a note %%\n')).toEqual([]);
    });
});

describe('sceneTextProblem (the website\'s limits, checked before Release is offered)', () => {
    it('passes ordinary text', () => {
        expect(sceneTextProblem([p('One two three.')])).toBeNull();
    });

    it('refuses text with no words', () => {
        expect(sceneTextProblem([])).toBe('empty');
    });

    it('allows 10,000 words and refuses one more', () => {
        const hundred = p(Array.from({ length: 100 }, () => 'word').join(' '));
        const full = Array.from({ length: SCENE_MAX_WORDS / 100 }, () => hundred);
        expect(sceneWordCount(full)).toBe(SCENE_MAX_WORDS);
        expect(sceneTextProblem(full)).toBeNull();
        expect(sceneTextProblem([...full, p('more')])).toBe('too_many_words');
    });

    it('refuses a paragraph past 20,000 characters', () => {
        expect(sceneTextProblem([p('a'.repeat(20_000))])).toBeNull();
        expect(sceneTextProblem([p('a'.repeat(20_001))])).toBe('too_large');
    });

    it('refuses text past the byte limit', () => {
        // Under the word limit, over the size limit: long unbroken words.
        const long = 'é'.repeat(9_000);
        const blocks = Array.from({ length: 30 }, () => p(long));
        expect(sceneWordCount(blocks)).toBeLessThan(SCENE_MAX_WORDS);
        expect(new TextEncoder().encode(sceneTextJson(blocks)).length).toBeGreaterThan(SCENE_MAX_BYTES);
        expect(sceneTextProblem(blocks)).toBe('too_large');
    });

    it('refuses too many blocks and too many runs in a paragraph', () => {
        expect(sceneTextProblem(Array.from({ length: 4_001 }, () => p('a')))).toBe('too_large');
        expect(sceneTextProblem([p(...Array.from({ length: 401 }, () => 'a '))])).toBe('too_large');
    });
});
