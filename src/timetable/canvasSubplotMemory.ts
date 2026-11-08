/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type RadialTimelinePlugin from '../main';
import type { CanvasSubplotChoice, CanvasSubplotMemoryRecord, NewerSchemaRecord } from '../types/settings';
import { isNewerSchemaRecord, normalizeOwnSubplotColor } from '../utils/ownSubplotColors';

/*
 * The subplot the Canvas card menu gave each idea card.
 *
 * A palette color does not name a subplot for good: ring order follows scene
 * counts, so the subplot wearing a palette slot can change. The menu
 * therefore remembers, card by card, which subplot it gave, and Bring ideas
 * into your book reads that before it matches colors. A choice holds while
 * its card wears the color the menu gave it; recolor the card any other way,
 * delete it, or turn it into a scene, and the choice lapses.
 *
 * A choice can name a subplot with no scenes yet (New subplot… in the menu).
 * Such a subplot belongs to its book, not to one Canvas: while any Canvas
 * holds a card given it, every Canvas of that book offers it, and no other
 * new subplot may take its name or its color.
 *
 * Plugin data, never scene YAML or the Canvas file.
 */

export const CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION = 1;

type Stored = CanvasSubplotMemoryRecord | NewerSchemaRecord | undefined;

/** One idea card on the open Canvas and the color it wears now (lower-case `#rrggbb`, null when unreadable). */
export interface CardNow { id: string; hex: string | null }

/** A new subplot of a book: named from the card menu, no scenes yet. */
export interface WaitingSubplot { name: string; color: string }

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function readable(record: Stored): CanvasSubplotMemoryRecord | undefined {
    return record?.schemaVersion === CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION ? record as CanvasSubplotMemoryRecord : undefined;
}

function writable(record: Stored): CanvasSubplotMemoryRecord | undefined {
    if (isNewerSchemaRecord(record, CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION)) {
        throw new Error('A newer version of Radial Timeline saved the subplots given to your Canvas cards; this version leaves them as they are.');
    }
    return readable(record);
}

function withCanvas(record: CanvasSubplotMemoryRecord | undefined, canvasPath: string, choices: CanvasSubplotChoice[]): CanvasSubplotMemoryRecord | undefined {
    const canvases = { ...record?.canvases };
    if (choices.length) canvases[canvasPath] = choices;
    else delete canvases[canvasPath];
    return Object.keys(canvases).length ? { schemaVersion: CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION, canvases } : undefined;
}

function checkedChoice(raw: unknown, bookIds: ReadonlySet<string>): CanvasSubplotChoice | null {
    const { bookId, subplot, color, cards } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const hex = normalizeOwnSubplotColor(color);
    if (typeof bookId !== 'string' || !bookIds.has(bookId) || typeof subplot !== 'string' || !subplot.trim() || !hex) return null;
    if (cards === undefined) return { bookId, subplot: subplot.trim(), color: hex };
    if (!Array.isArray(cards)) return null;
    const ids = [...new Set(cards.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    return ids.length ? { bookId, subplot: subplot.trim(), color: hex, cards: ids } : null;
}

/**
 * The record, checked on load. A record from a newer Radial Timeline is kept
 * exactly as found. Otherwise each choice needs a book that still exists, a
 * subplot, a hex color and at least one card; a card given two subplots
 * keeps the later one. The first record, `canvasPendingSubplots` (new
 * subplots by Canvas, naming no cards), is carried over as choices without
 * cards, each standing for the cards on its Canvas that wear its color.
 */
export function normalizeCanvasSubplotMemory(raw: unknown, legacy: unknown, bookIds: ReadonlySet<string>): Stored {
    if (isNewerSchemaRecord(raw, CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION)) return raw;
    const canvases: Record<string, CanvasSubplotChoice[]> = {};
    const stored = raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION
        ? (raw as { canvases?: unknown }).canvases : undefined;
    for (const [path, entries] of Object.entries(stored && typeof stored === 'object' ? stored as Record<string, unknown> : {})) {
        if (!path.trim() || !Array.isArray(entries)) continue;
        const choices = entries.map(entry => checkedChoice(entry, bookIds)).filter((choice): choice is CanvasSubplotChoice => choice !== null);
        // A card belongs to the last choice that names it.
        const claimed = new Set<string>();
        for (let index = choices.length - 1; index >= 0; index--) {
            const choice = choices[index];
            if (!choice.cards) continue;
            choice.cards = choice.cards.filter(id => !claimed.has(id));
            choice.cards.forEach(id => claimed.add(id));
        }
        const kept = choices.filter(choice => !choice.cards || choice.cards.length > 0);
        if (kept.length) canvases[path] = kept;
    }
    const first = legacy && typeof legacy === 'object' && (legacy as { schemaVersion?: unknown }).schemaVersion === 1
        ? (legacy as { canvases?: unknown }).canvases : undefined;
    for (const [path, entries] of Object.entries(first && typeof first === 'object' ? first as Record<string, unknown> : {})) {
        if (!path.trim() || !Array.isArray(entries)) continue;
        for (const entry of entries) {
            const { bookId, name, color } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            const choice = checkedChoice({ bookId, subplot: name, color }, bookIds);
            const list = canvases[path] ?? []; // SAFE: a Canvas the current record lacks starts its list here
            if (!choice || list.some(other => other.bookId === choice.bookId && sameName(other.subplot, choice.subplot))) continue;
            canvases[path] = [...list, choice];
        }
    }
    return Object.keys(canvases).length ? { schemaVersion: CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION, canvases } : undefined;
}

/**
 * A Canvas's choices as they stand on its cards now: each keeps the cards
 * still on the Canvas that still wear the color it gave them. A carried-over
 * choice without cards takes the cards wearing its color that no other
 * choice holds. Choices left with no card are gone.
 */
export function canvasChoicesNow(record: Stored, canvasPath: string, cards: readonly CardNow[]): CanvasSubplotChoice[] {
    const stored = readable(record)?.canvases[canvasPath] ?? []; // SAFE: a Canvas with no record has no choices
    const hexById = new Map(cards.map(card => [card.id, card.hex]));
    const held = new Set(stored.flatMap(choice => choice.cards ?? [])); // SAFE: a carried-over choice holds no named cards
    return stored.flatMap(choice => {
        const ids = choice.cards
            ? choice.cards.filter(id => hexById.get(id) === choice.color)
            : cards.filter(card => card.hex === choice.color && !held.has(card.id)).map(card => card.id);
        return ids.length ? [{ bookId: choice.bookId, subplot: choice.subplot, color: choice.color, cards: ids }] : [];
    });
}

/** The subplot the menu gave a card, for a book; null when it gave none. */
export function subplotOfCard(choices: readonly CanvasSubplotChoice[], cardId: string, bookId: string): string | null {
    return choices.find(choice => choice.bookId === bookId && choice.cards?.includes(cardId))?.subplot ?? null; // SAFE: null means the menu gave this card no subplot
}

/**
 * A book's new subplots: the subplots its choices name, on every Canvas,
 * that the book has no scenes for yet (`exists`). `open` puts the open
 * Canvas's choices as they stand now in place of its stored ones. One entry
 * per name, in the color the first choice gave it.
 */
export function waitingSubplots(
    record: Stored,
    bookId: string,
    exists: (name: string) => boolean,
    open: { canvasPath: string; choices: readonly CanvasSubplotChoice[] },
): WaitingSubplot[] {
    const canvases = { ...readable(record)?.canvases, [open.canvasPath]: [...open.choices] };
    const waiting: WaitingSubplot[] = [];
    for (const choices of Object.values(canvases)) {
        for (const choice of choices) {
            if (choice.bookId !== bookId || exists(choice.subplot) || waiting.some(entry => sameName(entry.name, choice.subplot))) continue;
            waiting.push({ name: choice.subplot, color: choice.color });
        }
    }
    return waiting;
}

/**
 * Remember that the menu gave these cards a subplot in a color. The open
 * Canvas's other choices are kept as they stand now (`open`), less these
 * cards; a choice of the same book, subplot and color takes them in.
 */
export function rememberCardSubplot(
    record: Stored,
    canvasPath: string,
    open: readonly CanvasSubplotChoice[],
    choice: { bookId: string; subplot: string; color: string; cards: readonly string[] },
): CanvasSubplotMemoryRecord {
    const current = writable(record);
    const color = normalizeOwnSubplotColor(choice.color);
    if (!choice.subplot.trim() || !color || !choice.cards.length) throw new Error('A card choice needs a subplot, a hex color and a card.');
    const given = new Set(choice.cards);
    const others = open
        .map(other => ({ ...other, cards: (other.cards ?? []).filter(id => !given.has(id)) })) // SAFE: choices as they stand now always name their cards
        .filter(other => other.cards.length > 0);
    const same = others.find(other => other.bookId === choice.bookId && sameName(other.subplot, choice.subplot) && other.color === color);
    const next = same
        ? others.map(other => other === same ? { ...other, cards: [...other.cards, ...given] } : other)
        : [...others, { bookId: choice.bookId, subplot: choice.subplot.trim(), color, cards: [...given] }];
    return withCanvas(current, canvasPath, next)!; // SAFE: the list holds the cards just given
}

/** Forget these cards (they became scenes), keeping the open Canvas's other choices as they stand now. */
export function forgetCards(record: Stored, canvasPath: string, open: readonly CanvasSubplotChoice[], cardIds: readonly string[]): CanvasSubplotMemoryRecord | undefined {
    const current = writable(record);
    const gone = new Set(cardIds);
    const kept = open
        .map(choice => ({ ...choice, cards: (choice.cards ?? []).filter(id => !gone.has(id)) })) // SAFE: choices as they stand now always name their cards
        .filter(choice => choice.cards.length > 0);
    return withCanvas(current, canvasPath, kept);
}

/**
 * A renamed Canvas, or a renamed folder holding Canvases, keeps its choices.
 * They replace whatever the record held at the new path, which can only be
 * left over from a Canvas no longer there.
 */
export function rebaseCanvasSubplotMemory(record: Stored, oldPath: string, newPath: string): Stored {
    const current = readable(record);
    if (!current) return record;
    const moved = (path: string): string | null => path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : null;
    const canvases: Record<string, CanvasSubplotChoice[]> = {};
    const arriving = new Set(Object.keys(current.canvases).map(moved).filter((path): path is string => path !== null));
    for (const [path, choices] of Object.entries(current.canvases)) {
        if (moved(path) === null && arriving.has(path)) continue;
        canvases[moved(path) ?? path] = choices; // SAFE: a path the rename does not touch keeps its place
    }
    return { schemaVersion: CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION, canvases };
}

/** A deleted Canvas, or a deleted folder of Canvases, takes its choices with it. */
export function dropCanvasSubplotMemory(record: Stored, deletedPath: string): Stored {
    const current = readable(record);
    if (!current) return record;
    const canvases = Object.fromEntries(Object.entries(current.canvases).filter(([path]) => path !== deletedPath && !path.startsWith(`${deletedPath}/`)));
    return Object.keys(canvases).length ? { schemaVersion: CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION, canvases } : undefined;
}

/** A removed book takes its choices with it. */
export function forgetBookSubplotMemory(record: Stored, bookId: string): Stored {
    const current = readable(record);
    if (!current) return record;
    const canvases: Record<string, CanvasSubplotChoice[]> = {};
    for (const [path, choices] of Object.entries(current.canvases)) {
        const kept = choices.filter(choice => choice.bookId !== bookId);
        if (kept.length) canvases[path] = kept;
    }
    return Object.keys(canvases).length ? { schemaVersion: CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION, canvases } : undefined;
}

/** Save a changed record; on failure the live settings keep the record they had. */
export async function saveCanvasSubplotMemory(plugin: RadialTimelinePlugin, next: Stored): Promise<void> {
    const previous = plugin.settings.canvasSubplotMemory;
    if (next) plugin.settings.canvasSubplotMemory = next;
    else delete plugin.settings.canvasSubplotMemory;
    try {
        await plugin.saveSettings();
    } catch (error) {
        plugin.settings.canvasSubplotMemory = previous;
        throw error;
    }
}
