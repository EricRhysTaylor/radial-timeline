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
 *
 * Every text field that is sent (title, synopsis, act, subplots, cast, status,
 * publish stage and the book's title, subtitle and author) goes through
 * `linkText` first, so no link target leaves: a vault link leaves as the name
 * the reader sees, a web link as its shown text, and an attachment embed not
 * at all. See `linkText` for each form.
 */

import type { BookMeta, BookProfile, TimelineItem } from '../types';
import { TIMELINE_DATA_EXPORT_SCHEMA_VERSION, wallClockWhen } from '../services/export/timelineExportFormat';
import { isOpaqueSceneId } from '../utils/sceneIds';
import { isNarrationValue } from '../utils/pov';

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
    /**
     * The scene's narration override (`Narration:`, or a legacy `POV:` not yet
     * migrated), sent only when it names a mode or count, never a character.
     * The wire name stays `pov`: the server reads it as the scene's povMode.
     */
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
    /** From `sceneIdHolders`. Without it, nothing is known of earlier sends. */
    sceneIdHolders?: Readonly<Record<string, string>>;
}

const WIKILINK = /(!?)\[\[([^\][|]*)(?:\|([^\][]*))?\]\]/g;
/** Any markdown link or image: `[shown](target)`, `[shown](<target with spaces>)`, `![alt](target)`. */
const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g;
/** File types Obsidian embeds as media rather than as a note. Their embeds carry nothing a reader reads. */
const ATTACHMENT = /\.(?:png|jpe?g|gif|bmp|svg|webp|avif|heic|tiff?|mp3|wav|m4a|ogg|3gp|flac|webm|mp4|ogv|mov|mkv|pdf)$/i;

/** Stands in for a removed embed until the spaces around it close up. */
const REMOVED = '\u0000';

function markdownTarget(link: string): string {
    const open = link.lastIndexOf('](');
    const target = link.slice(open + 2, -1).trim();
    const bare = target.startsWith('<') ? target.slice(1, target.indexOf('>')) : target.split(/\s+/)[0];
    return bare.split(/[?#]/)[0];
}

/**
 * Text as the reader sees it in Obsidian, with no link target left in it. The
 * authored form of a link carries its target, which can be a folder path in
 * the vault (`[[People/Mira]]`, `[Mira](People/Mira.md)`) or a web address,
 * so every link leaves as its shown text and never as the link itself:
 *
 * - `[[People/Mira]]` and `[[Mira#Bio]]` leave as `Mira`; `[[People/Mira|M.]]` as `M.`.
 * - A note embed `![[Letters/Note]]` leaves as its alias or the note's name.
 * - An attachment embed (`![[map.png]]`, `![alt](scan.pdf)`) is removed: it
 *   shows a picture or a file, not words, and its name is often a path or a
 *   camera file name.
 * - A markdown link, to a note or to the web, leaves as its shown text. No URL
 *   in link form leaves the vault.
 */
export function linkText(text: string): string {
    return text
        .replace(WIKILINK, (_match: string, embed: string, target: string, alias?: string) => {
            const [path, heading = ''] = target.split('#');
            if (embed && ATTACHMENT.test(path.trim())) return REMOVED;
            const shown = alias?.trim();
            if (shown) return shown;
            const note = path.split('/').pop() ?? ''; // SAFE: split always yields at least one segment
            return (note.replace(/\.md$/i, '').trim() || heading.trim());
        })
        .replace(MARKDOWN_LINK, (match: string, embed: string, shown: string) => (
            embed && ATTACHMENT.test(markdownTarget(match)) ? REMOVED : shown.trim()
        ))
        .replace(/[ \t]*\u0000[ \t]*/g, ' ')
        .trim();
}

function sharedText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = linkText(value);
    return text.length > 0 ? text : undefined;
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

/**
 * Which note sends each scene id, as id → note path.
 *
 * A duplicated note keeps its `scn_` id, and the website groups scenes by id:
 * two scenes on one id either merge into one or make every sync fail. So each
 * id goes out on one scene only. The note that carried it in the last send
 * keeps it, so the website still matches the original and its reveal; the
 * copy goes without an id, placed by position, until the YAML audit's Fix
 * duplicate IDs gives it its own. With no earlier send (or that note renamed
 * or gone), the first scene in timeline order keeps it.
 *
 * `previous` is this result from the last send. The paths stay in plugin data
 * and never leave the vault: the payload carries only the ids.
 */
export function sceneIdHolders(
    items: TimelineItem[],
    previous: Readonly<Record<string, string>> = {}
): Record<string, string> {
    const carriers = new Map<string, string[]>();
    for (const [item] of scenesOf(items)) {
        const id = item.sceneId;
        if (!id || !item.path || !isOpaqueSceneId(id)) continue;
        const paths = carriers.get(id);
        if (paths) paths.push(item.path);
        else carriers.set(id, [item.path]);
    }
    const holders: Record<string, string> = {};
    for (const [id, paths] of carriers) {
        const kept = previous[id];
        holders[id] = kept && paths.includes(kept) ? kept : paths[0];
    }
    return holders;
}

function shareItem(rows: TimelineItem[], holders: Readonly<Record<string, string>>): TimelineShareItem {
    const item = rows[0];
    const frontmatter = item.rawFrontmatter;
    const authoredSubplots = textList(frontmatter?.Subplot);
    const subplots = authoredSubplots.length > 0 ? authoredSubplots : rows.flatMap(row => textList(row.subplot));
    const cast = textList(frontmatter?.Character ?? item.Character);
    const when = wallClockWhen(item);
    const synopsis = sharedText(item.synopsis ?? item.Summary);
    const title = sharedText(item.title);
    const act = sharedText(item.act);
    const status = Array.isArray(item.status) ? textList(item.status) : sharedText(item.status);
    const stage = sharedText(item['Publish Stage']);

    return {
        itemType: 'Scene',
        subplot: [...new Set(subplots)],
        ...(title ? { title } : {}),
        ...(item.sceneId && item.path && holders[item.sceneId] === item.path ? { sceneId: item.sceneId } : {}),
        ...(when ? { when } : item.date ? { date: item.date } : {}),
        ...(act ? { act } : {}),
        ...(item.actNumber !== undefined ? { actNumber: item.actNumber } : {}),
        ...(item.number !== undefined ? { number: item.number } : {}),
        ...(item.pov && isNarrationValue(item.pov) ? { pov: item.pov } : {}),
        ...(cast.length > 0 ? { Character: cast } : {}),
        ...(synopsis ? { synopsis } : {}),
        ...(status && status.length > 0 ? { status } : {}),
        ...(stage ? { 'Publish Stage': stage } : {}),
    };
}

/**
 * Build the envelope for one book. The author's public label wins over the
 * private title, as it does for the book's project card.
 */
export function buildTimelineSharePayload(params: BuildTimelineSharePayloadParams): TimelineSharePayload {
    const holders = params.sceneIdHolders ?? sceneIdHolders(params.items);
    const items = scenesOf(params.items).map(rows => shareItem(rows, holders));
    const title = sharedText(params.book.publicLabel) || sharedText(params.bookMeta?.title) || linkText(params.book.title); // SAFE: the public label is optional; the book's own title is always set
    const subtitle = sharedText(params.bookMeta?.subtitle);
    const author = sharedText(params.bookMeta?.author);
    return {
        schemaVersion: TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
        exportedAt: params.now.toISOString(),
        exportId: params.exportId,
        generator: 'Radial Timeline',
        pluginVersion: params.pluginVersion,
        context: { bookTitle: title, itemCount: items.length },
        bookMeta: {
            title,
            ...(subtitle ? { subtitle } : {}),
            ...(author ? { author } : {}),
        },
        renderConfig: params.actCount === undefined ? {} : { actCount: params.actCount },
        items,
    };
}

/** The part of a payload that says whether anything changed. */
export function timelinePayloadFingerprint(payload: TimelineSharePayload): string {
    return JSON.stringify({ bookMeta: payload.bookMeta, renderConfig: payload.renderConfig, items: payload.items });
}
