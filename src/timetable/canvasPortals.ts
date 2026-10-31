import type { App } from 'obsidian';
import type { StoryCanvasData } from './canvasSketches';

/** Advanced Canvas represents portal endpoints as acportal||portal-id||node-id. */
export function hasPortalReference(data: StoryCanvasData, ids: Set<string>, local: boolean): boolean {
    const matches = (value: unknown, allowPlain: boolean): boolean => {
        if (typeof value !== 'string') return false;
        if (allowPlain && ids.has(value)) return true;
        return value.startsWith('acportal||') && ids.has(value.split('||').at(-1) ?? '');
    };
    const edgeMatches = (value: unknown, allowPlain: boolean): boolean => {
        if (!value || typeof value !== 'object') return false;
        const edge = value as { fromNode?: unknown; toNode?: unknown };
        return matches(edge.fromNode, allowPlain) || matches(edge.toNode, allowPlain);
    };
    if (data.edges?.some(edge => edgeMatches(edge, false)
        || (local && ((ids.has(edge.fromNode) && edge.toNode.startsWith('acportal||'))
            || (ids.has(edge.toNode) && edge.fromNode.startsWith('acportal||')))))) return true;
    return (data.nodes ?? []).some(node => Array.isArray(node.interdimensionalEdges)
        && node.interdimensionalEdges.some(edge => edgeMatches(edge, local)));
}

/** Check saved and open canvases: another map can hold an incoming portal edge. */
export async function hasPortalReferences(app: App, source: StoryCanvasData, ids: Set<string>): Promise<boolean> {
    if (hasPortalReference(source, ids, true)) return true;
    for (const leaf of app.workspace.getLeavesOfType('canvas')) {
        const view = leaf.view as unknown as { canvas?: { getData?: () => StoryCanvasData } };
        if (view.canvas?.getData && hasPortalReference(view.canvas.getData(), ids, false)) return true;
    }
    const canvases = app.vault.getFiles().filter(file => file.extension === 'canvas');
    for (let offset = 0; offset < canvases.length; offset += 24) {
        const data = await Promise.all(canvases.slice(offset, offset + 24).map(async file => JSON.parse(await app.vault.cachedRead(file)) as StoryCanvasData));
        if (data.some(canvas => hasPortalReference(canvas, ids, true))) return true;
    }
    return false;
}
