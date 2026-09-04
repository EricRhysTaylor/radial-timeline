/**
 * Radial Timeline Plugin for Obsidian — Change Detection
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem, RadialTimelineSettings, LegacyPersistedSettings, LegacyBeatDescription } from '../types';
import type { GossamerRun } from '../utils/gossamer';
import { getVersionCheckService } from '../services/VersionCheckService';
import { isRuntimeModeActive } from '../view/interactions/ChronologueShiftController';
import { DEFAULT_BOOK_TITLE, getActiveBook, getActiveBookTitle } from '../utils/books';
import { getActiveRecentStructuralMoves } from '../utils/recentStructuralMoves';
import { readSharedChapterTitle } from '../utils/timelineChapters';
import { readPartMarker } from '../utils/timelineParts';
import { searchHitPaths, searchOptionsSignature, type TimelineSearchState } from '../services/searchState';

/**
 * Types of changes that can trigger renders
 */
export enum ChangeType {
    NONE = 'none',
    SCENE_DATA = 'scene_data',        // Scenes added/removed/modified
    OPEN_FILES = 'open_files',        // Files opened/closed
    SEARCH = 'search',                // Search term changed
    MODE = 'mode',                    // View mode changed
    SETTINGS = 'settings',            // Settings changed
    TARGET_DATES = 'target_dates',    // Progress target ticks changed
    TIME = 'time',                    // Time-based (year progress, month)
    GOSSAMER = 'gossamer',            // Gossamer data updated
    DOMINANT_SUBPLOT = 'dominant_subplot',  // Dominant subplot changed (scene colors only)
    SCENE_VISUAL = 'scene_visual',    // Scene fill/status/due/stage changed without layout changes
    SYNOPSIS = 'synopsis',            // Synopsis text changed
    UPDATE_STATUS = 'update_status',  // Plugin update available
    RECENT_MOVES = 'recent_moves',    // Recent structural moves list updated
}

/**
 * Snapshot of timeline state for change detection
 */
export interface TimelineSnapshot {
    // Scene data
    sceneCount: number;
    sceneHash: string;
    sceneVisualHash: string;
    
    // UI state
    openFilePaths: Set<string>;
    searchActive: boolean;
    /**
     * The committed term. Tracked separately from the result set because two
     * different terms can match the same scenes — without this the SVG is not
     * rebuilt and the previous term stays highlighted in the hover metadata.
     */
    searchTerm: string;
    searchOptionsHash: string;
    searchResults: Set<string>;
    currentMode: string;
    
    // Time-based
    currentMonth: number;
    currentDate: string; // YYYY-MM-DD
    
    // Settings that affect rendering
    sortByWhen: boolean;
    subplotAlignment: string;
    aiEnabled: boolean;
    targetDate: string | undefined;
    stageTargetDatesHash: string;
    chronologueDurationCap: string | undefined;
    chronologueCalendarDefault: string;
    chronologueLastCalendarView: string;
    discontinuityThreshold: string | undefined;
    showBackdropRing: boolean;
    microBackdropHash: string;
    publishStageColorsHash: string;
    subplotColorsHash: string;
    workingPatternId: string;
    customWorkingPatternsHash: string;
    dominantSubplotsHash: string;
    povMode: string;
    activeBookId: string;
    activeBookTitle: string;
    timelineScope: string;
    readabilityScale: string;
    showChapterMarkers: boolean;
    activeNovelPandocLayoutId: string;
    
    // Gossamer
    gossamerRunExists: boolean;
    gossamerRunHash: string;
    
    // Plugin Update Status
    updateAvailable: boolean;

    // Runtime mode state (affects Chronologue duration arcs)
    runtimeModeActive: boolean;

    // Recent structural moves (Recent Moves overlay panel)
    recentMovesHash: string;
    
    timestamp: number;
}

/**
 * Result of change detection
 */
export interface ChangeDetectionResult {
    hasChanges: boolean;
    changeTypes: Set<ChangeType>;
    canUseSelectiveUpdate: boolean;
    updateStrategy: 'full' | 'selective' | 'none';
}

/**
 * Create a snapshot of current timeline state
 */
export function createSnapshot(
    scenes: TimelineItem[],
    openFilePaths: Set<string>,
    searchState: TimelineSearchState,
    currentMode: string,
    settings: RadialTimelineSettings,
    gossamerRun: GossamerRun | null | undefined
): TimelineSnapshot {
    // Create a structural hash for fields that affect scene presence, ordering, geometry, labels, or layout.
    const sceneHash = scenes
        .map(s => {
            const parts = [
                s.path || s.title || '',
                s.bookId || '',
                typeof s.bookIndex === 'number' ? String(s.bookIndex) : '',
                s.actNumber || '',
                s.subplot || '',
                s.number || '',
                s.when instanceof Date ? s.when.getTime() : (s.when || ''),
                s.Duration || '',
                // Runtime affects Chronologue duration arcs when in runtime mode
                s.Runtime || '',
                s.synopsis || '',
                // Pending Edits affects number square color (gray)
                s.pendingEdits || '',
                s.Purpose || '',
                s.Context || '',
                (s as LegacyBeatDescription).Description || '', // legacy fallback
                readSharedChapterTitle(s.rawFrontmatter) || s.Chapter || '',
                // Part marker drives the P / P-C placards. Without it in the
                // signature a `Part:` edit hashes identically and the renderer
                // skips the redraw, so the badge never appears until some
                // unrelated change forces one.
                partMarkerSignature(s.rawFrontmatter),
                stringifyPovForHash(s.pov),
                // Range field (rendered in Gossamer mode)
                s.Range || '',
                (s.Character || []).join(','),
                s.place || '',
                // AI Pulse Analysis grade affects number square color
                s.currentSceneAnalysis || ''
            ];
            
            // Include all Gossamer fields (Gossamer1 through Gossamer30)
            for (let i = 1; i <= 30; i++) {
                const gossamerKey = `Gossamer${i}` as Extract<keyof TimelineItem, `Gossamer${number}`>;
                parts.push(s[gossamerKey] || '');

                // Include Gossamer justifications (rendered in Gossamer mode).
                // Justifications are dynamic frontmatter keys, not typed on TimelineItem.
                const justification = s.rawFrontmatter?.[`Gossamer${i} Justification`];
                parts.push(typeof justification === 'string' ? justification : '');
            }
            
            return parts.join(':');
        })
        .join('|');

    // Visual-only fields can be updated in-place when geometry and labels are stable.
    const sceneVisualHash = scenes
        .map(s => [
            s.path || s.title || '',
            Array.isArray(s.status) ? s.status.join(',') : (s.status || ''),
            s.due || '',
            Array.isArray(s['Publish Stage']) ? s['Publish Stage'].join(',') : (s['Publish Stage'] || '')
        ].join(':'))
        .join('|');
    
    // Hash color settings to detect changes
    const publishStageColorsHash = settings.publishStageColors 
        ? JSON.stringify(settings.publishStageColors)
        : '';
    const subplotColorsHash = settings.subplotColors
        ? JSON.stringify(settings.subplotColors)
        : '';
    const customWorkingPatternsHash = settings.customWorkingPatterns
        ? JSON.stringify(settings.customWorkingPatterns)
        : '';
    const dominantSubplotsHash = settings.dominantSubplots
        ? JSON.stringify(settings.dominantSubplots)
        : '';
    const microBackdropHash = settings.chronologueBackdropMicroRings
        ? JSON.stringify(settings.chronologueBackdropMicroRings)
        : '';
    // Target dates are per book — hash the ACTIVE book's dates so switching
    // books (or editing its targets) swaps the ticks in place.
    const activeStageTargets = getActiveBook(settings)?.stageTargetDates;
    const stageTargetDatesHash = activeStageTargets
        ? (['Zero', 'Author', 'House', 'Press'] as const)
            .map(stage => `${stage}:${activeStageTargets[stage] ?? ''}`) // SAFE: render-fingerprint key — an unset stage target contributes an empty slot that still changes the key once it is set
            .join('|')
        : '';
    
    const now = new Date();
    
    const gossamerRunHash = (() => {
        if (!gossamerRun) return '';
        try {
            const beats = Array.isArray(gossamerRun.beats)
                ? gossamerRun.beats.map((beat) => ({
                    beat: beat?.beat ?? '',
                    score: typeof beat?.score === 'number' ? beat.score : '',
                    status: beat?.status ?? '',
                    range: beat?.range ? `${beat.range.min ?? ''}-${beat.range.max ?? ''}` : '',
                    out: beat?.isOutOfRange ? '1' : '0'
                }))
                : [];
            return JSON.stringify({
                beats,
                label: gossamerRun.meta?.label ?? '',
                model: gossamerRun.meta?.model ?? '',
                summary: gossamerRun.overall?.summary ?? ''
            });
        } catch {
            return String(Date.now());
        }
    })();

    const recentMovesHash = (() => {
        try {
            const entries = getActiveRecentStructuralMoves(settings).slice(0, 10);
            return entries.map((entry) => `${entry.timestamp ?? ''}:${entry.itemId ?? ''}`).join('|');
        } catch {
            return '';
        }
    })();

    return {
        sceneCount: scenes.length,
        sceneHash,
        sceneVisualHash,
        openFilePaths: new Set(openFilePaths),
        searchActive: searchState.active,
        searchTerm: searchState.term,
        searchOptionsHash: searchOptionsSignature(searchState.options),
        searchResults: searchHitPaths(searchState),
        currentMode,
        currentMonth: now.getMonth(),
        currentDate: now.toISOString().split('T')[0],
        sortByWhen: settings.sortByWhenDate ?? false,
        subplotAlignment: settings.subplotAlignment ?? 'fill',
        aiEnabled: settings.enableAiSceneAnalysis ?? false,
        targetDate: settings.targetCompletionDate,
        stageTargetDatesHash,
        chronologueDurationCap: settings.chronologueDurationCapSelection,
        chronologueCalendarDefault: settings.chronologueCalendarDefault ?? 'earth',
        chronologueLastCalendarView: settings.chronologueLastCalendarView ?? 'earth',
        discontinuityThreshold: settings.discontinuityThreshold,
        showBackdropRing: settings.showBackdropRing ?? true,
        microBackdropHash,
        publishStageColorsHash,
        subplotColorsHash,
        workingPatternId: settings.workingPatternId ?? '',
        customWorkingPatternsHash,
        dominantSubplotsHash,
        povMode: settings.globalPovMode ?? 'off',
        activeBookId: settings.activeBookId ?? '',
        activeBookTitle: getActiveBookTitle(settings, DEFAULT_BOOK_TITLE),
        timelineScope: settings.timelineScope ?? 'book',
        readabilityScale: settings.readabilityScale ?? 'normal',
        showChapterMarkers: settings.showChapterMarkers ?? false,
        activeNovelPandocLayoutId: getActiveNovelPandocLayoutId(settings),
        gossamerRunExists: !!gossamerRun,
        gossamerRunHash,
        updateAvailable: getVersionCheckService()?.isUpdateAvailable() ?? false,
        runtimeModeActive: isRuntimeModeActive(),
        recentMovesHash,
        timestamp: Date.now()
    };
}

/**
 * Compare two snapshots and detect what changed
 */
export function detectChanges(
    prev: TimelineSnapshot | null,
    current: TimelineSnapshot
): ChangeDetectionResult {
    const changeTypes = new Set<ChangeType>();
    
    if (!prev) {
        // First render - always full render
        return {
            hasChanges: true,
            changeTypes: new Set([ChangeType.SCENE_DATA]),
            canUseSelectiveUpdate: false,
            updateStrategy: 'full'
        };
    }
    
    // Detect scene data changes
    if (prev.sceneHash !== current.sceneHash || prev.sceneCount !== current.sceneCount) {
        changeTypes.add(ChangeType.SCENE_DATA);
    }

    if (!changeTypes.has(ChangeType.SCENE_DATA) && prev.sceneVisualHash !== current.sceneVisualHash) {
        changeTypes.add(ChangeType.SCENE_VISUAL);
    }
    
    // Detect open file changes
    if (!setsEqual(prev.openFilePaths, current.openFilePaths)) {
        changeTypes.add(ChangeType.OPEN_FILES);
    }
    
    // Detect search changes. The term and the scope options are part of the
    // signature, not just the matched paths: two terms can produce an identical
    // result set while highlighting different words inside it.
    if (prev.searchActive !== current.searchActive ||
        prev.searchTerm !== current.searchTerm ||
        prev.searchOptionsHash !== current.searchOptionsHash ||
        !setsEqual(prev.searchResults, current.searchResults)) {
        changeTypes.add(ChangeType.SEARCH);
    }
    
    // Detect mode changes
    if (prev.currentMode !== current.currentMode) {
        changeTypes.add(ChangeType.MODE);
    }
    
    // Target-date ticks can be swapped in place without rebuilding the full SVG.
    if (prev.targetDate !== current.targetDate ||
        prev.stageTargetDatesHash !== current.stageTargetDatesHash) {
        changeTypes.add(ChangeType.TARGET_DATES);
    }

    // Detect settings changes (excluding dominant subplots and target ticks - handled separately)
    if (prev.sortByWhen !== current.sortByWhen || 
        prev.subplotAlignment !== current.subplotAlignment ||
        prev.aiEnabled !== current.aiEnabled ||
        prev.chronologueDurationCap !== current.chronologueDurationCap ||
        prev.chronologueCalendarDefault !== current.chronologueCalendarDefault ||
        prev.chronologueLastCalendarView !== current.chronologueLastCalendarView ||
        prev.discontinuityThreshold !== current.discontinuityThreshold ||
        prev.showBackdropRing !== current.showBackdropRing ||
        prev.microBackdropHash !== current.microBackdropHash ||
        prev.publishStageColorsHash !== current.publishStageColorsHash ||
        prev.subplotColorsHash !== current.subplotColorsHash ||
        prev.workingPatternId !== current.workingPatternId ||
        prev.customWorkingPatternsHash !== current.customWorkingPatternsHash ||
        prev.povMode !== current.povMode ||
        prev.activeBookId !== current.activeBookId ||
        prev.activeBookTitle !== current.activeBookTitle ||
        prev.timelineScope !== current.timelineScope ||
        prev.readabilityScale !== current.readabilityScale ||
        prev.showChapterMarkers !== current.showChapterMarkers ||
        prev.activeNovelPandocLayoutId !== current.activeNovelPandocLayoutId) {
        changeTypes.add(ChangeType.SETTINGS);
    }
    
    // Detect dominant subplot changes separately (for selective update)
    if (prev.dominantSubplotsHash !== current.dominantSubplotsHash) {
        changeTypes.add(ChangeType.DOMINANT_SUBPLOT);
    }
    
    // Detect time changes
    if (prev.currentMonth !== current.currentMonth || prev.currentDate !== current.currentDate) {
        changeTypes.add(ChangeType.TIME);
    }
    
    // Detect gossamer changes
    if (prev.gossamerRunExists !== current.gossamerRunExists ||
        prev.gossamerRunHash !== current.gossamerRunHash) {
        changeTypes.add(ChangeType.GOSSAMER);
    }
    
    // Detect update status changes
    if (prev.updateAvailable !== current.updateAvailable) {
        changeTypes.add(ChangeType.UPDATE_STATUS);
    }
    
    // Detect runtime mode changes (affects Chronologue duration arcs)
    if (prev.runtimeModeActive !== current.runtimeModeActive) {
        changeTypes.add(ChangeType.SETTINGS);
    }

    // Detect recent-moves overlay changes (Recent Moves panel)
    if (prev.recentMovesHash !== current.recentMovesHash) {
        changeTypes.add(ChangeType.RECENT_MOVES);
    }
    
    // Determine update strategy
    const hasChanges = changeTypes.size > 0;
    
    // Selective updates are possible for certain change types only
    const selectiveChangeTypes = [
        ChangeType.OPEN_FILES, 
        ChangeType.SEARCH, 
        ChangeType.TIME,
        ChangeType.TARGET_DATES,
        ChangeType.SCENE_VISUAL,
        ChangeType.SYNOPSIS          // DOM update for synopsis text
    ];
    const canUseSelectiveUpdate = hasChanges && 
        Array.from(changeTypes).every(type => selectiveChangeTypes.includes(type));
    
    let updateStrategy: 'full' | 'selective' | 'none' = 'none';
    if (hasChanges) {
        updateStrategy = canUseSelectiveUpdate ? 'selective' : 'full';
    }
    
    return {
        hasChanges,
        changeTypes,
        canUseSelectiveUpdate,
        updateStrategy
    };
}

/**
 * Helper: Compare two sets for equality
 */
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

/**
 * Signature fragment for a scene's Part marker.
 *
 * Distinguishes absent, untitled, and each distinct title, so switching a
 * marker between "numeral only" and a name is a change the renderer sees.
 */
function partMarkerSignature(frontmatter: Record<string, unknown> | undefined): string {
    const marker = readPartMarker(frontmatter);
    if (!marker) return '';
    return marker.titled ? `part:${marker.title ?? ''}` : 'part:untitled';
}

function stringifyPovForHash(pov: TimelineItem['pov']): string {
    return typeof pov === 'string' ? pov : '';
}

function getActiveNovelPandocLayoutId(settings: RadialTimelineSettings): string {
    const activeBook = getActiveBook(settings);
    const bookLayoutId = activeBook?.lastUsedPandocLayoutByPreset?.novel;
    if (typeof bookLayoutId === 'string' && bookLayoutId.trim()) {
        return bookLayoutId.trim();
    }
    const globalLayoutId = (settings as LegacyPersistedSettings).lastUsedPandocLayoutByPreset?.novel;
    return typeof globalLayoutId === 'string' ? globalLayoutId.trim() : '';
}

