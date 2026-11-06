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
 * The subplot a color already stands for. Linked cards of that color on this
 * Canvas decide first, when they share exactly one subplot; after that, a ring
 * painted in exactly that color. Anything less certain stays unassigned.
 */
export function subplotForColor(
    color: string,
    linked: Array<{ color: string; subplots: string[] }>,
    rings: Array<{ name: string; color: string }>,
): string | null {
    const memberships = linked.filter(card => card.color === color).map(card => card.subplots);
    const shared = memberships[0]?.filter(name => memberships.every(subplots => subplots.includes(name))) ?? []; // SAFE: no linked card of this color means nothing shared
    if (shared.length === 1) return shared[0];
    return rings.find(ring => ring.color === color)?.name ?? null;
}

/** A subplot lane identifies a particular appearance of a scene without changing its note. */
export function cardSubplots(card: Box, groups: Group[], memberships: string[]): string[] {
    const lane = groups.find(group => group.label && memberships.includes(group.label) &&
        [group.x, group.y, group.width, group.height, card.x, card.y, card.width, card.height].every(n => typeof n === 'number' && Number.isFinite(n)) &&
        card.x! + card.width! / 2 >= group.x! && card.x! + card.width! / 2 <= group.x! + group.width! &&
        card.y! + card.height! / 2 >= group.y! && card.y! + card.height! / 2 <= group.y! + group.height!)?.label;
    return lane ? [lane] : memberships;
}
