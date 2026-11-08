/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Subplot colors: the one place a subplot's color is decided.
 *
 * A subplot wears its own color when its book gives it one (a subplot created
 * from a Canvas card color keeps that card's color; see
 * utils/ownSubplotColors). Every other subplot wears a palette slot:
 * ThemeService projects settings.subplotColors onto `--rt-subplot-colors-N`,
 * and the slots go, in ring order, to the subplots without a color of their
 * own. Everything that paints a subplot — rings, labels, the key, Timetable,
 * Panels, Outline, Canvas cards — reads its color from here.
 */

import type { BookProfile, RadialTimelineSettings } from '../../types/settings';
import { getActiveBook, getSagaBooks, getTimelineScope } from '../../utils/books';
import { getBookMainPlotName, getMainPlotName } from '../../utils/mainPlot';
import { normalizeOwnSubplotColor, ownSubplotColorEntries } from '../../utils/ownSubplotColors';
import { cssColorToHex } from '../../utils/colour';

export const SUBPLOT_COLOR_SLOTS = 16;

/** Dispatched on each open window when the palette or a subplot's own color changes; Canvas cards repaint. */
export const SUBPLOT_COLORS_CHANGED_EVENT = 'rt-subplot-colors-changed';

/** Wrap any integer onto the colour slots; non-finite input lands on slot 0. */
export function normalizeSubplotColorIndex(index: number): number {
    if (!Number.isFinite(index)) return 0;
    return ((Math.trunc(index) % SUBPLOT_COLOR_SLOTS) + SUBPLOT_COLOR_SLOTS) % SUBPLOT_COLOR_SLOTS;
}

/**
 * The colour for a subplot slot, read from the document's CSS variable.
 * A missing variable means the theme variables were never applied to this
 * document; that is a setup fault and throws rather than painting a stand-in.
 */
export function readSubplotColor(doc: Document, index: number): string {
    const varName = `--rt-subplot-colors-${normalizeSubplotColorIndex(index)}`;
    const value = getComputedStyle(doc.documentElement).getPropertyValue(varName).trim();
    if (!value) {
        throw new Error(`${varName} is not defined; subplot colours were not applied to this document.`);
    }
    return value;
}

/** The subplots on a set of rings that wear their own color: name → `#rrggbb`. */
export type OwnSubplotColors = ReadonlyMap<string, string>;

/** How one subplot is painted: its own color, or a palette slot. Both are ordinary states. */
export type SubplotColor =
    | { kind: 'own'; color: string }
    | { kind: 'slot'; slot: number };

/*
 * The palette as lower-case `#rrggbb`, slot by slot, so slot colors can be
 * compared with own colors without a document. The plugin syncs it from
 * settings on load and on every save, as it does the main plot's name;
 * ThemeService paints the same colors (subplotPaletteColors).
 */
let paletteHexes: ReadonlyArray<string | null> = [];

export function syncSubplotPalette(colors: readonly string[]): void {
    paletteHexes = colors.map(color => normalizeOwnSubplotColor(color));
}

/**
 * Every subplot's color, for subplots in ring order (outermost first). A
 * subplot with its own color wears it; the palette slots go, in ring order,
 * to the subplots without one. Giving a subplot its own color therefore never
 * repaints another subplot, and a slot whose color a subplot on these rings
 * wears as its own goes to no other subplot, so no two subplots share a
 * color while the palette has colors left. An own color kept for a subplot
 * with no scenes here holds nothing. The main plot of the rings drawn now (a
 * book's, or the saga's) always wears a palette slot, whatever color a book
 * gives a subplot of that name, and the first slot when it leads the rings.
 */
export function assignSubplotColors(order: readonly string[], own: OwnSubplotColors): Map<string, SubplotColor> {
    const colors = new Map<string, SubplotColor>();
    const mainPlot = getMainPlotName();
    const worn = new Set(order.filter(subplot => subplot !== mainPlot && own.has(subplot)).map(subplot => own.get(subplot)!)); // SAFE: has() checked just before
    const wornSlot = (slot: number): boolean => { const hex = paletteHexes[slot]; return !!hex && worn.has(hex); };
    let next = 0;
    const takeSlot = (): number => {
        for (let tried = 0; tried < SUBPLOT_COLOR_SLOTS; tried++) {
            const slot = normalizeSubplotColorIndex(next++);
            if (!wornSlot(slot)) return slot;
        }
        // Every palette color is worn as an own color: rings repeat colors, as they do past sixteen.
        return normalizeSubplotColorIndex(next++);
    };
    for (const subplot of order) {
        if (colors.has(subplot)) continue;
        const color = subplot === mainPlot ? undefined : own.get(subplot);
        if (color !== undefined) { colors.set(subplot, { kind: 'own', color }); continue; }
        // Ring 1's main plot keeps the first slot.
        const slot = subplot === mainPlot && next === 0 ? normalizeSubplotColorIndex(next++) : takeSlot();
        colors.set(subplot, { kind: 'slot', slot });
    }
    return colors;
}

/** CSS to paint with. A slot reads the palette variable, so it follows palette edits live. */
export function subplotColorCss(color: SubplotColor): string {
    return color.kind === 'own' ? color.color : `var(--rt-subplot-colors-${color.slot})`;
}

/** The concrete color, for SVG attributes, exports and color comparisons. */
export function readSubplotColorValue(doc: Document, color: SubplotColor): string {
    return color.kind === 'own' ? color.color : readSubplotColor(doc, color.slot);
}

/**
 * The color as lower-case `#rrggbb`, the form Canvas cards store and colors
 * are compared in. A palette color that is not an opaque color is a setup
 * fault and throws.
 */
export function readSubplotColorHex(doc: Document, color: SubplotColor): string {
    if (color.kind === 'own') return color.color;
    const value = readSubplotColor(doc, color.slot);
    const hex = cssColorToHex(doc, value);
    if (!hex) throw new Error(`Palette color ${color.slot + 1} ("${value}") is not an opaque color.`);
    return hex;
}

/**
 * The color a scene's subplot paints with on a timeline's rings. A scene with
 * no subplot belongs to the main plot; a name the rings don't hold (a
 * backdrop, or a book whose main plot has no scenes yet) paints as the main
 * plot does, which always holds the first palette slot.
 */
export function subplotColorOn(colors: ReadonlyMap<string, SubplotColor>, subplot: string | undefined): SubplotColor {
    const name = subplot && subplot.trim().length > 0 ? subplot : getMainPlotName();
    return colors.get(name) ?? colors.get(getMainPlotName()) ?? { kind: 'slot', slot: 0 }; // SAFE: the main plot owns ring 1 and palette slot 1 even before it has a scene
}

/**
 * A book's subplots that wear their own color. Its main plot never does: ring
 * 1 always wears the first palette slot.
 */
export function bookOwnSubplotColors(book: Pick<BookProfile, 'ownSubplotColors' | 'mainPlotName'> | null | undefined): Map<string, string> {
    const mainPlot = getBookMainPlotName(book);
    return new Map(ownSubplotColorEntries(book).filter(([name]) => name !== mainPlot));
}

/**
 * Several books drawn as one set of rings (the saga timeline, a Timetable
 * over several books): a subplot wears its own color when every book that
 * gives it one agrees on it. Books that disagree leave it on its palette slot.
 */
export function sharedOwnSubplotColors(books: readonly BookProfile[]): Map<string, string> {
    const shared = new Map<string, string>();
    const disputed = new Set<string>();
    for (const book of books) {
        for (const [name, color] of bookOwnSubplotColors(book)) {
            if (disputed.has(name)) continue;
            const agreed = shared.get(name);
            if (agreed === undefined) shared.set(name, color);
            else if (agreed !== color) { shared.delete(name); disputed.add(name); }
        }
    }
    return shared;
}

/** The own colors on the timeline as it is scoped now: the active book's, or the saga's shared ones. */
export function timelineOwnSubplotColors(settings: Pick<RadialTimelineSettings, 'books' | 'activeBookId' | 'timelineScope'>): Map<string, string> {
    if (getTimelineScope(settings) === 'saga') return sharedOwnSubplotColors(getSagaBooks(settings));
    return bookOwnSubplotColors(getActiveBook(settings));
}
