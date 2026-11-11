import { describe, expect, it } from 'vitest';
import { diffStoryMap, type StoryMapScene } from '../src/timetable/storyMapDiff';

const scene = (path: string, act = 1, subplots = ['Main Plot']): StoryMapScene => ({ path, act, subplots });

describe('story map manuscript comparison', () => {
    it('finds additions and removals without calling the remaining scenes reordered', () => {
        const result = diffStoryMap([scene('a'), scene('b')], [scene('new'), scene('b')]);
        expect(result.added.map(item => item.path)).toEqual(['new']);
        expect(result.removed.map(item => item.path)).toEqual(['a']);
        expect(result.orderChanged).toBe(false);
    });

    it('reports changed act, subplot membership and relative order independently', () => {
        const result = diffStoryMap([scene('a', 1, ['Main', 'Mystery']), scene('b')], [scene('b'), scene('a', 2, ['Main', 'Romance'])]);
        expect(result.orderChanged).toBe(true);
        expect(result.actChanged.map(item => item.after.path)).toEqual(['a']);
        expect(result.subplotsChanged.map(item => item.after.path)).toEqual(['a']);
    });

    it('does not mistake subplot list order for a membership change', () => {
        expect(diffStoryMap([scene('a', 1, ['A', 'B'])], [scene('a', 1, ['B', 'A'])]).subplotsChanged).toEqual([]);
    });
});
