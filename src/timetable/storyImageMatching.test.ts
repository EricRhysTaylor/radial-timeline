import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { imageSubjectName, matchingStoryImages, stableStoryImage } from './storyImageMatching';

const image = (path: string): TFile => {
    const name = path.split('/').pop()!;
    const index = name.lastIndexOf('.');
    return { path, name, basename: name.slice(0, index), extension: name.slice(index + 1) } as TFile;
};

describe('story image filename matching', () => {
    it('uses the linked note name, not its folder or alias', () => {
        expect(imageSubjectName('[[Places/Diego|the port]]')).toBe('Diego');
    });
    it('matches exact names and numbered variants without prefix collisions', () => {
        const images = ['Art/Diego.webp', 'Art/Diego 2.jpg', 'Art/Diego 10.png', 'Art/Diego West.jpg', 'Art/Diego2.jpg'].map(image);
        expect(matchingStoryImages(images, 'Diego').map(file => file.name)).toEqual(['Diego.webp', 'Diego 2.jpg', 'Diego 10.png']);
    });
    it('does not silently pick between duplicate matching names', () => {
        const images = ['A/Diego.jpg', 'B/Diego.png', 'A/Diego 2.jpg'].map(image);
        expect(matchingStoryImages(images, 'Diego').map(file => file.name)).toEqual(['Diego 2.jpg']);
    });
    it('keeps a scene selection stable across image enumeration order', () => {
        const images = ['Art/Diego.webp', 'Art/Diego 2.jpg'].map(image);
        expect(stableStoryImage(images, 'Book/Scene.md', 'Diego')?.path).toBe(stableStoryImage([...images].reverse(), 'Book/Scene.md', 'Diego')?.path);
    });
});

import { chooseImageSubject } from './storyImageMatching';
describe('character image strategy', () => {
    const counts = new Map([['trisan', 30], ['michi', 3]]);
    it('selects a less frequent character from the current scene', () => {
        expect(chooseImageSubject(['Trisan', 'Michi'], 'distinctive', counts, null, null)).toBe('Michi');
    });
    it('uses POV only if that character appears in the scene', () => {
        expect(chooseImageSubject(['Trisan', 'Michi'], 'pov', counts, 'Michi', null)).toBe('Michi');
        expect(chooseImageSubject(['Trisan'], 'pov', counts, 'Michi', null)).toBe('Trisan');
    });
    it('avoids repeating the previous character in balanced mode', () => {
        expect(chooseImageSubject(['Trisan', 'Michi'], 'balanced', counts, null, 'Michi')).toBe('Trisan');
    });
});
