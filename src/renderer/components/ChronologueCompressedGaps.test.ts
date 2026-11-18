import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { renderChronologicalBackboneArc } from './ChronologueTimeline';

const scene = (path: string, date: string): TimelineItem => ({
    path, title: path, date, itemType: 'Scene', when: new Date(date),
});
const scenes = [scene('a.md', '2000-01-01'), scene('b.md', '2001-01-01'), scene('c.md', '2002-01-01')];
const positions = new Map(scenes.map((item, i) => [item.path!, { startAngle: i, endAngle: i + 0.4 }]));

describe('compressed gap markers', () => {
    it('uses one infinity symbol for a compressed gap already detected by the ordinary threshold', () => {
        const markup = renderChronologicalBackboneArc(scenes, 700, 760, 3, positions, undefined, 86400000,
            [{ startMs: scenes[0].when!.getTime(), endMs: scenes[1].when!.getTime(), angle: 0.5 }]);
        expect(markup.match(/rt-discontinuity-marker/g)).toHaveLength(2);
        expect(markup.match(/rt-compressed-gap-marker/g)).toHaveLength(1);
        expect(markup).not.toContain('stroke-dasharray');
        // Shift and compressed symbols share the same upright orientation.
        expect(markup).not.toContain('transform=');
    });
    it('centers the compressed marker in the scene after the gap, like Shift', () => {
        const markup = renderChronologicalBackboneArc(scenes, 700, 760, 3, positions, undefined, 86400000,
            [{ startMs: scenes[0].when!.getTime(), endMs: scenes[1].when!.getTime(), angle: 0.5, scenePath: 'b.md' }]);
        const tag = markup.match(/<text[^>]*rt-compressed-gap-marker[^>]*>/)?.[0] ?? '';
        const x = Number(tag.match(/x="([^"]+)"/)?.[1]);
        const y = Number(tag.match(/y="([^"]+)"/)?.[1]);
        expect(Math.atan2(y, x)).toBeCloseTo(1.2, 3);
        expect(Math.hypot(x, y)).toBeCloseTo(730, 1);
    });
    it('marks compressed gaps even when only two scenes have dates', () => {
        const markup = renderChronologicalBackboneArc(scenes.slice(0, 2), 700, 760, 3, positions, undefined, undefined,
            [{ startMs: scenes[0].when!.getTime(), endMs: scenes[1].when!.getTime(), angle: 0.5 }]);
        expect(markup.match(/rt-compressed-gap-marker/g)).toHaveLength(1);
        expect(markup).toContain('∞');
    });
});
