import { describe, expect, it } from 'vitest';
import { canvasReadingOrder, planCanvasSketchAppend } from './canvasSketchOrdering';
import type { PlacementItem } from './sketchPlacement';
import type { TimetableRow } from './timetableModel';

function item(name: string, kind: TimetableRow['kind'], act: number | null, frontmatter: Record<string, unknown>): PlacementItem {
    return { row: { path: `${name}.md`, basename: name, kind, act, prefix: null, className: null, subplots: [], removedScene: false }, frontmatter };
}

describe('Canvas sketch ordering', () => {
    it('suggests top-to-bottom, left-to-right order and keeps cards without coordinates stable', () => {
        const cards = [{ id: 'c', type: 'text', x: 0, y: 30 }, { id: 'b', type: 'text', x: 20, y: 0 },
            { id: 'a', type: 'text', x: 0, y: 0 }, { id: 'd', type: 'text' }];
        expect(canvasReadingOrder(cards).map(card => card.id)).toEqual(['a', 'b', 'c', 'd']);
    });
    it('appends after ranked and unranked sketches without changing their sequence', () => {
        const items = [item('Scene', 'scene', 1, { ID: 'scene' }),
            item('Ranked', 'sketch', 1, { 'Place after scene': 'scene', 'Sketch order': 20 }),
            item('Unranked', 'sketch', 1, { 'Place after scene': 'scene' }),
            item('Elsewhere', 'sketch', 2, {})];
        expect(planCanvasSketchAppend(items, 1, 'scene', 2)).toEqual({ missing: [{ path: 'Unranked.md', rank: 30 }], ranks: [40, 50] });
    });
    it('appends after unplaced sketches in the chosen act, including an orphan', () => {
        const items = [item('Lost', 'sketch', 2, { 'Place after scene': 'missing' }), item('Draft', 'sketch', 2, {}), item('Other', 'sketch', 1, {})];
        const plan = planCanvasSketchAppend(items, 2, null, 2);
        expect(plan.missing.map(entry => entry.path)).toEqual(['Draft.md', 'Lost.md']);
        expect(plan.ranks).toEqual([30, 40]);
    });
});
