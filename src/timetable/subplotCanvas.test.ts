import { describe, expect, it } from 'vitest';
import { planSubplotCanvas, storyRangeBounds, storyRangeRows } from './subplotCanvas';
import type { TimetableRow } from './timetableModel';

function scene(n: number, act: number, subplots: string[]): TimetableRow {
    return { path: `Book/${n} Scene.md`, basename: `${n} Scene`, kind: 'scene', className: null, prefix: String(n), act, subplots, removedScene: false };
}
function makePlan(rows: TimetableRow[], act: number | null = null, subplot: string | null = null) {
    let next = 0;
    return planSubplotCanvas(rows, { act, subplot }, () => `node${++next}`);
}

describe('subplot Canvas layout', () => {
    it('aligns shared scenes and connects each lane in narrative order', () => {
        const result = makePlan([scene(3, 1, ['Main', 'Mara']), scene(1, 1, ['Main', 'Mara']), scene(2, 1, ['Main'])]);
        expect(result.sceneCount).toBe(3);
        expect(result.appearanceCount).toBe(5);
        const appearances = result.nodes.filter(node => node.file === 'Book/3 Scene.md');
        expect(appearances).toHaveLength(2);
        expect(appearances[0].x).toBe(appearances[1].x);
        const cards = result.nodes.filter(node => node.type === 'file');
        const byId = new Map(cards.map(card => [card.id, card]));
        for (const edge of result.edges) {
            const from = byId.get(edge.fromNode)!;
            const to = byId.get(edge.toNode)!;
            expect(from.y).toBe(to.y);
            expect(from.x).toBeLessThan(to.x);
        }
    });
    it('connects a subplot across act boundaries', () => {
        const plan = makePlan([scene(1, 1, ['Main']), scene(2, 2, ['Main']), scene(3, 3, ['Main'])]);
        expect(plan.edges).toHaveLength(2);
        expect(plan.nodes.filter(node => node.type === 'text').map(node => node.text)).toEqual(['**Act 1**', '**Act 2**', '**Act 3**']);
    });
    it('limits scope to selected act and subplot', () => {
        const result = makePlan([scene(1, 1, ['Main']), scene(2, 1, ['Mara']), scene(3, 2, ['Mara'])], 1, 'Mara');
        expect(result.sceneCount).toBe(1);
        expect(result.nodes.filter(node => node.type === 'file').map(node => node.file)).toEqual(['Book/2 Scene.md']);
    });
    it('includes scenes without a subplot in an unassigned lane', () => {
        const plan = makePlan([scene(1, 1, []), scene(2, 1, ['Main'])]);
        expect(plan.appearanceCount).toBe(2);
        expect(plan.nodes.some(node => node.type === 'group' && node.label === 'No subplot')).toBe(true);
        expect(plan.nodes.some(node => node.file === 'Book/1 Scene.md')).toBe(true);
    });
    it('divides a story into ordered, non-overlapping thirds before filtering subplots', () => {
        const rows = Array.from({ length: 10 }, (_, i) => scene(i + 1, 1, i % 2 ? ['Mara'] : ['Main'])).reverse();
        const ranges = (['beginning', 'middle', 'end'] as const).map(range => storyRangeRows(rows, null, range));
        expect(ranges.map(part => part.length)).toEqual([4, 3, 3]);
        expect(ranges.flat().map(row => row.prefix)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
        const plan = planSubplotCanvas(rows, { act: null, subplot: 'Mara', range: 'middle' }, () => 'id');
        expect(plan.nodes.filter(node => node.type === 'file').map(node => node.file)).toEqual(['Book/6 Scene.md']);
    });
    it('applies the selected act before dividing the range', () => {
        const rows = [scene(1, 1, ['Main']), scene(2, 1, ['Main']), scene(3, 2, ['Main']), scene(4, 2, ['Main']), scene(5, 2, ['Main'])];
        expect(storyRangeRows(rows, 2, 'beginning').map(row => row.prefix)).toEqual(['3']);
        expect(storyRangeRows(rows.slice(0, 1), null, 'beginning')).toHaveLength(1);
    });
    it('keeps the entire map while calculating a focus for a selected third', () => {
        const rows = Array.from({ length: 12 }, (_, i) => scene(i + 1, 1, ['Main']));
        const plan = makePlan(rows);
        const bounds = storyRangeBounds(plan.nodes, rows, 1, null, 'middle')!;
        const cards = plan.nodes.filter(node => node.type === 'file');
        expect(cards).toHaveLength(12);
        const focused = cards.filter(node => node.x >= bounds.minX && node.x + node.width <= bounds.maxX && node.y >= bounds.minY && node.y + node.height <= bounds.maxY);
        expect(focused.map(node => node.file)).toEqual(rows.slice(4, 8).map(row => row.path));
        expect(storyRangeBounds(plan.nodes, rows, 1, null, 'all')).toBeNull();
    });
    it.each([25, 100, 200])('keeps %i scene cards in continuous non-overlapping lanes', count => {
        const rows = Array.from({ length: count }, (_, i) => scene(i + 1, Math.floor(i / 40) + 1, ['Main', ...(i % 3 === 0 ? ['Mara'] : [])]));
        const plan = makePlan(rows);
        expect(plan.sceneCount).toBe(count);
        expect(plan.appearanceCount).toBe(count + Math.ceil(count / 3));
        const cards = plan.nodes.filter(node => node.type === 'file');
        const groups = plan.nodes.filter(node => node.type === 'group');
        for (let i = 1; i < groups.length; i++) {
            expect(groups[i].y - (groups[i - 1].y + groups[i - 1].height)).toBeGreaterThanOrEqual(50);
        }
        expect(Math.max(...cards.map(card => card.x + card.width))).toBeGreaterThan(3000);
        expect(plan.edges).toHaveLength(plan.appearanceCount - groups.length);
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i], b = cards[j];
            expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
        }
    });
});
