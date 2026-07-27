/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timeline Snapshot
 *
 * Lightweight restore-point captured immediately before Apply Scaffolded Dates
 * writes to disk. Stores only the previous `When` value (raw string when
 * available) for each scene that's about to change. Restores by writing the
 * captured values back into each scene's frontmatter.
 *
 * This is NOT a backup system. It does not preserve other frontmatter, body
 * content, or anything outside of `When`. It exists to give the author a
 * reliable single-step "put my dates back" action after a mass apply.
 */

import { TFile, type App } from 'obsidian';
import type { SessionDiffModel } from './types';

export const TIMELINE_SNAPSHOT_FOLDER = 'Radial Timeline/Snapshots/Timeline';

export interface TimelineSnapshotEntry {
    path: string;
    title: string;
    /** Raw YAML string the scene had before apply, if it existed. */
    previousWhenRaw: string | null;
}

export interface TimelineSnapshot {
    /** 1: scaffold-only (no tool field). 2: adds tool attribution. */
    schema: 1 | 2;
    createdAt: string;
    displayLabel: string;
    /** Which tool captured this restore point. Absent on schema-1 files (scaffold). */
    tool?: 'scaffold' | 'audit';
    /** Scaffold pipeline settings at capture time. Absent for audit snapshots. */
    config?: {
        patternPreset: string;
        preserveAuthoredDates: boolean;
        useTextCues: boolean;
    };
    entries: TimelineSnapshotEntry[];
}

export interface SnapshotMeta {
    file: TFile;
    snapshot: TimelineSnapshot;
}

function pad2(n: number): string {
    return n.toString().padStart(2, '0');
}

function buildSnapshotFilename(now: Date): string {
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    return `timeline-snapshot-${stamp}.json`;
}

function buildDisplayLabel(now: Date): string {
    return now.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

async function ensureSnapshotFolder(app: App): Promise<void> {
    const folder = app.vault.getAbstractFileByPath(TIMELINE_SNAPSHOT_FOLDER);
    if (folder) return;
    const parts = TIMELINE_SNAPSHOT_FOLDER.split('/');
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!app.vault.getAbstractFileByPath(current)) {
            try {
                await app.vault.createFolder(current);
            } catch {
                // Ignore — race-tolerant.
            }
        }
    }
}

export function buildTimelineSnapshot(
    session: SessionDiffModel,
    config: { patternPreset: string; preserveAuthoredDates: boolean; useTextCues: boolean }
): TimelineSnapshot {
    const now = new Date();
    const entries: TimelineSnapshotEntry[] = [];
    for (const entry of session.entries) {
        if (!entry.isChanged) continue;
        entries.push({
            path: entry.file.path,
            title: entry.scene.title ?? entry.file.basename,
            previousWhenRaw: entry.originalWhenRaw ?? null
        });
    }
    return {
        schema: 2,
        createdAt: now.toISOString(),
        displayLabel: buildDisplayLabel(now),
        tool: 'scaffold',
        config: { ...config },
        entries
    };
}

/**
 * Capture a restore point from the CURRENT frontmatter of the given files —
 * used by Timeline Audit, which has no session diff model to draw from.
 */
export async function buildSnapshotFromFiles(
    app: App,
    files: TFile[],
    tool: 'scaffold' | 'audit'
): Promise<TimelineSnapshot> {
    const now = new Date();
    const entries: TimelineSnapshotEntry[] = [];
    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        entries.push({
            path: file.path,
            title: file.basename,
            previousWhenRaw: extractFieldRaw(content, 'When')
        });
    }
    return {
        schema: 2,
        createdAt: now.toISOString(),
        displayLabel: buildDisplayLabel(now),
        tool,
        entries
    };
}

export async function saveTimelineSnapshot(
    app: App,
    snapshot: TimelineSnapshot
): Promise<TFile> {
    await ensureSnapshotFolder(app);
    const filename = buildSnapshotFilename(new Date(snapshot.createdAt));
    const path = `${TIMELINE_SNAPSHOT_FOLDER}/${filename}`;
    const json = JSON.stringify(snapshot, null, 2);
    const file = await app.vault.create(path, json);
    return file;
}

export async function listTimelineSnapshots(app: App): Promise<SnapshotMeta[]> {
    const folder = app.vault.getAbstractFileByPath(TIMELINE_SNAPSHOT_FOLDER);
    if (!folder) return [];
    const files: TFile[] = [];
    for (const child of app.vault.getFiles()) {
        if (child.path.startsWith(`${TIMELINE_SNAPSHOT_FOLDER}/`) && child.extension === 'json') {
            files.push(child);
        }
    }
    // Filenames embed a sortable timestamp, so lexicographic descending order
    // is also chronological newest-first. This avoids depending on file.stat,
    // which differs between environments.
    files.sort((a, b) => b.path.localeCompare(a.path));

    const result: SnapshotMeta[] = [];
    for (const file of files) {
        try {
            const text = await app.vault.read(file);
            const parsed = JSON.parse(text) as TimelineSnapshot;
            if (parsed && (parsed.schema === 1 || parsed.schema === 2) && Array.isArray(parsed.entries)) {
                result.push({ file, snapshot: parsed });
            }
        } catch {
            // Skip unparsable snapshots silently.
        }
    }
    return result;
}

export async function getLatestTimelineSnapshot(app: App): Promise<SnapshotMeta | null> {
    const all = await listTimelineSnapshots(app);
    return all[0] ?? null;
}

export interface RestoreResult {
    restored: number;
    skipped: number;
    failed: number;
    /** Total entries in the snapshot — the denominator for "X of Y restored". */
    total: number;
    /** Scenes with no frontmatter block; the restore could not be applied. */
    noFrontmatterPaths: string[];
    snapshotLabel: string;
}

/**
 * Write the snapshot's previousWhenRaw values back into each scene's
 * frontmatter, replacing the current `When` line. Scenes that had no
 * previous `When` are stripped of the field. Missing scene files are
 * skipped (counted, not errored).
 *
 * `restored` counts only scenes whose frontmatter was actually reached.
 * vault.process() resolving is not evidence of a restore — a transform that
 * returns its input unchanged succeeds just as loudly as one that rewrites
 * the file, and this is the one feature whose job is to undo a bulk write.
 */
export async function restoreTimelineSnapshot(
    app: App,
    meta: SnapshotMeta
): Promise<RestoreResult> {
    let restored = 0;
    let skipped = 0;
    let failed = 0;
    const noFrontmatterPaths: string[] = [];

    for (const entry of meta.snapshot.entries) {
        const file = app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) {
            skipped++;
            continue;
        }
        try {
            // Collected rather than assigned to a captured `let` so the
            // outcome survives TypeScript's closure narrowing intact.
            const outcomes: FrontmatterApplyResult[] = [];
            // Atomic read-modify-write: process() guarantees the file is not
            // changed by another process between reading the current `When`
            // line and writing the restored value.
            await app.vault.process(file, (content) => {
                const outcome = applyFieldToFrontmatter(content, 'When', entry.previousWhenRaw);
                outcomes.push(outcome);
                return outcome.kind === 'applied' ? outcome.content : content;
            });
            if (outcomes.some(outcome => outcome.kind === 'applied')) {
                restored++;
            } else {
                noFrontmatterPaths.push(entry.path);
            }
        } catch {
            failed++;
        }
    }

    return {
        restored,
        skipped,
        failed,
        total: meta.snapshot.entries.length,
        noFrontmatterPaths,
        snapshotLabel: meta.snapshot.displayLabel
    };
}

const FRONTMATTER_RE = /^(---\n)([\s\S]*?)(\n---\n?)/;

/** Raw value of a frontmatter field, or null when the field is absent/empty. */
function extractFieldRaw(content: string, field: string): string | null {
    const match = content.match(FRONTMATTER_RE);
    if (!match) return null;
    const line = match[2].split('\n').find(l => l.startsWith(`${field}:`));
    if (!line) return null;
    const value = line.slice(field.length + 1).trim();
    return value.length > 0 ? value : null;
}

/**
 * Result of a frontmatter field write. `no-frontmatter` is a distinct outcome
 * rather than "the input, unchanged" so callers cannot count a no-op as a
 * successful write.
 */
type FrontmatterApplyResult =
    | { kind: 'applied'; content: string }
    | { kind: 'no-frontmatter' };

/**
 * Set, replace, or (raw === null) remove one top-level frontmatter field,
 * leaving everything else in the file byte-identical.
 */
function applyFieldToFrontmatter(content: string, field: string, raw: string | null): FrontmatterApplyResult {
    const match = content.match(FRONTMATTER_RE);
    if (!match) return { kind: 'no-frontmatter' };

    const [, openFence, body, closeFence] = match;
    const lines = body.length > 0 ? body.split('\n') : [];
    const prefix = `${field}:`;
    const idx = lines.findIndex(l => l.startsWith(prefix));

    if (raw === null) {
        // Field already absent: the file is in the restored state, so this is
        // an applied restore that happens to need no byte change.
        if (idx === -1) return { kind: 'applied', content };
        lines.splice(idx, 1);
    } else {
        const newLine = `${prefix} ${raw}`;
        if (idx >= 0) {
            lines[idx] = newLine;
        } else {
            lines.unshift(newLine);
        }
    }

    return {
        kind: 'applied',
        content: `${openFence}${lines.join('\n')}${closeFence}${content.slice(match[0].length)}`
    };
}
