/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Active book notes — reads the active book's Book Details note and its
 * matter notes from the metadata cache. Read-only; creation lives in
 * `starterSetup.ts`.
 */

import type RadialTimelinePlugin from '../main';
import type { BookMeta } from '../types';
import type { MatterNoteSummary } from '../utils/bookPagesResolver';
import { getActiveBookExportContext } from '../utils/exportContext';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { isPathInFolderScope } from '../utils/pathScope';
import { normalizeMatterClassValue, parseMatterMetaFromFrontmatter } from '../utils/matterMeta';
import { parseBookMetaFromFrontmatter } from '../services/PublishingValidationService';

export interface ActiveBookMetaStatus {
    found: boolean;
    path?: string;
    warning?: string;
    sourceFolder?: string;
    bookMeta?: BookMeta;
}

/** The first `Class: BookMeta` note (by path) inside the active book's source folder. */
export function getActiveBookMetaStatus(plugin: RadialTimelinePlugin): ActiveBookMetaStatus {
    const sourceFolder = getActiveBookExportContext(plugin).sourceFolder.trim();
    if (!sourceFolder) return { found: false, sourceFolder };

    const mappings = getActiveFrontmatterMappings(plugin.settings);
    const candidates = plugin.app.vault.getMarkdownFiles()
        .filter(file => isPathInFolderScope(file.path, sourceFolder))
        .map(file => {
            const cache = plugin.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) return null;
            const normalized = normalizeFrontmatterKeys(cache.frontmatter, mappings);
            if (normalized.Class !== 'BookMeta') return null;
            return { path: file.path, meta: parseBookMetaFromFrontmatter(normalized, file.path) };
        })
        .filter((entry): entry is { path: string; meta: BookMeta } => !!entry)
        .sort((a, b) => a.path.localeCompare(b.path));

    if (!candidates.length) return { found: false, sourceFolder };
    const selected = candidates[0];
    return {
        found: true,
        path: selected.path,
        sourceFolder,
        bookMeta: selected.meta,
        ...(candidates.length > 1 ? { warning: `Multiple Book Details notes found. Using: ${selected.path}` } : {})
    };
}

/**
 * Matter note summaries (role, BodyMode, path, title) for the Book Pages
 * resolver, in numeric-prefix order so file order matches authoring intent
 * (`0.1 Alpha Readers` < `0.2 Title Page` < `0.10 Foo`). Cheap enough for a
 * settings render: it reads only the metadata cache.
 */
export function getActiveBookMatterNoteSummaries(plugin: RadialTimelinePlugin): MatterNoteSummary[] {
    const sourceFolder = getActiveBookExportContext(plugin).sourceFolder.trim();
    if (!sourceFolder) return [];
    const mappings = getActiveFrontmatterMappings(plugin.settings);
    const result: MatterNoteSummary[] = [];
    const files = plugin.app.vault.getMarkdownFiles()
        .filter(file => isPathInFolderScope(file.path, sourceFolder))
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
    for (const file of files) {
        const raw = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!raw) continue;
        const normalized = normalizeFrontmatterKeys(raw, mappings);
        const matterClass = normalizeMatterClassValue(normalized.Class);
        if (!matterClass) continue;
        // Role may be empty — the resolver tries filename inference, then
        // surfaces the note as a custom page if no canonical role matches.
        const role = typeof normalized.Role === 'string' ? normalized.Role.trim() : '';
        const bodyMode = typeof normalized.BodyMode === 'string' && normalized.BodyMode.trim().toLowerCase() === 'latex'
            ? 'latex'
            : 'plain';
        const side: 'frontmatter' | 'backmatter' = matterClass === 'backmatter' ? 'backmatter' : 'frontmatter';
        // Only an explicit Enabled:false disables the note; absence/true keep it
        // resolved normally (parsed via the same helper the export path uses).
        const enabled = parseMatterMetaFromFrontmatter(normalized)?.enabled;
        result.push({
            role,
            path: file.path,
            title: file.basename,
            bodyMode,
            side,
            ...(enabled === false ? { enabled: false } : {})
        });
    }
    return result;
}
