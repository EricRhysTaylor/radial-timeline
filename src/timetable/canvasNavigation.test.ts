import { describe, expect, it } from 'vitest';
import { storyPosition } from './canvasNavigation';

describe('story map navigation', () => {
    const cards = [{ x: 0, y: 0, width: 200, height: 100 }, { x: 1000, y: 400, width: 400, height: 200 }];
    it('moves continuously between card centers, in both axes', () => {
        expect(storyPosition(cards, 0)).toEqual({ x: 100, y: 50, index: 0 });
        expect(storyPosition(cards, 0.25)).toEqual({ x: 375, y: 162.5, index: 0 });
        expect(storyPosition(cards, 0.5)).toEqual({ x: 650, y: 275, index: 1 });
        expect(storyPosition(cards, 1)).toEqual({ x: 1200, y: 500, index: 1 });
    });
    it('clamps bounds and ignores missing or invalid geometry', () => {
        expect(storyPosition(cards, 3)).toEqual({ x: 1200, y: 500, index: 1 });
        expect(storyPosition([], 0)).toBeNull();
        expect(storyPosition([{ x: 0 }], 0)).toBeNull();
    });
});
