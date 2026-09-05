/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Repairing existing beat notes against a custom beat set: which notes get
 * their Act and Beat Model stamped, and the write that does it.
 */

import type { App, TFile } from 'obsidian';
import type { BeatDefinition } from '../types/settings';
import type { BeatSystemStructuralStatus } from './types';
import { normalizeBeatTitle } from './beatSystemStatus';

export interface BeatNoteMergeUpdate {
    file: TFile;
    act: number;
    /** The note matched by title but carries no Beat Model; the write adds it. */
    needsBeatModelFix: boolean;
}

export interface BeatNoteMergePlan {
    updates: BeatNoteMergeUpdate[];
    /** Beat names that could not be merged because the set or the vault has more than one of them. */
    duplicates: string[];
}

/**
 * Pair each beat with the one note that matches it. A beat name that appears
 * twice in the set, or matches two notes, is skipped and reported; the
 * author resolves those by hand.
 */
export function planBeatNoteMerge(beats: BeatDefinition[], structuralStatus: BeatSystemStructuralStatus): BeatNoteMergePlan {
    const keyCounts = new Map<string, number>();
    beats.forEach(beat => {
        const key = normalizeBeatTitle(beat.name);
        if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    });

    const updates: BeatNoteMergeUpdate[] = [];
    const duplicates: string[] = [];
    beats.forEach(beat => {
        const key = normalizeBeatTitle(beat.name);
        if (!key) return;
        if ((keyCounts.get(key) ?? 0) > 1) {
            duplicates.push(beat.name);
            return;
        }
        let matches = structuralStatus.matches.activeByBeatKey.get(key);
        let needsBeatModelFix = false;
        if (!matches || matches.length === 0) {
            matches = structuralStatus.matches.missingModelByBeatKey.get(key);
            needsBeatModelFix = true;
        }
        if (!matches || matches.length === 0) return;
        if (matches.length > 1) {
            duplicates.push(beat.name);
            return;
        }
        updates.push({ file: matches[0].file, act: beat.act, needsBeatModelFix });
    });
    return { updates, duplicates };
}

/** Stamp Act, Beat Model, and (when absent) Class on every planned note. */
export async function applyBeatNoteMerge(app: App, updates: BeatNoteMergeUpdate[], beatModelName: string): Promise<void> {
    for (const update of updates) {
        await app.fileManager.processFrontMatter(update.file, (fm: Record<string, unknown>) => {
            fm['Act'] = update.act;
            fm['Beat Model'] = beatModelName;
            if (!fm['Class']) fm['Class'] = 'Beat';
        });
    }
}
