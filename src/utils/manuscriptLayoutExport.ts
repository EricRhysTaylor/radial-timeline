import type { PandocLayoutTemplate } from '../types';
import type { ManuscriptSceneHeadingMode, SceneHeadingRenderMode } from './manuscript';
import type { DesignedStyleSpec } from '../publishing/designedStyle';

export interface ManuscriptLayoutExportBehavior {
    sceneHeadingRenderMode: SceneHeadingRenderMode;
    defaultSceneHeadingMode?: ManuscriptSceneHeadingMode;
    /**
     * Only layouts with an explicit scene-opener heading control should honor
     * saved per-book sceneHeadingMode values. Other layouts use their spec
     * default so stale saved options cannot drift the exported PDF away from
     * the preview card.
     */
    allowSceneHeadingModeOverride: boolean;
    /**
     * When true, the export pipeline drops Chapter-field markers before
     * assembly so neither raw `\rtChapter{...}` macros nor markdown `# Chapter`
     * headings reach Pandoc. Templates without a chapter treatment in their
     * design pictogram should always set this to true: a stray `# Chapter 1`
     * markdown heading will be promoted to `\chapter{}` (or `\part{}` under a
     * `book` class) and produce visible chrome the layout was never meant to
     * have.
     */
    suppressChapterMarkers: boolean;
    /**
     * When true, the export pipeline must not emit Part / Act openers
     * (`\rtPart{...}`) for this layout. Today only the Modern-Classic
     * `usesModernClassicStructure` path emits Part markers from
     * `assembleManuscript`, but flagging this explicitly per-template keeps
     * the behavior matrix readable and protects against future regressions in
     * the assembly layer that would otherwise leak a Part page into a
     * scene-only or chapter-only design.
     */
    suppressPartMarkers: boolean;
    /**
     * When true, the assembler emits `\rtChapter{N}{Title}` raw LaTeX for
     * each chapter marker (instead of `# Title` markdown). Use this for any
     * layout whose template defines an `\rtChapter` macro — without it,
     * pandoc falls through to the book class's default `\chapter{}` style,
     * which produces the wrong typography (left-aligned "Chapter N" near
     * page top, page chrome not suppressed, page numbering doesn't switch
     * to arabic on chapter 1). The Modern-Classic structure path is
     * unaffected — it emits `\rtChapter` from its own branch.
     */
    useRtChapterMacro: boolean;
}

export const STANDARD_MANUSCRIPT_LAYOUT_ID = 'bundled-fiction-classic-manuscript';

function layoutIdentity(layout: Pick<PandocLayoutTemplate, 'id' | 'name' | 'path'>): string {
    return `${layout.id || ''} ${layout.name || ''} ${layout.path || ''}`.toLowerCase();
}

export function getManuscriptLayoutExportBehavior(
    layout: Pick<PandocLayoutTemplate, 'id' | 'name' | 'path'> & { designedSpec?: DesignedStyleSpec; hasSceneOpenerHeadingOptions?: boolean }
): ManuscriptLayoutExportBehavior {
    const identity = layoutIdentity(layout);
    const isStandardManuscript = layout.id === STANDARD_MANUSCRIPT_LAYOUT_ID
        || /\bstandard manuscript\b/.test(identity)
        || /rt_classic_manuscript\.tex/.test(identity);
    const isSignatureLiterary = /signature literary|signature[-_ ]literary/.test(identity);
    const isModernClassic = layout.id === 'bundled-fiction-modern-classic'
        || /\bmodern classic\b/.test(identity)
        || /rt_modern_classic\.tex/.test(identity);
    const isContemporaryLiterary = layout.id === 'bundled-fiction-contemporary-literary'
        || /\bcontemporary literary\b/.test(identity)
        || /rt_contemporary_literary\.tex/.test(identity);

    // Spec-driven default: when a layout carries a DesignedStyleSpec, the spec's
    // scene.headingMode is the floor. The hardcoded per-id branches below remain
    // for the four bundled fiction templates (they need explicit suppression flags
    // and renderMode that aren't representable in the spec). User-imported
    // designed layouts that fall through to the default branch get spec-derived
    // headingMode + dedicated-page-aware renderMode.
    const designed = layout.designedSpec;
    const specDefaultHeadingMode: ManuscriptSceneHeadingMode | undefined = designed?.scene.headingMode;
    const supportsSceneHeadingOverride = layout.hasSceneOpenerHeadingOptions === true
        || ((designed?.scene.openerHeadingModes?.length ?? 0) > 0);

    if (isStandardManuscript) {
        // Standard Manuscript pictogram: scene-only. No part, no chapter cards.
        return {
            sceneHeadingRenderMode: 'latex-section-starred',
            defaultSceneHeadingMode: 'scene-number',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: true,
            suppressPartMarkers: true,
            useRtChapterMacro: false,
        };
    }

    if (isSignatureLiterary) {
        // Signature Literary pictogram: scene-mode variants only. No part,
        // no chapter cards. Previously this branch left chapter markers
        // enabled, which fed `# Chapter N` markdown into Pandoc and produced
        // a phantom Part-Roman + "Chapter 1" stack on the first scene page.
        return {
            sceneHeadingRenderMode: 'latex-section-starred',
            allowSceneHeadingModeOverride: true,
            suppressChapterMarkers: true,
            suppressPartMarkers: true,
            useRtChapterMacro: false,
        };
    }

    if (isModernClassic) {
        // Modern Classic owns part + chapter typography via its own
        // \rtPart / \rtChapter macros; the Modern-Classic structure path in
        // assembleManuscript emits those raw LaTeX blocks rather than
        // markdown chapter headings. useRtChapterMacro stays false because
        // the modernClassic branch handles \rtChapter emission directly.
        return {
            sceneHeadingRenderMode: 'markdown-h2',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: false,
            suppressPartMarkers: false,
            useRtChapterMacro: false,
        };
    }

    if (isContemporaryLiterary) {
        // Contemporary Literary pictogram: scene + chapter, no part.
        // Spec says scene.opener = 'dedicated-page' with headingMode = 'scene-number',
        // so the assembler emits \rtSceneOpener{number} per scene. The .tex defines
        // \rtChapter for chapter pages — we must call it via useRtChapterMacro,
        // otherwise pandoc falls through to book-class \chapter{} defaults
        // (left-aligned, plain pagestyle, page numbering stuck on roman).
        return {
            sceneHeadingRenderMode: 'latex-section-starred',
            defaultSceneHeadingMode: 'scene-number',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: false,
            suppressPartMarkers: true,
            useRtChapterMacro: true,
        };
    }

    // Unknown / user-imported layouts: be conservative. Suppress both so a
    // custom template designer never has surprise Part / Chapter chrome
    // forced on them by chapter-field markers in the timeline. Templates
    // that want them can opt in via the Modern-Classic structure path.
    //
    // When the layout carries a DesignedStyleSpec, derive renderMode and
    // default heading mode from the spec — `dedicated-page` openers must use
    // latex-section-starred so the assembler emits \rtSceneOpener{HEADING}.
    // useRtChapterMacro is true whenever the spec advertises chapters; the
    // generated `.tex` always defines \rtChapter when chapters.mode !== 'off'
    // (see designedStyleFragments.renderChapter).
    if (designed) {
        const usesDedicatedOpener = designed.scene.opener === 'dedicated-page';
        const chaptersOn = designed.chapters.mode !== 'off';
        return {
            sceneHeadingRenderMode: usesDedicatedOpener ? 'latex-section-starred' : 'markdown-h2',
            ...(specDefaultHeadingMode ? { defaultSceneHeadingMode: specDefaultHeadingMode } : {}),
            allowSceneHeadingModeOverride: supportsSceneHeadingOverride,
            suppressChapterMarkers: !chaptersOn,
            suppressPartMarkers: designed.parts.mode === 'off',
            useRtChapterMacro: chaptersOn,
        };
    }
    return {
        sceneHeadingRenderMode: 'markdown-h2',
        allowSceneHeadingModeOverride: false,
        suppressChapterMarkers: true,
        suppressPartMarkers: true,
        useRtChapterMacro: false,
    };
}
