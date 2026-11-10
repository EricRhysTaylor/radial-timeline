import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { TFile as ObsidianFile } from 'obsidian';
import { panelPlaceImage } from './panelPlaceImage';

const scene = { path: 'Story/Scene.md' } as TFile;
const place = { path: 'Places/Tourney.md', basename: 'Tourney' } as TFile;
const fallback = { path: 'Images/Tourney.jpg', name: 'Tourney.jpg', extension: 'jpg' } as TFile;
const chosen = Object.assign(Object.create(ObsidianFile.prototype) as TFile, { path: 'Images/Final.webp', name: 'Final.webp', extension: 'webp' });
const app = {
    metadataCache: {
        getFirstLinkpathDest: (path: string) => ({ Tourney: place, 'Tourney.jpg': fallback } as Record<string, TFile>)[path] ?? null,
        getFileCache: () => ({ frontmatter: { Image: '[[Tourney.jpg]]' } }),
    },
    vault: { getResourcePath: (file: TFile) => file.path, getAbstractFileByPath: (path: string) => (path === chosen.path ? chosen : null) },
} as unknown as App;

describe('panel place image', () => {
    it('uses the image chosen on the card first', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'] }, 'Place', [], chosen.path)).toEqual({ url: chosen.path, path: chosen.path, source: 'card', name: chosen.name });
    });
    it('ignores a scene\'s own Place image property: pictures belong to the place and the card', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'], 'Place image': '[[Final.webp]]' }, 'Place')).toEqual({ url: fallback.path, path: fallback.path, source: 'note', name: 'Tourney' });
    });
    it('matches the Place property directly to an image without a place note', () => {
        const named = { path: 'Pictures/Harbor 2.png', basename: 'Harbor 2', name: 'Harbor 2.png', extension: 'png' } as TFile;
        expect(panelPlaceImage(app, scene, { Place: ['[[Places/Harbor|The Harbor]]'] }, 'Place', [named])).toEqual({ url: named.path, path: named.path, source: 'named', name: 'Harbor' });
    });
    it('prefers the Place note\'s Image over a file named after the place, wherever that file sits', () => {
        const stray = { path: 'Other Book/Tourney 2.png', basename: 'Tourney 2', name: 'Tourney 2.png', extension: 'png' } as TFile;
        expect(panelPlaceImage(app, scene, { Place: ['[[Tourney]]'] }, 'Place', [stray])).toEqual({ url: fallback.path, path: fallback.path, source: 'note', name: 'Tourney' });
    });
    it('matches by name when the Place note has no usable Image', () => {
        const named = { path: 'Pictures/Tourney.png', basename: 'Tourney', name: 'Tourney.png', extension: 'png' } as TFile;
        const without = (frontmatter: Record<string, unknown>) => ({ ...app, metadataCache: { ...app.metadataCache, getFileCache: () => ({ frontmatter }) } }) as unknown as App;
        expect(panelPlaceImage(without({}), scene, { Place: ['[[Tourney]]'] }, 'Place', [named])).toMatchObject({ path: named.path, source: 'named' });
        expect(panelPlaceImage(without({ Image: '[[missing.png]]' }), scene, { Place: ['[[Tourney]]'] }, 'Place', [named])?.path).toBe(named.path);
    });
    it('does not substitute another place if the first is missing', () => {
        expect(panelPlaceImage(app, scene, { Place: ['[[Missing]]', '[[Tourney]]'] }, 'Place')).toBeNull();
    });
});
