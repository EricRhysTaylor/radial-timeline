/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import type { TimelineItem } from '../types';
import type { BookProfile, ChronologueBackdropMicroRing, GlobalPovMode, ReadabilityScale } from '../types/settings';
import type { GossamerHistoricalRunOverlay, GossamerMinMaxBand, GossamerRun } from './gossamer';
import { parseWhenField } from './date';
import { comparePrefixTokens, extractPrefixToken } from './prefixOrder';

const STATUSES_REQUIRING_WHEN = new Set(['working', 'complete']);

/**
 * Normalize a value to a boolean
 * Handles various input types (boolean, string, number)
 */
export function normalizeBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const lower = value.toLowerCase().trim();
        // Handle empty string or just whitespace as false
        if (lower === '' || lower === ' ') {
            return false;
        }
        return lower === 'yes' || lower === 'true' || lower === '1';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    // Handle null, undefined, or any other falsy value as false
    return false;
}

/**
 * Check if a Class field represents a story beat
 * Accepts both "Plot" (legacy) and "Beat" (recommended), case-insensitive
 */
export function isStoryBeat(classValue: unknown): boolean {
    if (typeof classValue !== 'string') return false;
    const normalized = classValue.toLowerCase().trim();
    return normalized === 'plot' || normalized === 'beat';
}

/**
 * Check if a scene is a beat note (supports both new 'Beat' and legacy 'Plot' itemType)
 */
export function isBeatNote(scene: TimelineItem | { itemType?: string }): boolean {
    return scene.itemType === 'Beat' || scene.itemType === 'Plot';
}

/**
 * Check if item IS an actual scene (not a Beat, Plot, or Backdrop)
 * Scenes are identified by itemType === 'Scene' or missing itemType (legacy)
 * Use this for filtering when you only want to process writable scene content.
 */
export function isSceneItem(item: TimelineItem | { itemType?: string }): boolean {
    return item.itemType === 'Scene' || !item.itemType;
}

/**
 * Check if item is a front-matter or back-matter note (Class: Frontmatter / Backmatter).
 * These are included in manuscript export but excluded from timeline stats.
 */
export function isMatterNote(item: TimelineItem | { itemType?: string }): boolean {
    return item.itemType === 'Frontmatter' || item.itemType === 'Backmatter';
}

/**
 * Check if item is a BookMeta note (Class: BookMeta).
 * BookMeta notes are NOT included in the timeline or manuscript — they are
 * metadata-only containers parsed during getSceneData() and used during export.
 */
export function isBookMetaNote(item: TimelineItem | { itemType?: string }): boolean {
    return item.itemType === 'BookMeta';
}

/**
 * Check if item is NOT an actual scene (is Beat, Plot, Backdrop, Frontmatter, or Backmatter)
 * Only scenes should be counted in grid statistics, runtime, etc.
 * Use this for filtering when you only want to process writable scene content.
 */
export function isNonSceneItem(item: TimelineItem | { itemType?: string }): boolean {
    return isBeatNote(item) || item.itemType === 'Backdrop' || isMatterNote(item);
}

/**
 * Sort scenes based on plugin settings
 * @param scenes - Scenes to sort
 * @param sortByWhen - If true, sort by When date; if false, sort by manuscript order
 * @param forceChronological - If true, always use chronological sort (for Chronologue mode)
 */
export function sortScenes(
    scenes: TimelineItem[], 
    sortByWhen: boolean, 
    forceChronological: boolean = false
): TimelineItem[] {
    // When sorting by manuscript order, treat beats and scenes together
    if (!forceChronological && !sortByWhen) {
        return scenes.slice().sort(sortByManuscriptOrder);
    }
    
    // When sorting chronologically (by When date):
    // Both beats and scenes can have When dates and should be sorted together
    return sortScenesChronologically(scenes);
}

export interface PluginRendererFacade {
    settings: {
        publishStageColors: Record<string, string>;
        subplotColors: string[];
        workingPatternId?: string;
        customWorkingPatterns?: Array<{
            id: string;
            name: string;
            tileW: number;
            tileH: number;
            fillOpacity: number;
            fillRule?: 'evenodd' | 'nonzero';
            shapes: Array<{ tag: 'path' | 'circle'; attrs: Record<string, string> }>;
        }>;
        targetCompletionDate?: string;
        enableAiSceneAnalysis: boolean;
        chronologueDurationCapSelection?: string;
        showBackdropRing?: boolean;
        chronologueBackdropMicroRings?: ChronologueBackdropMicroRing[];
        dominantSubplots?: Record<string, string>;
        discontinuityThreshold?: string;
        globalPovMode?: GlobalPovMode;
        runtimeContentType?: 'novel' | 'screenplay';
        currentMode?: string;
        sortByWhenDate?: boolean;
        showChapterMarkers?: boolean;
        timelineScope?: 'book' | 'saga';
        books: BookProfile[];
        /** Active book id — target ticks read per-book stageTargetDates. */
        activeBookId?: string;
        readabilityScale?: ReadabilityScale;
        actCount?: number;
        timelapseYearSimulation?: {
            enabled?: boolean;
            startDate?: string;
            finishDate?: string;
            totalScenes?: number;
        };
        synopsisGenerationMaxWords?: number;
        synopsisGenerationMaxLines?: number;
    };
    searchActive: boolean;
    searchResults: Set<string>;
    searchTerm: string;
    openScenePaths: Set<string>;
    desaturateColor(hex: string, amount: number): string;
    calculateCompletionEstimate(scenes: TimelineItem[]): {
        date: Date | null;
        total: number;
        remaining: number;
        rate: number;
        stage: string;
        staleness: 'fresh' | 'warn' | 'late' | 'stalled';
        lastProgressDate: Date | null;
        windowDays: number;
        labelText?: string;
        isFrozen?: boolean;
    } | null;
    synopsisManager: { generateElement: (scene: TimelineItem, contentLines: string[], sceneId: string, subplotIndexResolver?: (name: string) => number) => SVGGElement };
    latestStatusCounts?: Record<string, number>;
    /** Beat label angles captured during ring rendering; consumed by the Gossamer overlay. */
    _beatAngles?: Map<string, number>;
    /** Beat slice geometry captured during ring rendering; consumed by the Gossamer overlay. */
    _beatSlices?: Map<string, { startAngle: number; endAngle: number; innerR: number; outerR: number }>;
    /** Latest Gossamer run; set by GossamerCommands, consumed by the Gossamer overlay. */
    _gossamerLastRun?: GossamerRun | null;
    /** Historical Gossamer run overlays; set by GossamerCommands. */
    _gossamerHistoricalRuns?: GossamerHistoricalRunOverlay[];
    /** Min/max confidence band across Gossamer runs; set by GossamerCommands. */
    _gossamerMinMax?: GossamerMinMaxBand | null;
    /** Whether any Gossamer scores exist for the active signal; set by GossamerCommands. */
    _gossamerHasAnyScores?: boolean;
    /** Minimal workspace access used to detect Gossamer mode across timeline views. */
    app: {
        workspace: {
            getLeavesOfType(viewType: string): Array<{ view: { currentMode?: string } }>;
        };
    };
}

export interface SceneState {
    isSceneOpen: boolean;
    isSearchMatch: boolean;
    hasEdits: boolean;
}

/**
 * Helper function to extract AI scene analysis grades from scenes
 * Only processes if AI features are enabled to avoid performance overhead
 * Optimized with caching to avoid repeated string operations
 */
export function extractGradeFromScene(
    scene: TimelineItem, 
    gradeKey: string | undefined, 
    sceneGrades: Map<string, string>, 
    plugin: PluginRendererFacade
): void {
    // Early return if AI features disabled - avoid all string processing
    if (!plugin.settings.enableAiSceneAnalysis) return;
    if (!gradeKey) return;
    
    const analysisText = scene["currentSceneAnalysis"];
    if (!analysisText) return;
    
    try {
        // Optimize: only split once and get first line
        const firstLine = typeof analysisText === 'string' 
            ? analysisText.substring(0, analysisText.indexOf('\n') > -1 ? analysisText.indexOf('\n') : analysisText.length).trim()
            : '';
        
        if (!firstLine) return;
        
        // Updated regex to match "[Number] [GradeLetter] / [Comment]" with optional YAML list marker
        const gradeMatch = firstLine.match(/^-?\s*(?:\d+(?:\.\d+)?\s+)?([ABC])(?![A-Za-z0-9])/i);
        if (gradeMatch && gradeMatch[1]) {
            sceneGrades.set(gradeKey, gradeMatch[1].toUpperCase());
        }
    } catch {
        // Silently handle errors per plugin guidelines
    }
}

/**
 * Helper function to check scene state
 */
export function getSceneState(scene: TimelineItem, plugin: PluginRendererFacade): SceneState {
    const isSceneOpen = !!(scene.path && plugin.openScenePaths.has(scene.path));
    const isSearchMatch = !!(plugin.searchActive && scene.path && plugin.searchResults.has(scene.path));
    const hasEdits = !!(scene.pendingEdits && scene.pendingEdits.trim() !== '');
    return { isSceneOpen, isSearchMatch, hasEdits };
}

/**
 * Helper function to build square classes
 */
export function buildSquareClasses(
    isSceneOpen: boolean, 
    isSearchMatch: boolean, 
    hasEdits: boolean
): string {
    let classes = 'rt-number-square';
    if (isSceneOpen) classes += ' rt-scene-is-open';
    if (isSearchMatch) classes += ' rt-search-result';
    if (hasEdits) classes += ' rt-has-edits';
    return classes;
}

/**
 * Helper function to build text classes
 */
export function buildTextClasses(
    isSceneOpen: boolean, 
    isSearchMatch: boolean, 
    hasEdits: boolean
): string {
    let classes = 'rt-number-text';
    if (isSceneOpen) classes += ' rt-scene-is-open';
    if (isSearchMatch) classes += ' rt-search-result';
    if (hasEdits) classes += ' rt-has-edits';
    return classes;
}

function normalizeStatusValue(status: TimelineItem['status']): string | null {
    if (!status) return null;
    if (Array.isArray(status)) {
        for (const entry of status) {
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (trimmed) return trimmed;
            }
        }
        return null;
    }
    if (typeof status === 'string') {
        const trimmed = status.trim();
        return trimmed || null;
    }
    return null;
}

export function shouldDisplayMissingWhenWarning(scene?: TimelineItem): boolean {
    if (!scene || !scene.missingWhen) return false;
    const normalizedStatus = normalizeStatusValue(scene.status);
    if (!normalizedStatus) return false;
    return STATUSES_REQUIRING_WHEN.has(normalizedStatus.toLowerCase());
}

/**
 * Sort scenes chronologically by their When field.
 *
 * Undated scenes are NOT piled into one block: each inherits the timestamp of
 * the nearest PRECEDING dated scene in manuscript order, so it stays beside its
 * narrative neighbors. With sparse dates (e.g. a freshly onboarded book where
 * only ~15% of scenes carry When), the old all-undated-first rule crammed every
 * dated scene — and thus every date tick/label — into one narrow wedge of the
 * ring. Undated scenes before the first dated scene lead, in manuscript order;
 * a fully dated or fully undated book sorts exactly as before.
 */
export function sortScenesChronologically(scenes: TimelineItem[]): TimelineItem[] {
    // Manuscript order is the baseline; dated scenes act as chronological anchors.
    const manuscript = scenes.slice().sort(sortByManuscriptOrder);
    let lastTime = Number.NEGATIVE_INFINITY;
    const keyed = manuscript.map((scene, index) => {
        const when = scene.when instanceof Date
            ? scene.when
            : parseWhenField(typeof scene.when === 'string' ? scene.when : '');
        const hasWhen = !!(when && !isNaN(when.getTime()));
        if (hasWhen && when) lastTime = when.getTime();
        return { scene, time: lastTime, index };
    });
    return keyed
        .sort((a, b) => {
            // (-Infinity ties must not subtract — NaN breaks the comparator.)
            if (a.time !== b.time) return a.time < b.time ? -1 : 1;
            return a.index - b.index;
        })
        .map((entry) => entry.scene);
}

/**
 * Extract a sortable prefix token from a scene/beat title.
 * Returns null if no numeric prefix is present.
 */
export function extractPositionToken(item: TimelineItem): string | null {
    return extractPrefixToken(item.title || '');
}

/**
 * Legacy numeric extractor retained for renderer callers.
 * Prefer token-based ordering via sortByManuscriptOrder().
 */
export function extractPosition(item: TimelineItem): number {
    const token = extractPositionToken(item);
    if (!token) return Infinity;
    const parsed = Number.parseFloat(token);
    return Number.isFinite(parsed) ? parsed : Infinity;
}

/**
 * Sort scenes by manuscript order (prefix number, then alphanumeric)
 */
export function sortByManuscriptOrder(a: TimelineItem, b: TimelineItem): number {
    const aToken = extractPositionToken(a);
    const bToken = extractPositionToken(b);
    const tokenCmp = comparePrefixTokens(aToken, bToken);
    if (tokenCmp !== 0) return tokenCmp;

    // If prefix tokens are equal or absent, sort by full title.
    return (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' });
}
