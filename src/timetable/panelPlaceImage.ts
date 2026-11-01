import type { App, TFile } from 'obsidian';

const key = (fm: Record<string, unknown> | undefined, name: string): unknown => {
    const found = Object.keys(fm ?? {}).find(item => item.toLowerCase() === name.toLowerCase());
    return found ? fm?.[found] : undefined;
};

function linkPath(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim() || null;
}

/** Resolve optional scene artwork independently of the scene's place image. */
export function panelSceneImage(app: App, scene: TFile, fm: Record<string, unknown> | undefined): { url: string; path: string; name: string } | null {
    const path = linkPath(key(fm, 'Scene image'));
    const file = path ? app.metadataCache.getFirstLinkpathDest(path, scene.path) : null;
    if (!file || !/^(png|jpe?g|gif|webp|avif)$/i.test(file.extension)) return null;
    return { url: app.vault.getResourcePath(file), path: file.path, name: file.name };
}

/** Resolve a scene-specific image first, then the first Place note's Image. */
export function panelPlaceImage(app: App, scene: TFile, fm: Record<string, unknown> | undefined, placeKey: string): { url: string; path: string; source: 'scene' | 'place'; name: string } | null {
    const image = (value: unknown, sourcePath: string): TFile | null => {
        const path = linkPath(value);
        const file = path ? app.metadataCache.getFirstLinkpathDest(path, sourcePath) : null;
        return file && /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension) ? file : null;
    };
    const override = image(key(fm, 'Place image'), scene.path);
    if (override) return { url: app.vault.getResourcePath(override), path: override.path, source: 'scene', name: override.name };
    const places = key(fm, placeKey);
    const placePath = linkPath(Array.isArray(places) ? places[0] : places);
    const place = placePath ? app.metadataCache.getFirstLinkpathDest(placePath, scene.path) : null;
    if (!place) return null;
    const fallback = image(key(app.metadataCache.getFileCache(place)?.frontmatter, 'Image'), place.path);
    return fallback ? { url: app.vault.getResourcePath(fallback), path: fallback.path, source: 'place', name: place.basename } : null;
}
