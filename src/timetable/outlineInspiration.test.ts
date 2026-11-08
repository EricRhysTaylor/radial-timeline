import { describe, expect, it } from 'vitest';
import { planOutlineActInsertion, planOutlineInsertion } from './outlineInspiration';
import type { PlacementItem, SketchPlacement } from './sketchPlacement';
import type { TimetableRow } from './timetableModel';

function item(name: string, kind: TimetableRow['kind'], fm: Record<string, unknown> = {}, placement?: SketchPlacement): PlacementItem {
    return { row: { path: `${name}.md`, basename: name, kind, act: 1, prefix: kind === 'scene' ? '1' : null, className: null, subplots: [], removedScene: false }, frontmatter: fm, placement };
}

describe('outline inspiration placement', () => {
    const scene = item('Scene', 'scene', { ID: 'scene' });
    const first = item('First', 'sketch', {}, { after: 'scene', order: 10 });
    const second = item('Second', 'sketch', {}, { after: 'scene', order: 20 });
    it('places after a scene or between sketches without changing existing notes', () => {
        const items = [scene, first, second];
        expect(planOutlineInsertion(items, 'Scene.md')).toEqual({ act: 1, anchorId: 'scene', rank: 0 });
        expect(planOutlineInsertion(items, 'First.md')).toEqual({ act: 1, anchorId: 'scene', rank: 15 });
        expect(first.placement?.order).toBe(10);
    });
    it('respects orphaned sketches in the unanchored act tail', () => {
        const tail = item('Tail', 'sketch', {}, { order: 10 });
        const orphan = item('Orphan', 'sketch', {}, { after: 'missing', order: 20 });
        expect(planOutlineInsertion([tail, orphan], 'Tail.md')).toEqual({ act: 1, anchorId: null, rank: 15 });
    });
    it('rejects ambiguous anchors and unranked insertion targets', () => {
        expect(planOutlineInsertion([scene, item('Another', 'scene', { ID: 'scene' })], 'Scene.md')).toBeNull();
        expect(planOutlineInsertion([scene, item('Unranked', 'sketch', {}, { after: 'scene' })], 'Unranked.md')).toBeNull();
        expect(planOutlineInsertion([item('Missing', 'scene')], 'Missing.md')).toBeNull();
    });
});

describe('empty act insertion', () => {
    it('starts an empty act and appends after ordered unanchored sketches', () => {
        expect(planOutlineActInsertion([], 1)).toEqual({ act: 1, anchorId: null, rank: 10 });
        const sketch = item('First', 'sketch', {}, { order: 10 });
        expect(planOutlineActInsertion([sketch], 1)).toEqual({ act: 1, anchorId: null, rank: 20 });
        expect(planOutlineInsertion([sketch], 'First.md')).toEqual({ act: 1, anchorId: null, rank: 20 });
    });
    it('refuses ambiguous unordered tails rather than silently changing their order', () => {
        expect(planOutlineActInsertion([item('Unordered', 'sketch')], 1)).toBeNull();
        expect(planOutlineActInsertion([], 0)).toBeNull();
    });
});
