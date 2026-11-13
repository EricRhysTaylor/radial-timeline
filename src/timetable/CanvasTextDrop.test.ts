import { describe, expect, it } from 'vitest';
import { canvasPoint } from './CanvasTextDrop';

describe('Canvas screen to map coordinates', () => {
    it('uses the rendered card as a ruler at the current zoom', () => {
        const canvas = { nodes: new Map([['one', {
            getData: () => ({ x: 300, y: 170, width: 300, height: 170 }),
            nodeEl: { getBoundingClientRect: () => ({ left: 500, top: 400, width: 150, height: 85 }) } as unknown as HTMLElement,
        }]]) };
        expect(canvasPoint(canvas, { clientX: 575, clientY: 442.5 })).toEqual({ x: 450, y: 255 });
    });
    it('fails closed when the Canvas transform cannot be measured', () => {
        expect(canvasPoint({ nodes: new Map() }, { clientX: 20, clientY: 30 })).toBeNull();
    });
});
