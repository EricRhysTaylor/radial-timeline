import { describe, expect, it } from 'vitest';
import { countManuscriptComments, getDefaultManuscriptCleanupOptions, sanitizeCompiledManuscript, sanitizeCompiledManuscriptForPdf } from './manuscriptSanitize';

describe('sanitizeCompiledManuscript', () => {
    it('always removes YAML frontmatter blocks from compiled manuscript text', () => {
        const input = `## 1 Opening

---
Class: Scene
Words: 1200
---
Paragraph one.

## 2 Arrival

---
Class: Scene
Role: other
---
Paragraph two.`;

        const sanitized = sanitizeCompiledManuscript(input, {
            stripComments: false,
            stripLinks: false,
            stripCallouts: false,
            stripBlockIds: false
        });

        expect(sanitized).toContain('## 1 Opening');
        expect(sanitized).toContain('## 2 Arrival');
        expect(sanitized).toContain('Paragraph one.');
        expect(sanitized).toContain('Paragraph two.');
        expect(sanitized).not.toContain('Class: Scene');
        expect(sanitized).not.toContain('Words: 1200');
        expect(sanitized).not.toContain('Role: other');
    });

    it('keeps scene-break text that only partly looks like YAML', () => {
        const input = ['Before.', '', '---', 'Kade: Get down!', 'She dove behind the crates.', '---', '', 'After.'].join('\n');
        const sanitized = sanitizeCompiledManuscript(input);
        expect(sanitized).toBe(input);
        expect(sanitizeCompiledManuscriptForPdf(input)).toContain('Kade: Get down!');
    });

    it('keeps scene-break text that does not parse as a YAML mapping', () => {
        const input = ['Before.', '', '---', 'Kade: Get down: now!', '---', '', 'After.'].join('\n');
        expect(sanitizeCompiledManuscript(input)).toBe(input);
    });

    it('strips embedded frontmatter with lists, multi-word keys and continuations', () => {
        const input = ['## 1 Opening', '', '---', 'Class: Scene', 'Publish Stage: Zero', 'Subplot:', '  - Main Plot', '  - Romance', 'Synopsis: >', '  Kade crosses the yard.', '"Pending Edits": tighten', '---', 'Paragraph one.'].join('\n');
        const sanitized = sanitizeCompiledManuscript(input);
        expect(sanitized).toBe('## 1 Opening\n\nParagraph one.');
    });

    it('preserves comments, links, and callouts when optional cleanup is disabled', () => {
        const input = `---
Class: Scene
---
Visible %%editor note%% and <!-- html note -->.
[Doc link](https://example.com) with [[My Note|Alias]].
> [!note] Tip
> Keep this callout.`;

        const sanitized = sanitizeCompiledManuscript(input, {
            stripComments: false,
            stripLinks: false,
            stripCallouts: false,
            stripBlockIds: false
        });

        expect(sanitized).toContain('%%editor note%%');
        expect(sanitized).toContain('<!-- html note -->');
        expect(sanitized).toContain('[Doc link](https://example.com)');
        expect(sanitized).toContain('[[My Note|Alias]]');
        expect(sanitized).toContain('> [!note] Tip');
        expect(sanitized).not.toContain('Class: Scene');
    });

    it('always strips Editorialist revision batches from manuscript output', () => {
        const input = `Scene text before.

Return only this fenced block. No extra text.

\`\`\`editorialist-review
Template: Editorialist advanced
TemplateYear: 2026
SupportedOperations: Edit, Move, Cut, Condense
Reviewer: GPT-5.4
ReviewerType: ai-editor
Provider: OpenAI
Model: GPT-5.4

=== EDIT ===
SceneId: scn_xxxxxxxx
Original: ...
Revised: ...
Why: ...
\`\`\`

Scene text after.`;

        const sanitized = sanitizeCompiledManuscript(input, {
            stripComments: false,
            stripLinks: false,
            stripCallouts: false,
            stripBlockIds: false
        });

        expect(sanitized).toContain('Scene text before.');
        expect(sanitized).toContain('Scene text after.');
        expect(sanitized).not.toContain('Return only this fenced block. No extra text.');
        expect(sanitized).not.toContain('```editorialist-review');
        expect(sanitized).not.toContain('Template: Editorialist advanced');
        expect(sanitized).not.toContain('=== EDIT ===');
    });

    it.each(['````', '~~~~'])('strips %s review fences without stopping at nested shorter fences', (fence) => {
        const input = ['Before.', '', `${fence}editorialist-review`, '=== MEMO ===', 'Issues: Private review.', fence.slice(0, 3), 'Hidden payload.', fence + ' ignored trailing text', 'Still private.', fence + fence[0], '', '---', 'Class: Scene', '---', 'After.'].join('\n');
        expect(sanitizeCompiledManuscriptForPdf(input, { stripAiComments: false })).toBe('Before.\n\nAfter.');
    });

    it('preserves a review-fence example inside a longer ordinary code block', () => {
        const example = ['````markdown', '```editorialist-review', '=== MEMO ===', 'Issues: Example.', '```', '````'].join('\n');
        expect(sanitizeCompiledManuscript(example)).toBe(example);
    });

    it('preserves long fenced code through cleanup and strips private comments after it', () => {
        const code = ['````text', '%%keep%%', '```', '[keep](example)', '````'].join('\n');
        expect(sanitizeCompiledManuscript(code + '\n\nAfter %%private%%.', { stripComments: true, stripLinks: true })).toBe(code + '\n\nAfter .');
    });

    it('strips comments, links, callouts, and block ids when enabled', () => {
        const input = `Visible %%hidden%% and <!-- html hidden -->.
[Doc link](https://example.com) with [[Folder/My Note|Alias]].
> [!warning] Remove me
> This line should also go.
Ends here ^scene-end`;

        const sanitized = sanitizeCompiledManuscript(input, {
            stripComments: true,
            stripLinks: true,
            stripCallouts: true,
            stripBlockIds: true
        });

        expect(sanitized).not.toContain('%%hidden%%');
        expect(sanitized).not.toContain('<!-- html hidden -->');
        expect(sanitized).not.toContain('[Doc link]');
        expect(sanitized).not.toContain('[[Folder/My Note|Alias]]');
        expect(sanitized).toContain('Doc link');
        expect(sanitized).toContain('Alias');
        expect(sanitized).not.toContain('[!warning]');
        expect(sanitized).not.toContain('This line should also go.');
        expect(sanitized).not.toContain('^scene-end');
    });

    it('preserves Pandoc raw LaTeX blocks used by Modern Classic part and scene markers', () => {
        const input = `Visible prose.
\`\`\`{=latex}
\\rtPart{I}
\`\`\`

\`\`\`{=latex}
\\rtEpigraph{A quote}{Author}
\`\`\`

\`\`\`{=latex}
\\rtSceneSep{ii}
\`\`\``;

        const sanitized = sanitizeCompiledManuscript(input, {
            stripComments: true,
            stripLinks: true,
            stripCallouts: true,
            stripBlockIds: true
        });

        expect(sanitized).toContain('\\rtPart{I}');
        expect(sanitized).toContain('\\rtEpigraph{A quote}{Author}');
        expect(sanitized).toContain('\\rtSceneSep{ii}');
    });

    it('removes markdown task-list boxes from PDF-bound manuscript text', () => {
        const input = `## 1 Opening

- [ ] recently read
- [x] already known
1. [ ] numbered task`;

        const sanitized = sanitizeCompiledManuscriptForPdf(input, {
            stripComments: false,
            stripLinks: false,
            stripCallouts: false,
            stripBlockIds: false
        });

        expect(sanitized).toContain('- recently read');
        expect(sanitized).toContain('- already known');
        expect(sanitized).toContain('1. numbered task');
        expect(sanitized).not.toContain('[ ]');
        expect(sanitized).not.toContain('[x]');
    });

    it('keeps highlighted words and drops the marks for PDF and Word', () => {
        expect(sanitizeCompiledManuscriptForPdf('She ==walked home== and ==never== came back.')).toBe('She walked home and never came back.');
        expect(sanitizeCompiledManuscriptForPdf('==Opening words== of a line.')).toBe('Opening words of a line.');
        expect(sanitizeCompiledManuscriptForPdf('Keep ==**bold** inside== it.')).toBe('Keep **bold** inside it.');
    });

    it.each(['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'])('drops the %s color mark with the highlight', color => {
        expect(sanitizeCompiledManuscriptForPdf(`A ==${color}colored== word.`)).toBe('A colored word.');
    });

    it('leaves text that only looks like a highlight', () => {
        for (const text of ['If x == y == z then stop.', 'Type `==text==` to highlight.', 'A title\n=====\n\nThe body.', 'One ==unfinished mark.']) {
            expect(sanitizeCompiledManuscriptForPdf(text)).toBe(text);
        }
    });

    it('leaves highlight-like marks inside inline and display math', () => {
        for (const text of ['$a==b$ and $c==d$', 'Inline $$a==b$$ and $$c==d$$ here.', '$$\na==b\nc==d\n$$', 'Set $x==y$ here.']) {
            expect(sanitizeCompiledManuscriptForPdf(text)).toBe(text);
        }
        expect(sanitizeCompiledManuscriptForPdf('Paid $5 for ==this== and $6 for that.')).toBe('Paid $5 for this and $6 for that.');
        expect(sanitizeCompiledManuscriptForPdf('Where $x$ is ==the key== here.')).toBe('Where $x$ is the key here.');
    });

    it('leaves highlight marks inside code blocks', () => {
        const code = '```text\n==keep==\n```';
        expect(sanitizeCompiledManuscriptForPdf(code)).toBe(code);
    });

    it('keeps highlight marks for Markdown output', () => {
        expect(sanitizeCompiledManuscript('A ==word== here.')).toBe('A ==word== here.');
    });

    it('preserves markdown task-list boxes for regular manuscript cleanup', () => {
        const input = `- [ ] recently read`;
        const sanitized = sanitizeCompiledManuscript(input, {
            stripComments: false,
            stripLinks: false,
            stripCallouts: false,
            stripBlockIds: false
        });

        expect(sanitized).toBe('- [ ] recently read');
    });

    // `%%query:` is the current Editorialist marker; `%%ai:` is the legacy
    // spelling older manuscripts still carry. Both follow the same toggle.
    describe.each([
        ['%%query:', '%%query: Is this beat too abrupt?%%'],
        ['legacy %%ai:', '%%ai: Is this beat too abrupt?%%']
    ])('%s author queries', (_label, marker) => {
        it('survive the generic comment strip while stripAiComments is off', () => {
            const input = `Prose %%normal note%% and ${marker} end.`;
            const sanitized = sanitizeCompiledManuscript(input, {
                stripComments: true,
                stripAiComments: false,
                stripLinks: false,
                stripCallouts: false,
                stripBlockIds: false
            });

            expect(sanitized).toBe(`Prose  and ${marker} end.`);
        });

        it('are removed when stripAiComments is on', () => {
            const input = `Prose ${marker} end.`;

            expect(sanitizeCompiledManuscript(input, { stripAiComments: true })).toBe('Prose  end.');
            expect(sanitizeCompiledManuscript(input, { stripComments: true, stripAiComments: true })).toBe('Prose  end.');
        });

        it('leave ordinary comments alone when only stripAiComments is on', () => {
            const input = `Prose ${marker} mid %%draft note%% end.`;

            expect(sanitizeCompiledManuscript(input, { stripAiComments: true })).toBe('Prose  mid %%draft note%% end.');
        });

        it('keep prose between a query and a later comment', () => {
            // The closing `%%` of the query must not pair with the opener of
            // the next comment: that swallowed the prose between them.
            const input = `Prose ${marker} mid %%draft note%% end.`;

            expect(sanitizeCompiledManuscript(input, { stripComments: true })).toBe(`Prose ${marker} mid  end.`);
        });

        it('keep prose between a query and a comment scenes later under the PDF defaults', () => {
            const input = `Scene one ${marker} ends.\n\nScene two prose.\n\nScene three %%draft note%% ends.`;
            const pdfDefaults = getDefaultManuscriptCleanupOptions('pdf');

            expect(sanitizeCompiledManuscript(input, pdfDefaults))
                .toBe('Scene one  ends.\n\nScene two prose.\n\nScene three  ends.');
        });
    });

    it('matches author queries case-insensitively and with surrounding whitespace', () => {
        for (const input of ['A %% QUERY : keep? %% B', 'A %% AI : keep? %% B']) {
            const stripped = sanitizeCompiledManuscript(input, { stripAiComments: true });
            expect(stripped).toBe('A  B');

            // The generic comment strip must spare it as an author query.
            const kept = sanitizeCompiledManuscript(input, { stripComments: true });
            expect(kept).toBe(input);
        }
    });

    it('treats comments that only mention a query as ordinary comments', () => {
        const input = 'A %%queryless note%% B %%aim: later%% C';

        expect(sanitizeCompiledManuscript(input, { stripComments: true })).toBe('A  B  C');
        expect(sanitizeCompiledManuscript(input, { stripAiComments: true })).toBe(input);
    });
});

describe('protected-segment masking (raw LaTeX / code / math survive opt-in strippers)', () => {
    const ALL_STRIPPERS = {
        stripComments: true,
        stripAiComments: true,
        stripLinks: true,
        stripCallouts: true,
        stripBlockIds: true
    };

    it('preserves %% and [..](..) patterns inside a raw LaTeX environment', () => {
        const input = `Prose with a [link](https://example.com) and a %%comment%%.

\\begin{verbatim}
Keep this literal: %%not a comment%% and [not](a-link)
\\end{verbatim}

More prose %%gone%%.`;

        const out = sanitizeCompiledManuscript(input, ALL_STRIPPERS);
        expect(out).toContain('Prose with a link and a .');
        expect(out).toContain('%%not a comment%%');
        expect(out).toContain('[not](a-link)');
        expect(out).not.toContain('%%gone%%');
    });

    it('handles nested same-name LaTeX environments', () => {
        const input = `\\begin{quote}
outer %%keep%%
\\begin{quote}
inner [keep](me)
\\end{quote}
tail %%keep too%%
\\end{quote}

outside %%strip me%%`;

        const out = sanitizeCompiledManuscript(input, ALL_STRIPPERS);
        expect(out).toContain('outer %%keep%%');
        expect(out).toContain('inner [keep](me)');
        expect(out).toContain('tail %%keep too%%');
        expect(out).not.toContain('strip me');
    });

    it('preserves fenced code and display math from strippers and task-marker removal', () => {
        const input = `- [ ] real task marker outside

\`\`\`text
- [ ] keep this literal task syntax
a %%literal%% and ^blockid
\`\`\`

$$
f[x](y) = %%math%%
$$`;

        const out = sanitizeCompiledManuscriptForPdf(input, ALL_STRIPPERS);
        expect(out).toContain('- real task marker outside');
        expect(out).toContain('- [ ] keep this literal task syntax');
        expect(out).toContain('a %%literal%% and ^blockid');
        expect(out).toContain('f[x](y) = %%math%%');
    });

    it('leaves unclosed environments untouched rather than swallowing the document', () => {
        const input = `\\begin{quote}
never closed %%stays because unclosed envs pass through line by line%%

after %%stripped%%`;

        const out = sanitizeCompiledManuscript(input, ALL_STRIPPERS);
        expect(out).toContain('\\begin{quote}');
        expect(out).not.toContain('%%stripped%%');
    });

    it('inline LaTeX commands in prose are untouched by all strippers', () => {
        const input = 'He left.\\newpage And \\vspace{2em} continued %%note%%.';
        const out = sanitizeCompiledManuscript(input, ALL_STRIPPERS);
        expect(out).toContain('\\newpage');
        expect(out).toContain('\\vspace{2em}');
        expect(out).not.toContain('%%note%%');
    });
});

describe('countManuscriptComments', () => {
    const scene = [
        'She opens the hatch. %%query: Is this too slow?%%',
        '%%ai: Older question spelling%%',
        'A private note %%check the tide tables%% sits here.',
        '<!-- html note -->',
        '```',
        '%%inside a code block%%',
        '```',
    ].join('\n');

    it('separates author queries from private notes and skips code', () => {
        expect(countManuscriptComments(scene)).toEqual({ authorQueries: 2, privateNotes: 2 });
    });

    it('agrees with what the strippers remove', () => {
        const notesStripped = sanitizeCompiledManuscript(scene, { stripComments: true });
        expect(countManuscriptComments(notesStripped)).toEqual({ authorQueries: 2, privateNotes: 0 });
        const queriesStripped = sanitizeCompiledManuscript(scene, { stripAiComments: true });
        expect(countManuscriptComments(queriesStripped)).toEqual({ authorQueries: 0, privateNotes: 2 });
    });
});
