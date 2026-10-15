import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeChronologueLayout, computePositions } from '../../renderer/utils/SceneLayout';
import { bottomRadiusConnector } from './layout';

function scene(path: string, when: string, count = 1): TimelineItem {
    return { path, date: when, when: new Date(when), rawFrontmatter: { 'Time References': Array.from({ length: count }, (_, index) => ({
        Label: `Memory ${index}`, When: String(1952 + index), Kind: 'recollection' })) } };
}
describe('Chronologue reference allocation', () => {
    it('preserves geometry exactly without references', () => {
        const items = [{ path: 'scene.md', date: '' }];
        expect(computeChronologueLayout(700, 760, 0, 2 * Math.PI, items).positions)
            .toEqual(computePositions(700, 760, 0, 2 * Math.PI, items));
    });
    it('inserts a narrow earlier reference before its present-day source', () => {
        const result = computeChronologueLayout(700, 760, 0, 2 * Math.PI, [scene('12.md', '2026-10-14')]);
        expect(result.slots).toHaveLength(1);
        expect(result.slots[0].startAngle).toBe(0);
        expect(result.positions.get(0)!.startAngle).toBe(result.slots[0].endAngle);
        expect(result.slots[0].angularSize * 730).toBeCloseTo(4);
        expect(result.positions.get(0)!.endAngle).toBeCloseTo(2 * Math.PI);
    });
    it('bounds dense allocations without losing references or scene area', () => {
        const result = computeChronologueLayout(70, 76, 0, 2 * Math.PI, [scene('12.md', '2026-10-14', 500)]);
        expect(result.slots.flatMap(slot => slot.references)).toHaveLength(500);
        expect(result.positions.get(0)!.angularSize).toBeGreaterThanOrEqual(2 * Math.PI * .75 - 1e-10);
        expect(result.slots.some(slot => slot.references.length > 1)).toBe(true);
    });
    it('keeps one declaration in each inherited ring without multiplying scenes', () => {
        const source = scene('12.md', '2026-10-14');
        for (const radius of [400, 500, 600]) {
            const result = computeChronologueLayout(radius, radius + 40, 0, 2 * Math.PI, [source]);
            expect(result.positions.size).toBe(1);
            expect(result.slots.flatMap(s => s.references).map(r => r.key))
                .toEqual(computeChronologueLayout(700, 740, 0, 2 * Math.PI, [source]).slots.flatMap(s => s.references).map(r => r.key));
        }
    });
    it('uses a single ring-radius arc including the long earlier route', () => {
        expect(bottomRadiusConnector(700, 4, 0)).toContain('A 700 700 0 1 0');
        expect(bottomRadiusConnector(700, 4, 5)).toContain('A 700 700 0 0 1');
        expect(bottomRadiusConnector(700, 4, 5)).not.toContain(' L ');
    });
});
