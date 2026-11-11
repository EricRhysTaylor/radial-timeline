import type { Menu } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { RadialTimelineSettings } from '../types/settings';
import { t } from '../i18n';
import { getOpenDocuments } from '../utils/documents';
import { addMenuChoices } from './menuChoices';
import { validPanelFocus, type PanelFocus } from './panelFocus';

/**
 * How story cards show their images, the same in Timetable Panels and on a Canvas (Eric, 2026-11-10: one setting for
 * both views). Kept once in plugin settings; each image's crop focus is kept once too, by image path, so both views
 * crop an image alike. A Timetable view's older copies of these settings are adopted once (adoptViewImageSettings).
 */
export type StoryImageCombination = 'character' | 'place' | 'combined' | 'layered' | 'none';
export type PlaceTextBacking = 'subtle' | 'balanced' | 'strong';
export type StoryImageFit = 'fill' | 'fit';
export type PortraitShape = 'square' | 'landscape';
export type StoryImageStrategy = NonNullable<RadialTimelineSettings['storyImageStrategy']>;
export interface StoryCardImages { combination: StoryImageCombination; backing: PlaceTextBacking; fit: StoryImageFit; portraitShape: PortraitShape }

const COMBINATIONS: readonly StoryImageCombination[] = ['character', 'place', 'combined', 'layered', 'none'];
const BACKINGS: readonly PlaceTextBacking[] = ['subtle', 'balanced', 'strong'];
const FITS: readonly StoryImageFit[] = ['fill', 'fit'];
const SHAPES: readonly PortraitShape[] = ['square', 'landscape'];
const STRATEGIES: readonly StoryImageStrategy[] = ['distinctive', 'first', 'second', 'pov', 'balanced'];
const DEFAULTS: StoryCardImages = { combination: 'character', backing: 'balanced', fit: 'fill', portraitShape: 'square' };

/** Card views redraw on this event: a card setting, the character strategy, a card's own choices or a focus point changed. */
export const STORY_IMAGES_CHANGED_EVENT = 'rt-story-images-changed';

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : undefined;

export function storyCardImages(settings: RadialTimelineSettings): StoryCardImages {
    const saved = settings.storyCardImages ?? {}; // SAFE: settings saved before card image choices hold none
    return {
        combination: oneOf(saved.combination, COMBINATIONS) ?? DEFAULTS.combination,
        backing: oneOf(saved.backing, BACKINGS) ?? DEFAULTS.backing,
        fit: oneOf(saved.fit, FITS) ?? DEFAULTS.fit,
        portraitShape: oneOf(saved.portraitShape, SHAPES) ?? DEFAULTS.portraitShape,
    };
}

export function storyImageStrategy(settings: RadialTimelineSettings): StoryImageStrategy {
    return oneOf(settings.storyImageStrategy, STRATEGIES) ?? 'distinctive'; // SAFE: an unset or unknown strategy is Most distinctive, the default
}

/** Tell every open card view to redraw. */
export function notifyStoryImagesChanged(plugin: RadialTimelinePlugin): void {
    for (const doc of getOpenDocuments(plugin.app.workspace)) doc.defaultView?.dispatchEvent(new Event(STORY_IMAGES_CHANGED_EVENT));
}

export async function saveStoryCardImages(plugin: RadialTimelinePlugin, change: Partial<StoryCardImages>): Promise<void> {
    plugin.settings.storyCardImages = { ...storyCardImages(plugin.settings), ...change };
    await plugin.saveSettings();
    notifyStoryImagesChanged(plugin);
}

export async function saveStoryImageStrategy(plugin: RadialTimelinePlugin, strategy: StoryImageStrategy): Promise<void> {
    plugin.settings.storyImageStrategy = strategy;
    await plugin.saveSettings();
    notifyStoryImagesChanged(plugin);
}

/** Where an image's crop centers, in every card view. */
export function storyImageFocus(settings: RadialTimelineSettings, path: string | undefined): PanelFocus {
    return validPanelFocus(path ? settings.storyImageFocus?.[path] : null);
}

export async function saveStoryImageFocus(plugin: RadialTimelinePlugin, path: string, focus: PanelFocus): Promise<void> {
    plugin.settings.storyImageFocus = { ...plugin.settings.storyImageFocus, [path]: validPanelFocus(focus) };
    await plugin.saveSettings();
    notifyStoryImagesChanged(plugin);
}

/** Focus points follow a renamed image or folder; a focus already saved at the new path is kept. */
export function rebaseStoryImageFocus(focus: Record<string, PanelFocus>, oldPath: string, newPath: string): Record<string, PanelFocus> {
    const result: Record<string, PanelFocus> = {};
    for (const [path, point] of Object.entries(focus)) {
        const target = path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
        if (target !== path && focus[target]) { result[path] = point; continue; }
        result[target] = point;
    }
    return result;
}

/** The view settings a Timetable kept before these moved to plugin settings. */
export interface LegacyViewImageConfig { get(key: string): unknown; set(key: string, value: unknown): void }
const LEGACY_KEYS = { combination: 'panelImage', backing: 'placeTextBacking', fit: 'panelFit', portraitShape: 'portraitShape' } as const;

/**
 * Adopt a Timetable view's older image settings once, then clear them from the view, so the plugin setting is the
 * only copy. The first view to carry them sets the card settings; every view's focus points join the shared map,
 * without replacing one already saved. Returns whether anything changed.
 */
export async function adoptViewImageSettings(plugin: RadialTimelinePlugin, config: LegacyViewImageConfig): Promise<boolean> {
    const keys = [...Object.values(LEGACY_KEYS), 'panelFocus'];
    if (!keys.some(key => config.get(key) !== undefined && config.get(key) !== null)) return false;
    if (!plugin.settings.storyCardImages) {
        const legacy: Partial<StoryCardImages> = {};
        const combination = oneOf(config.get(LEGACY_KEYS.combination), COMBINATIONS);
        const backing = oneOf(config.get(LEGACY_KEYS.backing), BACKINGS);
        const fit = oneOf(config.get(LEGACY_KEYS.fit), FITS);
        const portraitShape = oneOf(config.get(LEGACY_KEYS.portraitShape), SHAPES);
        if (combination) legacy.combination = combination;
        if (backing) legacy.backing = backing;
        if (fit) legacy.fit = fit;
        if (portraitShape) legacy.portraitShape = portraitShape;
        plugin.settings.storyCardImages = { ...DEFAULTS, ...legacy };
    }
    const focus = config.get('panelFocus');
    if (focus && typeof focus === 'object' && !Array.isArray(focus)) {
        const merged = { ...plugin.settings.storyImageFocus };
        for (const [path, point] of Object.entries(focus as Record<string, unknown>)) {
            if (!merged[path]) merged[path] = validPanelFocus(point);
        }
        plugin.settings.storyImageFocus = merged;
    }
    await plugin.saveSettings();
    for (const key of keys) config.set(key, null);
    return true;
}

/**
 * The image groups of a card display menu, shared by the Timetable Panels menu and the Canvas card menu, so the two
 * read alike: Image combinations, Background treatment (with a place background), Character selection, Image sizing
 * and Portrait shape.
 */
export function addStoryCardImageMenu(menu: Menu, plugin: RadialTimelinePlugin): void {
    const images = storyCardImages(plugin.settings);
    const save = (change: Partial<StoryCardImages>) => () => { void saveStoryCardImages(plugin, change); };
    addMenuChoices(menu, t('ui.timetable.imageCombinations'), combinationChoices().map(([value, label]) => ({ label, checked: images.combination === value, run: save({ combination: value }) })));
    if (images.combination === 'layered') {
        addMenuChoices(menu, t('ui.timetable.backgroundTreatment'), backingChoices().map(([value, label]) => ({ label, checked: images.backing === value, run: save({ backing: value }) })));
    }
    const strategy = storyImageStrategy(plugin.settings);
    addMenuChoices(menu, t('ui.timetable.storyImageStrategy'), strategyChoices().map(([value, label]) => ({
        label, checked: strategy === value, run: () => { void saveStoryImageStrategy(plugin, value); },
    })));
    addMenuChoices(menu, t('ui.timetable.panelFit'), fitChoices().map(([value, label]) => ({ label, checked: images.fit === value, run: save({ fit: value }) })));
    addMenuChoices(menu, t('ui.timetable.portraitShape'), shapeChoices().map(([value, label]) => ({ label, checked: images.portraitShape === value, run: save({ portraitShape: value }) })));
}

export const combinationChoices = (): Array<[StoryImageCombination, string]> => [
    ['character', t('ui.timetable.panelImageCharacter')], ['place', t('ui.timetable.panelImagePlace')], ['combined', t('ui.timetable.panelImageCombined')],
    ['layered', t('ui.timetable.panelImageLayered')], ['none', t('ui.timetable.panelImageNone')],
];
export const backingChoices = (): Array<[PlaceTextBacking, string]> => [
    ['subtle', t('ui.timetable.placeTextSubtle')], ['balanced', t('ui.timetable.placeTextBalanced')], ['strong', t('ui.timetable.placeTextStrong')],
];
export const strategyChoices = (): Array<[StoryImageStrategy, string]> => [
    ['distinctive', t('ui.timetable.storyImageDistinctive')], ['first', t('ui.timetable.storyImageFirst')], ['second', t('ui.timetable.storyImageSecond')],
    ['pov', t('ui.timetable.storyImagePov')], ['balanced', t('ui.timetable.storyImageBalanced')],
];
export const fitChoices = (): Array<[StoryImageFit, string]> => [['fill', t('ui.timetable.panelFitFill')], ['fit', t('ui.timetable.panelFitFit')]];
export const shapeChoices = (): Array<[PortraitShape, string]> => [['square', t('ui.timetable.portraitSquare')], ['landscape', t('ui.timetable.portraitLandscape')]];

/** One image a card can show. A character portrait found only by its lead may have no path, so it takes no focus. */
export interface CardImage { url: string; path?: string }
export interface CardImageSources {
    character: CardImage | null;
    place: CardImage | null;
    /** The scene names characters, so a missing portrait still gets its placeholder. */
    hasCharacters: boolean;
    /** The card image was chosen on the card ("Choose card image…"). */
    chosen: boolean;
}
export interface CardImages {
    /** The card's main tile. */
    cover: CardImage | null;
    /** A second tile beside the cover, the same size: the character next to its place in Place + character. */
    companion: CardImage | null;
    /** A place filling the card behind its text, in Place background + character. */
    backdrop: CardImage | null;
    /** Whether the card shows a cover tile at all (with a placeholder when its image is missing). */
    showCover: boolean;
    placeholderIcon: string;
}

/**
 * Which images a card shows, one rule for Panels and Canvas. A scene shows its combination; a sketch shows an image
 * only when one is given for it: a place chosen for it (the caller passes no place otherwise) or a portrait chosen on
 * it. Place + character shows the place and the character side by side, and with only one of them, that one.
 */
export function cardImages(combination: StoryImageCombination, kind: 'scene' | 'sketch', sources: CardImageSources): CardImages {
    const { character, place, hasCharacters, chosen } = sources;
    const none: CardImages = { cover: null, companion: null, backdrop: null, showCover: false, placeholderIcon: 'file-text' };
    if (combination === 'none') return none;
    const placeholderIcon = combination === 'place' || combination === 'combined' ? 'map-pin' : 'user-round';
    if (kind === 'sketch') {
        const cover = combination === 'place' ? place
            : combination === 'combined' ? place ?? character ?? null
                : chosen ? character : null;
        const companion = combination === 'combined' && place && character ? character : null;
        return { cover, companion, backdrop: null, showCover: !!cover, placeholderIcon };
    }
    switch (combination) {
        case 'place': return { cover: place, companion: null, backdrop: null, showCover: true, placeholderIcon };
        case 'combined': return { cover: place ?? character, companion: place && character ? character : null, backdrop: null, showCover: true, placeholderIcon };
        case 'layered': return { cover: character, companion: null, backdrop: place, showCover: !!character || hasCharacters, placeholderIcon };
        case 'character': return { cover: character, companion: null, backdrop: null, showCover: !!character || hasCharacters, placeholderIcon };
    }
}
