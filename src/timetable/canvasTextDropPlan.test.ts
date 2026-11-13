import { describe, expect, it } from 'vitest';
import { planCanvasTextDrop } from './canvasTextDropPlan';
import { planSubplotCanvas } from './subplotCanvas';
import type { TimetableRow } from './timetableModel';

const rows: TimetableRow[] = [
    { path: 'Book/1.md', basename: '1', kind: 'scene', className: null, prefix: '1', act: 1, subplots: ['Main'], removedScene: false },
    { path: 'Book/2.md', basename: '2', kind: 'scene', className: null, prefix: '2', act: 1, subplots: ['Other'], removedScene: false },
    { path: 'Book/3.md', basename: '3', kind: 'scene', className: null, prefix: '3', act: 1, subplots: ['Main'], removedScene: false },
];
const scenes = rows.map(row => ({ path: row.path, act: row.act, subplots: row.subplots }));

describe('Canvas text drop placement', () => {
    for (const vertical of [false, true]) it(`uses manuscript columns in ${vertical ? 'vertical' : 'horizontal'} lanes`, () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null, layout: vertical ? 'vertical' : 'horizontal' }, () => String(++id));
        const lane = data.nodes.find(node => node.type === 'group' && node.label === 'Main')!;
        // Main has scenes 1 and 3; a drop after the globally aligned scene 2
        // belongs after 2 even though scene 2 is not in the Main lane.
        const point = vertical ? { x: lane.x + 10, y: 800 } : { x: 800, y: lane.y + 10 };
        expect(planCanvasTextDrop(data, data, scenes, point, vertical)).toEqual({ kind: 'scene', laneId: lane.id, subplot: 'Main', after: 'Book/2.md', before: 'Book/3.md', act: 1, actChoices: [1] });
        expect(planCanvasTextDrop(data, data, scenes, { x: -500, y: -500 }, vertical)).toEqual({ kind: 'sketch' });
    });
    it('uses a partial map when visible scenes identify a single manuscript gap', () => {
        let id = 0;
        const data = planSubplotCanvas(rows.slice(0, 2), { act: null, subplot: null }, () => String(++id));
        expect(planCanvasTextDrop(data, data, scenes, { x: 400, y: 180 }, false)).toMatchObject({ kind: 'scene', after: 'Book/1.md', before: 'Book/2.md' });
        expect(planCanvasTextDrop(data, data, scenes, { x: 700, y: 180 }, false)).toEqual({ kind: 'ambiguous', reason: 'hiddenScenes' });
    });
    it('does not use overlapping manual groups as generated lanes', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        const modified = { ...data, nodes: [...data.nodes, { id: 'manual', type: 'group', label: 'My notes', x: 0, y: 170, width: 1000, height: 220 }] };
        expect(planCanvasTextDrop(modified, data, scenes, { x: 800, y: 180 }, false).kind).toBe('scene');
    });
    it('offers both acts at a boundary', () => {
        let id = 0;
        const changed = rows.map((row, index) => ({ ...row, act: index === 2 ? 2 : 1 }));
        const data = planSubplotCanvas(changed, { act: null, subplot: null }, () => String(++id));
        const current = changed.map(row => ({ path: row.path, act: row.act, subplots: row.subplots }));
        expect(planCanvasTextDrop(data, data, current, { x: 800, y: 180 }, false)).toMatchObject({ kind: 'scene', actChoices: [1, 2], after: 'Book/2.md', before: 'Book/3.md' });
    });
    it('allows a drop before the first scene', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        expect(planCanvasTextDrop(data, data, scenes, { x: 10, y: 180 }, false)).toMatchObject({ kind: 'scene', after: null, before: 'Book/1.md', actChoices: [1] });
    });
    it('does not guess if generated cards were moved out of manuscript order', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        const modified = { ...data, nodes: data.nodes.map(node => node.file === 'Book/2.md' ? { ...node, x: 1500 } : node) };
        expect(planCanvasTextDrop(modified, data, scenes, { x: 800, y: 180 }, false)).toEqual({ kind: 'ambiguous', reason: 'outOfOrder' });
    });
});
