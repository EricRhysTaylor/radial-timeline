import { describe, expect, it } from 'vitest';
import { planOutlineInsertion } from './outlineInspiration';
import { SKETCH_AFTER_SCENE, SKETCH_ORDER, type PlacementItem } from './sketchPlacement';
import type { TimetableRow } from './timetableModel';

function item(name: string, kind: TimetableRow['kind'], fm: Record<string, unknown> = {}): PlacementItem {
    return { row: { path: `${name}.md`, basename: name, kind, act: 1, prefix: kind === 'scene' ? '1' : null, className: null, subplots: [], removedScene: false }, frontmatter: fm };
}

describe('outline inspiration placement', () => {
    const scene = item('Scene', 'scene', { ID: 'scene' });
    const first = item('First', 'sketch', { [SKETCH_AFTER_SCENE]: 'scene', [SKETCH_ORDER]: 10 });
    const second = item('Second', 'sketch', { [SKETCH_AFTER_SCENE]: 'scene', [SKETCH_ORDER]: 20 });
    it('places after a scene or between sketches without changing existing notes', () => {
        const items = [scene, first, second];
        expect(planOutlineInsertion(items, 'Scene.md')).toEqual({ act: 1, anchorId: 'scene', rank: 0 });
        expect(planOutlineInsertion(items, 'First.md')).toEqual({ act: 1, anchorId: 'scene', rank: 15 });
        expect(first.frontmatter?.[SKETCH_ORDER]).toBe(10);
    });
    it('respects orphaned sketches in the unanchored act tail', () => {
        const tail = item('Tail', 'sketch', { [SKETCH_ORDER]: 10 });
        const orphan = item('Orphan', 'sketch', { [SKETCH_AFTER_SCENE]: 'missing', [SKETCH_ORDER]: 20 });
        expect(planOutlineInsertion([tail, orphan], 'Tail.md')).toEqual({ act: 1, anchorId: null, rank: 15 });
    });
    it('rejects ambiguous anchors and unranked insertion targets', () => {
        expect(planOutlineInsertion([scene, item('Another', 'scene', { ID: 'scene' })], 'Scene.md')).toBeNull();
        expect(planOutlineInsertion([scene, item('Unranked', 'sketch', { [SKETCH_AFTER_SCENE]: 'scene' })], 'Unranked.md')).toBeNull();
        expect(planOutlineInsertion([item('Missing', 'scene')], 'Missing.md')).toBeNull();
    });
});
