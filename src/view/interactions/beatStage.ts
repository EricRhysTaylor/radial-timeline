/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/** An item on the timeline's outer ring, in book order. */
export interface RingItem {
    kind: 'Scene' | 'Beat';
    path: string;
}

/**
 * The scenes in a beat's stage. A beat marker opens its stage, which runs through the scenes
 * after it up to the next beat; the last beat's stage runs to the end of the book. A beat
 * followed straight away by another has an empty stage.
 */
export function beatStagePaths(ring: readonly RingItem[], beatPath: string): string[] {
    const start = ring.findIndex(item => item.kind === 'Beat' && item.path === beatPath);
    if (start < 0) return [];
    const stage: string[] = [];
    for (const item of ring.slice(start + 1)) {
        if (item.kind === 'Beat') break;
        stage.push(item.path);
    }
    return stage;
}
