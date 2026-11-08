import { t } from '../i18n';
import { orderSketches, sketchAnchor, sketchOrder, type PlacementItem } from './sketchPlacement';
import { actCardNumber, storyAxis } from './canvasNavigation';
import type { CanvasCard } from './canvasSketches';

/** A predictable starting order; the author can adjust it in the dialog. */
export function canvasReadingOrder<T extends CanvasCard>(cards: T[]): T[] {
    const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    return [...cards].sort((a, b) => coordinate(a.y) - coordinate(b.y) || coordinate(a.x) - coordinate(b.x));
}

/** Cards in order, shared across the acts. Earlier acts take any cards left over. */
export function spreadAcrossActs(ids: string[], actCount: number): Map<string, number> {
    const acts = new Map<string, number>();
    const size = Math.floor(ids.length / actCount);
    const extra = ids.length % actCount;
    let index = 0;
    for (let act = 1; act <= actCount; act++) {
        const count = size + (act <= extra ? 1 : 0);
        for (const id of ids.slice(index, index + count)) acts.set(id, act);
        index += count;
    }
    return acts;
}

/**
 * Each card joins the last Act card before it. Act cards stacked down the map
 * read top to bottom; Act cards laid out along the top read left to right.
 * A card ahead of every Act card joins Act 1.
 */
export function actsFromActCards(cards: CanvasCard[], actCards: CanvasCard[]): Map<string, number> {
    const position = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    const across = actCards.length > 1 && storyAxis(actCards as Array<{ x?: number; y?: number; width?: number; height?: number }>)?.axis === 'x';
    const headings = new Set(actCards);
    const ordered = across
        ? [...cards, ...actCards].sort((a, b) => position(a.x) - position(b.x) || position(a.y) - position(b.y))
        : canvasReadingOrder([...cards, ...actCards]);
    const acts = new Map<string, number>();
    let act = 1;
    for (const card of ordered) {
        if (headings.has(card)) act = actCardNumber(card.text ?? '') ?? act; // SAFE: an Act card always has text; a No act heading leaves the act as it is
        else acts.set(card.id, act);
    }
    return acts;
}

/** Keep existing sketches in order, assigning ranks only where an old sketch lacks one. */
export function planCanvasSketchAppend(items: PlacementItem[], act: number | null, anchor: string | null, count: number): {
    missing: Array<{ path: string; rank: number }>;
    ranks: number[];
} {
    const ordered = orderSketches(items);
    const existing = ordered.items.filter(item => item.row.kind === 'sketch' && item.row.act === act
        && (anchor ? sketchAnchor(item.placement) === anchor && !ordered.problems.has(item.row.path)
            : !sketchAnchor(item.placement) || ordered.problems.has(item.row.path)));
    let next = Math.max(0, ...existing.map(item => sketchOrder(item.placement) ?? 0)); // SAFE: unranked sketches don't raise the max; the loop below ranks them after it
    const missing: Array<{ path: string; rank: number }> = [];
    for (const item of existing) {
        if (sketchOrder(item.placement) !== null) continue;
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
