import { Notice, type ItemView, type Menu, type MenuItem } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile, RadialTimelineSettings } from '../types/settings';
import type { TimetableRow } from './timetableModel';
import { t, tCount } from '../i18n';
import { getActiveBook } from '../utils/books';
import { bookOwnSubplotColors, readSubplotColorHex, SUBPLOT_COLOR_SLOTS, type SubplotColor } from '../renderer/utils/subplotColors';
import { bookPlacementItems, bookSubplotChoices } from './canvasBookCards';
import { cardColor, cardColorHex } from './canvasCardSubplots';
import { canvasTextCards, type StoryCanvasData } from './canvasSketches';
import { isStoryActHeading } from './canvasNavigation';
import { isStillWaiting, paletteChoices, subplotDirectory, subplotMenuModel, type DirectoryEntry } from './canvasSubplotDirectory';
import { pendingSubplotsOn, rememberPendingSubplot, savePendingSubplots } from './canvasPendingSubplots';
import { CanvasNewSubplotModal } from './CanvasNewSubplotModal';

/*
 * Radial Timeline: Color by subplot, in a Canvas card's right-click menu.
 *
 * One place to give idea cards a subplot: the active book's subplots in ring
 * order, each in its timeline color, then new subplots waiting on this
 * Canvas, then New subplot…, which names one and gives it a free palette
 * color. Choosing sets every card the menu acts on to that exact color, so
 * Bring ideas into your book starts each color on its subplot.
 */

/** The Canvas node surface the menu uses (undocumented Obsidian internals, checked at runtime). */
export interface CanvasCardNode {
    getData?: () => { id?: string; type?: string; text?: string; color?: unknown };
    setColor?: (color: string) => void;
}

export interface CanvasForMenu {
    getData?: () => StoryCanvasData;
    requestSave?: () => void;
}

/** What the menu reads from the Canvas it opens on. */
export interface SubplotMenuHost {
    plugin: RadialTimelinePlugin;
    view: ItemView;
    canvas: CanvasForMenu;
    /** The book's rings with their colors when already read; undefined while they are still being read. */
    ringsNow: (bookId: string) => Map<string, SubplotColor> | undefined;
}

/** Idea cards: text cards that are not Act headings, which a color can give a subplot. */
export function ideaCards<T extends CanvasCardNode>(nodes: Iterable<T>): T[] {
    return [...nodes].filter(node => {
        const data = node.getData?.();
        return data?.type === 'text' && typeof node.setColor === 'function' && !(typeof data.text === 'string' && isStoryActHeading(data.text));
    });
}

/** The palette as lower-case `#rrggbb`, slot by slot. */
export function paletteHexes(doc: Document): string[] {
    return Array.from({ length: SUBPLOT_COLOR_SLOTS }, (_, slot) => readSubplotColorHex(doc, { kind: 'slot', slot }));
}

/** The colors idea cards on this Canvas wear, as lower-case `#rrggbb`. */
export function wornCardHexes(data: StoryCanvasData, doc: Document): Set<string> {
    const worn = new Set<string>();
    for (const card of canvasTextCards(data)) {
        const color = cardColor(card);
        const hex = color ? cardColorHex(doc, color) : null;
        if (hex) worn.add(hex);
    }
    return worn;
}

/**
 * The directory for a book on a Canvas: its subplots in ring order with
 * their timeline colors, then the new subplots still waiting there.
 */
export function readCanvasSubplotDirectory(
    settings: RadialTimelineSettings,
    book: BookProfile,
    rows: TimetableRow[],
    canvasPath: string,
    canvasData: StoryCanvasData,
    doc: Document,
    wheel: ReadonlyMap<string, SubplotColor>,
): DirectoryEntry[] {
    const rings = bookSubplotChoices(wheel, bookOwnSubplotColors(book), rows).map(ring => ({ name: ring.name, hex: readSubplotColorHex(doc, ring.color) }));
    return subplotDirectory(rings, pendingSubplotsOn(settings.canvasPendingSubplots, canvasPath, book.id), wornCardHexes(canvasData, doc));
}

function cardHex(node: CanvasCardNode, doc: Document): string | null {
    const color = cardColor(node.getData?.() ?? {}); // SAFE: a node without data has no color
    return color ? cardColorHex(doc, color) : null;
}

function paint(host: SubplotMenuHost, cards: CanvasCardNode[], hex: string): void {
    for (const card of cards) card.setColor!(hex); // SAFE: ideaCards keeps only cards that can take a color
    host.canvas.requestSave?.();
}

function swatchTitle(doc: Document, entry: DirectoryEntry): DocumentFragment {
    const fragment = doc.win.createFragment();
    const row = fragment.createSpan({ cls: 'ert-canvas-sketch-ring-option' });
    row.createSpan({ cls: 'ert-canvas-sketch-swatch' }).setCssProps({ '--ert-canvas-sketch-swatch': entry.hex });
    row.createSpan({ text: entry.name });
    if (entry.pending) row.createSpan({ cls: 'ert-canvas-subplot-menu__note', text: t('ui.canvasSketch.pendingNote') });
    return fragment;
}

/** Obsidian's submenu, an undocumented MenuItem method. */
function submenuOf(item: MenuItem): Menu | null {
    const withSubmenu = item as unknown as { setSubmenu?: () => Menu };
    return typeof withSubmenu.setSubmenu === 'function' ? withSubmenu.setSubmenu() : null;
}

function openNewSubplot(host: SubplotMenuHost, book: BookProfile, canvasPath: string, cards: CanvasCardNode[], directory: DirectoryEntry[]): void {
    const doc = host.view.containerEl.doc;
    const { plugin } = host;
    new CanvasNewSubplotModal(plugin.app, {
        bookTitle: book.title,
        directory,
        palette: paletteChoices(paletteHexes(doc), directory),
        confirm: t('ui.canvasSketch.colorCards', { cards: tCount('card', cards.length) }),
        onChoose: choice => {
            paint(host, cards, choice.color);
            const rings = directory.filter(entry => !entry.pending);
            const worn = wornCardHexes(host.canvas.getData?.() ?? {}, doc); // SAFE: a Canvas that cannot report its cards keeps only the new subplot
            void (async () => {
                const next = rememberPendingSubplot(plugin.settings.canvasPendingSubplots, canvasPath, { bookId: book.id, ...choice },
                    entry => isStillWaiting(entry, rings, worn));
                await savePendingSubplots(plugin, next);
            })().catch((error: unknown) => {
                console.error('[Canvas subplots] Could not remember the new subplot', error);
                new Notice(t('ui.canvasSketch.pendingNotSaved', { subplot: choice.name }), 10000);
            });
        },
    }).open();
}

/** Add Radial Timeline: Color by subplot to a Canvas menu for these nodes (one card, or a selection). */
export function addSubplotColorMenu(menu: Menu, host: SubplotMenuHost, nodes: Iterable<CanvasCardNode>): void {
    const cards = ideaCards(nodes);
    const book = getActiveBook(host.plugin.settings);
    const canvasPath = (host.view as unknown as { file?: { path?: string } | null }).file?.path;
    if (!cards.length || !book?.sourceFolder.trim() || !canvasPath) return;
    const doc = host.view.containerEl.doc;
    const wheel = host.ringsNow(book.id);
    const { app, settings } = host.plugin;
    const directory = wheel // SAFE: a Canvas that cannot report its cards (getData) has no new subplots waiting
        ? readCanvasSubplotDirectory(settings, book, bookPlacementItems(app, settings, book).map(item => item.row), canvasPath, host.canvas.getData?.() ?? {}, doc, wheel)
        : null;
    const model = subplotMenuModel(directory, cards.map(card => cardHex(card, doc)));
    menu.addItem(item => {
        item.setTitle(t('ui.canvasSketch.menuSubplot')).setIcon('palette').setSection('radial-timeline');
        const submenu = submenuOf(item);
        if (!submenu) {
            console.error('[Canvas subplots] This version of Obsidian has no submenus, so the subplot list cannot open.');
            item.setDisabled(true);
            return;
        }
        if (model.kind === 'reading') {
            submenu.addItem(entry => entry.setTitle(t('ui.canvasSketch.readingSubplots')).setDisabled(true));
            return;
        }
        for (const entry of model.entries) {
            submenu.addItem(option => option.setTitle(swatchTitle(doc, entry)).setChecked(entry.checked).onClick(() => paint(host, cards, entry.hex)));
        }
        submenu.addSeparator();
        submenu.addItem(option => option.setTitle(t('ui.canvasSketch.newSubplot')).setIcon('plus')
            .onClick(() => openNewSubplot(host, book, canvasPath, cards, directory!))); // SAFE: a ready menu always has its directory
    });
}
