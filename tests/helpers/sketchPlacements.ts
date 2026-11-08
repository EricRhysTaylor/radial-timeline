import type RadialTimelinePlugin from '../../src/main';
import { SketchPlacementStore } from '../../src/timetable/SketchPlacementStore';

/**
 * An empty placement sidecar on an in-memory disk, past its one-time import
 * (a vault with no old placement lines). `files` is the disk, so a test can
 * read what the sidecar wrote; give sketches a place with `store.set`.
 */
export function memoryPlacements(): { store: SketchPlacementStore; files: Map<string, string> } {
    const files = new Map<string, string>();
    const adapter = {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => files.get(path)!,
        mkdir: async (path: string) => { files.set(path, ''); },
        write: async (path: string, content: string) => { files.set(path, content); },
    };
    const plugin = { settings: {}, app: { vault: { adapter, getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null } } } as unknown as RadialTimelinePlugin; // SAFE: test double with only what the store reads
    const store = new SketchPlacementStore(plugin);
    // Nothing to import: this settles before it returns.
    void store.importFromNotes();
    return { store, files };
}
