import { cssColorToHex } from '../utils/colour';
import { normalizeOwnSubplotColor } from '../utils/ownSubplotColors';
import type { CardColorStanding } from './canvasSubplotDirectory';

type Box = { x?: number; y?: number; width?: number; height?: number };
type Group = Box & { label?: string };

/** A card's color as Canvas stores it, a preset number or a hex value, so #AA00FF and #aa00ff count as one. */
export function cardColor(card: { color?: unknown }): string | null {
    return typeof card.color === 'string' && card.color.trim() ? card.color.trim().toLowerCase() : null;
}

/** The colors on these cards, in the order they first appear, with how many cards carry each. */
export function cardColorCounts(cards: Array<{ color?: unknown }>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const card of cards) {
        const color = cardColor(card);
        if (color) counts.set(color, (counts.get(color) ?? 0) + 1); // SAFE: the first card of a color counts from zero
    }
    return counts;
}

/** A preset follows the theme's Canvas palette; a custom color is used as it stands. */
export function cardColorCss(color: string): string {
    return /^[1-6]$/.test(color) ? `var(--canvas-color-${color})` : color;
}

/**
 * The `#rrggbb` a card color paints now: a custom color as it stands, a
 * preset as the theme draws it at this moment. A subplot created from the
 * card keeps this value, so its ring does not change with the theme. Null
 * when the theme's preset cannot be read as an opaque color.
 */
export function cardColorHex(doc: Document, color: string): string | null {
    if (!/^[1-6]$/.test(color)) return normalizeOwnSubplotColor(color);
    const css = getComputedStyle(doc.body).getPropertyValue(`--canvas-color-${color}`).trim();
    return css ? cssColorToHex(doc, css) : null;
}

/**
 * The subplot a color already stands for. Linked cards of that color on this
 * Canvas decide first, when they share exactly one subplot; after that, a ring
 * painted in exactly the color the cards paint (`paints`, lower-case hex).
 * Anything less certain stays unassigned.
 */
export function subplotForColor(
    color: string,
    paints: string | null,
    linked: Array<{ color: string; subplots: string[] }>,
    rings: Array<{ name: string; color: string }>,
): string | null {
    const memberships = linked.filter(card => card.color === color).map(card => card.subplots);
    const shared = memberships[0]?.filter(name => memberships.every(subplots => subplots.includes(name))) ?? []; // SAFE: no linked card of this color means nothing shared
    if (shared.length === 1) return shared[0];
    if (paints === null) return null;
    return rings.find(ring => ring.color === paints)?.name ?? null;
}

/** What one row's cards do to the book's subplots when they become scenes. */
export type CardColorSubplot =
    /** A subplot the book already has (Main Plot included): it keeps the color it wears. */
    | { kind: 'existing'; subplot: string }
    /** A new subplot, wearing `color` (lower-case hex): this row's cards are the first to name it with a color. */
    | { kind: 'new'; subplot: string; color: string }
    /** A new subplot another row gives its color. */
    | { kind: 'sharesNew'; subplot: string; color: string }
    /** No subplot yet: Create waits for one. */
    | { kind: 'unassigned' }
    /** A new name with no palette color of its own yet: Create waits for one. */
    | { kind: 'needsColor'; subplot: string };

/** One row in Bring ideas into your book: the selected cards of one color, or of one color the card menu gave one subplot. */
export interface CardColorRow {
    /** The row's key: its card color, with the subplot the card menu gave its cards when it gave one. */
    key: string;
    /** The subplot typed or chosen for it; blank for none. */
    name: string;
    /** The card color as `#rrggbb`, null when it cannot be read. */
    hex: string | null;
    standing: CardColorStanding;
    /** A palette color picked on this row for a new subplot. */
    palette?: string;
}

/** True while some row stops Create until the author chooses for it. */
export function plansWaitOnAuthor(plans: ReadonlyMap<string, CardColorSubplot>): boolean {
    return [...plans.values()].some(plan => plan.kind === 'unassigned' || plan.kind === 'needsColor');
}

/**
 * Which subplot each row's cards join, and the color a new subplot wears,
 * so every color is chosen once and always means one subplot. Rows come in
 * the dialog's order. A name the book already has (`existing` returns the
 * book's spelling) keeps that subplot's color. A new name takes, from the
 * first row naming it that can give one: the color of the new subplot
 * waiting under that name (`pending`), the palette color picked on the row,
 * or the row's card color when that is a free palette color. A color another
 * subplot wears (`colorOwner`) or that an earlier row gave another new name
 * is no offer. A name with no color left waits for a palette color, and a
 * row with no name waits for a subplot; only uncolored cards join the main
 * plot by themselves.
 */
export function planCardColorSubplots(
    rows: readonly CardColorRow[],
    existing: (name: string) => string | null,
    pending: (name: string) => { name: string; hex: string } | null,
    colorOwner: (hex: string) => string | null,
): Map<string, CardColorSubplot> {
    const supplied = new Map<string, { subplot: string; color: string; row: string }>();
    const spelling = new Map<string, string>();
    for (const row of rows) {
        const typed = row.name.trim();
        if (!typed || existing(typed) !== null) continue;
        const waiting = pending(typed);
        const name = typed.toLowerCase();
        if (!spelling.has(name)) spelling.set(name, waiting?.name ?? typed); // SAFE: a name no new subplot holds keeps the spelling typed
        if (supplied.has(name)) continue;
        const offer = waiting?.hex ?? row.palette ?? (row.standing.kind === 'palette' ? row.hex : null); // SAFE: no waiting, picked or free palette color leaves the name waiting for one
        if (!offer) continue;
        const owner = colorOwner(offer);
        if (owner !== null && owner.trim().toLowerCase() !== name) continue;
        if ([...supplied.values()].some(other => other.color === offer)) continue;
        supplied.set(name, { subplot: spelling.get(name)!, color: offer, row: row.key }); // SAFE: the spelling is set just above
    }
    const plans = new Map<string, CardColorSubplot>();
    for (const row of rows) {
        const typed = row.name.trim();
        if (!typed) { plans.set(row.key, { kind: 'unassigned' }); continue; }
        const known = existing(typed);
        if (known !== null) { plans.set(row.key, { kind: 'existing', subplot: known }); continue; }
        const name = typed.toLowerCase();
        const supply = supplied.get(name);
        if (!supply) { plans.set(row.key, { kind: 'needsColor', subplot: spelling.get(name)! }); continue; } // SAFE: every new name was spelled in the first pass
        plans.set(row.key, supply.row === row.key
            ? { kind: 'new', subplot: supply.subplot, color: supply.color }
            : { kind: 'sharesNew', subplot: supply.subplot, color: supply.color });
    }
    return plans;
}

/** A subplot lane identifies a particular appearance of a scene without changing its note. */
export function cardSubplots(card: Box, groups: Group[], memberships: string[]): string[] {
    const lane = groups.find(group => group.label && memberships.includes(group.label) &&
        [group.x, group.y, group.width, group.height, card.x, card.y, card.width, card.height].every(n => typeof n === 'number' && Number.isFinite(n)) &&
        card.x! + card.width! / 2 >= group.x! && card.x! + card.width! / 2 <= group.x! + group.width! &&
        card.y! + card.height! / 2 >= group.y! && card.y! + card.height! / 2 <= group.y! + group.height!)?.label;
    return lane ? [lane] : memberships;
}
