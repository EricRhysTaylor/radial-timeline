import { safeTitle } from '../utils/noteTitle';

/** Imported Story Vaults keep their maps inside their own demo folder. */
export function storyMapFolder(sourceFolder: string): string {
    const parts = sourceFolder.split('/');
    return parts[0] === 'Demo Projects' && parts.length >= 3
        ? `${parts[0]}/${parts[1]}/Radial Timeline/Story Maps`
        : 'Radial Timeline/Story Maps';
}

export function storyMapPrefix(book: { title: string; sourceFolder: string }): string {
    return `${storyMapFolder(book.sourceFolder)}/${safeTitle(book.title) || 'Book'} - Subplot Map`;
}

export function isStoryMapPath(path: string): boolean {
    return path.endsWith('.canvas') && (path.startsWith('Radial Timeline/Story Maps/')
        || /^Demo Projects\/[^/]+\/Radial Timeline\/Story Maps\//.test(path));
}
