import { describe, expect, it } from 'vitest';
import { buildLayoutAssemblyOptions, getManuscriptLayoutExportBehavior } from './manuscriptLayoutExport';
import { BUNDLED_FICTION_SPECS } from '../publishing/bundledStyleSpecs';

describe('getManuscriptLayoutExportBehavior', () => {
    it.each(['Standard Manuscript Copy', 'Signature Literary Copy', 'Contemporary Literary Copy'])(
        'honors the designed spec regardless of the label %s', name => {
            const behavior = getManuscriptLayoutExportBehavior({
                id: 'designed-copy', name, path: 'Pandoc/designed/copy.tex', origin: 'designed',
                designedSpec: BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic'],
            });
            expect(behavior.suppressChapterMarkers).toBe(false);
            expect(behavior.suppressPartMarkers).toBe(false);
        });
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

    it.each(['Modern Classic', 'Contemporary Literary', 'Signature Literary', 'Standard Manuscript'])(
        'never reads an imported template\'s name: "%s" is assembled like any other imported template', name => {
            // A built-in's name on someone's own LaTeX says nothing about the
            // macros it defines; sending it \rtSceneOpener would break it.
            expect(getManuscriptLayoutExportBehavior({ id: 'imported-x-novel', name, path: `Pandoc/imported/${name}.tex`, origin: 'imported' })).toEqual({
                sceneHeadingRenderMode: 'markdown-h2',
                allowSceneHeadingModeOverride: false,
                suppressChapterMarkers: true,
                suppressPartMarkers: true,
                useRtChapterMacro: false,
            });
        });

    it('sends parts and chapters to an imported template that defines the structural macros itself', () => {
        const behavior = getManuscriptLayoutExportBehavior({
            id: 'imported-house-style-novel', name: 'House Style', path: 'Pandoc/imported/house-style.tex',
            origin: 'imported', usesModernClassicStructure: true,
        });
        expect(behavior).toEqual({
            sceneHeadingRenderMode: 'markdown-h2',
            allowSceneHeadingModeOverride: false,
            suppressChapterMarkers: false,
            suppressPartMarkers: false,
            useRtChapterMacro: false,
        });
    });
});

// What the export runner passes to manuscript assembly for each kind of
// layout. These are the values CommandRegistrar derived in place before the
// derivation moved here; a built-in or wizard-made style must keep getting them.
describe('buildLayoutAssemblyOptions', () => {
    const chapters = { 'Book/1.md': [{ sourceType: 'Scene' as const, title: 'One', resolvedScenePath: 'Book/1.md', resolvedTimelinePosition: 1 }] };
    const input = { chapterMarkersByScenePath: chapters, savedSceneHeadingMode: 'title-only' as const, partEpigraphs: ['Q'], partEpigraphAttributions: ['A'] };
    const bundled = (id: keyof typeof BUNDLED_FICTION_SPECS, name: string, path: string, flags: object = {}) =>
        ({ id, name, path, bundled: true, designedSpec: BUNDLED_FICTION_SPECS[id], ...flags });

    it('Basic: numbered scene openers, no chapters, no structure', () => {
        expect(buildLayoutAssemblyOptions(bundled('bundled-fiction-classic-manuscript', 'Standard Manuscript', 'rt_classic_manuscript.tex'), input)).toEqual({
            chapterMarkersByScenePath: {}, sceneHeadingMode: 'scene-number', sceneHeadingRenderMode: 'latex-section-starred',
            suppressMatterPageChrome: true, useRtChapterMacro: false, modernClassicStructure: undefined,
        });
    });

    it('Standard: chapters through \\rtChapter, the book\'s heading choice ignored', () => {
        expect(buildLayoutAssemblyOptions(bundled('bundled-fiction-contemporary-literary', 'Contemporary Literary', 'rt_contemporary_literary.tex'), input)).toEqual({
            chapterMarkersByScenePath: chapters, sceneHeadingMode: 'scene-number', sceneHeadingRenderMode: 'latex-section-starred',
            suppressMatterPageChrome: true, useRtChapterMacro: true, modernClassicStructure: undefined,
        });
    });

    it('Professional: the book\'s saved heading choice applies', () => {
        const layout = bundled('bundled-fiction-signature-literary', 'Signature Literary', 'rt_signature_literary.tex', { hasSceneOpenerHeadingOptions: true });
        expect(buildLayoutAssemblyOptions(layout, input)).toEqual({
            chapterMarkersByScenePath: {}, sceneHeadingMode: 'title-only', sceneHeadingRenderMode: 'latex-section-starred',
            suppressMatterPageChrome: true, useRtChapterMacro: false, modernClassicStructure: undefined,
        });
        expect(buildLayoutAssemblyOptions(layout, { chapterMarkersByScenePath: chapters }).sceneHeadingMode).toBeUndefined();
    });

    it('Signature: parts, chapters and epigraphs through the structural path', () => {
        const layout = bundled('bundled-fiction-modern-classic', 'Modern Classic', 'rt_modern_classic.tex', { usesModernClassicStructure: true, hasEpigraphs: true });
        expect(buildLayoutAssemblyOptions(layout, input)).toEqual({
            chapterMarkersByScenePath: chapters, sceneHeadingMode: undefined, sceneHeadingRenderMode: 'markdown-h2',
            suppressMatterPageChrome: true, useRtChapterMacro: false,
            modernClassicStructure: { enabled: true, partEpigraphs: ['Q'], partEpigraphAttributions: ['A'] },
        });
    });

    it('a wizard-made style: everything from its spec', () => {
        const spec = structuredClone(BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic']);
        spec.scene = { opener: 'dedicated-page', headingMode: 'scene-number', suppressHeaderFooterOnOpener: false };
        spec.parts.mode = 'word';
        spec.chapters.resetSceneCounter = true;
        const options = buildLayoutAssemblyOptions({ id: 'designed-mine', name: 'Mine', path: 'Pandoc/designed/mine.tex', origin: 'designed', designedSpec: spec }, input);
        expect(options).toEqual({
            chapterMarkersByScenePath: chapters, sceneHeadingMode: 'scene-number', sceneHeadingRenderMode: 'latex-section-starred',
            suppressMatterPageChrome: true, useRtChapterMacro: true,
            modernClassicStructure: {
                enabled: true, partEpigraphs: ['Q'], partEpigraphAttributions: ['A'],
                sceneOpener: 'dedicated-page', suppressPartMarkers: false, resetSceneCounterOnChapter: true, partNumberStyle: 'word',
            },
        });
    });

    it('an imported template: plain Markdown headings, no chapters, no structure', () => {
        expect(buildLayoutAssemblyOptions({ id: 'imported-my-book-novel', name: 'My Book', path: 'Pandoc/imported/my-book.tex', origin: 'imported' }, input)).toEqual({
            chapterMarkersByScenePath: {}, sceneHeadingMode: undefined, sceneHeadingRenderMode: 'markdown-h2',
            suppressMatterPageChrome: true, useRtChapterMacro: false, modernClassicStructure: undefined,
        });
    });
});
