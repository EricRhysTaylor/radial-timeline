import type { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getBookIdForPath } from '../utils/books';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { authorKeyFor } from './timetableFiles';
import { buildTableRow } from './timetableModel';
import { chooseImageSubject, imageSubjectName, matchingStoryImages, type StoryImageStrategy } from './storyImageMatching';

/** Build choices for complete books, independent of the active Bases filter. */
export function storyCharacterSelections(plugin: RadialTimelinePlugin, images: readonly TFile[], strategy: StoryImageStrategy, bookIds?: ReadonlySet<string>): Map<string, string> {
    const { app, settings } = plugin;
    const books = new Map<string, Array<{ path: string; act: number; prefix: string; names: string[] }>>();
    for (const file of app.vault.getMarkdownFiles()) {
        const book = getBookIdForPath(settings.books, file.path);
        if (!book || (bookIds && !bookIds.has(book))) continue;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        const row = buildTableRow(file.path, file.basename, fm, settings);
        if (row.kind !== 'scene') continue;
        const raw = readFrontmatterProperty(fm, authorKeyFor('Character', settings));
        const names = (Array.isArray(raw) ? raw : [raw]).map(imageSubjectName).filter((name): name is string => !!name);
        const group = books.get(book) ?? [];
        group.push({ path: file.path, act: row.act ?? 0, prefix: row.prefix ?? '', names });
        books.set(book, group);
    }
    const result = new Map<string, string>();
    for (const scenes of books.values()) {
        const counts = new Map<string, number>();
        for (const scene of scenes) for (const key of new Set(scene.names.map(name => name.normalize('NFC').toLocaleLowerCase()))) counts.set(key, (counts.get(key) ?? 0) + 1);
        scenes.sort((a, b) => a.act - b.act || a.prefix.localeCompare(b.prefix, undefined, { numeric: true }) || a.path.localeCompare(b.path));
        let previous: string | null = null;
        for (const scene of scenes) {
            const candidates = scene.names.filter(name => matchingStoryImages(images, name).length > 0);
            // In this project the POV character is the first entry in Character.
            const selected = chooseImageSubject(candidates, strategy, counts, scene.names[0] ?? null, previous, scene.names[1] ?? null);
            if (selected) { result.set(scene.path, selected); previous = selected; }
        }
    }
    return result;
}
