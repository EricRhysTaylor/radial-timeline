import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { compressedRingLayout } from './compressedRingLayout';

const scene = (path: string, when?: string): TimelineItem => ({
    path, title: path, date: '', itemType: 'Scene',
    when: when ? new Date(`${when}T12:00:00`) : undefined,
    whenHasClock: true, rawFrontmatter: when ? { When: `${when} 12:00` } : {},
});

describe('compressed interactive ring geometry', () => {
    it('retains all scenes, including equal dates and undated scenes', () => {
        const items = [scene('a', '2000-01-01'), scene('b', '2000-01-01'), scene('c', '2100-01-01'), scene('d')];
        const layout = compressedRingLayout(items, -Math.PI / 2, 3 * Math.PI / 2)!;
        expect(layout.positions.size).toBe(4);
        expect(layout.undatedCount).toBe(1);
        const p = items.map((_, i) => layout.positions.get(i)!);
        p.forEach(position => expect(position.angularSize).toBeGreaterThan(0));
        expect(p[0].endAngle).toBeCloseTo(p[1].startAngle);
        expect(p[2].endAngle).toBeCloseTo(p[3].startAngle);
        expect(p[3].endAngle).toBeCloseTo(3 * Math.PI / 2);
        expect(layout.scale.segments.some(segment => segment.compressed)).toBe(true);
        expect(Math.min(...p.slice(0, 3).map(position => position.angularSize))).toBeGreaterThan(0.02);
        const startTime = layout.scale.segments[0].startMs;
        const endTime = layout.scale.segments.at(-1)!.endMs;
        expect(layout.angleAt(startTime)).toBeGreaterThanOrEqual(p[0].startAngle);
        expect(layout.angleAt(startTime)).toBeLessThanOrEqual(p[1].endAngle);
        expect(layout.angleAt(endTime)).toBeLessThanOrEqual(layout.datedEnd);
        expect(layout.angleAt(startTime)).toBeLessThan(layout.angleAt(endTime));
    });
    it('falls back when there is no usable temporal span', () => {
        expect(compressedRingLayout([scene('a'), scene('b')], -1, 1)).toBeNull();
        expect(compressedRingLayout([scene('a', '2000-01-01'), scene('b', '2000-01-01')], -1, 1)).toBeNull();
    });
});
