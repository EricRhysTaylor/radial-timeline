/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Scene prose, cached for body search.
 *
 * Holds the body text only — the YAML block is excluded by construction, so
 * enabling body scope never quietly starts matching metadata the author chose
 * not to display. The two search scopes stay disjoint.
 */

import { TFile, type App, type Vault, type MetadataCache } from 'obsidian';
import type { TimelineItem } from '../types';
import { extractBodyAfterFrontmatter } from '../utils/frontmatterDocument';

interface SceneBodyEntry {
    /** Modification time the cached body was read at; a change invalidates it. */
    mtime: number;
    body: string;
}

/**
 * Distinct matched substrings of `phrase` within `body`, case-insensitive.
 *
 * Returns the text **as it appears in the prose**, so a search for `coast`
 * yields `['Coast']` when that is how the author wrote it. Deliberately a
 * literal `indexOf` sweep rather than a regex: an author's apostrophes,
 * parentheses, and em dashes then need no escaping and mean exactly themselves,
 * matching the semantics timeline-field search already has.
 *
 * Distinct *variants* rather than one entry per occurrence, because that is
 * what survives editing. Storing surrounding context would break the moment the
 * author revised a nearby sentence; storing the matched text itself still
 * re-locates every occurrence when the scene is opened.
 */
export function findBodyMatches(body: string, phrase: string): string[] {
    if (!body || !phrase) return [];

    const haystack = body.toLowerCase();
    const needle = phrase.toLowerCase();
    const variants: string[] = [];

    let from = 0;
    for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        const asWritten = body.slice(at, at + phrase.length);
        if (!variants.includes(asWritten)) variants.push(asWritten);
        from = at + needle.length;
    }

    return variants;
}

/**
 * Character ranges to highlight for `evidence`, as offsets into `content`.
 *
 * Computed against the file **as it stands right now**, not against offsets
 * captured when the search ran — those go stale the moment the author edits the
 * scene, and a highlight landing on the wrong words is worse than none.
 * Evidence that no longer appears is simply skipped.
 *
 * Confined to the body. `extractBodyAfterFrontmatter` always returns a suffix of
 * `content`, so the body's start offset is the length difference — which keeps
 * "body scope searches prose only" true all the way through to the highlight,
 * rather than lighting up a stray occurrence inside the YAML.
 */
export function locateBodyEvidenceRanges(
    content: string,
    body: string,
    evidence: string[]
): Array<[number, number]> {
    if (!content || !body || evidence.length === 0) return [];

    const bodyOffset = content.length - body.length;
    const ranges: Array<[number, number]> = [];

    for (const passage of evidence) {
        if (!passage) continue;
        let from = 0;
        for (;;) {
            const at = body.indexOf(passage, from);
            if (at === -1) break;
            ranges.push([bodyOffset + at, bodyOffset + at + passage.length]);
            from = at + passage.length;
        }
    }

    // Obsidian walks these in order; overlapping ranges (one evidence string
    // containing another) would double-mark the same text.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) {
            last[1] = Math.max(last[1], range[1]);
            continue;
        }
        merged.push([range[0], range[1]]);
    }
    return merged;
}

export class SceneBodyIndex {
    private readonly vault: Vault;
    private readonly metadataCache: MetadataCache;
    private readonly entries = new Map<string, SceneBodyEntry>();

    constructor(app: App) {
        this.vault = app.vault;
        this.metadataCache = app.metadataCache;
    }

    /**
     * Read the bodies for `scenes`, reusing cached text whose file has not
     * changed. Returns a path → body map for the synchronous matching pass.
     */
    async load(scenes: TimelineItem[]): Promise<Map<string, string>> {
        const bodies = new Map<string, string>();
        let readCount = 0;
        let totalChars = 0;

        for (const scene of scenes) {
            if (!scene.path) continue;

            const file = this.vault.getAbstractFileByPath(scene.path);
            if (!(file instanceof TFile)) continue;

            const cached = this.entries.get(scene.path);
            if (cached && cached.mtime === file.stat.mtime) {
                bodies.set(scene.path, cached.body);
                totalChars += cached.body.length;
                continue;
            }

            try {
                const raw = await this.vault.cachedRead(file);
                const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
                // The canonical helper: prefers Obsidian's frontmatter end
                // offset and falls back to stripping the YAML fence, so a
                // missing metadata cache cannot leak frontmatter into the body.
                const body = extractBodyAfterFrontmatter(raw, frontmatter ?? {});
                this.entries.set(scene.path, { mtime: file.stat.mtime, body });
                bodies.set(scene.path, body);
                readCount += 1;
                totalChars += body.length;
            } catch (error) {
                // One unreadable scene must not fail the whole search; it simply
                // contributes no body matches. Logged so it is not invisible.
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[Search] Could not read scene body "${scene.path}": ${message}`);
            }
        }

        if (readCount > 0) {
            console.debug(
                `[Search] Body index: ${bodies.size} scenes, ${readCount} read from disk, ${totalChars} chars.`
            );
        }

        return bodies;
    }

    /** Drop one path — a rename or delete makes its cached body meaningless. */
    invalidate(path: string): void {
        this.entries.delete(path);
    }

    clear(): void {
        this.entries.clear();
    }

    /** Cached entry count, for diagnostics. */
    get size(): number {
        return this.entries.size;
    }
}
