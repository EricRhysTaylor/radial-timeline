import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types/settings';
import { compareSubplotOrder, computeCacheableValues } from '../renderer/utils/Precompute';
import { normalizeSubplotColorIndex } from '../renderer/utils/subplotColors';
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

/** The color slot each ring will hold once these scenes join the book: ring order follows scene counts. */
export function ringSlotsWith(rows: Array<{ kind: string; subplots: string[] }>, additions: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const subplot of [...rows.filter(row => row.kind === 'scene').flatMap(row => row.subplots), ...additions]) {
        counts.set(subplot, (counts.get(subplot) ?? 0) + 1); // SAFE: a subplot's first scene counts from zero
    }
    const order = [...counts].map(([subplot, count]) => ({ subplot, count })).sort(compareSubplotOrder);
    return new Map(order.map(({ subplot }, index) => [subplot, normalizeSubplotColorIndex(index)]));
}
