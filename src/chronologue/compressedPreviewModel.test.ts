import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { parseWhenField } from '../utils/date';
import { previewCompressedScale, previewSceneRanges } from './compressedPreviewModel';

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
});
