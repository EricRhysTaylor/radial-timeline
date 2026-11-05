import type { App, TFile } from 'obsidian';
import type { StoryCanvasData } from './canvasSketches';

/** Advanced Canvas represents portal endpoints as acportal||portal-id||node-id. */
export function hasPortalReference(data: StoryCanvasData, ids: Set<string>, local: boolean): boolean {
    const matches = (value: unknown, allowPlain: boolean): boolean => {
        if (typeof value !== 'string') return false;
        if (allowPlain && ids.has(value)) return true;
        return value.startsWith('acportal||') && ids.has(value.slice(value.lastIndexOf('||') + 2));
    };
    const edgeMatches = (value: unknown, allowPlain: boolean): boolean => {
        if (!value || typeof value !== 'object') return false;
        const edge = value as { fromNode?: unknown; toNode?: unknown };
        return matches(edge.fromNode, allowPlain) || matches(edge.toNode, allowPlain);
    };
    if (data.edges?.some(edge => edgeMatches(edge, false)
        || (local && ((ids.has(edge.fromNode) && edge.toNode.startsWith('acportal||'))
            || (ids.has(edge.toNode) && edge.fromNode.startsWith('acportal||')))))) return true;
    return (data.nodes ?? []).some(node => Array.isArray(node.interdimensionalEdges) // SAFE: canvas JSON may omit nodes; none = no portal edges
        && node.interdimensionalEdges.some(edge => edgeMatches(edge, local)));
}

/** A file that does not parse as a canvas holds no edges Canvas could follow, so it cannot hold a portal. */
async function readCanvasData(app: App, file: TFile): Promise<StoryCanvasData | null> {
    try {
        const data: unknown = JSON.parse(await app.vault.cachedRead(file));
        return data && typeof data === 'object' ? data as StoryCanvasData : null;
    } catch (error) { // SAFE: one damaged or empty .canvas must not stop conversion on a healthy one
        console.warn(`[Canvas] Skipped unreadable canvas ${file.path}`, error);
        return null;
    }
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
        const data = await Promise.all(canvases.slice(offset, offset + 24).map(file => readCanvasData(app, file)));
        if (data.some(canvas => canvas !== null && hasPortalReference(canvas, ids, true))) return true;
    }
    return false;
}
