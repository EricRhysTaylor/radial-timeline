import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { storyImageSources } from './storyImageMenu';

const scene = { path: 'Story/Scene.md' } as TFile;
const pluginWith = (choices: Record<string, unknown>) => ({
    settings: { storyImageChoices: { [scene.path]: choices } },
    app: {
        metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null },
        vault: { getResourcePath: (file: TFile) => file.path, getAbstractFileByPath: () => null },
    } as unknown as App,
}) as unknown as RadialTimelinePlugin;

describe('story image menu sources', () => {
    it('says a chosen place picture is missing, never "none found for" an empty name, when the scene has no Place', () => {
        const lines = storyImageSources(pluginWith({ placeImage: 'Images/Deleted.png' }), scene, {}, [], undefined);
        expect(lines).toEqual(['Place: the chosen picture is missing']);
    });
    it('names the scene\'s place when it has no picture', () => {
        const lines = storyImageSources(pluginWith({}), scene, { Place: ['[[Harbor]]'] }, [], undefined);
        expect(lines).toEqual(['Place: none found for Harbor']);
    });
    it('reports no place line for a scene with no Place and no chosen place picture', () => {
        expect(storyImageSources(pluginWith({}), scene, {}, [], undefined)).toEqual([]);
    });
});
