import { safeTitle } from '../utils/noteTitle';

/** Imported Story Vaults keep their Canvas files inside their own demo folder. */
function radialTimelineFolder(sourceFolder: string): string {
    const parts = sourceFolder.split('/');
    return parts[0] === 'Demo Projects' && parts.length >= 3
        ? `${parts[0]}/${parts[1]}/Radial Timeline`
        : 'Radial Timeline';
}

/** Where new Canvas subplot branches are saved. */
export function storyMapFolder(sourceFolder: string): string {
    return `${radialTimelineFolder(sourceFolder)}/Canvas`;
}

/** New subplot branches: `<Book> - Subplot Branches.canvas`, then ` 2`, ` 3`... */
export function storyMapPrefix(book: { title: string; sourceFolder: string }): string {
    return `${storyMapFolder(book.sourceFolder)}/${safeTitle(book.title) || 'Book'} - Subplot Branches`;
}

/** Files made before 8.2.0 keep their names and are still found: `Story Maps/<Book> - Subplot Map`. */
function legacyStoryMapPrefix(book: { title: string; sourceFolder: string }): string {
    return `${radialTimelineFolder(book.sourceFolder)}/Story Maps/${safeTitle(book.title) || 'Book'} - Subplot Map`;
}

export function isStoryMapPath(path: string): boolean {
    return path.endsWith('.canvas') && /^(?:Demo Projects\/[^/]+\/)?Radial Timeline\/(?:Canvas|Story Maps)\//.test(path);
}

const bookPrefixes = (book: { title: string; sourceFolder: string }): string[] => [storyMapPrefix(book), legacyStoryMapPrefix(book)];

/** A book's generated subplot branches, new and pre-8.2.0 names alike. */
export function bookStoryMaps<T extends { path: string }>(files: readonly T[], book: { title: string; sourceFolder: string }): T[] {
    const prefixes = bookPrefixes(book);
    return files.filter(file => prefixes.some(prefix => file.path === `${prefix}.canvas`
        || (file.path.startsWith(`${prefix} `) && /^\d+\.canvas$/.test(file.path.slice(prefix.length + 1)))));
}

/** The one to open without asking: the only open one, else the first unnumbered one, else the only one. */
export function preferredStoryMap<T extends { path: string }>(candidates: readonly T[], openPaths: ReadonlySet<string | undefined>, book: { title: string; sourceFolder: string }): T | undefined {
    const open = candidates.filter(file => openPaths.has(file.path));
    if (open.length === 1) return open[0];
    for (const prefix of bookPrefixes(book)) {
        const primary = candidates.find(file => file.path === `${prefix}.canvas`);
        if (primary) return primary;
    }
    return candidates.length === 1 ? candidates[0] : undefined;
}
