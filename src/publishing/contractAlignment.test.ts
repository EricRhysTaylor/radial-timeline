/*
 * One Spec, Three Echoes — contract alignment.
 *
 * For every bundled fiction layout, the DesignedStyleSpec and runtime layout
 * behavior must agree across THREE independent rendering paths:
 *
 *   1. Feature table       (getLayoutFeaturesFromSpec)
 *   2. Pictogram preview   (getPictogramRowsFromSpec)
 *   3. PDF assembler       (getManuscriptLayoutExportBehavior + assembleManuscript + generateDesignedStyleTex)
 *
 * This test builds a single comprehensive synthetic manuscript fixture in
 * memory (parts, chapters, scenes-with-titles), then asserts that for each
 * spec all three paths describe the same thing.
 *
 * IMPORTANT — test is on the SEMANTIC contract, not on byte-equality. The
 * spec config and runtime layout behavior drive intent; cosmetic copy on the
 * feature row is allowed to change so long as the meaningful tokens still
 * appear. Tests must not pin
 * exact phrasing strings ("New page — centered scene number only") because
 * that overfits the test to the current copy and re-traps the agent into
 * fixing surface symptoms instead of the contract.
 */
import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import {
    BUNDLED_FICTION_IDS,
    BUNDLED_FICTION_SPECS,
    type BundledFictionId,
} from './bundledStyleSpecs';
import { generateDesignedStyleTex } from './designedStyle';
import {
    getLayoutFeaturesFromSpec,
    getPictogramRowsFromSpec,
} from './layoutVisuals';
import {
    assembleManuscript,
    type ManuscriptSceneHeadingMode,
    type SceneHeadingRenderMode,
} from '../utils/manuscript';
import { getManuscriptLayoutExportBehavior } from '../utils/manuscriptLayoutExport';
import type { PandocLayoutTemplate } from '../types';

// ── Synthetic fixture ──────────────────────────────────────────────────
//
// Two acts × two chapters × two scenes — every scene has BOTH a numeric
// prefix AND a title (e.g. "3 The Garden"). The fixture exercises every
// structural axis a spec can enable.

interface SyntheticScene {
    file: TFile;
    body: string;
    /** Optional chapter marker emitted before this scene by the registrar layer. */
    chapterMarker?: { title: string };
}

function makeFile(path: string, basename: string): TFile {
    return { path, basename } as TFile;
}

function buildSyntheticScenes(): SyntheticScene[] {
    // Scenes self-declare which Act they belong to via the canonical `Act:`
    // frontmatter field — the same source the timeline ring uses. The Modern
    // A Part opens where the author placed a `Part:` marker.
    return [
        // Act I → Chapter 1 → Scenes 1 + 2
        {
            file: makeFile('Scenes/1 Arrival.md', '1 Arrival'),
            body: '---\nClass: Scene\nPart: true\n---\n\nFirst paragraph of scene one.',
            chapterMarker: { title: 'Boy with a Skull' },
        },
        {
            file: makeFile('Scenes/2 The Garden.md', '2 The Garden'),
            body: '---\nClass: Scene\n---\n\nSecond paragraph.',
        },
        // Act I → Chapter 2 → Scenes 3 + 4
        {
            file: makeFile('Scenes/3 Confrontation.md', '3 Confrontation'),
            body: '---\nClass: Scene\n---\n\nThird paragraph.',
            chapterMarker: { title: 'Everything of Possibility' },
        },
        {
            file: makeFile('Scenes/4 Aftermath.md', '4 Aftermath'),
            body: '---\nClass: Scene\n---\n\nFourth paragraph.',
        },
        // Act II → Chapter 3 → Scenes 5 + 6
        {
            file: makeFile('Scenes/5 Departure.md', '5 Departure'),
            body: '---\nClass: Scene\nPart: true\n---\n\nFifth paragraph.',
            chapterMarker: { title: 'New Horizons' },
        },
        {
            file: makeFile('Scenes/6 Resolution.md', '6 Resolution'),
            body: '---\nClass: Scene\n---\n\nSixth paragraph.',
        },
    ];
}

function buildVault(scenes: SyntheticScene[]): Vault {
    const map: Record<string, string> = {};
    for (const s of scenes) map[s.file.path] = s.body;
    return {
        read: async (file: TFile) => map[file.path] || '',
    } as unknown as Vault;
}

function buildChapterMarkers(scenes: SyntheticScene[]): Record<string, Array<{
    sourcePath: string;
    sourceType: 'Scene';
    title: string;
    resolvedScenePath: string;
    resolvedTimelinePosition: number;
}>> {
    const markers: Record<string, Array<{
        sourcePath: string;
        sourceType: 'Scene';
        title: string;
        resolvedScenePath: string;
        resolvedTimelinePosition: number;
    }>> = {};
    let pos = 1;
    for (const s of scenes) {
        if (s.chapterMarker) {
            markers[s.file.path] = [{
                sourcePath: s.file.path,
                sourceType: 'Scene',
                title: s.chapterMarker.title,
                resolvedScenePath: s.file.path,
                resolvedTimelinePosition: pos,
            }];
        }
        pos += 1;
    }
    return markers;
}

// ── Per-layout assembly options ────────────────────────────────────────
//
// Mirrors CommandRegistrar: the runtime behavior table decides marker
// suppression, render mode, and whether chapter markers must be emitted as
// \rtChapter. The DesignedStyleSpec decides the generated template and preview
// rows. Testing those together catches spec/preview/runtime drift.

interface AssemblyContext {
    sceneHeadingMode?: ManuscriptSceneHeadingMode;
    sceneHeadingRenderMode: SceneHeadingRenderMode;
    useModernClassicStructure: boolean;
    suppressChapterMarkers: boolean;
    suppressPartMarkers: boolean;
    useRtChapterMacro: boolean;
}

const LAYOUT_META: Record<BundledFictionId, Pick<PandocLayoutTemplate, 'id' | 'name' | 'path' | 'designedSpec' | 'usesModernClassicStructure'>> = {
    'bundled-fiction-classic-manuscript': {
        id: 'bundled-fiction-classic-manuscript',
        name: 'Standard Manuscript',
        path: 'rt_classic_manuscript.tex',
        designedSpec: BUNDLED_FICTION_SPECS['bundled-fiction-classic-manuscript'],
    },
    'bundled-fiction-contemporary-literary': {
        id: 'bundled-fiction-contemporary-literary',
        name: 'Contemporary Literary',
        path: 'rt_contemporary_literary.tex',
        designedSpec: BUNDLED_FICTION_SPECS['bundled-fiction-contemporary-literary'],
    },
    'bundled-fiction-signature-literary': {
        id: 'bundled-fiction-signature-literary',
        name: 'Signature Literary',
        path: 'rt_signature_literary.tex',
        designedSpec: BUNDLED_FICTION_SPECS['bundled-fiction-signature-literary'],
    },
    'bundled-fiction-modern-classic': {
        id: 'bundled-fiction-modern-classic',
        name: 'Modern Classic',
        path: 'rt_modern_classic.tex',
        designedSpec: BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic'],
        usesModernClassicStructure: true,
    },
};

function assemblyContextForLayout(id: BundledFictionId): AssemblyContext {
    const layout = LAYOUT_META[id];
    const behavior = getManuscriptLayoutExportBehavior(layout);
    return {
        sceneHeadingMode: behavior.defaultSceneHeadingMode,
        sceneHeadingRenderMode: behavior.sceneHeadingRenderMode,
        useModernClassicStructure: layout.usesModernClassicStructure === true,
        suppressChapterMarkers: behavior.suppressChapterMarkers,
        suppressPartMarkers: behavior.suppressPartMarkers,
        useRtChapterMacro: behavior.useRtChapterMacro,
    };
}

// ── Helpers ────────────────────────────────────────────────────────────

function findFeatureRow(rows: Array<{ label: string; value: string }>, label: string): { label: string; value: string } | undefined {
    return rows.find(r => r.label === label);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('one spec, three echoes — contract alignment', () => {
    it('every bundled fiction id has a spec', () => {
        for (const id of BUNDLED_FICTION_IDS) {
            expect(BUNDLED_FICTION_SPECS[id]).toBeDefined();
        }
    });

    it('Standard Manuscript: spec → feature/picto/assembler all describe scene-number on a new page', async () => {
        const id: BundledFictionId = 'bundled-fiction-classic-manuscript';
        const spec = BUNDLED_FICTION_SPECS[id];
        const ctx = assemblyContextForLayout(id);
        const scenes = buildSyntheticScenes();
        const vault = buildVault(scenes);
        const chapterMarkers = ctx.suppressChapterMarkers
            ? {}
            : buildChapterMarkers(scenes);

        const assembled = await assembleManuscript(
            scenes.map(s => s.file),
            vault, undefined, false, undefined, false, undefined, undefined,
            {
                sceneHeadingMode: ctx.sceneHeadingMode,
                sceneHeadingRenderMode: ctx.sceneHeadingRenderMode,
                chapterMarkersByScenePath: chapterMarkers,
                useRtChapterMacro: ctx.useRtChapterMacro,
            }
        );

        // Spec floor: scene.headingMode === 'scene-number'.
        expect(spec.scene.headingMode).toBe('scene-number');

        // Assembler invokes \rtSceneOpener for every scene (the contract surface).
        const openerCount = (assembled.text.match(/\\rtSceneOpener\{/g) || []).length;
        expect(openerCount).toBe(scenes.length);

        // Old assembler form must NOT regress.
        expect(assembled.text).not.toContain('\\section*{');

        // No \rtPart, no \rtChapter — spec says parts:off and chapters:off.
        expect(assembled.text).not.toMatch(/\\rtPart\{/);
        expect(assembled.text).not.toMatch(/\\rtChapter\{/);

        // Heading inside \rtSceneOpener{...} is JUST the scene number.
        // For each scene we passed in (numeric prefix 1..6), assert the
        // opener call wraps just that digit, not the title.
        for (let i = 1; i <= scenes.length; i++) {
            const re = new RegExp(`\\\\rtSceneOpener\\{${i}\\}`);
            expect(assembled.text).toMatch(re);
        }
        // Titles must NOT leak into the opener (e.g. "Arrival", "The Garden").
        expect(assembled.text).not.toMatch(/\\rtSceneOpener\{[^}]*Garden/);
        expect(assembled.text).not.toMatch(/\\rtSceneOpener\{[^}]*Arrival/);

        // Pictogram: scene right page has specialText that's a digit, body
        // lines render below the heading, and the heading anchors at the top
        // of the page (matches generator behavior — heading + body share a
        // page).
        const picto = getPictogramRowsFromSpec(spec);
        expect(picto.scene?.rightPage?.specialText).toMatch(/^\d+$/);
        expect(picto.scene?.rightPage?.bodyLines).toBeGreaterThanOrEqual(1);
        expect(picto.scene?.rightPage?.headingPosition).toBe('top');
        expect(picto.special).toEqual([]); // no PART, no CHAPTER spread

        // Feature row "Scenes" must mention BOTH "scene number" and "body" —
        // dedicated-page openers in Standard / Contemporary share the page
        // with body text, so the description must convey both axes.
        const features = getLayoutFeaturesFromSpec(spec);
        const scenesRow = findFeatureRow(features, 'Scenes');
        expect(scenesRow).toBeDefined();
        expect(scenesRow!.value.toLowerCase()).toMatch(/scene number/);
        expect(scenesRow!.value.toLowerCase()).toMatch(/body/);

        // The .tex must define \rtSceneOpener.
        const tex = generateDesignedStyleTex(spec, { bundledLayoutId: id });
        expect(tex).toContain('\\newcommand{\\rtSceneOpener}[1]');
    });

    it('Modern Classic: spec → feature/picto/assembler all describe parts + chapters + roman-rule scenes', async () => {
        const id: BundledFictionId = 'bundled-fiction-modern-classic';
        const spec = BUNDLED_FICTION_SPECS[id];
        const ctx = assemblyContextForLayout(id);
        const scenes = buildSyntheticScenes();
        const vault = buildVault(scenes);

        // Modern Classic emits \rtPart at every Part marker. Markers
        // come from each scene's own `Act:` frontmatter field (see
        // buildSyntheticScenes): scenes 1–4 are Act 1, scenes 5–6 are Act 2,
        // so we expect exactly two \rtPart calls.
        const assembled = await assembleManuscript(
            scenes.map(s => s.file),
            vault, undefined, false, undefined, false, undefined, undefined,
            {
                sceneHeadingMode: ctx.sceneHeadingMode,
                sceneHeadingRenderMode: ctx.sceneHeadingRenderMode,
                chapterMarkersByScenePath: buildChapterMarkers(scenes),
                useRtChapterMacro: ctx.useRtChapterMacro,
                modernClassicStructure: {
                    enabled: true,
                    partEpigraphs: ['Quote one.', 'Quote two.'],
                    partEpigraphAttributions: ['Author A', 'Author B'],
                },
            }
        );

        // Two markers → exactly two grouped \rtPart{roman}{title}{quote}{attribution} calls.
        expect((assembled.text.match(/\\rtPart\{/g) || []).length).toBe(2);
        // Roman-numeral act labels (parts.mode === 'roman'). The title slot is
        // empty while Parts remain Act-derived — an Act has no name to print —
        // and the macro \ifstrempty-guards it, so the typeset result is unchanged.
        expect(assembled.text).toContain('\\rtPart{I}{}{Quote one.}{Author A}');
        expect(assembled.text).toContain('\\rtPart{II}{}{Quote two.}{Author B}');
        // Three chapter markers in the fixture → three \rtChapter calls.
        expect((assembled.text.match(/\\rtChapter\{/g) || []).length).toBe(3);
        // Chapters carry their titles (numbered-titled mode).
        expect(assembled.text).toContain('Boy with a Skull');
        expect(assembled.text).toContain('New Horizons');
        // Scene openers: roman-with-rule path uses explicit \rtSceneSep{roman}.
        expect(assembled.text).toContain('\\rtSceneSep');
        expect((assembled.text.match(/\\rtSceneSep\{/g) || []).length).toBe(scenes.length);
        expect(Array.from(assembled.text.matchAll(/\\rtSceneSep\{([^}]+)\}/g)).map(match => match[1]))
            .toEqual(['i', 'ii', 'iii', 'iv', 'i', 'ii']);
        // Modern Classic does NOT use \rtSceneOpener (its opener is roman-with-rule, inline).
        expect(assembled.text).not.toContain('\\rtSceneOpener{');
        // Epigraphs are grouped into the Part opener, not emitted as a second page.
        expect(assembled.text).not.toContain('\\rtEpigraph');

        // Pictogram: roman-rule scene + PART + CHAPTER spreads.
        const picto = getPictogramRowsFromSpec(spec);
        expect(picto.scene?.rightPage?.separatorText).toMatch(/^[ivxlcdm]+\.$/);
        const partSpread = picto.special.find(s => s.label === 'PART');
        expect(partSpread).toBeDefined();
        expect(partSpread!.rightPage?.specialText).toMatch(/^[IVX]+$/);
        const chapterSpread = picto.special.find(s => s.label === 'CHAPTER');
        expect(chapterSpread).toBeDefined();

        // Feature rows include Parts + Chapters + Scenes.
        const features = getLayoutFeaturesFromSpec(spec);
        expect(findFeatureRow(features, 'Parts')).toBeDefined();
        expect(findFeatureRow(features, 'Chapters')).toBeDefined();
        const scenesRow = findFeatureRow(features, 'Scenes');
        expect(scenesRow).toBeDefined();
        // "Roman" + "rule" tokens are the meaningful semantic markers.
        expect(scenesRow!.value.toLowerCase()).toMatch(/roman/);
        expect(scenesRow!.value.toLowerCase()).toMatch(/rule/);
    });

    it('Signature Literary: spec → three scene-mode pictogram spreads, no PART/CHAPTER, no \\rtChapter in assembler output', async () => {
        const id: BundledFictionId = 'bundled-fiction-signature-literary';
        const spec = BUNDLED_FICTION_SPECS[id];
        const ctx = assemblyContextForLayout(id);
        const scenes = buildSyntheticScenes();
        const vault = buildVault(scenes);
        // chapters.mode === 'off' → suppress markers (mirrors the export pipeline).
        const chapterMarkers = ctx.suppressChapterMarkers ? {} : buildChapterMarkers(scenes);

        const assembled = await assembleManuscript(
            scenes.map(s => s.file),
            vault, undefined, false, undefined, false, undefined, undefined,
            {
                sceneHeadingMode: ctx.sceneHeadingMode,
                sceneHeadingRenderMode: ctx.sceneHeadingRenderMode,
                chapterMarkersByScenePath: chapterMarkers,
                useRtChapterMacro: ctx.useRtChapterMacro,
            }
        );

        // Each scene → one \rtSceneOpener call. Signature's spec defines
        // \rtSceneOpener as a thin wrapper around \section*{} so titlesec
        // hooks fire and render the user-selected mode. With no saved user
        // override, assembly falls back to scene-number-title.
        expect((assembled.text.match(/\\rtSceneOpener\{/g) || []).length).toBe(scenes.length);
        expect(assembled.text).toContain('\\rtSceneOpener{1\\\\{\\normalsize (Arrival)}}');
        // No PART, no CHAPTER pages.
        expect(assembled.text).not.toMatch(/\\rtPart\{/);
        expect(assembled.text).not.toMatch(/\\rtChapter\{/);

        // Pictogram: no top-row scene spread; three special-row spreads with sceneMode.
        const picto = getPictogramRowsFromSpec(spec);
        expect(picto.scene).toBeNull();
        const sceneModes = picto.special.map(s => s.sceneMode).filter(Boolean);
        expect(sceneModes).toEqual(['scene-number', 'scene-number-title', 'title-only']);
        expect(picto.special.find(s => s.label === 'PART')).toBeUndefined();
        expect(picto.special.find(s => s.label === 'CHAPTER')).toBeUndefined();

        // Feature rows: three scene-mode rows present.
        const features = getLayoutFeaturesFromSpec(spec);
        expect(findFeatureRow(features, 'Scene #')).toBeDefined();
        expect(findFeatureRow(features, 'Scene #+T')).toBeDefined();
        expect(findFeatureRow(features, 'Scene T')).toBeDefined();
        // No Parts row, no Chapters row.
        expect(findFeatureRow(features, 'Parts')).toBeUndefined();
        expect(findFeatureRow(features, 'Chapters')).toBeUndefined();

        // .tex defines \rtSceneOpener as a section-starred wrapper.
        const tex = generateDesignedStyleTex(spec, { bundledLayoutId: id });
        expect(tex).toContain('\\newcommand{\\rtSceneOpener}[1]');
    });

    it('Contemporary Literary: spec → numbered chapter pages + dedicated scene-opener pages', async () => {
        const id: BundledFictionId = 'bundled-fiction-contemporary-literary';
        const spec = BUNDLED_FICTION_SPECS[id];
        const ctx = assemblyContextForLayout(id);
        const scenes = buildSyntheticScenes();
        const vault = buildVault(scenes);

        const assembled = await assembleManuscript(
            scenes.map(s => s.file),
            vault, undefined, false, undefined, false, undefined, undefined,
            {
                sceneHeadingMode: ctx.sceneHeadingMode,
                sceneHeadingRenderMode: ctx.sceneHeadingRenderMode,
                chapterMarkersByScenePath: buildChapterMarkers(scenes),
                useRtChapterMacro: ctx.useRtChapterMacro,
            }
        );

        // Each scene → one \rtSceneOpener call.
        expect((assembled.text.match(/\\rtSceneOpener\{/g) || []).length).toBe(scenes.length);
        // No \rtPart (parts.mode === 'off').
        expect(assembled.text).not.toMatch(/\\rtPart\{/);
        // Three chapter markers in the fixture → three \rtChapter calls.
        // This must mirror the export pipeline; a markdown "# Chapter" here
        // falls through to Pandoc/book defaults and drifts from the preview.
        expect((assembled.text.match(/\\rtChapter\{/g) || []).length).toBe(3);
        const h1Chapters = (assembled.text.match(/^# /gm) || []).length;
        expect(h1Chapters).toBe(0);

        // Heading inside the scene opener is just the scene number (spec floor).
        for (let i = 1; i <= scenes.length; i++) {
            const re = new RegExp(`\\\\rtSceneOpener\\{${i}\\}`);
            expect(assembled.text).toMatch(re);
        }

        // Pictogram: dedicated scene + numbered-only chapter page.
        const picto = getPictogramRowsFromSpec(spec);
        expect(picto.scene?.rightPage?.specialText).toMatch(/^\d+$/);
        const chapterSpread = picto.special.find(s => s.label === 'CHAPTER');
        expect(chapterSpread).toBeDefined();
        expect(chapterSpread!.rightPage?.bodyLines).toBe(0);

        // Feature rows: Chapters + Scenes both present, no Parts.
        const features = getLayoutFeaturesFromSpec(spec);
        expect(findFeatureRow(features, 'Parts')).toBeUndefined();
        expect(findFeatureRow(features, 'Chapters')).toBeDefined();
        const scenesRow = findFeatureRow(features, 'Scenes');
        expect(scenesRow).toBeDefined();
        expect(scenesRow!.value.toLowerCase()).toMatch(/scene number/);
        expect(scenesRow!.value.toLowerCase()).toMatch(/body/);
    });

    // Cross-cutting cohesion check: for every bundled spec, the digit shown
    // in the pictogram, the headingMode in the spec, and the heading content
    // emitted by the assembler all agree.
    for (const id of BUNDLED_FICTION_IDS) {
        it(`${id}: pictogram and assembler agree on the spec's headingMode`, async () => {
            const spec = BUNDLED_FICTION_SPECS[id];
            const ctx = assemblyContextForLayout(id);
            // Skip Modern Classic — its scene opener is inline, not a dedicated
            // page, so the contract surface is \rtSceneSep not \rtSceneOpener.
            if (spec.scene.opener !== 'dedicated-page') return;

            const scenes = buildSyntheticScenes();
            const vault = buildVault(scenes);
            const chapterMarkers = ctx.suppressChapterMarkers ? {} : buildChapterMarkers(scenes);

            const assembled = await assembleManuscript(
                scenes.map(s => s.file),
                vault, undefined, false, undefined, false, undefined, undefined,
                {
                    sceneHeadingMode: ctx.sceneHeadingMode,
                    sceneHeadingRenderMode: ctx.sceneHeadingRenderMode,
                    chapterMarkersByScenePath: chapterMarkers,
                    useRtChapterMacro: ctx.useRtChapterMacro,
                }
            );

            const resolvedMode = ctx.sceneHeadingMode ?? 'scene-number-title';
            if (resolvedMode === 'scene-number') {
                // Every \rtSceneOpener{...} payload must be just digits.
                const matches = Array.from(assembled.text.matchAll(/\\rtSceneOpener\{([^}]+)\}/g));
                for (const m of matches) {
                    expect(m[1]).toMatch(/^\d+$/);
                }
            } else if (resolvedMode === 'scene-number-title') {
                expect(assembled.text).toMatch(/\\rtSceneOpener\{\d+\\\\\{\\normalsize \([^)]+\)\}\}/);
            } else {
                expect(assembled.text).toMatch(/\\rtSceneOpener\{[A-Za-z]/);
            }
        });
    }
});
