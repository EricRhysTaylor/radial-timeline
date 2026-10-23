/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The meeting point of the timeline and the Timetable
 * ----------------------------------------------------
 * Each view publishes what the other needs and subscribes to what it offers.
 * - The timeline publishes its mode and Chronologue micro-modes; Timetables
 *   follow them.
 * - The open note, a ring the subplot key spotlights, and an act label click
 *   reach every open Timetable.
 * - A Timetable with its lens on publishes its rows; the timeline dims every
 *   scene that isn't among them.
 * - A Timetable can color the timeline's scenes by one of its columns.
 * - A note clicked on the wheel opens in a showing Timetable's reading pane.
 * Dependency-free on purpose, so both sides can import it without a cycle.
 */

export interface LiveTimetable {
    /** The table's element, so the timeline can find the pane it shows in (see readingPane). */
    readonly rootEl: HTMLElement;
    refresh(): void;
    /** The wheel is hovering this scene (or nothing): light up its row in the hovered cell's color (a CSS color). */
    markLinkedRow(path: string | null, color: string | null, reveal?: boolean): void;
    /** This note is open in an editor (or none is): mark its row. */
    markCurrentNote(path: string | null): void;
    /** The subplot key spotlights this ring (or none): dim rows outside it. */
    markRing(subplot: string | null): void;
    /** An act label (or, in saga scope, a book label) was clicked: show that part of the table. */
    revealSegment(index: number): void;
}

/**
 * The timeline's mode with its micro-modes: Chronologue's Shift and Alt, and
 * Narrative's runtime view. Each is false outside its own mode.
 */
export interface TimelineModeState {
    mode: string;
    shift: boolean;
    alt: boolean;
    runtime: boolean;
}

/** A Timetable's rows, lighting up the timeline. */
export interface TimelineLens {
    /** The Timetable that owns the lens. */
    owner: object;
    paths: Set<string>;
    /** The Timetable view's name, shown on the timeline's lens pill. */
    label: string;
    /** Turn the lens off at its source (the pill's close button). */
    turnOff: () => void;
}

/** A Timetable column coloring the timeline's scenes, one color per value. */
export interface TimelineColoring {
    owner: object;
    /** The column's name, for the legend. */
    property: string;
    /** Each scene's value. Scenes without one are drawn neutral. */
    values: Map<string, string>;
    /** Values in legend order, each with its color slot (0–15, the ring palette). */
    legend: Array<{ value: string; colorIndex: number }>;
    turnOff: () => void;
}

const liveTimetables = new Set<LiveTimetable>();
let timelineMode: TimelineModeState | null = null;
let currentNote: string | null = null;
let lens: TimelineLens | null = null;
let coloring: TimelineColoring | null = null;
/** The timeline redraws its overlays (lens, coloring) when either changes. */
const overlayListeners = new Set<() => void>();

const presenceListeners = new Set<() => void>();

export function trackTimetable(view: LiveTimetable): () => void {
    liveTimetables.add(view);
    presenceListeners.forEach(listener => listener());
    return () => {
        liveTimetables.delete(view);
        presenceListeners.forEach(listener => listener());
    };
}

/** True while at least one Timetable is open (the timeline's act labels then link to it). */
export function hasOpenTimetable(): boolean {
    return liveTimetables.size > 0;
}

/** Each open Timetable's element. */
export function openTimetableElements(): HTMLElement[] {
    return [...liveTimetables].map(view => view.rootEl);
}

/** The timeline hears when Timetables open or close. */
export function onTimetablePresenceChange(listener: () => void): () => void {
    presenceListeners.add(listener);
    return () => { presenceListeners.delete(listener); };
}

/** Redraw every open Timetable (after a book switch, a mode change or a color change). */
export function refreshTimetableViews(): void {
    liveTimetables.forEach(view => view.refresh());
}

/** The wheel is hovering this scene (or nothing): light up its row, in the hovered cell's color, in every open Timetable. */
export function markTimetableRows(path: string | null, color: string | null = null, reveal = true): void {
    liveTimetables.forEach(view => view.markLinkedRow(path, color, reveal));
}

// ── Mode ────────────────────────────────────────────────────────────────

/** The timeline's current mode, or null before any timeline has opened. */
export function currentTimelineMode(): TimelineModeState | null {
    return timelineMode;
}

/** Called by the timeline whenever its mode or one of its micro-modes changes. */
export function publishTimelineMode(state: TimelineModeState): void {
    const next: TimelineModeState = {
        mode: state.mode,
        shift: state.mode === 'chronologue' && state.shift,
        alt: state.mode === 'chronologue' && state.alt,
        runtime: state.mode === 'narrative' && state.runtime,
    };
    if (timelineMode
        && timelineMode.mode === next.mode
        && timelineMode.shift === next.shift
        && timelineMode.alt === next.alt
        && timelineMode.runtime === next.runtime) return;
    timelineMode = next;
    refreshTimetableViews();
}

// ── Open note, rings, act labels ────────────────────────────────────────

export function currentNotePath(): string | null {
    return currentNote;
}

/** A note was opened in an editor (or the last one closed). */
export function publishCurrentNote(path: string | null): void {
    if (path === currentNote) return;
    currentNote = path;
    liveTimetables.forEach(view => view.markCurrentNote(path));
}

/** The subplot key spotlights a ring (or none). */
export function markTimetableRing(subplot: string | null): void {
    liveTimetables.forEach(view => view.markRing(subplot));
}

/** An act label (a book label in saga scope) was clicked on the timeline. */
export function revealTimetableSegment(index: number): void {
    liveTimetables.forEach(view => view.revealSegment(index));
}

// ── Lens ────────────────────────────────────────────────────────────────

export function currentTimelineLens(): TimelineLens | null {
    return lens;
}

/** A Timetable turns its lens on, or its rows changed. The newest lens wins. */
export function setTimelineLens(next: TimelineLens): void {
    if (lens && lens.owner === next.owner && lens.label === next.label && sameSet(lens.paths, next.paths)) return;
    lens = next;
    overlayListeners.forEach(listener => listener());
}

/** A Timetable turns its lens off (or closes). Only the owner can clear its lens. */
export function clearTimelineLens(owner: object): void {
    if (!lens || lens.owner !== owner) return;
    lens = null;
    overlayListeners.forEach(listener => listener());
}

// ── Coloring ────────────────────────────────────────────────────────────

export function currentTimelineColoring(): TimelineColoring | null {
    return coloring;
}

/** A Timetable colors the timeline by a column, or its values changed. The newest wins. */
export function setTimelineColoring(next: TimelineColoring): void {
    if (coloring
        && coloring.owner === next.owner
        && coloring.property === next.property
        && sameMap(coloring.values, next.values)
        && coloring.legend.map(entry => `${entry.value}\u0000${entry.colorIndex}`).join('|') === next.legend.map(entry => `${entry.value}\u0000${entry.colorIndex}`).join('|')) return;
    coloring = next;
    overlayListeners.forEach(listener => listener());
}

/** Only the Timetable that colors the timeline can stop it. */
export function clearTimelineColoring(owner: object): void {
    if (!coloring || coloring.owner !== owner) return;
    coloring = null;
    overlayListeners.forEach(listener => listener());
}

/** The timeline redraws its overlays whenever the lens or the coloring changes. */
export function onTimelineOverlayChange(listener: () => void): () => void {
    overlayListeners.add(listener);
    return () => { overlayListeners.delete(listener); };
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) if (b.get(key) !== value) return false;
    return true;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
}
