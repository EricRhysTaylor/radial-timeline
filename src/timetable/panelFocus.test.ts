import { describe, expect, it } from 'vitest';
import { coverPosition, validPanelFocus } from './panelFocus';

describe('panel image focus', () => {
    it('centers the selected point when the crop permits it', () => {
        expect(coverPosition(100, 100, 300, 100, { x: 0.3, y: 0.5 })).toEqual({ x: -40, y: 0 });
    });
    it('clamps to image edges without leaving empty space', () => {
        expect(coverPosition(100, 100, 300, 100, { x: 0, y: 0.5 })).toEqual({ x: 0, y: 0 });
        expect(coverPosition(100, 100, 300, 100, { x: 1, y: 0.5 })).toEqual({ x: -200, y: 0 });
    });
    it('falls back to center for malformed persisted data', () => {
        expect(validPanelFocus({ x: 2, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
        expect(validPanelFocus({ x: 0.2, y: 0.8 })).toEqual({ x: 0.2, y: 0.8 });
    });
});
