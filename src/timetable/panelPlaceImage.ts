import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { TFile, type App } from 'obsidian';
import { imageSubjectName, stableStoryImage } from './storyImageMatching';


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

/** Resolve a scene-specific image first, then the first Place note's Image, then a file named after the place. */
export function panelPlaceImage(app: App, scene: TFile, fm: Record<string, unknown> | undefined, placeKey: string, imageFiles?: readonly TFile[], chosenPath?: string): { url: string; path: string; source: 'scene' | 'place'; name: string } | null {
    const image = (value: unknown, sourcePath: string): TFile | null => {
        const path = linkPath(value);
        const file = path ? app.metadataCache.getFirstLinkpathDest(path, sourcePath) : null;
        return file && /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension) ? file : null;
    };
    const selected = chosenPath ? app.vault.getAbstractFileByPath(chosenPath) : null;
    if (selected instanceof TFile && /^(png|jpe?g|gif|webp|avif)$/i.test(selected.extension)) return { url: app.vault.getResourcePath(selected), path: selected.path, source: 'scene', name: selected.name };
    const override = image(readFrontmatterProperty(fm, 'Place image'), scene.path);
    if (override) return { url: app.vault.getResourcePath(override), path: override.path, source: 'scene', name: override.name };
    const places = readFrontmatterProperty(fm, placeKey);
    const placePath = linkPath(Array.isArray(places) ? places[0] : places);
    const place = placePath ? app.metadataCache.getFirstLinkpathDest(placePath, scene.path) : null;
    const own = place ? image(readFrontmatterProperty(app.metadataCache.getFileCache(place)?.frontmatter, 'Image'), place.path) : null;
    if (place && own) return { url: app.vault.getResourcePath(own), path: own.path, source: 'place', name: place.basename };
    const subject = imageSubjectName(placePath);
    const named = subject && imageFiles ? stableStoryImage(imageFiles, scene.path, subject) : null;
    return named ? { url: app.vault.getResourcePath(named), path: named.path, source: 'place', name: subject! } : null;
}
