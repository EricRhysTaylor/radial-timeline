import type { App, TFile } from 'obsidian';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { imageSubjectName, stableStoryImage } from './storyImageMatching';

/** A character's portrait and where it came from: the character note's Image, or a picture named after the character. */
export interface StoryPortrait { file: TFile; source: 'note' | 'named' }

export function storyPortraitSource(app: App, scenePath: string, characterLink: string, images: readonly TFile[]): StoryPortrait | null {
    const path = characterLink.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim();
    const character = path ? app.metadataCache.getFirstLinkpathDest(path, scenePath) : null;
    const value = character ? readFrontmatterProperty(app.metadataCache.getFileCache(character)?.frontmatter, 'Image') : null;
    if (character && typeof value === 'string') {
        const link = value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
        const image = app.metadataCache.getFirstLinkpathDest(link, character.path);
        if (image && /^(png|jpe?g|gif|webp|avif)$/i.test(image.extension)) return { file: image, source: 'note' };
    }
    const subject = imageSubjectName(characterLink);
    const named = subject ? stableStoryImage(images, scenePath, subject) : null;
    return named ? { file: named, source: 'named' } : null;
}

/** Resolve a character note's explicit Image override or a matching filename. */
export function resolveStoryPortrait(app: App, scenePath: string, characterLink: string, images: readonly TFile[]): TFile | null {
    return storyPortraitSource(app, scenePath, characterLink, images)?.file ?? null;
}
