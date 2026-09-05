import { normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { systemFolderPath } from './systemFolder';

export function resolveManuscriptOutputFolder(plugin: RadialTimelinePlugin): string {
    return resolveExportOutputFolder(plugin);
}

export async function ensureManuscriptOutputFolder(plugin: RadialTimelinePlugin): Promise<string> {
    const folder = resolveManuscriptOutputFolder(plugin);
    try { await plugin.app.vault.createFolder(folder); } catch { /* folder may already exist */ }
    return folder;
}

export function resolveOutlineOutputFolder(plugin: RadialTimelinePlugin): string {
    return resolveExportOutputFolder(plugin);
}

export async function ensureOutlineOutputFolder(plugin: RadialTimelinePlugin): Promise<string> {
    const folder = resolveOutlineOutputFolder(plugin);
    try { await plugin.app.vault.createFolder(folder); } catch { /* folder may already exist */ }
    return folder;
}

export function resolveExportOutputFolder(plugin: RadialTimelinePlugin): string {
    // User-configurable destination for manuscript, outline, and cue-card
    // exports. Exports are written through the Obsidian vault API, so the
    // folder must stay inside the vault: an absolute path or a value that
    // escapes the vault root falls back to the canonical default.
    const fallback = normalizePath(DEFAULT_SETTINGS.manuscriptOutputFolder || systemFolderPath('Export'));
    const configured = (plugin.settings.manuscriptOutputFolder || '').trim();
    if (!configured) return fallback;
    const normalized = normalizePath(configured);
    if (escapesVaultRoot(normalized)) return fallback;
    return normalized;
}

/**
 * True when a normalized vault-relative path is absolute (POSIX `/...` or a
 * Windows drive letter like `G:/...`) or climbs above the vault root (`..`).
 * Exports are written through the vault API, so such targets are rejected.
 * Note: Obsidian's `normalizePath` strips leading slashes, so the drive-letter
 * and `..` checks do the real work for hand-entered absolute paths.
 */
export function escapesVaultRoot(normalizedPath: string): boolean {
    return !normalizedPath
        || normalizedPath.startsWith('/')
        || /^[A-Za-z]:/.test(normalizedPath)
        || normalizedPath === '..'
        || normalizedPath.startsWith('../')
        || normalizedPath.includes('/../');
}
