import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { assembleManuscript } from './manuscript';
import { getManuscriptLayoutExportBehavior } from './manuscriptLayoutExport';

function makeVault(contents: Record<string, string>): Vault {
    return {
        read: async (file: TFile) => contents[file.path] || ''
    } as unknown as Vault;
}

describe('assembleManuscript scene heading formatting', () => {
    it('renders title-only scene headings when requested', async () => {
        const file = makeFile('Scenes/10 Opening Beat.md', '10 Opening Beat');
        const vault = makeVault({
            [file.path]: '---\nClass: Scene\n---\n\nBody text.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { sceneHeadingMode: 'title-only' }
        );

        expect(assembled.text).toContain('## Opening Beat');
        expect(assembled.text).not.toContain('## 10 Opening Beat');
    });

    it('renders scene-number-only headings when requested', async () => {
        const file = makeFile('Scenes/22 Break-in.md', '22 Break-in');
        const vault = makeVault({
            [file.path]: 'Action.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { sceneHeadingMode: 'scene-number' }
        );

        expect(assembled.text).toContain('## 22');
        expect(assembled.text).not.toContain('## 22 Break-in');
    });

    it('uses raw LaTeX section openers for latex-section render mode', async () => {
        const file = makeFile('Scenes/3 Arrival.md', '3 Arrival');
        const vault = makeVault({
            [file.path]: 'Paragraph.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number-title',
                sceneHeadingRenderMode: 'latex-section-starred'
            }
        );

        // Assembler's contract surface is \rtSceneOpener{HEADING} — the
        // layout's .tex defines the macro to handle page break + chrome
        // suppression + centered typography. (Previous \section*{} form
        // could not be intercepted by \preto\section.)
        // Tight upright sub-title in parens (no italics, minimal vertical leading).
        expect(assembled.text).toContain('\\rtSceneOpener{3\\\\{\\normalsize (Arrival)}}');
        expect(assembled.text).toContain('\\rtSetSceneRunningTitle{Arrival}');
        expect(assembled.text).not.toContain('## 3 Arrival');
        expect(assembled.text).not.toContain('\\section*{');
    });

    it('can render Standard Manuscript scene opener pages as number-only raw LaTeX', async () => {
        const file = makeFile('Scenes/1 Training at Academy Field.md', '1 Training at Academy Field');
        const vault = makeVault({
            [file.path]: 'First paragraph.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number',
                sceneHeadingRenderMode: 'latex-section-starred'
            }
        );

        expect(assembled.text).toContain('\\rtSceneOpener{1}\n\\rtSetSceneRunningTitle{Training at Academy Field}');
        expect(assembled.text).not.toContain('\\providecommand{\\rtSetSceneRunningTitle}');
        expect(assembled.text).not.toContain('\\section*{');
        expect(assembled.text).toContain('First paragraph.');
        expect(assembled.text).not.toContain('\\rtSceneOpener{Training at Academy Field}');
        expect(assembled.text).not.toContain('## 1');
    });

    it('uses frontmatter Title for running headers when the scene filename is number-only', async () => {
        const file = makeFile('Scenes/1.md', '1');
        const vault = makeVault({
            [file.path]: '---\nClass: Scene\nTitle: Training at Academy Field\n---\n\nFirst paragraph.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number',
                sceneHeadingRenderMode: 'latex-section-starred'
            }
        );

        expect(assembled.text).toContain('\\rtSceneOpener{1}');
        expect(assembled.text).toContain('\\rtSetSceneRunningTitle{Training at Academy Field}');
        expect(assembled.text).not.toContain('\\rtSetSceneRunningTitle{1}');
    });

    it('omits chapter marker headings when chapter markers are not passed to assembly', async () => {
        const file = makeFile('Scenes/1 Training at Academy Field.md', '1 Training at Academy Field');
        const vault = makeVault({
            [file.path]: 'First paragraph.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number',
                sceneHeadingRenderMode: 'latex-section-starred',
                chapterMarkersByScenePath: {}
            }
        );

        expect(assembled.text).not.toContain('# Shail + Trisan');
        expect(assembled.text).not.toContain('\\rtSceneOpener{Shail + Trisan}');
        expect(assembled.text).toContain('\\rtSceneOpener{1}');
    });

    it('resets latex scene running marks after chapter opener pages', async () => {
        const file = makeFile('Scenes/1 Training at Academy Field.md', '1 Training at Academy Field');
        const vault = makeVault({
            [file.path]: 'First paragraph.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number',
                sceneHeadingRenderMode: 'latex-section-starred',
                chapterMarkersByScenePath: {
                    [file.path]: [{
                        sourcePath: 'Chapters/Chapter 1.md',
                        sourceType: 'Scene',
                        title: 'Chapter 1',
                        resolvedScenePath: file.path,
                        resolvedTimelinePosition: 1,
                    }]
                }
            }
        );

        const chapterIndex = assembled.text.indexOf('# Chapter 1');
        const sceneIndex = assembled.text.indexOf('\\rtSceneOpener{1}');
        const markIndex = assembled.text.indexOf('\\rtSetSceneRunningTitle{Training at Academy Field}');
        const bodyIndex = assembled.text.indexOf('First paragraph.');
        expect(chapterIndex).toBeGreaterThanOrEqual(0);
        expect(sceneIndex).toBeGreaterThan(chapterIndex);
        expect(markIndex).toBeGreaterThan(sceneIndex);
        expect(bodyIndex).toBeGreaterThan(markIndex);
    });

    it('injects scene Chapter field headings before scene content and suppresses scene headings in Modern Classic mode', async () => {
        // Scenes self-declare their Act via the canonical `Act:` frontmatter
        // field — the same source the timeline ring uses. Modern Classic emits
        // \rtPart at every Part marker, which here is scene1 and scene3
        // (Act 1) → scene3 (Act 2). No beat indirection.
        const scene1 = makeFile('Scenes/1 Opening.md', '1 Opening');
        const scene2 = makeFile('Scenes/2 Midpoint.md', '2 Midpoint');
        const scene3 = makeFile('Scenes/3 Turn.md', '3 Turn');
        const vault = makeVault({
            [scene1.path]: '---\nClass: Scene\nPart: true\n---\n\nFirst body.',
            [scene2.path]: '---\nClass: Scene\n---\n\nSecond body.',
            [scene3.path]: '---\nClass: Scene\nPart: true\n---\n\nThird body.'
        });

        const assembled = await assembleManuscript(
            [scene1, scene2, scene3],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number-title',
                sceneHeadingRenderMode: 'markdown-h2',
                chapterMarkersByScenePath: {
                    [scene1.path]: [{
                        sourcePath: scene1.path,
                        sourceType: 'Scene',
                        title: 'Boy with a Skull',
                        resolvedScenePath: scene1.path,
                        resolvedTimelinePosition: 1,
                    }],
                    [scene3.path]: [{
                        sourcePath: scene3.path,
                        sourceType: 'Scene',
                        title: 'Everything of Possibility.',
                        resolvedScenePath: scene3.path,
                        resolvedTimelinePosition: 3,
                    }]
                },
                modernClassicStructure: {
                    enabled: true,
                    partEpigraphs: [
                        'The beginning of all things.',
                        'When we are strongest — who draws back?\nMost merry — who falls down laughing?\nWhen we are very bad, what can they do to us?',
                    ],
                    partEpigraphAttributions: ['Anonymous', 'The Narrator'],
                }
            }
        );

        expect(assembled.text).toContain('\\rtPart{I}{}{The beginning of all things.}{Anonymous}');
        // Empty title slot — Parts are Act-derived here, and an Act has no name.
        const expectedActTwoEpigraph = String.raw`\rtPart{II}{}{When we are strongest — who draws back?\\
Most merry — who falls down laughing?\\
When we are very bad, what can they do to us?}{The Narrator}`;
        expect(assembled.text).toContain(expectedActTwoEpigraph);
        expect(assembled.text).not.toContain('\\rtEpigraph');
        expect(assembled.text).toContain('\\rtChapter{1}{Boy with a Skull}');
        expect(assembled.text).toContain('\\rtChapter{2}{Everything of Possibility.}');
        expect(assembled.text).toContain('\\rtSceneSep{i}');
        expect(assembled.text).toContain('\\rtSceneSep{ii}');
        const sceneSepArgs = Array.from(assembled.text.matchAll(/\\rtSceneSep\{([^}]+)\}/g)).map(match => match[1]);
        expect(sceneSepArgs).toEqual(['i', 'ii', 'i']);

        const partOneIndex = assembled.text.indexOf('\\rtPart{I}{}{The beginning of all things.}{Anonymous}');
        const partTwoIndex = assembled.text.indexOf(expectedActTwoEpigraph);
        const chapterTwoIndex = assembled.text.indexOf('\\rtChapter{2}{Everything of Possibility.}');
        expect(partOneIndex).toBeGreaterThanOrEqual(0);
        expect(partTwoIndex).toBeGreaterThanOrEqual(0);
        expect(chapterTwoIndex).toBeGreaterThan(partTwoIndex);

        const sceneSepCount = (assembled.text.match(/\\rtSceneSep/g) || []).length;
        expect(sceneSepCount).toBe(3);

        const emittedRtMacros = Array.from(new Set(
            Array.from(assembled.text.matchAll(/\\(rt[A-Za-z]+)/g)).map(match => match[1])
        )).sort();
        expect(emittedRtMacros).toEqual([
            'rtChapter',
            'rtPart',
            'rtSceneSep',
        ]);

        expect(assembled.text).not.toContain('## 1 Opening');
        expect(assembled.text).not.toContain('## 2 Midpoint');
        expect(assembled.text).not.toContain('## 3 Turn');
        expect(assembled.text).toContain('First body.');
        expect(assembled.text).toContain('Second body.');
        expect(assembled.text).toContain('Third body.');
    });

    it('drops chapter markers and never emits \\rtPart for Signature Literary, even when scene rows carry chapter fields and act metadata', async () => {
        // Reproduces the user-reported leak: exporting Signature Literary
        // with chapter-field markers + act assignments produced a phantom
        // Part-Roman "I" and "Chapter 1" stack on the first scene page. The
        // export pipeline must (a) ask the layout-behavior table for
        // suppression flags, then (b) drop chapter markers BEFORE handing
        // them to assembleManuscript, and (c) never invoke the
        // Modern-Classic structure path that would emit \rtPart{...}.
        const layoutBehavior = getManuscriptLayoutExportBehavior({
            id: 'bundled-fiction-signature-literary',
            name: 'Signature Literary',
            path: 'rt_signature_literary.tex',
        });
        expect(layoutBehavior.suppressChapterMarkers).toBe(true);
        expect(layoutBehavior.suppressPartMarkers).toBe(true);

        const scene1 = makeFile('Scenes/1 Opening.md', '1 Opening');
        const scene2 = makeFile('Scenes/2 Midpoint.md', '2 Midpoint');
        const vault = makeVault({
            [scene1.path]: '---\nClass: Scene\nPart: true\n---\n\nFirst body.',
            [scene2.path]: '---\nClass: Scene\n---\n\nSecond body.'
        });

        // Mirror CommandRegistrar's wiring: when a layout suppresses chapter
        // markers, the registrar passes an empty chapter-marker map to
        // assembleManuscript. Signature Literary does not opt into
        // usesModernClassicStructure so modernClassicStructure stays
        // undefined here (no \rtPart emission path).
        const inputChapterMarkers = layoutBehavior.suppressChapterMarkers
            ? {}
            : {
                [scene1.path]: [{
                    sourcePath: 'Chapters/Chapter 1.md',
                    sourceType: 'Scene' as const,
                    title: 'Chapter 1',
                    resolvedScenePath: scene1.path,
                    resolvedTimelinePosition: 1,
                }]
            };

        const assembled = await assembleManuscript(
            [scene1, scene2],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: layoutBehavior.defaultSceneHeadingMode ?? 'scene-number-title',
                sceneHeadingRenderMode: layoutBehavior.sceneHeadingRenderMode,
                chapterMarkersByScenePath: inputChapterMarkers,
            }
        );

        // No phantom Part page macro and no auto-Roman "I" trigger.
        expect(assembled.text).not.toContain('\\rtPart');
        expect(assembled.text).not.toContain('\\part{');
        // No chapter heading text - markdown chapter headings would be
        // promoted to \chapter{} (or worse, \part{}) by Pandoc under a book
        // class, producing the user-reported "Chapter 1" stack.
        expect(assembled.text).not.toContain('# Chapter 1');
        expect(assembled.text).not.toContain('\\chapter{');
        // Scene-only typography survives — the contract surface is \rtSceneOpener.
        expect(assembled.text).toContain('\\rtSceneOpener{');
        expect(assembled.text).toContain('First body.');
        expect(assembled.text).toContain('Second body.');
    });

    it('suppresses headers and footers across matter runs when enabled', async () => {
        const matter = makeFile('Matter/0.1 Title Page.md', '0.1 Title Page');
        const scene = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [matter.path]: '---\nClass: Frontmatter\nRole: title-page\nBodyMode: plain\n---\n\nMatter body.',
            [scene.path]: 'Scene body.'
        });

        const assembled = await assembleManuscript(
            [matter, scene],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number-title',
                sceneHeadingRenderMode: 'markdown-h2',
                suppressMatterPageChrome: true
            }
        );

        expect(assembled.text).toContain('\\clearpage\\pagestyle{empty}\\thispagestyle{empty}');
        expect(assembled.text).toContain('\\clearpage\\pagestyle{fancy}');
        expect(assembled.text).toContain('Matter body.');
        expect(assembled.text).toContain('Scene body.');
    });

    it('starts each latex matter note on a new empty page when matter chrome is enabled', async () => {
        const acknowledgments = makeFile('Matter/200.1 Acknowledgments.md', '200.1 Acknowledgments');
        const aboutAuthor = makeFile('Matter/200.2 About the Author.md', '200.2 About the Author');
        const vault = makeVault({
            [acknowledgments.path]: '---\nClass: Backmatter\nBodyMode: latex\n---\n\n\\vspace*{4cm}\n\nAcknowledgments body.',
            [aboutAuthor.path]: '---\nClass: Backmatter\nBodyMode: latex\n---\n\n\\vspace*{4cm}\n\nAbout author body.',
        });

        const assembled = await assembleManuscript(
            [acknowledgments, aboutAuthor],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number-title',
                sceneHeadingRenderMode: 'latex-section-starred',
                suppressMatterPageChrome: true
            }
        );

        expect(assembled.text).toContain('\\clearpage\\pagestyle{empty}\\thispagestyle{empty}');
        expect(assembled.text).toContain('\\clearpage\\thispagestyle{empty}');
        expect(assembled.text.indexOf('Acknowledgments body.')).toBeLessThan(assembled.text.indexOf('\\clearpage\\thispagestyle{empty}'));
        expect(assembled.text.indexOf('\\clearpage\\thispagestyle{empty}')).toBeLessThan(assembled.text.indexOf('About author body.'));
    });

    it('keeps standard manuscript-style assembly on the existing $body$ path', async () => {
        const file = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [file.path]: 'First paragraph.\n\nSecond paragraph.'
        });

        const assembled = await assembleManuscript(
            [file],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            {
                sceneHeadingMode: 'scene-number-title',
                sceneHeadingRenderMode: 'markdown-h2'
            }
        );

        expect(assembled.text).toBe('## 1 Opening\n\nFirst paragraph.\n\nSecond paragraph.\n\n');
        expect(assembled.totalScenes).toBe(1);
        expect(assembled.scenes[0]).toMatchObject({
            title: '1 Opening',
            bodyText: 'First paragraph.\n\nSecond paragraph.',
        });
    });
});

describe('assembleManuscript SceneId surfacing', () => {
    it('appends SceneId to each TOC entry when includeSceneIdInToc is on', async () => {
        const a = makeFile('Scenes/1 Opening.md', '1 Opening');
        const b = makeFile('Scenes/2 Hallway.md', '2 Hallway');
        const c = makeFile('Scenes/3 Therapist.md', '3 Therapist');
        const vault = makeVault({
            [a.path]: '---\nClass: Scene\nSceneId: scn_a1b2c3\n---\n\nA body.',
            [b.path]: '---\nClass: Scene\nSceneId: scn_d4e5f6\n---\n\nB body.',
            [c.path]: '---\nClass: Scene\n---\n\nC body.', // no SceneId
        });

        const assembled = await assembleManuscript(
            [a, b, c],
            vault,
            undefined,
            false, // useObsidianLinks → plain text TOC
            undefined,
            true, // includeToc
            undefined,
            undefined,
            { includeSceneIdInToc: true }
        );

        expect(assembled.text).toContain('# TABLE OF CONTENTS');
        expect(assembled.text).toMatch(/1\.\s.*\(\d+ words\)\s+`scn_a1b2c3`/);
        expect(assembled.text).toMatch(/2\.\s.*\(\d+ words\)\s+`scn_d4e5f6`/);
        expect(assembled.text).toMatch(/3\.\s.*\(\d+ words\)\s+`\(no SceneId\)`/);
    });

    it('omits SceneId from TOC when includeSceneIdInToc is off', async () => {
        const a = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [a.path]: '---\nClass: Scene\nSceneId: scn_a1b2c3\n---\n\nBody.',
        });

        const assembled = await assembleManuscript(
            [a],
            vault,
            undefined,
            false,
            undefined,
            true,
            undefined,
            undefined,
            { includeSceneIdInToc: false }
        );

        // Backtick-wrapped SceneId is only emitted by the TOC formatter.
        // (extractBodyText leaves raw frontmatter inside the body, so a bare-string assertion
        // would false-positive on the literal "SceneId: scn_..." line.)
        expect(assembled.text).not.toContain('`scn_a1b2c3`');
    });

    it('appends SceneId to scene heading body when includeSceneIdInHeading is on', async () => {
        const a = makeFile('Scenes/6 Trisan Therapist.md', '6 Trisan Therapist');
        const vault = makeVault({
            [a.path]: '---\nClass: Scene\nSceneId: scn_xyz789\n---\n\nScene body.',
        });

        const assembled = await assembleManuscript(
            [a],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { includeSceneIdInHeading: true }
        );

        expect(assembled.text).toContain('## 6 Trisan Therapist `scn_xyz789`');
    });

    it('can append plain SceneId text for Pandoc PDF headings', async () => {
        const a = makeFile('Scenes/6 Trisan Therapist.md', '6 Trisan Therapist');
        const vault = makeVault({
            [a.path]: '---\nClass: Scene\nSceneId: scn_xyz789\n---\n\nScene body.',
        });

        const assembled = await assembleManuscript(
            [a],
            vault,
            undefined,
            false,
            undefined,
            true,
            undefined,
            undefined,
            { includeSceneIdInToc: true, includeSceneIdInHeading: true, sceneIdFormat: 'plain' }
        );

        expect(assembled.text).toContain('## 6 Trisan Therapist scn_xyz789');
        expect(assembled.text).toMatch(/1\.\s.*\(\d+ words\)\s+scn_xyz789/);
        expect(assembled.text).not.toContain('`scn_xyz789`');
    });

    it('does not append SceneId to scene heading when missing from frontmatter', async () => {
        const a = makeFile('Scenes/6 Trisan Therapist.md', '6 Trisan Therapist');
        const vault = makeVault({
            [a.path]: '---\nClass: Scene\n---\n\nBody.',
        });

        const assembled = await assembleManuscript(
            [a],
            vault,
            undefined,
            false,
            undefined,
            false,
            undefined,
            undefined,
            { includeSceneIdInHeading: true }
        );

        // No backtick suffix when SceneId is absent.
        expect(assembled.text).toContain('## 6 Trisan Therapist\n');
        expect(assembled.text).not.toMatch(/Therapist\s+`/);
    });

    it('keeps SceneIds in TOC out of scene body headings by default', async () => {
        const a = makeFile('Scenes/1 Opening.md', '1 Opening');
        const vault = makeVault({
            [a.path]: '---\nClass: Scene\nSceneId: scn_a1b2c3\n---\n\nBody.',
        });

        const assembled = await assembleManuscript(
            [a],
            vault,
            undefined,
            false,
            undefined,
            true,
            undefined,
            undefined,
            { includeSceneIdInToc: true /* heading default off */ }
        );

        expect(assembled.text).toContain('`scn_a1b2c3`'); // in TOC
        expect(assembled.text).toContain('## 1 Opening\n'); // heading clean
    });
});
