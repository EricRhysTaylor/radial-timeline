import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { TFile, type App } from 'obsidian';
import { imageSubjectName, stableStoryImage } from './storyImageMatching';

/** Where a card's place image came from: chosen on the card, the Place note's Image, or a picture named after the place. */
export type PlaceImageSource = 'card' | 'note' | 'named';
export type PanelPlaceImage = { url: string; path: string; source: PlaceImageSource; name: string };

function linkPath(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim() || null;
}

const isImage = (file: TFile) => /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension);

/**
 * A scene's place image: the one chosen on its card, else its first Place note's Image, else a picture named after
 * that place (numbered copies spread across scenes). A scene's own properties never set it (2026-11-10: pictures belong
 * to people and places, and a card's own choice to the card). `name` is the place, or the chosen file.
 */
export function panelPlaceImage(app: App, scene: TFile, fm: Record<string, unknown> | undefined, placeKey: string, imageFiles?: readonly TFile[], chosenPath?: string): PanelPlaceImage | null {
    const selected = chosenPath ? app.vault.getAbstractFileByPath(chosenPath) : null;
    if (selected instanceof TFile && isImage(selected)) return { url: app.vault.getResourcePath(selected), path: selected.path, source: 'card', name: selected.name };
    const places = readFrontmatterProperty(fm, placeKey);
    const placePath = linkPath(Array.isArray(places) ? places[0] : places);
    const place = placePath ? app.metadataCache.getFirstLinkpathDest(placePath, scene.path) : null;
    const ownPath = place ? linkPath(readFrontmatterProperty(app.metadataCache.getFileCache(place)?.frontmatter, 'Image')) : null;
    const own = place && ownPath ? app.metadataCache.getFirstLinkpathDest(ownPath, place.path) : null;
    if (place && own && isImage(own)) return { url: app.vault.getResourcePath(own), path: own.path, source: 'note', name: place.basename };
    const subject = imageSubjectName(placePath);
    const named = subject && imageFiles ? stableStoryImage(imageFiles, scene.path, subject) : null;
    return named ? { url: app.vault.getResourcePath(named), path: named.path, source: 'named', name: subject! } : null;
}
