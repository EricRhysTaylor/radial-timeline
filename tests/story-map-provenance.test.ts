import { describe, expect, it } from 'vitest';
import { canvasChanges, carryCanvasEdits, matchingBaseline, rebaseStoryMapProvenance, type StoryMapProvenance } from '../src/timetable/storyMapProvenance';
import { transposeStoryCanvas } from '../src/timetable/canvasOrientation';
import type { StoryCanvasData } from '../src/timetable/canvasSketches';

describe('generated Canvas baseline comparison', () => {
    const baseline: StoryCanvasData = {
        nodes: [{ id: 'a', type: 'file', file: 'scene.md', x: 10, y: 20 }],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'a', color: '1' }],
    };
    it('ignores property order but detects manual additions', () => {
        const changes = canvasChanges(baseline, {
            nodes: [{ y: 20, x: 10, file: 'scene.md', type: 'file', id: 'a' }, { id: 'idea', type: 'text', text: 'idea' }],
            edges: [{ color: '1', toNode: 'a', fromNode: 'a', id: 'e' }],
        });
        expect(changes).toEqual({ addedNodes: 1, addedEdges: 0, changedNodes: 0, changedEdges: 0, removedNodes: 0, removedEdges: 0 });
    });
    it('detects changed and removed generated elements', () => {
        const changes = canvasChanges(baseline, { nodes: [{ id: 'a', type: 'file', file: 'scene.md', x: 30, y: 20 }], edges: [] });
        expect(changes.changedNodes).toBe(1);
        expect(changes.removedEdges).toBe(1);
    });
    it('treats a layout flip as orientation rather than a manual change', () => {
        const data = { nodes: [{ id: 'a', type: 'file', file: 'a.md', x: 10, y: 20, width: 100, height: 50 }] };
        const flipped = transposeStoryCanvas(data)!;
        expect(matchingBaseline(data, flipped).transposed).toBe(true);
        expect(canvasChanges(matchingBaseline(data, flipped).data, flipped).changedNodes).toBe(0);
    });
    it('carries a manual card and its connection and leaves the original untouched', () => {
        const original: StoryCanvasData = { nodes: [{ id: 'a', type: 'file', x: 0, y: 0, width: 50, height: 50 }, { id: 'idea', type: 'text', text: 'Idea', x: 60, y: 0, width: 50, height: 50 }], edges: [{ id: 'custom', fromNode: 'a', toNode: 'idea', label: 'remember' }] };
        const old: StoryCanvasData = { nodes: [original.nodes![0]], edges: [] };
        const fresh: StoryCanvasData = { nodes: [{ id: 'new', type: 'file', x: 0, y: 0, width: 50, height: 50 }], edges: [] };
        const before = JSON.stringify(original);
        const copy = carryCanvasEdits(old, original, fresh);
        expect(copy.nodes).toBe(2);
        expect(copy.data.edges?.[0]).toMatchObject({ id: 'custom', label: 'remember' });
        expect(copy.data.nodes?.find(node => node.id === 'idea')?.text).toBe('Idea');
        expect(JSON.stringify(original)).toBe(before);
    });
    it('rebases a renamed note and a renamed map while keeping other metadata', () => {
        const record: StoryMapProvenance = { version: 1, bookId: 'b', generatedAt: '2026-01-01', act: null, subplot: null, layout: 'horizontal', initialFocus: 'beginning', scenes: [{ path: 'Book/old.md', act: 1, subplots: ['Main'] }], generated: { nodes: [{ id: 'a', type: 'file', file: 'Book/old.md' }] } };
        const moved = rebaseStoryMapProvenance({ 'Maps/old.canvas': record }, 'Book/old.md', 'Book/new.md');
        expect(moved['Maps/old.canvas'].scenes[0].path).toBe('Book/new.md');
        expect(moved['Maps/old.canvas'].generated.nodes?.[0].file).toBe('Book/new.md');
        expect(rebaseStoryMapProvenance(moved, 'Maps/old.canvas', 'Maps/new.canvas')['Maps/new.canvas'].initialFocus).toBe('beginning');
    });
});
