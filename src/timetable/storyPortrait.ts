import type { App, TFile } from 'obsidian';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { imageSubjectName, stableStoryImage } from './storyImageMatching';

/** Resolve a character note's explicit Image override or a matching filename. */
export function resolveStoryPortrait(app: App, scenePath: string, characterLink: string, images: readonly TFile[]): TFile | null {
    const path = characterLink.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim();
    const character = path ? app.metadataCache.getFirstLinkpathDest(path, scenePath) : null;
    const value = character ? readFrontmatterProperty(app.metadataCache.getFileCache(character)?.frontmatter, 'Image') : null;
    if (character && typeof value === 'string') {
        const link = value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
        const image = app.metadataCache.getFirstLinkpathDest(link, character.path);
        if (image && /^(png|jpe?g|gif|webp|avif)$/i.test(image.extension)) return image;
    }
    const subject = imageSubjectName(characterLink);
    return subject ? stableStoryImage(images, scenePath, subject) : null;
}
