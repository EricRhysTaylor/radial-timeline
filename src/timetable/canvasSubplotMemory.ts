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
 * its card wears the color the menu gave it. A card recolored another way
 * (say by an undo) keeps its choice dormant until the Canvas next opens, so
 * a redo brings the subplot back; a card deleted or turned into a note drops
 * it. A card copied on the Canvas, with a new id but the same color, joins
 * the one choice of that color there.
 *
 * A choice made with New subplot… names a subplot with no scenes yet. Such a
 * subplot belongs to its book, not to one Canvas: while any Canvas holds a
 * card given it, every Canvas of that book offers it, and no other new
 * subplot may take its name or its color. Every Canvas's choices are checked
 * against its cards whenever the Canvas file changes and when Obsidian
 * starts (timetable/CanvasSubplotMemoryUpkeep), so a new subplot is offered
 * only while some card still wears it.
 *
 * Plugin data, never scene YAML or the Canvas file.
 */

export const CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION = 1;

type Stored = CanvasSubplotMemoryRecord | NewerSchemaRecord | undefined;

/** One idea card on a Canvas and the color it wears now (lower-case `#rrggbb`, null when unreadable). */
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

function withCanvases(canvases: Record<string, CanvasSubplotChoice[]>): CanvasSubplotMemoryRecord | undefined {
    const kept = Object.fromEntries(Object.entries(canvases).filter(([, choices]) => choices.length > 0));
    return Object.keys(kept).length ? { schemaVersion: CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION, canvases: kept } : undefined;
}

function withCanvas(record: CanvasSubplotMemoryRecord | undefined, canvasPath: string, choices: CanvasSubplotChoice[]): CanvasSubplotMemoryRecord | undefined {
    return withCanvases({ ...record?.canvases, [canvasPath]: choices });
}

function choice(fields: { bookId: string; subplot: string; color: string; cards?: string[]; dormant?: string[]; created?: boolean }): CanvasSubplotChoice {
    return {
        bookId: fields.bookId, subplot: fields.subplot, color: fields.color,
        ...(fields.cards ? { cards: fields.cards } : {}),
        ...(fields.dormant?.length ? { dormant: fields.dormant } : {}),
        ...(fields.created ? { created: true as const } : {}),
    };
}

/** Whether a choice still names a card, wearing its color or not; a carried-over choice names none and stands for its color. */
function namesCards(entry: CanvasSubplotChoice): boolean {
    return !entry.cards || entry.cards.length > 0 || !!entry.dormant?.length;
}

function cardIds(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) return null;
    return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

function checkedChoice(raw: unknown, bookIds: ReadonlySet<string>): CanvasSubplotChoice | null {
    const { bookId, subplot, color, cards, dormant, created } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const hex = normalizeOwnSubplotColor(color);
    if (typeof bookId !== 'string' || !bookIds.has(bookId) || typeof subplot !== 'string' || !subplot.trim() || !hex) return null;
    if (cards === undefined) return choice({ bookId, subplot: subplot.trim(), color: hex, created: created === true });
    const ids = cardIds(cards);
    if (!ids) return null;
    const resting = cardIds(dormant) ?? []; // SAFE: a choice with no dormant list has no dormant cards
    const entry = choice({ bookId, subplot: subplot.trim(), color: hex, cards: ids, dormant: resting.filter(id => !ids.includes(id)), created: created === true });
    return namesCards(entry) ? entry : null;
}

/**
 * The record, checked on load. A record from a newer Radial Timeline is kept
 * exactly as found, and the first record is then left alone too
 * (`legacyMerged` false). Otherwise each choice needs a book that still
 * exists, a subplot, a hex color and at least one card; a card given two
 * subplots keeps the later one. The first record, `canvasPendingSubplots`
 * (new subplots by Canvas, naming no cards), is carried in as New subplot…
 * choices without cards, each standing for the cards on its Canvas that wear
 * its color.
 */
export function normalizeCanvasSubplotMemory(raw: unknown, legacy: unknown, bookIds: ReadonlySet<string>): { record: Stored; legacyMerged: boolean } {
    if (isNewerSchemaRecord(raw, CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION)) return { record: raw, legacyMerged: false };
    const canvases: Record<string, CanvasSubplotChoice[]> = {};
    const stored = raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === CANVAS_SUBPLOT_MEMORY_SCHEMA_VERSION
        ? (raw as { canvases?: unknown }).canvases : undefined;
    for (const [path, entries] of Object.entries(stored && typeof stored === 'object' ? stored as Record<string, unknown> : {})) {
        if (!path.trim() || !Array.isArray(entries)) continue;
        const choices = entries.map(entry => checkedChoice(entry, bookIds)).filter((entry): entry is CanvasSubplotChoice => entry !== null);
        // A card belongs to the last choice that names it.
        const claimed = new Set<string>();
        for (let index = choices.length - 1; index >= 0; index--) {
            const entry = choices[index];
            if (!entry.cards) continue;
            const ids = entry.cards.filter(id => !claimed.has(id));
            const resting = (entry.dormant ?? []).filter(id => !claimed.has(id)); // SAFE: a choice with no dormant list has no dormant cards
            [...ids, ...resting].forEach(id => claimed.add(id));
            choices[index] = choice({ ...entry, cards: ids, dormant: resting });
        }
        canvases[path] = choices.filter(namesCards);
    }
    const first = legacy && typeof legacy === 'object' && (legacy as { schemaVersion?: unknown }).schemaVersion === 1
        ? (legacy as { canvases?: unknown }).canvases : undefined;
    for (const [path, entries] of Object.entries(first && typeof first === 'object' ? first as Record<string, unknown> : {})) {
        if (!path.trim() || !Array.isArray(entries)) continue;
        for (const entry of entries) {
            const { bookId, name, color } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            const carried = checkedChoice({ bookId, subplot: name, color, created: true }, bookIds);
            const list = canvases[path] ?? []; // SAFE: a Canvas the current record lacks starts its list here
            if (!carried || list.some(other => other.bookId === carried.bookId && sameName(other.subplot, carried.subplot))) continue;
            canvases[path] = [...list, carried];
        }
    }
    return { record: withCanvases(canvases), legacyMerged: true };
}

/**
 * A Canvas's choices as they stand on its cards now. A choice's `cards` are
 * the cards still on the Canvas that wear the color it gave them; its
 * `dormant` ones are still there in another color for now (an undo), and
 * join `cards` again once they wear it (a redo). A card no choice names,
 * whose color exactly one choice on the Canvas gave, joins that choice: a
 * copied card, or the cards a carried-over choice stands for. Cards gone
 * from the Canvas are dropped, and so is a choice left with none.
 */
export function canvasChoicesNow(record: Stored, canvasPath: string, cards: readonly CardNow[]): CanvasSubplotChoice[] {
    const stored = readable(record)?.canvases[canvasPath] ?? []; // SAFE: a Canvas with no record has no choices
    const hexById = new Map(cards.map(card => [card.id, card.hex]));
    const kept = stored.map(entry => {
        const named = [...(entry.cards ?? []), ...(entry.dormant ?? [])].filter(id => hexById.has(id)); // SAFE: a carried-over choice names no cards
        return { entry, ids: named.filter(id => hexById.get(id) === entry.color), dormant: named.filter(id => hexById.get(id) !== entry.color) };
    });
    const held = new Set(kept.flatMap(({ ids, dormant }) => [...ids, ...dormant]));
    for (const card of cards) {
        if (held.has(card.id) || card.hex === null) continue;
        const wearing = kept.filter(({ entry }) => entry.color === card.hex);
        if (wearing.length === 1) wearing[0].ids.push(card.id);
    }
    return kept.flatMap(({ entry, ids, dormant }) => ids.length || dormant.length ? [choice({ ...entry, cards: ids, dormant })] : []);
}

/**
 * A Canvas's stored choices brought in line with its cards now; the same
 * record when nothing changed. `sweep` (the Canvas opening, Obsidian
 * starting) also drops dormant cards, so a choice no card wears lapses.
 */
export function reviseCanvasChoices(record: Stored, canvasPath: string, cards: readonly CardNow[], sweep: boolean): Stored {
    const current = readable(record);
    if (!current?.canvases[canvasPath]) return record;
    const now = canvasChoicesNow(current, canvasPath, cards);
    const kept = sweep ? now.filter(entry => entry.cards!.length > 0).map(entry => choice({ ...entry, dormant: [] })) : now; // SAFE: choices as they stand now always name their cards
    if (JSON.stringify(kept) === JSON.stringify(current.canvases[canvasPath])) return record;
    return withCanvas(current, canvasPath, kept);
}

/** The Canvases the record holds choices for; none for a newer record this build cannot read. */
export function rememberedCanvases(record: Stored): string[] {
    return Object.keys(readable(record)?.canvases ?? {}); // SAFE: no readable record remembers no Canvas
}

/** The subplot the menu gave a card, for a book; null when it gave none. */
export function subplotOfCard(choices: readonly CanvasSubplotChoice[], cardId: string, bookId: string): string | null {
    return choices.find(entry => entry.bookId === bookId && entry.cards?.includes(cardId))?.subplot ?? null; // SAFE: null means the menu gave this card no subplot
}

/**
 * A book's new subplots: the subplots its New subplot… choices name, on
 * every Canvas, that the book has no scenes for yet (`exists`). A choice of a
 * subplot that once existed and is gone (renamed, removed) names no new
 * subplot. `open` puts the open Canvas's choices as they stand now in place
 * of its stored ones. One entry per name, in the color the first choice gave.
 */
export function waitingSubplots(
    record: Stored,
    bookId: string,
    exists: (name: string) => boolean,
    open: { canvasPath: string; choices: readonly CanvasSubplotChoice[] },
): WaitingSubplot[] {
    const canvases = { ...readable(record)?.canvases, [open.canvasPath]: [...open.choices] };
    const waiting: WaitingSubplot[] = [];
    // A choice whose cards are all dormant is worn by no card for now.
    const worn = (entry: CanvasSubplotChoice): boolean => !entry.cards || entry.cards.length > 0;
    for (const choices of Object.values(canvases)) {
        for (const entry of choices) {
            if (entry.bookId !== bookId || !entry.created || !worn(entry) || exists(entry.subplot) || waiting.some(other => sameName(other.name, entry.subplot))) continue;
            waiting.push({ name: entry.subplot, color: entry.color });
        }
    }
    return waiting;
}

/**
 * Remember that the menu gave these cards a subplot in a color; `created`
 * when the subplot has no scenes yet. The open Canvas's other choices are
 * kept as they stand now (`open`), less these cards; a choice of the same
 * book, subplot and color takes them in.
 */
export function rememberCardSubplot(
    record: Stored,
    canvasPath: string,
    open: readonly CanvasSubplotChoice[],
    given: { bookId: string; subplot: string; color: string; cards: readonly string[]; created: boolean },
): CanvasSubplotMemoryRecord {
    const current = writable(record);
    const color = normalizeOwnSubplotColor(given.color);
    if (!given.subplot.trim() || !color || !given.cards.length) throw new Error('A card choice needs a subplot, a hex color and a card.');
    const ids = new Set(given.cards);
    const others = without(open, ids);
    const same = others.find(other => other.bookId === given.bookId && sameName(other.subplot, given.subplot) && other.color === color);
    const next = same
        ? others.map(other => other === same ? choice({ ...other, cards: [...other.cards!, ...ids], created: !!other.created || given.created }) : other) // SAFE: every choice above names its cards
        : [...others, choice({ bookId: given.bookId, subplot: given.subplot.trim(), color, cards: [...ids], created: given.created })];
    return withCanvas(current, canvasPath, next)!; // SAFE: the list holds the cards just given
}

/** Forget these cards (they became notes), keeping the open Canvas's other choices as they stand now. */
export function forgetCards(record: Stored, canvasPath: string, open: readonly CanvasSubplotChoice[], cardIds: readonly string[]): CanvasSubplotMemoryRecord | undefined {
    const current = writable(record);
    return withCanvas(current, canvasPath, without(open, new Set(cardIds)));
}

/** The choices less these cards, wearing their color or dormant; choices left with no card are gone. */
function without(open: readonly CanvasSubplotChoice[], ids: ReadonlySet<string>): CanvasSubplotChoice[] {
    return open
        .map(entry => choice({ ...entry, cards: (entry.cards ?? []).filter(id => !ids.has(id)), dormant: (entry.dormant ?? []).filter(id => !ids.has(id)) })) // SAFE: choices as they stand now always name their cards
        .filter(namesCards);
}

/**
 * These subplots of a book have scenes now: choices on every Canvas stop
 * counting them as new, so a later rename or removal never brings them back
 * as new subplots.
 */
export function markSubplotsMade(record: Stored, bookId: string, names: readonly string[]): Stored {
    const current = readable(record);
    if (!current || !names.length) return record;
    const made = (entry: CanvasSubplotChoice): boolean => !!entry.created && entry.bookId === bookId && names.some(name => sameName(name, entry.subplot));
    if (!Object.values(current.canvases).some(choices => choices.some(made))) return record;
    return withCanvases(Object.fromEntries(Object.entries(current.canvases).map(([path, choices]) =>
        [path, choices.map(entry => made(entry) ? choice({ ...entry, created: false }) : entry)])));
}

/** A subplot renamed in the Subplot manager: the cards given it are given the new name, on every Canvas. */
export function renameCanvasSubplotChoices(record: Stored, bookId: string, oldName: string, newName: string): Stored {
    const current = readable(record);
    const renamed = (entry: CanvasSubplotChoice): boolean => entry.bookId === bookId && entry.subplot === oldName;
    if (!current || oldName === newName || !Object.values(current.canvases).some(choices => choices.some(renamed))) return record;
    return withCanvases(Object.fromEntries(Object.entries(current.canvases).map(([path, choices]) =>
        [path, choices.map(entry => renamed(entry) ? { ...entry, subplot: newName } : entry)])));
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

/** Keep only the Canvases still in the vault (`exists`), say after files were deleted outside Obsidian. */
export function keepCanvases(record: Stored, exists: (path: string) => boolean): Stored {
    const current = readable(record);
    if (!current || Object.keys(current.canvases).every(exists)) return record;
    return withCanvases(Object.fromEntries(Object.entries(current.canvases).filter(([path]) => exists(path))));
}

/** A deleted Canvas, or a deleted folder of Canvases, takes its choices with it. */
export function dropCanvasSubplotMemory(record: Stored, deletedPath: string): Stored {
    return keepCanvases(record, path => path !== deletedPath && !path.startsWith(`${deletedPath}/`));
}

/** A removed book takes its choices with it. */
export function forgetBookSubplotMemory(record: Stored, bookId: string): Stored {
    const current = readable(record);
    if (!current) return record;
    return withCanvases(Object.fromEntries(Object.entries(current.canvases).map(([path, choices]) => [path, choices.filter(entry => entry.bookId !== bookId)])));
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
