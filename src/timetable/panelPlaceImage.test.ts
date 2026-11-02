import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { combinedPanelImage, panelPlaceImage, panelSceneImage } from './panelPlaceImage';

const scene = { path: 'Story/Scene.md' } as TFile;
const place = { path: 'Places/Tourney.md', basename: 'Tourney' } as TFile;
const fallback = { path: 'Images/Tourney.jpg', name: 'Tourney.jpg', extension: 'jpg' } as TFile;
const override = { path: 'Images/Final.webp', name: 'Final.webp', extension: 'webp' } as TFile;
const app = {
    metadataCache: {
        getFirstLinkpathDest: (path: string) => ({ Tourney: place, 'Tourney.jpg': fallback, 'Final.webp': override } as Record<string, TFile>)[path] ?? null,
        getFileCache: () => ({ frontmatter: { Image: '[[Tourney.jpg]]' } }),
    },
    vault: { getResourcePath: (file: TFile) => file.path },
} as unknown as App;

describe('panel place image', () => {
    it('uses the available combined image in place, character, artwork order', () => {
        const location = { url: 'place-url', path: 'place' }, character = { url: 'character-url', path: 'character' }, art = { url: 'art-url', path: 'art' };
        expect(combinedPanelImage(location, character, art)).toEqual({ kind: 'place', image: location });
        expect(combinedPanelImage(null, character, art)).toEqual({ kind: 'character', image: character });
        expect(combinedPanelImage(null, null, art)).toEqual({ kind: 'artwork', image: art });
        expect(combinedPanelImage(null, null, null)).toBeNull();
    });
    it('resolves optional scene artwork independently of the place image', () => {
        expect(panelSceneImage(app, scene, { 'Scene image': '[[Final.webp]]', 'Place image': '[[Tourney.jpg]]' })).toEqual({ url: override.path, path: override.path, name: override.name });
        expect(panelSceneImage(app, scene, { 'Scene image': '[[Missing.png]]' })).toBeNull();
        expect(panelSceneImage(app, scene, {})).toBeNull();
    });
    it('uses the scene image instead of the place default', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'], 'Place image': '[[Final.webp]]' }, 'Place')).toEqual({ url: override.path, path: override.path, source: 'scene', name: override.name });
    });
    it('uses the first place default when the override is missing or broken', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'], 'Place image': '[[missing.png]]' }, 'Place')).toEqual({ url: fallback.path, path: fallback.path, source: 'place', name: 'Tourney' });
    });
    it('does not substitute another place if the first is missing', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Missing]]', '[[Tourney]]'] }, 'Place')).toBeNull();
    });
});
