import type { TimelineItem } from '../types';
import type { PositionInfo } from '../renderer/utils/SceneLayout';
import { previewSceneRanges, PREVIEW_GAP_THRESHOLD_MS, PREVIEW_GAP_WEIGHT_MS } from './compressedPreviewModel';
import { buildCompressedTimeScale } from './compressedTimeScale';

/** Geometry for the interactive ring. Undated items retain a separate, clearly non-temporal sector. */
export function compressedRingLayout(items: TimelineItem[], startAngle: number, endAngle: number) {
    const { ranges } = previewSceneRanges(items);
    const ids = new Set(ranges.map(range => range.id));
    const undated = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.path || !ids.has(item.path));
    // Reserve room for undated items; this portion has no temporal meaning.
    const fullSpan = endAngle - startAngle;
    const undatedSpan = undated.length ? fullSpan * Math.min(0.35, Math.max(0.08, undated.length / items.length)) : 0;
    const datedEnd = endAngle - undatedSpan;
    const scale = buildCompressedTimeScale(ranges, {
        startAngle, endAngle: datedEnd - 1e-6,
        gapThresholdMs: PREVIEW_GAP_THRESHOLD_MS, compressedGapMs: PREVIEW_GAP_WEIGHT_MS,
    });
    if (!scale) return null;
    const positions = new Map<number, PositionInfo>();
    const sorted = scale.ranges.map(range => ({ range, angle: (range.startAngle + range.endAngle) / 2 }))
        .sort((a, b) => a.angle - b.angle);
    const clusters: Array<{ angle: number; ids: string[] }> = [];
    for (const entry of sorted) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(last.angle - entry.angle) < 1e-10) last.ids.push(entry.range.id);
        else clusters.push({ angle: entry.angle, ids: [entry.range.id] });
    }
    // Keep each scene large enough to target. Distribute the remaining space
    // proportionally, then apply the same monotonic mapping to time overlays.
    const boundaries = [startAngle, ...clusters.slice(1).map((c, i) => (clusters[i].angle + c.angle) / 2), datedEnd];
    const base = clusters.map((cluster, i) => ({
        width: boundaries[i + 1] - boundaries[i],
        minimum: Math.min(fullSpan * 0.3 / Math.max(1, ranges.length), 0.025) * cluster.ids.length,
    }));
    const remaining = datedEnd - startAngle - base.reduce((sum, item) => sum + item.minimum, 0);
    const totalWeight = base.reduce((sum, item) => sum + item.width, 0);
    const mapped = [startAngle];
    base.forEach(item => mapped.push(mapped[mapped.length - 1] + item.minimum + remaining * item.width / totalWeight));
    mapped[mapped.length - 1] = datedEnd;
    const mapAngle = (angle: number) => {
        const i = Math.max(0, Math.min(base.length - 1, boundaries.findIndex((edge, index) => index > 0 && angle <= edge) - 1));
        const span = boundaries[i + 1] - boundaries[i];
        return mapped[i] + (mapped[i + 1] - mapped[i]) * (span ? (angle - boundaries[i]) / span : 0);
    };
    const angleAt = (time: number) => {
        const segments = scale.segments;
        const clamped = Math.min(segments[segments.length - 1].endMs, Math.max(segments[0].startMs, time));
        return mapAngle(scale.angleAt(clamped) ?? startAngle);
    };
    clusters.forEach((cluster, i) => {
        const first = mapped[i];
        const last = mapped[i + 1];
        cluster.ids.forEach((id, n) => {
            const index = items.findIndex(item => item.path === id);
            if (index < 0) return;
            const a = first + (last - first) * n / cluster.ids.length;
            const b = first + (last - first) * (n + 1) / cluster.ids.length;
            positions.set(index, { startAngle: a, endAngle: b, angularSize: b - a });
        });
    });
    undated.forEach(({ index }, n) => {
        const a = datedEnd + undatedSpan * n / undated.length;
        const b = datedEnd + undatedSpan * (n + 1) / undated.length;
        positions.set(index, { startAngle: a, endAngle: b, angularSize: b - a });
    });
    return { positions, scale, angleAt, mapAngle, datedEnd, undatedCount: undated.length };
}
