import { describe, expect, it } from 'vitest';
import { actsFromActCards, canvasReadingOrder, planCanvasSketchAppend, spreadAcrossActs } from './canvasSketchOrdering';
import type { PlacementItem, SketchPlacement } from './sketchPlacement';
import type { TimetableRow } from './timetableModel';

function item(name: string, kind: TimetableRow['kind'], act: number | null, frontmatter: Record<string, unknown>, placement?: SketchPlacement): PlacementItem {
    return { row: { path: `${name}.md`, basename: name, kind, act, prefix: null, className: null, subplots: [], removedScene: false }, frontmatter, placement };
}

describe('Scenes shared across acts', () => {
    it('keeps the order and gives earlier acts any cards left over', () => {
        expect([...spreadAcrossActs(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3)]).toEqual([['a', 1], ['b', 1], ['c', 1], ['d', 2], ['e', 2], ['f', 3], ['g', 3]]);
    });
    it('copes with fewer cards than acts', () => {
        expect([...spreadAcrossActs(['a'], 3)]).toEqual([['a', 1]]);
    });
});

describe('Act cards', () => {
    const card = (id: string, x: number, y: number) => ({ id, type: 'text', text: id, x, y });
    const act = (text: string, x: number, y: number) => ({ id: text, type: 'text', text, x, y, width: 300, height: 100 });

    it('puts each card in the last Act card above it', () => {
        const acts = actsFromActCards([card('a', 0, 100), card('b', 300, 150), card('c', 0, 400)], [act('Act 1', 0, 0), act('Act 2', 0, 300)]);
        expect([...acts]).toEqual([['a', 1], ['b', 1], ['c', 2]]);
    });
    it('reads Act cards along the top left to right', () => {
        const acts = actsFromActCards([card('a', 100, 300), card('b', 900, 300), card('c', 1900, 100)], [act('Act 1', 0, 0), act('Act 2', 800, 0), act('Act 3', 1800, 0)]);
        expect([...acts]).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    });
    it('starts a card ahead of every Act card in Act 1', () => {
        expect(actsFromActCards([card('a', 0, 0)], [act('Act 2', 0, 300)]).get('a')).toBe(1);
    });
    it('reads a titled or heading Act card, and passes over No act', () => {
        const acts = actsFromActCards([card('a', 0, 100), card('b', 0, 300)], [act('# Act 2 · The chase', 0, 0), act('No act', 0, 200)]);
        expect([...acts]).toEqual([['a', 2], ['b', 2]]);
    });
});

describe('Canvas sketch ordering', () => {
    it('suggests top-to-bottom, left-to-right order and keeps cards without coordinates stable', () => {
        const cards = [{ id: 'c', type: 'text', x: 0, y: 30 }, { id: 'b', type: 'text', x: 20, y: 0 },
            { id: 'a', type: 'text', x: 0, y: 0 }, { id: 'd', type: 'text' }];
        expect(canvasReadingOrder(cards).map(card => card.id)).toEqual(['a', 'b', 'c', 'd']);
    });
    it('appends after ranked and unranked sketches without changing their sequence', () => {
        const items = [item('Scene', 'scene', 1, { ID: 'scene' }),
            item('Ranked', 'sketch', 1, {}, { after: 'scene', order: 20 }),
            item('Unranked', 'sketch', 1, {}, { after: 'scene' }),
            item('Elsewhere', 'sketch', 2, {})];
        expect(planCanvasSketchAppend(items, 1, 'scene', 2)).toEqual({ missing: [{ path: 'Unranked.md', rank: 30 }], ranks: [40, 50] });
    });
    it('appends after unplaced sketches in the chosen act, including an orphan', () => {
        const items = [item('Lost', 'sketch', 2, {}, { after: 'missing' }), item('Draft', 'sketch', 2, {}), item('Other', 'sketch', 1, {})];
        const plan = planCanvasSketchAppend(items, 2, null, 2);
        expect(plan.missing.map(entry => entry.path)).toEqual(['Draft.md', 'Lost.md']);
        expect(plan.ranks).toEqual([30, 40]);
    });
});
