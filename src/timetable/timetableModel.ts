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
}

const MAIN_PLOT = 'Main Plot';

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
        subplots: kind === 'scene' && subplots.length === 0 ? [MAIN_PLOT] : (kind === 'beat' || kind === 'otherClass' ? [] : subplots),
    };
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

/** A row, or the act divider drawn before the first row of a new act inside a group. */
export type TimetableLine =
    | { type: 'row'; row: TimetableRow }
    | { type: 'act'; act: number | null };

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
