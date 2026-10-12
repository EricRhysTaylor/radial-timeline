/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: the .base files
 * -------------------------------
 * One `.base` file per book, plus one for the saga, all kept together in
 * `Radial Timeline/Timetables/`. The file is the author's: RT writes it once, on
 * request, and afterwards only keeps its book-folder filter pointed at the
 * book's folder. Views, columns and sorts the author changes are never touched.
 */

import type { RadialTimelineSettings } from '../types';
import type { BookProfile } from '../types/settings';
import { buildScenePropertyDefinitions } from '../sceneProperties/scenePropertyAdapter';
import { systemFolderPath } from '../utils/systemFolder';
import { getActiveFrontmatterMappings } from '../utils/frontmatter';
import { getConfiguredActCount } from '../utils/acts';

/** The Bases view type the Timetable registers. */
export const TIMETABLE_VIEW_TYPE = 'radial-timeline-timetable';
/** Where every Timetable file lives. */
export const TIMETABLES_FOLDER = systemFolderPath('Timetables');
/** Plugin-data key for the saga table, beside the book IDs. */
export const SAGA_TIMETABLE_KEY = 'saga';

/** What RT remembers about a table file it wrote (plugin data, never YAML). */
export type TimetableFileRecord = NonNullable<RadialTimelineSettings['timetableFiles']>[string];

/** View names written into a new table file, in the author's language. */
export interface TimetableViewNames {
    timetable: string;
    table: string;
    notOnTimeline: string;
    actBoard: string;
    statusBoard: string;
}

interface BaseView {
    type: string;
    name: string;
    filters?: { and: string[] };
    groupBy?: { property: string; direction: 'ASC' | 'DESC' };
    groupOrder?: Array<string | number | null>;
    order: string[];
}

export interface BaseFileContent {
    filters: { and: Array<string | { or: string[] }> };
    views: BaseView[];
}

/** Every table is limited to notes; images and PDFs in a book folder are never rows. */
const MARKDOWN_ONLY = 'file.ext == "md"';

const FILENAME_UNSAFE = /[\\/:*?"<>|#^[\]]+/g;

/** A file name for a book's table: the book title, made safe for every platform. */
export function tableFileStem(title: string): string {
    const stem = title.replace(FILENAME_UNSAFE, ' ').replace(/\s+/g, ' ').trim();
    return stem.length > 0 ? stem : 'Untitled';
}

/** Vault path for a table file whose stem is `stem`. */
export function tableFilePath(stem: string): string {
    return `${TIMETABLES_FOLDER}/${stem}.base`;
}

/** The filter term that limits a table to one book folder. */
export function folderFilter(folder: string): string {
    return `file.inFolder(${JSON.stringify(folder)})`;
}

/**
 * The author's own name for a template key. A key mapping (Settings → Core)
 * maps the author's key to RT's, so a table column must use the author's.
 */
export function authorKeyFor(canonical: string, settings: RadialTimelineSettings): string {
    const mappings = getActiveFrontmatterMappings(settings);
    if (!mappings) return canonical;
    const mapped = Object.entries(mappings).find(([, target]) => target === canonical);
    return mapped ? mapped[0] : canonical;
}

/** Template keys the number cell and the Rings column already show. */
const SHOWN_BY_TIMELINE_CELLS = new Set(['Class', 'Subplot', 'Status', 'Publish Stage', 'Pulse Update', 'Summary Update']);

/**
 * Columns for the views, from the scene template (core, plus advanced when
 * enabled), so the table mirrors the YAML. The Timetable leaves out what
 * its number cell and Rings column already show; the built-in Table keeps
 * every key for spreadsheet editing.
 */
export function tableColumns(settings: RadialTimelineSettings): { timetable: string[]; table: string[] } {
    const { core, advanced } = buildScenePropertyDefinitions(settings);
    const includeAdvanced = settings.sceneAdvancedPropertiesEnabled ?? true;
    const keys = [...core, ...(includeAdvanced ? advanced : [])].map(definition => definition.key);
    const unique = [...new Set(keys)];
    return {
        timetable: ['file.name', ...unique.filter(key => !SHOWN_BY_TIMELINE_CELLS.has(key)).map(key => authorKeyFor(key, settings))],
        table: ['file.name', ...unique.filter(key => key !== 'Pulse Update' && key !== 'Summary Update').map(key => authorKeyFor(key, settings))],
    };
}

/**
 * The content of a new book table. Views:
 * 1. Timetable, grouped by Act.
 * 2. The built-in Table, grouped by Act, for spreadsheet editing.
 * 3. Not on the timeline: notes with no Class, which Promote can fix.
 * 4. and 5. Act and Status boards (Obsidian 1.14's kanban view), only when the
 *    running Obsidian has it.
 *
 * Only the boards list a group order. Obsidian hides any group a group order
 * doesn't list, so the Timetable and Table don't use one: an act beyond
 * the book's act count must never disappear from them.
 */
export function buildBookTimetableContent(
    book: Pick<BookProfile, 'sourceFolder'>,
    settings: RadialTimelineSettings,
    names: TimetableViewNames,
    includeBoards: boolean
): BaseFileContent {
    const columns = tableColumns(settings);
    const act = authorKeyFor('Act', settings);
    const status = authorKeyFor('Status', settings);
    const subplot = authorKeyFor('Subplot', settings);
    const synopsis = authorKeyFor('Synopsis', settings);
    const classKey = authorKeyFor('Class', settings);
    const actCount = getConfiguredActCount(settings);
    const byAct = { property: act, direction: 'ASC' as const };

    const views: BaseView[] = [
        { type: TIMETABLE_VIEW_TYPE, name: names.timetable, groupBy: byAct, order: columns.timetable },
        { type: 'table', name: names.table, groupBy: byAct, order: columns.table },
        {
            type: 'table',
            name: names.notOnTimeline,
            filters: { and: [`${classKey}.isEmpty()`] },
            order: ['file.name', act, subplot, synopsis, 'file.mtime'],
        },
    ];
    if (includeBoards) {
        views.push({
            type: 'kanban',
            name: names.actBoard,
            groupBy: byAct,
            groupOrder: [...Array.from({ length: actCount }, (_, index) => index + 1), null],
            order: ['file.name', subplot, status],
        });
        views.push({
            type: 'kanban',
            name: names.statusBoard,
            groupBy: { property: status, direction: 'ASC' },
            groupOrder: ['Todo', 'Working', 'Complete', null],
            order: ['file.name', act, subplot],
        });
    }
    return { filters: { and: [folderFilter(book.sourceFolder), MARKDOWN_ONLY] }, views };
}

/**
 * The content of the saga table: every saga book's folder. The Timetable
 * groups its rows by book, then act, on its own, so it needs no grouping here.
 */
export function buildSagaTimetableContent(
    books: Array<Pick<BookProfile, 'sourceFolder'>>,
    settings: RadialTimelineSettings,
    names: Pick<TimetableViewNames, 'timetable' | 'table'>
): BaseFileContent {
    const columns = tableColumns(settings);
    return {
        filters: { and: [{ or: books.map(book => folderFilter(book.sourceFolder)) }, MARKDOWN_ONLY] },
        views: [
            { type: TIMETABLE_VIEW_TYPE, name: names.timetable, order: columns.timetable },
            { type: 'table', name: names.table, order: columns.table },
        ],
    };
}

/**
 * Point a table file's folder filter at a book's new folder. Only the exact
 * filter term RT wrote is replaced, so the author's own filters, views and
 * columns stay byte-for-byte as they were. Returns null when the old term
 * isn't in the file (the author changed the filter), so nothing is rewritten.
 */
export function retargetFolderFilter(content: string, fromFolder: string, toFolder: string): string | null {
    const quoted = (folder: string) => [JSON.stringify(folder), `'${folder.replace(/'/g, "''")}'`];
    for (const from of quoted(fromFolder)) {
        const term = `file.inFolder(${from})`;
        if (content.includes(term)) return content.split(term).join(folderFilter(toFolder));
    }
    return null;
}

/** The name of the first Timetable view in a parsed `.base` file, if it has one. */
export function findTimetableViewName(parsed: unknown): string | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const views = (parsed as { views?: unknown }).views;
    if (!Array.isArray(views)) return null;
    for (const view of views) {
        if (view && typeof view === 'object' && (view as { type?: unknown }).type === TIMETABLE_VIEW_TYPE) {
            const name = (view as { name?: unknown }).name;
            if (typeof name === 'string') return name;
        }
    }
    return null;
}
