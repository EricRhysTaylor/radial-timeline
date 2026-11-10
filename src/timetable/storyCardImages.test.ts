import { describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { RadialTimelineSettings } from '../types/settings';
import { addStoryCardImageMenu, adoptViewImageSettings, cardImages, rebaseStoryImageFocus, storyCardImages, storyImageFocus, type CardImageSources } from './storyCardImages';

const place = { url: 'place-url', path: 'Images/Longbourn.webp' };
const character = { url: 'character-url', path: 'Images/Elizabeth.webp' };
const artwork = { url: 'art-url', path: 'Images/Ball.webp' };
const sources = (over: Partial<CardImageSources> = {}): CardImageSources => ({ character, place, artwork, hasCharacters: true, chosen: false, ...over });

describe('the images a card shows, one rule for Panels and Canvas', () => {
    it('shows each combination for a scene', () => {
        expect(cardImages('character', 'scene', sources())).toMatchObject({ cover: character, companion: null, backdrop: null, showCover: true });
        expect(cardImages('place', 'scene', sources())).toMatchObject({ cover: place, companion: null, showCover: true, placeholderIcon: 'map-pin' });
        expect(cardImages('layered', 'scene', sources())).toMatchObject({ cover: character, backdrop: place });
        expect(cardImages('artwork', 'scene', sources())).toMatchObject({ cover: artwork, placeholderIcon: 'image' });
    });
    it('puts the character beside its place in Place + character, the same size, and falls back when one is missing', () => {
        expect(cardImages('combined', 'scene', sources())).toMatchObject({ cover: place, companion: character });
        expect(cardImages('combined', 'scene', sources({ place: null }))).toMatchObject({ cover: character, companion: null });
        expect(cardImages('combined', 'scene', sources({ place: null, character: null }))).toMatchObject({ cover: artwork, companion: null });
        expect(cardImages('combined', 'scene', sources({ place: null, character: null, artwork: null }))).toMatchObject({ cover: null, showCover: true, placeholderIcon: 'map-pin' });
    });
    it('shows no tile at all with None, so the title starts at the edge', () => {
        expect(cardImages('none', 'scene', sources())).toEqual({ cover: null, companion: null, backdrop: null, showCover: false, placeholderIcon: 'file-text' });
    });
    it('keeps a placeholder for a scene that names characters without a portrait, and none for one that names nobody', () => {
        expect(cardImages('character', 'scene', sources({ character: null }))).toMatchObject({ cover: null, showCover: true, placeholderIcon: 'user-round' });
        expect(cardImages('character', 'scene', sources({ character: null, hasCharacters: false })).showCover).toBe(false);
    });
    it('shows a sketch an image only when one was given for it', () => {
        expect(cardImages('character', 'sketch', sources()).showCover).toBe(false);
        expect(cardImages('character', 'sketch', sources({ chosen: true }))).toMatchObject({ cover: character, showCover: true });
        expect(cardImages('place', 'sketch', sources({ place: null })).showCover).toBe(false);
        expect(cardImages('combined', 'sketch', sources())).toMatchObject({ cover: place, companion: character });
    });
});

const pluginWith = (settings: Partial<RadialTimelineSettings>) => {
    const plugin = { settings: settings as RadialTimelineSettings, saveSettings: vi.fn(async () => {}), app: { workspace: {} } };
    return plugin as unknown as RadialTimelinePlugin & { saveSettings: ReturnType<typeof vi.fn> };
};
const viewConfig = (values: Record<string, unknown>) => ({
    values: { ...values },
    get(key: string) { return this.values[key]; },
    set(key: string, value: unknown) { if (value === null) delete this.values[key]; else this.values[key] = value; },
});

describe('one set of card image settings', () => {
    it('reads defaults, and ignores values it does not know', () => {
        expect(storyCardImages({} as RadialTimelineSettings)).toEqual({ combination: 'character', backing: 'balanced', fit: 'fill', portraitShape: 'square' });
        expect(storyCardImages({ storyCardImages: { combination: 'sideways', fit: 'fit' } } as RadialTimelineSettings)).toMatchObject({ combination: 'character', fit: 'fit' });
    });
    it('adopts a Timetable view\'s own settings once, then clears them from the view', async () => {
        const plugin = pluginWith({});
        const config = viewConfig({ panelImage: 'combined', panelFit: 'fit', portraitShape: 'landscape', panelSize: 'large', panelFocus: { 'Images/Longbourn.webp': { x: 0.2, y: 0.8 } } });
        expect(await adoptViewImageSettings(plugin, config)).toBe(true);
        expect(plugin.settings.storyCardImages).toEqual({ combination: 'combined', backing: 'balanced', fit: 'fit', portraitShape: 'landscape' });
        expect(storyImageFocus(plugin.settings, 'Images/Longbourn.webp')).toEqual({ x: 0.2, y: 0.8 });
        // The panel size is the view's own layout and stays; the image settings now live only in the plugin.
        expect(config.values).toEqual({ panelSize: 'large' });
        expect(await adoptViewImageSettings(plugin, config)).toBe(false);
    });
    it('lets a second Timetable add its focus points without replacing the settings or a saved point', async () => {
        const plugin = pluginWith({ storyCardImages: { combination: 'layered' }, storyImageFocus: { 'Images/Longbourn.webp': { x: 0.1, y: 0.1 } } });
        await adoptViewImageSettings(plugin, viewConfig({ panelImage: 'none', panelFocus: { 'Images/Longbourn.webp': { x: 0.9, y: 0.9 }, 'Images/Pemberley.webp': { x: 0.3, y: 0.4 } } }));
        expect(storyCardImages(plugin.settings).combination).toBe('layered');
        expect(plugin.settings.storyImageFocus).toEqual({ 'Images/Longbourn.webp': { x: 0.1, y: 0.1 }, 'Images/Pemberley.webp': { x: 0.3, y: 0.4 } });
    });
    it('moves focus points with a renamed image or folder', () => {
        const focus = { 'Art/Longbourn.webp': { x: 0.2, y: 0.3 }, 'Art/Places/Pemberley.webp': { x: 0.6, y: 0.5 }, 'Other.webp': { x: 0.5, y: 0.5 } };
        expect(rebaseStoryImageFocus(focus, 'Art', 'Pictures')).toEqual({ 'Pictures/Longbourn.webp': { x: 0.2, y: 0.3 }, 'Pictures/Places/Pemberley.webp': { x: 0.6, y: 0.5 }, 'Other.webp': { x: 0.5, y: 0.5 } });
        expect(rebaseStoryImageFocus(focus, 'Other.webp', 'Art/Longbourn.webp')['Other.webp']).toEqual({ x: 0.5, y: 0.5 });
    });
});

describe('the shared image menu', () => {
    const groups = (settings: Partial<RadialTimelineSettings>) => {
        const items: Array<{ title: string; label: boolean; checked: boolean }> = [];
        const menu = {
            addItem(build: (item: unknown) => void) {
                const entry = { title: '', label: false, checked: false };
                const item = { setTitle: (title: string) => { entry.title = title; return item; }, setIsLabel: (label: boolean) => { entry.label = label; return item; },
                    setChecked: (checked: boolean) => { entry.checked = checked; return item; }, onClick: () => item };
                build(item);
                items.push(entry);
                return menu;
            },
            addSeparator() { return menu; },
        };
        addStoryCardImageMenu(menu as unknown as Menu, pluginWith(settings));
        return items;
    };
    it('labels every group, with all six combinations and Background treatment only with a place background', () => {
        const items = groups({ storyCardImages: { combination: 'combined' } });
        expect(items.filter(item => item.label).map(item => item.title)).toEqual(['Image combinations', 'Character selection', 'Image sizing', 'Portrait shape']);
        expect(items.slice(1, 7).map(item => item.title)).toEqual(['Character', 'Place', 'Place + character', 'Place background + character', 'Scene artwork', 'None']);
        expect(items.find(item => item.checked && item.title === 'Place + character')).toBeDefined();
        expect(groups({ storyCardImages: { combination: 'layered' } }).filter(item => item.label).map(item => item.title)).toContain('Background treatment');
    });
});
