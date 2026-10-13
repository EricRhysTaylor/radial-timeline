/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: the reading pane
 * ---------------------------
 * A note opened from a Timetable row, or from the wheel while a Timetable is
 * showing, appears in the note pane stacked with the table (below it, unless
 * the author moved it above), replacing the note there. The wheel, the table
 * and one note make a three-pane layout, and the pane's back and forward
 * buttons step through the scenes visited.
 * - A note already open anywhere is revealed, never opened twice.
 * - Cmd/Ctrl-click opens a new tab in the pane instead of replacing its note.
 * - A pinned note in the pane stays; the new note opens in a tab beside it.
 * - With no pane yet, the first note splits the table downward.
 */

import { Keymap, MarkdownView, type App, type OpenViewState, type TFile, type WorkspaceLeaf } from 'obsidian';
import { openOrRevealFile, type OpenMatchHighlight } from '../utils/fileUtils';
import { openTimetableElements } from './timetableRegistry';

export interface PaneBox {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/**
 * The box stacked nearest the table in its column (directly above or below
 * it), or -1. A box in another column, or one overlapping the table (a tab in
 * the table's own group), doesn't count.
 */
export function pickStackedPane(table: PaneBox, boxes: PaneBox[]): number {
    const tableWidth = table.right - table.left;
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    boxes.forEach((box, index) => {
        const width = box.right - box.left;
        const overlap = Math.min(box.right, table.right) - Math.max(box.left, table.left);
        if (width <= 0 || box.bottom - box.top <= 0) return;
        if (overlap < Math.min(width, tableWidth) / 2) return;
        let gap: number;
        if (box.top >= table.bottom - 1) gap = box.top - table.bottom;
        else if (box.bottom <= table.top + 1) gap = table.top - box.bottom;
        else return;
        if (gap < bestGap) {
            best = index;
            bestGap = gap;
        }
    });
    return best;
}

/** The leaf of a Timetable showing in this window, if one is. */
export function showingTimetableLeaf(app: App, doc: Document): WorkspaceLeaf | null {
    const roots = openTimetableElements().filter(el => el.isConnected && el.ownerDocument === doc);
    if (roots.length === 0) return null;
    const leaf = app.workspace.getLeavesOfType('bases').find(candidate =>
        roots.some(el => candidate.view.containerEl.contains(el))
        && candidate.view.containerEl.getBoundingClientRect().width > 0);
    return leaf ?? null;
}

/** Open a note from a Timetable row (or the wheel while a Timetable is showing) in the reading pane. */
export async function openInReadingPane(
    app: App,
    file: TFile,
    tableLeaf: WorkspaceLeaf,
    options: { evt?: MouseEvent; highlight?: OpenMatchHighlight } = {},
): Promise<void> {
    const state: OpenViewState = options.highlight ? { active: true, eState: { match: options.highlight } } : { active: true };
    const root = tableLeaf.getRoot();
    const notes = [...app.workspace.getLeavesOfType('markdown'), ...app.workspace.getLeavesOfType('empty')]
        .filter(leaf => leaf.getRoot() === root);
    const showing = notes.find(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    if (showing) {
        // SAFE: openFile used to carry search-highlight state that openLinkText cannot pass to an already-open leaf
        if (options.highlight) await showing.openFile(file, state);
        await app.workspace.revealLeaf(showing);
        app.workspace.setActiveLeaf(showing, { focus: true });
        return;
    }
    const others = notes.filter(leaf => leaf.parent !== tableLeaf.parent);
    const index = pickStackedPane(tableLeaf.view.containerEl.getBoundingClientRect(), others.map(leaf => leaf.view.containerEl.getBoundingClientRect()));
    const pane = index >= 0 ? others[index] : undefined;
    if (!pane) {
        await app.workspace.createLeafBySplit(tableLeaf, 'horizontal').openFile(file, state); // SAFE: openFile used to start the reading pane below the Timetable, never over it
        return;
    }
    if ((options.evt && Keymap.isModEvent(options.evt)) || pane.getViewState().pinned) {
        // A new tab in the pane's group, not the table's (the active group when a row is clicked).
        app.workspace.setActiveLeaf(pane, { focus: false });
        await app.workspace.getLeaf('tab').openFile(file, state); // SAFE: openFile used for a new tab in the reading pane
        return;
    }
    await pane.openFile(file, state); // SAFE: openFile used to show the note in the reading pane, never over the Timetable
}

/**
 * Open a note clicked on the wheel: in a showing Timetable's reading pane,
 * otherwise as the wheel always has.
 */
export async function openFromWheel(
    app: App,
    file: TFile,
    from: Element,
    highlight?: OpenMatchHighlight,
    evt?: MouseEvent,
): Promise<void> {
    const tableLeaf = showingTimetableLeaf(app, from.ownerDocument);
    if (!tableLeaf) {
        await openOrRevealFile(app, file, false, highlight);
        return;
    }
    await openInReadingPane(app, file, tableLeaf, { evt, highlight });
}
