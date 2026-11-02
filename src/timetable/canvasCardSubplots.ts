type Box = { x?: number; y?: number; width?: number; height?: number };
type Group = Box & { label?: string };

/** A subplot lane identifies a particular appearance of a scene without changing its note. */
export function cardSubplots(card: Box, groups: Group[], memberships: string[]): string[] {
    const lane = groups.find(group => group.label && memberships.includes(group.label) &&
        [group.x, group.y, group.width, group.height, card.x, card.y, card.width, card.height].every(n => typeof n === 'number' && Number.isFinite(n)) &&
        card.x! + card.width! / 2 >= group.x! && card.x! + card.width! / 2 <= group.x! + group.width! &&
        card.y! + card.height! / 2 >= group.y! && card.y! + card.height! / 2 <= group.y! + group.height!)?.label;
    return lane ? [lane] : memberships;
}
