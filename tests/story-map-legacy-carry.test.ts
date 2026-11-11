import { describe, expect, it } from 'vitest';
import { carryLegacySelection, selectedCanvasContents } from '../src/timetable/storyMapLegacyCarry';
import type { StoryCanvasData } from '../src/timetable/canvasSketches';

describe('bringing a selection from an older Canvas', () => {
    const source: StoryCanvasData = { nodes: [
        { id: 'group', type: 'group', label: 'Ideas', x: 0, y: 0, width: 300, height: 300 },
        { id: 'idea', type: 'text', text: 'My idea', x: 20, y: 20, width: 100, height: 100 },
        { id: 'scene', type: 'file', file: 'scene.md', x: 500, y: 20, width: 100, height: 100 },
        { id: 'other', type: 'text', text: 'Unselected', x: 900, y: 20, width: 100, height: 100 },
    ], edges: [{ id: 'link', fromNode: 'idea', toNode: 'scene', label: 'Important link' }] };
    const fresh: StoryCanvasData = { nodes: [{ id: 'new', type: 'text', text: 'New map', x: 0, y: 0, width: 1000, height: 100 }], edges: [] };

    it('carries a selected card, its connection and the connected endpoint, leaving originals intact', () => {
        const before = JSON.stringify(source);
        const result = carryLegacySelection(source, ['idea'], fresh);
        expect(result.data.nodes?.map(node => node.id)).toEqual(['new', 'idea', 'scene']);
        expect(result.data.edges?.[0]).toMatchObject({ id: 'link', label: 'Important link' });
        expect(result.data.nodes?.find(node => node.id === 'idea')).toMatchObject({ x: 1180, y: 0 });
        expect(JSON.stringify(source)).toBe(before);
    });
    it('includes cards inside a selected group and their connections', () => {
        const result = selectedCanvasContents(source, ['group']);
        expect(result.nodes.map(node => node.id)).toEqual(['group', 'idea', 'scene']);
        expect(result.edges).toHaveLength(1);
    });
    it('supports selecting a connection and preserves both endpoints', () => {
        expect(selectedCanvasContents(source, ['link']).nodes.map(node => node.id)).toEqual(['idea', 'scene']);
    });
    it('refuses a connection whose endpoint is missing', () => {
        expect(() => selectedCanvasContents({ nodes: [source.nodes![1]], edges: source.edges }, ['idea'])).toThrow('missing endpoint');
    });
});
