/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Book from Community, written: the planned notes (bookTransferPlan.ts) go into
 * a new folder, are checked on disk, Community is told, and only then does the
 * folder become a book.
 *
 * Built to be resumed, never half-finished (contract "Plugin", spec section 9):
 *
 * - A record in plugin data, keyed by transfer id, is saved before the folder
 *   or any note is made, and again after each note. A restart continues from
 *   it. A note in the record is never written again.
 * - Notes go only directly inside the folder this run created. An existing
 *   folder is never written into, an existing note is never replaced, and no
 *   note is ever deleted.
 * - `done` carries the record's book id and the scene ids. Any failure asks
 *   `state`, so a lost answer is settled by Community, never assumed.
 * - The book is registered in Book Manager only after Community confirms.
 *   Registered earlier, a background book-list send would make a second card.
 * - Cancelled or expired after writing: the notes stay, the record is kept as
 *   `cancelled` until the author has been told, and the folder is not a book.
 *
 * The vault, Community and plugin data are passed in, so tests can stop the
 * run at any step. `obsidianBookTransferDeps` wires the real ones.
 */

import { normalizePath, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { addBookToManager } from '../onboarding/addBook';
import type { CommunityBookTransferRecord } from '../types/settings';
import { createBookId } from '../utils/books';
import { frontmatterValues, readFrontmatterText } from '../utils/frontmatterText';
import { isPathInFolderScope } from '../utils/pathScope';
import { readSceneId } from '../utils/sceneIds';
import type { BookTransferDone, BookTransferState } from './bookTransferDocument';
import { transferNotePath, type PlannedSceneNote } from './bookTransferPlan';
import {
    BOOK_TRANSFER_FAILED,
    CommunityShareError,
    commitCommunityShare,
    fetchBookTransferState,
    finishBookTransfer,
    keepTimelineUpdated,
} from './communityShareClient';
import { COMMUNITY_BOOK_TRANSFER_SCHEMA_VERSION, bookTransferFor, normalizeCommunityShareSettings } from './communityShareSettings';

export interface BookTransferVault {
    /** Anything at this path in the vault, under any spelling a file system that ignores case treats as the same. */
    exists(path: string): Promise<boolean>;
    createFolder(path: string): Promise<void>;
    /** A new note. Fails when something is already at the path. */
    create(path: string, content: string): Promise<void>;
    /** A note's text as it is on disk. */
    read(path: string): Promise<string>;
    /** Every Markdown note in the folder and the folders inside it. */
    notesIn(folder: string): Promise<string[]>;
}

export interface BookTransferServer {
    done(transferId: string, done: { pluginBookKey: string; sceneIds: string[] }): Promise<BookTransferDone>;
    state(transferId: string): Promise<BookTransferState>;
}

export interface BookTransferStore {
    get(transferId: string): CommunityBookTransferRecord | undefined;
    put(transferId: string, record: CommunityBookTransferRecord): Promise<void>;
    remove(transferId: string): Promise<void>;
}

export interface BookTransferDeps {
    vault: BookTransferVault;
    server: BookTransferServer;
    store: BookTransferStore;
    /** Book Manager, Keep timeline updated, the active book. Called only after Community confirms, and safe to call twice. */
    register(record: CommunityBookTransferRecord): Promise<void>;
    now(): string;
}

export interface BookTransferStart {
    transferId: string;
    /** The planned notes, in manuscript order. Needed until every note is written and checked. */
    notes?: readonly PlannedSceneNote[];
    /** The folder the author chose. Used only when no record exists yet. */
    folder: string;
    title: string;
    profileId: string;
    connectionId: string;
}

export type BookTransferProgress =
    | { step: 'writing'; written: number; total: number }
    | { step: 'checking' }
    | { step: 'telling' };

export type BookTransferOutcome =
    | { kind: 'done'; bookId: string; title: string; folder: string }
    | { kind: 'cancelled'; title: string; folder: string }
    /** Stopped on something the author can put right; Continue runs again from the record. */
    | { kind: 'stopped'; message: string; folderGone?: boolean };

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The scene id a note on disk carries, or undefined when it has none or its YAML cannot be read. */
function sceneIdOnDisk(content: string): string | undefined {
    try {
        const text = readFrontmatterText(content);
        return text ? readSceneId(frontmatterValues(text)) : undefined;
    } catch {
        return undefined;
    }
}

/** A refusal Community sent with its own sentence, shown as it stands. */
function refusalSentence(error: unknown): string | null {
    if (!(error instanceof CommunityShareError)) return null;
    return error.code === BOOK_TRANSFER_FAILED || error.code === 'invalid_response' ? null : error.message;
}

/**
 * Run or continue one transfer. Never throws for a step the author can put
 * right: those come back as `stopped`, with the record kept for Continue.
 */
export async function runBookTransfer(
    deps: BookTransferDeps,
    start: BookTransferStart,
    onProgress: (progress: BookTransferProgress) => void = () => undefined
): Promise<BookTransferOutcome> {
    const { vault, store } = deps;
    const transferId = start.transferId.toLowerCase();
    let record = store.get(transferId);
    if (record?.phase === 'cancelled') return { kind: 'cancelled', title: record.title, folder: record.folder };

    if (!record) {
        const folder = normalizePath(start.folder);
        if (await vault.exists(folder)) return { kind: 'stopped', message: t('ui.bookFromCommunity.folderAppeared', { folder }), folderGone: true };
        record = {
            schemaVersion: COMMUNITY_BOOK_TRANSFER_SCHEMA_VERSION,
            profileId: start.profileId,
            connectionId: start.connectionId,
            bookId: createBookId(),
            folder,
            title: start.title,
            folderCreated: false,
            notes: {},
            phase: 'writing',
            startedAt: deps.now(),
        };
        await store.put(transferId, record);
    }

    if (record.phase === 'writing') {
        const notes = start.notes;
        if (!notes) throw new Error('A transfer still writing needs its planned notes.');
        const written = await writeNotes(deps, transferId, record, notes, onProgress);
        if (written.kind !== 'written') return written.outcome;
        record = written.record;
        onProgress({ step: 'checking' });
        const problem = await checkNotes(vault, record, notes);
        if (problem) return { kind: 'stopped', message: problem };
        record = { ...record, phase: 'written' };
        await store.put(transferId, record);
    }

    return tellCommunity(deps, transferId, record, start.notes, onProgress);
}

async function writeNotes(
    deps: BookTransferDeps,
    transferId: string,
    initial: CommunityBookTransferRecord,
    notes: readonly PlannedSceneNote[],
    onProgress: (progress: BookTransferProgress) => void
): Promise<{ kind: 'written'; record: CommunityBookTransferRecord } | { kind: 'stopped'; outcome: BookTransferOutcome }> {
    const { vault, store } = deps;
    let record = initial;
    if (!record.folderCreated) {
        // Before the folder exists no note has been written, so a folder found
        // here is someone else's: the record goes, and the author picks a name.
        if (await vault.exists(record.folder)) {
            await store.remove(transferId);
            return { kind: 'stopped', outcome: { kind: 'stopped', message: t('ui.bookFromCommunity.folderAppeared', { folder: record.folder }), folderGone: true } };
        }
        await vault.createFolder(record.folder);
        record = { ...record, folderCreated: true };
        await store.put(transferId, record);
    }

    const total = notes.length;
    for (const [index, note] of notes.entries()) {
        onProgress({ step: 'writing', written: index, total });
        if (record.notes[note.sceneId]) continue;
        const path = transferNotePath(record.folder, note.fileName);
        if (await vault.exists(path)) {
            // Written just before the app closed, before the record was saved:
            // the very note planned. Anything else there is not this book's.
            let existing: string | null = null;
            try {
                existing = await vault.read(path);
            } catch {
                existing = null;
            }
            if (existing !== note.content) {
                return { kind: 'stopped', outcome: { kind: 'stopped', message: t('ui.bookFromCommunity.noteNotThisBooks', { note: note.fileName }) } };
            }
        } else {
            try {
                await vault.create(path, note.content);
            } catch (error) {
                const reason = error instanceof Error ? error.message.trim().replace(/\.$/, '') : '';
                const message = reason
                    ? t('ui.bookFromCommunity.noteFailed', { note: note.fileName, reason })
                    : t('ui.bookFromCommunity.noteFailedPlain', { note: note.fileName });
                return { kind: 'stopped', outcome: { kind: 'stopped', message } };
            }
        }
        record = { ...record, notes: { ...record.notes, [note.sceneId]: path } };
        await store.put(transferId, record);
    }
    onProgress({ step: 'writing', written: total, total });
    return { kind: 'written', record };
}

/** Every scene's note, read from disk: present, carrying its own id, and the only note in the folder with it. */
async function checkNotes(vault: BookTransferVault, record: CommunityBookTransferRecord, notes: readonly PlannedSceneNote[]): Promise<string | null> {
    for (const note of notes) {
        const path = record.notes[note.sceneId];
        let content: string | null = null;
        if (path) {
            try {
                content = await vault.read(path);
            } catch {
                content = null;
            }
        }
        if (content === null || sceneIdOnDisk(content) !== note.sceneId) {
            return t('ui.bookFromCommunity.checkMissing', { note: path ? fileName(path) : note.fileName });
        }
    }
    const wanted = new Set(notes.map(note => note.sceneId));
    const seen = new Set<string>();
    for (const path of await vault.notesIn(record.folder)) {
        let content: string;
        try {
            content = await vault.read(path);
        } catch {
            continue;
        }
        const id = sceneIdOnDisk(content);
        if (!id || !wanted.has(id)) continue;
        if (seen.has(id)) return t('ui.bookFromCommunity.checkDuplicate', { folder: record.folder, id });
        seen.add(id);
    }
    return null;
}

async function tellCommunity(
    deps: BookTransferDeps,
    transferId: string,
    record: CommunityBookTransferRecord,
    notes: readonly PlannedSceneNote[] | undefined,
    onProgress: (progress: BookTransferProgress) => void
): Promise<BookTransferOutcome> {
    onProgress({ step: 'telling' });
    // The document's order when it is at hand; the record keeps the same order otherwise.
    const sceneIds = notes ? notes.map(note => note.sceneId) : Object.keys(record.notes);
    let doneError: unknown = null;
    try {
        await deps.server.done(transferId, { pluginBookKey: record.bookId, sceneIds });
    } catch (error) {
        doneError = error;
    }

    if (doneError !== null) {
        // Refused, or the answer was lost: Community says where this stands.
        let state: BookTransferState;
        try {
            state = await deps.server.state(transferId);
        } catch {
            return { kind: 'stopped', message: refusalSentence(doneError) ?? t('ui.bookFromCommunity.answerLost') };
        }
        if (state.state === 'open') return { kind: 'stopped', message: refusalSentence(doneError) ?? t('ui.bookFromCommunity.answerLost') };
        // Done names the book it was done for; without that name nothing is assumed.
        if (state.state === 'done' && !state.pluginBookKey) return { kind: 'stopped', message: t('ui.communityShareClient.bookTransferUnexpected') };
        if (state.state !== 'done' || state.pluginBookKey !== record.bookId) {
            // Cancelled, expired, or finished under another book id: the notes stay, the folder is not a book.
            await deps.store.put(transferId, { ...record, phase: 'cancelled' });
            return { kind: 'cancelled', title: record.title, folder: record.folder };
        }
    }

    await deps.register(record);
    await deps.store.remove(transferId);
    return { kind: 'done', bookId: record.bookId, title: record.title, folder: record.folder };
}

// ── Obsidian ────────────────────────────────────────────────────────────────

/**
 * Anything in the vault at this path, compared without case: on a file system
 * that ignores case, "the lighthouse" and "The Lighthouse" are one folder.
 */
export function takenInVault(app: App, path: string): boolean {
    const wanted = normalizePath(path).toLowerCase();
    return app.vault.getAllLoadedFiles().some(file => file.path.toLowerCase() === wanted);
}

/** A note's text read from disk, not from Obsidian's cache. */
async function readNote(app: App, path: string): Promise<string> {
    const file = app.vault.getFileByPath(normalizePath(path));
    if (!file) throw new Error(`No note at ${path}`);
    return app.vault.read(file);
}

/** The plugin's record of one transfer, saved with the plugin's data. */
function transferStore(plugin: RadialTimelinePlugin): BookTransferStore {
    const save = async (transferId: string, record: CommunityBookTransferRecord | null): Promise<void> => {
        commitCommunityShare(plugin, live => {
            const rest = { ...live.bookTransfers };
            delete rest[transferId];
            return { ...live, bookTransfers: record ? { ...rest, [transferId]: record } : rest };
        });
        await plugin.saveSettings();
    };
    return {
        get: transferId => bookTransferFor(normalizeCommunityShareSettings(plugin.settings.communityShare), transferId),
        put: (transferId, record) => save(transferId.toLowerCase(), record),
        remove: transferId => save(transferId.toLowerCase(), null),
    };
}

/** Book Manager, Keep timeline updated, then the active book. A book already in Book Manager under this id is not added twice. */
async function registerTransferredBook(plugin: RadialTimelinePlugin, record: CommunityBookTransferRecord): Promise<void> {
    const existing = (plugin.settings.books ?? []).find(book => book.id === record.bookId); // SAFE: a vault with no books has none to find
    if (existing) await plugin.setActiveBookId(existing.id);
    else await addBookToManager(plugin, { id: record.bookId, title: record.title, sourceFolder: record.folder });
    await keepTimelineUpdated(plugin, record.bookId);
}

export function obsidianBookTransferDeps(plugin: RadialTimelinePlugin): BookTransferDeps {
    const { app } = plugin;
    return {
        vault: {
            exists: async path => takenInVault(app, path),
            createFolder: async path => { await app.vault.createFolder(path); },
            create: async (path, content) => { await app.vault.create(path, content); },
            read: path => readNote(app, path),
            notesIn: async folder => app.vault.getMarkdownFiles()
                .filter(file => isPathInFolderScope(file.path, folder))
                .map(file => file.path),
        },
        server: {
            done: (transferId, done) => finishBookTransfer(plugin, transferId, done),
            state: transferId => fetchBookTransferState(plugin, transferId),
        },
        store: transferStore(plugin),
        register: record => registerTransferredBook(plugin, record),
        now: () => new Date().toISOString(),
    };
}
