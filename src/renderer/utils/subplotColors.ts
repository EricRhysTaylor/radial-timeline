/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Subplot colour lookup. ThemeService projects settings.subplotColors onto
 * `--rt-subplot-colors-N` on every RT document; everything that needs a
 * subplot colour at render or interaction time reads it from here.
 */

export const SUBPLOT_COLOR_SLOTS = 16;

/** Wrap any integer onto the colour slots; non-finite input lands on slot 0. */
export function normalizeSubplotColorIndex(index: number): number {
    if (!Number.isFinite(index)) return 0;
    return ((Math.trunc(index) % SUBPLOT_COLOR_SLOTS) + SUBPLOT_COLOR_SLOTS) % SUBPLOT_COLOR_SLOTS;
}

/**
 * The colour for a subplot slot, read from the document's CSS variable.
 * A missing variable means the theme variables were never applied to this
 * document; that is a setup fault and throws rather than painting a stand-in.
 */
export function readSubplotColor(doc: Document, index: number): string {
    const varName = `--rt-subplot-colors-${normalizeSubplotColorIndex(index)}`;
    const value = getComputedStyle(doc.documentElement).getPropertyValue(varName).trim();
    if (!value) {
        throw new Error(`${varName} is not defined; subplot colours were not applied to this document.`);
    }
    return value;
}
