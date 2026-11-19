/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Which rows of Release scenes can be checked, and what the checked rows add
 * up to. Pure: the list dialog keeps the checked keys and asks this.
 */

import type { SceneReleaseStatus } from '../communityShare/communityShareClient';
import type { SceneReleaseRow } from '../communityShare/sceneReleaseVault';

export type SceneBatchKind = 'release' | 'takeDown';

/** A row's batch: release for an unreleased scene with an id, take down for any release, null for neither. */
export function batchKindOf(row: SceneReleaseRow): SceneBatchKind | null {
    if (row.release) return 'takeDown';
    if (row.state === 'not_released' && row.scene?.sceneId) return 'release';
    return null;
}

/**
 * The key a checked row is held by. A release by its release id, an unreleased
 * scene by its scene id, so a scene released since is a different row.
 */
export function batchKeyOf(row: SceneReleaseRow): string | null {
    if (row.release) return `release:${row.release.id}`;
    if (row.state === 'not_released' && row.scene?.sceneId) return `scene:${row.scene.sceneId}`;
    return null;
}

/** How many more scenes this account can release now. */
export function releasePlacesLeft(status: Pick<SceneReleaseStatus, 'limit' | 'releases'>): number {
    return Math.max(0, status.limit - status.releases.length);
}

/**
 * Whether the row's checkbox can be checked now. The same rules as its own
 * button: a new release needs a place left and good standing; a take-down is
 * always the author's to do.
 */
export function batchSelectable(row: SceneReleaseRow, status: Pick<SceneReleaseStatus, 'limit' | 'releases' | 'standing'>): boolean {
    const kind = batchKindOf(row);
    if (kind === 'takeDown') return true;
    if (kind === 'release') return status.standing === null && releasePlacesLeft(status) > 0;
    return false;
}

export interface SceneBatchSelection {
    /** Checked unreleased scenes, in list order. */
    release: SceneReleaseRow[];
    /** Checked released scenes, in list order. */
    takeDown: SceneReleaseRow[];
}

/** The checked rows, split by batch, in list order. A key with no selectable row is ignored. */
export function batchSelection(
    rows: readonly SceneReleaseRow[],
    checked: ReadonlySet<string>,
    status: Pick<SceneReleaseStatus, 'limit' | 'releases' | 'standing'>
): SceneBatchSelection {
    const selection: SceneBatchSelection = { release: [], takeDown: [] };
    for (const row of rows) {
        const key = batchKeyOf(row);
        const kind = batchKindOf(row);
        if (!key || !kind || !checked.has(key) || !batchSelectable(row, status)) continue;
        selection[kind].push(row);
    }
    return selection;
}

/** The keys still on screen and selectable: a reload drops the rest. */
export function keepSelectable(
    rows: readonly SceneReleaseRow[],
    checked: ReadonlySet<string>,
    status: Pick<SceneReleaseStatus, 'limit' | 'releases' | 'standing'>
): Set<string> {
    const { release, takeDown } = batchSelection(rows, checked, status);
    return new Set(keysOf([...release, ...takeDown]));
}

function keysOf(rows: readonly SceneReleaseRow[]): string[] {
    return rows.flatMap(row => {
        const key = batchKeyOf(row);
        return key ? [key] : [];
    });
}

/** Every selectable key of one batch kind: Select all unreleased / Select all released. */
export function selectableKeys(
    rows: readonly SceneReleaseRow[],
    kind: SceneBatchKind,
    status: Pick<SceneReleaseStatus, 'limit' | 'releases' | 'standing'>
): string[] {
    return keysOf(rows.filter(row => batchKindOf(row) === kind && batchSelectable(row, status)));
}
