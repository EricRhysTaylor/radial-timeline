/*
 * Shared layout visual system for the Radial Timeline publishing pipeline.
 *
 * Single source of truth for:
 *   - Fiction layout variants
 *   - Pictogram preview data (page sides, spreads, rows)
 *   - Feature-list data
 *   - DOM renderers for pictogram spreads/pages
 *
 * Consumed by both the Settings PDF Style panel and the Manuscript Export modal.
 * Render helpers are pure DOM builders — no plugin state, no settings access.
 *
 * RT terminology → export structure:
 *   Parts    = Scene notes carrying a Part field (\rtPart{I}{title}{quote}{attr})
 *   Chapters = Scene notes carrying a Chapter field
 *   Scenes   = Scene notes (primary unit; \rtSceneSep{roman} openers)
 *
 * Parts and Chapters are both author-placed markers on scenes. Part epigraph
 * text is stored per book per layout and pairs with markers by position: the
 * first marker takes the first entry.
 */
import type { PandocLayoutTemplate } from '../types';
import type { ManuscriptSceneHeadingMode } from '../utils/manuscript';
import { SHARED_CHAPTER_FIELD_SOURCE_LABEL_TITLE } from '../utils/timelineChapters';
import { getVariantForArchetype, type DesignedStyleSpec } from './designedStyle';
import { BUNDLED_FICTION_SPECS, isBundledFictionId } from './bundledStyleSpecs';

// ── Variant identification ────────────────────────────────────────────
export type FictionLayoutVariant = 'classic' | 'modernClassic' | 'signature' | 'contemporary' | 'generic';

export const BUILTIN_FICTION_VARIANTS: readonly FictionLayoutVariant[] = [
    'classic',
    'modernClassic',
    'signature',
    'contemporary',
];

export const ALL_FICTION_VARIANTS: readonly FictionLayoutVariant[] = [
    ...BUILTIN_FICTION_VARIANTS,
    'generic',
];

export function getFictionVariantForLayout(layout?: PandocLayoutTemplate): FictionLayoutVariant {
    if (!layout) return 'generic';
    // Designed styles map archetype → variant directly. The .tex file is a derived
    // artifact, so name/path heuristics must be skipped to keep the preview accurate.
    if (layout.origin === 'designed' && layout.designedSpec) {
        return getVariantForArchetype(layout.designedSpec.archetype);
    }
    const source = `${layout.id} ${layout.name} ${layout.path}`.toLowerCase();
    if (
        source.includes('modern classic') ||
        source.includes('modern-classic') ||
        source.includes('modern_classic') ||
        source.includes('rt_modern_classic') ||
        layout.id === 'bundled-fiction-modern-classic'
    ) return 'modernClassic';
    if (source.includes('classic') || source.includes('traditional')) return 'classic';
    if (source.includes('contemporary')) return 'contemporary';
    if (
        source.includes('signature') ||
        source.includes('signature_literary_rt') ||
        source.includes('rt_signature_literary') ||
        layout.id === 'bundled-fiction-signature-literary' ||
        layout.id === 'bundled-novel'
    ) return 'signature';
    return 'generic';
}

// ── Pictogram data types ──────────────────────────────────────────────
export type PictogramPageSide = {
    headerLeft?: string;
    headerCenter?: string;
    headerRight?: string;
    folioBottom?: string;
    bodyLines: number;
    suppressHeader?: boolean;
    suppressFooter?: boolean;
    specialText?: string;
    specialSubtext?: string;
    /** Short rule rendered below specialText (like a scene separator rule) */
    specialRule?: boolean;
    /** Italic epigraph quote below the special block */
    epigraphText?: string;
    /** Attribution line below epigraph — rendered all-caps with em-dash prefix */
    epigraphAttribution?: string;
    /** When true, the epigraph quote is rendered italic. Mirrors spec.epigraph.italic. */
    epigraphItalic?: boolean;
    /** Body lines before a scene separator, separator, then more body lines */
    separatorText?: string;
    linesBeforeSeparator?: number;
    linesAfterSeparator?: number;
    /** When false, the short rule below the separator text is suppressed. */
    separatorRule?: boolean;
    /**
     * Positioning hint for the special heading on dedicated scene-opener pages.
     * When 'top', the heading anchors near the top of the page card and body
     * lines flow below after a clear gap (matching the Standard / Contemporary
     * generator behavior, where the heading + first body paragraphs share a
     * page). When omitted, the heading is centered (legacy is-special layout).
     */
    headingPosition?: 'top';
    /**
     * Vertical offset of the special heading from the top of the page,
     * expressed as a fraction (0..1) of the page height. Drives the
     * `--ert-layout-heading-top` CSS variable on the body wrapper. Used by
     * the chapter pictogram (`is-special` layout) AND the scene pictogram
     * (`is-heading-top` layout) to mirror the spec's spacing axes —
     * `chapters.spacing.topFraction` and `scene.openerSpacing.topFraction`
     * respectively.
     */
    headingTopFraction?: number;
    /**
     * Vertical gap between the heading and the body lines below, expressed
     * as a fraction (0..1) of the page height. Drives the
     * `--ert-layout-heading-bottom` CSS variable. Mainly used by the scene
     * pictogram for `scene.openerSpacing.bottomFraction`.
     */
    headingBottomFraction?: number;
};

export type PictogramSpread = {
    label: string;
    leftPage: PictogramPageSide | null;
    rightPage: PictogramPageSide | null;
    /** When set, this spread represents a selectable scene heading mode */
    sceneMode?: ManuscriptSceneHeadingMode;
    /** When set, the spread renders an alert state (orange tint) */
    warningLevel?: 'warning';
    /** Tooltip text shown on hover when warningLevel is set */
    warningTooltip?: string;
};

export type LayoutPictogramRows = {
    /** Primary row: scene-opener spread (optional) + body spread */
    scene: PictogramSpread | null;
    body: PictogramSpread;
    /** Secondary row: PART, CHAPTER, or scene-heading-mode variants */
    special: PictogramSpread[];
};

export type LayoutFeatureRow = { label: string; value: string };

// Shared body-line count for full-page body previews.
export const LAYOUT_PREVIEW_BODY_LINES = 14;

// ── Feature list data ─────────────────────────────────────────────────
//
// Two paths exist:
//   getLayoutFeaturesFromSpec(spec)   — spec-driven (preferred). Walks a
//     DesignedStyleSpec and produces description rows that are guaranteed
//     to track the same source of truth as the .tex generator + pictogram.
//   getLayoutFeatures(variant)        — variant-keyed legacy fallback for
//     custom imports that don't carry a spec.
//
// Mapping helpers below each turn one spec axis into one human row.

/** Headers row — derived from runningHeader.mode + runningHeader.font. */
function describeHeaders(spec: DesignedStyleSpec): string {
    const rh = spec.runningHeader;
    const sansSuffix = rh.font === 'sans' ? ', sans' : '';
    switch (rh.mode) {
        case 'none': return 'No running headers';
        case 'centered-title': return `Title centered (both pages)${sansSuffix}`;
        case 'split-author-page-title-page':
            return rh.letterSpacing && rh.letterSpacing > 0
                ? 'Centered: Page|Author (even) · Title|Page (odd), letter-spaced caps'
                : 'Centered: Page|Author (even) · Title|Page (odd)';
        case 'left-title-right-context':
            return `Book title (left) · Scene title (right)${sansSuffix}`;
        default: return 'Running headers';
    }
}

/** Folios row — derived from folio.position. */
function describeFolios(spec: DesignedStyleSpec): string {
    switch (spec.folio.position) {
        case 'bottom-center': return 'Bottom center';
        case 'header': return 'In headers';
        case 'none': return 'No folios';
        default: return 'Folios';
    }
}

/** Body font row — derived from body.font. */
function describeFont(spec: DesignedStyleSpec): string {
    switch (spec.body.font) {
        case 'sorts-mill-goudy': return 'Sorts Mill Goudy (serif)';
        case 'latin-modern':     return 'Latin Modern (serif)';
        case 'source-serif':     return 'Source Serif 4 (serif)';
        case 'eb-garamond':      return 'EB Garamond (serif)';
        case 'crimson':          return 'Crimson Text (serif)';
        case 'system-serif':     return 'TeX Gyre Pagella (serif)';
        case 'system-sans':      return 'Arial (sans)';
        default:                 return 'Serif';
    }
}

/** Spacing row — derived from body.lineSpacing. */
function describeSpacing(spec: DesignedStyleSpec): string {
    const ls = spec.body.lineSpacing;
    if (Math.abs(ls - 1.5) < 0.001) return '1.5 lines';
    if (Math.abs(ls - 2.0) < 0.001) return 'Double-spaced';
    if (Math.abs(ls - 1.0) < 0.001) return 'Single-spaced';
    return `${ls}×`;
}

/** Paper row — describes trim size including custom dimensions. */
function describePaper(spec: DesignedStyleSpec): string {
    const ps = spec.paperSize;
    if (typeof ps === 'string') {
        switch (ps) {
            case 'us-trade-6x9': return '6×9 in (trade)';
            case 'us-letter':    return '8.5×11 in (US Letter)';
            case 'a4':           return 'A4 (210×297 mm)';
            default:             return ps;
        }
    }
    return `${ps.widthIn}×${ps.heightIn} in (custom)`;
}

/** Margins row — uniform vs. mirrored vs. asymmetric. */
function describeMargins(spec: DesignedStyleSpec): string {
    const m = spec.margins;
    const fmt = (n: number) => Number.isInteger(n) ? `${n}` : `${n}`;
    const allEqual = m.topIn === m.bottomIn && m.topIn === m.leftIn && m.topIn === m.rightIn;
    if (allEqual) return `${fmt(m.topIn)} in (uniform)`;
    if (m.mirrored) {
        return `${fmt(m.topIn)} / ${fmt(m.rightIn)} / ${fmt(m.bottomIn)} / ${fmt(m.leftIn)} in (T/Outer/B/Inner, mirrored)`;
    }
    return `${fmt(m.topIn)} / ${fmt(m.rightIn)} / ${fmt(m.bottomIn)} / ${fmt(m.leftIn)} in (T/R/B/L)`;
}

/**
 * Parts row — derived from parts.mode + parts.title + epigraph + flags.
 * Returns null when the layout prints no Parts at all.
 *
 * Exported so the Set part… modal can show what the selected layout will do
 * with a marker without inventing its own phrasing. One description, two
 * surfaces.
 */
export function describeParts(spec: DesignedStyleSpec): string | null {
    if (spec.parts.mode === 'off') return null;
    const numbering = spec.parts.mode === 'roman' ? 'Roman numeral'
        : spec.parts.mode === 'arabic' ? 'Arabic number'
        : spec.parts.mode === 'word' ? 'Word'
        : 'Numbered';
    const flags: string[] = [];
    // Stated either way: "numeral only" is the answer to "why isn't my part
    // title printing?", so silence on the negative case is the unhelpful choice.
    flags.push(spec.parts.title ? 'with title' : 'numeral only');
    if (spec.parts.epigraph) {
        flags.push(spec.parts.epigraphPlacement === 'own-page'
            ? 'epigraph on own page'
            : 'inline epigraph');
    }
    if (spec.parts.openAny) flags.push('openany');
    if (!spec.parts.pageBreak) flags.push('no page break');
    const tail = flags.length ? ` — ${flags.join(', ')}` : '';
    return `Part opener — ${numbering}${tail}`;
}

/** Chapters row — derived from chapters.mode. Returns null when off. */
function describeChapters(spec: DesignedStyleSpec): string | null {
    if (spec.chapters.mode === 'off') return null;
    if (spec.chapters.mode === 'numbered') return 'Numbered chapter pages';
    if (spec.chapters.mode === 'titled')   return 'Titled chapter pages';
    if (spec.chapters.mode === 'numbered-titled') return SHARED_CHAPTER_FIELD_SOURCE_LABEL_TITLE;
    return 'Chapters';
}

/** Scenes row — derived from scene.opener + scene.headingMode + scene.firstWordEmphasisOnOpener. */
function describeScenes(spec: DesignedStyleSpec): string {
    const sc = spec.scene;
    if (sc.opener === 'inline-separator') return 'Inline scene separator';
    if (sc.opener === 'roman-with-rule') return 'Lowercase Roman numeral (i. ii.) with short rule';

    // dedicated-page openers — the heading content depends on headingMode.
    if (sc.openerHeadingModes && sc.openerHeadingModes.length > 0) {
        return 'Opener page — bold, suppresses headers';
    }
    // Standard / Contemporary dedicated-page openers: the heading sits at the
    // top of a new page and the body text continues below on the same page.
    // Phrasing must convey both axes (heading content + body presence) so the
    // user understands this isn't a heading-only page.
    const headingDesc = sc.headingMode === 'scene-number' ? 'scene number'
        : sc.headingMode === 'title-only' ? 'scene title'
        : 'scene number and title';
    return `New page — ${headingDesc} above body text`;
}

/**
 * Spec-driven feature rows. Use this when a layout carries a DesignedStyleSpec.
 * Each row is derived by a single mapping helper above so the relationship
 * between spec axis and human description is auditable.
 */
export function getLayoutFeaturesFromSpec(spec: DesignedStyleSpec): LayoutFeatureRow[] {
    const rows: LayoutFeatureRow[] = [];
    rows.push({ label: 'Paper',        value: describePaper(spec) });
    rows.push({ label: 'Margins',      value: describeMargins(spec) });
    rows.push({ label: 'Headers',      value: describeHeaders(spec) });
    rows.push({ label: 'Folios',       value: describeFolios(spec) });
    rows.push({ label: 'Font',         value: describeFont(spec) });
    rows.push({ label: 'Line space', value: describeSpacing(spec) });

    const partsRow = describeParts(spec);
    if (partsRow) rows.push({ label: 'Parts', value: partsRow });

    const chaptersRow = describeChapters(spec);
    if (chaptersRow) rows.push({ label: 'Chapters', value: chaptersRow });

    rows.push({ label: 'Scenes', value: describeScenes(spec) });

    // Signature Literary's three scene-opener heading modes — each gets its
    // own row mirroring the pictogram spreads (SCENE #, #+TITLE, TITLE).
    if (spec.scene.openerHeadingModes && spec.scene.openerHeadingModes.length > 0) {
        const labelByMode: Record<string, [string, string]> = {
            'scene-number':       ['Scene #',   'Number only'],
            'scene-number-title': ['Scene #+T', 'Number + title (in parentheses)'],
            'title-only':         ['Scene T',   'Title only'],
        };
        for (const mode of spec.scene.openerHeadingModes) {
            const entry = labelByMode[mode];
            if (entry) rows.push({ label: entry[0], value: entry[1] });
        }
    }

    return rows;
}

/**
 * Variant-keyed feature rows. Legacy fallback for layouts without a spec
 * (custom imports, unknown templates). Bundled fiction templates always have
 * a spec, so prefer getLayoutFeaturesFromSpec for them.
 */
export function getLayoutFeatures(variant: FictionLayoutVariant): LayoutFeatureRow[] {
    switch (variant) {
        case 'classic':
            return [
                { label: 'Headers', value: 'Title centered (both pages)' },
                { label: 'Folios', value: 'Bottom center' },
                { label: 'Font', value: 'Arial (sans)' },
                { label: 'Spacing', value: '1.5 lines' },
                { label: 'Scenes', value: 'New page — centered scene number only' },
            ];
        case 'modernClassic':
            return [
                { label: 'Headers', value: 'Centered: Page|Author (even) · Title|Page (odd)' },
                { label: 'Folios', value: 'In headers' },
                { label: 'Font', value: 'Latin Modern (serif)' },
                { label: 'Spacing', value: '1.18×' },
                { label: 'Parts', value: 'Act opener — Roman numeral with optional epigraph' },
                { label: 'Chapters', value: SHARED_CHAPTER_FIELD_SOURCE_LABEL_TITLE },
                { label: 'Scenes', value: 'Lowercase Roman numeral (i. ii.) with short rule' },
            ];
        case 'signature':
            return [
                { label: 'Headers', value: 'Centered: Page|Author (even) · Title|Page (odd)' },
                { label: 'Folios', value: 'Header-only, letter-spaced' },
                { label: 'Font', value: 'Sorts Mill Goudy (serif)' },
                { label: 'Spacing', value: '1.5 lines' },
                { label: 'Scenes', value: 'Opener page — 30pt bold, suppresses headers' },
                { label: 'Scene #', value: 'Number only' },
                { label: 'Scene #+T', value: 'Number + title (in parentheses)' },
                { label: 'Scene T', value: 'Title only' },
            ];
        case 'contemporary':
            return [
                { label: 'Headers', value: 'Book title (left) · Scene title (right)' },
                { label: 'Folios', value: 'Bottom center' },
                { label: 'Font', value: 'Source Serif 4 (serif)' },
                { label: 'Spacing', value: '1.5 lines' },
                { label: 'Scenes', value: 'New page — centered scene number only' },
                { label: 'Chapters', value: SHARED_CHAPTER_FIELD_SOURCE_LABEL_TITLE },
            ];
        default:
            return [
                { label: 'Layout', value: 'Custom template' },
                { label: 'Preview', value: 'Two-page body spread' },
            ];
    }
}

// ── Pictogram row data ────────────────────────────────────────────────
//
// Pictograms model the physical PDF page layout for each variant.
// Scene separators appear inline within body text (not on dedicated pages).
// "Special" spreads represent dedicated opener pages:
//   PART    = Act opener page (\rtPart)
//   CHAPTER = Chapter heading from a scene note's Chapter field
//   SCENE # / #+TITLE / TITLE = Scene heading modes (Signature only)
//
/**
 * Derive a pictogram row set directly from a DesignedStyleSpec.
 *
 * This is the spec-driven path: when a layout carries a DesignedStyleSpec
 * (bundled fiction templates and `origin === 'designed'` Pro layouts), the
 * preview shape is derived from the same source of truth that produces the
 * `.tex` content. No drift is structurally possible.
 *
 * Pure / deterministic / no side effects.
 */
export function getPictogramRowsFromSpec(spec: DesignedStyleSpec): LayoutPictogramRows {
    // Header strings used in the BODY spread.
    const headerByMode = (): { left?: string; right?: string; center?: string } => {
        const rh = spec.runningHeader;
        switch (rh.mode) {
            case 'centered-title':                 return { center: 'TITLE' };
            case 'split-author-page-title-page':   return { center: '12 | AUTH' };
            case 'left-title-right-context':       return { left: 'title', right: 'scene title' };
            default:                               return {};
        }
    };
    const oddCenter = spec.runningHeader.mode === 'split-author-page-title-page' ? 'TITLE | 13' : undefined;
    const folioBottom = spec.folio.position === 'bottom-center' ? '12' : undefined;
    const folioBottomRight = spec.folio.position === 'bottom-center' ? '13' : undefined;

    const hb = headerByMode();
    const bodyLeft: PictogramPageSide = {
        bodyLines: LAYOUT_PREVIEW_BODY_LINES,
        ...(hb.left ? { headerLeft: hb.left } : {}),
        ...(hb.center ? { headerCenter: hb.center } : {}),
        ...(folioBottom ? { folioBottom } : {}),
    };
    const bodyRight: PictogramPageSide = {
        bodyLines: LAYOUT_PREVIEW_BODY_LINES,
        ...(hb.right ? { headerRight: hb.right } : {}),
        ...(oddCenter ? { headerCenter: oddCenter } : hb.center ? { headerCenter: hb.center } : {}),
        ...(folioBottomRight ? { folioBottom: folioBottomRight } : {}),
    };

    const special: PictogramSpread[] = [];

    // PART spread — emitted when parts are on (Modern Classic).
    if (spec.parts.mode !== 'off') {
        // Generator emits the epigraph block when EITHER parts.epigraph or
        // epigraph.enabled is true; mirror that union here so the preview
        // matches what the .tex output will produce.
        const showsEpigraph = spec.parts.epigraph || spec.epigraph.enabled;
        const partPage: PictogramPageSide = {
            bodyLines: 0,
            suppressHeader: true,
            suppressFooter: true,
            specialText: 'I',
            specialRule: showsEpigraph,
        };
        if (showsEpigraph) {
            partPage.epigraphText = 'a quote';
            partPage.epigraphAttribution = '—J. Name';
            partPage.epigraphItalic = !!spec.epigraph.italic;
        }
        special.push({ label: 'PART', leftPage: null, rightPage: partPage });
    }

    // CHAPTER spread — emitted when chapters are on AND not signature scene-mode-only.
    if (spec.chapters.mode !== 'off') {
        const isTitled = spec.chapters.mode === 'titled' || spec.chapters.mode === 'numbered-titled';
        const chapterPage: PictogramPageSide = {
            bodyLines: 0,
            suppressHeader: true,
            suppressFooter: true,
            specialText: 'Chapter 1',
            ...(isTitled ? { specialSubtext: 'Boy with a Skull' } : {}),
        };
        // Mirror the spec's vertical offset (Contemporary's deep top-padding,
        // user-driven slider value, etc.) so the pictogram tracks the slider
        // live. Default to 0.5 (centered) when undefined — matches the .tex
        // generator's centered fallback and keeps the slider/preview in sync.
        chapterPage.headingTopFraction = spec.chapters.spacing?.topFraction ?? 0.5;
        // Contemporary's chapter-only page (no chapter title) — drop subtext.
        if (spec.chapters.mode === 'numbered' && spec.chapters.spacing) {
            chapterPage.specialText = 'Chapter';
            delete chapterPage.specialSubtext;
        }
        special.push({ label: 'CHAPTER', leftPage: null, rightPage: chapterPage });
    }

    // Signature's three scene-opener heading modes.
    // Heading anchors at the top + body lines below: matches the actual PDF
    // behavior where the scene title sits at the upper portion of the page
    // and body text flows underneath. Without this, the four body lines
    // would centre-stack and visually merge with the heading.
    if (spec.scene.openerHeadingModes && spec.scene.openerHeadingModes.length > 0) {
        for (const mode of spec.scene.openerHeadingModes) {
            const page: PictogramPageSide = {
                bodyLines: 5,
                suppressHeader: true,
                suppressFooter: true,
                headingPosition: 'top',
            };
            let label: string;
            if (mode === 'scene-number') {
                label = 'SCENE #';
                page.specialText = '3';
            } else if (mode === 'scene-number-title') {
                label = '#+TITLE';
                page.specialText = '3';
                page.specialSubtext = '(The Escape)';
            } else {
                label = 'TITLE';
                page.specialText = 'The Escape';
            }
            special.push({ label, sceneMode: mode, leftPage: null, rightPage: page });
        }
    }

    // Scene opener spread (top row) — every opener style gets a representative
    // pictogram so the left column never empties when the user picks an opener.
    let scene: PictogramSpread | null = null;
    if (spec.scene.opener === 'inline-separator') {
        scene = {
            label: 'SCENE',
            leftPage: null,
            rightPage: {
                bodyLines: 0,
                separatorText: spec.scene.separatorGlyph ?? '* * *',
                separatorRule: false,
                linesBeforeSeparator: 4,
                linesAfterSeparator: 4,
            },
        };
    } else if (spec.scene.opener === 'dedicated-page' && (!spec.scene.openerHeadingModes || spec.scene.openerHeadingModes.length === 0)) {
        const sceneOpenerSpacing = spec.scene.openerSpacing;
        scene = {
            label: 'SCENE',
            leftPage: null,
            rightPage: {
                bodyLines: 5,
                suppressHeader: spec.scene.suppressHeaderFooterOnOpener,
                suppressFooter: spec.scene.suppressHeaderFooterOnOpener,
                specialText: '3',
                // Heading anchors at the top of the page; body lines flow below
                // after a clear gap. Mirrors the generator behavior where
                // \rtSceneOpener emits the title, then \vspace, then body text.
                headingPosition: 'top',
                // openerSpacing.{top,bottom}Fraction → inline CSS vars on the
                // body wrapper. The Scenes panel sliders update spec values,
                // which flow here and visibly shift the heading position +
                // body gap in real time.
                ...(typeof sceneOpenerSpacing?.topFraction === 'number'
                    ? { headingTopFraction: sceneOpenerSpacing.topFraction }
                    : {}),
                ...(typeof sceneOpenerSpacing?.bottomFraction === 'number'
                    ? { headingBottomFraction: sceneOpenerSpacing.bottomFraction }
                    : {}),
            },
        };
    } else if (spec.scene.opener === 'roman-with-rule') {
        scene = {
            label: 'SCENE',
            leftPage: null,
            rightPage: {
                bodyLines: 0,
                separatorText: 'ii.',
                linesBeforeSeparator: 0,
                linesAfterSeparator: 5,
            },
        };
    }

    return {
        scene,
        body: { label: 'BODY', leftPage: bodyLeft, rightPage: bodyRight },
        special,
    };
}

// Legacy variant-keyed pictogram builder. Kept as a fallback for layouts that
// don't carry a DesignedStyleSpec (custom imports, etc.). For the four bundled
// fiction templates and `origin === 'designed'` Pro layouts, the spec path
// (getLayoutPictogramRows with a layout argument) is preferred.
export function getLayoutPictogramRows(
    variant: FictionLayoutVariant,
    layout?: PandocLayoutTemplate
): LayoutPictogramRows {
    // Spec-driven path: derive pictogram rows from the layout's DesignedStyleSpec
    // when one is available. Bundled fiction layouts carry a designedSpec via
    // BUNDLED_FICTION_SPECS; user-authored layouts carry one when origin === 'designed'.
    if (layout?.designedSpec) {
        return getPictogramRowsFromSpec(layout.designedSpec);
    }
    if (layout && isBundledFictionId(layout.id)) {
        return getPictogramRowsFromSpec(BUNDLED_FICTION_SPECS[layout.id]);
    }
    return getLayoutPictogramRowsByVariant(variant);
}

function getLayoutPictogramRowsByVariant(variant: FictionLayoutVariant): LayoutPictogramRows {
    switch (variant) {
        case 'classic':
            return {
                // Scene opener: suppresses headers/footers (\thispagestyle{empty})
                scene: {
                    label: 'SCENE',
                    leftPage: null,
                    rightPage: {
                        bodyLines: 5,
                        suppressHeader: true,
                        suppressFooter: true,
                        specialText: '3',
                    },
                },
                body: {
                    label: 'BODY',
                    leftPage: { headerCenter: 'TITLE', folioBottom: '12', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                    rightPage: { headerCenter: 'TITLE', folioBottom: '13', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                },
                special: [],
            };
        case 'modernClassic':
            return {
                scene: {
                    label: 'SCENE',
                    leftPage: null,
                    rightPage: {
                        bodyLines: 0,
                        separatorText: 'ii.',
                        linesBeforeSeparator: 0,
                        linesAfterSeparator: 5,
                    },
                },
                body: {
                    label: 'BODY',
                    leftPage: { headerCenter: '12 | AUTH', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                    rightPage: { headerCenter: 'TITLE | 13', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                },
                special: [
                    {
                        label: 'PART',
                        leftPage: null,
                        rightPage: {
                            bodyLines: 0,
                            suppressHeader: true,
                            suppressFooter: true,
                            specialText: 'I',
                            specialRule: true,
                            epigraphText: 'a quote',
                            epigraphAttribution: '—J. Name',
                        },
                    },
                    {
                        label: 'CHAPTER',
                        leftPage: null,
                        rightPage: {
                            bodyLines: 0,
                            suppressHeader: true,
                            suppressFooter: true,
                            specialText: 'Chapter 1',
                            specialSubtext: 'Boy with a Skull',
                        },
                    },
                ],
            };
        case 'signature':
            return {
                scene: null,
                body: {
                    label: 'BODY',
                    leftPage: { headerCenter: '12 | AUTH', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                    rightPage: { headerCenter: 'TITLE | 13', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                },
                special: [
                    {
                        label: 'SCENE #',
                        sceneMode: 'scene-number',
                        leftPage: null,
                        rightPage: {
                            bodyLines: 5,
                            suppressHeader: true,
                            suppressFooter: true,
                            specialText: '3',
                            headingPosition: 'top',
                        },
                    },
                    {
                        label: '#+TITLE',
                        sceneMode: 'scene-number-title',
                        leftPage: null,
                        rightPage: {
                            bodyLines: 5,
                            suppressHeader: true,
                            suppressFooter: true,
                            specialText: '3',
                            specialSubtext: '(The Escape)',
                            headingPosition: 'top',
                        },
                    },
                    {
                        label: 'TITLE',
                        sceneMode: 'title-only',
                        leftPage: null,
                        rightPage: {
                            bodyLines: 5,
                            suppressHeader: true,
                            suppressFooter: true,
                            specialText: 'The Escape',
                            headingPosition: 'top',
                        },
                    },
                ],
            };
        case 'contemporary':
            return {
                scene: {
                    label: 'SCENE',
                    leftPage: null,
                    rightPage: {
                        bodyLines: 5,
                        suppressHeader: true,
                        suppressFooter: true,
                        specialText: '3',
                    },
                },
                body: {
                    label: 'BODY',
                    leftPage: { headerLeft: 'title', folioBottom: '12', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                    rightPage: { headerRight: 'scene', folioBottom: '13', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                },
                special: [
                    {
                        // Contemporary Literary template forces the chapter heading
                        // onto its own freshly cleared page via
                        //   \preto\chapter{\clearpage\thispagestyle{empty}}
                        //   \titlespacing*{\chapter}{0pt}{0.46\textheight}{0.08\textheight}
                        // → ~46% top margin + 8% below leaves no room for body on
                        //   the same page before the next scene break. The pictogram
                        //   must show an empty page with just "Chapter" centered.
                        label: 'CHAPTER',
                        leftPage: null,
                        rightPage: {
                            bodyLines: 0,
                            suppressHeader: true,
                            suppressFooter: true,
                            specialText: 'Chapter',
                        },
                    },
                ],
            };
        default:
            // Generic fallback — labeled body spread so unknown templates still
            // get a basic visual preview rather than rendering nothing.
            return {
                scene: null,
                body: {
                    label: 'BODY',
                    leftPage: { folioBottom: '12', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                    rightPage: { folioBottom: '13', bodyLines: LAYOUT_PREVIEW_BODY_LINES },
                },
                special: [],
            };
    }
}

// ── Spread validation ─────────────────────────────────────────────────
//
// Stamps preview-card warning state onto PART/CHAPTER spreads when the
// underlying data isn't populated for the active book/scene selection.
//   PART     → fewer than two Acts configured for this book; or
//              part-epigraph feature is configured but no act has a quote
//   CHAPTER  → no scene in the current selection has a Chapter field; or
//              titled-chapters feature is configured but no chapter has a title
//   SCENE    → title-only heading mode is configured but scenes lack titles
//
// Each "feature configured" check is gated by what the spread itself
// advertises (the spread shape carries the feature signals — epigraphText,
// specialSubtext, sceneMode), so we never warn about features the active
// template doesn't promise.
//
// BODY (top row) is never alerted. The top-row scene spread is alerted only
// for the title-only-without-titles case (check c).
export type SpreadValidationContext = {
    /** # of scenes carrying a `Part:` marker — the parts that will print. */
    partMarkerCount: number;
    chapterFieldCount: number;
    /** # of acts with a non-empty epigraph quote (used by Part-epigraph check). */
    partEpigraphPopulatedCount?: number;
    /** # of chapter markers whose chapter title is non-empty. */
    chapterTitlePopulatedCount?: number;
    /** Fraction (0..1) of scenes-in-selection that carry a non-empty title. */
    sceneTitlePopulatedRatio?: number;
};

const PART_WARNING_TOOLTIP =
    'No Parts will render — no scenes have a Part field set.';
const CHAPTER_WARNING_TOOLTIP =
    'No chapter pages will render — no scenes have a Chapter field set.';
const SCENE_TITLE_WARNING_TOOLTIP =
    'Scene title heading mode configured but scenes have no titles.';

/**
 * Part-epigraph tooltip — switches phrasing between zero-population and
 * partial-population states. Zero is back-compat with the prior fixed string;
 * partial reports the fraction so the user knows which acts still need a quote.
 */
function partEpigraphTooltip(populated: number, total: number): string {
    if (populated <= 0) {
        return 'Part epigraphs configured but none has been written.';
    }
    return `Part epigraphs partially populated — ${populated} of ${total} marked Parts have a quote.`;
}

/**
 * The reverse imbalance: epigraph text with no Part to print it on.
 *
 * Entries pair with markers by position, so anything past the last marker is
 * text the author wrote that the export will never emit. Silence here reads as
 * "your epigraphs are fine" when some of them are simply unreachable.
 */
function surplusEpigraphTooltip(populated: number, markers: number): string {
    const surplus = populated - markers;
    return `${surplus} Part epigraph${surplus === 1 ? '' : 's'} will not print — `
        + `${populated} written but only ${markers} scene${markers === 1 ? '' : 's'} `
        + 'carry a Part field.';
}

/** Chapter-title tooltip — same dual-state shape as partEpigraphTooltip. */
function chapterTitleTooltip(populated: number, total: number): string {
    if (populated <= 0) {
        return 'Chapter titles configured but no chapter has a title set.';
    }
    return `Chapter titles partially populated — ${populated} of ${total} chapters have a title.`;
}

/** Heuristic threshold: if fewer than 5% of selected scenes have titles,
 *  the title-only heading mode will visibly fail. */
const SCENE_TITLE_RATIO_FLOOR = 0.05;

export function applySpreadValidation(
    rows: LayoutPictogramRows,
    ctx: SpreadValidationContext,
): LayoutPictogramRows {
    const stampedSpecial = rows.special.map((spread): PictogramSpread => {
        // sceneMode-bearing spreads (Signature scene-heading variants) only
        // get the title-only check. The other label-based checks skip them.
        if (spread.sceneMode) {
            if (
                spread.sceneMode === 'title-only'
                && typeof ctx.sceneTitlePopulatedRatio === 'number'
                && ctx.sceneTitlePopulatedRatio <= SCENE_TITLE_RATIO_FLOOR
            ) {
                return { ...spread, warningLevel: 'warning', warningTooltip: SCENE_TITLE_WARNING_TOOLTIP };
            }
            return spread;
        }

        if (spread.label === 'PART') {
            if (Number.isFinite(ctx.partMarkerCount) && ctx.partMarkerCount < 1) {
                return { ...spread, warningLevel: 'warning', warningTooltip: PART_WARNING_TOOLTIP };
            }
            // Part-epigraph check fires only when the spread itself advertises
            // the feature (presence of epigraphText) AND the caller has opted
            // in by supplying `partEpigraphPopulatedCount`. Callers that omit
            // the field get the historical behavior (no extra warning).
            //
            // Two firing modes:
            //   • finite marker count → warn when the two sides disagree in
            //                       either direction; the tooltip says which.
            //   • infinite marker count (data-less settings preview) → warn
            //                       only on zero population.
            const advertisesEpigraph = !!spread.rightPage?.epigraphText || !!spread.leftPage?.epigraphText;
            if (advertisesEpigraph && typeof ctx.partEpigraphPopulatedCount === 'number') {
                if (Number.isFinite(ctx.partMarkerCount)
                    && ctx.partEpigraphPopulatedCount > ctx.partMarkerCount) {
                    return {
                        ...spread,
                        warningLevel: 'warning',
                        warningTooltip: surplusEpigraphTooltip(
                            ctx.partEpigraphPopulatedCount, ctx.partMarkerCount
                        ),
                    };
                }
                if (Number.isFinite(ctx.partMarkerCount)
                    && ctx.partEpigraphPopulatedCount < ctx.partMarkerCount) {
                    return {
                        ...spread,
                        warningLevel: 'warning',
                        warningTooltip: partEpigraphTooltip(
                            ctx.partEpigraphPopulatedCount, ctx.partMarkerCount
                        ),
                    };
                }
                if (!Number.isFinite(ctx.partMarkerCount) && ctx.partEpigraphPopulatedCount === 0) {
                    return {
                        ...spread,
                        warningLevel: 'warning',
                        warningTooltip: partEpigraphTooltip(0, 0),
                    };
                }
            }
            return spread;
        }

        if (spread.label === 'CHAPTER') {
            if (ctx.chapterFieldCount === 0) {
                return { ...spread, warningLevel: 'warning', warningTooltip: CHAPTER_WARNING_TOOLTIP };
            }
            // Chapter-title check fires only when the spread advertises a
            // titled chapter (presence of specialSubtext) AND the caller
            // supplied `chapterTitlePopulatedCount` explicitly. Fires on both
            // zero AND partial population (count < chapterFieldCount).
            const advertisesTitle = !!spread.rightPage?.specialSubtext || !!spread.leftPage?.specialSubtext;
            if (
                advertisesTitle
                && typeof ctx.chapterTitlePopulatedCount === 'number'
                && Number.isFinite(ctx.chapterFieldCount)
                && ctx.chapterTitlePopulatedCount < ctx.chapterFieldCount
            ) {
                return {
                    ...spread,
                    warningLevel: 'warning',
                    warningTooltip: chapterTitleTooltip(ctx.chapterTitlePopulatedCount, ctx.chapterFieldCount),
                };
            }
            return spread;
        }

        return spread;
    });

    // Top-row scene spread: title-only check fires only when the spread is
    // labeled with a sceneMode of 'title-only'. For top-row SCENE spreads the
    // Standard / Contemporary specs use 'scene-number' so this never trips
    // there. The check applies to designed Pro layouts that opt into
    // title-only at headingMode level (carried via spread.sceneMode).
    let stampedScene = rows.scene;
    if (rows.scene && rows.scene.sceneMode === 'title-only') {
        const ratio = ctx.sceneTitlePopulatedRatio;
        if (typeof ratio === 'number' && ratio <= SCENE_TITLE_RATIO_FLOOR) {
            stampedScene = {
                ...rows.scene,
                warningLevel: 'warning',
                warningTooltip: SCENE_TITLE_WARNING_TOOLTIP,
            };
        }
    }

    return {
        scene: stampedScene,
        body: rows.body,
        special: stampedSpecial,
    };
}

// ── Status (informational) channel ────────────────────────────────────
//
// Statuses surface non-alarmist factual counts that always render, regardless
// of warning state. They never escalate severity — the panel can be in pure
// "Ready" and still carry status entries. The producer skips a status whenever
// the same spread is already in warning state (warnings take precedence) and
// only emits for spreads whose feature the layout ADVERTISES (same advertise
// gate as warnings).

export interface SpreadStatus {
    /** Stable id for dedup / ordering. */
    id: 'parts-count' | 'epigraphs-populated' | 'chapters-count' | 'chapter-titles-count' | 'scene-titles-count';
    tone: 'info' | 'success';
    /** Short rendered text. */
    text: string;
}

/**
 * Collect informational status messages from validated rows + the same
 * context that drove `applySpreadValidation`. Order: parts → chapters →
 * scenes. Spreads already in warning state are skipped (the warning carries
 * the user-facing message). Pure / deterministic.
 *
 * Each spread emits separate line items:
 *   • PART (any mode)        → "N Acts configured" (info)
 *                              plus "Epigraphs populated." (success) when
 *                              the layout advertises epigraphs and every act
 *                              has a quote.
 *   • CHAPTER (any mode)     → "N Chapters configured" (info)
 *                              plus "Chapter titles populated." (success)
 *                              when the layout advertises titled chapters and
 *                              every chapter has a title.
 *   • SCENE title-only       → "All selected scenes have titles." (success)
 *                              when ratio is 1.
 */
export function collectSpreadStatuses(
    rows: LayoutPictogramRows,
    ctx: SpreadValidationContext,
): SpreadStatus[] {
    const out: SpreadStatus[] = [];

    // ── PART spread → "N Parts marked" (+ epigraph completion) ──
    // Always emit when the layout has a PART spread, the spread isn't
    // warning, and we know the marker count. Emit epigraph completion as a
    // separate line so the modal never hides it inside a combined sentence.
    const partSpread = rows.special.find(s => s.label === 'PART' && !s.sceneMode);
    if (partSpread && partSpread.warningLevel !== 'warning'
        && Number.isFinite(ctx.partMarkerCount) && ctx.partMarkerCount >= 1) {
        const advertisesEpigraph = !!partSpread.rightPage?.epigraphText || !!partSpread.leftPage?.epigraphText;
        const allEpigraphsPopulated =
            advertisesEpigraph
            && typeof ctx.partEpigraphPopulatedCount === 'number'
            && ctx.partEpigraphPopulatedCount >= ctx.partMarkerCount;
        out.push({
            id: 'parts-count',
            tone: 'info',
            text: `${ctx.partMarkerCount} Part${ctx.partMarkerCount === 1 ? '' : 's'} marked.`,
        });
        if (allEpigraphsPopulated) {
            out.push({
                id: 'epigraphs-populated',
                tone: 'success',
                text: 'Epigraphs populated.',
            });
        }
    }

    // ── CHAPTER spread → "N Chapters configured" (+ title completion) ──
    // Always emit when the layout has a CHAPTER spread, the spread isn't
    // warning, and we know the chapter count. Emit title completion as a
    // separate line so it stays independently testable and visible.
    const chapterSpread = rows.special.find(s => s.label === 'CHAPTER' && !s.sceneMode);
    if (
        chapterSpread
        && chapterSpread.warningLevel !== 'warning'
        && Number.isFinite(ctx.chapterFieldCount)
        && ctx.chapterFieldCount > 0
    ) {
        const advertisesTitle = !!chapterSpread.rightPage?.specialSubtext || !!chapterSpread.leftPage?.specialSubtext;
        const allTitled =
            advertisesTitle
            && typeof ctx.chapterTitlePopulatedCount === 'number'
            && ctx.chapterTitlePopulatedCount >= ctx.chapterFieldCount;
        out.push({
            id: 'chapters-count',
            tone: 'info',
            text: `${ctx.chapterFieldCount} Chapters configured.`,
        });
        if (allTitled) {
            out.push({
                id: 'chapter-titles-count',
                tone: 'success',
                text: 'Chapter titles populated.',
            });
        }
    }

    // ── Scene title-only spread → "all selected scenes have titles" ──
    const titleOnlySpread = rows.special.find(s => s.sceneMode === 'title-only');
    if (
        titleOnlySpread
        && titleOnlySpread.warningLevel !== 'warning'
        && typeof ctx.sceneTitlePopulatedRatio === 'number'
        && ctx.sceneTitlePopulatedRatio >= 1
    ) {
        out.push({
            id: 'scene-titles-count',
            tone: 'success',
            text: 'All selected scenes have titles.',
        });
    }

    return out;
}

// ── DOM renderers (pure) ──────────────────────────────────────────────
// These build the same DOM tree for both consumers. They depend only on
// the standard HTMLElement API plus Obsidian's createDiv/createSpan
// augmentations (active wherever 'obsidian' is imported in the consumer).

function renderLayoutPage(parent: HTMLElement, side: PictogramPageSide, sideClass: string): void {
    const page = parent.createDiv({ cls: `ert-layout-page ${sideClass}` });

    const hdr = page.createDiv({ cls: 'ert-layout-page-header' });
    if (side.suppressHeader) hdr.addClass('is-suppressed');
    if (side.headerCenter) {
        hdr.addClass('is-centered');
        hdr.createSpan({ cls: 'ert-layout-page-hdr-center', text: side.headerCenter });
    } else {
        if (side.headerLeft) hdr.createSpan({ cls: 'ert-layout-page-hdr-left', text: side.headerLeft });
        if (side.headerRight) hdr.createSpan({ cls: 'ert-layout-page-hdr-right', text: side.headerRight });
    }

    const body = page.createDiv({ cls: 'ert-layout-page-body' });

    if (side.separatorText != null) {
        // Scene separator: lines → separator → lines.
        // Use ?? (not ||) so 0 is respected as "no lines above".
        for (let i = 0; i < (side.linesBeforeSeparator ?? 3); i++) {
            body.createDiv({ cls: 'ert-layout-page-line' });
        }
        const sep = body.createDiv({ cls: 'ert-layout-page-separator' });
        sep.createSpan({ cls: 'ert-layout-page-separator-text', text: side.separatorText });
        if (side.separatorRule !== false) {
            sep.createDiv({ cls: 'ert-layout-page-separator-rule' });
        }
        for (let i = 0; i < (side.linesAfterSeparator ?? 3); i++) {
            body.createDiv({ cls: 'ert-layout-page-line' });
        }
    } else if (side.specialText) {
        // headingPosition === 'top' lays out heading then a gap then body
        // lines below — the dedicated-page scene-opener case (Standard /
        // Contemporary), where the heading shares a page with body text.
        // Otherwise we use the centered .is-special layout (PART, CHAPTER,
        // Signature scene-mode pages — heading owns the whole page).
        if (side.headingPosition === 'top') {
            body.addClass('is-heading-top');
            // openerSpacing → CSS vars on the body wrapper. The stylesheet
            // consumes them to override the default padding-top + heading→body
            // gap, so the Scenes panel sliders move the heading visibly.
            // Always apply when defined (even at 0%) — earlier `> 0` guard
            // caused a snap from CSS-default to flex-start when the slider
            // crossed 0; smooth gradient now matches user expectation.
            if (typeof side.headingTopFraction === 'number') {
                body.addClass('is-heading-offset');
                body.style.setProperty('--ert-layout-heading-top', `${Math.round(side.headingTopFraction * 100)}%`);
            }
            if (typeof side.headingBottomFraction === 'number') {
                body.addClass('is-heading-bottom-spaced');
                body.style.setProperty('--ert-layout-heading-bottom', `${Math.round(side.headingBottomFraction * 100)}%`);
            }
            body.createSpan({ cls: 'ert-layout-page-special-text', text: side.specialText });
            if (side.specialSubtext) {
                body.createSpan({ cls: 'ert-layout-page-special-subtext', text: side.specialSubtext });
            }
            if (side.bodyLines > 0) {
                const linesWrap = body.createDiv({ cls: 'ert-layout-page-lines-after-heading' });
                for (let i = 0; i < side.bodyLines; i++) {
                    linesWrap.createDiv({ cls: 'ert-layout-page-line' });
                }
            }
        } else {
            body.addClass('is-special');
            // Always apply the heading offset when defined (even at 0% =
            // top-of-page or 50% = centered). Previous `> 0` guard caused
            // a snap from CSS-centered to flex-start whenever the slider
            // crossed 0; now the position is a smooth gradient driven
            // entirely by the fraction.
            if (typeof side.headingTopFraction === 'number') {
                body.addClass('is-heading-offset');
                body.style.setProperty('--ert-layout-heading-top', `${Math.round(side.headingTopFraction * 100)}%`);
            }
            body.createSpan({ cls: 'ert-layout-page-special-text', text: side.specialText });
            if (side.specialRule) {
                body.createDiv({ cls: 'ert-layout-page-separator-rule' });
            }
            if (side.specialSubtext) {
                body.createSpan({ cls: 'ert-layout-page-special-subtext', text: side.specialSubtext });
            }
            if (side.epigraphText) {
                const epi = body.createSpan({ cls: 'ert-layout-page-epigraph-text', text: side.epigraphText });
                if (side.epigraphItalic) epi.addClass('is-italic');
            }
            if (side.epigraphAttribution) {
                body.createSpan({ cls: 'ert-layout-page-epigraph-attr', text: side.epigraphAttribution });
            }
            if (side.bodyLines > 0) {
                // Render body lines inside the same .is-special div to avoid a
                // second .ert-layout-page-body inheriting padding-top — that extra
                // padding visually doubled the first body line.
                for (let i = 0; i < side.bodyLines; i++) {
                    body.createDiv({ cls: 'ert-layout-page-line' });
                }
            }
        }
    } else {
        for (let i = 0; i < side.bodyLines; i++) {
            body.createDiv({ cls: 'ert-layout-page-line' });
        }
    }

    const ftr = page.createDiv({ cls: 'ert-layout-page-footer' });
    if (side.suppressFooter) ftr.addClass('is-suppressed');
    if (side.folioBottom) {
        ftr.createSpan({ cls: 'ert-layout-page-folio', text: side.folioBottom });
    }
}

function renderLayoutSpread(parent: HTMLElement, spread: PictogramSpread): HTMLElement {
    const spreadEl = parent.createDiv({ cls: 'ert-layout-spread' });
    if (spread.warningLevel === 'warning') {
        spreadEl.addClass('ert-layout-spread--warning');
        if (spread.warningTooltip) {
            spreadEl.setAttribute('title', spread.warningTooltip);
        }
    }
    const pagesEl = spreadEl.createDiv({ cls: 'ert-layout-spread-pages' });

    if (spread.leftPage && spread.rightPage) {
        renderLayoutPage(pagesEl, spread.leftPage, 'is-left');
        pagesEl.createDiv({ cls: 'ert-layout-spread-spine' });
        renderLayoutPage(pagesEl, spread.rightPage, 'is-right');
    } else if (spread.rightPage) {
        renderLayoutPage(pagesEl, spread.rightPage, 'is-single');
    } else if (spread.leftPage) {
        renderLayoutPage(pagesEl, spread.leftPage, 'is-single');
    }

    if (spread.label) {
        spreadEl.createSpan({ cls: 'ert-layout-spread-label', text: spread.label });
    }
    return spreadEl;
}

export type LayoutPictogramRenderOptions = {
    onSceneModeSelect?: (mode: ManuscriptSceneHeadingMode) => void;
};

/**
 * Render the pictogram column (primary row + optional special row). Both
 * the settings panel and the export modal compose this column the same way;
 * they differ only in what surrounds it.
 */
export function renderLayoutPictograms(
    parent: HTMLElement,
    rows: LayoutPictogramRows,
    activeSceneMode?: ManuscriptSceneHeadingMode,
    options: LayoutPictogramRenderOptions = {},
): void {
    const pictoCol = parent.createDiv({ cls: 'ert-layout-visual-pictograms' });

    const primaryRow = pictoCol.createDiv({ cls: 'ert-layout-picto-row' });
    if (rows.scene) renderLayoutSpread(primaryRow, rows.scene);
    renderLayoutSpread(primaryRow, rows.body);

    // Split special spreads into two rows so Signature's three scene-mode
    // pictograms don't share a row with PART/CHAPTER (which would overflow
    // the column). Row 1: PART/CHAPTER + non-sceneMode spreads. Row 2: the
    // sceneMode-bearing spreads.
    const partChapterSpreads = rows.special.filter(s => !s.sceneMode);
    const sceneModeSpreads   = rows.special.filter(s => !!s.sceneMode);
    const hasSceneModes = sceneModeSpreads.length > 0;

    const renderRow = (spreads: PictogramSpread[]) => {
        const specialRow = pictoCol.createDiv({ cls: 'ert-layout-picto-row' });
        for (const spread of spreads) {
            const spreadEl = renderLayoutSpread(specialRow, spread);
            if (hasSceneModes && spread.sceneMode && activeSceneMode) {
                spreadEl.addClass(spread.sceneMode === activeSceneMode ? 'is-scene-active' : 'is-scene-dimmed');
            }
            if (hasSceneModes && spread.sceneMode && options.onSceneModeSelect) {
                const mode = spread.sceneMode;
                const selected = activeSceneMode === mode;
                spreadEl.addClass('is-scene-selectable');
                spreadEl.setAttribute('role', 'button');
                spreadEl.setAttribute('tabindex', '0');
                spreadEl.setAttribute('aria-pressed', selected ? 'true' : 'false');
                spreadEl.setAttribute('aria-label', `Use ${spread.label} scene opener heading`);
                if (!spread.warningTooltip) {
                    spreadEl.setAttribute('title', `Use ${spread.label} scene opener heading`);
                }
                spreadEl.addEventListener('click', () => options.onSceneModeSelect?.(mode));
                spreadEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    options.onSceneModeSelect?.(mode);
                });
            }
        }
    };

    if (partChapterSpreads.length > 0) renderRow(partChapterSpreads);
    if (sceneModeSpreads.length > 0)   renderRow(sceneModeSpreads);
}

export function renderLayoutFeatureList(parent: HTMLElement, features: LayoutFeatureRow[]): HTMLElement {
    const featureCol = parent.createDiv({ cls: 'ert-layout-visual-features' });
    for (const feat of features) {
        const row = featureCol.createDiv({ cls: 'ert-layout-feature-row' });
        row.createSpan({ cls: 'ert-layout-feature-label', text: feat.label });
        row.createSpan({ cls: 'ert-layout-feature-value', text: feat.value });
    }
    return featureCol;
}
