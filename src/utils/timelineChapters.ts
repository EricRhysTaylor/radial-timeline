import type { TimelineItem } from '../types';
import type { BookProfile, ChapterSource } from '../types/settings';
import { isMatterNote, isSceneItem, sortScenes } from './sceneHelpers';

export const SHARED_CHAPTER_FIELD_KEY = 'Chapter';
export const SHARED_CHAPTER_FIELD_SOURCE_LABEL_TITLE = 'Chapter field on scene notes';
export interface TimelineChapterMarker {
    sourcePath?: string;
    sourceType: 'Scene';
    title: string;
    resolvedScenePath: string;
    resolvedTimelinePosition: number;
}

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[\s_-]/g, '');
}

export function readSharedChapterTitle(frontmatter?: Record<string, unknown>): string | undefined {
    if (!frontmatter) return undefined;

    for (const [key, value] of Object.entries(frontmatter)) {
        if (normalizeKey(key) !== 'chapter') continue;
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
}

/*
 * Chapters: the one resolver.
 * ---------------------------
 * Every surface that shows chapters (the timeline's C markers, Publish, the
 * Set chapter modal, Writing Studio, Timetable) resolves them here, from
 * scenes already in manuscript order (the timeline's narrative sort, never
 * File Explorer's) and the book's Chapter source.
 *
 * Property source: a `Chapter` value opens a chapter, and the scenes after it
 * continue in that chapter until the next marker. The same title on the next
 * marker continues the chapter instead of opening another, as Publishing has
 * always documented ("first occurrence wins").
 *
 * Folder source: the folder `depth` levels under the book's folder is the
 * chapter and its name the title. A heading appears whenever the ordered
 * scenes enter a different chapter folder; a folder entered a second time
 * opens its chapter again and both runs are flagged `split`, so the author can
 * fix the scene order or the folder. Scene order is never changed to keep a
 * folder together.
 *
 * Scenes before the first chapter, or outside any chapter folder, belong to
 * no chapter and stay readable in their place.
 */

/** The parts of a scene the resolver reads. */
export interface ChapterScene {
    path: string;
    rawFrontmatter?: Record<string, unknown>;
    /** The scene's own book folder, when scenes of several books are resolved together. */
    bookSourceFolder?: string;
}

export interface ChapterContext {
    source: ChapterSource;
    /** The book's manuscript folder, which folder depth counts from. */
    bookFolder: string;
}

export const PROPERTY_CHAPTER_CONTEXT: ChapterContext = { source: { kind: 'property' }, bookFolder: '' };

export interface ResolvedChapter {
    index: number;
    title: string;
    /** The chapter's scenes, in manuscript order. */
    scenePaths: string[];
    /** Folder source: the chapter folder's path. Null for the property source. */
    folder: string | null;
    /** Folder source: the folder's scenes are interleaved with another chapter's. */
    split: boolean;
}

export interface ChapterResolution {
    chapters: ResolvedChapter[];
    /** Scene path → chapter index. Scenes in no chapter are absent. */
    chapterOf: Map<string, number>;
}

/** The book's Chapter source; absent means the scene property. */
export function bookChapterContext(book: Partial<Pick<BookProfile, 'sourceFolder' | 'chapterSource'>> | null | undefined): ChapterContext {
    return { source: book?.chapterSource ?? { kind: 'property' }, bookFolder: book?.sourceFolder ?? '' };
}

/**
 * The chapter folder holding a note: the folder `depth` levels under the
 * book's folder, or null when the note sits shallower than that or outside
 * the book.
 */
export function chapterFolderOf(path: string, bookFolder: string, depth: number): { folder: string; title: string } | null {
    const prefix = bookFolder.replace(/\/+$/, '');
    if (prefix && !path.startsWith(`${prefix}/`)) return null;
    const relative = prefix ? path.slice(prefix.length + 1) : path;
    const folders = relative.split('/').slice(0, -1);
    if (depth < 1 || folders.length < depth) return null;
    const own = folders.slice(0, depth);
    return { folder: prefix ? `${prefix}/${own.join('/')}` : own.join('/'), title: own[depth - 1] };
}

/** The deepest folder level offered as a Chapter source. */
const MAX_CHAPTER_FOLDER_DEPTH = 3;

/**
 * The folder names at each level under the book's folder that holds scenes,
 * level 1 first, in the order the scenes meet them. Stops at the first level
 * with no folders.
 */
export function chapterFolderLevels(scenePaths: string[], bookFolder: string): string[][] {
    const levels: string[][] = [];
    for (let depth = 1; depth <= MAX_CHAPTER_FOLDER_DEPTH; depth++) {
        const names: string[] = [];
        for (const path of scenePaths) {
            const found = chapterFolderOf(path, bookFolder, depth);
            if (found && !names.includes(found.title)) names.push(found.title);
        }
        if (names.length === 0) break;
        levels.push(names);
    }
    return levels;
}

/** A Chapter source dropdown value ("property" or "folder:2") as a ChapterSource. */
export function parseChapterSourceOption(value: string): ChapterSource {
    const match = /^folder:(\d+)$/.exec(value);
    return match ? { kind: 'folder', depth: Number(match[1]) } : { kind: 'property' };
}

function sameChapterTitle(a: string, b: string): boolean {
    return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

export function resolveChapters(orderedScenes: ChapterScene[], context: ChapterContext): ChapterResolution {
    const chapters: ResolvedChapter[] = [];
    const chapterOf = new Map<string, number>();
    let current: ResolvedChapter | null = null;
    const open = (title: string, folder: string | null): ResolvedChapter => {
        const chapter: ResolvedChapter = { index: chapters.length, title, scenePaths: [], folder, split: false };
        chapters.push(chapter);
        return chapter;
    };

    for (const scene of orderedScenes) {
        if (context.source.kind === 'property') {
            const title = readSharedChapterTitle(scene.rawFrontmatter);
            if (title && !(current && sameChapterTitle(current.title, title))) current = open(title, null);
        } else {
            const found = chapterFolderOf(scene.path, scene.bookSourceFolder ?? context.bookFolder, context.source.depth);
            if (!found) current = null;
            else if (!current || current.folder !== found.folder) {
                const earlier = chapters.filter(chapter => chapter.folder === found.folder);
                current = open(found.title, found.folder);
                if (earlier.length > 0) for (const chapter of [...earlier, current]) chapter.split = true;
            }
        }
        if (current) {
            current.scenePaths.push(scene.path);
            chapterOf.set(scene.path, current.index);
        }
    }
    return { chapters, chapterOf };
}

/**
 * The timeline's chapter markers: one at each chapter's opening scene, its
 * position counted in scenes (1-based).
 */
export function resolveTimelineChapterMarkers(
    orderedItems: TimelineItem[],
    context: ChapterContext = PROPERTY_CHAPTER_CONTEXT
): TimelineChapterMarker[] {
    const scenes = orderedItems.filter((item): item is TimelineItem & { path: string } => isSceneItem(item) && !!item.path);
    const position = new Map(scenes.map((scene, index) => [scene.path, index + 1]));
    return resolveChapters(scenes, context).chapters.map(chapter => {
        const opening = chapter.scenePaths[0];
        return {
            sourcePath: opening,
            sourceType: 'Scene' as const,
            title: chapter.title,
            resolvedScenePath: opening,
            resolvedTimelinePosition: position.get(opening) as number, // SAFE: every chapter scene came from `scenes`
        };
    });
}

export function groupTimelineChapterMarkersByScenePath(
    markers: TimelineChapterMarker[]
): Record<string, TimelineChapterMarker[]> {
    return markers.reduce<Record<string, TimelineChapterMarker[]>>((acc, marker) => {
        if (!acc[marker.resolvedScenePath]) {
            acc[marker.resolvedScenePath] = [];
        }
        acc[marker.resolvedScenePath].push(marker);
        return acc;
    }, {});
}

export function collapseTimelineChapterMarkersByResolvedBoundary(
    markers: TimelineChapterMarker[]
): TimelineChapterMarker[] {
    const lastMarkerByBoundary = new Map<string, TimelineChapterMarker>();

    markers.forEach((marker) => {
        const boundaryKey = `${marker.resolvedScenePath}::${marker.resolvedTimelinePosition}`;
        lastMarkerByBoundary.set(boundaryKey, marker);
    });

    return markers.filter((marker) => {
        const boundaryKey = `${marker.resolvedScenePath}::${marker.resolvedTimelinePosition}`;
        return lastMarkerByBoundary.get(boundaryKey) === marker;
    });
}

export function buildTimelineChapterResolverItems(items: TimelineItem[]): TimelineItem[] {
    const orderedItems: TimelineItem[] = [];
    const uniqueScenes = new Map<string, TimelineItem>();

    items.forEach((item) => {
        if (isMatterNote(item) || item.itemType === 'BookMeta') return;
        if (!isSceneItem(item)) return;
        const sceneKey = item.path || `${item.title || ''}::${String(item.when || '')}`;
        if (!uniqueScenes.has(sceneKey)) {
            uniqueScenes.set(sceneKey, item);
        }
    });

    uniqueScenes.forEach((scene) => {
        orderedItems.push(scene);
    });

    return sortScenes(orderedItems, false, false);
}
