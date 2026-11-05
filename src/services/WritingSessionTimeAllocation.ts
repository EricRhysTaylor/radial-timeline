import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { WritingSessionCompletionResult } from '../modals/WritingSessionCompletionModal';
import { authorKeyFor } from '../timetable/timetableFiles';

/** A private, author-approved contribution for one scene in this session. */
export interface SessionTimeAllocation { path: string; minutes: number; words: number; beforeHours: number; }
export interface TimeJournal { version: 1; sessionId: string; entries: Array<SessionTimeAllocation & { afterHours: number; applied: boolean }>; completion?: WritingSessionCompletionResult }

/** Blank means no recorded time. Refuse to replace values whose meaning is unclear. */
export function parseRecordedHours(value: unknown): number {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Total Time must be a number of hours.');
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Total Time must be a non-negative number of hours.');
    return number;
}

export function updatedHours(before: number, minutes: number): number {
    return Math.round((before + minutes / 60) * 1_000_000) / 1_000_000;
}

export async function readSessionTimeJournal(plugin: RadialTimelinePlugin, sessionId: string): Promise<TimeJournal | null> {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !plugin.manifest.dir) throw new Error('Cannot locate private session ledger.');
    const path = `${plugin.manifest.dir}/session-time-${sessionId}.json`;
    const adapter = plugin.app.vault.adapter; // SAFE: private session ledger in the plugin directory.
    if (!await adapter.exists(path)) return null;
    const journal = JSON.parse(await adapter.read(path)) as TimeJournal;
    if (journal.version !== 1 || journal.sessionId !== sessionId || !Array.isArray(journal.entries) || journal.entries.some(entry => typeof entry.path !== 'string' || !Number.isFinite(entry.minutes) || entry.minutes < 0 || !Number.isFinite(entry.words) || entry.words < 0 || !Number.isFinite(entry.beforeHours) || entry.afterHours !== updatedHours(entry.beforeHours, entry.minutes) || typeof entry.applied !== 'boolean')) throw new Error('The session time ledger is invalid; no further changes were made.');
    return journal;
}

/** The ledger is local plugin data. It makes a retry at-most-once per scene. */
export async function applySessionTimeAllocations(plugin: RadialTimelinePlugin, sessionId: string, allocations: SessionTimeAllocation[], completion?: WritingSessionCompletionResult): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid session identifier.');
    const dir = plugin.manifest.dir;
    if (!dir) throw new Error('Cannot locate private session ledger.');
    const path = `${dir}/session-time-${sessionId}.json`;
    const adapter = plugin.app.vault.adapter; // SAFE: private session ledger in the plugin directory.
    const entries = allocations.filter(a => a.minutes > 0 || a.words > 0);
    if (new Set(entries.map(a => a.path)).size !== entries.length || entries.some(a => !Number.isFinite(a.minutes) || a.minutes < 0 || !Number.isFinite(a.words) || a.words < 0 || !Number.isFinite(a.beforeHours) || a.beforeHours < 0)) throw new Error('Invalid scene time allocation.');
    let journal = await readSessionTimeJournal(plugin, sessionId);
    if (journal) {
        if (journal.entries.length !== entries.length || journal.entries.some((item, i) => item.path !== entries[i].path || item.minutes !== entries[i].minutes || item.words !== entries[i].words)) throw new Error('The saved session allocation differs from this one; no further changes were made.');
    } else {
        journal = { version: 1, sessionId, completion, entries: entries.map(entry => ({ ...entry, afterHours: updatedHours(entry.beforeHours, entry.minutes), applied: false })) };
        await adapter.write(path, JSON.stringify(journal));
    }
    const property = authorKeyFor('Total Time', plugin.settings);
    for (const entry of journal.entries) {
        if (entry.applied) continue;
        if (entry.minutes === 0) { entry.applied = true; await adapter.write(path, JSON.stringify(journal)); continue; }
        const file = plugin.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile) || !plugin.isSceneFile(file.path)) throw new Error(`Scene is unavailable: ${entry.path}`);
        await plugin.app.fileManager.processFrontMatter(file, fm => {
            const matches = Object.keys(fm).filter(key => key.toLowerCase() === property.toLowerCase());
            if (matches.length > 1) throw new Error(`Duplicate Total Time properties: ${entry.path}`);
            const key = matches[0] ?? property;
            const current = parseRecordedHours(fm[key]);
            if (current === entry.afterHours) return; // A write completed before its ledger checkpoint.
            if (current !== entry.beforeHours) throw new Error(`Total Time changed in ${entry.path}; review it before retrying.`);
            fm[key] = entry.afterHours;
        });
        entry.applied = true;
        await adapter.write(path, JSON.stringify(journal));
    }
}
