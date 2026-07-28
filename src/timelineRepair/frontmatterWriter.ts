/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Repair Wizard - Frontmatter Writer
 * Batch updates YAML frontmatter with When dates and provenance metadata.
 */

import type { App } from 'obsidian';
import type {
    SessionDiffModel,
    FrontmatterUpdate,
    FrontmatterWriteResult,
    WhenSource
} from './types';
import { getEffectiveWhen } from './types';
import { appendWhenChanges, type WhenChangeRecord } from './whenChangeLog';

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Format a Date for YAML frontmatter.
 * Uses format: YYYY-MM-DD HH:MM
 */
function formatWhenForYaml(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Format duration in milliseconds to a human-readable string.
 */
function formatDurationForYaml(durationMs: number): string {
    const minutes = Math.floor(durationMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
}

// ============================================================================
// Update Preparation
// ============================================================================

/**
 * Prepare frontmatter updates from session entries.
 * Only includes entries that have actual changes.
 */
export function prepareUpdates(session: SessionDiffModel): FrontmatterUpdate[] {
    const updates: FrontmatterUpdate[] = [];

    for (const entry of session.entries) {
        if (!entry.isChanged) continue;

        const effectiveWhen = getEffectiveWhen(entry);

        const update: FrontmatterUpdate = {
            file: entry.file,
            when: effectiveWhen,
            whenSource: entry.source
        };

        // Add duration if present
        if (entry.proposedDuration !== undefined) {
            update.duration = entry.proposedDuration;
            update.durationOngoing = entry.durationOngoing;
        }

        updates.push(update);
    }

    return updates;
}

// ============================================================================
// Batch Write
// ============================================================================

export interface WriteOptions {
    /** Tool attribution recorded in the When change log (default 'scaffold') */
    logTool?: 'scaffold' | 'audit';

    /** Progress callback */
    onProgress?: (current: number, total: number, fileName: string) => void;

    /** Abort signal */
    abortSignal?: AbortSignal;
}

/**
 * Write frontmatter updates to files.
 * Uses Obsidian's processFrontMatter for atomic updates.
 *
 * Only author-facing fields are ever written: `When`, and `Duration` when a
 * duration is proposed. Provenance lives in the When change log sidecar, not
 * in the author's YAML.
 */
export async function writeFrontmatterUpdates(
    app: App,
    updates: FrontmatterUpdate[],
    options: WriteOptions = {}
): Promise<FrontmatterWriteResult> {
    const opts = options;

    const result: FrontmatterWriteResult = {
        success: 0,
        failed: 0,
        errors: []
    };

    const changeRecords: WhenChangeRecord[] = [];
    
    for (let i = 0; i < updates.length; i++) {
        const update = updates[i];
        
        // Check for abort
        if (opts.abortSignal?.aborted) {
            break;
        }
        
        // Progress callback
        opts.onProgress?.(i + 1, updates.length, update.file.basename);
        
        try {
            let previousWhen: string | null = null;
            await app.fileManager.processFrontMatter(update.file, (fm) => {
                const fmObj = fm as Record<string, unknown>;

                // Capture the outgoing value for the change log before overwriting.
                const prior = fmObj['When'];
                previousWhen = typeof prior === 'string'
                    ? prior
                    : (typeof prior === 'number' || typeof prior === 'boolean' ? String(prior) : null);

                // Update When field
                fmObj['When'] = formatWhenForYaml(update.when);

                // Duration (author-facing field)
                if (update.duration !== undefined) {
                    fmObj['Duration'] = update.durationOngoing
                        ? 'ongoing'
                        : formatDurationForYaml(update.duration);
                }
            });
            
            result.success++;
            changeRecords.push({
                v: 1,
                ts: new Date().toISOString(),
                path: update.file.path,
                title: update.file.basename,
                prev: previousWhen,
                next: formatWhenForYaml(update.when),
                source: update.whenSource,
                tool: opts.logTool ?? 'scaffold' // SAFE: only the audit modal passes 'audit'; every other caller is the scaffold path, so the change log records it accurately
            });
        } catch (error) {
            result.failed++;
            result.errors.push({
                file: update.file,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Best-effort paper trail — a log failure never blocks or reverts the
    // writes it describes; snapshots are the safety net.
    try {
        await appendWhenChanges(app, changeRecords);
    } catch {
        // Swallowed by design (see above).
    }

    return result;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Write all changes from a session to files.
 */
export async function writeSessionChanges(
    app: App,
    session: SessionDiffModel,
    options: WriteOptions = {}
): Promise<FrontmatterWriteResult> {
    const updates = prepareUpdates(session);
    return writeFrontmatterUpdates(app, updates, options);
}

/**
 * Preview what would be written without actually writing.
 */
export function previewUpdates(session: SessionDiffModel): Array<{
    fileName: string;
    path: string;
    originalWhen: string | null;
    newWhen: string;
    source: WhenSource;
}> {
    const updates = prepareUpdates(session);

    return updates.map(update => {
        const entry = session.entries.find(e => e.file.path === update.file.path);

        return {
            fileName: update.file.basename,
            path: update.file.path,
            originalWhen: entry?.originalWhenRaw ??
                (entry?.originalWhen ? formatWhenForYaml(entry.originalWhen) : null),
            newWhen: formatWhenForYaml(update.when),
            source: update.whenSource
        };
    });
}

/**
 * Get a summary of changes for display.
 */
export function getChangeSummary(session: SessionDiffModel): { totalChanges: number } {
    return { totalChanges: prepareUpdates(session).length };
}

