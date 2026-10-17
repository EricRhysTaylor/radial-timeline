/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { BookProfile, RadialTimelineSettings } from '../types/settings';
import { getSagaBooks, getTimelineScope } from './books';

/**
 * The main plot: the subplot that owns ring 1, the outermost ring, whatever
 * it is called.
 *
 * A scene with no Subplot belongs to it, beat notes are filed under it, and it
 * can be renamed in the Subplot Manager but never deleted. Each book names its
 * own main plot (BookProfile.mainPlotName); a book that never renamed it calls
 * it "Main Plot".
 *
 * Code reads the name ring 1 uses through getMainPlotName() rather than
 * threading settings through every caller, the same way t() reads the active
 * locale. The plugin syncs it on load and on every save:
 *   - book timeline: the active book's own name;
 *   - saga timeline: the name every saga book shares, or "Main Plot" when
 *     they differ (each book's own main plot is then shown under that name).
 */

export const DEFAULT_MAIN_PLOT_NAME = 'Main Plot';

let mainPlotName = DEFAULT_MAIN_PLOT_NAME;

export function getMainPlotName(): string {
    return mainPlotName;
}

/** A book's own main plot name. */
export function getBookMainPlotName(book: Pick<BookProfile, 'mainPlotName'> | null | undefined): string {
    const name = book?.mainPlotName?.trim() ?? '';
    return name.length > 0 ? name : DEFAULT_MAIN_PLOT_NAME;
}

type MainPlotSettings = Pick<RadialTimelineSettings, 'books' | 'activeBookId' | 'timelineScope'>;

function activeBook(settings: MainPlotSettings): BookProfile | undefined {
    const books = settings.books ?? []; // SAFE: pre-Book-Manager vaults have no books array
    return books.find(book => book.id === settings.activeBookId) ?? books[0];
}

/** The name ring 1 uses for the timeline's current scope (see above). */
export function resolveMainPlotName(settings: MainPlotSettings): string {
    if (getTimelineScope(settings) !== 'saga') return getBookMainPlotName(activeBook(settings));
    const names = new Set(getSagaBooks(settings).map(book => getBookMainPlotName(book)));
    return names.size === 1 ? [...names][0] : DEFAULT_MAIN_PLOT_NAME;
}

/**
 * A book's scenes as the saga timeline shows them: the book's own main plot
 * owns ring 1 under the saga's main plot name. Scenes with no Subplot already
 * load under that name; this renames the ones that list the book's own.
 */
export function toSagaMainPlot<T extends { subplot?: string }>(scenes: T[], book: Pick<BookProfile, 'mainPlotName'>): T[] {
    const bookMainPlot = getBookMainPlotName(book);
    const sagaMainPlot = getMainPlotName();
    if (bookMainPlot === sagaMainPlot) return scenes;
    return scenes.map(scene => scene.subplot === bookMainPlot ? { ...scene, subplot: sagaMainPlot } : scene);
}

export function syncMainPlotName(settings: MainPlotSettings): void {
    mainPlotName = resolveMainPlotName(settings);
}
