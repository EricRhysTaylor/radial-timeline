/**
 * Book from Community, written (contract "Plugin", spec section 9 and 14):
 * resumed, never half-finished, never two editors. The vault, Community and
 * plugin data are in-memory stand-ins, so each test can stop the run at the
 * step it names.
 */

import { describe, expect, it } from 'vitest';
import { CommunityShareError } from './communityShareClient';
import { obsidianBookTransferDeps, runBookTransfer, settleUnreadableTransfer, type BookTransferDeps, type BookTransferStart } from './bookTransferWriter';
import type { PlannedSceneNote } from './bookTransferPlan';
import type { BookTransferState } from './bookTransferDocument';
import type { CommunityBookTransferRecord } from '../types/settings';

const TRANSFER_ID = '55555555-5555-4555-8555-555555555555';
const FOLDER = 'Books/The Lighthouse';

const note = (sceneId: string, fileName: string, body = ''): PlannedSceneNote => ({
    sceneId,
    fileName,
    content: `---\nID: ${sceneId}\nClass: Scene\nAct: 1\n---\n\n${body}`,
    text: body ? 'exact' : 'none',
});

const NOTES = [note('scn_0a1b2c3d', '01 The Docks.md'), note('scn_0a1b2c3e', '02 Night Watch.md', 'It was cold.\n'), note('scn_0a1b2c3f', '03 Landfall.md')];

const start = (extra: Partial<BookTransferStart> = {}): BookTransferStart => ({
    transferId: TRANSFER_ID,
    notes: NOTES,
    folder: FOLDER,
    title: 'The Lighthouse',
    profileId: 'profile-1',
    connectionId: 'conn-1',
    ...extra,
});

interface World {
    deps: BookTransferDeps;
    files: Map<string, string>;
    folders: Set<string>;
    records: Map<string, CommunityBookTransferRecord>;
    /** Every step, in order: what the run did to the vault, plugin data and Community. */
    log: string[];
    creates: Map<string, number>;
    server: {
        done: (sceneIds: string[], bookKey: string) => Promise<void>;
        state: () => Promise<BookTransferState>;
    };
    registered: CommunityBookTransferRecord[];
    /** Make the next plugin-data save throw, as if the app closed there. */
    closeAppOnPut?: (record: CommunityBookTransferRecord) => boolean;
}

function world(folders: string[] = ['Books']): World {
    const w: World = {
        files: new Map(),
        folders: new Set(folders),
        records: new Map(),
        log: [],
        creates: new Map(),
        registered: [],
        server: {
            done: async () => undefined,
            state: async () => ({ state: 'open', expiresAt: '2026-11-22T12:00:00Z' }),
        },
    } as unknown as World; // SAFE: deps is set just below
    w.deps = {
        vault: {
            exists: async path => w.files.has(path) || w.folders.has(path),
            isEmptyFolder: async path => w.folders.has(path) && ![...w.files.keys(), ...w.folders].some(entry => entry.startsWith(`${path}/`)),
            createFolder: async path => {
                if (w.folders.has(path) || w.files.has(path)) throw new Error('Folder already exists.');
                w.log.push(`createFolder ${path}`);
                w.folders.add(path);
            },
            create: async (path, content) => {
                if (w.files.has(path)) throw new Error('File already exists.');
                w.log.push(`create ${path}`);
                w.creates.set(path, (w.creates.get(path) ?? 0) + 1);
                w.files.set(path, content);
            },
            read: async path => {
                const content = w.files.get(path);
                if (content === undefined) throw new Error('No such file.');
                return content;
            },
            notesIn: async folder => [...w.files.keys()].filter(path => path.startsWith(`${folder}/`) && path.endsWith('.md')),
        },
        server: {
            done: async (_transferId, done) => {
                w.log.push(`done ${done.pluginBookKey} ${done.sceneIds.join(',')}`);
                await w.server.done(done.sceneIds, done.pluginBookKey);
                return { projectId: '33333333-3333-4333-8333-333333333333', pluginBookKey: done.pluginBookKey };
            },
            state: async () => {
                w.log.push('state');
                return w.server.state();
            },
        },
        store: {
            get: transferId => w.records.get(transferId),
            put: async (transferId, record) => {
                if (w.closeAppOnPut?.(record)) {
                    w.closeAppOnPut = undefined;
                    throw new Error('The app closed.');
                }
                w.log.push(`put ${record.phase} ${Object.keys(record.notes).length}`);
                w.records.set(transferId, record);
            },
            remove: async transferId => {
                w.log.push('remove');
                w.records.delete(transferId);
            },
        },
        register: async record => {
            w.log.push('register');
            w.registered.push(record);
        },
        now: () => '2026-11-21T12:00:00Z',
    };
    return w;
}

const insideFolder = (path: string) => path === FOLDER || path.startsWith(`${FOLDER}/`);

describe('writing a book from Community', () => {
    it('saves its record first, writes one note per scene in a new folder, checks, tells Community, then registers', async () => {
        const w = world();
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toMatchObject({ kind: 'done', title: 'The Lighthouse', folder: FOLDER });
        const bookId = (outcome as { bookId: string }).bookId;
        expect(w.log).toEqual([
            'put writing 0',
            `createFolder ${FOLDER}`,
            'put writing 0',
            `create ${FOLDER}/01 The Docks.md`, 'put writing 1',
            `create ${FOLDER}/02 Night Watch.md`, 'put writing 2',
            `create ${FOLDER}/03 Landfall.md`, 'put writing 3',
            'put written 3',
            `done ${bookId} scn_0a1b2c3d,scn_0a1b2c3e,scn_0a1b2c3f`,
            'register',
            'remove',
        ]);
        expect(w.files.get(`${FOLDER}/02 Night Watch.md`)).toBe(NOTES[1].content);
        expect(w.registered).toEqual([expect.objectContaining({ bookId, folder: FOLDER, title: 'The Lighthouse' })]);
        expect(w.records.size).toBe(0);
    });

    it('the record holds where the notes go and which were written, never the timeline or any text', async () => {
        const w = world();
        let seen: CommunityBookTransferRecord | undefined;
        w.server.done = async () => { seen = w.records.get(TRANSFER_ID); };
        await runBookTransfer(w.deps, start());
        expect(seen).toEqual({
            schemaVersion: 1,
            profileId: 'profile-1',
            connectionId: 'conn-1',
            bookId: expect.any(String),
            folder: FOLDER,
            title: 'The Lighthouse',
            folderCreated: true,
            notes: {
                scn_0a1b2c3d: `${FOLDER}/01 The Docks.md`,
                scn_0a1b2c3e: `${FOLDER}/02 Night Watch.md`,
                scn_0a1b2c3f: `${FOLDER}/03 Landfall.md`,
            },
            phase: 'written',
            startedAt: '2026-11-21T12:00:00Z',
        });
        expect(JSON.stringify(seen)).not.toContain('It was cold');
    });

    it('a second run of the same book while the first is writing writes nothing', async () => {
        const w = world();
        let release: () => void = () => undefined;
        const held = new Promise<void>(resolve => { release = resolve; });
        const createFolder = w.deps.vault.createFolder;
        w.deps.vault.createFolder = async path => { await held; await createFolder(path); };
        const first = runBookTransfer(w.deps, start());
        const second = await runBookTransfer(w.deps, start());
        expect(second).toEqual({ kind: 'stopped', message: 'Radial Timeline is writing this book in another window. Its progress shows there.' });
        release();
        expect(await first).toMatchObject({ kind: 'done' });
        expect([...w.creates.values()].every(count => count === 1)).toBe(true);
    });

    it('writes nothing outside the new folder', async () => {
        const w = world();
        await runBookTransfer(w.deps, start());
        const touched = w.log.filter(step => step.startsWith('create')).map(step => step.slice(step.indexOf(' ') + 1));
        expect(touched.length).toBeGreaterThan(0);
        expect(touched.every(insideFolder)).toBe(true);
    });

    it('refuses a planned name that would leave the folder, before writing it', async () => {
        const w = world();
        const outside = [NOTES[0], { ...NOTES[1], fileName: '../Elsewhere.md' }];
        await expect(runBookTransfer(w.deps, start({ notes: outside }))).rejects.toThrow(/outside the new book folder/);
        expect([...w.files.keys()].every(insideFolder)).toBe(true);
        expect(w.files.has('Books/Elsewhere.md')).toBe(false);
        expect(w.log).not.toContain('register');
    });
});

describe('resuming', () => {
    it('continues after the app closed mid-write, and never writes a note twice', async () => {
        const w = world();
        w.closeAppOnPut = record => Object.keys(record.notes).length === 2;
        await expect(runBookTransfer(w.deps, start())).rejects.toThrow('The app closed.');
        expect(w.log).not.toContain('register');
        // The second note is on disk; the record saved before the close lists only the first.
        expect(Object.keys(w.records.get(TRANSFER_ID)!.notes)).toEqual(['scn_0a1b2c3d']);

        const again = await runBookTransfer(w.deps, start({ folder: 'Ignored/Because a record exists' }));
        expect(again).toMatchObject({ kind: 'done', folder: FOLDER });
        expect([...w.creates.values()].every(count => count === 1)).toBe(true);
        expect(w.creates.size).toBe(3);
    });

    it('continues in the record\'s folder with the record\'s book id', async () => {
        const w = world();
        w.closeAppOnPut = record => Object.keys(record.notes).length === 1;
        await expect(runBookTransfer(w.deps, start())).rejects.toThrow();
        const bookId = w.records.get(TRANSFER_ID)!.bookId;
        const again = await runBookTransfer(w.deps, start({ folder: 'Somewhere Else' }));
        expect(again).toMatchObject({ kind: 'done', bookId, folder: FOLDER });
        expect(w.folders.has('Somewhere Else')).toBe(false);
    });

    it('stops at a note it did not write, and replaces nothing', async () => {
        const w = world();
        w.closeAppOnPut = record => Object.keys(record.notes).length === 1;
        await expect(runBookTransfer(w.deps, start())).rejects.toThrow();
        // While the app was closed, the author's own note took the second name.
        w.files.set(`${FOLDER}/02 Night Watch.md`, 'The author\'s own note.');
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toEqual({ kind: 'stopped', message: expect.stringContaining('02 Night Watch.md is in the folder') });
        expect(w.files.get(`${FOLDER}/02 Night Watch.md`)).toBe('The author\'s own note.');
        expect(w.log).not.toContain('register');
    });

    it('a failed write stops with the reason, and Continue writes the rest', async () => {
        const w = world();
        const create = w.deps.vault.create;
        let failOnce = true;
        w.deps.vault.create = async (path, content) => {
            if (failOnce && path.endsWith('03 Landfall.md')) {
                failOnce = false;
                throw new Error('Disk full.');
            }
            return create(path, content);
        };
        const first = await runBookTransfer(w.deps, start());
        expect(first).toEqual({ kind: 'stopped', message: 'Could not write 03 Landfall.md (Disk full). Choose Continue to write the rest.' });
        expect(await runBookTransfer(w.deps, start())).toMatchObject({ kind: 'done' });
        expect(w.creates.get(`${FOLDER}/01 The Docks.md`)).toBe(1);
    });
});

describe('the folder', () => {
    it('is never written into when it is already in the vault', async () => {
        const w = world(['Books', FOLDER]);
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toMatchObject({ kind: 'stopped', folderGone: true });
        expect(w.records.size).toBe(0);
        expect(w.files.size).toBe(0);
    });

    it('a folder with something in it that appeared after the record, before the folder was made, ends the record with nothing written', async () => {
        const w = world();
        // The record is saved; the app closes before the folder is made.
        const createFolder = w.deps.vault.createFolder;
        w.deps.vault.createFolder = async () => { throw new Error('The app closed.'); };
        await expect(runBookTransfer(w.deps, start())).rejects.toThrow('The app closed.');
        expect(w.records.get(TRANSFER_ID)?.folderCreated).toBe(false);
        w.deps.vault.createFolder = createFolder;
        w.folders.add(FOLDER);
        w.files.set(`${FOLDER}/Someone else.md`, 'Not this book.');
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toMatchObject({ kind: 'stopped', folderGone: true });
        expect(w.records.size).toBe(0);
        expect(w.files.size).toBe(1);
        expect(w.files.get(`${FOLDER}/Someone else.md`)).toBe('Not this book.');
    });

    it('a folder made just before the app closed, before the record said so, is the run\'s own: Continue writes into it', async () => {
        const w = world();
        w.closeAppOnPut = record => record.folderCreated;
        await expect(runBookTransfer(w.deps, start())).rejects.toThrow('The app closed.');
        expect(w.folders.has(FOLDER)).toBe(true);
        expect(w.records.get(TRANSFER_ID)?.folderCreated).toBe(false);

        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toMatchObject({ kind: 'done', folder: FOLDER });
        expect(w.log.filter(step => step.startsWith('createFolder'))).toHaveLength(1);
        expect(w.creates.size).toBe(3);
    });

    it('an empty folder at another spelling of the record\'s folder is not taken as the run\'s own', async () => {
        const w = world();
        w.deps.vault.createFolder = async () => { throw new Error('The app closed.'); };
        await expect(runBookTransfer(w.deps, start())).rejects.toThrow('The app closed.');
        // A file system that ignores case reports the other spelling as the same folder.
        w.folders.add('Books/the lighthouse');
        w.deps.vault.exists = async path => [...w.folders, ...w.files.keys()].some(entry => entry.toLowerCase() === path.toLowerCase());
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toMatchObject({ kind: 'stopped', folderGone: true });
        expect(w.records.size).toBe(0);
        expect(w.files.size).toBe(0);
    });
});

describe('the vault check on disk (Obsidian)', () => {
    const plugin = (onDisk: string[], folders: Record<string, { children: unknown[]; onDisk: string[] }> = {}) => ({
        app: {
            vault: {
                getAllLoadedFiles: () => [],
                getFolderByPath: (path: string) => (folders[path] ? { path, children: folders[path].children } : null),
                adapter: {
                    exists: async (path: string) => onDisk.includes(path),
                    list: async (path: string) => ({ files: folders[path]?.onDisk ?? [], folders: [] }),
                },
            },
        },
        settings: {},
    });

    it('a path Obsidian has not listed but the disk holds counts as taken', async () => {
        const deps = obsidianBookTransferDeps(plugin(['Books/Wait']) as never);
        expect(await deps.vault.exists('Books/Wait')).toBe(true);
        expect(await deps.vault.exists('Books/Elsewhere')).toBe(false);
    });

    it('a folder is empty only when Obsidian and the disk both find nothing in it', async () => {
        const deps = obsidianBookTransferDeps(plugin([], {
            'Books/Empty': { children: [], onDisk: [] },
            'Books/Hidden file': { children: [], onDisk: ['Books/Hidden file/.sync'] },
            'Books/Listed': { children: [{}], onDisk: [] },
        }) as never);
        expect(await deps.vault.isEmptyFolder('Books/Empty')).toBe(true);
        expect(await deps.vault.isEmptyFolder('Books/Hidden file')).toBe(false);
        expect(await deps.vault.isEmptyFolder('Books/Listed')).toBe(false);
        expect(await deps.vault.isEmptyFolder('Books/Missing')).toBe(false);
    });

    it('a note the disk already holds is never written over: the run stops with a sentence', async () => {
        const w = world();
        // Obsidian does not list the note; the disk has one at its path (Windows spells "Landfall." as "Landfall").
        w.deps.vault.exists = async path => w.files.has(path) || w.folders.has(path) || path === `${FOLDER}/03 Landfall.md`;
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toEqual({ kind: 'stopped', message: '03 Landfall.md is in the folder and was not written for this book. Rename it, then choose Continue.' });
        expect(w.creates.has(`${FOLDER}/03 Landfall.md`)).toBe(false);
        expect(w.log).not.toContain('register');
    });
});

describe('the check on disk', () => {
    it('stops when a written note lost its ID line, and tells Community nothing', async () => {
        const w = world();
        const create = w.deps.vault.create;
        w.deps.vault.create = async (path, content) => create(path, path.endsWith('02 Night Watch.md') ? content.replace('ID: scn_0a1b2c3e\n', '') : content);
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toEqual({ kind: 'stopped', message: '02 Night Watch.md is missing or its ID line changed. Restore it, then choose Continue.' });
        expect(w.log.some(step => step.startsWith('done'))).toBe(false);
    });

    it('stops when two notes in the folder hold one scene ID', async () => {
        const w = world();
        // A sync service drops a copy of the first note into the new folder as it is made.
        const createFolder = w.deps.vault.createFolder;
        w.deps.vault.createFolder = async path => {
            await createFolder(path);
            w.files.set(`${FOLDER}/01 The Docks copy.md`, NOTES[0].content);
        };
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toEqual({ kind: 'stopped', message: `Two notes in ${FOLDER} hold the scene ID scn_0a1b2c3d. Give the copy its own ID, then choose Continue.` });
        expect(w.log.some(step => step.startsWith('done'))).toBe(false);
    });
});

describe('telling Community', () => {
    it('a lost answer is settled by asking: done for this book registers it', async () => {
        const w = world();
        w.server.done = async () => { throw new Error('net::ERR_CONNECTION_RESET'); };
        let bookId = '';
        w.server.state = async () => ({ state: 'done', pluginBookKey: bookId, expiresAt: '2026-11-22T12:00:00Z' });
        w.deps.store.put = (put => async (id: string, record: CommunityBookTransferRecord) => { bookId = record.bookId; await put(id, record); })(w.deps.store.put);
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toMatchObject({ kind: 'done', bookId });
        expect(w.log.slice(-4)).toEqual([expect.stringMatching(/^done /), 'state', 'register', 'remove']);
    });

    it('a lost answer with the transfer still open keeps the record, and Continue sends done again without rewriting', async () => {
        const w = world();
        w.server.done = async () => { throw new Error('net::ERR_TIMED_OUT'); };
        const first = await runBookTransfer(w.deps, start());
        expect(first).toEqual({ kind: 'stopped', message: 'Community has not confirmed yet. Choose Continue to ask again.' });
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('written');
        expect(w.registered).toEqual([]);

        w.server.done = async () => undefined;
        const second = await runBookTransfer(w.deps, start({ notes: undefined }));
        expect(second).toMatchObject({ kind: 'done' });
        expect(w.log.filter(step => step.startsWith('done'))).toHaveLength(2);
        expect(w.creates.size).toBe(3);
        expect([...w.creates.values()].every(count => count === 1)).toBe(true);
        expect(w.registered).toHaveLength(1);
    });

    it('a lost answer when Community cannot be asked either says so and keeps everything', async () => {
        const w = world();
        w.server.done = async () => { throw new Error('offline'); };
        w.server.state = async () => { throw new Error('offline'); };
        expect(await runBookTransfer(w.deps, start())).toEqual({ kind: 'stopped', message: 'Community has not confirmed yet. Choose Continue to ask again.' });
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('written');
    });

    const ended: Array<[string, BookTransferState, CommunityShareError]> = [
        ['cancelled on the website', { state: 'cancelled', cancelReason: 'cancelled_by_author', expiresAt: 'x' }, new CommunityShareError('transfer_cancelled', 'This was cancelled on the book\'s Share page.')],
        ['expired', { state: 'expired', expiresAt: 'x' }, new CommunityShareError('transfer_expired', 'This expired. Add the book to your vault again from its Share page.')],
        ['cancelled because the timeline changed', { state: 'cancelled', cancelReason: 'timeline_changed', expiresAt: 'x' }, new CommunityShareError('timeline_changed', 'The timeline changed on Community.')],
        ['done for another book', { state: 'done', pluginBookKey: 'another-book', expiresAt: 'x' }, new CommunityShareError('transfer_done_with_other_book', 'Another book finished this.')],
    ];

    it.each(ended)('%s after writing: the notes stay, nothing is registered, and the record waits for the author', async (_case, state, refusal) => {
        const w = world();
        w.server.done = async () => { throw refusal; };
        w.server.state = async () => state;
        const outcome = await runBookTransfer(w.deps, start());
        expect(outcome).toEqual({ kind: 'cancelled', title: 'The Lighthouse', folder: FOLDER });
        expect(w.registered).toEqual([]);
        expect(w.files.size).toBe(3);
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('cancelled');
        // Opened again, it says the same and writes nothing.
        const creates = w.creates.size;
        expect(await runBookTransfer(w.deps, start())).toEqual({ kind: 'cancelled', title: 'The Lighthouse', folder: FOLDER });
        expect(w.creates.size).toBe(creates);
    });

    it('a transfer Community no longer holds has ended: the notes stay and the record waits for the author', async () => {
        const w = world();
        const gone = new CommunityShareError('transfer_not_found', 'Community has no such transfer.');
        w.server.done = async () => { throw gone; };
        w.server.state = async () => { throw gone; };
        expect(await runBookTransfer(w.deps, start())).toEqual({ kind: 'cancelled', title: 'The Lighthouse', folder: FOLDER });
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('cancelled');
        expect(w.files.size).toBe(3);
        expect(w.registered).toEqual([]);
    });

    it('a refusal while the transfer is still open is shown as Community sent it', async () => {
        const w = world();
        const sentence = 'The scene list changed on Community. Open the book\'s Share page, then add the book again.';
        w.server.done = async () => { throw new CommunityShareError('scene_ids_mismatch', sentence); };
        expect(await runBookTransfer(w.deps, start())).toEqual({ kind: 'stopped', message: sentence });
        expect(w.registered).toEqual([]);
    });

    it('a refusal this plugin has never seen is shown as Community sent it', async () => {
        const w = world();
        w.server.done = async () => { throw new CommunityShareError('a_new_refusal', 'A sentence from a newer server. Do this next.'); };
        w.server.state = async () => { throw new Error('offline'); };
        expect(await runBookTransfer(w.deps, start())).toEqual({ kind: 'stopped', message: 'A sentence from a newer server. Do this next.' });
    });

    it('done with no book named is not taken as done', async () => {
        const w = world();
        w.server.done = async () => { throw new Error('lost'); };
        w.server.state = async () => ({ state: 'done', expiresAt: 'x' });
        expect(await runBookTransfer(w.deps, start())).toMatchObject({ kind: 'stopped' });
        expect(w.registered).toEqual([]);
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('written');
    });

    it('registers only after Community confirms', async () => {
        const w = world();
        let registeredBeforeDone = false;
        w.server.done = async () => { registeredBeforeDone = w.registered.length > 0; };
        await runBookTransfer(w.deps, start());
        expect(registeredBeforeDone).toBe(false);
        expect(w.log.indexOf('register')).toBeGreaterThan(w.log.findIndex(step => step.startsWith('done')));
    });
});

describe('a book that can no longer be read from Community', () => {
    const recorded = (w: World, phase: CommunityBookTransferRecord['phase'] = 'writing'): void => {
        w.records.set(TRANSFER_ID, {
            schemaVersion: 1,
            profileId: 'profile-1',
            connectionId: 'conn-1',
            bookId: 'book-1',
            folder: FOLDER,
            title: 'The Lighthouse',
            folderCreated: true,
            notes: { scn_0a1b2c3d: `${FOLDER}/01 The Docks.md` },
            phase,
            startedAt: '2026-11-21T12:00:00Z',
        });
    };
    const notFound = new CommunityShareError('transfer_not_found', 'Community has no such transfer.');

    it('read answered transfer_not_found: the record is canceled without asking again, so the card offers its dismiss button', async () => {
        const w = world();
        recorded(w);
        expect(await settleUnreadableTransfer(w.deps, TRANSFER_ID.toUpperCase(), notFound)).toBe(true);
        expect(w.records.get(TRANSFER_ID)).toMatchObject({ phase: 'cancelled', folder: FOLDER, notes: { scn_0a1b2c3d: `${FOLDER}/01 The Docks.md` } });
        expect(w.log).not.toContain('state');
    });

    it('state answered transfer_not_found: the record is canceled', async () => {
        const w = world();
        recorded(w);
        w.server.state = async () => { throw notFound; };
        expect(await settleUnreadableTransfer(w.deps, TRANSFER_ID, new Error('offline'))).toBe(true);
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('cancelled');
    });

    it('cancelled or expired on Community: the record is canceled', async () => {
        const w = world();
        recorded(w);
        w.server.state = async () => ({ state: 'expired', expiresAt: 'x' });
        expect(await settleUnreadableTransfer(w.deps, TRANSFER_ID, new Error('read failed'))).toBe(true);
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('cancelled');
    });

    const kept: Array<[string, () => Promise<BookTransferState>]> = [
        ['still open', async () => ({ state: 'open', expiresAt: 'x' })],
        ['done for this book', async () => ({ state: 'done', pluginBookKey: 'book-1', expiresAt: 'x' })],
        ['done for a book it does not name', async () => ({ state: 'done', expiresAt: 'x' })],
        ['not answered', async () => { throw new Error('offline'); }],
        ['refused for another reason', async () => { throw new CommunityShareError('sharing_level_required', 'Choose a level.'); }],
    ];

    it.each(kept)('%s: the record is kept as it was', async (_case, state) => {
        const w = world();
        recorded(w);
        w.server.state = state;
        expect(await settleUnreadableTransfer(w.deps, TRANSFER_ID, new Error('read failed'))).toBe(false);
        expect(w.records.get(TRANSFER_ID)?.phase).toBe('writing');
    });

    it('without a record, nothing is saved', async () => {
        const w = world();
        expect(await settleUnreadableTransfer(w.deps, TRANSFER_ID, notFound)).toBe(false);
        expect(w.records.size).toBe(0);
    });
});
