/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: row model
 * -------------------------
 * Pure functions that turn a note's frontmatter into a table row, order rows
 * the way the wheel does, and lay out the Rings column. The Bases view
 * (`TimetableView`) does the rendering; nothing here touches the DOM.
 */

import type { RadialTimelineSettings, TimelineItem } from '../types';
import { classifyForPromotion } from '../services/PromoteToSceneService';
import { clampActNumber, getConfiguredActCount } from '../utils/acts';
import { frontmatterValueToText, getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { comparePrefixTokens, extractPrefixToken } from '../utils/prefixOrder';
import { isStoryBeat } from '../utils/sceneHelpers';
import { getFillForScene } from '../renderer/utils/SceneFill';
import { formatLocalDateKey, isOverdueDateString, parseWhenField } from '../utils/date';
import { normalizeStatus } from '../utils/text';
import { whenTextHasClock } from '../utils/whenFormat';
import { parseRuntimeField } from '../utils/runtimeEstimator';
import { formatHoverMetadataValue } from '../utils/hoverMetadata';
import { hexToRgb } from '../utils/colour';
import { compareDateCategories, dateColoringRows, readDateGrouping, type DateGrouping } from './coloringDates';
import { getMainPlotName } from '../utils/mainPlot';
import { readSceneId } from '../utils/sceneIds';

/**
 * - `scene`: on the wheel.
 * - `beat`: a story beat, shown as a quiet divider row.
 * - `sketch`: `Class: Sketch`, shown only in the table.
 * - `unclassed`: no Class, so the timeline can't see it; Promote fixes it.
 * - `otherClass`: Backdrop, matter pages and every other class; never promoted.
 */
export type TimetableRowKind = 'scene' | 'beat' | 'sketch' | 'unclassed' | 'otherClass';

export interface TimetableRow {
    path: string;
    basename: string;
    kind: TimetableRowKind;
    /** The note's Class, for otherClass rows. */
    className: string | null;
    /** Numeric filename prefix ("67.4"), or null for an unnumbered note. */
    prefix: string | null;
    /** The act the row sits in. Scenes and beats default to Act 1 as on the wheel; other notes may have none. */
    act: number | null;
    /** Subplot memberships. Scenes always have at least Main Plot; sketches list planned rings. */
    subplots: string[];
    /** An unclassed note that still carries a scene ID: a scene taken off the timeline (right-click → Remove from timeline). */
    removedScene: boolean;
}

function readSubplots(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
    return raw.map(item => frontmatterValueToText(item).trim()).filter(name => name.length > 0);
}

function readAct(value: unknown, actCount: number): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(Array.isArray(value) ? value[0] : value);
    if (!Number.isFinite(n)) return null;
    return clampActNumber(n, actCount);
}

/** Build the row for one note from its raw frontmatter. */
export function buildTableRow(
    path: string,
    basename: string,
    rawFrontmatter: Record<string, unknown> | undefined,
    settings: RadialTimelineSettings
): TimetableRow {
    const actCount = getConfiguredActCount(settings);
    const fm = rawFrontmatter ? normalizeFrontmatterKeys(rawFrontmatter, getActiveFrontmatterMappings(settings)) : {};
    const promotion = classifyForPromotion(rawFrontmatter);

    let kind: TimetableRowKind;
    let className: string | null = null;
    if (promotion.kind === 'alreadyScene') kind = 'scene';
    else if (promotion.kind === 'eligible') kind = promotion.fromSketch ? 'sketch' : 'unclassed';
    else if (isStoryBeat(promotion.className)) kind = 'beat';
    else {
        kind = 'otherClass';
        className = promotion.className;
    }

    const act = readAct(fm.Act, actCount);
    const subplots = readSubplots(fm.Subplot);
    return {
        path,
        basename,
        kind,
        className,
        prefix: extractPrefixToken(basename),
        act: act ?? (kind === 'scene' || kind === 'beat' ? 1 : null),
        subplots: kind === 'scene' && subplots.length === 0 ? [getMainPlotName()] : (kind === 'beat' || kind === 'otherClass' ? [] : subplots),
        removedScene: kind === 'unclassed' && readSceneId(rawFrontmatter) !== undefined,
    };
}

/**
 * Whether a note belongs in the Timetable view. Scenes, beats, sketches and
 * scenes taken off the timeline do wherever they sit in a book folder, as on
 * the wheel. Other notes (drafts
 * waiting for Promote, front matter) do at a book folder's top level, but not
 * in its subfolders, where a book keeps its feedback, cuts and publishing
 * material. A note outside every book folder (an author's own filter) does.
 */
export function belongsInTimetable(row: TimetableRow, bookFolders: string[]): boolean {
    if (row.kind === 'scene' || row.kind === 'beat' || row.kind === 'sketch' || row.removedScene) return true;
    const folder = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
    // The deepest book folder holding the note decides, in case one book folder sits inside another.
    const book = bookFolders
        .map(entry => entry.trim().replace(/\/+$/, ''))
        .filter(entry => entry.length > 0 && row.path.startsWith(`${entry}/`))
        .sort((a, b) => b.length - a.length)[0];
    return book === undefined || folder === book;
}

/** A note's name as the table shows it: the number prefix lives in the number cell, so it isn't repeated. */
export function displayName(basename: string): string {
    return basename.replace(/^\s*\d+(?:\.\d+)?\s+/, '');
}

/**
 * Manuscript order, as on the wheel: act first, then the filename's number
 * prefix, then the name. Rows without an act come last.
 */
export function compareManuscriptRows(a: TimetableRow, b: TimetableRow): number {
    const actA = a.act ?? Number.POSITIVE_INFINITY;
    const actB = b.act ?? Number.POSITIVE_INFINITY;
    if (actA !== actB) return actA < actB ? -1 : 1;
    const prefixCmp = comparePrefixTokens(a.prefix, b.prefix);
    if (prefixCmp !== 0) return prefixCmp;
    return a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' });
}

/** A row, or a divider drawn before the first row of a new act (or, in Chronologue order, a new day). */
export type TimetableLine =
    | { type: 'row'; row: TimetableRow }
    | { type: 'act'; act: number | null }
    | { type: 'day'; day: Date | null };

/**
 * Insert act dividers between rows when a group spans more than one act.
 * A group that holds a single act (for example, a table grouped by Act) gets
 * none, because its header already names the act.
 */
export function withActDividers(rows: TimetableRow[]): TimetableLine[] {
    const acts = new Set(rows.map(row => row.act));
    if (acts.size <= 1) return rows.map(row => ({ type: 'row', row }));
    const lines: TimetableLine[] = [];
    let current: number | null | undefined;
    for (const row of rows) {
        if (row.act !== current) {
            lines.push({ type: 'act', act: row.act });
            current = row.act;
        }
        lines.push({ type: 'row', row });
    }
    return lines;
}

export interface RingLayout {
    /** Ring names in slot order: the wheel's ring order, then rings only sketches use. */
    order: string[];
    /** Color index (0–15) per ring, as the wheel assigns it. */
    colorIndex: Map<string, number>;
    /** Rings the wheel doesn't draw yet (only planned on sketches or unclassed notes). */
    offWheel: Set<string>;
}

/**
 * Lay out the Rings column. Slots follow the wheel's ring order
 * (`masterSubplotOrder`) so a plotline reads straight down the table. Rings
 * that only sketches or unclassed notes use go last, alphabetically.
 */
export function buildRingLayout(
    wheelOrder: string[],
    wheelColorIndex: Map<string, number>,
    rows: TimetableRow[]
): RingLayout {
    const order = wheelOrder.filter(name => name !== 'Backdrop' && name !== 'MicroBackdrop');
    const colorIndex = new Map<string, number>();
    order.forEach((name, index) => colorIndex.set(name, wheelColorIndex.get(name) ?? index % 16));
    const known = new Set(order);
    const extra = [...new Set(rows.flatMap(row => row.subplots))]
        .filter(name => !known.has(name))
        .sort((a, b) => a.localeCompare(b));
    extra.forEach((name, index) => colorIndex.set(name, (order.length + index) % 16));
    return { order: [...order, ...extra], colorIndex, offWheel: new Set(extra) };
}

/**
 * The status fill for a scene's number cell: exactly what the wheel paints
 * that scene's cell (`getFillForScene`), with pattern references rewritten to
 * the table's own pattern defs.
 */
export function sceneNumberFill(
    rawFrontmatter: Record<string, unknown> | undefined,
    settings: RadialTimelineSettings,
    patternIdPrefix: string
): string {
    const fm = rawFrontmatter ? normalizeFrontmatterKeys(rawFrontmatter, getActiveFrontmatterMappings(settings)) : {};
    const item: TimelineItem = {
        date: '',
        itemType: 'Scene',
        status: fm.Status as string | string[] | undefined,
        'Publish Stage': fm['Publish Stage'] as string | undefined,
        due: typeof fm.Due === 'string' ? fm.Due : undefined,
    };
    return getFillForScene(item, settings.publishStageColors).replace(/url\(#plaid/g, `url(#${patternIdPrefix}plaid`);
}


// ── Chronologue ────────────────────────────────────────────────────────

/** A note's When, read the way the timeline reads it, and whether the YAML names a clock time. */
export function readWhen(
    rawFrontmatter: Record<string, unknown> | undefined,
    settings: RadialTimelineSettings
): { when: Date | null; hasClock: boolean } {
    const fm = rawFrontmatter ? normalizeFrontmatterKeys(rawFrontmatter, getActiveFrontmatterMappings(settings)) : {};
    const raw = fm.When;
    if (typeof raw !== 'string' || raw.trim() === '') return { when: null, hasClock: false };
    return { when: parseWhenField(raw.trim()), hasClock: whenTextHasClock(raw) };
}

/** Story order: When first (notes without one last), then manuscript order. */
export function compareChronologicalRows(
    a: { row: TimetableRow; when: Date | null },
    b: { row: TimetableRow; when: Date | null }
): number {
    if (a.when && b.when && a.when.getTime() !== b.when.getTime()) return a.when.getTime() - b.when.getTime();
    if (a.when && !b.when) return -1;
    if (!a.when && b.when) return 1;
    return compareManuscriptRows(a.row, b.row);
}

/** Day dividers between rows in story order: one before the first row of each new day. */
export function withDayDividers(items: Array<{ row: TimetableRow; when: Date | null }>): TimetableLine[] {
    const lines: TimetableLine[] = [];
    let currentDay: string | undefined;
    for (const item of items) {
        const day = item.when ? `${item.when.getFullYear()}-${item.when.getMonth()}-${item.when.getDate()}` : '';
        if (day !== currentDay) {
            lines.push({ type: 'day', day: item.when });
            currentDay = day;
        }
        lines.push({ type: 'row', row: item.row });
    }
    return lines;
}

/** Shift: milliseconds since the previous dated row, or null where either date is unknown. */
export function elapsedSincePrevious(whens: Array<Date | null>): Array<number | null> {
    let previous: Date | null = null;
    return whens.map(when => {
        const gap = when && previous ? when.getTime() - previous.getTime() : null;
        if (when) previous = when;
        return gap;
    });
}

/** Runtime: a scene's Runtime in seconds, read the way the timeline's Runtime overlay reads it. */
export function readRuntimeSeconds(
    rawFrontmatter: Record<string, unknown> | undefined,
    settings: RadialTimelineSettings
): number | null {
    const fm = rawFrontmatter ? normalizeFrontmatterKeys(rawFrontmatter, getActiveFrontmatterMappings(settings)) : {};
    const raw = fm.Runtime;
    return typeof raw === 'string' || typeof raw === 'number' ? parseRuntimeField(raw) : null;
}

/** Runtime: the running total through each row (rows without a Runtime add nothing). */
export function runningTotals(seconds: Array<number | null>): number[] {
    let total = 0;
    return seconds.map(value => {
        total += value !== null && value > 0 ? value : 0;
        return total;
    });
}

// ── Progress ───────────────────────────────────────────────────────────

export interface GroupProgress {
    scenes: number;
    complete: number;
    words: number;
    overdue: number;
}

/** Progress: scenes, how many are complete, their words, and how many are overdue. Only scenes count. */
export function groupProgress(
    items: Array<{ row: TimetableRow; frontmatter: Record<string, unknown> | undefined }>,
    settings: RadialTimelineSettings
): GroupProgress {
    const progress: GroupProgress = { scenes: 0, complete: 0, words: 0, overdue: 0 };
    const mappings = getActiveFrontmatterMappings(settings);
    for (const { row, frontmatter } of items) {
        if (row.kind !== 'scene') continue;
        const fm = frontmatter ? normalizeFrontmatterKeys(frontmatter, mappings) : {};
        progress.scenes += 1;
        const status = normalizeStatus(fm.Status);
        if (status === 'Completed') progress.complete += 1;
        const words = Number(fm.Words);
        if (Number.isFinite(words) && words > 0) progress.words += words;
        if (status !== 'Completed' && typeof fm.Due === 'string' && isOverdueDateString(fm.Due)) progress.overdue += 1;
    }
    return progress;
}

// ── Readouts: Due, Words and the vitals beside the number ──────────────

/** Due within this many days (and not late) counts as soon. */
export const DUE_SOON_DAYS = 7;

/**
 * Where a Due date stands. A complete scene's Due is the day it was
 * completed; any other is late, soon (within a week) or later. `days` counts
 * calendar days from today (negative when late).
 */
export type DueStatus =
    | { kind: 'none' }
    | { kind: 'done'; date: Date }
    | { kind: 'late' | 'soon' | 'later'; date: Date; days: number };

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

export function dueStatus(raw: unknown, complete: boolean, today: Date): DueStatus {
    const match = typeof raw === 'string' ? DATE_KEY.exec(raw.trim()) : null;
    if (!match) return { kind: 'none' };
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!Number.isFinite(date.getTime())) return { kind: 'none' };
    if (complete) return { kind: 'done', date };
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // Calendar days, rounded so a daylight-saving change doesn't shift the count.
    const days = Math.round((date.getTime() - start.getTime()) / 86_400_000);
    return { kind: days < 0 ? 'late' : (days <= DUE_SOON_DAYS ? 'soon' : 'later'), date, days };
}

/**
 * + and ++ in a row's control panel: the Due a number of days later. A late
 * Due, or none, counts from today, so one click brings a late scene back
 * into the future.
 */
export function steppedDue(raw: unknown, days: number, today: Date): string {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const match = typeof raw === 'string' ? DATE_KEY.exec(raw.trim()) : null;
    const due = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
    const base = due && Number.isFinite(due.getTime()) && due.getTime() > start.getTime() ? due : start;
    return formatLocalDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
}

export interface SceneVitals {
    /** The publish stage, as the stage colors name it (Zero when unset). */
    stage: string;
    /** Pending Edits in full, or null when it is empty. */
    pending: string | null;
    /** The Synopsis in full, or null when it is empty. */
    synopsis: string | null;
    /** The Summary in full, or null when it is empty (Shift on the Synopsis icon). */
    summary: string | null;
    complete: boolean;
    due: DueStatus;
}

/** + and ++ move a late Due at once; any other (soon, later, none) may be deliberate, so they ask first. */
export function dueStepNeedsConfirm(due: DueStatus): boolean {
    return due.kind !== 'late';
}

/** A property's text as the author wrote it (a list one item per line), or null when there is none. */
function fullText(value: unknown): string | null {
    const text = (Array.isArray(value) ? value : [value]).map(item => frontmatterValueToText(item)).join('\n').trim();
    return text.length > 0 ? text : null;
}

/** What a row's control panel shows beside its number: the stage, pending edits, Synopsis and Due. */
export function sceneVitals(rawFrontmatter: Record<string, unknown> | undefined, settings: RadialTimelineSettings, today: Date): SceneVitals {
    const fm = rawFrontmatter ? normalizeFrontmatterKeys(rawFrontmatter, getActiveFrontmatterMappings(settings)) : {};
    const stages = Object.keys(settings.publishStageColors);
    const rawStage = frontmatterValueToText(Array.isArray(fm['Publish Stage']) ? fm['Publish Stage'][0] : fm['Publish Stage']).trim().toLowerCase();
    const stage = stages.find(candidate => candidate.toLowerCase() === rawStage) ?? (stages.includes('Zero') ? 'Zero' : (stages[0] ?? 'Zero'));
    const complete = normalizeStatus(fm.Status) === 'Completed';
    return {
        stage,
        pending: fullText(fm['Pending Edits']),
        synopsis: fullText(fm.Synopsis),
        summary: fullText(fm.Summary),
        complete,
        due: dueStatus(fm.Due, complete, today),
    };
}

/** The median of some numbers, or null for none. */
export function medianOf(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A scene's Words bar: the median sits at the midpoint and a full bar is twice it; `over` past that. */
export function wordBar(words: number, median: number): { fill: number; over: boolean } {
    if (median <= 0) return { fill: 0, over: false };
    const ratio = words / (2 * median);
    return { fill: Math.min(1, Math.max(0, ratio)), over: ratio > 1 };
}

// ── Lens ───────────────────────────────────────────────────────────────

/**
 * A view filter's identity, so a change to it can be told from a redraw; null
 * when it holds no condition (none set, or only empty groups).
 */
export function filterSignature(filter: unknown): string | null {
    const hasCondition = (node: unknown): boolean => {
        if (typeof node === 'string') return node.trim().length > 0;
        if (!node || typeof node !== 'object') return false;
        return Object.values(node).some(value => Array.isArray(value) ? value.some(hasCondition) : hasCondition(value));
    };
    return hasCondition(filter) ? JSON.stringify(filter) : null;
}

// ── Coloring the timeline by a column ──────────────────────────────────

/** Maximum categories painted simultaneously; every category remains available in the chooser. */
export const MAX_COLOR_VALUES = 8;

/** A value that reads as a number (an act, a chapter): the legend lists these in order. */
const NUMBER_VALUE = /^-?\d+(\.\d+)?$/;

/** A template field nobody filled in, such as "{{Character}}": no value at all. */
const UNFILLED_PLACEHOLDER = /^\{\{[^{}]*\}\}$/;

export interface ColoringCategory { value: string; count: number }
export type ColoringMatch = 'all' | 'any';
export type ColoringPlan =
    | { kind: 'ok'; values: Map<string, string>; legend: Array<ColoringCategory & { colorIndex: number }>; members: Map<string, string[]>; categories: ColoringCategory[]; multiValue: boolean }
    | { kind: 'none' };

/** Discover every list member; paint up to eight chosen categories, keeping author list order per cell. */
export function planColoring(
    rows: Array<{ path: string; value: unknown }>,
    max: number = MAX_COLOR_VALUES,
    slotOrder: number[] = [],
    palette?: readonly string[],
): ColoringPlan {
    const values = new Map<string, string>();
    const members = new Map<string, string[]>();
    const counts = new Map<string, number>();
    let multiValue = false;
    for (const { path, value } of rows) {
        const items = [...new Set((Array.isArray(value) ? value : [value])
            .map(item => formatHoverMetadataValue(item).trim())
            .filter(text => text !== '' && !UNFILLED_PLACEHOLDER.test(text)))];
        if (items.length === 0) continue;
        multiValue ||= Array.isArray(value);
        members.set(path, items);
        for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    if (counts.size === 0) return { kind: 'none' };
    const categories = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, count }));
    const chosen = palette === undefined ? categories.slice(0, max).map(entry => entry.value)
        : [...new Set(palette)].filter(value => counts.has(value)).slice(0, max);
    const legend = chosen.map((value, index) => ({ value, count: counts.get(value)!, colorIndex: slotOrder[index] ?? index }));
    if (legend.every(entry => NUMBER_VALUE.test(entry.value))) legend.sort((a, b) => Number(a.value) - Number(b.value));
    for (const [path, items] of members) {
        const lead = items.find(item => chosen.includes(item));
        if (lead !== undefined) values.set(path, lead);
    }
    return { kind: 'ok', values, legend, members, categories, multiValue };
}

/** Narrow list membership by all picks (characters together), or any pick (alternative periods/values). */
export function narrowColoring(members: Map<string, string[]>, picks: readonly string[], match: ColoringMatch = 'all'): Map<string, string> {
    const values = new Map<string, string>();
    for (const [path, items] of members) {
        const matches = match === 'all' ? picks.every(pick => items.includes(pick)) : picks.some(pick => items.includes(pick));
        if (!matches) continue;
        const lead = items.find(item => picks.includes(item));
        if (lead !== undefined) values.set(path, lead);
    }
    return values;
}

/** View-owned coloring state. Unversioned pre-1 selections are read at this boundary. */
export interface SavedColoring {
    schemaVersion: 1;
    property: string;
    picks: string[];
    palette?: string[];
    match?: ColoringMatch;
    grouping?: DateGrouping;
}

/** One planner serves the saved view and its draft editor. */
export function planConfiguredColoring(rows: Array<{ path: string; value: unknown; complete?: boolean }>, config: Pick<SavedColoring, 'palette' | 'grouping'> & { picks?: readonly string[] }, slots: number[], today: Date): ColoringPlan {
    const grouped = config.grouping ? dateColoringRows(rows, config.grouping, today) : rows;
    let plan = planColoring(grouped, MAX_COLOR_VALUES, slots, config.palette);
    // Preserve old saved picks when complete list discovery adds more than eight categories.
    if (plan.kind === 'ok' && config.palette === undefined && config.picks?.length) {
        const available = new Set(plan.categories.map(entry => entry.value));
        const chosen = [...new Set([...config.picks.filter(pick => available.has(pick)), ...plan.legend.map(entry => entry.value)])].slice(0, MAX_COLOR_VALUES);
        plan = planColoring(grouped, MAX_COLOR_VALUES, slots, chosen);
    }
    if (plan.kind === 'ok' && config.grouping) {
        plan.categories.sort((a, b) => compareDateCategories(a.value, b.value));
        plan.legend.sort((a, b) => compareDateCategories(a.value, b.value));
    }
    return plan;
}

export function readSavedColoring(raw: unknown): SavedColoring | null {
    if (!raw || typeof raw !== 'object' || !('property' in raw) || typeof raw.property !== 'string' || raw.property === '') return null;
    if ('schemaVersion' in raw && raw.schemaVersion !== 1) return null;
    const names = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((pick): pick is string => typeof pick === 'string'))] : [];
    const result: SavedColoring = { schemaVersion: 1, property: raw.property, picks: names('picks' in raw ? raw.picks : undefined) };
    if ('palette' in raw) {
        if (!Array.isArray(raw.palette) || raw.palette.length === 0 || raw.palette.length > MAX_COLOR_VALUES) return null;
        result.palette = names(raw.palette);
        if (result.palette.length === 0) return null;
    }
    if ('match' in raw) {
        if (raw.match !== 'all' && raw.match !== 'any') return null;
        result.match = raw.match;
    }
    if ('grouping' in raw) {
        const grouping = readDateGrouping(raw.grouping);
        if (!grouping) return null;
        result.grouping = grouping;
    }
    return result;
}

/** Click a value in the key: pick it, or drop it when it is picked. */
export function toggledPicks(picks: readonly string[], value: string): string[] {
    return picks.includes(value) ? picks.filter(pick => pick !== value) : [...picks, value];
}

/** Below this chroma a ring color reads as grey, too close to an uncolored scene. */
const MIN_COLORING_CHROMA = 20;

/**
 * The ring palette's slots in the order coloring should use them, so a few
 * values get colors that are easy to tell apart: the most vivid color first,
 * then each time the color farthest from those already taken. Near-greys (and
 * anything unreadable) come last, in slot order.
 */
export function distinctColorSlots(palette: string[]): number[] {
    const colors = palette.map((color, slot) => ({ slot, lab: hexToLab(color) }));
    const pool = colors.filter((color): color is { slot: number; lab: Lab } => color.lab !== null && chroma(color.lab) >= MIN_COLORING_CHROMA);
    const order: Array<{ slot: number; lab: Lab }> = [];
    while (pool.length > 0) {
        let best = 0;
        let bestScore = -1;
        pool.forEach((color, index) => {
            const score = order.length === 0
                ? chroma(color.lab)
                : Math.min(...order.map(taken => labDistance(taken.lab, color.lab)));
            if (score > bestScore) { best = index; bestScore = score; }
        });
        order.push(...pool.splice(best, 1));
    }
    const taken = new Set(order.map(color => color.slot));
    return [...order.map(color => color.slot), ...colors.filter(color => !taken.has(color.slot)).map(color => color.slot)];
}

type Lab = { l: number; a: number; b: number };

/** CIE L*a*b* (D65) for a hex color, or null if it isn't one. */
function hexToLab(hex: string): Lab | null {
    const rgb = hexToRgb(hex.trim());
    if (!rgb) return null;
    const linear = (channel: number): number => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = linear(rgb.r);
    const g = linear(rgb.g);
    const b = linear(rgb.b);
    const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function chroma(lab: Lab): number {
    return Math.hypot(lab.a, lab.b);
}

function labDistance(a: Lab, b: Lab): number {
    return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}
