/** Extract the act heading created by both generations of story maps. */
export function storyActHeadingLabel(text: string): string | null {
    const first = text.split('\n')[0].trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*|\*\*$/g, '').trim();
    return /^(?:act\s+\d+|no act)(?:\s*[·–-]\s*[^\n]+)?$/i.test(first) ? first : null;
}

export function isStoryActHeading(text: string): boolean { return storyActHeadingLabel(text) !== null; }

/** Center the nearest appearance of a scene while preserving the Canvas zoom. */
export function linkedSceneViewport(
    cards: Array<{ x?: number; y?: number; width?: number; height?: number }>,
    viewport: { x: number; y: number; zoom: number },
): { x: number; y: number; zoom: number } | null {
    if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite)) return null;
    const centers = cards.flatMap(card => {
        const point = storyPosition([card], 0);
        return point ? [point] : [];
    });
    centers.sort((a, b) => Math.hypot(a.x - viewport.x, a.y - viewport.y) - Math.hypot(b.x - viewport.x, b.y - viewport.y));
    return centers.length ? { x: centers[0].x, y: centers[0].y, zoom: viewport.zoom } : null;
}

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

/** Traverse the map's longest axis while retaining the other viewport coordinate. */
export function storyAxis(cards: Array<{ x?: number; y?: number; width?: number; height?: number }>): { axis: 'x' | 'y'; min: number; max: number } | null {
    const points = cards.flatMap(({ x, y, width, height }) =>
        [x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))
            ? [{ x: x! + width! / 2, y: y! + height! / 2 }] : []);
    if (!points.length) return null;
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return maxX - minX >= maxY - minY ? { axis: 'x', min: minX, max: maxX } : { axis: 'y', min: minY, max: maxY };
}

/** Find the continuous story position nearest the viewport on the map's long axis. */
export function storyProgress(cards: Array<{ x?: number; y?: number; width?: number; height?: number }>, axis: 'x' | 'y', coordinate: number): number | null {
    if (!cards.length || !Number.isFinite(coordinate)) return null;
    let bestPosition: number | null = null, bestDistance = Infinity;
    for (let index = 0; index < cards.length; index++) {
        const a = storyPosition(cards, index), b = storyPosition(cards, Math.min(index + 1, cards.length - 1));
        if (!a || !b) continue;
        const start = a[axis], delta = b[axis] - start;
        const fraction = delta === 0 ? 0 : Math.max(0, Math.min(1, (coordinate - start) / delta));
        const distance = Math.abs(coordinate - (start + delta * fraction));
        if (distance < bestDistance) { bestDistance = distance; bestPosition = index + fraction; }
    }
    return bestPosition;
}
