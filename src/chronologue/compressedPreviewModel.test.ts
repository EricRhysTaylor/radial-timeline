import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { parseWhenField } from '../utils/date';
import { previewCompressedScale, previewSceneRanges, previewSceneSectors } from './compressedPreviewModel';

const scene = (path: string, raw: string, whenHasClock = false): TimelineItem => ({
    date: '', path, title: path, itemType: 'Scene', when: parseWhenField(raw) ?? undefined, whenHasClock, rawFrontmatter: { When: raw },
});

describe('compressed time preview', () => {
    it('uses full date precision, deduplicates subplot copies and reports undated scenes', () => {
        const day = scene('day.md', '2085-03-15');
        const exact = scene('exact.md', '2086-03-15 14:20', true);
        const missing: TimelineItem = { date: '', path: 'missing.md', itemType: 'Scene' };
        const { ranges, titles, excluded } = previewSceneRanges([day, { ...day, subplot: 'Second plot' }, exact, missing]);
        expect(ranges).toHaveLength(2);
        expect(ranges[0].endMs - ranges[0].startMs).toBeGreaterThan(20 * 3600000);
        expect(ranges[1].startMs).toBe(ranges[1].endMs);
        expect(titles.get('day.md')).toContain('2085-03-15');
        expect(excluded).toBe(1);
        expect(previewCompressedScale(ranges)?.segments.some(segment => segment.compressed)).toBe(true);
    });

    it('keeps a year-only date as an uncertainty interval', () => {
        const { ranges } = previewSceneRanges([scene('year.md', '1985')]);
        expect(ranges[0].endMs - ranges[0].startMs).toBeGreaterThan(364 * 86400000);
    });

    it('preserves BCE year and month precision without inventing a day', () => {
        const { ranges } = previewSceneRanges([scene('year.md', '44 BCE'), scene('month.md', '0044-03 BCE')]);
        expect(ranges).toHaveLength(2);
        expect(ranges[0].endMs - ranges[0].startMs).toBeGreaterThan(364 * 86400000);
        expect(ranges[1].endMs - ranges[1].startMs).toBeGreaterThan(27 * 86400000);
    });
    it('allocates contiguous scene wedges and groups simultaneous scenes', () => {
        const scale = previewCompressedScale([
            { id: 'first', startMs: 0, endMs: 0 },
            { id: 'same', startMs: 0, endMs: 0 },
            { id: 'middle', startMs: 1000, endMs: 1000 },
            { id: 'last', startMs: 10000000000, endMs: 10000000000 },
        ])!;
        const sectors = previewSceneSectors(scale);
        expect(sectors).toHaveLength(3);
        expect(sectors[0].ranges.map(range => range.id)).toEqual(['first', 'same']);
        expect(sectors[0].startAngle).toBe(scale.segments[0].startAngle);
        expect(sectors[2].endAngle).toBe(scale.segments.at(-1)!.endAngle);
        for (let i = 0; i < sectors.length; i++) {
            expect(sectors[i].startAngle).toBeLessThan(sectors[i].endAngle);
            expect(sectors[i].angle).toBeGreaterThanOrEqual(sectors[i].startAngle);
            expect(sectors[i].angle).toBeLessThanOrEqual(sectors[i].endAngle + 1e-10);
            if (i) expect(sectors[i - 1].endAngle).toBe(sectors[i].startAngle);
        }
    });

});
