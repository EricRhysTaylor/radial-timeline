import type { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getBookIdForPath } from '../utils/books';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { authorKeyFor } from './timetableFiles';
import { buildTableRow } from './timetableModel';
import { chooseImageSubject, imageSubjectName, type StoryImageStrategy } from './storyImageMatching';
import { resolveStoryPortrait } from './storyPortrait';

/** Build choices for complete books, independent of the active Bases filter. */
export function storyCharacterSelections(plugin: RadialTimelinePlugin, images: readonly TFile[], strategy: StoryImageStrategy, bookIds?: ReadonlySet<string>): Map<string, string> {
    const { app, settings } = plugin;
    const books = new Map<string, Array<{ path: string; act: number; prefix: string; names: string[]; links: string[] }>>();
    for (const file of app.vault.getMarkdownFiles()) {
        const book = getBookIdForPath(settings.books, file.path);
        if (!book || (bookIds && !bookIds.has(book))) continue;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        const row = buildTableRow(file.path, file.basename, fm, settings);
        if (row.kind !== 'scene') continue;
        const raw = readFrontmatterProperty(fm, authorKeyFor('Character', settings));
        const links = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string' && !!imageSubjectName(value));
        const names = links.map(imageSubjectName).filter((name): name is string => !!name);
        const group = books.get(book) ?? []; // SAFE: a book's first scene starts its list
        group.push({ path: file.path, act: row.act ?? 0, prefix: row.prefix ?? '', names, links }); // SAFE: a row without an act or number sorts before the numbered ones
        books.set(book, group);
    }
    const result = new Map<string, string>();
    for (const scenes of books.values()) {
        const counts = new Map<string, number>();
        for (const scene of scenes) for (const key of new Set(scene.names.map(name => name.normalize('NFC').toLocaleLowerCase()))) counts.set(key, (counts.get(key) ?? 0) + 1); // SAFE: a name not counted yet counts from zero
        scenes.sort((a, b) => a.act - b.act || a.prefix.localeCompare(b.prefix, undefined, { numeric: true }) || a.path.localeCompare(b.path));
        let previous: string | null = null;
        for (const scene of scenes) {
            const candidates = scene.names.filter((name, index) => !!resolveStoryPortrait(app, scene.path, scene.links[index], images));
            // In this project the POV character is the first entry in Character.
            const selected = chooseImageSubject(candidates, strategy, counts, scene.names[0] ?? null, previous, scene.names[1] ?? null);
            if (selected) { result.set(scene.path, selected); previous = selected; }
        }
    }
    return result;
}
