import { t } from '../i18n';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { orderSketches, sketchAnchor, SKETCH_ORDER, type PlacementItem } from './sketchPlacement';
import type { CanvasCard } from './canvasSketches';

/** A predictable starting order; the author can adjust it in the dialog. */
export function canvasReadingOrder<T extends CanvasCard>(cards: T[]): T[] {
    const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    return [...cards].sort((a, b) => coordinate(a.y) - coordinate(b.y) || coordinate(a.x) - coordinate(b.x));
}

/** Keep existing sketches in order, assigning ranks only where an old sketch lacks one. */
export function planCanvasSketchAppend(items: PlacementItem[], act: number | null, anchor: string | null, count: number): {
    missing: Array<{ path: string; rank: number }>;
    ranks: number[];
} {
    const ordered = orderSketches(items);
    const existing = ordered.items.filter(item => item.row.kind === 'sketch' && item.row.act === act
        && (anchor ? sketchAnchor(item.frontmatter) === anchor && !ordered.problems.has(item.row.path)
            : !sketchAnchor(item.frontmatter) || ordered.problems.has(item.row.path)));
    const rank = (fm?: Record<string, unknown>) => {
        const value = readFrontmatterProperty(fm, SKETCH_ORDER);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    let next = Math.max(0, ...existing.map(item => rank(item.frontmatter) ?? 0)); // SAFE: unranked sketches don't raise the max; the loop below ranks them after it
    const missing: Array<{ path: string; rank: number }> = [];
    for (const item of existing) {
        if (rank(item.frontmatter) !== null) continue;
        next += 10;
        if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER) throw new Error(t('ui.timetable.sketchOrderTooLarge'));
        missing.push({ path: item.row.path, rank: next });
    }
    const ranks: number[] = [];
    for (let index = 0; index < count; index++) {
        next += 10;
        if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER) throw new Error(t('ui.timetable.sketchOrderTooLarge'));
        ranks.push(next);
    }
    return { missing, ranks };
}
