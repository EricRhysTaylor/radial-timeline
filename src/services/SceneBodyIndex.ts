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
import { escapeRegExp } from '../utils/regex';
import type { TimelineSearchGap } from './searchState';

interface SceneBodyEntry {
    /** Modification time the cached body was read at; a change invalidates it. */
    mtime: number;
    size: number;
    body: string;
}

export interface SceneBodyLoad {
    bodies: Map<string, string>;
    unreadableNotes: TimelineSearchGap[];
}

/**
 * Distinct matched substrings of `phrase` within `body`, case-insensitive.
 *
 * Returns the text **as it appears in the prose**, so a search for `coast`
 * yields `['Coast']` when that is how the author wrote it. The expression is
 * escaped, so punctuation stays literal. Unicode case matching preserves the
 * original offsets even when lowercasing a character would change its length.
 *
 * Distinct *variants* rather than one entry per occurrence, because that is
 * what survives editing. Storing surrounding context would break the moment the
 * author revised a nearby sentence; storing the matched text itself still
 * re-locates every occurrence when the scene is opened.
 */
export function findBodyMatches(body: string, phrase: string): string[] {
    if (!body || !phrase) return [];

    const pattern = new RegExp(escapeRegExp(phrase), 'giu');
    const variants: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
        if (!variants.includes(match[0])) variants.push(match[0]);
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
    private readonly pendingReads = new Set<{ path: string; current: boolean }>();

    constructor(app: App) {
        this.vault = app.vault;
        this.metadataCache = app.metadataCache;
    }

    /**
     * Read the bodies for `scenes`, reusing cached text whose file has not
     * changed. Returns bodies and named coverage failures for the matching pass.
     */
    async load(scenes: TimelineItem[], isCurrent: () => boolean = () => true): Promise<SceneBodyLoad> {
        const bodies = new Map<string, string>();
        const unreadableNotes: TimelineSearchGap[] = [];
        const seen = new Set<string>();

        for (const scene of scenes) {
            if (!isCurrent()) break;
            if (!scene.path) continue;
            if (seen.has(scene.path)) continue;
            seen.add(scene.path);

            const file = this.vault.getAbstractFileByPath(scene.path);
            if (!(file instanceof TFile)) {
                unreadableNotes.push({ path: scene.path, reason: 'Scene file is no longer available.' });
                continue;
            }

            const cached = this.entries.get(scene.path);
            if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
                bodies.set(scene.path, cached.body);
                continue;
            }

            const reading = { path: scene.path, current: true };
            this.pendingReads.add(reading);
            try {
                const mtime = file.stat.mtime;
                const size = file.stat.size;
                const raw = await this.vault.cachedRead(file);
                if (!isCurrent()) break;
                const currentFile = this.vault.getAbstractFileByPath(scene.path);
                if (!reading.current || !(currentFile instanceof TFile) || file.path !== scene.path || currentFile.stat.mtime !== mtime || currentFile.stat.size !== size) {
                    throw new Error('Scene changed while its body was being read; search again for the current text.');
                }
                const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
                // The canonical helper: prefers Obsidian's frontmatter end
                // offset and falls back to stripping the YAML fence, so a
                // missing metadata cache cannot leak frontmatter into the body.
                const body = extractBodyAfterFrontmatter(raw, frontmatter ?? {});
                this.entries.set(scene.path, { mtime, size, body });
                bodies.set(scene.path, body);
            } catch (error) {
                // Continue the other notes and report this gap to the author.
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[Search] Could not read scene body "${scene.path}": ${message}`);
                unreadableNotes.push({ path: scene.path, reason: message });
            } finally {
                this.pendingReads.delete(reading);
            }
        }

        return { bodies, unreadableNotes };
    }

    /** Drop one path — a rename or delete makes its cached body meaningless. */
    invalidate(path: string): void {
        this.entries.delete(path);
        for (const reading of this.pendingReads) {
            if (reading.path === path) reading.current = false;
        }
    }

    clear(): void {
        this.entries.clear();
        for (const reading of this.pendingReads) reading.current = false;
    }

    /** Cached entry count, for diagnostics. */
    get size(): number {
        return this.entries.size;
    }
}
