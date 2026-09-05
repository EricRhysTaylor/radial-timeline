/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/** Clamp `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
