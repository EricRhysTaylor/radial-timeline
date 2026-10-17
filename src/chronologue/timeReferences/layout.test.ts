import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeChronologueLayout, computePositions } from '../../renderer/utils/SceneLayout';
import { primaryReferenceDomain, referenceConnector, referenceRingGeometry } from './layout';

const start = -Math.PI / 2, end = 3 * Math.PI / 2;
function scene(path: string, when: string, dates: string[] = []): TimelineItem {
    return { path, date: when, when: when ? new Date(`${when}T12:00:00`) : undefined, whenHasClock: false,
        rawFrontmatter: { When: when, 'Time References': dates.map((date, index) => ({ Label: `Memory ${index}`, When: date, Kind: 'recollection' })) } };
}
const week = (dates: string[]) => [scene('first.md', '2026-06-01'), scene('source.md', '2026-06-04', dates), scene('last.md', '2026-06-07')];
const layout = (items: TimelineItem[]) => computeChronologueLayout(700, 760, start, end, items);
describe('Chronologue reference overlays', () => {
    it.each([[], ['1952', '2040'], ['2026-06-03', '2026-06-04']].map(dates => [dates]))('preserves primary positions exactly for %j', dates => {
        const items = week(dates);
        expect(layout(items).positions).toEqual(computePositions(700, 760, start, end, items));
    });
    it('routes wholly off-range dates to opposite sides of the seam without changing the domain', () => {
        const items = week(['1952', '2040']), result = layout(items);
        expect(result.slots.map(s => s.extent)).toEqual(['earlier', 'later']);
        expect(result.slots[0].angle).toBeLessThan(start);
        expect(result.slots[1].angle).toBeGreaterThan(end);
        expect(primaryReferenceDomain(items)).toEqual(primaryReferenceDomain(week([])));
        for (const slot of result.slots) {
            const route = referenceConnector(700, 760, result.positions.get(1)!, slot, 709);
            const source = result.positions.get(1)!;
            const originAngle = source.startAngle + source.angularSize / 2 + Math.min(32 / 740.8, source.angularSize / 4);
            expect(route.origin.x).toBeCloseTo(708.8 * Math.cos(originAngle));
            expect(route.origin.y).toBeCloseTo(708.8 * Math.sin(originAngle));
            expect(route.path.match(/M /g)).toHaveLength(2);
            expect(route.discontinuity).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(-740.8) });
            expect(route.path).toContain('A 740.8 740.8');
            expect(route.path).not.toMatch(/NaN|Infinity/);
        }
    });
    it('keeps an in-range date within the primary geometry, with no seam break', () => {
        const result = layout(week(['2026-06-04'])), slot = result.slots[0];
        expect(slot.extent).toBe('within');
        expect(slot.angle).toBeCloseTo(result.positions.get(1)!.endAngle - 18 / 740.8);
        expect(referenceConnector(700, 760, result.positions.get(1)!, slot, 709).discontinuity).toBeUndefined();
    });
    it('does not invent January 1 precision for a year overlapping the manuscript week', () => {
        const result = layout(week(['2026']));
        expect(result.slots[0]).toMatchObject({ extent: 'within', clipped: true });
        expect(result.slots[0].references[0].when.text).toBe('2026');
    });
    it('uses the manuscript domain even when a Fill subplot has only one primary date', () => {
        const items = [scene('source.md', '2026-06-04', ['2026-06-01'])];
        expect(computeChronologueLayout(400, 460, start, end, items, primaryReferenceDomain(week([]))).slots[0].extent).toBe('within');
    });
    it('retains every dense declaration in bounded clusters with unchanged scene area', () => {
        const items = week(Array.from({ length: 500 }, (_, i) => String(1500 + i)));
        const result = computeChronologueLayout(70, 76, start, end, items);
        expect(result.slots.flatMap(slot => slot.references)).toHaveLength(500);
        expect(result.slots.length).toBeLessThan(10);
        expect(result.positions).toEqual(computePositions(70, 76, start, end, items));
    });
    it('labels an undated manuscript explicitly, without inventing an earlier or later relation', () => {
        expect(layout([scene('source.md', '', ['1952'])]).slots[0].extent).toBe('unanchored');
    });
    it('does not assign a made-up angle to an undated Fill ring within a dated manuscript', () => {
        const items = [scene('source.md', '', ['2026-06-04'])];
        const result = computeChronologueLayout(700, 760, start, end, items, primaryReferenceDomain(week([])));
        expect(result.slots[0].extent).toBe('unanchored');
        expect(result.slots[0].angle).toBeCloseTo(result.positions.get(0)!.endAngle - 18 / 740.8);
    });
    it('uses the same seam angle across ring radii while keeping terminals at the inner edge', () => {
        const offsets: number[] = [], horizontalOffsets: number[] = [];
        for (const [inner, outer] of [[400, 460], [500, 650], [700, 900]]) {
            const geometry = referenceRingGeometry(inner, outer);
            expect(outer - geometry.track).toBeGreaterThanOrEqual((outer - inner) * .30);
            expect(geometry.base - geometry.size / 2).toBe(inner + 4);
            const result = computeChronologueLayout(inner, outer, start, end, week(['1952', '2040']));
            offsets.push(start - result.slots[0].angle, result.slots[1].angle - end);
            horizontalOffsets.push(Math.abs(geometry.base * Math.cos(result.slots[0].angle)));
        }
        offsets.forEach(offset => expect(offset).toBeCloseTo(Math.PI / 45));
        expect(horizontalOffsets[0]).toBeLessThan(horizontalOffsets[1]);
        expect(horizontalOffsets[1]).toBeLessThan(horizontalOffsets[2]);
    });
    it('ignores non-scene dates and duplicate subplot declarations', () => {
        const source = scene('source.md', '2026-06-04', ['1952']);
        const items = [source, { ...source, subplot: 'History' }, { ...scene('beat.md', '1900'), itemType: 'Beat' }];
        expect(layout(items).slots.flatMap(s => s.references)).toHaveLength(1);
        expect(primaryReferenceDomain(items)).toEqual(primaryReferenceDomain([source]));
    });
});
