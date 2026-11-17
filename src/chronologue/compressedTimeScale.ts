/*
 * Experimental time scale for a future Chronologue outer ring.
 * This model does not change scene notes or the rendered timeline.
 */

export interface TimeRange {
    id: string;
    /** Earliest and latest possible time, inclusive; equal values are instants. */
    startMs: number;
    endMs: number;
}

export interface TimeScaleSegment {
    startMs: number;
    endMs: number;
    startAngle: number;
    endAngle: number;
    /** True only for a deliberately shortened, unoccupied interval. */
    compressed: boolean;
}

export interface CompressedTimeScale {
    segments: TimeScaleSegment[];
    /** Ranges keep their actual uncertainty; coincident events share an angle. */
    ranges: Array<TimeRange & { startAngle: number; endAngle: number }>;
    angleAt: (timeMs: number) => number | null;
}

/**
 * Compress only empty intervals longer than `gapThresholdMs`. Events remain
 * intervals or points; this function never invents a scene duration or spreads
 * simultaneous events. The caller provides an angular span shorter than one
 * revolution so the two ends cannot appear to be the same instant.
 * Returns null for invalid, empty or zero-duration input.
 */
export function buildCompressedTimeScale(
    ranges: TimeRange[],
    options: { startAngle: number; endAngle: number; gapThresholdMs: number; compressedGapMs: number }
): CompressedTimeScale | null {
    const { startAngle, endAngle, gapThresholdMs, compressedGapMs } = options;
    if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle) || endAngle <= startAngle || endAngle - startAngle >= 2 * Math.PI
        || !Number.isFinite(gapThresholdMs) || gapThresholdMs <= 0 || !Number.isFinite(compressedGapMs)
        || compressedGapMs <= 0 || compressedGapMs > gapThresholdMs || ranges.length === 0) return null;
    if (ranges.some(range => !range.id || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.endMs < range.startMs)) return null;
    if (new Set(ranges.map(range => range.id)).size !== ranges.length) return null;

    const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const occupied: Array<{ startMs: number; endMs: number }> = [];
    for (const range of sorted) {
        const last = occupied[occupied.length - 1];
        if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
        else occupied.push({ startMs: range.startMs, endMs: range.endMs });
    }
    const domainStart = occupied[0].startMs;
    const domainEnd = occupied[occupied.length - 1].endMs;
    if (domainStart === domainEnd) return null;

    const intervals: Array<{ startMs: number; endMs: number; weight: number; compressed: boolean }> = [];
    for (let i = 0; i < occupied.length; i++) {
        const current = occupied[i];
        if (current.endMs > current.startMs) intervals.push({ ...current, weight: current.endMs - current.startMs, compressed: false });
        const next = occupied[i + 1];
        if (!next) continue;
        const gap = next.startMs - current.endMs;
        intervals.push({ startMs: current.endMs, endMs: next.startMs, weight: gap > gapThresholdMs ? compressedGapMs : gap, compressed: gap > gapThresholdMs });
    }
    const total = intervals.reduce((sum, segment) => sum + segment.weight, 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    let angle = startAngle;
    const segments = intervals.map((segment, index): TimeScaleSegment => {
        const next = index === intervals.length - 1 ? endAngle : angle + (endAngle - startAngle) * segment.weight / total;
        const result = { startMs: segment.startMs, endMs: segment.endMs, startAngle: angle, endAngle: next, compressed: segment.compressed };
        angle = next;
        return result;
    });
    const angleAt = (timeMs: number): number | null => {
        if (!Number.isFinite(timeMs) || timeMs < domainStart || timeMs > domainEnd) return null;
        const segment = segments.find(item => timeMs >= item.startMs && timeMs <= item.endMs);
        return segment ? segment.startAngle + (segment.endAngle - segment.startAngle) * (timeMs - segment.startMs) / (segment.endMs - segment.startMs) : null;
    };
    return { segments, ranges: ranges.map(range => ({ ...range, startAngle: angleAt(range.startMs)!, endAngle: angleAt(range.endMs)! })), angleAt };
}
