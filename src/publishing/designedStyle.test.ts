import { describe, expect, it } from 'vitest';
import {
    DESIGNED_STYLE_SPEC_VERSION,
    type DesignArchetype,
    type DesignedStyleSpec,
    generateDesignedStyleTex,
    getVariantForArchetype,
} from './designedStyle';
import type { FictionLayoutVariant } from './layoutVisuals';

function buildSpec(overrides: Partial<DesignedStyleSpec> = {}): DesignedStyleSpec {
    const base: DesignedStyleSpec = {
        specVersion: DESIGNED_STYLE_SPEC_VERSION,
        archetype: 'submission',
        paperSize: 'us-trade-6x9',
        margins: { topIn: 1, bottomIn: 1, leftIn: 1, rightIn: 1, mirrored: false },
        body: {
            font: 'sorts-mill-goudy',
            fontFallbackChain: ['TeX Gyre Pagella', 'Times New Roman'],
            sizePt: 11,
            lineSpacing: 1.5,
            paragraphIndentEm: 1.5,
        },
        runningHeader: { mode: 'centered-title' },
        folio: { position: 'bottom-center' },
        parts: { mode: 'roman', pageBreak: true, epigraph: true },
        chapters: { mode: 'numbered-titled', pageBreak: true, resetSceneCounter: false },
        scene: {
            opener: 'inline-separator',
            headingMode: 'scene-number',
            suppressHeaderFooterOnOpener: true,
        },
        epigraph: { enabled: true, italic: true, attributionStyle: 'em-dash-caps' },
    };
    return { ...base, ...overrides };
}

describe('getVariantForArchetype', () => {
    const cases: Array<[DesignArchetype, FictionLayoutVariant]> = [
        ['submission', 'classic'],
        ['reading-draft', 'contemporary'],
        ['literary', 'signature'],
        ['structured', 'modernClassic'],
    ];
    for (const [archetype, expected] of cases) {
        it(`maps ${archetype} → ${expected}`, () => {
            expect(getVariantForArchetype(archetype)).toBe(expected);
        });
    }
});

describe('generateDesignedStyleTex', () => {
    it('returns a non-empty .tex string', () => {
        const tex = generateDesignedStyleTex(buildSpec());
        expect(tex.length).toBeGreaterThan(0);
    });

    it('includes core preamble packages', () => {
        const tex = generateDesignedStyleTex(buildSpec());
        expect(tex).toContain('\\documentclass');
        expect(tex).toContain('\\usepackage{geometry}');
        expect(tex).toContain('\\usepackage{fontspec}');
        expect(tex).toContain('\\usepackage{fancyhdr}');
    });

    it('includes the Pandoc body hook and document boundaries', () => {
        const tex = generateDesignedStyleTex(buildSpec());
        expect(tex).toContain('\\begin{document}');
        expect(tex).toContain('$body$');
        expect(tex).toContain('\\end{document}');
    });

    it('defines \\rtPart when parts.mode is not off', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            parts: { mode: 'roman', pageBreak: true, epigraph: true },
        }));
        expect(tex).toContain('\\newcommand{\\rtPart}[3]');
        expect(tex).toContain('\\rule{0.46in}{0.4pt}');
        expect(tex).not.toContain('PART~#1');
        expect(tex).not.toContain('\\newcommand{\\rtEpigraph}[2]');
    });

    it('does not define \\rtPart when parts.mode is off', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            parts: { mode: 'off', pageBreak: false, epigraph: false },
        }));
        expect(tex).not.toContain('\\newcommand{\\rtPart}');
    });

    it('defines \\rtChapter when chapters.mode is not off', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            chapters: { mode: 'numbered', pageBreak: true, resetSceneCounter: false },
        }));
        expect(tex).toContain('\\newcommand{\\rtChapter}');
    });

    it('does not define \\rtChapter when chapters.mode is off', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            chapters: { mode: 'off', pageBreak: false, resetSceneCounter: false },
        }));
        expect(tex).not.toContain('\\newcommand{\\rtChapter}');
    });

    it('defines \\rtSceneSep for the scene opener', () => {
        const tex = generateDesignedStyleTex(buildSpec());
        expect(tex).toContain('\\newcommand{\\rtSceneSep}');
    });

    it('honors us-trade-6x9 paper size', () => {
        const tex = generateDesignedStyleTex(buildSpec({ paperSize: 'us-trade-6x9' }));
        expect(tex).toContain('paperwidth=6in');
        expect(tex).toContain('paperheight=9in');
    });

    it('honors us-letter paper size', () => {
        const tex = generateDesignedStyleTex(buildSpec({ paperSize: 'us-letter' }));
        expect(tex).toContain('paperwidth=8.5in');
        expect(tex).toContain('paperheight=11in');
    });

    it('honors a4 paper size', () => {
        const tex = generateDesignedStyleTex(buildSpec({ paperSize: 'a4' }));
        expect(tex).toContain('paperwidth=210mm');
        expect(tex).toContain('paperheight=297mm');
    });

    it('honors a custom paper size', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            paperSize: { widthIn: 5.5, heightIn: 8.5 },
        }));
        expect(tex).toContain('paperwidth=5.5in');
        expect(tex).toContain('paperheight=8.5in');
    });

    it('emits inner/outer margin keys when mirrored is true and twoside class option', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            margins: { topIn: 1, bottomIn: 1, leftIn: 1.2, rightIn: 0.8, mirrored: true },
        }));
        expect(tex).toContain('inner=1.2in');
        expect(tex).toContain('outer=0.8in');
        expect(tex).toContain('twoside');
    });

    it('emits left/right margin keys and oneside when mirrored is false', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            margins: { topIn: 1, bottomIn: 1, leftIn: 1.2, rightIn: 0.8, mirrored: false },
        }));
        expect(tex).toContain('left=1.2in');
        expect(tex).toContain('right=0.8in');
        expect(tex).toContain('oneside');
    });

    it('emits \\thispagestyle{empty} on the scene opener when suppression is on', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            scene: {
                opener: 'dedicated-page',
                headingMode: 'scene-number',
                suppressHeaderFooterOnOpener: true,
            },
        }));
        expect(tex).toContain('\\thispagestyle{empty}');
    });

    // Font emit policy:
    //   1. If `vaultFontDir/<slug>/` has the required files → emit a Path-based block
    //   2. Otherwise → emit a plain `\setmainfont{Name}` and let XeLaTeX find it
    // No `\PackageError{rt-font}`. No `\IfFontExistsTF` guard. No fallback chain.
    // The font registry in fontResolver.ts is the single source of truth.

    it('emits plain \\setmainfont when no vault font directory is supplied (Sorts Mill Goudy)', () => {
        const tex = generateDesignedStyleTex(buildSpec());
        expect(tex).toContain('\\setmainfont{Sorts Mill Goudy}');
        // No legacy strict-policy artifacts.
        expect(tex).not.toContain('\\PackageError{rt-font}');
        expect(tex).not.toContain('\\IfFontExistsTF');
        // No fallback chain leakage.
        expect(tex).not.toContain('TeX Gyre Pagella');
        expect(tex).not.toContain('Times New Roman');
        expect(tex).not.toContain('Arial');
    });

    it('emits plain \\setmainfont for system fonts without fallback chain', () => {
        const tex = generateDesignedStyleTex(buildSpec({
            body: {
                font: 'eb-garamond',
                fontFallbackChain: ['Charter', 'Georgia', 'Times New Roman', 'Arial'],
                sizePt: 11,
                lineSpacing: 1.5,
                paragraphIndentEm: 1.5,
            },
        }));
        // Single \setmainfont emit, no IfFontExistsTF wrapper, no fallback chain.
        expect(tex).toContain('\\setmainfont{EB Garamond}');
        expect(tex).not.toContain('\\IfFontExistsTF');
        expect(tex).not.toContain('\\PackageError{rt-font}');
        expect(tex).not.toContain('Charter');
        expect(tex).not.toContain('Georgia');
        expect(tex).not.toContain('\\setmainfont{Times');
        expect(tex).not.toContain('\\setmainfont{Arial');
    });

    it('emits a Path-based block when vaultFontDir contains the spec font (Source Serif 4)', () => {
        // Synthetic vault: write the four required Source Serif files into a temp dir
        // so vaultDirHasFont() returns true and the emit takes the Path branch.
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const os = require('os') as typeof import('os');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-font-vault-'));
        const dir = path.join(root, 'source-serif-4');
        fs.mkdirSync(dir, { recursive: true });
        for (const f of ['SourceSerif4-Regular.otf', 'SourceSerif4-It.otf', 'SourceSerif4-Bold.otf', 'SourceSerif4-BoldIt.otf']) {
            fs.writeFileSync(path.join(dir, f), '');
        }
        try {
            const tex = generateDesignedStyleTex(buildSpec({
                body: {
                    font: 'source-serif',
                    fontFallbackChain: [],
                    sizePt: 11,
                    lineSpacing: 1.5,
                    paragraphIndentEm: 1.5,
                },
            }), { vaultFontDir: root });

            expect(tex).toContain('\\setmainfont{Source Serif 4}[');
            expect(tex).toContain(`Path = ${root}/source-serif-4/`);
            expect(tex).toContain('UprightFont = SourceSerif4-Regular.otf');
            expect(tex).toContain('BoldItalicFont = SourceSerif4-BoldIt.otf');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('falls back to plain \\setmainfont when vaultFontDir is supplied but the font files are missing', () => {
        // vaultFontDir points at an empty temp dir → resolver detects missing files
        // and emits the system-name block instead of the Path block.
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const os = require('os') as typeof import('os');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-font-vault-empty-'));
        try {
            const tex = generateDesignedStyleTex(buildSpec({
                body: {
                    font: 'latin-modern',
                    fontFallbackChain: [],
                    sizePt: 11,
                    lineSpacing: 1.5,
                    paragraphIndentEm: 1.5,
                },
            }), { vaultFontDir: root });

            // Latin Modern resolves from the TeX distribution by filename;
            // the family-name form does not resolve on a stock TeX install
            // (GH #34, PDF half).
            expect(tex).toContain('\\setmainfont{lmroman10-regular.otf}');
            expect(tex).not.toContain('\\setmainfont{Latin Modern Roman}');
            expect(tex).not.toContain('Path = ');
            expect(tex).not.toContain('\\PackageError{rt-font}');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    describe('archetype smoke specs', () => {
        const archetypes: Array<{ archetype: DesignArchetype; variant: FictionLayoutVariant; structuralMarker: string }> = [
            { archetype: 'submission',    variant: 'classic',       structuralMarker: '\\fancyhead[C]' },
            { archetype: 'reading-draft', variant: 'contemporary',  structuralMarker: '\\fancyhead' },
            { archetype: 'literary',      variant: 'signature',     structuralMarker: '\\fancyhead' },
            { archetype: 'structured',    variant: 'modernClassic', structuralMarker: '\\rtPart' },
        ];
        for (const { archetype, variant, structuralMarker } of archetypes) {
            it(`${archetype} → ${variant}: generates and contains "${structuralMarker}"`, () => {
                const spec = buildSpec({ archetype });
                expect(getVariantForArchetype(archetype)).toBe(variant);
                const tex = generateDesignedStyleTex(spec);
                expect(tex).toContain(structuralMarker);
            });
        }

        it('structured archetype emits \\rtPart and \\rtChapter when parts and chapters are on', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'structured',
                parts: { mode: 'roman', pageBreak: true, epigraph: true },
                chapters: { mode: 'numbered-titled', pageBreak: true, resetSceneCounter: false },
            }));
            expect(tex).toContain('\\newcommand{\\rtPart}[3]');
            expect(tex).toContain('\\newcommand{\\rtChapter}');
            expect(tex).not.toContain('\\newcommand{\\rtEpigraph}');
        });
    });

    // Regression: Contemporary Literary's running header must emit the
    // \BookTitle / \rtSceneRunningTitle macros, not the literal lowercase
    // 'title' / 'scene' label strings (which the pictogram uses as visual
    // labels). Pre-cutover hand-coded templates had this bug and the
    // pictogram label strings could be mistaken for the LaTeX value.
    describe('left-title-right-context running header (Bug 1 regression)', () => {
        it('emits \\BookTitle on even-page left and \\rtSceneRunningTitle on odd-page right', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                runningHeader: { mode: 'left-title-right-context', font: 'sans' },
            }));
            expect(tex).toMatch(/\\fancyhead\[LE\]\{[^}]*\\BookTitle[^}]*\}/);
            expect(tex).toMatch(/\\fancyhead\[RO\]\{[^}]*\\rtSceneRunningTitle[^}]*\}/);
        });

        it('does not contain the literal lowercase label strings inside \\fancyhead[', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                runningHeader: { mode: 'left-title-right-context', font: 'sans' },
            }));
            // Match every \fancyhead[...] block and assert none of them contain
            // the bare lowercase words `title` or `scene` as standalone tokens.
            const fancyheadBlocks = tex.match(/\\fancyhead\[[^\]]+\]\{[^}]*\}/g) || [];
            expect(fancyheadBlocks.length).toBeGreaterThan(0);
            for (const block of fancyheadBlocks) {
                // Allow matches that are part of a macro name (\BookTitle, \rtSceneRunningTitle)
                // Strip backslash-prefixed tokens, then check for the bare words.
                const withoutMacros = block.replace(/\\[A-Za-z]+/g, '');
                expect(withoutMacros).not.toMatch(/\btitle\b/i);
                expect(withoutMacros).not.toMatch(/\bscene\b/i);
            }
        });

        it('applies header sizing without switching away from the configured main font', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                runningHeader: { mode: 'left-title-right-context', font: 'sans' },
            }));
            expect(tex).toContain('\\fancyhead[LE]{\\normalfont\\footnotesize\\nouppercase{\\BookTitle}}');
            expect(tex).toContain('\\fancyhead[RO]{\\normalfont\\footnotesize\\nouppercase{\\rtSceneRunningTitle}}');
            expect(tex).not.toContain('\\sffamily');
        });

        it('declares the \\rtSceneRunningTitle macro and setter as hard template contracts', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                runningHeader: { mode: 'left-title-right-context', font: 'sans' },
            }));
            expect(tex).toContain('\\newcommand{\\rtSceneRunningTitle}{}');
            expect(tex).toContain('\\newcommand{\\rtSetSceneRunningTitle}');
            expect(tex).not.toContain('\\providecommand{\\rtSceneRunningTitle}');
            expect(tex).not.toContain('\\providecommand{\\rtSetSceneRunningTitle}');
        });
    });

    // Regression: spec.chapters.spacing must drive vertical placement of the
    // chapter heading. The contract surface is \rtChapter (the assembler emits
    // this directly); titleformat hooks on \chapter never fired because
    // assembler doesn't call \chapter. The spacing now lives inside the
    // \rtChapter macro body as \vspace*{<frac>\textheight}.
    describe('chapter heading spacing (Bug 2 regression)', () => {
        it('emits spec-driven vspace inside \\rtChapter with the spec\'s topFraction and bottomFraction', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                chapters: {
                    mode: 'numbered',
                    pageBreak: true,
                    resetSceneCounter: false,
                    spacing: { topFraction: 0.46, bottomFraction: 0.08 },
                },
            }));
            // Top vspace inside \rtChapter (positions heading ~46% down the page).
            expect(tex).toMatch(/\\vspace\*\{0\.46\\textheight\}/);
            // Bottom vspace inside \rtChapter.
            expect(tex).toMatch(/\\vspace\*\{0\.08\\textheight\}/);
        });

        it('\\rtChapter uses plain clearpage breaks so chapters stand alone without forced blank verso pages', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                chapters: {
                    mode: 'numbered',
                    pageBreak: true,
                    resetSceneCounter: false,
                    spacing: { topFraction: 0.46, bottomFraction: 0.08 },
                },
            }));
            // The \rtChapter macro must include \clearpage AND \thispagestyle{rtEmpty}
            // so the chapter heading sits alone on a chrome-suppressed page
            // without forcing a recto-only blank page in twoside layouts.
            const macroBody = tex.split('\\newcommand{\\rtChapter}')[1] ?? '';
            expect(macroBody).toContain('\\clearpage');
            expect(macroBody).not.toContain('\\cleardoublepage');
            expect(macroBody).toContain('\\thispagestyle{rtEmpty}');
        });

        it('does not emit \\titleformat or \\preto hooks on \\chapter (assembler emits \\rtChapter, not \\chapter)', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'reading-draft',
                chapters: {
                    mode: 'numbered',
                    pageBreak: true,
                    resetSceneCounter: false,
                    spacing: { topFraction: 0.46, bottomFraction: 0.08 },
                },
            }));
            expect(tex).not.toMatch(/\\titleformat\{\\chapter\}/);
            expect(tex).not.toMatch(/\\titlespacing\*\{\\chapter\}/);
            expect(tex).not.toMatch(/\\preto\\chapter\{/);
        });

        it('falls back to centered (0.5\\textheight) when spec.chapters.spacing is omitted', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'submission',
                chapters: { mode: 'numbered-titled', pageBreak: true, resetSceneCounter: false },
            }));
            // Default centered spacing is present inside the macro. Was 1.9in
            // (heading in upper third); now 0.5\textheight (centered) so the
            // wizard slider's 50% default and the .tex output stay in sync.
            const macroBody = tex.split('\\newcommand{\\rtChapter}')[1] ?? '';
            expect(macroBody).toContain('\\vspace*{0.5\\textheight}');
            expect(macroBody).toContain('\\vspace*{0.08\\textheight}');
        });
    });

    // Regression: Signature Literary's scene-opener bottom space was too tall
    // (legacy 0.2\textheight). The spec now exposes scene.openerSpacing so the
    // gap can be reduced. Confirm the override flows through to all four
    // \titlespacing* emit lines (section + subsection, numbered + numberless).
    describe('scene opener spacing (Signature Literary)', () => {
        it('emits \\titlespacing* with custom topFraction and bottomFraction when scene.openerSpacing is set', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'literary',
                scene: {
                    opener: 'dedicated-page',
                    headingMode: 'scene-number',
                    suppressHeaderFooterOnOpener: true,
                    openerHeadingModes: ['scene-number', 'scene-number-title', 'title-only'],
                    openerSpacing: { topFraction: 0.2, bottomFraction: 0.1 },
                },
            }));
            expect(tex).toContain('\\titlespacing*{\\section}{0pt}{0.2\\textheight}{0.1\\textheight}');
            expect(tex).toContain('\\titlespacing*{\\subsection}{0pt}{0.2\\textheight}{0.1\\textheight}');
        });

        it('falls back to the documented 0.2/0.2 default when scene.openerSpacing is omitted', () => {
            const tex = generateDesignedStyleTex(buildSpec({
                archetype: 'literary',
                scene: {
                    opener: 'dedicated-page',
                    headingMode: 'scene-number',
                    suppressHeaderFooterOnOpener: true,
                    openerHeadingModes: ['scene-number', 'scene-number-title', 'title-only'],
                },
            }));
            expect(tex).toContain('\\titlespacing*{\\section}{0pt}{0.2\\textheight}{0.2\\textheight}');
            expect(tex).toContain('\\titlespacing*{\\subsection}{0pt}{0.2\\textheight}{0.2\\textheight}');
        });
    });
});
