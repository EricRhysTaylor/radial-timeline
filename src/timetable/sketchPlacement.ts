import { compareManuscriptRows, type TimetableRow } from './timetableModel';
import { readSceneId } from '../utils/sceneIds';
import { sketchAnchor, sketchOrder, type SketchPlacement } from './sketchPlacementFields';
export { sketchAnchor, sketchOrder, type SketchPlacement } from './sketchPlacementFields';

export interface PlacementItem {
    row: TimetableRow;
    frontmatter?: Record<string, unknown>;
    /** The sketch's placement, from the placement sidecar. */
    placement?: SketchPlacement;
}
export type PlacementProblem = 'missing' | 'duplicate' | 'different-act';
export interface OrderedSketches<T> {
    items: T[];
    problems: Map<string, PlacementProblem>;
}

function sketchRank(placement?: SketchPlacement): number {
    return sketchOrder(placement) ?? Number.POSITIVE_INFINITY;
}

/** Merge sketches into the existing scene order; never change scene positions. */
export function orderSketches<T extends PlacementItem>(items: T[]): OrderedSketches<T> {
    const base = [...items].sort((a, b) => compareManuscriptRows(a.row, b.row));
    const scenes = new Map<string, T[]>();
    for (const item of base) {
        if (item.row.kind !== 'scene') continue;
        const id = readSceneId(item.frontmatter);
        if (id) scenes.set(id, [...(scenes.get(id) ?? []), item]); // SAFE: the first scene with this id starts its group
    }
    const byAnchor = new Map<string, T[]>();
    const problems = new Map<string, PlacementProblem>();
    const unplaced = new Set<T>();
    for (const item of base) {
        if (item.row.kind !== 'sketch') continue;
        const id = sketchAnchor(item.placement);
        if (!id) { unplaced.add(item); continue; }
        const matches = scenes.get(id) ?? []; // SAFE: an anchor no scene carries matches none and is reported as missing
        const problem = matches.length === 0 ? 'missing' : matches.length > 1 ? 'duplicate'
            : matches[0].row.act !== item.row.act ? 'different-act' : null;
        if (problem) { problems.set(item.row.path, problem); unplaced.add(item); continue; }
        const key = matches[0].row.path;
        byAnchor.set(key, [...(byAnchor.get(key) ?? []), item]); // SAFE: the first sketch after this scene starts its group
    }
    for (const group of byAnchor.values()) group.sort((a, b) => sketchRank(a.placement) - sketchRank(b.placement)
        || a.row.path.localeCompare(b.row.path, undefined, { numeric: true, sensitivity: 'base' }));
    const result: T[] = [];
    // Emit unplaced sketches at the end of their act, even if they had an old prefix.
    let act: number | null | undefined;
    let trailing: T[] = [];
    const flush = (): void => {
        trailing.sort((a, b) => sketchRank(a.placement) - sketchRank(b.placement)
            || a.row.path.localeCompare(b.row.path, undefined, { numeric: true, sensitivity: 'base' }));
        result.push(...trailing);
        trailing = [];
    };
    for (const item of base) {
        if (item.row.act !== act) { flush(); act = item.row.act; }
        if (item.row.kind === 'sketch') { if (unplaced.has(item)) trailing.push(item); continue; }
        result.push(item);
        result.push(...(byAnchor.get(item.row.path) ?? [])); // SAFE: a scene with no attached sketches emits none
    }
    flush();
    return { items: result, problems };
}

export interface SketchDropPlan {
    anchorId: string | null;
    act: number | null;
    /** Sketch paths in the destination gap, in their intended order. */
    orderedPaths: string[];
}

export function planSketchActDrop(items: PlacementItem[], sourcePath: string, act: number | null): SketchDropPlan | null {
    if (!items.some(item => item.row.path === sourcePath && item.row.kind === 'sketch')) return null;
    const orderedPaths = orderSketches(items).items.filter(item => item.row.kind === 'sketch'
        && item.row.path !== sourcePath && item.row.act === act && !sketchAnchor(item.placement)).map(item => item.row.path);
    orderedPaths.push(sourcePath);
    return { anchorId: null, act, orderedPaths };
}

/** Plan a drop without touching filenames or allowing a sketch to reorder scenes. */
export function planSketchDrop(items: PlacementItem[], sourcePath: string, targetPath: string, after = false): SketchDropPlan | null {
    const source = items.find(item => item.row.path === sourcePath && item.row.kind === 'sketch');
    const target = items.find(item => item.row.path === targetPath);
    if (!source || !target || source === target || (target.row.kind !== 'scene' && target.row.kind !== 'sketch')) return null;
    const anchorId = target.row.kind === 'scene' ? readSceneId(target.frontmatter) ?? null : sketchAnchor(target.placement);
    if (!anchorId && target.row.kind === 'scene') return null;
    if (!anchorId) {
        const gap = orderSketches(items).items.filter(item => item.row.kind === 'sketch' && item.row.path !== sourcePath
            && item.row.act === target.row.act && !sketchAnchor(item.placement));
        const index = gap.findIndex(item => item.row.path === targetPath);
        if (index < 0) return null;
        const orderedPaths = gap.map(item => item.row.path);
        orderedPaths.splice(index + (after ? 1 : 0), 0, sourcePath);
        return { anchorId: null, act: target.row.act, orderedPaths };
    }
    const anchors = items.filter(item => item.row.kind === 'scene' && readSceneId(item.frontmatter) === anchorId);
    if (anchors.length !== 1 || anchors[0].row.act === null || target.row.act !== anchors[0].row.act) return null;
    const act = anchors[0].row.act;
    const gap = orderSketches(items).items.filter(item => item.row.kind === 'sketch' && item.row.path !== sourcePath
        && item.row.act === act && sketchAnchor(item.placement) === anchorId);
    const targetIndex = target.row.kind === 'scene' ? 0 : gap.findIndex(item => item.row.path === targetPath);
    if (targetIndex < 0) return null;
    const orderedPaths = gap.map(item => item.row.path);
    orderedPaths.splice(targetIndex + (after && target.row.kind === 'sketch' ? 1 : 0), 0, sourcePath);
    return { anchorId, act, orderedPaths };
}
