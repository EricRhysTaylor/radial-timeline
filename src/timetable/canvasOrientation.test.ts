import { describe, expect, it } from 'vitest';
import { transposeStoryCanvas } from './canvasOrientation';
import { storyAxis } from './canvasNavigation';

describe('transposeStoryCanvas', () => {
    it('preserves manual cards, groups, links and metadata, and is reversible', () => {
        const original = { extra: 'kept', nodes: [
            { id: 'g', type: 'group', x: 0, y: 100, width: 700, height: 220, label: 'My lane', color: '2' },
            { id: 'a', type: 'file', x: 25, y: 125, width: 300, height: 170, file: 'A.md' },
            { id: 'b', type: 'file', x: 375, y: 125, width: 300, height: 170, file: 'B.md' },
            { id: 'c', type: 'text', x: -43, y: 390, width: 201, height: 100, text: 'My idea' },
        ], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', label: 'custom' }] };
        const vertical = transposeStoryCanvas(original)!;
        expect(vertical.edges?.[0]).toMatchObject({ fromSide: 'bottom', toSide: 'top', label: 'custom' });
        expect(storyAxis(vertical.nodes!.filter(node => node.type === 'file').map(node => ({ x: node.x as number, y: node.y as number, width: node.width as number, height: node.height as number })))?.axis).toBe('y');
        expect(transposeStoryCanvas(vertical)).toEqual(original);
    });
    it('does not partially rewrite a canvas with unknown geometry', () => {
        expect(transposeStoryCanvas({ nodes: [{ id: 'a', type: 'text', x: 1 }] })).toBeNull();
    });
});
