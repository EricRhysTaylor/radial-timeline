import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { resolveStoryPortrait, storyPortraitSource } from './storyPortrait';
import { storyCharacterSelections } from './storyImageSelection';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type RadialTimelinePlugin from '../main';

const file = (path: string): TFile => { const name = path.split('/').pop()!; const i = name.lastIndexOf('.'); return { path, name, basename: name.slice(0, i), extension: name.slice(i + 1) } as TFile; };
const scene = file('Book/1 Scene.md'), first = file('Art/Narrator.png'), character = file('People/Guest.md'), explicit = file('Art/Other Portrait.png');
const fm: Record<string, Record<string, unknown>> = { [scene.path]: { Class: 'Scene', Act: 1, Character: ['[[Narrator]]', '[[People/Guest|Guest]]'] }, [character.path]: { Image: '[[Art/Other Portrait.png]]' } };
const app = {
    vault: { getMarkdownFiles: () => [scene] },
    metadataCache: {
        getFileCache: (f: TFile) => ({ frontmatter: fm[f.path] }),
        getFirstLinkpathDest: (path: string) => path === 'People/Guest' ? character : path === 'Art/Other Portrait.png' ? explicit : null,
    },
} as unknown as App;
const plugin = { app, settings: { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] } } as unknown as RadialTimelinePlugin;

describe('character portraits', () => {
    it('uses an Image property even when the portrait filename differs from the character', () => {
        expect(resolveStoryPortrait(app, scene.path, '[[People/Guest|Guest]]', [first, explicit])).toBe(explicit);
    });
    it('includes that character in the second-character strategy', () => {
        expect(storyCharacterSelections(plugin, [first, explicit], 'second').get(scene.path)).toBe('Guest');
    });
    it('falls back to the matching image if the character note has no Image', () => {
        expect(resolveStoryPortrait(app, scene.path, 'Narrator', [first, explicit])).toBe(first);
    });
    it('says where each portrait came from, for the card menu', () => {
        expect(storyPortraitSource(app, scene.path, '[[People/Guest|Guest]]', [first, explicit])).toEqual({ file: explicit, source: 'note' });
        expect(storyPortraitSource(app, scene.path, 'Narrator', [first, explicit])).toEqual({ file: first, source: 'named' });
        expect(storyPortraitSource(app, scene.path, 'Nobody', [first, explicit])).toBeNull();
    });
});
