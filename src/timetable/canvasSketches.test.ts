import { describe, expect, it } from 'vitest';
import { canvasTextCards, linkSketches, sketchTitle } from './canvasSketches';

describe('Canvas sketches', () => {
    it('offers only nonempty text cards and makes a safe name from the first line', () => {
        const nodes = [
            { id: 'a', type: 'text', text: '# A / new scene\n\nBody' },
            { id: 'b', type: 'text', text: '  ' },
            { id: 'c', type: 'file', file: 'scene.md' },
        ];
        expect(canvasTextCards({ nodes }).map(node => node.id)).toEqual(['a']);
        expect(sketchTitle(nodes[0].text!)).toBe('A new scene');
    });

    it('links selected cards without changing positions, edges, or unrelated nodes', () => {
        const original = { nodes: [
            { id: 'a', type: 'text', text: 'Original', x: 20, y: 30, color: '1', extension: true },
            { id: 'b', type: 'text', text: 'Another' },
        ], edges: [{ id: 'edge', fromNode: 'a', toNode: 'b' }] };
        const result = linkSketches(original, new Map([['a', { id: 'new-a', path: 'Book/Original.md' }]]));
        expect(result.nodes?.[0]).toEqual({ id: 'new-a', type: 'file', file: 'Book/Original.md', x: 20, y: 30, color: '1', extension: true });
        expect(result.nodes?.[1]).toEqual(original.nodes[1]);
        expect(result.edges).toEqual([{ id: 'edge', fromNode: 'new-a', toNode: 'b' }]);
        expect(original.nodes[0].text).toBe('Original');
    });
});
