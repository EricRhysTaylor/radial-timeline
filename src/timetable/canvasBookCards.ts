import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types/settings';
import { computeCacheableValues } from '../renderer/utils/Precompute';
import { getBookIdForPath } from '../utils/books';
import type { PluginRendererFacade } from '../utils/sceneHelpers';

type CardNode = { type?: string; file?: string; subpath?: string };

/** Only a whole note inside a book becomes a card; any other Canvas node stays Obsidian's own. */
export function bookCardFor(books: BookProfile[] | undefined, node: CardNode | undefined): { path: string; bookId: string } | null {
    if (node?.type !== 'file' || !node.file || node.subpath || !node.file.endsWith('.md')) return null;
    const bookId = getBookIdForPath(books, node.file);
    return bookId ? { path: node.file, bookId } : null;
}

/** Each of a book's rings with its color slot, in the timeline's ring order. */
export async function bookRingSlots(plugin: RadialTimelinePlugin, book: BookProfile): Promise<Map<string, number>> {
    const scenes = await plugin.getSceneData({ sourcePath: book.sourceFolder });
    return computeCacheableValues(plugin as unknown as PluginRendererFacade, scenes.map(scene => ({ ...scene, bookId: book.id, bookIndex: 0 }))).colorIndexBySubplot;
}
