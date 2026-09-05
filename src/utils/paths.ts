/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Pure path-string helpers. Accept either separator so vault paths and
 * OS paths behave the same; never touch the filesystem.
 */

/** The last path segment (file or folder name), or the input when it has no separator. */
export function basename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

/** The last path segment without its final extension ("0.2 Title Page.md" → "0.2 Title Page"). */
export function fileStem(path: string): string {
    const name = basename(path);
    const extension = name.match(/\.([^.]+)$/);
    return extension ? name.slice(0, -extension[0].length) : name;
}
