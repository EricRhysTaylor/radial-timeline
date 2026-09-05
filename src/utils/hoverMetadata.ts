/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Hover metadata — the single source of truth for *which* frontmatter fields
 * the timeline displays and *how* their values are rendered.
 *
 * This exists because the searchable set must equal the visible set. The hover
 * synopsis and the search index have to agree on both questions, or the author
 * gets matches they cannot see: a scene lights up yellow, they hover, and
 * nothing is highlighted. Previously the renderer answered both questions with
 * private closures inside SynopsisManager while SearchService hardcoded a
 * different, shorter list — so any custom field an author enabled was visible
 * but unsearchable.
 *
 * Consumers: SynopsisManager (rendering) and SearchService (indexing). Neither
 * may re-derive these answers locally.
 */

import type { RadialTimelineSettings, HoverMetadataField } from '../types/settings';
import type { TimelineItem } from '../types';
import { getBeatConfigForItem } from './beatsTemplates';

/**
 * Resolve the enabled hover-metadata fields for an item.
 *
 * Item type decides which configured list applies: beats and plots carry their
 * own per-model field set, backdrops carry theirs, and everything else uses the
 * scene list.
 */
export function resolveHoverMetadataFields(
    settings: RadialTimelineSettings,
    scene: TimelineItem
): HoverMetadataField[] {
    const isBeatItem = scene.itemType === 'Beat' || scene.itemType === 'Plot';
    const isBackdropItem = scene.itemType === 'Backdrop';

    if (isBeatItem) {
        const rawBeatModel = scene.rawFrontmatter?.['Beat Model'];
        const beatModel = typeof rawBeatModel === 'string' && rawBeatModel.trim().length > 0
            ? rawBeatModel
            : (typeof scene['Beat Model'] === 'string' && scene['Beat Model'].trim().length > 0
                ? scene['Beat Model']
                : undefined);
        return getBeatConfigForItem(settings, beatModel).beatHoverMetadataFields
            .filter(field => field.enabled);
    }

    const source = isBackdropItem
        ? (settings.backdropHoverMetadataFields || [])
        : (settings.hoverMetadataFields || []);
    return source.filter(field => field.enabled);
}

/**
 * Read a frontmatter value by key, tolerating the punctuation and casing drift
 * that accumulates in hand-written YAML (`Point of View` / `point-of-view` /
 * `point_of_view` all resolve to the same field).
 */
export function readFrontmatterFieldValue(
    fm: Record<string, unknown> | undefined,
    key: string
): unknown {
    if (!fm) return undefined;
    if (Object.prototype.hasOwnProperty.call(fm, key)) return fm[key];
    const target = key.toLowerCase().replace(/[\s_-]/g, '');
    for (const [fmKey, value] of Object.entries(fm)) {
        if (fmKey.toLowerCase().replace(/[\s_-]/g, '') === target) return value;
    }
    return undefined;
}

/**
 * Format a `When` date the way the timeline displays it.
 *
 * Strict by design: an invalid Date is a data problem the caller must not paper
 * over, so it throws rather than silently rendering an empty line. Callers that
 * cannot vouch for the value should check `instanceof Date` first.
 *
 * @returns e.g. "Aug 1, 1812 @ 8AM", "Apr 6, 1812 @ Noon", "Apr 6, 1812 @ Midnight"
 */
export function formatDateForDisplay(when: Date | undefined): string {
    if (!when) return '';
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) {
        throw new Error('formatDateForDisplay requires a valid Date object');
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[when.getMonth()];
    const day = when.getDate();
    const year = when.getFullYear();
    const hours = when.getHours();
    const minutes = when.getMinutes();

    let dateStr = `${month} ${day}, ${year}`;

    if (hours === 0 && minutes === 0) {
        dateStr += ' @ Midnight';
    } else if (hours === 12 && minutes === 0) {
        dateStr += ' @ Noon';
    } else {
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 === 0 ? 12 : hours % 12;
        if (minutes === 0) {
            dateStr += ` @ ${displayHours}${period}`;
        } else {
            dateStr += ` @ ${displayHours}:${String(minutes).padStart(2, '0')}${period}`;
        }
    }

    return dateStr;
}

/**
 * Render a frontmatter value as the hover synopsis displays it.
 *
 * Search must match *this* string, not the raw YAML. The author sees `Diego`,
 * not `[[Place/Diego]]`; matching the raw value would let them hit on `Place`,
 * light up the scene, and find nothing highlighted when they hover.
 */
export function formatHoverMetadataValue(value: unknown): string {
    if (value === null || value === undefined) return '';

    if (Array.isArray(value)) {
        return value.map(item => formatHoverMetadataValue(item)).join(', ');
    }

    // A valid Date renders in the timeline's own date format.
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return value.toString().trim();
        return formatDateForDisplay(value);
    }

    let str: string;
    if (typeof value === 'string') {
        str = value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        str = String(value);
    } else if (typeof value === 'object') {
        try {
            str = JSON.stringify(value);
        } catch {
            str = '';
        }
    } else {
        str = '';
    }

    // [[Path/Name|Alias]] -> Name — the display name is what the author reads.
    str = str.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_match, link: string) => {
        const parts = link.split('/');
        return parts[parts.length - 1];
    });

    return str.trim();
}

/**
 * Every enabled hover-metadata value for an item, formatted for display.
 * Empty values are omitted — the hover synopsis skips them too.
 */
export function collectHoverMetadataText(
    settings: RadialTimelineSettings,
    scene: TimelineItem
): string[] {
    const out: string[] = [];
    for (const field of resolveHoverMetadataFields(settings, scene)) {
        const raw = readFrontmatterFieldValue(scene.rawFrontmatter, field.key);
        if (raw === undefined || raw === null || raw === '') continue;
        if (Array.isArray(raw) && raw.length === 0) continue;
        const text = formatHoverMetadataValue(raw);
        if (text) out.push(text);
    }
    return out;
}
