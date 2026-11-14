import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import { rebaseStoryImageChoices, saveStoryImageChoice } from './storyImageStore';

describe('card image settings', () => {
    it('stores and resets choices without writing scene frontmatter', async () => {
        const write = vi.fn(); const save = vi.fn().mockResolvedValue(undefined);
        const plugin = { settings: {}, saveSettings: save, app: { fileManager: { processFrontMatter: write } } } as unknown as RadialTimelinePlugin;
        await saveStoryImageChoice(plugin, 'Book/1.md', { character: 'Guest', image: 'Art/Portrait.png' });
        expect(plugin.settings.storyImageChoices?.['Book/1.md']).toEqual({ character: 'Guest', image: 'Art/Portrait.png' });
        await saveStoryImageChoice(plugin, 'Book/1.md', null);
        expect(plugin.settings.storyImageChoices?.['Book/1.md']).toBeUndefined();
        expect(write).not.toHaveBeenCalled();
    });
    it('preserves choices across note, image and containing-folder renames', () => {
        const choices = { 'Book/1.md': { character: 'Guest', image: 'Art/Portrait.png', placeImage: 'Art/Place.png' } };
        expect(rebaseStoryImageChoices(choices, 'Book', 'Story')['Story/1.md']).toEqual(choices['Book/1.md']);
        expect(rebaseStoryImageChoices(choices, 'Art', 'Images')['Book/1.md'].image).toBe('Images/Portrait.png');
        expect(rebaseStoryImageChoices(choices, 'Art/Place.png', 'Art/Harbor.png')['Book/1.md'].placeImage).toBe('Art/Harbor.png');
    });
    it('keeps a Canvas shade with its scene when the scene is renamed', async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const plugin = { settings: {}, saveSettings: save } as unknown as RadialTimelinePlugin;
        await saveStoryImageChoice(plugin, 'Book/1.md', { canvasBackgroundShade: 'original' });
        expect(rebaseStoryImageChoices(plugin.settings.storyImageChoices!, 'Book/1.md', 'Book/2.md')['Book/2.md']).toEqual({ canvasBackgroundShade: 'original' });
    });
    it('restores settings when saving fails', async () => {
        const original = { 'Book/1.md': { character: 'Old' } };
        const plugin = { settings: { storyImageChoices: original }, saveSettings: vi.fn().mockRejectedValue(new Error('disk')) } as unknown as RadialTimelinePlugin;
        await expect(saveStoryImageChoice(plugin, 'Book/1.md', { character: 'New' })).rejects.toThrow('disk');
        expect(plugin.settings.storyImageChoices).toBe(original);
    });
});
