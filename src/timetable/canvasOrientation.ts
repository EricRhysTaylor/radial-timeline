import type { StoryCanvasData } from './canvasSketches';

/** Transpose a canvas around the diagonal, keeping ordinary cards upright.
 * The transform is its own inverse, including for manually placed cards. */
export function transposeStoryCanvas(data: StoryCanvasData): StoryCanvasData | null {
    if (!Array.isArray(data.nodes) || !data.nodes.length) return null;
    const nodes = data.nodes.map(node => {
        const { x, y, width, height } = node;
        if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) return null;
        const X = x as number, Y = y as number, W = width as number, H = height as number;
        if (node.type === 'group') return { ...node, x: Y, y: X, width: H, height: W };
        // Canvas rounds coordinates to whole pixels. Opposite integer offsets
        // make a second transpose exact even when card dimensions differ by an odd pixel.
        const offset = Math.trunc((H - W) / 2);
        return { ...node, x: Y + offset, y: X - offset };
    });
    if (nodes.some(node => node === null)) return null;
    const side: Record<string, string> = { left: 'top', top: 'left', right: 'bottom', bottom: 'right' };
    const edges = data.edges?.map(edge => ({ ...edge,
        ...(typeof edge.fromSide === 'string' && side[edge.fromSide] ? { fromSide: side[edge.fromSide] } : {}),
        ...(typeof edge.toSide === 'string' && side[edge.toSide] ? { toSide: side[edge.toSide] } : {}),
    }));
    return { ...data, nodes: nodes as NonNullable<StoryCanvasData['nodes']>, ...(data.edges ? { edges } : {}) };
}
