import type { TimelineItem } from '../types';
import { splitWhenEra } from '../utils/date';
import { whenTextNamesDay } from '../utils/whenFormat';
import { buildCompressedTimeScale, type TimeRange } from './compressedTimeScale';

/** The values are intentionally visible in the prototype, not product defaults. */
export const PREVIEW_GAP_THRESHOLD_MS = 90 * 86400000;
export const PREVIEW_GAP_WEIGHT_MS = 14 * 86400000;

export function previewSceneRanges(scenes: TimelineItem[]): { ranges: TimeRange[]; titles: Map<string, string>; excluded: number } {
    const unique = new Map<string, TimelineItem>();
    for (const scene of scenes) if (scene.itemType === 'Scene' && scene.path && !unique.has(scene.path)) unique.set(scene.path, scene);
    const ranges: TimeRange[] = [];
    const titles = new Map<string, string>();
    let excluded = 0;
    for (const [id, scene] of unique) {
        const date = scene.when;
        const raw = scene.rawFrontmatter?.When;
        if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || (typeof raw !== 'string' && typeof raw !== 'number')) { excluded++; continue; }
        const text = String(raw);
        const start = new Date(date.getTime());
        const end = new Date(date.getTime());
        if (!scene.whenHasClock) {
            start.setHours(0, 0, 0, 0);
            const yearOnly = /^\d{1,4}$/.test(splitWhenEra(text).body);
            const monthOnly = !yearOnly && !whenTextNamesDay(text);
            if (yearOnly) start.setMonth(0, 1);
            else if (monthOnly) start.setDate(1);
            end.setTime(start.getTime());
            if (yearOnly) end.setFullYear(end.getFullYear() + 1);
            else if (monthOnly) end.setMonth(end.getMonth() + 1);
            else end.setDate(end.getDate() + 1);
            end.setTime(end.getTime() - 1);
        }
        ranges.push({ id, startMs: start.getTime(), endMs: end.getTime() });
        titles.set(id, `${scene.title ?? id} · ${text}`);
    }
    return { ranges, titles, excluded };
}

export function previewCompressedScale(ranges: TimeRange[]) {
    return buildCompressedTimeScale(ranges, {
        startAngle: -Math.PI / 2 + 0.06, endAngle: 3 * Math.PI / 2 - 0.06,
        gapThresholdMs: PREVIEW_GAP_THRESHOLD_MS, compressedGapMs: PREVIEW_GAP_WEIGHT_MS,
    });
}

/** Allocate display space around dated positions without changing the time scale. */
export function previewSceneSectors(scale: NonNullable<ReturnType<typeof previewCompressedScale>>) {
    const positions = scale.ranges.map(range => ({ range, angle: (range.startAngle + range.endAngle) / 2 }))
        .sort((a, b) => a.angle - b.angle);
    const clusters: Array<{ angle: number; ranges: typeof scale.ranges }> = [];
    for (const position of positions) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(last.angle - position.angle) < 1e-10) last.ranges.push(position.range);
        else clusters.push({ angle: position.angle, ranges: [position.range] });
    }
    return clusters.map((cluster, index) => ({
        ...cluster,
        startAngle: index ? (clusters[index - 1].angle + cluster.angle) / 2 : scale.segments[0].startAngle,
        endAngle: index + 1 < clusters.length ? (cluster.angle + clusters[index + 1].angle) / 2 : scale.segments[scale.segments.length - 1].endAngle,
    }));
}
