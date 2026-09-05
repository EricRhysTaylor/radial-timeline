import { describe, expect, it } from 'vitest';
import { getManuscriptLayoutExportBehavior } from './manuscriptLayoutExport';

describe('getManuscriptLayoutExportBehavior', () => {
    it('uses number-only raw LaTeX scene openers and suppresses both part + chapter markers for Standard Manuscript', () => {
        const behavior = getManuscriptLayoutExportBehavior({
            id: 'bundled-fiction-classic-manuscript',
            name: 'Standard Manuscript',
            path: 'rt_classic_manuscript.tex',
        });

        expect(behavior).toEqual({
            sceneHeadingRenderMode: 'latex-section-starred',
            defaultSceneHeadingMode: 'scene-number',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: true,
            suppressPartMarkers: true,
            useRtChapterMacro: false,
        });
    });

    it('suppresses both part and chapter markers for Signature Literary', () => {
        // Signature Literary's pictogram is scene-only. Leaking chapter
        // markdown turned into a phantom Part Roman + "Chapter 1" stack on
        // the first scene page when Pandoc compiled with documentclass=book.
        const behavior = getManuscriptLayoutExportBehavior({
            id: 'bundled-fiction-signature-literary',
            name: 'Signature Literary',
            path: 'rt_signature_literary.tex',
        });

        expect(behavior).toEqual({
            sceneHeadingRenderMode: 'latex-section-starred',
            allowSceneHeadingModeOverride: true,
            suppressChapterMarkers: true,
            suppressPartMarkers: true,
            useRtChapterMacro: false,
        });
    });

    it('keeps Modern Classic free to emit both part and chapter markers (its template owns the typography)', () => {
        const behavior = getManuscriptLayoutExportBehavior({
            id: 'bundled-fiction-modern-classic',
            name: 'Modern Classic',
            path: 'rt_modern_classic.tex',
        });

        // useRtChapterMacro stays false: Modern Classic emits \rtChapter from
        // its own modernClassicStructure branch in assembleManuscript, not from
        // the markdown-chapter path that useRtChapterMacro gates.
        expect(behavior).toEqual({
            sceneHeadingRenderMode: 'markdown-h2',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: false,
            suppressPartMarkers: false,
            useRtChapterMacro: false,
        });
    });

    it('lets Contemporary Literary render chapters but suppresses part markers', () => {
        const behavior = getManuscriptLayoutExportBehavior({
            id: 'bundled-fiction-contemporary-literary',
            name: 'Contemporary Literary',
            path: 'rt_contemporary_literary.tex',
        });

        // Contemporary's spec says scene.opener = 'dedicated-page' with
        // headingMode = 'scene-number'; the export pipeline now seeds those
        // from the spec so the assembler emits \rtSceneOpener{N} per scene
        // rather than markdown ## headings (which Pandoc would convert to
        // \section{} and bypass the opener-page macro). useRtChapterMacro is
        // true so chapter markers go through the template's \rtChapter macro
        // (centered title page, page numbering switch, chrome suppression)
        // instead of pandoc's book-class \chapter{} default.
        expect(behavior).toEqual({
            sceneHeadingRenderMode: 'latex-section-starred',
            defaultSceneHeadingMode: 'scene-number',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: false,
            suppressPartMarkers: true,
            useRtChapterMacro: true,
        });
    });

    it('falls back to suppressing both markers for unknown/user-imported layouts', () => {
        const behavior = getManuscriptLayoutExportBehavior({
            id: 'custom-layout',
            name: 'Imported Layout',
            path: 'Pandoc/imported.tex',
        });

        expect(behavior).toEqual({
            sceneHeadingRenderMode: 'markdown-h2',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: true,
            suppressPartMarkers: true,
            useRtChapterMacro: false,
        });
    });
});
