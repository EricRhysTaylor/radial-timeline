import type { StoryCanvasData } from './canvasSketches';
import type { StoryMapScene } from './storyMapDiff';
import type { StoryRange } from './subplotCanvas';
import { transposeStoryCanvas } from './canvasOrientation';

/** A generation-time baseline, kept in plugin data rather than in scene notes. */
export interface StoryMapProvenance {
    version: 1;
    bookId: string;
    generatedAt: string;
    act: number | null;
    subplot: string | null;
    layout: 'horizontal' | 'vertical' | 'story';
    /** Whether this generation was transposed after its selected layout was built. */
    orientationFlipped?: boolean;
    initialFocus: StoryRange;
    scenes: StoryMapScene[];
    generated: StoryCanvasData;
}

export interface CanvasChangeSummary {
    addedNodes: number;
    addedEdges: number;
    changedNodes: number;
    changedEdges: number;
    removedNodes: number;
    removedEdges: number;
}

function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    });
}

/** Unknown or incomplete records are never treated as reliable provenance. */
export function isStoryMapProvenance(value: unknown): value is StoryMapProvenance {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<StoryMapProvenance>;
    return record.version === 1 && typeof record.bookId === 'string' && typeof record.generatedAt === 'string'
        && (record.act === null || typeof record.act === 'number') && (record.subplot === null || typeof record.subplot === 'string')
        && (record.layout === 'horizontal' || record.layout === 'vertical' || record.layout === 'story')
        && (record.initialFocus === 'all' || record.initialFocus === 'beginning' || record.initialFocus === 'middle' || record.initialFocus === 'end')
        && Array.isArray(record.scenes) && record.scenes.every(scene => scene && typeof scene.path === 'string' && Array.isArray(scene.subplots))
        && !!record.generated && Array.isArray(record.generated.nodes) && (record.generated.edges === undefined || Array.isArray(record.generated.edges));
}

/** Compare whole records, including custom fields. An edited generated card
 * must never be mistaken for an untouched one when deciding what to replace. */
export function canvasChanges(baseline: StoryCanvasData, current: StoryCanvasData): CanvasChangeSummary {
    const compare = (oldItems: readonly Record<string, unknown>[], newItems: readonly Record<string, unknown>[]) => {
        const oldById = new Map(oldItems.filter(item => typeof item.id === 'string').map(item => [item.id as string, item]));
        const newById = new Map(newItems.filter(item => typeof item.id === 'string').map(item => [item.id as string, item]));
        return {
            added: [...newById.keys()].filter(id => !oldById.has(id)).length,
            removed: [...oldById.keys()].filter(id => !newById.has(id)).length,
            changed: [...oldById].filter(([id, item]) => newById.has(id) && canonical(item) !== canonical(newById.get(id))).length,
        };
    };
    const nodes = compare(baseline.nodes ?? [], current.nodes ?? []);
    const edges = compare(baseline.edges ?? [], current.edges ?? []);
    return { addedNodes: nodes.added, addedEdges: edges.added, changedNodes: nodes.changed, changedEdges: edges.changed, removedNodes: nodes.removed, removedEdges: edges.removed };
}

/** An orientation switch is a view/layout choice, not a manual edit. */
export function matchingBaseline(baseline: StoryCanvasData, current: StoryCanvasData): { data: StoryCanvasData; transposed: boolean } {
    const flipped = transposeStoryCanvas(baseline);
    if (!flipped) return { data: baseline, transposed: false };
    const score = (data: StoryCanvasData): number => {
        const changes = canvasChanges(data, current);
        return changes.changedNodes + changes.changedEdges;
    };
    return score(flipped) < score(baseline) ? { data: flipped, transposed: true } : { data: baseline, transposed: false };
}

/** Carry additions, edited generated elements, and the endpoints needed for
 * their connections into an updated copy. Never modify the original Canvas. */
export function carryCanvasEdits(baseline: StoryCanvasData, current: StoryCanvasData, fresh: StoryCanvasData): { data: StoryCanvasData; nodes: number; edges: number } {
    const oldNodes = new Map((baseline.nodes ?? []).map(node => [node.id, node]));
    const oldEdges = new Map((baseline.edges ?? []).filter(edge => typeof edge.id === 'string').map(edge => [edge.id as string, edge]));
    const allNodes = new Map((current.nodes ?? []).map(node => [node.id, node]));
    const changed = (a: Record<string, unknown> | undefined, b: Record<string, unknown>): boolean => !a || canonical({ ...a, id: 'x' }) !== canonical({ ...b, id: 'x' });
    const chosen = new Set((current.nodes ?? []).filter(node => changed(oldNodes.get(node.id), node)).map(node => node.id));
    const carriedEdges = (current.edges ?? []).filter(edge => {
        const id = typeof edge.id === 'string' ? edge.id : '';
        return changed(oldEdges.get(id), edge) || chosen.has(edge.fromNode) || chosen.has(edge.toNode);
    });
    for (const edge of carriedEdges) { if (allNodes.has(edge.fromNode)) chosen.add(edge.fromNode); if (allNodes.has(edge.toNode)) chosen.add(edge.toNode); }
    const nodes = (current.nodes ?? []).filter(node => chosen.has(node.id));
    if (nodes.some(node => typeof node.x !== 'number' || !Number.isFinite(node.x) || typeof node.y !== 'number' || !Number.isFinite(node.y))) throw new Error('Cannot safely place an edited Canvas card with invalid coordinates.');
    const freshIds = new Set((fresh.nodes ?? []).map(node => node.id));
    if (nodes.some(node => freshIds.has(node.id))) throw new Error('Cannot safely copy Canvas cards with conflicting IDs.');
    const maxX = Math.max(0, ...(fresh.nodes ?? []).map(node => Number(node.x ?? 0) + Number(node.width ?? 0)));
    const minX = Math.min(0, ...nodes.map(node => Number(node.x ?? 0)));
    const shifted = nodes.map(node => ({ ...node, x: Number(node.x ?? 0) + maxX - minX + 180 }));
    return { data: { ...current, nodes: [...(fresh.nodes ?? []), ...shifted], edges: [...(fresh.edges ?? []), ...carriedEdges] }, nodes: nodes.length, edges: carriedEdges.length };
}

/** Follow Obsidian note, Canvas and folder renames without losing the baseline. */
export function rebaseStoryMapProvenance(records: Record<string, StoryMapProvenance>, oldPath: string, newPath: string): Record<string, StoryMapProvenance> {
    const rebase = (path: string): string => path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
    const result: Record<string, StoryMapProvenance> = {};
    for (const [path, record] of Object.entries(records)) {
        const target = rebase(path);
        if (target !== path && records[target]) return records; // Never overwrite another map's provenance.
        if (!isStoryMapProvenance(record)) { result[target] = record; continue; }
        result[target] = { ...record,
            scenes: record.scenes.map(scene => ({ ...scene, path: rebase(scene.path) })),
            generated: { ...record.generated, nodes: record.generated.nodes?.map(node => typeof node.file === 'string' ? { ...node, file: rebase(node.file) } : node) },
        };
    }
    return result;
}
