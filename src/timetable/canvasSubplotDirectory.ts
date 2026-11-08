/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { WaitingSubplot } from './canvasSubplotMemory';

/*
 * The subplot directory a Canvas card color is chosen from.
 *
 * The book's subplots come first, in ring order, each in the color it wears
 * on the timeline (read through renderer/utils/subplotColors); then the
 * book's new subplots, named from the card menu on any of its Canvases and
 * waiting for their scenes (timetable/canvasSubplotMemory). A new subplot
 * takes a name and a palette color no subplot of the book has. Colors
 * compare as lower-case `#rrggbb`.
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

/** The book's subplots (`rings`, ring order with their colors now), then its new subplots (`waiting`) under names it does not have. */
export function subplotDirectory(rings: ReadonlyArray<{ name: string; hex: string }>, waiting: readonly WaitingSubplot[]): DirectoryEntry[] {
    return [
        ...rings.map(ring => ({ name: ring.name, hex: ring.hex, pending: false })),
        ...waiting.filter(entry => !rings.some(ring => sameName(ring.name, entry.name))).map(entry => ({ name: entry.name, hex: entry.color, pending: true })),
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

/**
 * The subplot a card stands for: the one the card menu gave it (`given`),
 * else the subplot, or the new subplot, that wears exactly its color.
 */
export function cardMeaning(given: string | null, hex: string | null, directory: readonly DirectoryEntry[]): string | null {
    if (given !== null) return given;
    return hex === null ? null : directory.find(entry => entry.hex === hex)?.name ?? null; // SAFE: a color no subplot wears stands for none
}

/** What the card menu offers: each subplot, checked when every card it acts on already stands for it. */
export type SubplotMenuModel =
    /** The book's rings are still being read; the menu says so rather than guess. */
    | { kind: 'reading' }
    | { kind: 'ready'; entries: Array<DirectoryEntry & { checked: boolean }> };

/** `meanings`: what each card the menu acts on stands for now (cardMeaning). */
export function subplotMenuModel(directory: readonly DirectoryEntry[] | null, meanings: ReadonlyArray<string | null>): SubplotMenuModel {
    if (!directory) return { kind: 'reading' };
    return {
        kind: 'ready',
        entries: directory.map(entry => ({ ...entry, checked: meanings.length > 0 && meanings.every(meaning => meaning !== null && sameName(meaning, entry.name)) })),
    };
}
