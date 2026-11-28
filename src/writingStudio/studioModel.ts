/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Writing Studio: the book as the reader walks it
 * -----------------------------------------------
 * One ordered list of scenes in manuscript order (the timeline's narrative
 * sort, never File Explorer's), the chapters they fall into, and the acts.
 * Reading View, the wheel and the contents all read this one model.
 *
 * Chapters come from the one chapter resolver (utils/timelineChapters) with
 * the book's Chapter source: the `Chapter` property or chapter folders.
 * Scenes in no chapter stay readable in their place.
 */

import type { TimelineItem } from '../types';
import { getMainPlotName } from '../utils/mainPlot';
import { extractPrefixToken } from '../utils/prefixOrder';
import { buildTimelineChapterResolverItems, PROPERTY_CHAPTER_CONTEXT, resolveChapters, type ChapterContext } from '../utils/timelineChapters';
import { isBeatNote, sortScenes } from '../utils/sceneHelpers';

export interface StudioScene {
    /** Position in manuscript order, from 0. */
    index: number;
    path: string;
    /** The note's title as the timeline shows it ("3 First Ball"). */
    title: string;
    /** The title without its order prefix ("First Ball"). */
    name: string;
    /** The order prefix the title starts with ("3"), if any. */
    prefix: string | null;
    act: number;
    /** Every subplot the scene is on, its primary subplot first. */
    subplots: string[];
    synopsis: string | null;
    when: Date | null;
    status: string | null;
    stage: string | null;
    /** The chapter this scene reads in, or null before the first chapter marker. */
    chapter: number | null;
}

export interface StudioChapter {
    /** Position among chapters, from 0. */
    index: number;
    title: string;
    firstScene: number;
    lastScene: number;
    act: number;
}

/** A story beat note: a marker between scenes, with no prose of its own. */
export interface StudioBeat {
    path: string;
    title: string;
    name: string;
    act: number;
    /** The scene it follows in manuscript order, or -1 before the first scene. */
    afterScene: number;
}

export interface StudioBook {
    scenes: StudioScene[];
    /** Story beats in manuscript order. */
    beats: StudioBeat[];
    chapters: StudioChapter[];
    /** The acts that hold scenes, ascending. */
    acts: number[];
    /** Subplot names in the order they first appear, the main plot first. */
    subplots: string[];
}

export type StudioUnit = 'scene' | 'chapter';
export type StudioScope = 'book' | 'chapter' | 'scene';

function actOf(item: TimelineItem): number {
    const raw = item.actNumber ?? (item.act !== undefined ? Number.parseInt(item.act, 10) : NaN);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

function firstString(value: unknown): string | null {
    const candidate: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof candidate !== 'string') return null;
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** "3 First Ball" → { prefix: "3", name: "First Ball" }. A title that is only a number keeps it as its name. */
export function splitSceneTitle(title: string): { prefix: string | null; name: string } {
    const prefix = extractPrefixToken(title);
    if (!prefix) return { prefix: null, name: title.trim() };
    const rest = title.trim().slice(prefix.length).trim();
    return { prefix, name: rest.length > 0 ? rest : title.trim() };
}

/**
 * Build the studio's book from the timeline's scene data for one book.
 * `items` is what `getSceneData` returns: one item per scene per subplot,
 * plus beats (kept as markers between scenes), and backdrops and matter,
 * which the studio leaves out. Chapters come from the one resolver, with
 * the book's Chapter source (`context`).
 */
export function buildStudioBook(items: TimelineItem[], context: ChapterContext = PROPERTY_CHAPTER_CONTEXT): StudioBook {
    const ordered = buildTimelineChapterResolverItems(items).filter((item): item is TimelineItem & { path: string } => !!item.path);
    const resolution = resolveChapters(ordered, context);
    const mainPlot = getMainPlotName();

    const subplotsByPath = new Map<string, string[]>();
    for (const item of items) {
        if (!item.path) continue;
        const subplot = item.subplot && item.subplot.trim().length > 0 ? item.subplot.trim() : mainPlot;
        const list = subplotsByPath.get(item.path) ?? []; // SAFE: the scene's first subplot starts its list
        if (!list.includes(subplot)) list.push(subplot);
        subplotsByPath.set(item.path, list);
    }

    const scenes: StudioScene[] = [];
    const indexOfPath = new Map(ordered.map((item, index) => [item.path, index]));
    // A resolved chapter is one unbroken run of scenes, so its first and last paths bound it.
    const chapters: StudioChapter[] = resolution.chapters.map(chapter => {
        const firstScene = indexOfPath.get(chapter.scenePaths[0]) as number; // SAFE: the resolver only saw `ordered`
        return {
            index: chapter.index,
            title: chapter.title,
            firstScene,
            lastScene: indexOfPath.get(chapter.scenePaths[chapter.scenePaths.length - 1]) as number, // SAFE: as above
            act: actOf(ordered[firstScene]),
        };
    });

    for (const [index, item] of ordered.entries()) {
        const path = item.path;
        const title = (item.title ?? '').trim() || path.split('/').pop()!.replace(/\.md$/i, ''); // SAFE: split always yields one element
        const { prefix, name } = splitSceneTitle(title);
        const primary = item.subplot && item.subplot.trim().length > 0 ? item.subplot.trim() : mainPlot;
        const subplots = subplotsByPath.get(path) ?? [primary];
        scenes.push({
            index,
            path,
            title,
            name,
            prefix,
            act: actOf(item),
            subplots: [primary, ...subplots.filter(subplot => subplot !== primary)],
            synopsis: firstString(item.synopsis),
            when: item.when instanceof Date && !Number.isNaN(item.when.getTime()) ? item.when : null,
            status: firstString(item.status),
            stage: firstString(item['Publish Stage']),
            chapter: resolution.chapterOf.get(path) ?? null,
        });
    }

    // Beats take their place in the same manuscript sort as the scenes, so
    // each one follows the scene its order prefix follows ("1.01" after "1").
    const beatItems = new Map<string, TimelineItem>();
    for (const item of items) if (isBeatNote(item) && item.path && !beatItems.has(item.path)) beatItems.set(item.path, item);
    const beats: StudioBeat[] = [];
    let scenesSeen = -1;
    for (const item of sortScenes([...ordered, ...beatItems.values()], false, false)) {
        if (!isBeatNote(item)) { scenesSeen += 1; continue; }
        const path = item.path as string; // SAFE: beatItems holds only items with a path
        const title = (item.title ?? '').trim() || path.split('/').pop()!.replace(/\.md$/i, ''); // SAFE: split always yields one element
        beats.push({ path, title, name: splitSceneTitle(title).name, act: actOf(item), afterScene: scenesSeen });
    }

    const acts = [...new Set(scenes.map(scene => scene.act))].sort((a, b) => a - b);
    const seen = new Set<string>();
    for (const scene of scenes) for (const subplot of scene.subplots) seen.add(subplot);
    const subplots = [...seen].sort((a, b) => (a === mainPlot ? -1 : b === mainPlot ? 1 : 0));

    return { scenes, beats, chapters, acts, subplots };
}

export type OutlineLeaf = { kind: 'scene'; scene: number } | { kind: 'beat'; beat: number };
export type OutlineEntry = OutlineLeaf | {
    kind: 'chapter';
    chapter: number;
    /** The chapter began in an earlier act and carries on here. */
    continued: boolean;
    children: OutlineLeaf[];
};
export interface OutlineAct {
    act: number;
    entries: OutlineEntry[];
}

/**
 * The contents as an outline: acts, then chapters with their scenes, with
 * scenes outside any chapter and story beats at act level. A beat sits inside
 * a chapter only when the next scene after it in that act belongs to the same
 * chapter, so a beat between two chapters stands between them.
 */
export function buildOutline(book: StudioBook): OutlineAct[] {
    const sequence: Array<OutlineLeaf & { act: number }> = [];
    const beatsAfter = (scene: number): void => {
        book.beats.forEach((beat, index) => { if (beat.afterScene === scene) sequence.push({ kind: 'beat', beat: index, act: beat.act }); });
    };
    beatsAfter(-1);
    for (const scene of book.scenes) {
        sequence.push({ kind: 'scene', scene: scene.index, act: scene.act });
        beatsAfter(scene.index);
    }

    const acts = [...new Set(sequence.map(item => item.act))].sort((a, b) => a - b);
    const opened = new Set<number>();
    return acts.map(act => {
        const items = sequence.filter(item => item.act === act);
        const entries: OutlineEntry[] = [];
        let open: Extract<OutlineEntry, { kind: 'chapter' }> | null = null;
        items.forEach((item, position) => {
            const leaf: OutlineLeaf = item.kind === 'scene' ? { kind: 'scene', scene: item.scene } : { kind: 'beat', beat: item.beat };
            if (item.kind === 'beat') {
                const next = items.slice(position + 1).find(candidate => candidate.kind === 'scene');
                const nextChapter = next && next.kind === 'scene' ? book.scenes[next.scene].chapter : null;
                if (open && nextChapter === open.chapter) open.children.push(leaf);
                else { open = null; entries.push(leaf); }
                return;
            }
            const chapter = book.scenes[item.scene].chapter;
            if (chapter === null) { open = null; entries.push(leaf); return; }
            if (!open || open.chapter !== chapter) {
                open = { kind: 'chapter', chapter, continued: opened.has(chapter), children: [] };
                opened.add(chapter);
                entries.push(open);
            }
            open.children.push(leaf);
        });
        return { act, entries };
    });
}

/** The scenes the reading pane shows for a scope, around the current scene. */
export function scopeRange(book: StudioBook, scope: StudioScope, current: number): { first: number; last: number } {
    const last = book.scenes.length - 1;
    if (last < 0) return { first: 0, last: -1 };
    const at = Math.max(0, Math.min(current, last));
    if (scope === 'scene') return { first: at, last: at };
    if (scope === 'chapter') {
        const chapter = chapterAt(book, at);
        if (chapter) return { first: chapter.firstScene, last: chapter.lastScene };
        // Before the first chapter: the opening run of scenes reads as one section.
        const end = book.chapters.length > 0 ? book.chapters[0].firstScene - 1 : last;
        return { first: 0, last: end };
    }
    return { first: 0, last };
}

/**
 * The beat whose stage the scene is in: the last beat marker before it in book order. A beat
 * opens its stage, which runs until the next beat. Null before the first beat.
 */
export function beatAt(book: StudioBook, sceneIndex: number): StudioBeat | null {
    let found: StudioBeat | null = null;
    for (const beat of book.beats) {
        if (beat.afterScene >= sceneIndex) break;
        found = beat;
    }
    return found;
}

export function chapterAt(book: StudioBook, sceneIndex: number): StudioChapter | null {
    const scene = book.scenes[sceneIndex];
    return scene && scene.chapter !== null ? book.chapters[scene.chapter] ?? null : null;
}

/**
 * The chapter's title already names it as a numbered chapter ("Chapter 1",
 * "CHAPTER III.", "Chapter Twelve"), so a "Chapter n" label beside it would
 * say the same thing twice.
 */
export function chapterTitleIsNumber(title: string): boolean {
    return /^chapter\s+[^\s]+$/i.test(title.trim());
}

/**
 * The scene a previous/next press lands on, or null at the book's edge.
 * By scene: the neighbour. By chapter: the next chapter's opening scene; going
 * back from inside a chapter lands on its opening scene first, then on the
 * previous chapter's.
 */
export function stepTarget(book: StudioBook, unit: StudioUnit, current: number, direction: -1 | 1): number | null {
    const count = book.scenes.length;
    if (count === 0) return null;
    if (unit === 'scene') {
        const target = current + direction;
        return target >= 0 && target < count ? target : null;
    }
    const starts = book.chapters.map(chapter => chapter.firstScene);
    // The opening run before the first chapter starts at scene 0.
    if (starts.length === 0 || starts[0] > 0) starts.unshift(0);
    if (direction > 0) {
        const next = starts.find(start => start > current);
        return next ?? null;
    }
    const previous = [...starts].reverse().find(start => start < current);
    return previous ?? null;
}

/** The opening scene of each act, for act jumps. Only meaningful when the book has more than one act. */
export function actStarts(book: StudioBook): Array<{ act: number; scene: number }> {
    return book.acts.map(act => ({ act, scene: book.scenes.findIndex(scene => scene.act === act) }))
        .filter(entry => entry.scene >= 0);
}
