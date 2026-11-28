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
 * The scenes in a beat's stage. A beat is a moment in the scene just before its marker (its own
 * scene; Save the Cat: "a beat = moment"), and its stage runs from that scene up to, but not
 * including, the next beat's own scene. The last beat's stage runs to the end of the book. A
 * beat with no scene before it starts with the scenes after it.
 */
export function beatStagePaths(ring: readonly RingItem[], beatPath: string): string[] {
    const start = ring.findIndex(item => item.kind === 'Beat' && item.path === beatPath);
    if (start < 0) return [];
    const stage: string[] = [];
    const own = ring.slice(0, start).reverse().find(item => item.kind === 'Scene');
    if (own) stage.push(own.path);
    const following: string[] = [];
    let nextBeat = false;
    for (const item of ring.slice(start + 1)) {
        if (item.kind === 'Beat') { nextBeat = true; break; }
        following.push(item.path);
    }
    // The scene just before the next beat is that beat's own scene.
    if (nextBeat) following.pop();
    return [...stage, ...following];
}
