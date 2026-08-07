/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Timeline search state — one object, one owner (SearchService).
 *
 * Replaces the three parallel plugin fields (`searchTerm`, `searchActive`,
 * `searchResults`) that every consumer had to read in agreement. Scope options,
 * async status, and per-scene evidence are coming; three fields would have
 * become six, and the drift surface with them.
 *
 * Nothing outside SearchService mutates this. Readers treat it as immutable.
 */

/**
 * Where a search looks.
 *
 * The organizing rule is *searchable == visible*: every scope resolves to
 * something the author can actually see, so a match always has somewhere to
 * show itself.
 */
export interface TimelineSearchOptions {
    /**
     * Scene title plus the fields the timeline renders — curated fields and
     * whatever custom fields the author enabled in hover metadata. Matches are
     * visible on the timeline and on hover.
     */
    timelineFields: boolean;
    /**
     * Scene prose. The YAML block is excluded by construction, so this never
     * silently matches metadata the author chose not to display. Matches are
     * visible on click, highlighted in the editor.
     */
    body: boolean;
    /** Local-LLM concept matching. Forced false when no local server is available. */
    llmAssist: boolean;
}

/** Which scope produced a hit. */
export type SearchHitSource = 'timelineFields' | 'body' | 'both';

export interface TimelineSearchHit {
    path: string;
    source: SearchHitSource;
    /**
     * Verbatim body passages that justified this hit — deliberately NOT
     * offsets. An offset captured at search time is wrong the moment the author
     * edits the scene, and a highlight landing on the wrong words is worse than
     * no highlight. Ranges are recomputed against the current file on open.
     */
    evidence: string[];
    /** LLM assist only: the model's one-line justification. */
    reason?: string;
}

export type TimelineSearchStatus = 'idle' | 'running' | 'ready' | 'error';

export interface TimelineSearchState {
    /** The committed term — the one `hits` actually corresponds to. */
    term: string;
    options: TimelineSearchOptions;
    active: boolean;
    status: TimelineSearchStatus;
    /** Verbatim failure text. Never a generic "search failed". */
    error?: string;
    hits: Map<string, TimelineSearchHit>;
}

export const DEFAULT_SEARCH_OPTIONS: TimelineSearchOptions = {
    timelineFields: true,
    body: false,
    llmAssist: false
};

export function createSearchState(
    options: TimelineSearchOptions = DEFAULT_SEARCH_OPTIONS
): TimelineSearchState {
    return {
        term: '',
        options: { ...options },
        active: false,
        status: 'idle',
        hits: new Map()
    };
}

/** True when `path` is a current match. */
export function isSearchHit(state: TimelineSearchState, path: string | undefined): boolean {
    if (!state.active || !path) return false;
    return state.hits.has(path);
}

/** Matched paths, for change detection and DOM updates. */
export function searchHitPaths(state: TimelineSearchState): Set<string> {
    return new Set(state.hits.keys());
}

/**
 * Change-detection signature for the scope options.
 *
 * Lives beside the type so a new option cannot be added without this seeing it
 * — building the signature at the call site would silently keep hashing the old
 * three fields, and a scope change would stop forcing a re-render.
 */
export function searchOptionsSignature(options: TimelineSearchOptions): string {
    const flags: Array<keyof TimelineSearchOptions> = ['timelineFields', 'body', 'llmAssist'];
    return flags.map(flag => (options[flag] ? '1' : '0')).join('');
}

/**
 * Merge a hit into an accumulator, promoting `source` to 'both' when a scene
 * matched in more than one scope and unioning its evidence.
 */
export function mergeSearchHit(
    into: Map<string, TimelineSearchHit>,
    hit: TimelineSearchHit
): void {
    const existing = into.get(hit.path);
    if (!existing) {
        into.set(hit.path, { ...hit, evidence: [...hit.evidence] });
        return;
    }

    const source: SearchHitSource = existing.source === hit.source ? existing.source : 'both';
    const evidence = [...existing.evidence];
    for (const passage of hit.evidence) {
        if (!evidence.includes(passage)) evidence.push(passage);
    }
    into.set(hit.path, {
        path: hit.path,
        source,
        evidence,
        reason: existing.reason ?? hit.reason
    });
}
