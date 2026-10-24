/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Note titles
 * -----------
 * A note's file name is its number prefix (`12.5 `, optional) followed by its
 * title. Renaming a sketch, promoting it, and naming a Timetable file all
 * shape a title the same way.
 */

/** Characters no platform's file names can hold. */
const FILENAME_UNSAFE = /[\\/:*?"<>|#^[\]]+/g;
const NUMBER_PREFIX = /^\s*\d+(?:\.\d+)?\s+/;

/** A title made safe for a file name; empty when nothing usable is left. */
export function safeTitle(title: string): string {
    return title.replace(FILENAME_UNSAFE, ' ').replace(/\s+/g, ' ').trim();
}

/** A file name split into its number prefix (with its trailing space, or '') and its title. */
export function splitNumberPrefix(basename: string): { lead: string; title: string } {
    const lead = NUMBER_PREFIX.exec(basename)?.[0] ?? '';
    return { lead, title: basename.slice(lead.length) };
}

/**
 * True when a note still has a placeholder name: the new-sketch name (in
 * English or the author's language) or Obsidian's "Untitled", with or
 * without a counter, after any number prefix.
 */
export function isUntitledName(basename: string, sketchName: string): boolean {
    const { title } = splitNumberPrefix(basename);
    const names = [...new Set(['Untitled sketch', sketchName, 'Untitled'])]
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^(?:${names.join('|')})(?: \\d+)?$`, 'i').test(title.trim());
}
