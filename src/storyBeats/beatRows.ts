/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { BeatDefinition } from '../types/settings';
import { frontmatterValueToText } from '../utils/frontmatter';
import { normalizeBeatNameInput } from '../utils/beatsInputNormalize';
import { clampBeatAct } from './beatSystemStatus';

/**
 * One beat row from either the object form or the legacy "Name[act]" string.
 * Unparseable input is an empty row, never a throw: the list editor shows it
 * as a blank line the author can fix.
 */
export function parseBeatRow(item: unknown): BeatDefinition {
    if (typeof item === 'object' && item !== null && (item as { name?: unknown }).name) {
        const obj = item as { name?: unknown; act?: unknown; purpose?: unknown; id?: unknown; range?: unknown };
        const objPurpose = typeof obj.purpose === 'string' ? obj.purpose.trim() : '';
        const objRange = typeof obj.range === 'string' ? obj.range.trim() : undefined;
        return {
            name: normalizeBeatNameInput(frontmatterValueToText(obj.name), ''),
            act: typeof obj.act === 'number' ? obj.act : 1,
            purpose: objPurpose || undefined,
            id: typeof obj.id === 'string' ? obj.id : undefined,
            range: objRange || undefined
        };
    }
    const raw = normalizeBeatNameInput(frontmatterValueToText(item), '');
    if (!raw) return { name: '', act: 1 };
    const m = raw.match(/^(.*?)\[(\d+)\]$/);
    if (m) {
        const actNum = parseInt(m[2], 10);
        return { name: normalizeBeatNameInput(m[1], ''), act: !Number.isNaN(actNum) ? actNum : 1 };
    }
    return { name: raw, act: 1 };
}

/** Stable order by act, each act's beats in their given order, acts clamped to the count. */
export function orderBeatsByAct(beats: BeatDefinition[], maxActs: number): BeatDefinition[] {
    const beatsByAct: BeatDefinition[][] = Array.from({ length: maxActs }, () => []);
    beats.forEach(beat => {
        const actNum = clampBeatAct(beat.act, maxActs);
        beatsByAct[actNum - 1].push({ ...beat, act: actNum });
    });
    return beatsByAct.flat();
}
