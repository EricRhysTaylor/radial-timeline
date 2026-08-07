/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Carrying a body-search match through to the opened scene.
 *
 * A yellow number square tells the author *which* scene matched; this tells them
 * *where*. Without it, body scope finds a hit in sixty thousand words of prose
 * and then leaves them to find it again by eye.
 */

import { TFile, type App } from 'obsidian';
import { extractBodyAfterFrontmatter } from '../utils/frontmatterDocument';
import { locateBodyEvidenceRanges } from './SceneBodyIndex';
import type { TimelineSearchState } from './searchState';
import type { OpenMatchHighlight } from '../utils/fileUtils';

/**
 * Build the highlight for a scene about to be opened, or `undefined` when there
 * is nothing to mark.
 *
 * Returns `undefined` — rather than an empty match list — when the evidence has
 * been edited away, so the scene opens normally instead of with a highlight
 * state that marks nothing.
 */
export async function buildSearchHighlight(
    app: App,
    file: TFile,
    search: TimelineSearchState
): Promise<OpenMatchHighlight | undefined> {
    if (!search.active) return undefined;

    const hit = search.hits.get(file.path);
    // Timeline-field hits carry no evidence: the match is already visible on the
    // timeline and in the hover synopsis, so there is nothing to point at in the
    // prose.
    if (!hit || hit.evidence.length === 0) return undefined;

    try {
        const content = await app.vault.cachedRead(file);
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        const body = extractBodyAfterFrontmatter(content, frontmatter ?? {});
        const matches = locateBodyEvidenceRanges(content, body, hit.evidence);
        if (matches.length === 0) return undefined;
        return { content, matches };
    } catch (error) {
        // Opening the scene matters more than highlighting inside it.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Search] Could not build highlight for "${file.path}": ${message}`);
        return undefined;
    }
}
