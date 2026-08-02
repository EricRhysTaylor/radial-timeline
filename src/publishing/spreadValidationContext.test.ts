import { describe, expect, it } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { BookProfile, PandocLayoutTemplate } from '../types';
import {
    applySpreadValidation,
    collectSpreadStatuses,
    getLayoutPictogramRows,
} from './layoutVisuals';
import {
    buildSpreadValidationContext,
    collectSpreadWarningTooltips,
} from './spreadValidationContext';

// ── Test helpers ───────────────────────────────────────────────────────
//
// Build the smallest plugin shape buildSpreadValidationContext needs: it
// reads only `plugin.settings.books` + `plugin.settings.activeBookId`.

function makePlugin(books: BookProfile[] = [], activeBookId?: string): RadialTimelinePlugin {
    return {
        settings: {
            books,
            activeBookId,
        },
    } as unknown as RadialTimelinePlugin;
}

function makeLayout(overrides: Partial<PandocLayoutTemplate> = {}): PandocLayoutTemplate {
    return {
        id: 'bundled-fiction-modern-classic',
        name: 'Modern Classic',
        preset: 'novel',
        path: 'rt_modern_classic.tex',
        ...overrides,
    };
}

function makeBook(overrides: Partial<BookProfile> = {}): BookProfile {
    return {
        id: 'book-1',
        title: 'Test Book',
        sourceFolder: 'Manuscript',
        ...overrides,
    };
}

// ── buildSpreadValidationContext ───────────────────────────────────────

describe('buildSpreadValidationContext', () => {
    it('mirrors the modal logic for a fully-populated selection', () => {
        const layout = makeLayout();
        const book = makeBook({
            layoutOptions: {
                [layout.id]: {
                    partEpigraphs: ['', 'Quote two', 'Quote three'],
                },
            },
        });
        const plugin = makePlugin([book], book.id);

        const ctx = buildSpreadValidationContext(plugin, {
            layout,
            selectedScenePaths: ['s1.md', 's2.md', 's3.md'],
            selectedSceneTitles: ['Title 1', 'Title 2', ''],
            selectedSceneActs: [1, 1, 2],
            chapterMarkersByScenePath: {
                's1.md': [{ title: 'Ch 1' }, { title: '' }],
                's2.md': [{ title: 'Ch 2' }],
                'unselected.md': [{ title: 'ignore me' }],
            },
        });

        expect(ctx.actCount).toBe(2);
        expect(ctx.chapterFieldCount).toBe(3);
        expect(ctx.partEpigraphPopulatedCount).toBe(2);
        expect(ctx.chapterTitlePopulatedCount).toBe(2);
        expect(ctx.sceneTitlePopulatedRatio).toBeCloseTo(2 / 3);
    });

    it('returns sentinel actCount + chapterFieldCount and omits chapter-title check when no selection supplied', () => {
        // Settings → Publish call site: passes only `layout` (no scene data).
        // The validation gates must NOT fire on a data-less surface.
        const layout = makeLayout();
        const ctx = buildSpreadValidationContext(makePlugin(), { layout });

        expect(ctx.actCount).toBe(Number.POSITIVE_INFINITY);
        expect(ctx.chapterFieldCount).toBe(Number.POSITIVE_INFINITY);
        expect(ctx.partEpigraphPopulatedCount).toBe(0);
        expect(ctx.sceneTitlePopulatedRatio).toBe(1);
        expect(ctx.chapterTitlePopulatedCount).toBeUndefined();
    });

    it('returns 0 epigraphs when no active book / no layoutOptions', () => {
        const plugin = makePlugin([], undefined);
        const ctx = buildSpreadValidationContext(plugin, { layout: makeLayout() });
        expect(ctx.partEpigraphPopulatedCount).toBe(0);
    });

    it('feeds the modal warning path: 1-Act selection trips PART warning', () => {
        const layout = makeLayout();
        const plugin = makePlugin([makeBook()], 'book-1');
        const ctx = buildSpreadValidationContext(plugin, {
            layout,
            selectedScenePaths: ['s1.md', 's2.md'],
            selectedSceneTitles: ['t1', 't2'],
            selectedSceneActs: [1, 1],
            chapterMarkersByScenePath: { 's1.md': [{ title: 'Ch' }] },
        });
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);
        const part = rows.special.find(s => s.label === 'PART');
        expect(part?.warningLevel).toBe('warning');
        expect(part?.warningTooltip).toMatch(/fewer than two Acts/);
    });

    it('feeds the settings preview path: data-less context produces no warnings on Modern Classic', () => {
        // Mirrors the Settings → Publish render: no scene selection, layout only.
        const layout = makeLayout();
        const plugin = makePlugin([makeBook({
            layoutOptions: {
                [layout.id]: { partEpigraphs: ['Quote'] }, // epigraph populated → no warning
            },
        })], 'book-1');

        const ctx = buildSpreadValidationContext(plugin, { layout });
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);

        for (const spread of rows.special) {
            expect(spread.warningLevel).toBeUndefined();
        }
    });

    it('settings preview: PART-epigraph advisory still fires when book has no quotes (book-derived signal)', () => {
        // The epigraph check is BOOK-derived and surfaces in the settings panel.
        const layout = makeLayout();
        const plugin = makePlugin([makeBook()], 'book-1'); // no partEpigraphs

        const ctx = buildSpreadValidationContext(plugin, { layout });
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);

        const part = rows.special.find(s => s.label === 'PART');
        expect(part?.warningLevel).toBe('warning');
        expect(part?.warningTooltip).toMatch(/epigraph/i);
    });

    it('uses precomputed book-wide counts when no scene selection is supplied', () => {
        // Settings → Publish has no scene selection. Callers that have
        // already loaded book-wide chapter data may pass the precomputed
        // counts so the chapter check becomes meaningful instead of
        // returning the Infinity sentinel.
        const layout = makeLayout();
        const plugin = makePlugin([makeBook()], 'book-1');

        const ctx = buildSpreadValidationContext(plugin, {
            layout,
            bookActCount: 3,
            bookChapterFieldCount: 5,
            bookChapterTitlePopulatedCount: 5,
        });

        expect(ctx.actCount).toBe(3);
        expect(ctx.chapterFieldCount).toBe(5);
        expect(ctx.chapterTitlePopulatedCount).toBe(5);
    });

    it('falls back to Infinity when no selection AND no precomputed book counts (back-compat)', () => {
        const layout = makeLayout();
        const ctx = buildSpreadValidationContext(makePlugin(), { layout });
        expect(ctx.actCount).toBe(Number.POSITIVE_INFINITY);
        expect(ctx.chapterFieldCount).toBe(Number.POSITIVE_INFINITY);
        expect(ctx.chapterTitlePopulatedCount).toBeUndefined();
    });

    it('precomputed bookChapterFieldCount surfaces a CHAPTER warning when zero chapters in book', () => {
        // Documents the round-trip: book-wide data → context → validation.
        // A book scanned with zero chapter markers should flag missing
        // chapters in Settings just like a 0-marker selection does in the modal.
        const layout = makeLayout();
        const plugin = makePlugin([makeBook()], 'book-1');
        const ctx = buildSpreadValidationContext(plugin, {
            layout,
            bookActCount: 3,
            bookChapterFieldCount: 0,
        });
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);
        const chapter = rows.special.find(s => s.label === 'CHAPTER');
        expect(chapter?.warningLevel).toBe('warning');
        expect(chapter?.warningTooltip).toMatch(/no scenes have a Chapter field/);
    });
});

// ── collectSpreadWarningTooltips ───────────────────────────────────────

describe('collectSpreadWarningTooltips', () => {
    it('returns an empty array when no spread carries a warning', () => {
        // Full population (N-of-N) — partial-population gate is silent here.
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), {
            actCount: 3,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 3,
            chapterTitlePopulatedCount: 5,
            sceneTitlePopulatedRatio: 1,
        });
        expect(collectSpreadWarningTooltips(rows)).toEqual([]);
    });

    it('emits one entry per warning, in canonical row order', () => {
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), {
            actCount: 1,           // PART warns: fewer than two Acts
            chapterFieldCount: 0,  // CHAPTER warns: no Chapter field set
        });
        const tips = collectSpreadWarningTooltips(rows);
        expect(tips).toHaveLength(2);
        // PART before CHAPTER (canonical iteration order — special[] order).
        expect(tips[0]).toMatch(/fewer than two Acts/);
        expect(tips[1]).toMatch(/no scenes have a Chapter field/);
    });

    it('dedupes identical tooltip strings emitted by multiple spreads', () => {
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), {
            actCount: 1,
            chapterFieldCount: 5,
        });
        // Synthetically push a second PART-like spread with the same tooltip
        // to prove dedup. (Real spreads can't normally collide, but the
        // dedup guard keeps the line-item rendering robust if they do.)
        const tooltip = rows.special.find(s => s.label === 'PART')?.warningTooltip;
        expect(tooltip).toBeTruthy();
        const duplicated = {
            ...rows,
            special: [
                ...rows.special,
                {
                    label: 'PART',
                    leftPage: null,
                    rightPage: null,
                    warningLevel: 'warning' as const,
                    warningTooltip: tooltip,
                },
            ],
        };
        const tips = collectSpreadWarningTooltips(duplicated);
        const partTipCount = tips.filter(t => t === tooltip).length;
        expect(partTipCount).toBe(1);
    });
});

// ── collectSpreadStatuses ──────────────────────────────────────────────

describe('collectSpreadStatuses', () => {
    it('emits a success status when every act has an epigraph quote', () => {
        const ctx = {
            actCount: 3,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 3,
            chapterTitlePopulatedCount: 5,
            sceneTitlePopulatedRatio: 1,
        };
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);
        const statuses = collectSpreadStatuses(rows, ctx);
        const parts = statuses.find(s => s.id === 'parts-count');
        const epigraphs = statuses.find(s => s.id === 'epigraphs-populated');
        expect(parts).toBeDefined();
        expect(parts?.tone).toBe('info');
        expect(parts?.text).toMatch(/3 Acts configured/);
        expect(epigraphs).toBeDefined();
        expect(epigraphs?.tone).toBe('success');
        expect(epigraphs?.text).toMatch(/Epigraphs populated/i);
    });

    it('emits a success status when every chapter has a title', () => {
        const ctx = {
            actCount: 3,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 3,
            chapterTitlePopulatedCount: 5,
            sceneTitlePopulatedRatio: 1,
        };
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);
        const statuses = collectSpreadStatuses(rows, ctx);
        const ch = statuses.find(s => s.id === 'chapters-count');
        const titled = statuses.find(s => s.id === 'chapter-titles-count');
        expect(ch).toBeDefined();
        expect(ch?.tone).toBe('info');
        expect(ch?.text).toMatch(/5 Chapters configured/);
        expect(titled).toBeDefined();
        expect(titled?.tone).toBe('success');
        expect(titled?.text).toMatch(/Chapter titles populated/i);
    });

    it('emits NOTHING for spreads in warning state (dedup with warnings)', () => {
        // Partial epigraph state → PART carries warning. Status must skip it.
        const ctx = {
            actCount: 3,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 2,  // partial → warning
            chapterTitlePopulatedCount: 5, // full → success
            sceneTitlePopulatedRatio: 1,
        };
        const rows = applySpreadValidation(getLayoutPictogramRows('modernClassic'), ctx);
        const statuses = collectSpreadStatuses(rows, ctx);
        // No PART status (warning handles it).
        expect(statuses.find(s => s.id === 'parts-count')).toBeUndefined();
        // Chapter status still present (full population, no warning).
        expect(statuses.find(s => s.id === 'chapters-count')).toBeDefined();
    });

    it('emits NOTHING for layouts that do not advertise the feature', () => {
        // Standard Manuscript (classic): no PART/CHAPTER spreads at all.
        const ctx = {
            actCount: 3,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 3,
            chapterTitlePopulatedCount: 5,
            sceneTitlePopulatedRatio: 1,
        };
        const rows = applySpreadValidation(getLayoutPictogramRows('classic'), ctx);
        const statuses = collectSpreadStatuses(rows, ctx);
        // Nothing to advertise — empty status list.
        expect(statuses).toEqual([]);
    });

    it('emits an info "Acts configured" when ≥2 acts and the layout has no epigraph feature', () => {
        // Hypothetical: PART spread without epigraphText → falls into the
        // bare-count branch. Construct rows by stripping epigraphText.
        const baseRows = getLayoutPictogramRows('modernClassic');
        const strippedSpecial = baseRows.special.map(s => {
            if (s.label !== 'PART' || !s.rightPage) return s;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { epigraphText, epigraphAttribution, specialRule, ...rest } = s.rightPage;
            return { ...s, rightPage: rest };
        });
        const rows = { ...baseRows, special: strippedSpecial };
        const ctx = {
            actCount: 4,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 0, // ignored — feature not advertised
            chapterTitlePopulatedCount: 5,
            sceneTitlePopulatedRatio: 1,
        };
        const validated = applySpreadValidation(rows, ctx);
        const statuses = collectSpreadStatuses(validated, ctx);
        const parts = statuses.find(s => s.id === 'parts-count');
        expect(parts).toBeDefined();
        expect(parts?.tone).toBe('info');
        expect(parts?.text).toMatch(/4 Acts/);
    });

    it('emits a "all selected scenes have titles" success when title-only mode is fully populated', () => {
        const ctx = {
            actCount: 3,
            chapterFieldCount: 5,
            partEpigraphPopulatedCount: 0,
            sceneTitlePopulatedRatio: 1,
        };
        const rows = applySpreadValidation(getLayoutPictogramRows('signature'), ctx);
        const statuses = collectSpreadStatuses(rows, ctx);
        const scene = statuses.find(s => s.id === 'scene-titles-count');
        expect(scene).toBeDefined();
        expect(scene?.tone).toBe('success');
        expect(scene?.text).toMatch(/all selected scenes/i);
    });
});
