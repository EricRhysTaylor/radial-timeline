/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Canonical vault system folder
 * -----------------------------
 * Every file the plugin writes into the author's vault on its own behalf lives
 * under ONE visible top-level folder. Authors learn a single place to look, and
 * the plugin never scatters second top-level folders beside it.
 *
 * The root name is fixed, not a setting: it is the folder authors are told about
 * in docs, release notes, and the "New Radial Timeline Folder" refactor alert,
 * and several of its subfolders (Social, Inquiry, Recover, Logs) are addressed
 * by absolute vault path from multiple features. Individual subfolders MAY be
 * user-configurable — `manuscriptOutputFolder` (Export) and `pandocFolder`
 * (Pandoc) are — and those are resolved through their own settings resolvers,
 * never by re-joining this root.
 *
 * Deliberately dependency-free (no `obsidian` import) so settings defaults and
 * pure path builders can use it; callers that hand a path to the vault API
 * normalize it themselves.
 */

/** The plugin's single top-level vault folder. Never write a sibling of this. */
export const RT_SYSTEM_FOLDER = 'Radial Timeline';

/**
 * Join path segments under the canonical system folder.
 * `systemFolderPath('Logs', 'Content')` -> `Radial Timeline/Logs/Content`.
 */
export function systemFolderPath(...segments: string[]): string {
    return [RT_SYSTEM_FOLDER, ...segments].join('/');
}
