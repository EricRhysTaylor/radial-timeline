/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { BookProfile, NewerSchemaRecord, OwnSubplotColorsRecord } from '../types/settings';

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

/** A record stamped by a newer Radial Timeline, which this build keeps but never reads. */
export function isNewerSchemaRecord(raw: unknown, current: number): raw is NewerSchemaRecord {
    if (!raw || typeof raw !== 'object') return false;
    const version = (raw as { schemaVersion?: unknown }).schemaVersion;
    return typeof version === 'number' && Number.isInteger(version) && version > current;
}

/**
 * The persisted record, checked on load. A record from a newer schema version
 * is kept exactly as found. A version 1 record keeps only entries with a name
 * and a hex color, and is dropped when none is left; anything else is dropped.
 */
export function normalizeOwnSubplotColorsRecord(raw: unknown): OwnSubplotColorsRecord | NewerSchemaRecord | undefined {
    if (isNewerSchemaRecord(raw, OWN_SUBPLOT_COLORS_SCHEMA_VERSION)) return raw;
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

/** The book's record when this build can read it; a newer record reads as none. */
function readableRecord(book: Pick<BookProfile, 'ownSubplotColors'> | null | undefined): OwnSubplotColorsRecord | undefined {
    const record = book?.ownSubplotColors;
    return record?.schemaVersion === OWN_SUBPLOT_COLORS_SCHEMA_VERSION ? record as OwnSubplotColorsRecord : undefined;
}

/** False when a newer Radial Timeline saved this book's own colors: this build must leave them as they are. */
export function ownSubplotColorsWritable(book: Pick<BookProfile, 'ownSubplotColors'>): boolean {
    return !isNewerSchemaRecord(book.ownSubplotColors, OWN_SUBPLOT_COLORS_SCHEMA_VERSION);
}

/** Every own color the book keeps, by subplot name. */
export function ownSubplotColorEntries(book: Pick<BookProfile, 'ownSubplotColors'> | null | undefined): Array<[string, string]> {
    const record = readableRecord(book);
    return record ? Object.entries(record.colors) : [];
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
    if (!ownSubplotColorsWritable(book)) throw new Error('A newer version of Radial Timeline saved these subplot colors; this version leaves them as they are.');
    writeColors(book, { ...readableRecord(book)?.colors, [name]: value });
}

/** Return a subplot to its ring's palette color. The caller saves settings. */
export function clearOwnSubplotColor(book: BookProfile, subplot: string): void {
    const colors = readableRecord(book)?.colors;
    if (!colors?.[subplot]) return;
    const next = { ...colors };
    delete next[subplot];
    writeColors(book, next);
}

/** How a rename lands, which decides where the renamed subplot's own color goes. */
export interface SubplotRenameOutcome {
    /** The new name is a subplot the book already has: the two merge, and it keeps its own color or palette slot. */
    mergesInto: boolean;
    /** Some scenes could not be renamed and still list the old name, so the old subplot stays too. */
    oldNameRemains: boolean;
}

/**
 * Follow a subplot rename. A subplot renamed to a new name keeps its own
 * color; merged into a subplot the book already has, the merged subplot keeps
 * its own color or palette slot and never takes the renamed one's. When some
 * scenes keep the old name, the old subplot keeps its color too.
 */
export function renameOwnSubplotColor(book: BookProfile, oldName: string, newName: string, outcome: SubplotRenameOutcome): void {
    const colors = readableRecord(book)?.colors;
    const color = colors?.[oldName];
    if (!colors || !color || oldName === newName) return;
    const next = { ...colors };
    if (!outcome.oldNameRemains) delete next[oldName];
    if (!outcome.mergesInto) next[newName] = color;
    writeColors(book, next);
}
