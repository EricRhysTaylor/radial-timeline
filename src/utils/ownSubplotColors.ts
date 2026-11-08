/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { BookProfile, OwnSubplotColorsRecord } from '../types/settings';

/*
 * A subplot's own ring color, kept on its book's profile.
 *
 * Most subplots wear a palette slot chosen by ring order (Settings → Core →
 * Subplot ring colors). A subplot created from a Canvas card color wears that
 * card's color instead, so the author chooses it once. The record lives in
 * plugin data, never in scene YAML, and is read through
 * renderer/utils/subplotColors, the one place a subplot's color is decided.
 */

export const OWN_SUBPLOT_COLORS_SCHEMA_VERSION = 1;

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A color as it is stored, lower-case `#rrggbb`; null when the text is not a hex color. */
export function normalizeOwnSubplotColor(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!HEX_COLOR.test(text)) return null;
    const digits = text.slice(1).toLowerCase();
    return `#${digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits}`;
}

/**
 * The persisted record, checked on load. A record from another schema version
 * or with no valid entry is dropped, as is any entry whose name is blank or
 * whose value is not a hex color.
 */
export function normalizeOwnSubplotColorsRecord(raw: unknown): OwnSubplotColorsRecord | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const record = raw as { schemaVersion?: unknown; colors?: unknown };
    if (record.schemaVersion !== OWN_SUBPLOT_COLORS_SCHEMA_VERSION || !record.colors || typeof record.colors !== 'object') return undefined;
    const colors: Record<string, string> = {};
    for (const [name, value] of Object.entries(record.colors as Record<string, unknown>)) {
        const subplot = name.trim();
        const color = normalizeOwnSubplotColor(value);
        if (subplot && color) colors[subplot] = color;
    }
    return Object.keys(colors).length > 0 ? { schemaVersion: OWN_SUBPLOT_COLORS_SCHEMA_VERSION, colors } : undefined;
}

/** Every own color the book keeps, by subplot name. */
export function ownSubplotColorEntries(book: Pick<BookProfile, 'ownSubplotColors'> | null | undefined): Array<[string, string]> {
    return book?.ownSubplotColors ? Object.entries(book.ownSubplotColors.colors) : [];
}

function writeColors(book: BookProfile, colors: Record<string, string>): void {
    if (Object.keys(colors).length === 0) delete book.ownSubplotColors;
    else book.ownSubplotColors = { schemaVersion: OWN_SUBPLOT_COLORS_SCHEMA_VERSION, colors };
}

/** Give a subplot its own color on the live book profile. The caller saves settings. */
export function setOwnSubplotColor(book: BookProfile, subplot: string, color: string): void {
    const name = subplot.trim();
    const value = normalizeOwnSubplotColor(color);
    if (!name) throw new Error('A subplot needs a name to keep its own color.');
    if (!value) throw new Error(`"${color}" is not a hex color.`);
    writeColors(book, { ...book.ownSubplotColors?.colors, [name]: value });
}

/** Return a subplot to its ring's palette color. The caller saves settings. */
export function clearOwnSubplotColor(book: BookProfile, subplot: string): void {
    if (!book.ownSubplotColors?.colors[subplot]) return;
    const colors = { ...book.ownSubplotColors.colors };
    delete colors[subplot];
    writeColors(book, colors);
}

/**
 * A renamed subplot keeps its own color. Renaming onto a subplot that has a
 * color of its own merges into that subplot, which keeps its color.
 */
export function renameOwnSubplotColor(book: BookProfile, oldName: string, newName: string): void {
    const colors = book.ownSubplotColors?.colors;
    const color = colors?.[oldName];
    if (!colors || !color || oldName === newName) return;
    const next = { ...colors };
    delete next[oldName];
    if (!next[newName]) next[newName] = color;
    writeColors(book, next);
}
