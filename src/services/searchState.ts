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

import type { PersistedTimelineSearchOptions } from '../types/settings';

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
 * Every option key, in signature order.
 *
 * Typed as `Record<keyof TimelineSearchOptions, true>` so adding a field to the
 * interface without listing it here is a **compile error**. A hand-written array
 * would have accepted the omission silently, and the new option would never
 * reach the change signature — a scope change that stops forcing a re-render.
 * Declaration order is the signature order (`Object.keys` preserves it for
 * string keys), so existing signatures stay stable.
 */
const SEARCH_OPTION_KEYS: Record<keyof TimelineSearchOptions, true> = {
    timelineFields: true,
    body: true,
    llmAssist: true
};

/** Change-detection signature for the scope options. */
export function searchOptionsSignature(options: TimelineSearchOptions): string {
    const keys = Object.keys(SEARCH_OPTION_KEYS) as Array<keyof TimelineSearchOptions>;
    return keys.map(key => (options[key] ? '1' : '0')).join('');
}

/** True when at least one scope is selected — otherwise a search has nowhere to look. */
export function hasSearchScope(options: TimelineSearchOptions): boolean {
    return options.timelineFields || options.body;
}

export const TIMELINE_SEARCH_SETTINGS_VERSION = 1;

/**
 * Read persisted scope options, falling back to defaults for anything absent,
 * malformed, or written by a schema this build does not know.
 *
 * Deliberately strict about types rather than coercing: a settings file that
 * has been hand-edited or written by a future build should produce known-good
 * defaults, not a half-applied mixture.
 */
export function readTimelineSearchSettings(
    persisted: PersistedTimelineSearchOptions | undefined
): TimelineSearchOptions {
    if (!persisted || typeof persisted !== 'object') return { ...DEFAULT_SEARCH_OPTIONS };
    if (persisted.schemaVersion !== TIMELINE_SEARCH_SETTINGS_VERSION) return { ...DEFAULT_SEARCH_OPTIONS };

    const readFlag = (value: unknown, fallback: boolean): boolean =>
        typeof value === 'boolean' ? value : fallback;

    const options: TimelineSearchOptions = {
        timelineFields: readFlag(persisted.timelineFields, DEFAULT_SEARCH_OPTIONS.timelineFields),
        body: readFlag(persisted.body, DEFAULT_SEARCH_OPTIONS.body),
        llmAssist: readFlag(persisted.llmAssist, DEFAULT_SEARCH_OPTIONS.llmAssist)
    };

    // A stored state with every scope off would leave the author with a search
    // box that silently matches nothing and no obvious way back.
    if (!hasSearchScope(options)) options.timelineFields = true;

    return options;
}

export function writeTimelineSearchSettings(
    options: TimelineSearchOptions
): PersistedTimelineSearchOptions {
    return {
        schemaVersion: TIMELINE_SEARCH_SETTINGS_VERSION,
        timelineFields: options.timelineFields,
        body: options.body,
        llmAssist: options.llmAssist
    };
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
