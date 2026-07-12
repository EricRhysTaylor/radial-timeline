/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Session Diff Model
 * Tracks changes before commit with undo/redo and ripple mode.
 */

import type {
    RepairSceneEntry,
    SessionDiffModel,
    EditOperation,
    RepairPipelineResult
} from './types';
import { getEffectiveWhen } from './types';

// ============================================================================
// Session Creation
// ============================================================================

const MAX_UNDO_STACK = 50;

/**
 * Create a new session from pipeline results.
 */
export function createSession(result: RepairPipelineResult): SessionDiffModel {
    return {
        entries: result.entries,
        undoStack: [],
        redoStack: [],
        rippleEnabled: false,
        rippleIncludeAnchored: false,
        hasUnsavedChanges: result.scenesChanged > 0
    };
}

// ============================================================================
// Single Scene Edits
// ============================================================================

/**
 * Edit a single scene's When date.
 */
export function editSceneWhen(
    session: SessionDiffModel,
    sceneIndex: number,
    newWhen: Date
): SessionDiffModel {
    const entry = session.entries[sceneIndex];
    if (!entry) return session;
    
    const previousWhen = getEffectiveWhen(entry);
    
    // No change
    if (previousWhen.getTime() === newWhen.getTime()) {
        return session;
    }
    
    // Create edit operation for undo
    const operation: EditOperation = {
        type: 'single',
        timestamp: Date.now(),
        sceneIndex,
        previousWhen,
        newWhen
    };
    
    // Apply the edit
    const newEntries = [...session.entries];
    newEntries[sceneIndex] = {
        ...entry,
        editedWhen: newWhen,
        source: 'manual',
        isChanged: entry.originalWhen === null ||
            newWhen.getTime() !== entry.originalWhen.getTime()
    };
    
    // If ripple mode is enabled, propagate changes
    if (session.rippleEnabled) {
        return applyRipple(
            {
                ...session,
                entries: newEntries,
                undoStack: [...session.undoStack, operation].slice(-MAX_UNDO_STACK),
                redoStack: [],
                hasUnsavedChanges: true
            },
            sceneIndex,
            previousWhen,
            newWhen
        );
    }
    
    // Update temporal issue flags for affected scenes
    updateTemporalFlags(newEntries, sceneIndex);
    
    return {
        ...session,
        entries: newEntries,
        undoStack: [...session.undoStack, operation].slice(-MAX_UNDO_STACK),
        redoStack: [],
        hasUnsavedChanges: true
    };
}

/**
 * Shift a scene's When by a number of days.
 */
export function shiftSceneDays(
    session: SessionDiffModel,
    sceneIndex: number,
    dayDelta: number
): SessionDiffModel {
    const entry = session.entries[sceneIndex];
    if (!entry) return session;

    const currentWhen = getEffectiveWhen(entry);
    const newWhen = new Date(currentWhen);
    newWhen.setDate(newWhen.getDate() + dayDelta);

    return editSceneWhen(session, sceneIndex, newWhen);
}

/**
 * Shift a scene's When by a number of hours.
 */
export function shiftSceneHours(
    session: SessionDiffModel,
    sceneIndex: number,
    hourDelta: number
): SessionDiffModel {
    const entry = session.entries[sceneIndex];
    if (!entry) return session;

    const currentWhen = getEffectiveWhen(entry);
    const newWhen = new Date(currentWhen);
    newWhen.setHours(newWhen.getHours() + hourDelta);

    return editSceneWhen(session, sceneIndex, newWhen);
}

/**
 * Set a scene's time bucket (morning/afternoon/evening/night).
 */
export function setSceneTimeBucket(
    session: SessionDiffModel,
    sceneIndex: number,
    hour: number
): SessionDiffModel {
    const entry = session.entries[sceneIndex];
    if (!entry) return session;
    
    const currentWhen = getEffectiveWhen(entry);
    const newWhen = new Date(currentWhen);
    newWhen.setHours(hour, 0, 0, 0);
    
    return editSceneWhen(session, sceneIndex, newWhen);
}

// ============================================================================
// Batch Edits
// ============================================================================

/**
 * Edit multiple scenes at once.
 */
export function editMultipleScenes(
    session: SessionDiffModel,
    edits: Array<{ sceneIndex: number; newWhen: Date }>
): SessionDiffModel {
    if (edits.length === 0) return session;
    
    // Record all changes for undo
    const changes: EditOperation['changes'] = [];
    const newEntries = [...session.entries];
    
    for (const { sceneIndex, newWhen } of edits) {
        const entry = newEntries[sceneIndex];
        if (!entry) continue;
        
        const previousWhen = getEffectiveWhen(entry);
        if (previousWhen.getTime() === newWhen.getTime()) continue;
        
        changes.push({
            sceneIndex,
            previousWhen,
            newWhen
        });
        
        newEntries[sceneIndex] = {
            ...entry,
            editedWhen: newWhen,
            source: 'manual',
            isChanged: entry.originalWhen === null ||
                newWhen.getTime() !== entry.originalWhen.getTime()
        };
    }
    
    if (changes.length === 0) return session;
    
    // Create batch operation
    const operation: EditOperation = {
        type: 'batch',
        timestamp: Date.now(),
        changes
    };
    
    // Update temporal flags for all affected scenes
    const affectedIndices = new Set(changes.map(c => c.sceneIndex));
    for (const idx of affectedIndices) {
        updateTemporalFlags(newEntries, idx);
    }
    
    return {
        ...session,
        entries: newEntries,
        undoStack: [...session.undoStack, operation].slice(-MAX_UNDO_STACK),
        redoStack: [],
        hasUnsavedChanges: true
    };
}

/**
 * Shift multiple scenes by days.
 */
export function shiftMultipleDays(
    session: SessionDiffModel,
    sceneIndices: number[],
    dayDelta: number
): SessionDiffModel {
    const edits = sceneIndices.map(sceneIndex => {
        const entry = session.entries[sceneIndex];
        if (!entry) return null;
        
        const currentWhen = getEffectiveWhen(entry);
        const newWhen = new Date(currentWhen);
        newWhen.setDate(newWhen.getDate() + dayDelta);
        
        return { sceneIndex, newWhen };
    }).filter((e): e is { sceneIndex: number; newWhen: Date } => e !== null);
    
    return editMultipleScenes(session, edits);
}

/**
 * Set time bucket for multiple scenes.
 */
export function setMultipleTimeBucket(
    session: SessionDiffModel,
    sceneIndices: number[],
    hour: number
): SessionDiffModel {
    const edits = sceneIndices.map(sceneIndex => {
        const entry = session.entries[sceneIndex];
        if (!entry) return null;
        
        const currentWhen = getEffectiveWhen(entry);
        const newWhen = new Date(currentWhen);
        newWhen.setHours(hour, 0, 0, 0);
        
        return { sceneIndex, newWhen };
    }).filter((e): e is { sceneIndex: number; newWhen: Date } => e !== null);
    
    return editMultipleScenes(session, edits);
}

// ============================================================================
// Ripple Mode
// ============================================================================

/**
 * Toggle ripple mode.
 */
export function toggleRippleMode(session: SessionDiffModel): SessionDiffModel {
    return {
        ...session,
        rippleEnabled: !session.rippleEnabled
    };
}

/**
 * Toggle the ripple override that also shifts authored anchor dates.
 * Flashbacks stay pinned regardless.
 */
export function toggleRippleIncludeAnchored(session: SessionDiffModel): SessionDiffModel {
    return {
        ...session,
        rippleIncludeAnchored: !session.rippleIncludeAnchored
    };
}

/**
 * Whole-calendar-day difference between two dates, ignoring time of day.
 * Ripple shifts downstream scenes by days only, so an edit that moves a
 * scene from tomorrow-noon to today-evening backs everything up exactly
 * one day instead of smearing every scene's clock time by -16 hours.
 */
function calendarDayDelta(from: Date, to: Date): number {
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
}

/**
 * True when ripple must NOT move this entry.
 * Flashbacks that still carry their authored far-era date are always pinned —
 * they belong to a different era's continuity, so a cascade never applies.
 * Other authored dates hold unless the include-anchored override is on.
 * Scaffold-stamped dates (WhenSource: pattern/keyword/ai from a previous
 * apply) are machine-made and always shiftable.
 */
function isRipplePinned(entry: RepairSceneEntry, session: SessionDiffModel): boolean {
    if (entry.source !== 'authored') return false;
    if (entry.isFlashback) return true;
    if (entry.stampedWhenSource) return false;
    return !session.rippleIncludeAnchored;
}

/**
 * Apply ripple: propagate the edit's calendar-day shift to all following
 * scenes, preserving each scene's own time of day. A same-day time change
 * (day delta 0) ripples nothing — rearranging one day's schedule shouldn't
 * move the rest of the book. Pinning rules live in isRipplePinned().
 */
function applyRipple(
    session: SessionDiffModel,
    fromIndex: number,
    previousWhen: Date,
    newWhen: Date
): SessionDiffModel {
    const dayDelta = calendarDayDelta(previousWhen, newWhen);
    const newEntries = [...session.entries];

    if (dayDelta === 0) {
        updateAllTemporalFlags(newEntries);
        return { ...session, entries: newEntries };
    }

    const rippleChanges: EditOperation['changes'] = [];

    for (let i = fromIndex + 1; i < newEntries.length; i++) {
        const entry = newEntries[i];
        if (isRipplePinned(entry, session)) continue;

        const currentWhen = getEffectiveWhen(entry);
        const shiftedWhen = new Date(currentWhen);
        shiftedWhen.setDate(shiftedWhen.getDate() + dayDelta);

        rippleChanges.push({
            sceneIndex: i,
            previousWhen: currentWhen,
            newWhen: shiftedWhen
        });

        // Provenance is preserved: a cascaded shift is machine bookkeeping,
        // not the author hand-picking this scene's date. Writing 'manual'
        // here would stamp WhenSource: manual on apply and freeze the whole
        // tail as ripple anchors in the next session.
        newEntries[i] = {
            ...entry,
            editedWhen: shiftedWhen,
            isChanged: entry.originalWhen === null ||
                shiftedWhen.getTime() !== entry.originalWhen.getTime()
        };
    }

    updateAllTemporalFlags(newEntries);

    // Merge ripple changes into the most recent undo operation
    const lastOp = session.undoStack[session.undoStack.length - 1];
    if (lastOp && rippleChanges.length > 0) {
        const mergedOp: EditOperation = {
            type: 'ripple',
            timestamp: lastOp.timestamp,
            sceneIndex: lastOp.sceneIndex,
            previousWhen: lastOp.previousWhen,
            newWhen: lastOp.newWhen,
            changes: rippleChanges
        };

        return {
            ...session,
            entries: newEntries,
            undoStack: [...session.undoStack.slice(0, -1), mergedOp]
        };
    }

    return {
        ...session,
        entries: newEntries
    };
}

/**
 * Preview ripple impact from a given index: how many scenes would shift,
 * how many authored anchors hold, and how many flashbacks stay pinned.
 */
export function getRippleImpact(
    session: SessionDiffModel,
    fromIndex: number
): { shiftable: number; anchoredHeld: number; flashbacksPinned: number } {
    let shiftable = 0;
    let anchoredHeld = 0;
    let flashbacksPinned = 0;
    for (let i = fromIndex + 1; i < session.entries.length; i++) {
        const entry = session.entries[i];
        if (!isRipplePinned(entry, session)) {
            shiftable++;
        } else if (entry.isFlashback) {
            flashbacksPinned++;
        } else {
            anchoredHeld++;
        }
    }
    return { shiftable, anchoredHeld, flashbacksPinned };
}

// ============================================================================
// Undo/Redo
// ============================================================================

/**
 * Undo the last edit operation.
 */
export function undo(session: SessionDiffModel): SessionDiffModel {
    if (session.undoStack.length === 0) return session;
    
    const operation = session.undoStack[session.undoStack.length - 1];
    const newEntries = [...session.entries];
    
    // Reverse the operation
    if (operation.type === 'single' && operation.sceneIndex !== undefined) {
        const entry = newEntries[operation.sceneIndex];
        if (entry && operation.previousWhen) {
            newEntries[operation.sceneIndex] = {
                ...entry,
                editedWhen: operation.previousWhen,
                isChanged: entry.originalWhen === null ||
                    operation.previousWhen.getTime() !== entry.originalWhen.getTime()
            };
        }
    } else if (operation.changes) {
        for (const change of operation.changes) {
            const entry = newEntries[change.sceneIndex];
            if (entry) {
                newEntries[change.sceneIndex] = {
                    ...entry,
                    editedWhen: change.previousWhen,
                    isChanged: entry.originalWhen === null ||
                        change.previousWhen.getTime() !== entry.originalWhen.getTime()
                };
            }
        }
        
        // For ripple, also undo the primary edit
        if (operation.type === 'ripple' && operation.sceneIndex !== undefined && operation.previousWhen) {
            const entry = newEntries[operation.sceneIndex];
            if (entry) {
                newEntries[operation.sceneIndex] = {
                    ...entry,
                    editedWhen: operation.previousWhen,
                    isChanged: entry.originalWhen === null ||
                        operation.previousWhen.getTime() !== entry.originalWhen.getTime()
                };
            }
        }
    }
    
    // Update temporal flags
    updateAllTemporalFlags(newEntries);
    
    return {
        ...session,
        entries: newEntries,
        undoStack: session.undoStack.slice(0, -1),
        redoStack: [...session.redoStack, operation],
        hasUnsavedChanges: checkForChanges(newEntries)
    };
}

/**
 * Redo the last undone operation.
 */
export function redo(session: SessionDiffModel): SessionDiffModel {
    if (session.redoStack.length === 0) return session;
    
    const operation = session.redoStack[session.redoStack.length - 1];
    const newEntries = [...session.entries];
    
    // Re-apply the operation
    if (operation.type === 'single' && operation.sceneIndex !== undefined) {
        const entry = newEntries[operation.sceneIndex];
        if (entry && operation.newWhen) {
            newEntries[operation.sceneIndex] = {
                ...entry,
                editedWhen: operation.newWhen,
                source: 'manual',
                isChanged: entry.originalWhen === null ||
                    operation.newWhen.getTime() !== entry.originalWhen.getTime()
            };
        }
    } else if (operation.changes) {
        // For ripple, first apply the primary edit
        if (operation.type === 'ripple' && operation.sceneIndex !== undefined && operation.newWhen) {
            const entry = newEntries[operation.sceneIndex];
            if (entry) {
                newEntries[operation.sceneIndex] = {
                    ...entry,
                    editedWhen: operation.newWhen,
                    source: 'manual',
                    isChanged: entry.originalWhen === null ||
                        operation.newWhen.getTime() !== entry.originalWhen.getTime()
                };
            }
        }
        
        for (const change of operation.changes) {
            const entry = newEntries[change.sceneIndex];
            if (entry) {
                newEntries[change.sceneIndex] = {
                    ...entry,
                    editedWhen: change.newWhen,
                    // Ripple cascades keep provenance (see applyRipple);
                    // batch edits are direct author actions.
                    ...(operation.type === 'ripple' ? {} : { source: 'manual' as const }),
                    isChanged: entry.originalWhen === null ||
                        change.newWhen.getTime() !== entry.originalWhen.getTime()
                };
            }
        }
    }

    // Update temporal flags
    updateAllTemporalFlags(newEntries);

    return {
        ...session,
        entries: newEntries,
        undoStack: [...session.undoStack, operation],
        redoStack: session.redoStack.slice(0, -1),
        hasUnsavedChanges: checkForChanges(newEntries)
    };
}

/**
 * Check if undo is available.
 */
export function canUndo(session: SessionDiffModel): boolean {
    return session.undoStack.length > 0;
}

/**
 * Check if redo is available.
 */
export function canRedo(session: SessionDiffModel): boolean {
    return session.redoStack.length > 0;
}

// ============================================================================
// Temporal Flag Updates
// ============================================================================

/**
 * Update temporal flags for a single scene and its neighbors.
 */
function updateTemporalFlags(entries: RepairSceneEntry[], changedIndex: number): void {
    // Check the changed scene and the one after it
    const indicesToCheck = [changedIndex, changedIndex + 1].filter(
        i => i >= 0 && i < entries.length
    );
    
    for (const i of indicesToCheck) {
        if (i === 0) continue; // First scene can't have backward time
        
        const prevWhen = getEffectiveWhen(entries[i - 1]);
        const currWhen = getEffectiveWhen(entries[i]);
        const gap = currWhen.getTime() - prevWhen.getTime();
        
        entries[i].hasBackwardTime = gap < 0;
        entries[i].needsReview = entries[i].hasBackwardTime;
    }
}

/**
 * Update temporal flags for all scenes.
 */
function updateAllTemporalFlags(entries: RepairSceneEntry[]): void {
    if (entries.length < 2) return;
    
    // Calculate median gap
    const gaps: number[] = [];
    for (let i = 1; i < entries.length; i++) {
        const prev = getEffectiveWhen(entries[i - 1]);
        const curr = getEffectiveWhen(entries[i]);
        gaps.push(curr.getTime() - prev.getTime());
    }
    
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const largeGapThreshold = medianGap * 5;
    
    // Update flags
    for (let i = 1; i < entries.length; i++) {
        const prevWhen = getEffectiveWhen(entries[i - 1]);
        const currWhen = getEffectiveWhen(entries[i]);
        const gap = currWhen.getTime() - prevWhen.getTime();
        
        entries[i].hasBackwardTime = gap < 0;
        entries[i].hasLargeGap = largeGapThreshold > 0 && gap > largeGapThreshold;
        entries[i].needsReview = entries[i].hasBackwardTime;
    }
}

/**
 * Check if any entries have unsaved changes.
 */
function checkForChanges(entries: RepairSceneEntry[]): boolean {
    return entries.some(e => e.isChanged);
}

// ============================================================================
// Session Queries
// ============================================================================

/**
 * Get entries that need review.
 */
export function getEntriesNeedingReview(session: SessionDiffModel): RepairSceneEntry[] {
    return session.entries.filter(e => e.needsReview);
}

/**
 * Get entries with backward time.
 */
export function getEntriesWithBackwardTime(session: SessionDiffModel): RepairSceneEntry[] {
    return session.entries.filter(e => e.hasBackwardTime);
}

/**
 * Get entries by source.
 */
export function getEntriesBySource(
    session: SessionDiffModel,
    source: RepairSceneEntry['source']
): RepairSceneEntry[] {
    return session.entries.filter(e => e.source === source);
}

/**
 * Get count of changed entries.
 */
export function getChangedCount(session: SessionDiffModel): number {
    return session.entries.filter(e => e.isChanged).length;
}

/**
 * Get count of entries needing review.
 */
export function getNeedsReviewCount(session: SessionDiffModel): number {
    return session.entries.filter(e => e.needsReview).length;
}

