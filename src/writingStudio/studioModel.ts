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
 * Chapters come from the `Chapter` field on scene notes, as Publish reads
 * it: a value opens a chapter, and the scenes after it continue in that
 * chapter until the next marker. The same title repeated on the very next
 * marker continues the chapter ("first occurrence wins", wiki/Publishing.md).
 * Scenes before the first marker belong to no chapter and stay readable.
 */

import type { TimelineItem } from '../types';
import { getMainPlotName } from '../utils/mainPlot';
import { extractPrefixToken } from '../utils/prefixOrder';
import { buildTimelineChapterResolverItems, readSharedChapterTitle } from '../utils/timelineChapters';

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

export interface StudioBook {
    scenes: StudioScene[];
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

function sameChapterTitle(a: string, b: string): boolean {
    return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

/**
 * Build the studio's book from the timeline's scene data for one book.
 * `items` is what `getSceneData` returns: one item per scene per subplot,
 * plus beats, backdrops and matter, which the studio leaves out.
 */
export function buildStudioBook(items: TimelineItem[]): StudioBook {
    const ordered = buildTimelineChapterResolverItems(items).filter(item => !!item.path);
    const mainPlot = getMainPlotName();

    const subplotsByPath = new Map<string, string[]>();
    for (const item of items) {
        if (!item.path) continue;
        const subplot = item.subplot && item.subplot.trim().length > 0 ? item.subplot.trim() : mainPlot;
        const list = subplotsByPath.get(item.path) ?? [];
        if (!list.includes(subplot)) list.push(subplot);
        subplotsByPath.set(item.path, list);
    }

    const scenes: StudioScene[] = [];
    const chapters: StudioChapter[] = [];
    let current: StudioChapter | null = null;

    for (const [index, item] of ordered.entries()) {
        const path = item.path as string; // SAFE: filtered to items with a path above
        const marker = readSharedChapterTitle(item.rawFrontmatter);
        if (marker && !(current && sameChapterTitle(current.title, marker))) {
            current = { index: chapters.length, title: marker, firstScene: index, lastScene: index, act: actOf(item) };
            chapters.push(current);
        }
        if (current) current.lastScene = index;
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
            chapter: current ? current.index : null,
        });
    }

    const acts = [...new Set(scenes.map(scene => scene.act))].sort((a, b) => a - b);
    const seen = new Set<string>();
    for (const scene of scenes) for (const subplot of scene.subplots) seen.add(subplot);
    const subplots = [...seen].sort((a, b) => (a === mainPlot ? -1 : b === mainPlot ? 1 : 0));

    return { scenes, chapters, acts, subplots };
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

export function chapterAt(book: StudioBook, sceneIndex: number): StudioChapter | null {
    const scene = book.scenes[sceneIndex];
    return scene && scene.chapter !== null ? book.chapters[scene.chapter] ?? null : null;
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
