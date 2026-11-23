import type RadialTimelinePlugin from '../main';
import { isStoryMapProvenance, rebaseStoryMapProvenance, type StoryMapProvenance } from './storyMapProvenance';

/** A generation baseline travels with the Canvas, independent of local book IDs. */
export type PortableStoryMap = { schemaVersion: 1; bookFolder: string; provenance: Omit<StoryMapProvenance, 'bookId'> };
export const storyMapSidecarPath = (canvasPath: string): string => `${canvasPath}.storymap.json`;

export function portableStoryMap(record: StoryMapProvenance, bookFolder: string): PortableStoryMap {
    const { bookId: _bookId, ...provenance } = record;
    return { schemaVersion: 1, bookFolder, provenance };
}

/**
 * A sidecar's baseline, checked for shape: schema, ids, edges and that every
 * file card is one of its scenes. Where those notes sit is checked by
 * readPortableStoryMap.
 */
function readPortableShape(value: unknown, bookId: string): { bookFolder: string; record: StoryMapProvenance } | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Partial<PortableStoryMap>;
    if (raw.schemaVersion !== 1 || typeof raw.bookFolder !== 'string' || !raw.bookFolder.trim()) return null;
    if (!raw.provenance || typeof raw.provenance !== 'object') return null;
    const record = { ...raw.provenance, bookId };
    if (!isStoryMapProvenance(record)) return null;
    const scenePaths = new Set(record.scenes.map(scene => scene.path));
    const nodes = record.generated.nodes ?? [];
    const nodeIds = new Set(nodes.map(node => node.id));
    if (scenePaths.size !== record.scenes.length || nodeIds.size !== nodes.length || nodes.some(node => !node.id || (node.type === 'file' && (typeof node.file !== 'string' || !scenePaths.has(node.file))))) return null;
    if ((record.generated.edges ?? []).some(edge => !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode))) return null;
    return { bookFolder: raw.bookFolder, record };
}

export function readPortableStoryMap(value: unknown, books: ReadonlyArray<{ id: string; sourceFolder: string }>): StoryMapProvenance | null {
    const folder = value && typeof value === 'object' ? (value as Partial<PortableStoryMap>).bookFolder : undefined;
    const matching = books.filter(book => book.sourceFolder === folder);
    if (matching.length !== 1) return null;
    const read = readPortableShape(value, matching[0].id);
    if (!read) return null;
    const { bookFolder, record } = read;
    const inside = (path: string) => path.startsWith(`${bookFolder}/`) && !path.split('/').some(part => !part || part === '.' || part === '..');
    if (record.scenes.some(scene => !inside(scene.path)) || (record.generated.nodes ?? []).some(node => node.type === 'file' && (typeof node.file !== 'string' || !inside(node.file)))) return null;
    return record;
}

/**
 * Follow vault renames using only the portable folder, never a device-specific ID.
 *
 * A book folder rename reaches here as one event for the folder and one for
 * each note in it, in whatever order Obsidian sends them. A note's event moves
 * that note before the folder has moved, so between events the sidecar can
 * name notes outside its folder. The rebase therefore checks shape only; once
 * every event has arrived, the folder and all its notes have moved together
 * and readPortableStoryMap accepts the sidecar again.
 */
export function rebasePortableStoryMap(value: unknown, oldPath: string, newPath: string): PortableStoryMap | null {
    const read = readPortableShape(value, 'portable');
    if (!read) return null;
    const rebase = (path: string) => path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
    const updated = rebaseStoryMapProvenance({ portable: read.record }, oldPath, newPath).portable;
    return { ...(value as PortableStoryMap), ...portableStoryMap(updated, rebase(read.bookFolder)) };
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
