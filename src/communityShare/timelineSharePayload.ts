/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * What leaves the vault when a timeline is shared from Settings → Community.
 *
 * An allow-list, built field by field. The manual export writes the author's
 * whole render input to a file they then choose to upload; automatic sharing
 * has no such moment, so it sends only what the website reads: the structure
 * and the details held for reveal. Nothing else on a TimelineItem can follow,
 * including the note's path, the rest of its frontmatter, and the folders and
 * settings a renderConfig snapshot carries.
 *
 * Scene text is not on a TimelineItem, and this builder could not send it if it
 * were: the rule is enforced by what is listed here, not by what is left out.
 */

import type { BookMeta, BookProfile, TimelineItem } from '../types';
import { TIMELINE_DATA_EXPORT_SCHEMA_VERSION, wallClockWhen } from '../services/export/timelineExportFormat';
import { isOpaqueSceneId } from '../utils/sceneIds';

export interface TimelineShareItem {
    itemType: 'Scene';
    title?: string;
    /** Only an opaque generated id. An id an author typed can carry a title. */
    sceneId?: string;
    when?: string;
    date?: string;
    subplot: string[];
    act?: string;
    actNumber?: number;
    number?: number;
    pov?: string;
    Character?: string[];
    synopsis?: string;
    status?: string | string[];
    'Publish Stage'?: string;
}

export interface TimelineSharePayload {
    schemaVersion: string;
    exportedAt: string;
    exportId: string;
    generator: 'Radial Timeline';
    pluginVersion: string;
    context: { bookTitle: string; itemCount: number };
    bookMeta: { title: string; subtitle?: string; author?: string };
    renderConfig: { actCount?: number };
    items: TimelineShareItem[];
}

export interface BuildTimelineSharePayloadParams {
    items: TimelineItem[];
    bookMeta: BookMeta | null;
    book: Pick<BookProfile, 'title' | 'publicLabel'>;
    actCount?: number;
    pluginVersion: string;
    exportId: string;
    now: Date;
}

const WIKILINK = /\[\[([^\][|]*)(?:\|([^\][]*))?\]\]/g;

/**
 * A name as the reader sees it in Obsidian. The authored form of a link carries
 * its target, which can be a folder path in the vault (`[[People/Mira]]`), so it
 * leaves as its alias or the note's name and never as the link itself.
 */
function linkText(text: string): string {
    return text.replace(WIKILINK, (_match: string, target: string, alias?: string) => {
        const shown = alias?.trim();
        if (shown) return shown;
        const note = target.split('#')[0].split('/').pop() ?? ''; // SAFE: split always yields at least one segment
        return note.replace(/\.md$/i, '').trim();
    }).trim();
}

function textList(value: unknown): string[] {
    const values = Array.isArray(value) ? value : [value];
    return values
        .filter((entry): entry is string => typeof entry === 'string')
        .map(linkText)
        .filter(entry => entry.length > 0);
}

/** One row per scene: the renderer's input repeats a scene for each of its subplots. */
function scenesOf(items: TimelineItem[]): TimelineItem[][] {
    const groups = new Map<string, TimelineItem[]>();
    const scenes: TimelineItem[][] = [];
    for (const item of items) {
        if (item.itemType !== undefined && item.itemType !== 'Scene') continue;
        const rows = item.path ? groups.get(item.path) : undefined;
        if (rows) {
            rows.push(item);
            continue;
        }
        const next = [item];
        scenes.push(next);
        if (item.path) groups.set(item.path, next);
    }
    return scenes;
}

function shareItem(rows: TimelineItem[]): TimelineShareItem {
    const item = rows[0];
    const frontmatter = item.rawFrontmatter;
    const authoredSubplots = textList(frontmatter?.Subplot);
    const subplots = authoredSubplots.length > 0 ? authoredSubplots : rows.flatMap(row => textList(row.subplot));
    const cast = textList(frontmatter?.Character ?? item.Character);
    const when = wallClockWhen(item);
    const synopsis = item.synopsis ?? item.Summary;

    return {
        itemType: 'Scene',
        subplot: [...new Set(subplots)],
        ...(item.title ? { title: item.title } : {}),
        ...(item.sceneId && isOpaqueSceneId(item.sceneId) ? { sceneId: item.sceneId } : {}),
        ...(when ? { when } : item.date ? { date: item.date } : {}),
        ...(item.act ? { act: item.act } : {}),
        ...(item.actNumber !== undefined ? { actNumber: item.actNumber } : {}),
        ...(item.number !== undefined ? { number: item.number } : {}),
        ...(item.pov ? { pov: item.pov } : {}),
        ...(cast.length > 0 ? { Character: cast } : {}),
        ...(synopsis ? { synopsis } : {}),
        ...(item.status ? { status: item.status } : {}),
        ...(item['Publish Stage'] ? { 'Publish Stage': item['Publish Stage'] } : {}),
    };
}

/**
 * Build the envelope for one book. The author's public label wins over the
 * private title, as it does for the book's project card.
 */
export function buildTimelineSharePayload(params: BuildTimelineSharePayloadParams): TimelineSharePayload {
    const items = scenesOf(params.items).map(shareItem);
    const title = params.book.publicLabel?.trim() || params.bookMeta?.title?.trim() || params.book.title; // SAFE: the public label is optional; the book's own title is always set
    return {
        schemaVersion: TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
        exportedAt: params.now.toISOString(),
        exportId: params.exportId,
        generator: 'Radial Timeline',
        pluginVersion: params.pluginVersion,
        context: { bookTitle: title, itemCount: items.length },
        bookMeta: {
            title,
            ...(params.bookMeta?.subtitle ? { subtitle: params.bookMeta.subtitle } : {}),
            ...(params.bookMeta?.author ? { author: params.bookMeta.author } : {}),
        },
        renderConfig: params.actCount === undefined ? {} : { actCount: params.actCount },
        items,
    };
}

/** The part of a payload that says whether anything changed. */
export function timelinePayloadFingerprint(payload: TimelineSharePayload): string {
    return JSON.stringify({ bookMeta: payload.bookMeta, renderConfig: payload.renderConfig, items: payload.items });
}
