/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Auditor - Chronology Helpers
 */

import type { TimelineAuditSceneInput } from './types';

export interface TimelineAuditChronologyEntry {
    input: TimelineAuditSceneInput;
    chronologyPosition: number;
}

export function compareAuditInputsByChronology(
    a: TimelineAuditSceneInput,
    b: TimelineAuditSceneInput
): number {
    const aTime = a.parsedWhen?.getTime() ?? Number.NaN;
    const bTime = b.parsedWhen?.getTime() ?? Number.NaN;
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);

    if (aValid && bValid) {
        if (aTime !== bTime) return aTime - bTime;
        return a.manuscriptOrderIndex - b.manuscriptOrderIndex;
    }

    if (aValid && !bValid) return -1;
    if (!aValid && bValid) return 1;
    return a.manuscriptOrderIndex - b.manuscriptOrderIndex;
}

export function buildChronologyEntries(inputs: TimelineAuditSceneInput[]): TimelineAuditChronologyEntry[] {
    return inputs
        .filter((input) => input.whenValid && input.parsedWhen instanceof Date)
        .slice()
        .sort(compareAuditInputsByChronology)
        .map((input, index) => ({
            input,
            chronologyPosition: index + 1
        }));
}

export function buildChronologyPositionMap(inputs: TimelineAuditSceneInput[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const entry of buildChronologyEntries(inputs)) {
        map.set(entry.input.path, entry.chronologyPosition);
    }
    return map;
}
