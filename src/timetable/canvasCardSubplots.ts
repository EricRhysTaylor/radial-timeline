import { cssColorToHex } from '../utils/colour';
import { normalizeOwnSubplotColor } from '../utils/ownSubplotColors';

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

/** What one card color does to the book's subplots when its cards become scenes. */
export type CardColorSubplot =
    /** No name: the cards join the main plot, which keeps its color. */
    | { kind: 'mainPlot' }
    /** A subplot the book already has: it keeps the color it wears. */
    | { kind: 'existing'; subplot: string }
    /** A new subplot: its ring wears this card color. */
    | { kind: 'new'; subplot: string }
    /** A new subplot an earlier card color already names: its ring wears that earlier color. */
    | { kind: 'sharesNew'; subplot: string; color: string };

/**
 * Which subplot each card color's cards join, and whose color that subplot
 * wears, so a color is chosen once. Rows come in the dialog's order. A name
 * the book already has (`existing` returns the book's spelling) keeps that
 * subplot's color; a new name takes the first card color that names it, in
 * the spelling that color gave it.
 */
export function planCardColorSubplots(
    rows: ReadonlyArray<{ color: string; name: string }>,
    existing: (name: string) => string | null,
): Map<string, CardColorSubplot> {
    const plans = new Map<string, CardColorSubplot>();
    const created = new Map<string, { subplot: string; color: string }>();
    for (const { color, name } of rows) {
        const typed = name.trim();
        if (!typed) { plans.set(color, { kind: 'mainPlot' }); continue; }
        const known = existing(typed);
        if (known !== null) { plans.set(color, { kind: 'existing', subplot: known }); continue; }
        const first = created.get(typed.toLowerCase());
        if (first) { plans.set(color, { kind: 'sharesNew', subplot: first.subplot, color: first.color }); continue; }
        created.set(typed.toLowerCase(), { subplot: typed, color });
        plans.set(color, { kind: 'new', subplot: typed });
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
