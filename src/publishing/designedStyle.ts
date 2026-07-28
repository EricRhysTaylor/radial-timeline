/*
 * Designed Style — data model + .tex generator (Step 2 of publishing roadmap).
 *
 * A DesignedStyleSpec is the source of truth for a Pro user's custom PDF style.
 * The generated .tex file is a derived artifact, regenerated on save.
 *
 * The visual variant (used by layoutVisuals pictograms / feature lists) is
 * derived from the spec's archetype — variant remains the VISUAL axis only.
 * Origin ('designed') is the SOURCE axis (added in src/types/settings.ts).
 *
 * Generator architecture: composition from named LaTeX snippets. Fragment
 * producers live in designedStyleFragments.ts; this module assembles them
 * around the Pandoc $body$ skeleton.
 *
 * Step 2 scope: data model + generator + tier/variant wiring + tests.
 * Step 3 (separate task): persistence, settings rendering, wizard UI.
 */
import type { ManuscriptSceneHeadingMode } from '../utils/manuscript';
import type { FictionLayoutVariant } from './layoutVisuals';
import {
    renderBodySetup,
    renderChapterTitle,
    renderEpigraphMacros,
    renderFancyhdr,
    renderFolio,
    renderFontspec,
    renderGeometry,
    renderPageNumberingControl,
    renderPartTitle,
    renderPreamble,
    renderSceneOpener,
} from './designedStyleFragments';

export const DESIGNED_STYLE_SPEC_VERSION = 2 as const;

export type DesignArchetype = 'submission' | 'reading-draft' | 'literary' | 'structured';

export type DesignedHeaderField =
    | 'page' | 'author' | 'title' | 'scene-context' | 'chapter' | 'empty'
    | { literal: string };

export interface DesignedStyleSpec {
    specVersion: typeof DESIGNED_STYLE_SPEC_VERSION;
    archetype: DesignArchetype;
    paperSize: 'us-trade-6x9' | 'us-letter' | 'a4' | { widthIn: number; heightIn: number };
    margins: { topIn: number; bottomIn: number; leftIn: number; rightIn: number; mirrored?: boolean };
    body: {
        font: 'sorts-mill-goudy' | 'latin-modern' | 'source-serif' | 'eb-garamond' | 'crimson' | 'system-serif' | 'system-sans' | 'custom';
        /** Exact font family name as installed on the OS. Only read when font === 'custom'. */
        customFontName?: string;
        fontFallbackChain: string[];
        sizePt: number;
        lineSpacing: number;
        paragraphIndentEm?: number;
        firstLineIndentSuppressedAfterBreak?: boolean;
        /** Modern Classic uses the `microtype` package for refined micro-typography. */
        microtype?: boolean;
    };
    runningHeader: {
        mode: 'none' | 'centered-title' | 'split-author-page-title-page' | 'left-title-right-context';
        evenLeft?: DesignedHeaderField; evenCenter?: DesignedHeaderField; evenRight?: DesignedHeaderField;
        oddLeft?: DesignedHeaderField;  oddCenter?: DesignedHeaderField;  oddRight?: DesignedHeaderField;
        /**
         * Header font family override. 'sans' uses `\sffamily\footnotesize` (Contemporary Literary).
         * Wired into renderFancyhdr.
         */
        font?: 'inherit' | 'sans';
        /**
         * Letter-spacing in fontspec units (e.g. 15.0 for Signature Literary's spaced caps).
         * When set, an extra `\headerfont` font face is emitted with `LetterSpace=<n>` and
         * the running-header text is wrapped in `\KernedText{\MakeUppercase{...}}`.
         */
        letterSpacing?: number;
    };
    folio: { position: 'header' | 'bottom-center' | 'none'; format?: 'arabic' | 'roman-frontmatter' };
    parts:    {
        mode: 'off' | 'roman' | 'arabic' | 'word';
        pageBreak: boolean;
        epigraph: boolean;
        /**
         * Controls the standalone epigraph macro when a future spec emits
         * epigraphs separately from part openers. Modern Classic keeps act
         * epigraphs inline inside \rtPart{roman}{quote}{attribution}.
         * 'inline' = the epigraph block is appended to the PART page.
         * 'own-page' = the epigraph runs on a dedicated cleardoublepage after PART.
         */
        epigraphPlacement?: 'inline' | 'own-page';
        /** Modern Classic uses `book[openany]` so chapters can start on either side. */
        openAny?: boolean;
    };
    chapters: {
        mode: 'off' | 'numbered' | 'titled' | 'numbered-titled';
        pageBreak: boolean;
        resetSceneCounter: boolean;
        /** Contemporary Literary places the chapter heading via `\titlespacing*` deep on its own page. */
        spacing?: { topFraction?: number; bottomFraction?: number };
        /** Signature Literary uses `\setcounter{secnumdepth}{1}` to number scene sections. */
        secnumdepth?: 0 | 1;
    };
    scene: {
        opener: 'inline-separator' | 'dedicated-page' | 'roman-with-rule';
        headingMode: ManuscriptSceneHeadingMode;
        suppressHeaderFooterOnOpener: boolean;
        separatorGlyph?: string;
        /**
         * When true, the scene opener emits the `\rtSceneOpenerTitle` first-word-emphasis
         * helper (Standard / Contemporary). The macro typesets only the first word from
         * the supplied scene title.
         */
        firstWordEmphasisOnOpener?: boolean;
        /**
         * Signature Literary lets the user pick between three scene-opener heading modes
         * at export time. When set, the generated `.tex` declares
         * `hasSceneOpenerHeadingOptions: true` and exposes the listed modes.
         */
        openerHeadingModes?: ManuscriptSceneHeadingMode[];
        /**
         * Vertical spacing on dedicated scene-opener pages, expressed as fractions
         * of `\textheight`. `topFraction` is the space above the scene title;
         * `bottomFraction` is the gap between the title and the body text below.
         * Defaults to 0.2/0.2 when omitted (matching legacy Signature Literary).
         */
        openerSpacing?: { topFraction?: number; bottomFraction?: number };
    };
    epigraph: { enabled: boolean; italic: boolean; attributionStyle: 'em-dash-caps' | 'plain' };
}

const ARCHETYPE_TO_VARIANT: Record<DesignArchetype, FictionLayoutVariant> = {
    'submission':    'classic',
    'reading-draft': 'contemporary',
    'literary':      'signature',
    'structured':    'modernClassic',
};

/**
 * Map a DesignArchetype (the user's intent) to a FictionLayoutVariant
 * (the VISUAL preview shape used in the Settings panel and Export modal).
 *
 * This is the source of truth for the archetype → variant mapping.
 */
export function getVariantForArchetype(archetype: DesignArchetype): FictionLayoutVariant {
    return ARCHETYPE_TO_VARIANT[archetype];
}

/**
 * Apply a header preset to spec.runningHeader (mutates in place).
 *
 * Lives on the spec module (not the wizard) because the .tex generator
 * depends on this — `renderFancyhdr` clones the spec and re-runs this to
 * compute the preset baseline, then layers user per-corner overrides on top.
 *
 * Resets per-corner overrides and re-populates them per the named mode.
 * Does NOT touch font or letterSpacing — those are independent axes whose
 * values are controlled by the bundled spec, not the preset name. (Two
 * bundled templates can share the same mode but use different letterSpacing
 * — Modern Classic vs Signature Literary both use split-author-page-title-page
 * but only Signature opts into the wide-set caps.)
 */
export function applyHeaderPreset(spec: DesignedStyleSpec, mode: DesignedStyleSpec['runningHeader']['mode']): void {
    const rh = spec.runningHeader;
    rh.mode = mode;
    delete rh.evenLeft; delete rh.evenCenter; delete rh.evenRight;
    delete rh.oddLeft;  delete rh.oddCenter;  delete rh.oddRight;
    if (mode === 'centered-title') {
        rh.evenCenter = 'title';
        rh.oddCenter = 'title';
    } else if (mode === 'split-author-page-title-page') {
        rh.evenLeft = 'page';
        rh.evenRight = 'author';
        rh.oddLeft = 'title';
        rh.oddRight = 'page';
    } else if (mode === 'left-title-right-context') {
        rh.evenLeft = 'title';
        rh.oddRight = 'scene-context';
    }
}

/**
 * Generate a .tex file string from a DesignedStyleSpec.
 *
 * The output is composed from named fragment producers and is intended to
 * compile via XeLaTeX/pdfLaTeX through Pandoc. It is NOT required to byte-match
 * any bundled template; instead it produces a structurally compatible file
 * that emits \rtPart / \rtChapter / \rtSceneSep when those features are on,
 * matching the manuscript.ts macro contract.
 */
export interface GenerateDesignedStyleTexOptions {
    bundledLayoutId?: string;
    /**
     * Absolute filesystem path to the vault's Pandoc font root
     * (`<vault>/Radial Timeline/Pandoc/fonts`). When provided AND the
     * resolver finds the spec's font in `<vaultFontDir>/<slug>/`, fontspec
     * gets a `Path=` directive. Otherwise the generator emits a plain
     * `\setmainfont{Name}` and lets XeLaTeX resolve via the system font
     * cache.
     *
     * One option, two resolution paths (vault → system). No fallback chain,
     * no per-font branches, no `\PackageError{rt-font}` blocks.
     */
    vaultFontDir?: string;
}

export function generateDesignedStyleTex(
    spec: DesignedStyleSpec,
    options: GenerateDesignedStyleTexOptions = {}
): string {
    const sections: string[] = [];

    if (options.bundledLayoutId) {
        sections.push(`% Generated from DesignedStyleSpec v${spec.specVersion} — ${options.bundledLayoutId}`);
    } else {
        sections.push(`% Generated from DesignedStyleSpec v${spec.specVersion} — designed-${spec.archetype}`);
    }
    sections.push('% Do not edit by hand. Source of truth: src/publishing/designedStyle.ts');
    sections.push('% Archetype: ' + spec.archetype);
    sections.push('');
    sections.push(renderPreamble(spec));
    sections.push('');
    sections.push(renderGeometry(spec));
    sections.push('');
    sections.push(renderFontspec(spec, {
        vaultFontDir: options.vaultFontDir,
    }));
    sections.push('');
    sections.push(renderFancyhdr(spec));

    const folioBlock = renderFolio(spec);
    if (folioBlock) {
        sections.push('');
        sections.push(folioBlock);
    }

    // Page numbering control: roman by default, switches to arabic at the
    // first opener (Part > Chapter > Scene). Must be emitted BEFORE the opener
    // macros so the \ifrtMainStarted flag is defined when they reference it.
    sections.push('');
    sections.push(renderPageNumberingControl(spec));

    const partsBlock = renderPartTitle(spec);
    if (partsBlock) {
        sections.push('');
        sections.push(partsBlock);
    }

    const chaptersBlock = renderChapterTitle(spec);
    if (chaptersBlock) {
        sections.push('');
        sections.push(chaptersBlock);
    }

    const sceneBlock = renderSceneOpener(spec);
    if (sceneBlock) {
        sections.push('');
        sections.push(sceneBlock);
    }

    const epigraphBlock = renderEpigraphMacros(spec);
    if (epigraphBlock) {
        sections.push('');
        sections.push(epigraphBlock);
    }

    const bodySetup = renderBodySetup(spec);
    if (bodySetup) {
        sections.push('');
        sections.push(bodySetup);
    }

    // Pandoc `--include-in-header` injection point. Without this variable in the
    // template, header content (binding gutter geometry, Pro custom preamble) is
    // silently dropped by Pandoc. Emitted last so injected LaTeX can override any
    // generated preamble setting — that is the contract: user preamble wins.
    sections.push('');
    sections.push('$for(header-includes)$');
    sections.push('$header-includes$');
    sections.push('$endfor$');

    sections.push('');
    sections.push('\\begin{document}');
    sections.push('');
    sections.push('$body$');
    sections.push('');
    sections.push('\\end{document}');

    return sections.join('\n');
}
