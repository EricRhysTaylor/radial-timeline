import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { panelPlaceImage, panelSceneImage } from './panelPlaceImage';

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
    it('resolves optional scene artwork independently of the place image', () => {
        expect(panelSceneImage(app, scene, { 'Scene image': '[[Final.webp]]', 'Place image': '[[Tourney.jpg]]' })).toEqual({ url: override.path, path: override.path, name: override.name });
        expect(panelSceneImage(app, scene, { 'Scene image': '[[Missing.png]]' })).toBeNull();
        expect(panelSceneImage(app, scene, {})).toBeNull();
    });
    it('uses the scene image instead of the place default', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'], 'Place image': '[[Final.webp]]' }, 'Place')).toEqual({ url: override.path, path: override.path, source: 'scene', name: override.name });
    });
    it('matches the Place property directly to an image without a place note', () => {
        const named = { path: 'Pictures/Harbor 2.png', basename: 'Harbor 2', name: 'Harbor 2.png', extension: 'png' } as TFile;
        expect(panelPlaceImage(app, scene, { Place: ['[[Places/Harbor|The Harbor]]'] }, 'Place', [named])).toEqual({ url: named.path, path: named.path, source: 'place', name: 'Harbor' });
        expect(panelPlaceImage(app, scene, { Place: ['[[Places/Harbor]]'], 'Place image': '[[Final.webp]]' }, 'Place', [named])?.path).toBe(override.path);
    });
    it('prefers the Place note\'s Image over a file named after the place, wherever that file sits', () => {
        const stray = { path: 'Other Book/Tourney 2.png', basename: 'Tourney 2', name: 'Tourney 2.png', extension: 'png' } as TFile;
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'] }, 'Place', [stray])).toEqual({ url: fallback.path, path: fallback.path, source: 'place', name: 'Tourney' });
    });
    it('matches by name when the Place note has no usable Image', () => {
        const named = { path: 'Pictures/Tourney.png', basename: 'Tourney', name: 'Tourney.png', extension: 'png' } as TFile;
        const without = (frontmatter: Record<string, unknown>) => ({ ...app, metadataCache: { ...app.metadataCache, getFileCache: () => ({ frontmatter }) } }) as unknown as App;
        expect(panelPlaceImage(without({}), scene, { Place: ['[[Tourney]]'] }, 'Place', [named])?.path).toBe(named.path);
        expect(panelPlaceImage(without({ Image: '[[missing.png]]' }), scene, { Place: ['[[Tourney]]'] }, 'Place', [named])?.path).toBe(named.path);
    });
    it('uses the first place default when the override is missing or broken', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'], 'Place image': '[[missing.png]]' }, 'Place')).toEqual({ url: fallback.path, path: fallback.path, source: 'place', name: 'Tourney' });
    });
    it('does not substitute another place if the first is missing', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Missing]]', '[[Tourney]]'] }, 'Place')).toBeNull();
    });
});
