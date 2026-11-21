import type RadialTimelinePlugin from '../main';
import { isStoryMapProvenance, rebaseStoryMapProvenance, type StoryMapProvenance } from './storyMapProvenance';

/** A generation baseline travels with the Canvas, independent of local book IDs. */
export type PortableStoryMap = { schemaVersion: 1; bookFolder: string; provenance: Omit<StoryMapProvenance, 'bookId'> };
export const storyMapSidecarPath = (canvasPath: string): string => `${canvasPath}.storymap.json`;

export function portableStoryMap(record: StoryMapProvenance, bookFolder: string): PortableStoryMap {
    const { bookId: _bookId, ...provenance } = record;
    return { schemaVersion: 1, bookFolder, provenance };
}

export function readPortableStoryMap(value: unknown, books: ReadonlyArray<{ id: string; sourceFolder: string }>): StoryMapProvenance | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Partial<PortableStoryMap>;
    if (raw.schemaVersion !== 1 || typeof raw.bookFolder !== 'string' || !raw.bookFolder.trim()) return null;
    const matching = books.filter(book => book.sourceFolder === raw.bookFolder);
    if (matching.length !== 1 || !raw.provenance || typeof raw.provenance !== 'object') return null;
    const record = { ...raw.provenance, bookId: matching[0].id };
    if (!isStoryMapProvenance(record)) return null;
    const inside = (path: string) => path.startsWith(`${raw.bookFolder}/`) && !path.split('/').some(part => !part || part === '.' || part === '..');
    if (record.scenes.some(scene => !inside(scene.path)) || (record.generated.nodes ?? []).some(node => node.type === 'file' && (typeof node.file !== 'string' || !inside(node.file)))) return null;
    const scenePaths = new Set(record.scenes.map(scene => scene.path));
    const nodes = record.generated.nodes ?? [];
    const nodeIds = new Set(nodes.map(node => node.id));
    if (scenePaths.size !== record.scenes.length || nodeIds.size !== nodes.length || nodes.some(node => !node.id || (node.type === 'file' && (typeof node.file !== 'string' || !scenePaths.has(node.file))))) return null;
    if ((record.generated.edges ?? []).some(edge => !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode))) return null;
    return record;
}

/** Follow vault renames using only the portable folder, never a device-specific ID. */
export function rebasePortableStoryMap(value: unknown, oldPath: string, newPath: string): PortableStoryMap | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Partial<PortableStoryMap>;
    if (typeof raw.bookFolder !== 'string') return null;
    const record = readPortableStoryMap(value, [{ id: 'portable', sourceFolder: raw.bookFolder }]);
    if (!record) return null;
    const rebase = (path: string) => path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
    const updated = rebaseStoryMapProvenance({ portable: record }, oldPath, newPath).portable;
    return { ...raw, ...portableStoryMap(updated, rebase(raw.bookFolder)) };
}

/** An existing local record wins; a missing record may be restored from its sidecar. */
export async function hydrateStoryMap(plugin: RadialTimelinePlugin, canvasPath: string): Promise<void> {
    if (plugin.settings.storyMapProvenance?.[canvasPath] !== undefined) return;
    const file = plugin.app.vault.getFileByPath(storyMapSidecarPath(canvasPath));
    if (!file) return;
    try {
        const data: unknown = JSON.parse(await plugin.app.vault.cachedRead(file));
        const record = readPortableStoryMap(data, plugin.settings.books);
        if (!record || plugin.settings.storyMapProvenance?.[canvasPath] !== undefined) return;
        plugin.settings.storyMapProvenance = { ...plugin.settings.storyMapProvenance, [canvasPath]: record };
    } catch (error) {
        console.error('[Story map] Could not read map details', error);
    }
}

/** Never replace a sidecar that might contain an author's existing baseline. */
export async function writeStoryMapSidecar(plugin: RadialTimelinePlugin, path: string, record: StoryMapProvenance, bookFolder: string): Promise<void> {
    await plugin.app.vault.create(storyMapSidecarPath(path), JSON.stringify(portableStoryMap(record, bookFolder), null, 2));
}

/** Update only the baseline we read, never replace a sidecar changed elsewhere. */
export async function updateStoryMapSidecar(plugin: RadialTimelinePlugin, path: string, before: StoryMapProvenance, after: StoryMapProvenance, bookFolder: string): Promise<void> {
    const sidecar = plugin.app.vault.getFileByPath(storyMapSidecarPath(path));
    if (!sidecar) return;
    await plugin.app.vault.process(sidecar, text => {
        const old = readPortableStoryMap(JSON.parse(text) as unknown, plugin.settings.books);
        if (!old || JSON.stringify(portableStoryMap(old, bookFolder)) !== JSON.stringify(portableStoryMap(before, bookFolder))) throw new Error('Portable map details changed elsewhere.');
        return JSON.stringify(portableStoryMap(after, bookFolder), null, 2);
    });
}
