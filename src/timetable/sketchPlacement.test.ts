import { describe, expect, it } from 'vitest';
import { orderSketches, planSketchActDrop, planSketchDrop, type PlacementItem, type SketchPlacement } from './sketchPlacement';
import type { TimetableRow } from './timetableModel';

function item(name: string, kind: TimetableRow['kind'], act: number | null, prefix: string | null, fm: Record<string, unknown> = {}, placement?: SketchPlacement): PlacementItem {
    return { row: { path: `${name}.md`, basename: name, kind, act, prefix, className: null, subplots: [], removedScene: false }, frontmatter: fm, placement };
}

describe('sketch placement', () => {
    it('interleaves ordered sketches without changing scenes, putting unplaced sketches at the end of their act', () => {
        const result = orderSketches([
            item('13 Next', 'scene', 2, '13', { ID: 'next' }),
            item('Unplaced', 'sketch', 2, '1'),
            item('Second', 'sketch', 2, null, {}, { after: 'first', order: 20 }),
            item('12 First', 'scene', 2, '12', { ID: 'first' }),
            item('First', 'sketch', 2, null, {}, { after: 'first', order: 10 }),
            item('No act', 'sketch', null, null),
        ]);
        expect(result.items.map(x => x.row.basename)).toEqual(['12 First', 'First', 'Second', '13 Next', 'Unplaced', 'No act']);
        expect(result.problems.size).toBe(0);
    });
    it('retains sketches with missing, duplicated, or mismatched anchors in their act', () => {
        const result = orderSketches([
            item('One', 'scene', 1, '1', { ID: 'duplicate' }),
            item('Two', 'scene', 1, '2', { ID: 'duplicate' }),
            item('Three', 'scene', 2, '3', { ID: 'other' }),
            item('Missing', 'sketch', 1, null, {}, { after: 'absent' }),
            item('Duplicate', 'sketch', 1, null, {}, { after: 'duplicate' }),
            item('Wrong act', 'sketch', 1, null, {}, { after: 'other' }),
        ]);
        expect([...result.problems.values()].sort()).toEqual(['different-act', 'duplicate', 'missing']);
        expect(result.items).toHaveLength(6);
    });
});

describe('sketch drop planning', () => {
    it('places a sketch into a scene gap without renumbering any scenes', () => {
        const notes = [
            item('12 First', 'scene', 1, '12', { ID: 'first' }),
            item('Existing', 'sketch', 1, null, {}, { after: 'first', order: 10 }),
            item('13 Next', 'scene', 1, '13', { ID: 'next' }),
            item('Moving', 'sketch', 2, null),
        ];
        expect(planSketchDrop(notes, 'Moving.md', 'Existing.md')).toEqual({ anchorId: 'first', act: 1, orderedPaths: ['Moving.md', 'Existing.md'] });
        expect(notes[0].row.prefix).toBe('12');
        expect(notes[2].row.prefix).toBe('13');
    });
    it('rejects missing or duplicated scene IDs instead of guessing', () => {
        const notes = [item('Moving', 'sketch', 1, null), item('One', 'scene', 1, '1', { ID: 'same' }), item('Two', 'scene', 1, '2', { ID: 'same' })];
        expect(planSketchDrop(notes, 'Moving.md', 'One.md')).toBeNull();
    });
    it('can insert after another sketch or into an unanchored act', () => {
        const notes = [item('A', 'scene', 1, '1', { ID: 'a' }),
            item('First', 'sketch', 1, null, {}, { after: 'a', order: 10 }),
            item('Last', 'sketch', 2, null), item('Moving', 'sketch', 1, null)];
        expect(planSketchDrop(notes, 'Moving.md', 'First.md', true)?.orderedPaths).toEqual(['First.md', 'Moving.md']);
        expect(planSketchDrop(notes, 'Moving.md', 'Last.md', true)).toEqual({ anchorId: null, act: 2, orderedPaths: ['Last.md', 'Moving.md'] });
    });
    it('moves a sketch to the end of an act without moving its scenes', () => {
        const notes = [item('Scene', 'scene', 2, '2', { ID: 'scene' }), item('Tail', 'sketch', 2, null), item('Moving', 'sketch', 1, null)];
        expect(planSketchActDrop(notes, 'Moving.md', 2)).toEqual({ anchorId: null, act: 2, orderedPaths: ['Tail.md', 'Moving.md'] });
        expect(notes[0].row.prefix).toBe('2');
    });
    it('places a previously anchored sketch into a completely empty act', () => {
        const notes = [item('Scene', 'scene', 1, '1', { ID: 'scene' }),
            item('Moving', 'sketch', 1, null, {}, { after: 'scene', order: 10 })];
        expect(planSketchActDrop(notes, 'Moving.md', 3)).toEqual({ anchorId: null, act: 3, orderedPaths: ['Moving.md'] });
        expect(notes[1].placement?.after).toBe('scene');
    });
});
