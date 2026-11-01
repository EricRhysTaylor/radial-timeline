import { readSceneId } from '../utils/sceneIds';
import { orderSketches, sketchAnchor, SKETCH_ORDER, type PlacementItem } from './sketchPlacement';

/** Plan one insertion without changing the source, scenes, or existing sketches. */
export function planOutlineInsertion(items: PlacementItem[], targetPath: string): { act: number; anchorId: string | null; rank: number } | null {
    const target = items.find(item => item.row.path === targetPath);
    if (!target || (target.row.kind !== 'scene' && target.row.kind !== 'sketch') || target.row.act === null) return null;
    const ordered = orderSketches(items);
    if (ordered.problems.has(targetPath)) return null;
    const anchorId = target.row.kind === 'scene' ? readSceneId(target.frontmatter) ?? null : sketchAnchor(target.frontmatter);
    if (target.row.kind === 'scene' && !anchorId) return null;
    if (anchorId && items.filter(item => item.row.kind === 'scene' && readSceneId(item.frontmatter) === anchorId).length !== 1) return null;
    const gap = ordered.items.filter(item => item.row.kind === 'sketch' && item.row.act === target.row.act
        && (anchorId ? !ordered.problems.has(item.row.path) && sketchAnchor(item.frontmatter) === anchorId
            : !sketchAnchor(item.frontmatter) || ordered.problems.has(item.row.path)));
    const rank = (item: PlacementItem): number => {
        const key = Object.keys(item.frontmatter ?? {}).find(key => key.toLowerCase() === SKETCH_ORDER.toLowerCase());
        const value = key ? item.frontmatter?.[key] : undefined;
        return typeof value === 'number' && Number.isFinite(value) ? value : Infinity;
    };
    const index = target.row.kind === 'scene' ? -1 : gap.findIndex(item => item.row.path === targetPath);
    if (target.row.kind === 'sketch' && index < 0) return null;
    const before = index < 0 ? -Infinity : rank(gap[index]);
    const after = index + 1 < gap.length ? rank(gap[index + 1]) : Infinity;
    if (before === Infinity || (Number.isFinite(before) && before >= after)) return null;
    const value = before === -Infinity ? (Number.isFinite(after) ? after - 10 : 0)
        : after === Infinity ? before + 10 : before + (after - before) / 2;
    if (!Number.isFinite(value) || value <= before || value >= after) return null;
    return { act: target.row.act, anchorId, rank: value };
}

/** Append a new sketch to an act without renumbering or rewriting its notes. */
export function planOutlineActInsertion(items: PlacementItem[], act: number): { act: number; anchorId: null; rank: number } | null {
    if (!Number.isInteger(act) || act < 1) return null;
    const ordered = orderSketches(items);
    const tail = ordered.items.filter(item => item.row.kind === 'sketch' && item.row.act === act
        && (!sketchAnchor(item.frontmatter) || ordered.problems.has(item.row.path)));
    const ranks = tail.map(item => {
        const key = Object.keys(item.frontmatter ?? {}).find(candidate => candidate.toLowerCase() === SKETCH_ORDER.toLowerCase());
        return key ? item.frontmatter?.[key] : undefined;
    });
    if (ranks.some(rank => typeof rank !== 'number' || !Number.isFinite(rank))) return null;
    const last = ranks.length ? Math.max(...(ranks as number[])) : 0;
    const rank = last + 10;
    return Number.isFinite(rank) && rank > last ? { act, anchorId: null, rank } : null;
}
