/*
 * Shared builder for SpreadValidationContext.
 *
 * Single source of truth for converting scene-selection inputs into the
 * counts that drive applySpreadValidation. Both the Manuscript Options
 * modal and the Settings → Publish preview rely on this helper so the
 * preview-card warnings stay consistent across surfaces.
 */
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate } from '../types';
import { getActiveBook } from '../utils/books';
import type {
    LayoutPictogramRows,
    PictogramSpread,
    SpreadValidationContext,
} from './layoutVisuals';

export interface SpreadValidationInputs {
    /** Layout being validated (its spec advertises which features are promised). */
    layout?: PandocLayoutTemplate;
    /** Selected scene paths — drives chapter-field/title aggregations. */
    selectedScenePaths?: string[];
    /** Per-scene-path chapter markers (already computed by the modal). */
    chapterMarkersByScenePath?: Record<string, Array<{ title?: unknown }> | unknown[]>;
    /** Selected scene titles (parallel array to selectedScenePaths). */
    selectedSceneTitles?: string[];
    /** Selected per-scene act numbers (parallel to selectedScenePaths). */
    selectedSceneActs?: Array<number | null>;
    /**
     * Precomputed BOOK-wide counts for surfaces that have no scene selection
     * (Settings → Publish). When `selectedScenePaths` is undefined and these
     * are supplied, the helper uses them in place of the sentinel Infinity
     * values, enabling status/warning lines on the data-less surface.
     *
     * Trade-off: book-wide chapter scanning requires the async
     * `getSceneFilesByOrder` accessor + `resolveTimelineChapterMarkers`,
     * which the synchronous Settings render path cannot await. Callers that
     * have already loaded scene data may pass these explicit counts; the
     * Settings panel today does not, and so still falls back to Infinity for
     * chapter/title checks (PART card flagging continues to work via the
     * book-derived `partEpigraphPopulatedCount`).
     */
    bookActCount?: number;
    bookChapterFieldCount?: number;
    bookChapterTitlePopulatedCount?: number;
}

/**
 * Build a SpreadValidationContext from scene-selection inputs.
 *
 * Behavior matches the modal's per-method context-builder logic exactly:
 *   - actCount               → distinct numeric Acts in selectedSceneActs.
 *   - chapterFieldCount      → total chapter markers across selectedScenePaths.
 *                              When selection is empty / not supplied, returns
 *                              a high sentinel (Number.POSITIVE_INFINITY) so
 *                              the "no chapter pages" warning does not fire on
 *                              data-less surfaces (settings preview).
 *   - partEpigraphPopulatedCount → non-empty entries in
 *                              book.layoutOptions[layoutId].partEpigraphs[].
 *                              Always derivable from book settings — supplied
 *                              regardless of selection state.
 *   - chapterTitlePopulatedCount → markers across selection whose title is
 *                              non-empty. Omitted when selection is empty so
 *                              the title check skips (gates on typeof number).
 *   - sceneTitlePopulatedRatio → fraction of selected scenes with a non-empty
 *                              title. Defaults to 1 when no scenes selected
 *                              (matches the existing modal behavior).
 *
 * Pure / deterministic. Reads only book settings + supplied inputs.
 */
export function buildSpreadValidationContext(
    plugin: RadialTimelinePlugin,
    inputs: SpreadValidationInputs,
): SpreadValidationContext {
    const selectedPaths = inputs.selectedScenePaths ?? [];
    const selectedActs = inputs.selectedSceneActs ?? [];
    const selectedTitles = inputs.selectedSceneTitles ?? [];
    const markersByPath = inputs.chapterMarkersByScenePath ?? {};
    const hasSelection = selectedPaths.length > 0;

    // actCount — distinct finite numeric acts among the selection.
    const seenActs = new Set<number>();
    for (const act of selectedActs) {
        if (typeof act === 'number' && Number.isFinite(act)) seenActs.add(act);
    }
    // Resolution order for actCount when no scene-selection data is supplied:
    //   1. Caller-supplied `bookActCount` (precomputed book-wide scan)
    //   2. `plugin.settings.actCount` — the canonical book-wide act count, sync
    //      and always available. This is what the BookDesigner / progress UI
    //      already use as the source of truth, so the Settings publish surface
    //      can rely on it without doing its own async scan.
    //   3. POSITIVE_INFINITY as a last-resort sentinel that disables the gate.
    const settingsActCount = (() => {
        const raw = (plugin?.settings as { actCount?: number } | undefined)?.actCount;
        return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
    })();
    const actCount = hasSelection
        ? seenActs.size
        : (typeof inputs.bookActCount === 'number'
            ? inputs.bookActCount
            : (settingsActCount ?? Number.POSITIVE_INFINITY));

    // chapterFieldCount — total markers across selected scenes.
    let chapterFieldCount = 0;
    let chapterTitlePopulatedCount = 0;
    if (hasSelection) {
        const selectedSet = new Set(selectedPaths);
        for (const [scenePath, markers] of Object.entries(markersByPath)) {
            if (!selectedSet.has(scenePath)) continue;
            if (!Array.isArray(markers)) continue;
            chapterFieldCount += markers.length;
            for (const marker of markers) {
                const title = (marker as { title?: unknown })?.title;
                if (typeof title === 'string' && title.trim().length > 0) {
                    chapterTitlePopulatedCount += 1;
                }
            }
        }
    }
    // Same rationale as actCount: data-less surfaces fall back to Infinity
    // unless the caller supplied a precomputed `bookChapterFieldCount`.
    const effectiveChapterFieldCount = hasSelection
        ? chapterFieldCount
        : (typeof inputs.bookChapterFieldCount === 'number'
            ? inputs.bookChapterFieldCount
            : Number.POSITIVE_INFINITY);

    // sceneTitlePopulatedRatio — fraction of selected scenes with a title.
    // Returns 1 when selection is empty (no warning).
    const populatedTitles = selectedTitles.filter(
        title => typeof title === 'string' && title.trim().length > 0,
    );
    const sceneTitlePopulatedRatio = selectedTitles.length === 0
        ? 1
        : populatedTitles.length / selectedTitles.length;

    // partEpigraphPopulatedCount — book-settings-derived; always available.
    const partEpigraphPopulatedCount = countPartEpigraphsForLayout(plugin, inputs.layout);

    const ctx: SpreadValidationContext = {
        actCount,
        chapterFieldCount: effectiveChapterFieldCount,
        partEpigraphPopulatedCount,
        sceneTitlePopulatedRatio,
    };
    // Only include chapterTitlePopulatedCount when we actually have selection
    // data — otherwise the title-mode check would gate-pass on a synthesized
    // 0 and falsely warn. The validation gate uses `typeof === 'number'` so
    // omitting the field skips the check entirely.
    // For data-less surfaces, callers may supply `bookChapterTitlePopulatedCount`
    // explicitly to enable the title-mode check on book-wide data.
    if (hasSelection) {
        ctx.chapterTitlePopulatedCount = chapterTitlePopulatedCount;
    } else if (typeof inputs.bookChapterTitlePopulatedCount === 'number') {
        ctx.chapterTitlePopulatedCount = inputs.bookChapterTitlePopulatedCount;
    }
    return ctx;
}

function countPartEpigraphsForLayout(
    plugin: RadialTimelinePlugin,
    layout: PandocLayoutTemplate | undefined,
): number {
    if (!layout) return 0;
    const book = getActiveBook(plugin.settings);
    if (!book) return 0;
    const epigraphs = book.layoutOptions?.[layout.id]?.partEpigraphs;
    if (!Array.isArray(epigraphs)) return 0;
    return epigraphs.reduce<number>((sum, value) => {
        if (typeof value === 'string' && value.trim().length > 0) return sum + 1;
        return sum;
    }, 0);
}

/**
 * Collect distinct warning tooltips from a validated rows object.
 *
 * Used by the Export Checks panel to surface spread-validation warnings as
 * line items. Iterates rows in canonical order (top-row scene → BODY →
 * special spreads in array order) and dedupes by tooltip string so a single
 * warning never appears twice.
 *
 * Pure / deterministic.
 */
export function collectSpreadWarningTooltips(rows: LayoutPictogramRows): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const visit = (spread: PictogramSpread | null | undefined) => {
        if (!spread || spread.warningLevel !== 'warning') return;
        const tip = spread.warningTooltip;
        if (!tip || seen.has(tip)) return;
        seen.add(tip);
        out.push(tip);
    };
    visit(rows.scene);
    visit(rows.body);
    for (const spread of rows.special) visit(spread);
    return out;
}
