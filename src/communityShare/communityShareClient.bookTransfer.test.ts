/**
 * Book from Community: the client calls to `timeline-transfer-sync`.
 *
 * What leaves the vault is pinned: the connection's credentials, the action,
 * and for `done` the new book's id and the scene ids it wrote. Every answer is
 * checked before anything is written, and a refusal reaches the author as the
 * sentence the website sent (Stage B contract, "Rules that hold everywhere").
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    apiVersion: '1.9.0',
    Platform: {},
    normalizePath: (path: string) => path.replace(/\/+$/, ''),
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import { buildDefaultCommunityShareSettings, timelineShareFor } from './communityShareSettings';
import {
    BOOK_TRANSFER_FAILED,
    fetchBookTransferState,
    finishBookTransfer,
    keepTimelineUpdated,
    listBookTransfers,
    readBookTransfer,
} from './communityShareClient';

const TRANSFER_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SECRET_KEY = 'rt-community-share-connection-secret';
const CREDENTIALS = { connection_id: 'conn-1', current_secret: 'rtcs_current-secret' };

function harness() {
    const secrets = new Map<string, string>([[SECRET_KEY, 'rtcs_current-secret']]);
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 2;
    settings.audience = 'public';
    settings.connection = {
        status: 'connected',
        connectionId: 'conn-1',
        profileId: 'profile-1',
        projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    const plugin = {
        manifest: { version: '8.1.0' },
        app: {
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (id: string, value: string) => { secrets.set(id, value); },
                delete: (id: string) => { secrets.delete(id); },
                listSecrets: () => Array.from(secrets.keys())
            }
        },
        settings: { activeBookId: undefined, books: [], actCount: 3, communityShare: settings },
        saveSettings: vi.fn(async () => undefined)
    };
    return { plugin };
}

function respondWith(status: number, body: unknown) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async () => ({ status, text: JSON.stringify(body) })) as never);
    return request;
}

const sentBodies = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => {
        const call = options as unknown as { url: string; body: string };
        expect(call.url.endsWith('/timeline-transfer-sync')).toBe(true);
        return JSON.parse(call.body) as Record<string, unknown>;
    });

const storedScene = (extra: Record<string, unknown> = {}) => ({
    id: 'scn_0a1b2c3d',
    order: 1,
    title: 'The Docks',
    act: 1,
    subplots: ['Main Plot'],
    status: 'todo',
    publishStage: 'zero',
    characters: ['Mira'],
    itemType: 'scene',
    revealed: true,
    released: false,
    audience: { type: 'private' },
    ...extra,
});

const readAnswer = (extra: Record<string, unknown> = {}) => ({
    ok: true,
    transfer_id: TRANSFER_ID,
    expires_at: '2026-11-22T12:00:00Z',
    document: {
        schemaVersion: '1.4.0',
        anonymized: false,
        book: { title: 'The Lighthouse', actCount: 3 },
        scenes: [storedScene(), storedScene({ id: 'scn_0a1b2c3e', order: 2, title: 'Night Watch' })],
    },
    released_text: [{ scene_id: 'scn_0a1b2c3d', blocks: [{ kind: 'p', runs: ['It was ', { em: 'cold' }, '.'] }], text_hash: 'b'.repeat(64) }],
    ...extra,
});

describe('Book from Community: what each call sends', () => {
    beforeEach(() => vi.clearAllMocks());

    it('list sends the connection and the action, nothing else', async () => {
        const h = harness();
        const request = respondWith(200, {
            ok: true,
            transfers: [{
                transfer_id: TRANSFER_ID, title: 'The Lighthouse', scene_count: 2, released_text_count: 1,
                include_released_text: true, opened_at: '2026-11-21T12:00:00Z', expires_at: '2026-11-22T12:00:00Z',
            }],
        });
        const offers = await listBookTransfers(h.plugin as never);
        expect(sentBodies(request)).toEqual([{ ...CREDENTIALS, action: 'list' }]);
        expect(offers).toEqual([{
            transferId: TRANSFER_ID, title: 'The Lighthouse', sceneCount: 2, releasedTextCount: 1,
            includeReleasedText: true, openedAt: '2026-11-21T12:00:00Z', expiresAt: '2026-11-22T12:00:00Z',
        }]);
    });

    it('read sends the transfer id and keeps only the timeline\'s own fields', async () => {
        const h = harness();
        const request = respondWith(200, readAnswer());
        const read = await readBookTransfer(h.plugin as never, TRANSFER_ID);
        expect(sentBodies(request)).toEqual([{ ...CREDENTIALS, action: 'read', transfer_id: TRANSFER_ID }]);
        expect(read.document.scenes[0]).toEqual({
            id: 'scn_0a1b2c3d', order: 1, title: 'The Docks', act: 1, subplots: ['Main Plot'],
            status: 'todo', publishStage: 'zero', characters: ['Mira'],
        });
        expect(read.releasedText).toEqual([{ sceneId: 'scn_0a1b2c3d', blocks: [{ kind: 'p', runs: ['It was ', { em: 'cold' }, '.'] }], textHash: 'b'.repeat(64) }]);
    });

    it('done sends the book id and the scene ids, and no text', async () => {
        const h = harness();
        const request = respondWith(200, { ok: true, state: 'done', project_id: PROJECT_ID, plugin_book_key: 'book-new', edited_in: 'vault' });
        const done = await finishBookTransfer(h.plugin as never, TRANSFER_ID, { pluginBookKey: 'book-new', sceneIds: ['scn_0a1b2c3d', 'scn_0a1b2c3e'] });
        expect(sentBodies(request)).toEqual([{
            ...CREDENTIALS, action: 'done', transfer_id: TRANSFER_ID, plugin_book_key: 'book-new', scene_ids: ['scn_0a1b2c3d', 'scn_0a1b2c3e'],
        }]);
        expect(done).toEqual({ projectId: PROJECT_ID, pluginBookKey: 'book-new' });
    });

    it('state sends the transfer id and reads the answer', async () => {
        const h = harness();
        const request = respondWith(200, { ok: true, state: 'cancelled', cancel_reason: 'cancelled_by_author', expires_at: '2026-11-22T12:00:00Z' });
        const state = await fetchBookTransferState(h.plugin as never, TRANSFER_ID);
        expect(sentBodies(request)).toEqual([{ ...CREDENTIALS, action: 'state', transfer_id: TRANSFER_ID }]);
        expect(state).toEqual({ state: 'cancelled', cancelReason: 'cancelled_by_author', expiresAt: '2026-11-22T12:00:00Z' });
    });
});

describe('Book from Community: every answer is checked before anything is written', () => {
    beforeEach(() => vi.clearAllMocks());

    const badReads: Array<[string, Record<string, unknown>]> = [
        ['another transfer', { transfer_id: '66666666-6666-4666-8666-666666666666' }],
        ['a beat among the scenes', { document: { book: { title: 'B', actCount: 3 }, scenes: [storedScene({ itemType: 'beat' })] } }],
        ['a scene with no permanent id', { document: { book: { title: 'B', actCount: 3 }, scenes: [storedScene({ id: 'scene-1' })] } }],
        ['two scenes on one id', { document: { book: { title: 'B', actCount: 3 }, scenes: [storedScene(), storedScene({ order: 2 })] } }],
        ['two scenes on one number', { document: { book: { title: 'B', actCount: 3 }, scenes: [storedScene(), storedScene({ id: 'scn_0a1b2c3e' })] } }],
        ['an unknown status', { document: { book: { title: 'B', actCount: 3 }, scenes: [storedScene({ status: 'drafting' })] } }],
        ['no scenes', { document: { book: { title: 'B', actCount: 3 }, scenes: [] } }],
        ['released text for a scene the timeline does not name', { released_text: [{ scene_id: 'scn_99999999', blocks: [], text_hash: 'b'.repeat(64) }] }],
        ['a block of an unknown kind', { released_text: [{ scene_id: 'scn_0a1b2c3d', blocks: [{ kind: 'h1', runs: ['x'] }], text_hash: 'b'.repeat(64) }] }],
        ['a run with an extra mark', { released_text: [{ scene_id: 'scn_0a1b2c3d', blocks: [{ kind: 'p', runs: [{ em: 'x', strong: true }] }], text_hash: 'b'.repeat(64) }] }],
        ['a malformed hash', { released_text: [{ scene_id: 'scn_0a1b2c3d', blocks: [], text_hash: 'nope' }] }],
    ];

    it.each(badReads)('refuses a read holding %s', async (_case, extra) => {
        const h = harness();
        respondWith(200, readAnswer(extra));
        await expect(readBookTransfer(h.plugin as never, TRANSFER_ID)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('refuses a done answer for another book id', async () => {
        const h = harness();
        respondWith(200, { ok: true, state: 'done', project_id: PROJECT_ID, plugin_book_key: 'someone-else', edited_in: 'vault' });
        await expect(finishBookTransfer(h.plugin as never, TRANSFER_ID, { pluginBookKey: 'book-new', sceneIds: ['scn_0a1b2c3d'] }))
            .rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('refuses a list with a malformed entry', async () => {
        const h = harness();
        respondWith(200, { ok: true, transfers: [{ transfer_id: 'not-a-uuid' }] });
        await expect(listBookTransfers(h.plugin as never)).rejects.toMatchObject({ code: 'invalid_response' });
    });
});

describe('Book from Community: refusals are shown as the website sent them', () => {
    beforeEach(() => vi.clearAllMocks());

    const refusals: Array<[string, number]> = [
        ['transfer_not_found', 404],
        ['transfer_expired', 409],
        ['transfer_cancelled', 409],
        ['timeline_changed', 409],
        ['scene_ids_mismatch', 409],
        ['book_key_in_use', 409],
        ['transfer_done_with_other_book', 409],
        ['book_deleted', 409],
        ['a_code_this_plugin_has_never_seen', 409],
    ];

    it.each(refusals)('%s keeps its code and its sentence', async (code, status) => {
        const h = harness();
        const sentence = `Community sentence for ${code}. Open the book's Share page to choose again.`;
        respondWith(status, { error: { code, message: sentence } });
        await expect(finishBookTransfer(h.plugin as never, TRANSFER_ID, { pluginBookKey: 'book-new', sceneIds: ['scn_0a1b2c3d'] }))
            .rejects.toMatchObject({ code, message: sentence });
    });

    it('an endpoint the server does not have yet is a plain failure, with no code of its own', async () => {
        const h = harness();
        respondWith(404, { code: 'NOT_FOUND', message: 'Requested function was not found' });
        await expect(listBookTransfers(h.plugin as never)).rejects.toMatchObject({ code: BOOK_TRANSFER_FAILED });
    });
});

describe('Book from Community: the gates every sender has', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends nothing while sharing is paused', async () => {
        const h = harness();
        h.plugin.settings.communityShare.sharingPaused = true;
        const request = respondWith(200, { ok: true, transfers: [] });
        await expect(listBookTransfers(h.plugin as never)).rejects.toMatchObject({ code: 'sharing_paused' });
        expect(request).not.toHaveBeenCalled();
    });

    it('sends nothing at the Private level', async () => {
        const h = harness();
        h.plugin.settings.communityShare.tier = 0;
        const request = respondWith(200, { ok: true, transfers: [] });
        await expect(listBookTransfers(h.plugin as never)).rejects.toMatchObject({ code: 'sharing_level_required' });
        expect(request).not.toHaveBeenCalled();
    });

    it('sends nothing without a connection', async () => {
        const h = harness();
        h.plugin.settings.communityShare.connection = { status: 'disconnected' } as never;
        const request = respondWith(200, { ok: true, transfers: [] });
        await expect(listBookTransfers(h.plugin as never)).rejects.toMatchObject({ code: 'connection_required' });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Keep timeline updated, for a book made from Community', () => {
    it('turns updates on for the connected profile and sends nothing itself', async () => {
        const h = harness();
        const request = respondWith(200, {});
        await keepTimelineUpdated(h.plugin as never, 'book-new');
        expect(request).not.toHaveBeenCalled();
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-new')).toEqual({ profileId: 'profile-1', enabled: true });
    });
});
