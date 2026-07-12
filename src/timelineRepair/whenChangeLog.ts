/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * When Change Log
 *
 * Append-only JSONL trail of every `When` value the plugin writes, recorded
 * at the single writer chokepoint (writeFrontmatterUpdates) so Timeline
 * Scaffold, Timeline Audit, and any future tool are covered automatically.
 * Powers the per-scene date history menu. Best-effort: a log failure never
 * blocks or reverts the frontmatter write it describes — the snapshot system
 * is the safety net, this is the paper trail.
 */

import { TFile, type App } from 'obsidian';
import { TIMELINE_SNAPSHOT_FOLDER } from './timelineSnapshot';

export const WHEN_CHANGE_LOG_PATH = `${TIMELINE_SNAPSHOT_FOLDER}/when-change-log.jsonl`;

export interface WhenChangeRecord {
    v: 1;
    /** ISO timestamp of the write. */
    ts: string;
    /** Vault path of the scene file. */
    path: string;
    title: string;
    /** `When` value before the write (as stored in frontmatter), null if absent. */
    prev: string | null;
    /** `When` value written. */
    next: string;
    /** Provenance of the new value (WhenSource). */
    source: string;
    /** Which tool performed the write. */
    tool: 'scaffold' | 'audit';
}

async function ensureLogFolder(app: App): Promise<void> {
    const parts = TIMELINE_SNAPSHOT_FOLDER.split('/');
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!app.vault.getAbstractFileByPath(current)) {
            try {
                await app.vault.createFolder(current);
            } catch {
                // Race-tolerant.
            }
        }
    }
}

/** Append change records to the JSONL log, creating it if needed. */
export async function appendWhenChanges(app: App, records: WhenChangeRecord[]): Promise<void> {
    if (records.length === 0) return;
    await ensureLogFolder(app);
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    const existing = app.vault.getAbstractFileByPath(WHEN_CHANGE_LOG_PATH);
    if (existing instanceof TFile) {
        await app.vault.append(existing, lines);
    } else {
        await app.vault.create(WHEN_CHANGE_LOG_PATH, lines);
    }
}

export interface ScaffoldStamp {
    source: 'pattern' | 'keyword' | 'ai';
    /** The When value the machine wrote (formatted YYYY-MM-DD HH:MM). */
    next: string;
}

/**
 * Provenance for ripple anchoring, derived from the log instead of YAML —
 * scene frontmatter carries no plugin bookkeeping. A scene is
 * scaffold-stamped when the LAST write the plugin made to it was
 * machine-sourced; a later manual/authored write supersedes the stamp.
 * Callers must still verify the scene's current When matches `next` —
 * a hand-edit in the file (which the log never sees) returns ownership
 * to the author.
 */
export async function buildScaffoldStampMap(app: App): Promise<Map<string, ScaffoldStamp>> {
    const file = app.vault.getAbstractFileByPath(WHEN_CHANGE_LOG_PATH);
    const stamps = new Map<string, ScaffoldStamp>();
    if (!(file instanceof TFile)) return stamps;

    const text = await app.vault.cachedRead(file);
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const record = JSON.parse(line) as WhenChangeRecord;
            if (record?.v !== 1) continue;
            if (record.source === 'pattern' || record.source === 'keyword' || record.source === 'ai') {
                stamps.set(record.path, { source: record.source, next: record.next });
            } else {
                stamps.delete(record.path);
            }
        } catch {
            // Skip malformed lines.
        }
    }
    return stamps;
}

/**
 * Read the change history for one scene, newest first.
 * Unparsable lines are skipped; a missing log reads as empty history.
 */
export async function readWhenHistory(app: App, scenePath: string, limit = 20): Promise<WhenChangeRecord[]> {
    const file = app.vault.getAbstractFileByPath(WHEN_CHANGE_LOG_PATH);
    if (!(file instanceof TFile)) return [];
    const text = await app.vault.cachedRead(file);

    const matches: WhenChangeRecord[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line) as WhenChangeRecord;
            if (parsed?.v === 1 && parsed.path === scenePath) {
                matches.push(parsed);
            }
        } catch {
            // Skip malformed lines.
        }
    }
    return matches.reverse().slice(0, limit);
}
