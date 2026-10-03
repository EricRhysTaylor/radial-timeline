/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Lucide's page glyph (`file`, `file-text`, `file-x-corner`) as Obsidian
 * bundles it, in the icons' 24×24 space. The minimap draws the real icon
 * through <use>; the corpus strip needs the page in separate parts (outline,
 * fold, text lines, corner X) so each cell state can style them on its own.
 * Both read the geometry from here, so the corpus page and the minimap's
 * scan lines always land on the icon's own strokes.
 */

/** The page body's bounds inside the 24-unit icon box. */
export const LUCIDE_PAGE_BOUNDS = { x: 4, y: 2, width: 16, height: 20 } as const;

/** Page outline (`file`). */
export const LUCIDE_PAGE_BODY = 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z';

/** Page outline with the bottom-right corner left open for the X (`file-x-corner`). */
export const LUCIDE_PAGE_BODY_X_CORNER = 'M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5';

/** The folded corner (dog-ear). */
export const LUCIDE_PAGE_FOLD = 'M14 2v5a1 1 0 0 0 1 1h5';

/** The X `file-x-corner` draws in the open corner. */
export const LUCIDE_PAGE_X_MARK: readonly string[] = ['m15 17 5 5', 'm20 17-5 5'];

/** `file-text`'s three text lines, top to bottom: a short stub, then two full lines. */
export const LUCIDE_PAGE_TEXT_LINES: ReadonlyArray<{ x1: number; x2: number; y: number }> = [
    { x1: 8, x2: 10, y: 9 },
    { x1: 8, x2: 16, y: 13 },
    { x1: 8, x2: 16, y: 17 }
];

export function lucidePageLinePath(line: { x1: number; x2: number; y: number }): string {
    return `M${line.x2} ${line.y}H${line.x1}`;
}
