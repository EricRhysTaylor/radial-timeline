import type { CanvasCard, StoryCanvasData } from './canvasSketches';

/** Selected cards and edges from an older Canvas, captured while it is open. */
export interface LegacyCanvasSelection {
    source: StoryCanvasData;
    selectedIds: string[];
    readCurrent: () => StoryCanvasData | undefined;
}

function bounds(node: CanvasCard): { x: number; y: number; width: number; height: number } | null {
    const { x, y, width, height } = node;
    if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) return null;
    return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** Include cards within selected groups and both endpoints of carried edges. */
export function selectedCanvasContents(source: StoryCanvasData, selectedIds: readonly string[]): { nodes: CanvasCard[]; edges: NonNullable<StoryCanvasData['edges']>; selected: number } {
    const nodes = source.nodes ?? [];
    const ids = new Set(selectedIds);
    const selected = nodes.filter(node => ids.has(node.id));
    for (const group of selected.filter(node => node.type === 'group')) {
        const outer = bounds(group);
        if (!outer) throw new Error('Selected group has invalid bounds');
        for (const node of nodes) {
            const inner = bounds(node);
            if (!inner || node.id === group.id) continue;
            const cx = inner.x + inner.width / 2, cy = inner.y + inner.height / 2;
            if (cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height) ids.add(node.id);
        }
    }
    const edges = (source.edges ?? []).filter(edge => ids.has(edge.fromNode) || ids.has(edge.toNode) || (typeof edge.id === 'string' && ids.has(edge.id)));
    const existing = new Set(nodes.map(node => node.id));
    for (const edge of edges) {
        if (!existing.has(edge.fromNode) || !existing.has(edge.toNode)) throw new Error('A selected connection has a missing endpoint');
        ids.add(edge.fromNode); ids.add(edge.toNode);
    }
    return { nodes: nodes.filter(node => ids.has(node.id)), edges, selected: selected.length };
}

/** Position the selected material together beside the regenerated map. */
export function carryLegacySelection(source: StoryCanvasData, selectedIds: readonly string[], fresh: StoryCanvasData): { data: StoryCanvasData; selected: number; cards: number; edges: number } {
    const chosen = selectedCanvasContents(source, selectedIds);
    if (!chosen.nodes.length) throw new Error('No Canvas cards selected');
    const boxes = chosen.nodes.map(bounds);
    if (boxes.some(box => !box)) throw new Error('A selected card has invalid bounds');
    const freshNodes = fresh.nodes ?? [];
    const freshIds = new Set(freshNodes.map(node => node.id));
    if (chosen.nodes.some(node => freshIds.has(node.id))) throw new Error('Canvas card IDs conflict');
    const oldLeft = Math.min(...boxes.map(box => box!.x));
    const oldTop = Math.min(...boxes.map(box => box!.y));
    const freshRight = Math.max(0, ...freshNodes.map(node => { const box = bounds(node); return box ? box.x + box.width : 0; }));
    const freshTop = Math.min(0, ...freshNodes.map(node => bounds(node)?.y ?? 0));
    const dx = freshRight + 180 - oldLeft, dy = freshTop - oldTop;
    const carried = chosen.nodes.map(node => ({ ...node, x: (node.x as number) + dx, y: (node.y as number) + dy }));
    return { data: { ...source, nodes: [...freshNodes, ...carried], edges: [...(fresh.edges ?? []), ...chosen.edges] }, selected: chosen.selected, cards: carried.length, edges: chosen.edges.length };
}
