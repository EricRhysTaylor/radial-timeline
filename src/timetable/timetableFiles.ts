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
import { classifyForPromotion } from '../services/PromoteToSceneService';
import { systemFolderPath } from '../utils/systemFolder';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { getConfiguredActCount } from '../utils/acts';
import { safeTitle } from '../utils/noteTitle';

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

/** A file name for a book's table: the book title, made safe for every platform. */
export function tableFileStem(title: string): string {
    const stem = safeTitle(title);
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

/**
 * Template keys the Timetable leaves out by default: what its number cell,
 * Rings column and act headings already show, the AI update flags, and the long-form fields
 * (Summary, Pending Edits) that don't fit a one-line row. The author can add
 * any of them back from the Properties menu.
 */
const LEFT_OUT_OF_TIMETABLE = new Set(['Class', 'Act', 'Subplot', 'Status', 'Publish Stage', 'Pulse Update', 'Summary Update', 'Summary', 'Pending Edits']);

/**
 * Template keys a new Timetable starts without: its When cell shows the
 * Duration, and Chapter, Runtime and Iteration are seldom read in a row.
 * The Properties menu adds them back.
 */
const HIDDEN_IN_NEW_TIMETABLE = new Set(['Duration', 'Chapter', 'Runtime', 'Iteration']);
/** The Timetable's first columns after the name, in order. The rest follow in template order. */
const LEADING_TIMETABLE_KEYS = ['When', 'Character', 'Place', 'Due', 'Words'];
/** The Timetable's last column: its long text reads best at the end of the row. */
const LAST_TIMETABLE_KEY = 'Synopsis';
/** Columns a new Timetable shows however few scenes fill them. */
const ALWAYS_IN_TIMETABLE = new Set(['When', 'Synopsis']);
/** A book needs this many scenes before an empty-looking column is left out; a new book's are all empty. */
export const SPARSE_COLUMN_MIN_SCENES = 5;

/** How many of a book's scenes fill each property, by lookup key (see fillKey). */
export interface ColumnFill {
    scenes: number;
    filled: Map<string, number>;
}

/** A property name as fill counts compare it: case, spaces, `_` and `-` ignored. */
function fillKey(key: string): string {
    return key.toLowerCase().replace(/[\s_-]/g, '');
}

function hasValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.some(hasValue);
    return true;
}

/** Count, over the scenes among these notes, how many fill each property. Other notes don't count. */
export function countColumnFill(frontmatters: Array<Record<string, unknown> | undefined>, settings: RadialTimelineSettings): ColumnFill {
    const mappings = getActiveFrontmatterMappings(settings);
    const fill: ColumnFill = { scenes: 0, filled: new Map() };
    for (const frontmatter of frontmatters) {
        if (!frontmatter || classifyForPromotion(frontmatter).kind !== 'alreadyScene') continue;
        fill.scenes += 1;
        for (const [key, value] of Object.entries(normalizeFrontmatterKeys(frontmatter, mappings))) {
            if (!hasValue(value)) continue;
            const lookup = fillKey(key);
            fill.filled.set(lookup, (fill.filled.get(lookup) ?? 0) + 1);
        }
    }
    return fill;
}

/** True when fewer than half of the scenes fill `key` (and there are enough scenes to tell). */
function isSparse(key: string, fill: ColumnFill | undefined): boolean {
    if (!fill || fill.scenes < SPARSE_COLUMN_MIN_SCENES || ALWAYS_IN_TIMETABLE.has(key)) return false;
    return (fill.filled.get(fillKey(key)) ?? 0) * 2 < fill.scenes;
}

/**
 * The Timetable's recommended columns: the name, When, Character, Place, Due
 * and Words, the rest of the template in its order, then Synopsis. Keys its
 * number cell and Rings column already show, the long-form fields and the
 * seldom-read ones are left out, and so is any column most of the book's
 * scenes leave empty.
 */
function timetableColumns(keys: string[], settings: RadialTimelineSettings, fill: ColumnFill | undefined): string[] {
    const shown = keys.filter(key => !LEFT_OUT_OF_TIMETABLE.has(key) && !HIDDEN_IN_NEW_TIMETABLE.has(key) && !isSparse(key, fill));
    const leading = LEADING_TIMETABLE_KEYS.filter(key => shown.includes(key));
    const middle = shown.filter(key => !LEADING_TIMETABLE_KEYS.includes(key) && key !== LAST_TIMETABLE_KEY);
    const last = shown.includes(LAST_TIMETABLE_KEY) ? [LAST_TIMETABLE_KEY] : [];
    return ['file.name', ...[...leading, ...middle, ...last].map(key => authorKeyFor(key, settings))];
}

/**
 * Columns for the views, from the scene template (core, plus advanced when
 * enabled), so the table mirrors the YAML. The Timetable gets its
 * recommended columns (see timetableColumns); the built-in Table keeps
 * every key for spreadsheet editing.
 */
export function tableColumns(settings: RadialTimelineSettings, fill?: ColumnFill): { timetable: string[]; table: string[] } {
    const { core, advanced } = buildScenePropertyDefinitions(settings);
    const includeAdvanced = settings.sceneAdvancedPropertiesEnabled ?? true;
    const keys = [...core, ...(includeAdvanced ? advanced : [])].map(definition => definition.key);
    const unique = [...new Set(keys)];
    return {
        timetable: timetableColumns(unique, settings, fill),
        table: ['file.name', ...unique.filter(key => key !== 'Pulse Update' && key !== 'Summary Update').map(key => authorKeyFor(key, settings))],
    };
}

/**
 * Give one Timetable view its recommended columns: its column list is
 * replaced and its saved widths dropped. Everything else in the file (the
 * other views, filters, sorts, grouping) stays. Null when the file has no
 * Timetable view of that name.
 */
export function withRecommendedColumns(parsed: Record<string, unknown>, viewName: string, order: string[]): Record<string, unknown> | null {
    if (!Array.isArray(parsed.views)) return null;
    let found = false;
    const views = parsed.views.map((view: unknown) => {
        if (found || !view || typeof view !== 'object') return view;
        const entry = view as Record<string, unknown>;
        if (entry.type !== TIMETABLE_VIEW_TYPE || entry.name !== viewName) return view;
        found = true;
        const next: Record<string, unknown> = { ...entry, order };
        delete next.columnSize;
        return next;
    });
    return found ? { ...parsed, views } : null;
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
    includeBoards: boolean,
    fill?: ColumnFill
): BaseFileContent {
    const columns = tableColumns(settings, fill);
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
    names: Pick<TimetableViewNames, 'timetable' | 'table'>,
    fill?: ColumnFill
): BaseFileContent {
    const columns = tableColumns(settings, fill);
    return {
        filters: { and: [{ or: books.map(book => folderFilter(book.sourceFolder)) }, MARKDOWN_ONLY] },
        views: [
            { type: TIMETABLE_VIEW_TYPE, name: names.timetable, order: columns.timetable },
            { type: 'table', name: names.table, order: columns.table },
        ],
    };
}

/** The folder filter term for `folder` in each form Obsidian may save: RT's double quotes, or single quotes. */
function folderFilterTerms(folder: string): string[] {
    return [folderFilter(folder), `file.inFolder('${folder.replace(/'/g, "''")}')`];
}

/**
 * Point a table file's folder filter at a book's new folder. Only the exact
 * filter term RT wrote is replaced, so the author's own filters, views and
 * columns stay byte-for-byte as they were. Returns null when the old term
 * isn't in the file (the author changed the filter), so nothing is rewritten.
 */
export function retargetFolderFilter(content: string, fromFolder: string, toFolder: string): string | null {
    for (const term of folderFilterTerms(fromFolder)) {
        if (content.includes(term)) return content.split(term).join(folderFilter(toFolder));
    }
    return null;
}

/** True when `items` is the saga's book-folder group: one folder term per folder in `folders`, in any order. */
function isFolderGroup(items: unknown[], folders: string[]): boolean {
    if (items.length !== folders.length) return false;
    const unmatched = [...folders];
    for (const item of items) {
        if (typeof item !== 'string') return false;
        const index = unmatched.findIndex(folder => folderFilterTerms(folder).includes(item.trim()));
        if (index === -1) return false;
        unmatched.splice(index, 1);
    }
    return true;
}

/**
 * Point the saga table at the saga's books after a book joins, leaves or
 * moves. Only the `or` group of book folders RT wrote is replaced, wherever
 * the author has dragged it: among All views' filters or one view's, at any
 * position. The author's other filters stay. Returns null when no group lists
 * exactly the old folders (the author changed it), so nothing is rewritten.
 */
export function retargetSagaFolderFilter(parsed: Record<string, unknown>, fromFolders: string[], toFolders: string[]): Record<string, unknown> | null {
    let found = false;
    const retarget = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(retarget);
        if (!node || typeof node !== 'object') return node;
        const group = node as Record<string, unknown>;
        if (Array.isArray(group.or) && isFolderGroup(group.or, fromFolders)) {
            found = true;
            return { ...group, or: toFolders.map(folderFilter) };
        }
        return Object.fromEntries(Object.entries(group).map(([key, value]) => [key, retarget(value)]));
    };
    const withFilters = <T extends object>(owner: T): T =>
        'filters' in owner ? { ...owner, filters: retarget((owner as { filters?: unknown }).filters) } : owner;

    const next: Record<string, unknown> = { ...withFilters(parsed) };
    if (Array.isArray(parsed.views)) {
        next.views = (parsed.views as unknown[]).map(view => (view && typeof view === 'object' ? withFilters(view) : view));
    }
    return found ? next : null;
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
