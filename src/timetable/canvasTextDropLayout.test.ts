import { describe, expect, it } from 'vitest';
import { planSubplotCanvas } from './subplotCanvas';
import { CanvasLayoutError, insertCanvasSceneCard } from './canvasTextDropLayout';
import { t } from '../i18n';
import type { TimetableRow } from './timetableModel';

const rows = [1, 2, 3].map(n => ({ path: `Book/${n}.md`, basename: `${n}`, kind: 'scene', className: null, prefix: String(n), act: 1, subplots: ['Main'], removedScene: false } as TimetableRow));
describe('Canvas insertion layout', () => {
    for (const vertical of [false, true]) it(`inserts and reconnects in ${vertical ? 'vertical' : 'horizontal'} maps`, () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null, layout: vertical ? 'vertical' : 'horizontal' }, () => String(++id));
        const lane = data.nodes.find(item => item.type === 'group')!;
        const result = insertCanvasSceneCard(data, data, { laneId: lane.id, nodeId: 'new', edgeId: () => 'new-edge', path: 'Book/1.5.md', beforePath: 'Book/2.md', vertical });
        expect(result.data.nodes?.some(item => item.file === 'Book/1.5.md')).toBe(true);
        expect(result.data.edges?.filter(edge => edge.fromNode === 'new' || edge.toNode === 'new')).toHaveLength(2);
        expect(result.baseline.nodes).toEqual(result.data.nodes);
    });
    for (const vertical of [false, true]) it(`keeps the act heading with a new first scene in ${vertical ? 'vertical' : 'horizontal'} maps`, () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null, layout: vertical ? 'vertical' : 'horizontal' }, () => String(++id));
        const lane = data.nodes.find(item => item.type === 'group')!;
        const heading = data.nodes.find(item => item.type === 'text' && item.text === '# Act 1')!;
        const result = insertCanvasSceneCard(data, data, { laneId: lane.id, nodeId: 'new', edgeId: () => 'new-edge', path: 'Book/0.md', beforePath: 'Book/1.md', vertical, keepHeading: true });
        expect(result.data.nodes?.find(item => item.id === heading.id)).toEqual(heading);
    });
    it('refuses to alter an edited connection', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        const lane = data.nodes.find(item => item.type === 'group')!;
        const changed = { ...data, edges: data.edges.map((edge, i) => i ? edge : { ...edge, label: 'mine' }) };
        expect(() => insertCanvasSceneCard(changed, data, { laneId: lane.id, nodeId: 'new', edgeId: () => 'new-edge', path: 'Book/1.5.md', beforePath: 'Book/2.md', vertical: false })).toThrow(/connection/);
    });
    it('preserves an unrelated manual card and its connection', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        const lane = data.nodes.find(item => item.type === 'group')!;
        const manual = { id: 'manual', type: 'text', text: 'Author idea', x: -700, y: -700, width: 200, height: 100 };
        const connection = { id: 'manual-edge', fromNode: 'manual', toNode: data.nodes.find(node => node.file === 'Book/1.md')!.id, label: 'keep' };
        const current = { ...data, nodes: [...data.nodes, manual], edges: [...data.edges, connection] };
        const result = insertCanvasSceneCard(current, data, { laneId: lane.id, nodeId: 'new', edgeId: () => 'new-edge', path: 'Book/1.5.md', beforePath: 'Book/2.md', vertical: false });
        expect(result.data.nodes?.find(node => node.id === 'manual')).toEqual(manual);
        expect(result.data.edges?.find(edge => edge.id === 'manual-edge')).toEqual(connection);
        expect(result.baseline.nodes?.find(node => node.id === 'manual')).toBeUndefined();
    });
    it('refuses to shift a card into an author-created card', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        const lane = data.nodes.find(item => item.type === 'group')!;
        const manual = { id: 'manual', type: 'text', text: 'Author idea', x: 740, y: 205, width: 100, height: 100 };
        const current = { ...data, nodes: [...data.nodes, manual] };
        expect(() => insertCanvasSceneCard(current, data, { laneId: lane.id, nodeId: 'new', edgeId: () => 'new-edge', path: 'Book/1.5.md', beforePath: 'Book/2.md', vertical: false })).toThrow(/Manual cards/);
    });
    it('reports why a card cannot be placed as a translatable problem', () => {
        let id = 0;
        const data = planSubplotCanvas(rows, { act: null, subplot: null }, () => String(++id));
        const lane = data.nodes.find(item => item.type === 'group')!;
        const changed = { ...data, edges: data.edges.map((edge, i) => i ? edge : { ...edge, label: 'mine' }) };
        let thrown: unknown;
        try { insertCanvasSceneCard(changed, data, { laneId: lane.id, nodeId: 'new', edgeId: () => 'new-edge', path: 'Book/1.5.md', beforePath: 'Book/2.md', vertical: false }); } catch (error) { thrown = error; }
        expect(thrown).toBeInstanceOf(CanvasLayoutError);
        expect((thrown as CanvasLayoutError).problem).toBe('connectionChanged');
        expect(t('ui.timetable.canvasLayoutConnectionChanged')).toBe((thrown as CanvasLayoutError).message);
    });
});
