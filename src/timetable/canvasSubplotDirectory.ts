/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { CanvasPendingSubplot } from '../types/settings';

/*
 * The subplot directory a Canvas card color is chosen from.
 *
 * The book's subplots come first, in ring order, each in the color it wears
 * on the timeline (read through renderer/utils/subplotColors); then the new
 * subplots named on this Canvas that are still waiting for their scenes
 * (timetable/canvasPendingSubplots). A new subplot takes a palette color no
 * subplot uses yet. Colors compare as lower-case `#rrggbb`.
 */

/** One subplot a card color can stand for. */
export interface DirectoryEntry {
    name: string;
    /** Its color now, lower-case `#rrggbb`. */
    hex: string;
    /** Named from a Canvas card menu; its scenes do not exist yet. */
    pending: boolean;
}

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether a remembered new subplot is still waiting: no subplot of the book
 * has its name or its color, and an idea card on its Canvas wears its color
 * (`worn`, lower-case hex).
 */
export function isStillWaiting(entry: CanvasPendingSubplot, rings: ReadonlyArray<{ name: string; hex: string }>, worn: ReadonlySet<string>): boolean {
    return worn.has(entry.color) && !rings.some(ring => sameName(ring.name, entry.name) || ring.hex === entry.color);
}

/** The book's subplots (`rings`, ring order with their colors now), then the new subplots still waiting. */
export function subplotDirectory(
    rings: ReadonlyArray<{ name: string; hex: string }>,
    pending: readonly CanvasPendingSubplot[],
    worn: ReadonlySet<string>,
): DirectoryEntry[] {
    return [
        ...rings.map(ring => ({ name: ring.name, hex: ring.hex, pending: false })),
        ...pending.filter(entry => isStillWaiting(entry, rings, worn)).map(entry => ({ name: entry.name, hex: entry.color, pending: true })),
    ];
}

/** One palette slot as the New subplot chooser shows it. */
export interface PaletteChoice {
    slot: number;
    hex: string;
    /** The subplots wearing this color; empty when it is free. */
    usedBy: string[];
}

/** The palette (`palette[slot]`, lower-case hex), free colors first, then the ones in use, each in slot order. */
export function paletteChoices(palette: readonly string[], directory: ReadonlyArray<Pick<DirectoryEntry, 'name' | 'hex'>>): PaletteChoice[] {
    const choices = palette.map((hex, slot) => ({ slot, hex, usedBy: directory.filter(entry => entry.hex === hex).map(entry => entry.name) }));
    return [...choices.filter(choice => !choice.usedBy.length), ...choices.filter(choice => choice.usedBy.length)];
}

/** What a card color already means on the timeline. */
export type CardColorStanding =
    /** A subplot of the book wears exactly this color. */
    | { kind: 'subplot'; subplot: string }
    /** A new subplot waiting on this Canvas wears it. */
    | { kind: 'pending'; subplot: string }
    /** A palette color no subplot wears yet. */
    | { kind: 'palette' }
    /** Not a timeline color: another Canvas preset, a custom color, or one the theme would not show as a color. */
    | { kind: 'outside' };

/** `hex` is the card color as `#rrggbb`, or null when it cannot be read. */
export function cardColorStanding(hex: string | null, directory: readonly DirectoryEntry[], palette: readonly string[]): CardColorStanding {
    if (hex === null) return { kind: 'outside' };
    const entry = directory.find(candidate => candidate.hex === hex);
    if (entry) return entry.pending ? { kind: 'pending', subplot: entry.name } : { kind: 'subplot', subplot: entry.name };
    return palette.includes(hex) ? { kind: 'palette' } : { kind: 'outside' };
}

/** A subplot named in the directory, in its own spelling. */
export function directoryEntryNamed(directory: readonly DirectoryEntry[], name: string): DirectoryEntry | null {
    return directory.find(entry => sameName(entry.name, name)) ?? null; // SAFE: null means a name the directory lacks, a new subplot
}

/** What the card menu offers: each subplot, checked when every card it acts on already wears its color. */
export type SubplotMenuModel =
    /** The book's rings are still being read; the menu says so rather than guess. */
    | { kind: 'reading' }
    | { kind: 'ready'; entries: Array<DirectoryEntry & { checked: boolean }> };

export function subplotMenuModel(directory: readonly DirectoryEntry[] | null, cardHexes: ReadonlyArray<string | null>): SubplotMenuModel {
    if (!directory) return { kind: 'reading' };
    return {
        kind: 'ready',
        entries: directory.map(entry => ({ ...entry, checked: cardHexes.length > 0 && cardHexes.every(hex => hex === entry.hex) })),
    };
}
