import { Notice, type ItemView, type Menu, type MenuItem } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile, CanvasSubplotChoice, RadialTimelineSettings } from '../types/settings';
import type { TimetableRow } from './timetableModel';
import { t, tCount } from '../i18n';
import { getActiveBook } from '../utils/books';
import { bookOwnSubplotColors, readSubplotColorHex, SUBPLOT_COLOR_SLOTS, type SubplotColor } from '../renderer/utils/subplotColors';
import { bookPlacementItems, bookSubplotChoices } from './canvasBookCards';
import { cardColor, cardColorHex } from './canvasCardSubplots';
import { canvasTextCards, type StoryCanvasData } from './canvasSketches';
import { isStoryActHeading } from './canvasNavigation';
import { cardMeaning, paletteChoices, subplotDirectory, subplotMenuModel, type DirectoryEntry } from './canvasSubplotDirectory';
import { canvasChoicesNow, rememberCardSubplot, saveCanvasSubplotMemory, subplotOfCard, waitingSubplots } from './canvasSubplotMemory';
import { CanvasNewSubplotModal } from './CanvasNewSubplotModal';

/*
 * Radial Timeline: Color by subplot, in a Canvas card's right-click menu.
 *
 * One place to give idea cards a subplot: the active book's subplots in ring
 * order, each in its timeline color, then the book's new subplots, then New
 * subplot…, which names one and gives it a free palette color. Choosing sets
 * every card the menu acts on to that exact color and remembers, card by
 * card, which subplot it gave (timetable/canvasSubplotMemory), so Bring ideas
 * into your book starts each card on its subplot even after ring order moves
 * the palette colors.
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

/** Idea cards: text cards with an id that are not Act headings, which a color can give a subplot. */
export function ideaCards<T extends CanvasCardNode>(nodes: Iterable<T>): T[] {
    return [...nodes].filter(node => {
        const data = node.getData?.();
        return data?.type === 'text' && typeof data.id === 'string' && typeof node.setColor === 'function' && !(typeof data.text === 'string' && isStoryActHeading(data.text));
    });
}

/** The palette as lower-case `#rrggbb`, slot by slot. */
export function paletteHexes(doc: Document): string[] {
    return Array.from({ length: SUBPLOT_COLOR_SLOTS }, (_, slot) => readSubplotColorHex(doc, { kind: 'slot', slot }));
}

/**
 * Card colors as lower-case `#rrggbb`, each distinct color read once: a
 * Canvas preset is read from the theme, which takes a drawing surface.
 */
export function cardHexReader(doc: Document): (color: string | null) => string | null {
    const read = new Map<string, string | null>();
    return color => {
        if (color === null) return null;
        if (!read.has(color)) read.set(color, cardColorHex(doc, color));
        return read.get(color)!; // SAFE: set just above
    };
}

/** What the card menu and Bring ideas into your book read for a book on one Canvas. */
export interface CanvasSubplots {
    /** The book's subplots in ring order with their colors now, then its new subplots. */
    directory: DirectoryEntry[];
    /** The open Canvas's card choices as they stand on its cards now. */
    choices: CanvasSubplotChoice[];
}

export function readCanvasSubplots(
    settings: RadialTimelineSettings,
    book: BookProfile,
    rows: TimetableRow[],
    canvasPath: string,
    canvasData: StoryCanvasData,
    doc: Document,
    hexOf: (color: string | null) => string | null,
    wheel: ReadonlyMap<string, SubplotColor>,
): CanvasSubplots {
    const rings = bookSubplotChoices(wheel, bookOwnSubplotColors(book), rows).map(ring => ({ name: ring.name, hex: readSubplotColorHex(doc, ring.color) }));
    const choices = canvasChoicesNow(settings.canvasSubplotMemory, canvasPath, canvasTextCards(canvasData).map(card => ({ id: card.id, hex: hexOf(cardColor(card)) })));
    const exists = (name: string): boolean => rings.some(ring => ring.name.trim().toLowerCase() === name.trim().toLowerCase());
    const waiting = waitingSubplots(settings.canvasSubplotMemory, book.id, exists, { canvasPath, choices });
    return { directory: subplotDirectory(rings, waiting), choices };
}

function cardId(node: CanvasCardNode): string {
    return node.getData!().id!; // SAFE: ideaCards keeps only cards with data and an id
}

/** The open Canvas's card choices as they stand on its cards at this moment. */
function choicesNow(host: SubplotMenuHost, canvasPath: string): CanvasSubplotChoice[] {
    const hexOf = cardHexReader(host.view.containerEl.doc);
    const cards = canvasTextCards(host.canvas.getData?.() ?? {}).map(card => ({ id: card.id, hex: hexOf(cardColor(card)) })); // SAFE: a Canvas that cannot report its cards keeps no choices
    return canvasChoicesNow(host.plugin.settings.canvasSubplotMemory, canvasPath, cards);
}

/** Give the cards a subplot: its exact color on every card, and the choice remembered card by card. */
function choose(host: SubplotMenuHost, book: BookProfile, canvasPath: string, cards: CanvasCardNode[], subplot: string, hex: string): void {
    for (const card of cards) card.setColor!(hex); // SAFE: ideaCards keeps only cards that can take a color
    host.canvas.requestSave?.();
    const { plugin } = host;
    void (async () => {
        const next = rememberCardSubplot(plugin.settings.canvasSubplotMemory, canvasPath, choicesNow(host, canvasPath), { bookId: book.id, subplot, color: hex, cards: cards.map(cardId) });
        await saveCanvasSubplotMemory(plugin, next);
    })().catch((error: unknown) => {
        console.error('[Canvas subplots] Could not remember the subplot given to these cards', error);
        new Notice(t('ui.canvasSketch.pendingNotSaved', { subplot }), 10000);
    });
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

/** Add Radial Timeline: Color by subplot to a Canvas menu for these nodes (one card, or a selection). */
export function addSubplotColorMenu(menu: Menu, host: SubplotMenuHost, nodes: Iterable<CanvasCardNode>): void {
    const cards = ideaCards(nodes);
    const book = getActiveBook(host.plugin.settings);
    const canvasPath = (host.view as unknown as { file?: { path?: string } | null }).file?.path;
    if (!cards.length || !book?.sourceFolder.trim() || !canvasPath) return;
    const doc = host.view.containerEl.doc;
    const hexOf = cardHexReader(doc);
    const wheel = host.ringsNow(book.id);
    const { app, settings } = host.plugin;
    const data = host.canvas.getData?.() ?? {}; // SAFE: a Canvas that cannot report its cards (getData) has no card choices
    const read = wheel ? readCanvasSubplots(settings, book, bookPlacementItems(app, settings, book).map(item => item.row), canvasPath, data, doc, hexOf, wheel) : null;
    const meanings = read ? cards.map(card => cardMeaning(subplotOfCard(read.choices, cardId(card), book.id), hexOf(cardColor(card.getData?.() ?? {})), read.directory)) : []; // SAFE: an idea card always has data
    const model = subplotMenuModel(read?.directory ?? null, meanings); // SAFE: no directory yet reads as still reading
    menu.addItem(item => {
        item.setTitle(t('ui.canvasSketch.menuSubplot')).setIcon('palette').setSection('radial-timeline');
        const submenu = submenuOf(item);
        if (!submenu) {
            console.error('[Canvas subplots] This version of Obsidian has no submenus, so the subplot list cannot open.');
            item.setDisabled(true);
            return;
        }
        if (model.kind === 'reading' || !read) {
            submenu.addItem(entry => entry.setTitle(t('ui.canvasSketch.readingSubplots')).setDisabled(true));
            return;
        }
        for (const entry of model.entries) {
            submenu.addItem(option => option.setTitle(swatchTitle(doc, entry)).setChecked(entry.checked)
                .onClick(() => choose(host, book, canvasPath, cards, entry.name, entry.hex)));
        }
        submenu.addSeparator();
        submenu.addItem(option => option.setTitle(t('ui.canvasSketch.newSubplot')).setIcon('plus').onClick(() => {
            new CanvasNewSubplotModal(app, {
                bookTitle: book.title,
                directory: read.directory,
                palette: paletteChoices(paletteHexes(doc), read.directory),
                confirm: t('ui.canvasSketch.colorCards', { cards: tCount('card', cards.length) }),
                onChoose: choice => choose(host, book, canvasPath, cards, choice.name, choice.color),
            }).open();
        }));
    });
}
