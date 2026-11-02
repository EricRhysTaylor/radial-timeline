import { describe, expect, it } from 'vitest';
import { isStoryActHeading, storyAxis, storyPosition, storyProgress } from './canvasNavigation';

describe('story map navigation', () => {
    it('recognizes act headings on older and current generated maps', () => {
        expect(isStoryActHeading('# Act 1 · 1–5\nLines show narrative order.')).toBe(true);
        expect(isStoryActHeading('**Act 2**')).toBe(true);
        expect(isStoryActHeading('# No act')).toBe(true);
        expect(isStoryActHeading('Act 2 arrives at the station')).toBe(false);
    });
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
    it('chooses a stable horizontal or vertical axis for the whole map', () => {
        expect(storyAxis(cards)).toEqual({ axis: 'x', min: 100, max: 1200 });
        expect(storyAxis([{ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 2000, width: 100, height: 100 }])).toEqual({ axis: 'y', min: 50, max: 2050 });
        expect(storyAxis([{ x: 0 }])).toBeNull();
    });
    it('tracks the visible scene on unevenly spaced 200-scene maps, including both endpoints', () => {
        const many = Array.from({ length: 200 }, (_, i) => ({ x: i * i * 10, y: 0, width: 200, height: 100 }));
        for (const position of [0, 0.25, 72.5, 134, 199]) {
            const point = storyPosition(many, position)!;
            expect(storyProgress(many, 'x', point.x)).toBeCloseTo(position);
        }
        expect(storyProgress(many, 'x', -500)).toBe(0);
        expect(storyProgress(many, 'x', 500000)).toBe(199);
    });
    it('follows a vertical map and ignores invalid input', () => {
        const vertical = [{ x: 0, y: 100, width: 100, height: 100 }, { x: 0, y: 700, width: 100, height: 100 }];
        expect(storyProgress(vertical, 'y', 450)).toBe(0.5);
        expect(storyProgress([], 'x', 0)).toBeNull();
        expect(storyProgress(vertical, 'y', NaN)).toBeNull();
    });
});
