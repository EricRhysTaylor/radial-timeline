/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type RadialTimelinePlugin from '../main';
import type { CanvasPendingSubplot, CanvasPendingSubplotsRecord, NewerSchemaRecord } from '../types/settings';
import { isNewerSchemaRecord, normalizeOwnSubplotColor } from '../utils/ownSubplotColors';

/*
 * New subplots waiting on their Canvas cards.
 *
 * "New subplot…" in a Canvas card's menu names a subplot and gives its cards
 * a palette color before any of its scenes exist. Bring ideas into your book
 * reads the pair back, so a row in that color starts on that name. Each pair
 * belongs to the Canvas whose cards wear it, and lasts while they do: once
 * the subplot has scenes, or no idea card on that Canvas wears its color, it
 * is no longer offered and the next write drops it. Plugin data, never scene
 * YAML or the Canvas file.
 */

export const CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION = 1;

type Stored = CanvasPendingSubplotsRecord | NewerSchemaRecord | undefined;

/** The record as this build reads it; a newer record reads as empty. */
function readable(record: Stored): CanvasPendingSubplotsRecord | undefined {
    return record?.schemaVersion === CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION ? record as CanvasPendingSubplotsRecord : undefined;
}

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The persisted record, checked on load. A newer record is kept exactly as
 * found. A version 1 record keeps entries with a book, a name and a hex
 * color; on each Canvas, one entry per name and per color within a book.
 */
export function normalizeCanvasPendingSubplots(raw: unknown): Stored {
    if (isNewerSchemaRecord(raw, CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION)) return raw;
    if (!raw || typeof raw !== 'object') return undefined;
    const record = raw as { schemaVersion?: unknown; canvases?: unknown };
    if (record.schemaVersion !== CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION || !record.canvases || typeof record.canvases !== 'object') return undefined;
    const canvases: Record<string, CanvasPendingSubplot[]> = {};
    for (const [path, entries] of Object.entries(record.canvases as Record<string, unknown>)) {
        if (!path.trim() || !Array.isArray(entries)) continue;
        const kept: CanvasPendingSubplot[] = [];
        for (const entry of entries as unknown[]) {
            const { bookId, name, color } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            const hex = normalizeOwnSubplotColor(color);
            if (typeof bookId !== 'string' || !bookId || typeof name !== 'string' || !name.trim() || !hex) continue;
            if (kept.some(other => other.bookId === bookId && (sameName(other.name, name) || other.color === hex))) continue;
            kept.push({ bookId, name: name.trim(), color: hex });
        }
        if (kept.length) canvases[path] = kept;
    }
    return Object.keys(canvases).length ? { schemaVersion: CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION, canvases } : undefined;
}

/** The new subplots remembered on a Canvas for a book. */
export function pendingSubplotsOn(record: Stored, canvasPath: string, bookId: string): CanvasPendingSubplot[] {
    return (readable(record)?.canvases[canvasPath] ?? []).filter(entry => entry.bookId === bookId); // SAFE: a Canvas with no record has no new subplots waiting
}

function withCanvas(record: CanvasPendingSubplotsRecord | undefined, canvasPath: string, entries: CanvasPendingSubplot[]): CanvasPendingSubplotsRecord | undefined {
    const canvases = { ...record?.canvases };
    if (entries.length) canvases[canvasPath] = entries;
    else delete canvases[canvasPath];
    return Object.keys(canvases).length ? { schemaVersion: CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION, canvases } : undefined;
}

function writable(record: Stored): CanvasPendingSubplotsRecord | undefined {
    if (isNewerSchemaRecord(record, CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION)) {
        throw new Error('A newer version of Radial Timeline saved the new subplots on your Canvases; this version leaves them as they are.');
    }
    return readable(record);
}

/**
 * Remember a new subplot on a Canvas. It replaces an entry of the same book
 * with its name or its color, and the book's other entries on that Canvas
 * stay only while `stillWaiting` says their cards still wear them.
 */
export function rememberPendingSubplot(
    record: Stored,
    canvasPath: string,
    entry: CanvasPendingSubplot,
    stillWaiting: (entry: CanvasPendingSubplot) => boolean,
): CanvasPendingSubplotsRecord {
    const current = writable(record);
    const color = normalizeOwnSubplotColor(entry.color);
    if (!entry.name.trim() || !color) throw new Error('A new subplot needs a name and a hex color.');
    const next: CanvasPendingSubplot = { bookId: entry.bookId, name: entry.name.trim(), color };
    const others = (current?.canvases[canvasPath] ?? []).filter(other => other.bookId !== next.bookId // SAFE: a Canvas with no entries starts its list here
        || (!sameName(other.name, next.name) && other.color !== next.color && stillWaiting(other)));
    return withCanvas(current, canvasPath, [...others, next])!; // SAFE: the list holds the entry just added
}

/**
 * Drop a book's new subplots on a Canvas once their scenes exist (`created`),
 * along with any `stillWaiting` no longer offers.
 */
export function forgetPendingSubplots(
    record: Stored,
    canvasPath: string,
    bookId: string,
    created: readonly string[],
    stillWaiting: (entry: CanvasPendingSubplot) => boolean,
): CanvasPendingSubplotsRecord | undefined {
    const current = writable(record);
    const entries = current?.canvases[canvasPath];
    if (!entries) return current;
    const kept = entries.filter(entry => entry.bookId !== bookId || (!created.some(name => sameName(name, entry.name)) && stillWaiting(entry)));
    return withCanvas(current, canvasPath, kept);
}

/** A renamed Canvas, or a renamed folder holding Canvases, keeps its new subplots. */
export function rebasePendingSubplotCanvases(record: Stored, oldPath: string, newPath: string): Stored {
    const current = readable(record);
    if (!current) return record;
    const rebase = (path: string): string => path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
    const canvases: Record<string, CanvasPendingSubplot[]> = {};
    for (const [path, entries] of Object.entries(current.canvases)) {
        const target = rebase(path);
        // Never overwrite a Canvas that already has entries at the new path.
        canvases[target !== path && current.canvases[target] ? path : target] = entries;
    }
    return { schemaVersion: CANVAS_PENDING_SUBPLOTS_SCHEMA_VERSION, canvases };
}

/** Save a changed record; on failure the live settings keep the record they had. */
export async function savePendingSubplots(plugin: RadialTimelinePlugin, next: CanvasPendingSubplotsRecord | undefined): Promise<void> {
    const previous = plugin.settings.canvasPendingSubplots;
    if (next) plugin.settings.canvasPendingSubplots = next;
    else delete plugin.settings.canvasPendingSubplots;
    try {
        await plugin.saveSettings();
    } catch (error) {
        plugin.settings.canvasPendingSubplots = previous;
        throw error;
    }
}
