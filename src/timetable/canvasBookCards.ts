import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile, RadialTimelineSettings } from '../types/settings';
import { compareSubplotOrder, computeCacheableValues } from '../renderer/utils/Precompute';
import { assignSubplotColors, bookOwnSubplotColors, type OwnSubplotColors, type SubplotColor } from '../renderer/utils/subplotColors';
import { getBookIdForPath } from '../utils/books';
import { getBookMainPlotName, getMainPlotName } from '../utils/mainPlot';
import type { PluginRendererFacade } from '../utils/sceneHelpers';
import { buildRingLayout, buildTableRow, type TimetableRow } from './timetableModel';
import type { PlacementItem } from './sketchPlacement';

type CardNode = { type?: string; file?: string; subpath?: string };

/** One of a book's subplots, with the color it wears on the timeline. */
export interface RingChoice { name: string; color: SubplotColor }

/** Only a whole note inside a book becomes a card; any other Canvas node stays Obsidian's own. */
export function bookCardFor(books: BookProfile[] | undefined, node: CardNode | undefined): { path: string; bookId: string } | null {
    if (node?.type !== 'file' || !node.file || node.subpath || !node.file.endsWith('.md')) return null;
    const bookId = getBookIdForPath(books, node.file);
    return bookId ? { path: node.file, bookId } : null;
}

/** Each of a book's rings with its color, in the timeline's ring order. */
export async function bookRingColors(plugin: RadialTimelinePlugin, book: BookProfile): Promise<Map<string, SubplotColor>> {
    const scenes = await plugin.getSceneData({ sourcePath: book.sourceFolder });
    return computeCacheableValues(
        plugin as unknown as PluginRendererFacade, // SAFE: the plugin satisfies the renderer facade at runtime; the structural type is narrower than the class
        scenes.map(scene => ({ ...scene, bookId: book.id, bookIndex: 0 })),
        { ownSubplotColors: bookOwnSubplotColors(book) },
    ).subplotColors;
}

/** Every note in a book folder, as the Timetable reads it. */
export function bookPlacementItems(app: App, settings: RadialTimelineSettings, book: BookProfile): PlacementItem[] {
    return app.vault.getMarkdownFiles().filter(file => getBookIdForPath(settings.books, file.path) === book.id)
        .map(file => {
            const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
            return { row: buildTableRow(file.path, file.basename, frontmatter, settings), frontmatter };
        });
}

/**
 * A book's subplots in ring order, the main plot first: the timeline's rings
 * (`wheel`, from {@link bookRingColors}), then subplots only its sketches name.
 * The Canvas card menu and Bring ideas into your book both list these.
 */
export function bookSubplotChoices(wheel: ReadonlyMap<string, SubplotColor>, own: OwnSubplotColors, rows: TimetableRow[]): RingChoice[] {
    const layout = buildRingLayout([...wheel.keys()], own, rows);
    return [...new Set([getMainPlotName(), ...layout.order])].map(name => ({ name, color: layout.colors.get(name) ?? { kind: 'slot', slot: 0 } })); // SAFE: a book with no scenes has no layout yet, and Main Plot always takes the first slot
}

/**
 * The Subplot a new scene of `book` lists. Every book's main plot is read,
 * as the timeline reads it, under the timeline's main plot name (the active
 * book's, or the saga's); a scene written into a book lists that book's own.
 */
export function bookSubplotName(subplot: string, book: Pick<BookProfile, 'mainPlotName'>): string {
    return subplot === getMainPlotName() ? getBookMainPlotName(book) : subplot;
}

/**
 * The color each ring will wear once these scenes join the book. Ring order
 * follows scene counts, so a new subplot can move other rings; the palette
 * slots follow that order among the rings without a color of their own.
 */
export function ringColorsWith(rows: Array<{ kind: string; subplots: string[] }>, additions: string[], own: OwnSubplotColors): Map<string, SubplotColor> {
    const counts = new Map<string, number>();
    for (const subplot of [...rows.filter(row => row.kind === 'scene').flatMap(row => row.subplots), ...additions]) {
        counts.set(subplot, (counts.get(subplot) ?? 0) + 1); // SAFE: a subplot's first scene counts from zero
    }
    const order = [...counts].map(([subplot, count]) => ({ subplot, count })).sort(compareSubplotOrder);
    return assignSubplotColors(order.map(({ subplot }) => subplot), own);
}

/**
 * The new subplots that must keep their chosen color as their own. A new
 * subplot can wear a palette slot instead when, by ring order, that slot is
 * exactly its chosen color and taking it leaves every other ring's color as it
 * would be; then it follows the palette like any other ring. `chosen` maps
 * each new subplot to its lower-case `#rrggbb`, in the dialog's order.
 */
export function ownColorsForNewSubplots(
    rows: Array<{ kind: string; subplots: string[] }>,
    additions: string[],
    own: OwnSubplotColors,
    chosen: ReadonlyMap<string, string>,
    hexOf: (color: SubplotColor) => string,
): Map<string, string> {
    const needed = new Map(chosen);
    const paint = (keep: ReadonlyMap<string, string>): Map<string, string> =>
        new Map([...ringColorsWith(rows, additions, new Map([...own, ...keep]))].map(([name, color]) => [name, hexOf(color)]));
    for (const subplot of chosen.keys()) {
        const withOwn = paint(needed);
        const trial = new Map(needed);
        trial.delete(subplot);
        const withoutOwn = paint(trial);
        if ([...withOwn].every(([name, hex]) => withoutOwn.get(name) === hex)) needed.delete(subplot);
    }
    return needed;
}
