/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Angle normalisation. Two contracts exist because callers need different
 * ranges: differences and deltas want a signed angle centred on zero;
 * positions on the ring want an unsigned angle from the ring origin. Pick
 * the one that names what you mean; never re-implement either inline.
 */

const TWO_PI = Math.PI * 2;

/** Fold an angle into (−π, π]. Use for deltas and "how far apart" comparisons. */
export function normalizeAngleSigned(angle: number): number {
    let normalized = angle % TWO_PI;
    if (normalized > Math.PI) normalized -= TWO_PI;
    else if (normalized <= -Math.PI) normalized += TWO_PI;
    return normalized;
}

/** Fold an angle into [0, 2π). Use for positions on the ring. */
export function normalizeAngleUnsigned(angle: number): number {
    const normalized = angle % TWO_PI;
    return normalized < 0 ? normalized + TWO_PI : normalized;
}
