import { describe, expect, it } from 'vitest';
import { bookStoryMaps, isStoryMapPath, preferredStoryMap, storyMapFolder, storyMapPrefix } from './storyMapPaths';

describe('Canvas subplot branches paths', () => {
    it('saves new branches in the Canvas folder, keeping imported ones within the story vault', () => {
        expect(storyMapFolder('The Odyssey')).toBe('Radial Timeline/Canvas');
        const book = { title: 'The Odyssey', sourceFolder: 'Demo Projects/The Odyssey/The Odyssey' };
        const path = `${storyMapPrefix(book)}.canvas`;
        expect(path).toBe('Demo Projects/The Odyssey/Radial Timeline/Canvas/The Odyssey - Subplot Branches.canvas');
        expect(isStoryMapPath(path)).toBe(true);
        expect(isStoryMapPath('Radial Timeline/Canvas/The Odyssey - Subplot Branches 2.canvas')).toBe(true);
        expect(isStoryMapPath('Personal/Ideas.canvas')).toBe(false);
        expect(isStoryMapPath('Personal/Radial Timeline/Canvas/Ideas.canvas')).toBe(false);
    });

    it('still finds files saved under the earlier Story Maps names', () => {
        expect(isStoryMapPath('Radial Timeline/Story Maps/The Odyssey - Subplot Map.canvas')).toBe(true);
        expect(isStoryMapPath('Demo Projects/The Odyssey/Radial Timeline/Story Maps/The Odyssey - Subplot Map.canvas')).toBe(true);
        const book = { title: 'The Odyssey', sourceFolder: 'Odyssey' };
        const files = [
            { path: 'Radial Timeline/Story Maps/The Odyssey - Subplot Map.canvas' },
            { path: 'Radial Timeline/Story Maps/The Odyssey - Subplot Map 2.canvas' },
            { path: 'Radial Timeline/Canvas/The Odyssey - Subplot Branches.canvas' },
            { path: 'Radial Timeline/Canvas/The Odyssey - Subplot Branches 3.canvas' },
            { path: 'Radial Timeline/Canvas/The Odyssey - Subplot Branches notes.canvas' },
            { path: 'Radial Timeline/Canvas/Pride & Prejudice - Subplot Branches.canvas' },
        ];
        expect(bookStoryMaps(files, book).map(file => file.path)).toEqual(files.slice(0, 4).map(file => file.path));
    });

    it('opens the only open one, else the newest-named primary, else the only one', () => {
        const book = { title: 'The Odyssey', sourceFolder: 'Odyssey' };
        const legacy = { path: 'Radial Timeline/Story Maps/The Odyssey - Subplot Map.canvas' };
        const fresh = { path: 'Radial Timeline/Canvas/The Odyssey - Subplot Branches.canvas' };
        const second = { path: 'Radial Timeline/Canvas/The Odyssey - Subplot Branches 2.canvas' };
        expect(preferredStoryMap([legacy, fresh, second], new Set([second.path]), book)).toBe(second);
        expect(preferredStoryMap([legacy, fresh, second], new Set(), book)).toBe(fresh);
        expect(preferredStoryMap([legacy, second], new Set(), book)).toBe(legacy);
        expect(preferredStoryMap([second], new Set(), book)).toBe(second);
        expect(preferredStoryMap([second, { path: 'Radial Timeline/Canvas/The Odyssey - Subplot Branches 3.canvas' }], new Set(), book)).toBeUndefined();
    });
});
