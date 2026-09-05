/*
 * Resolver-driven matter assembly tests.
 *
 * Verifies that `assembleManuscript` consults `resolveBookPages` /
 * `applyBookPageOrder` to drive matter ordering and dedup, replacing the
 * earlier independent matter-walks vs. BookMeta-walks paths.
 *
 * Semantic assertions only (count of pages, presence/absence of role
 * markers, ordering via marker-then-marker regex). No byte-equal snapshots.
 */

import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import type { BookMeta } from '../types';
import { assembleManuscript } from './manuscript';

function makeVault(contents: Record<string, string>): Vault {
    return {
        read: async (file: TFile) => contents[file.path] || ''
    } as unknown as Vault;
}

const NOTE_DEDICATION_BODY = 'NOTE-DEDICATION-BODY-MARKER';
const NOTE_TITLE_PAGE_BODY = 'NOTE-TITLE-PAGE-BODY-MARKER';
const SCENE_BODY = 'SCENE-BODY-MARKER';
const ALPHA_READERS_BODY = 'ALPHA-READERS-BODY-MARKER';
const TITLE_2_BODY = 'TITLE-2-BODY-MARKER';
const ACK_BODY = 'ACKNOWLEDGMENTS-BODY-MARKER';

describe('assembleManuscript: resolver-driven matter assembly', () => {
    it('does not duplicate when both note and BookMeta define the same role (note wins)', async () => {
        const dedicationNote = makeFile('Book/0.4 Dedication.md', '0.4 Dedication');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [dedicationNote.path]: `---\nClass: Frontmatter\nRole: dedication\nBodyMode: plain\n---\n\n${NOTE_DEDICATION_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'My Book',
            rights: { copyright_holder: 'Author', year: 2026 },
            frontmatter: { dedication: 'BOOKMETA-DEDICATION-PROSE' },
            backmatter: {},
        };

        const assembled = await assembleManuscript(
            [dedicationNote, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        // The note's body must be present.
        expect(assembled.text).toContain(NOTE_DEDICATION_BODY);
        // The BookMeta-derived dedication must NOT also be emitted (no duplicate).
        expect(assembled.text).not.toContain('BOOKMETA-DEDICATION-PROSE');
    });

    it('emits a BookMeta-only role when no overriding note exists', async () => {
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'My Book',
            rights: { copyright_holder: 'Author', year: 2026 },
            frontmatter: {
                dedication: 'BOOKMETA-DEDICATION-FOR-EMILY',
            },
            backmatter: {
                acknowledgments: 'BOOKMETA-ACK-BLOCK'
            },
        };

        const assembled = await assembleManuscript(
            [scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        // BookMeta-derived dedication appears (this used to be silently dropped).
        expect(assembled.text).toContain('BOOKMETA-DEDICATION-FOR-EMILY');
        // BookMeta-derived acknowledgments appear in backmatter.
        expect(assembled.text).toContain('BOOKMETA-ACK-BLOCK');
        // Scene body still emits.
        expect(assembled.text).toContain(SCENE_BODY);
    });

    it('suppresses physical and BookMeta-only matter pages when matter pages are disabled', async () => {
        const titlePage = makeFile('Book/0.2 Title Page.md', '0.2 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const acknowledgments = makeFile('Book/200.1 Acknowledgments.md', '200.1 Acknowledgments');
        const vault = makeVault({
            [titlePage.path]: `---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\n${NOTE_TITLE_PAGE_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
            [acknowledgments.path]: `---\nClass: Backmatter\nRole: acknowledgments\nBodyMode: plain\n---\n\n${ACK_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'BOOKMETA-TITLE-PAGE-MARKER',
            rights: { copyright_holder: 'BOOKMETA-COPYRIGHT-MARKER', year: 2026 },
            frontmatter: { dedication: 'BOOKMETA-DEDICATION-MARKER' },
            backmatter: { acknowledgments: 'BOOKMETA-ACK-MARKER' },
        };

        const assembled = await assembleManuscript(
            [titlePage, scene, acknowledgments],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2', includeMatterPages: false }
        );

        expect(assembled.text).toContain(SCENE_BODY);
        expect(assembled.text).not.toContain(NOTE_TITLE_PAGE_BODY);
        expect(assembled.text).not.toContain(ACK_BODY);
        expect(assembled.text).not.toContain('BOOKMETA-TITLE-PAGE-MARKER');
        expect(assembled.text).not.toContain('BOOKMETA-COPYRIGHT-MARKER');
        expect(assembled.text).not.toContain('BOOKMETA-DEDICATION-MARKER');
        expect(assembled.text).not.toContain('BOOKMETA-ACK-MARKER');
    });

    it('emits note-only roles (no BookMeta content for that role)', async () => {
        const titleNote = makeFile('Book/0.2 Title Page.md', '0.2 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [titleNote.path]: `---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\n${NOTE_TITLE_PAGE_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });
        // BookMeta has only a title field — title-page is generated from BookMeta
        // by default, but the note overrides.
        const bookMeta: BookMeta = {
            title: 'A Title',
            rights: { copyright_holder: 'Author', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };

        const assembled = await assembleManuscript(
            [titleNote, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        expect(assembled.text).toContain(NOTE_TITLE_PAGE_BODY);
    });

    it('preserves custom matter notes (no canonical role) in their numeric file order', async () => {
        const alpha = makeFile('Book/0.1 Alpha Readers.md', '0.1 Alpha Readers');
        const title2 = makeFile('Book/0.6 Title 2.md', '0.6 Title 2');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [alpha.path]: `---\nClass: Frontmatter\nBodyMode: plain\n---\n\n${ALPHA_READERS_BODY}`,
            [title2.path]: `---\nClass: Frontmatter\nBodyMode: plain\n---\n\n${TITLE_2_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });

        const assembled = await assembleManuscript(
            [alpha, title2, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        const alphaIndex = assembled.text.indexOf(ALPHA_READERS_BODY);
        const title2Index = assembled.text.indexOf(TITLE_2_BODY);
        const sceneIndex = assembled.text.indexOf(SCENE_BODY);
        expect(alphaIndex).toBeGreaterThan(-1);
        expect(title2Index).toBeGreaterThan(-1);
        expect(sceneIndex).toBeGreaterThan(-1);
        // Custom notes precede scenes (frontmatter side) and remain in input order.
        expect(alphaIndex).toBeLessThan(title2Index);
        expect(title2Index).toBeLessThan(sceneIndex);
    });

    it('honors bookPageOrder when populated (drag-reorder UI persists this)', async () => {
        const dedication = makeFile('Book/0.4 Dedication.md', '0.4 Dedication');
        const titlePage = makeFile('Book/0.2 Title Page.md', '0.2 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [titlePage.path]: `---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\n${NOTE_TITLE_PAGE_BODY}`,
            [dedication.path]: `---\nClass: Frontmatter\nRole: dedication\nBodyMode: plain\n---\n\n${NOTE_DEDICATION_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'X',
            rights: { copyright_holder: 'Y', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };

        // User has dragged Dedication BEFORE Title Page in the preview UI.
        const savedOrder = [
            `note:${dedication.path}`,
            `note:${titlePage.path}`,
        ];

        const assembled = await assembleManuscript(
            // Input order is title-page-first (canonical), but saved order overrides.
            [titlePage, dedication, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2', bookPageOrder: savedOrder }
        );

        const dedIndex = assembled.text.indexOf(NOTE_DEDICATION_BODY);
        const titleIndex = assembled.text.indexOf(NOTE_TITLE_PAGE_BODY);
        expect(dedIndex).toBeGreaterThan(-1);
        expect(titleIndex).toBeGreaterThan(-1);
        expect(dedIndex).toBeLessThan(titleIndex);
    });

    it('drops stale bookPageOrder entries silently and still emits a valid output', async () => {
        const titlePage = makeFile('Book/0.2 Title Page.md', '0.2 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [titlePage.path]: `---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\n${NOTE_TITLE_PAGE_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'X',
            rights: { copyright_holder: 'Y', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };

        // bookPageOrder references a deleted note + the still-present title page.
        const stale = [
            'note:Book/Deleted Page.md',          // gone
            'bookmeta:author-note',               // not authored anywhere
            `note:${titlePage.path}`,
        ];

        const assembled = await assembleManuscript(
            [titlePage, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2', bookPageOrder: stale }
        );

        // Stale references don't produce ghost content.
        expect(assembled.text).not.toContain('Deleted Page');
        // Title page note still emits.
        expect(assembled.text).toContain(NOTE_TITLE_PAGE_BODY);
        // Scene still emits.
        expect(assembled.text).toContain(SCENE_BODY);
    });

    it('frontmatter pages emit before scenes; backmatter pages emit after', async () => {
        const titlePage = makeFile('Book/0.2 Title Page.md', '0.2 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const acknowledgments = makeFile('Book/200.1 Acknowledgments.md', '200.1 Acknowledgments');
        const vault = makeVault({
            [titlePage.path]: `---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\n${NOTE_TITLE_PAGE_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
            [acknowledgments.path]: `---\nClass: Backmatter\nRole: acknowledgments\nBodyMode: plain\n---\n\n${ACK_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'X',
            rights: { copyright_holder: 'Y', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };

        const assembled = await assembleManuscript(
            [titlePage, scene, acknowledgments],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        const titleIndex = assembled.text.indexOf(NOTE_TITLE_PAGE_BODY);
        const sceneIndex = assembled.text.indexOf(SCENE_BODY);
        const ackIndex = assembled.text.indexOf(ACK_BODY);
        expect(titleIndex).toBeGreaterThan(-1);
        expect(sceneIndex).toBeGreaterThan(-1);
        expect(ackIndex).toBeGreaterThan(-1);
        expect(titleIndex).toBeLessThan(sceneIndex);
        expect(sceneIndex).toBeLessThan(ackIndex);
    });

    it('legacy notes with missing Role: still emit when filename inference fails (custom notes)', async () => {
        // A matter-classed note whose filename can't be inferred — the resolver
        // surfaces it as a custom note (role: null) and the assembler emits it.
        const quotation = makeFile('Book/0.7 Quotation.md', '0.7 Quotation');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [quotation.path]: '---\nClass: Frontmatter\nBodyMode: plain\n---\n\nQUOTATION-BODY-MARKER',
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });

        const assembled = await assembleManuscript(
            [quotation, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        expect(assembled.text).toContain('QUOTATION-BODY-MARKER');
        expect(assembled.text).toContain(SCENE_BODY);
        // Custom note appears before the scene (frontmatter side).
        expect(assembled.text.indexOf('QUOTATION-BODY-MARKER'))
            .toBeLessThan(assembled.text.indexOf(SCENE_BODY));
    });

    it('preserves hard line wraps inside LaTeX matter prose runs', async () => {
        const quotation = makeFile('Book/0.7 Quotation.md', '0.7 Quotation');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [quotation.path]: [
                '---',
                'Class: Frontmatter',
                'BodyMode: latex',
                '---',
                '',
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\normalsize',
                'Line one',
                'Line two',
                'Line three',
                '',
                '\\vspace{1cm}',
                '',
                '—Anonymous, \\textit{Some Lunatic Active}',
                '',
                '\\end{center}',
                '\\newpage',
            ].join('\n'),
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });

        const assembled = await assembleManuscript(
            [quotation, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        expect(assembled.text).toContain('Line one\\\\\nLine two\\\\\nLine three');
        expect(assembled.text).toContain('—Anonymous, \\textit{Some Lunatic Active}\n\n\\end{center}');
        expect(assembled.text).not.toContain('Class: Frontmatter');
        expect(assembled.text).not.toContain('BodyMode: latex');
        expect(assembled.text).not.toContain('---\\\\');
        expect(assembled.text).not.toContain('\\begin{center}\\\\');
        expect(assembled.text).not.toContain('\\vspace*{4cm}\\\\');
    });

    it('synthetic vault: title-page note + BookMeta with title content → output contains the NOTE body, not the BookMeta-generated title page', async () => {
        // Verification gate fixture from the spec.
        const titleNote = makeFile('Book/0.2 Title Page.md', '0.2 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [titleNote.path]: `---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\n${NOTE_TITLE_PAGE_BODY}`,
            [scene.path]: `---\nClass: Scene\n---\n\n${SCENE_BODY}`,
        });
        const bookMeta: BookMeta = {
            title: 'BOOKMETA-TITLE-STRING',
            author: 'BOOKMETA-AUTHOR-STRING',
            rights: { copyright_holder: 'Author', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };

        const assembled = await assembleManuscript(
            [titleNote, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            bookMeta,
            undefined,
            { sceneHeadingRenderMode: 'markdown-h2' }
        );

        // The note's body is present.
        expect(assembled.text).toContain(NOTE_TITLE_PAGE_BODY);
        // The BookMeta-generated title page (which would emit \Huge {title} block)
        // must NOT be appended — only the note rendering wins.
        expect(assembled.text).not.toContain('{\\Huge BOOKMETA-TITLE-STRING}');
        expect(assembled.text).not.toContain('{\\Large BOOKMETA-AUTHOR-STRING}');
    });
});
