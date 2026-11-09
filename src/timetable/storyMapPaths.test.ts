import { describe, expect, it } from 'vitest';
import { isStoryMapPath, storyMapFolder, storyMapPrefix } from './storyMapPaths';

describe('story map paths', () => {
    it('keeps imported maps within the story vault and finds standalone maps', () => {
        expect(storyMapFolder('The Odyssey')).toBe('Radial Timeline/Story Maps');
        const book = { title: 'The Odyssey', sourceFolder: 'Demo Projects/The Odyssey/The Odyssey' };
        const path = `${storyMapPrefix(book)}.canvas`;
        expect(path).toBe('Demo Projects/The Odyssey/Radial Timeline/Story Maps/The Odyssey - Subplot Map.canvas');
        expect(isStoryMapPath(path)).toBe(true);
        expect(isStoryMapPath('Radial Timeline/Story Maps/The Odyssey - Subplot Map.canvas')).toBe(true);
        expect(isStoryMapPath('Personal/Ideas.canvas')).toBe(false);
    });
});
