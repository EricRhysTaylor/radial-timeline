/*
 * Wizard-shaped fixture set for publishing-pdf-qa.mjs.
 *
 * Each fixture is a hand-built DesignedStyleSpec that mirrors what a Pro user
 * would produce by clicking through the Designed Style Wizard — paired with
 * minimal markdown that exercises the macros the spec emits.
 *
 * Coverage focus (deliberately narrow — pandoc compiles take seconds each):
 *   • size-override branch (sizePt outside 10/11/12)
 *   • indentfirst branch (firstLineIndentSuppressedAfterBreak=false)
 *   • own-page part epigraph (\cleardoublepage in \rtPart)
 *   • mirrored margins (inner/outer)
 *   • each scene-opener style (inline-separator / dedicated-page / roman-with-rule)
 *
 * The fixture set is small enough that it's just a curated list — not a
 * pairwise covering array. The property test (specProperty.test.ts) already
 * gives broad structural coverage; this set's job is to confirm the .tex
 * actually compiles end-to-end.
 *
 * Asserted per fixture: pandoc exits 0, pdfinfo reports >= expectedPages.
 * That's it. No text-content checks, no visual baselines — those add maintenance
 * cost without adding much beyond what the bundled-template QA already covers.
 */
import { DESIGNED_STYLE_SPEC_VERSION } from '../src/publishing/designedStyle.ts';

/** Common defaults a Submission archetype would carry out of the wizard.
 *  Defaults to `latin-modern` (universal TeX Live font) so the compile gate
 *  exercises the generator, not the local font installation. The strict
 *  font policy makes other choices (system-serif → Pagella, etc.) fail on
 *  machines that don't have those fonts installed. */
function baseSpec(overrides = {}) {
    const base = {
        specVersion: DESIGNED_STYLE_SPEC_VERSION,
        archetype: 'submission',
        paperSize: 'us-trade-6x9',
        margins: { topIn: 1, bottomIn: 1, leftIn: 1, rightIn: 1, mirrored: false },
        body: {
            font: 'latin-modern',
            fontFallbackChain: [],
            sizePt: 11,
            lineSpacing: 1.5,
            paragraphIndentEm: 1.0,
        },
        runningHeader: { mode: 'centered-title' },
        folio: { position: 'bottom-center', format: 'arabic' },
        parts:    { mode: 'off', pageBreak: false, epigraph: false },
        chapters: { mode: 'off', pageBreak: false, resetSceneCounter: false },
        scene: {
            opener: 'inline-separator',
            headingMode: 'scene-number',
            suppressHeaderFooterOnOpener: false,
            separatorGlyph: '* * *',
        },
        epigraph: { enabled: false, italic: false, attributionStyle: 'plain' },
    };
    return deepMerge(base, overrides);
}

function deepMerge(base, overrides) {
    const out = { ...base };
    for (const [k, v] of Object.entries(overrides ?? {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && k in base && typeof base[k] === 'object') {
            out[k] = deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

const SHORT_BODY = [
    'First scene paragraph fills enough words that the PDF has a meaningful body for layout to render.',
    '',
    'Second paragraph keeps the page from rendering empty when the spec configuration leaves heavy whitespace before the first body line.',
].join('\n');

const SCENE_SEP_BODY = [
    '\\rtSceneSep{i}',
    '',
    'First scene paragraph follows a roman scene separator.',
    '',
    '\\rtSceneSep{ii}',
    '',
    'Second scene paragraph follows another roman separator.',
].join('\n');

const SCENE_OPENER_BODY = [
    '\\rtSceneOpener{1}',
    '',
    'First scene starts with a dedicated-page opener heading.',
    '',
    '\\rtSceneOpener{2}',
    '',
    'Second scene continues after another dedicated-page opener.',
].join('\n');

/** Fixture set. Each entry: spec + minimal markdown + minimum expected pages. */
export const WIZARD_FIXTURES = [
    {
        slug: 'wizard-default-submission',
        spec: baseSpec({}),
        body: SHORT_BODY,
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-size-10pt',
        spec: baseSpec({ body: { sizePt: 10 } }),
        body: SHORT_BODY,
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-size-14pt',
        // Triggers the \fontsize override branch (sizePt outside 10/11/12).
        spec: baseSpec({ body: { sizePt: 14 } }),
        body: SHORT_BODY,
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-indentfirst-on',
        // Triggers the indentfirst-package branch.
        spec: baseSpec({ body: { firstLineIndentSuppressedAfterBreak: false } }),
        body: SHORT_BODY,
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-parts-inline-epigraph',
        spec: baseSpec({
            parts: { mode: 'roman', pageBreak: true, epigraph: true, epigraphPlacement: 'inline' },
            chapters: { mode: 'off', pageBreak: false, resetSceneCounter: false },
            epigraph: { enabled: true, italic: true, attributionStyle: 'em-dash-caps' },
        }),
        body: [
            '\\rtPart{I}{An inline quote.}{Test Author}',
            '',
            SHORT_BODY,
        ].join('\n\n'),
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-parts-own-page-epigraph',
        // Triggers the \cleardoublepage branch in \rtPart for own-page epigraph.
        spec: baseSpec({
            parts: { mode: 'roman', pageBreak: true, epigraph: true, epigraphPlacement: 'own-page' },
            chapters: { mode: 'off', pageBreak: false, resetSceneCounter: false },
            epigraph: { enabled: true, italic: true, attributionStyle: 'em-dash-caps' },
        }),
        body: [
            '\\rtPart{I}{An own-page quote.}{Test Author}',
            '',
            SHORT_BODY,
        ].join('\n\n'),
        // Own-page epigraph adds at least one more page.
        minExpectedPages: 2,
    },
    {
        slug: 'wizard-chapters-numbered-titled',
        spec: baseSpec({
            chapters: {
                mode: 'numbered-titled',
                pageBreak: true,
                resetSceneCounter: true,
                spacing: { topFraction: 0.46, bottomFraction: 0.08 },
            },
        }),
        body: [
            '\\rtChapter{1}{First Chapter}',
            '',
            SHORT_BODY,
        ].join('\n\n'),
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-roman-with-rule',
        spec: baseSpec({
            scene: {
                opener: 'roman-with-rule',
                headingMode: 'scene-number',
                suppressHeaderFooterOnOpener: false,
            },
        }),
        body: SCENE_SEP_BODY,
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-dedicated-page-opener',
        spec: baseSpec({
            scene: {
                opener: 'dedicated-page',
                headingMode: 'scene-number',
                suppressHeaderFooterOnOpener: true,
                firstWordEmphasisOnOpener: true,
            },
        }),
        body: SCENE_OPENER_BODY,
        minExpectedPages: 2,
    },
    {
        slug: 'wizard-mirrored-contemporary',
        // Mirrored margins + Contemporary's left-title-right-context headers.
        // Twoside layout — exercises \markboth / running-head wiring.
        spec: baseSpec({
            margins: { topIn: 0.9, bottomIn: 1.0, leftIn: 0.85, rightIn: 1.05, mirrored: true },
            runningHeader: { mode: 'left-title-right-context', font: 'sans' },
        }),
        body: SHORT_BODY,
        minExpectedPages: 1,
    },
    {
        slug: 'wizard-all-bells',
        // Stack-test: most axes activated together. Catches multi-axis
        // interactions that single-axis fixtures wouldn't.
        spec: baseSpec({
            margins: { topIn: 0.9, bottomIn: 1.0, leftIn: 1.0, rightIn: 0.85, mirrored: true },
            body: { sizePt: 12, lineSpacing: 1.18, firstLineIndentSuppressedAfterBreak: false },
            parts: {
                mode: 'roman', pageBreak: true, epigraph: true,
                epigraphPlacement: 'own-page', openAny: true,
            },
            chapters: {
                mode: 'numbered-titled', pageBreak: true, resetSceneCounter: true,
            },
            scene: {
                opener: 'roman-with-rule', headingMode: 'scene-number',
                suppressHeaderFooterOnOpener: false, firstWordEmphasisOnOpener: true,
            },
            runningHeader: { mode: 'split-author-page-title-page' },
            epigraph: { enabled: true, italic: true, attributionStyle: 'em-dash-caps' },
        }),
        body: [
            '\\rtPart{I}{A grand quote.}{All-Bells Author}',
            '',
            '\\rtChapter{1}{First Chapter}',
            '',
            SCENE_SEP_BODY,
        ].join('\n\n'),
        minExpectedPages: 2,
    },
];
