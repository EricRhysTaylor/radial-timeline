/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Every open Timetable, so the plugin and the timeline can reach them: a book
 * switch or a color change redraws them, and hovering a scene on the wheel
 * lights up its row.
 */

export interface LiveTimetable {
    refresh(): void;
    /** Light up the row for this note (scrolling it into view), or clear it with null. */
    markLinkedRow(path: string | null): void;
}

const liveTimetables = new Set<LiveTimetable>();

export function trackTimetable(view: LiveTimetable): () => void {
    liveTimetables.add(view);
    return () => { liveTimetables.delete(view); };
}

/** Redraw every open Timetable (after a book switch or a color change). */
export function refreshTimetableViews(): void {
    liveTimetables.forEach(view => view.refresh());
}

/** The wheel is hovering this scene (or nothing): light up its row in every open Timetable. */
export function markTimetableRows(path: string | null): void {
    liveTimetables.forEach(view => view.markLinkedRow(path));
}
