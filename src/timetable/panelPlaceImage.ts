import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import type { App, TFile } from 'obsidian';
import { imageSubjectName, stableStoryImage } from './storyImageMatching';

export type PanelImage = { url: string; path: string };

/** Prefer a place for the background, while still showing available art when it is missing. */
export function combinedPanelImage(place: PanelImage | null, character: PanelImage | null, artwork: PanelImage | null): { kind: 'place' | 'character' | 'artwork'; image: PanelImage } | null {
    if (place) return { kind: 'place', image: place };
    if (character) return { kind: 'character', image: character };
    return artwork ? { kind: 'artwork', image: artwork } : null;
}

function linkPath(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim() || null;
}

/** Resolve optional scene artwork independently of the scene's place image. */
export function panelSceneImage(app: App, scene: TFile, fm: Record<string, unknown> | undefined): { url: string; path: string; name: string } | null {
    const path = linkPath(readFrontmatterProperty(fm, 'Scene image'));
    const file = path ? app.metadataCache.getFirstLinkpathDest(path, scene.path) : null;
    if (!file || !/^(png|jpe?g|gif|webp|avif)$/i.test(file.extension)) return null;
    return { url: app.vault.getResourcePath(file), path: file.path, name: file.name };
}

/** Resolve a scene-specific image first, then the first Place note's Image. */
export function panelPlaceImage(app: App, scene: TFile, fm: Record<string, unknown> | undefined, placeKey: string, imageFiles?: readonly TFile[]): { url: string; path: string; source: 'scene' | 'place'; name: string } | null {
    const image = (value: unknown, sourcePath: string): TFile | null => {
        const path = linkPath(value);
        const file = path ? app.metadataCache.getFirstLinkpathDest(path, sourcePath) : null;
        return file && /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension) ? file : null;
    };
    const override = image(readFrontmatterProperty(fm, 'Place image'), scene.path);
    if (override) return { url: app.vault.getResourcePath(override), path: override.path, source: 'scene', name: override.name };
    const places = readFrontmatterProperty(fm, placeKey);
    const placePath = linkPath(Array.isArray(places) ? places[0] : places);
    const subject = imageSubjectName(placePath);
    const named = subject && imageFiles ? stableStoryImage(imageFiles, scene.path, subject) : null;
    if (named) return { url: app.vault.getResourcePath(named), path: named.path, source: 'place', name: subject! };
    const place = placePath ? app.metadataCache.getFirstLinkpathDest(placePath, scene.path) : null;
    if (!place) return null;
    const fallback = image(readFrontmatterProperty(app.metadataCache.getFileCache(place)?.frontmatter, 'Image'), place.path);
    return fallback ? { url: app.vault.getResourcePath(fallback), path: fallback.path, source: 'place', name: place.basename } : null;
}
