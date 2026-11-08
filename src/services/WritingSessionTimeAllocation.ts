import { getFrontMatterInfo, parseYaml, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { WritingSessionCompletionResult } from '../modals/WritingSessionCompletionModal';
import { authorKeyFor } from '../timetable/timetableFiles';

/** A private, author-approved contribution for one scene in this session. */
export interface SessionTimeAllocation { path: string; minutes: number; words: number; beforeHours: number; }
export interface TimeJournalEntry extends SessionTimeAllocation { afterHours: number; applied: boolean; skipped?: boolean }
export interface TimeJournal { version: 1; sessionId: string; entries: TimeJournalEntry[]; completion?: WritingSessionCompletionResult }

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

/**
 * Minutes to show for a scene in the save dialog. A fresh session rounds its
 * tracked time to whole minutes; a pending ledger keeps its exact minutes, or
 * the retry would no longer match the ledger and could never finish.
 */
export function allocationMinutes(activeMs: number, pendingLedger: boolean): number {
    return pendingLedger ? activeMs / 60000 : Math.round(activeMs / 60000);
}

/** The Total Time key and value in one scene's frontmatter, refused if the entry can no longer apply. */
function readEntryTotal(fm: Record<string, unknown>, property: string, entry: TimeJournalEntry): { key: string; current: number } {
    const matches = Object.keys(fm).filter(key => key.toLowerCase() === property.toLowerCase());
    if (matches.length > 1) throw new Error(`Duplicate Total Time properties: ${entry.path}`);
    const key = matches[0] ?? property;
    const current = parseRecordedHours(fm[key]);
    if (current !== entry.afterHours && current !== entry.beforeHours) throw new Error(`Total Time changed in ${entry.path}; review it before retrying.`);
    return { key, current };
}

/**
 * Why a scene cannot take this entry's time, or null when it can. Reads the
 * note itself rather than the metadata cache: a scene whose properties do not
 * parse has no cached frontmatter, yet its write would fail.
 */
export async function sceneTimeBlocker(plugin: RadialTimelinePlugin, entry: TimeJournalEntry): Promise<string | null> {
    const file = plugin.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile) || !plugin.isSceneFile(file.path)) return `Scene is unavailable: ${entry.path}`;
    const info = getFrontMatterInfo(await plugin.app.vault.read(file));
    let fm: unknown = {};
    if (info.exists) {
        try { fm = parseYaml(info.frontmatter); } catch { return `Scene properties cannot be read; fix them before saving: ${entry.path}`; }
    }
    if (fm === null || fm === undefined) fm = {}; // An empty properties block has blank Total Time.
    if (typeof fm !== 'object' || Array.isArray(fm)) return `Scene properties cannot be read; fix them before saving: ${entry.path}`;
    try {
        readEntryTotal(fm as Record<string, unknown>, authorKeyFor('Total Time', plugin.settings), entry);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** `path` after `oldPath` became `newPath`; a folder rename moves everything inside it. */
export function rebaseSessionPath(path: string, oldPath: string, newPath: string): string {
    if (path === oldPath) return newPath;
    return path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
}

/** A pending ledger follows its scenes through a rename, so the retry still finds them. */
export async function rebaseSessionTimeJournal(plugin: RadialTimelinePlugin, sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const journal = await readSessionTimeJournal(plugin, sessionId);
    if (!journal) return;
    const entries = journal.entries.map(entry => ({ ...entry, path: rebaseSessionPath(entry.path, oldPath, newPath) }));
    if (entries.every((entry, i) => entry.path === journal.entries[i].path)) return;
    await plugin.app.vault.adapter.write(`${plugin.manifest.dir}/session-time-${sessionId}.json`, JSON.stringify({ ...journal, entries })); // SAFE: private session ledger in the plugin directory.
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

/**
 * The ledger is local plugin data. It makes a retry at-most-once per scene.
 * Every scene is checked before the ledger exists, so a first save either
 * starts cleanly or changes nothing. On a retry the ledger locks the session,
 * so a scene that can no longer take its time is skipped rather than left to
 * block Save for good. Returns the paths skipped.
 */
export async function applySessionTimeAllocations(plugin: RadialTimelinePlugin, sessionId: string, allocations: SessionTimeAllocation[], completion?: WritingSessionCompletionResult): Promise<string[]> {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid session identifier.');
    const dir = plugin.manifest.dir;
    if (!dir) throw new Error('Cannot locate private session ledger.');
    const path = `${dir}/session-time-${sessionId}.json`;
    const adapter = plugin.app.vault.adapter; // SAFE: private session ledger in the plugin directory.
    // A words-only entry adds no time, so its Total Time is never read; an
    // unreadable value there must not block the save.
    const entries = allocations.filter(a => a.minutes > 0 || a.words > 0).map(a => a.minutes === 0 ? { ...a, beforeHours: 0 } : a);
    if (new Set(entries.map(a => a.path)).size !== entries.length || entries.some(a => !Number.isFinite(a.minutes) || a.minutes < 0 || !Number.isFinite(a.words) || a.words < 0 || !Number.isFinite(a.beforeHours) || a.beforeHours < 0)) throw new Error('Invalid scene time allocation.');
    let journal = await readSessionTimeJournal(plugin, sessionId);
    const retrying = journal !== null;
    if (journal) {
        if (journal.entries.length !== entries.length || journal.entries.some((item, i) => item.path !== entries[i].path || item.minutes !== entries[i].minutes || item.words !== entries[i].words)) throw new Error('The saved session allocation differs from this one; no further changes were made.');
    } else {
        journal = { version: 1, sessionId, completion, entries: entries.map(entry => ({ ...entry, afterHours: updatedHours(entry.beforeHours, entry.minutes), applied: false })) };
        for (const entry of journal.entries) {
            const blocker = entry.minutes > 0 ? await sceneTimeBlocker(plugin, entry) : null;
            if (blocker) throw new Error(blocker);
        }
        await adapter.write(path, JSON.stringify(journal));
    }
    const property = authorKeyFor('Total Time', plugin.settings);
    const skipped: string[] = [];
    for (const entry of journal.entries) {
        if (entry.applied) continue;
        if (entry.minutes === 0) { entry.applied = true; await adapter.write(path, JSON.stringify(journal)); continue; }
        if (entry.skipped || (retrying && await sceneTimeBlocker(plugin, entry))) {
            skipped.push(entry.path);
            if (!entry.skipped) { entry.skipped = true; await adapter.write(path, JSON.stringify(journal)); }
            continue;
        }
        const file = plugin.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) throw new Error(`Scene is unavailable: ${entry.path}`);
        await plugin.app.fileManager.processFrontMatter(file, fm => {
            const { key, current } = readEntryTotal(fm, property, entry);
            if (current !== entry.afterHours) fm[key] = entry.afterHours; // Otherwise the write completed before its ledger checkpoint.
        });
        entry.applied = true;
        await adapter.write(path, JSON.stringify(journal));
    }
    return skipped;
}
