export interface SplitChunkRange {
    part: number;
    start: number;
    end: number;
    size: number;
}

export interface SplitChunkResult<T> {
    chunks: T[][];
    ranges: SplitChunkRange[];
}

export function chunkScenesIntoParts<T>(items: T[], parts: number): SplitChunkResult<T> {
    const normalizedParts = Number.isFinite(parts) ? Math.max(1, Math.floor(parts)) : 1;
    const total = items.length;
    const base = Math.floor(total / normalizedParts);
    const remainder = total % normalizedParts;
    let cursor = 0;

    const chunks: T[][] = [];
    const ranges: SplitChunkRange[] = [];

    for (let i = 0; i < normalizedParts; i += 1) {
        const size = base + (i < remainder ? 1 : 0);
        const nextCursor = cursor + size;
        const chunk = items.slice(cursor, nextCursor);
        chunks.push(chunk);
        ranges.push({
            part: i + 1,
            start: size > 0 ? cursor + 1 : 0,
            end: size > 0 ? nextCursor : 0,
            size
        });
        cursor = nextCursor;
    }

    return { chunks, ranges };
}
