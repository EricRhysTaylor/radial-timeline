/** Interpolate between card centers as the story navigator moves. */
export function storyPosition(
    cards: Array<{ x?: number; y?: number; width?: number; height?: number }>,
    position: number,
): { x: number; y: number; index: number } | null {
    if (!cards.length || !Number.isFinite(position)) return null;
    const value = Math.max(0, Math.min(cards.length - 1, position));
    const start = Math.floor(value), end = Math.ceil(value), fraction = value - start;
    const center = (card: typeof cards[number]) => {
        const { x, y, width, height } = card;
        return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
            && typeof width === 'number' && Number.isFinite(width) && typeof height === 'number' && Number.isFinite(height)
            ? { x: x + width / 2, y: y + height / 2 } : null;
    };
    const a = center(cards[start]), b = center(cards[end]);
    if (!a || !b) return null;
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, index: Math.round(value) };
}
