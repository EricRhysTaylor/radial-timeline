import { describe, expect, it } from 'vitest';
import { planSubplotCanvas } from './subplotCanvas';
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
    it.each([25, 100, 200])('keeps %i scene cards in non-overlapping bounded strips', count => {
        const rows = Array.from({ length: count }, (_, i) => scene(i + 1, Math.floor(i / 40) + 1, ['Main', ...(i % 3 === 0 ? ['Mara'] : [])]));
        const plan = makePlan(rows);
        expect(plan.sceneCount).toBe(count);
        expect(plan.appearanceCount).toBe(count + Math.ceil(count / 3));
        const cards = plan.nodes.filter(node => node.type === 'file');
        const groups = plan.nodes.filter(node => node.type === 'group');
        for (let i = 1; i < groups.length; i++) {
            expect(groups[i].y - (groups[i - 1].y + groups[i - 1].height)).toBeGreaterThanOrEqual(50);
        }
        expect(Math.max(...cards.map(card => card.x + card.width))).toBeLessThan(3000);
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i], b = cards[j];
            expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
        }
    });
});
