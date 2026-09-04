import { normalizePath } from 'obsidian';

/**
 * Strict folder-scope check.
 * Returns true only when `folderPath` is explicitly set and `path` is inside it.
 * Uses segment-aware matching so sibling folders with common prefixes do not match.
 */
export function isPathInExplicitFolderScope(path: string, folderPath: string): boolean {
    const normalizedFolder = normalizePath((folderPath || '').trim());
    if (!normalizedFolder || normalizedFolder === '/' || normalizedFolder === '.') {
        return false;
    }

    const normalizedPath = normalizePath(path);
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

/**
 * Alias retained for compatibility.
 * IMPORTANT: this is now strict. Empty folder path is NOT in scope.
 */
export const isPathInFolderScope = isPathInExplicitFolderScope;
