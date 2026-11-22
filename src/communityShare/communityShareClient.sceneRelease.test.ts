/**
 * Scene text: the only path by which scene text leaves the vault.
 *
 * The storage doctrine, pinned (Platform/COMMUNITY-SHARE-AMENDMENT-2-PRIVATE-SCENE-TEXT.md,
 * changed by the 2026-11-22 contract "Scene text asked on Community, sent from
 * the vault"): every scene-release request carries exactly the documented
 * keys; only `release` and `update` carry text, and each names the request it
 * answers; below Level 4 or while paused nothing is sent; and no background
 * sync ever reaches the scene-release function.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    apiVersion: '1.9.0',
    Platform: {},
    normalizePath: (path: string) => path.replace(/\/+$/, ''),
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import { buildDefaultCommunityShareSettings, normalizeCommunityShareSettings } from './communityShareSettings';
import {
    CommunityShareError,
    acceptSceneReleaseTerms,
    fetchSceneReleaseStatus,
    pauseCommunitySharing,
    resumeCommunitySharing,
    scheduleCommunityProjectSync,
    startTimelineSharing,
    syncCommunityDailyIfEligible,
    syncCommunityProjectsIfConnected,
    syncCommunityShareIfDue,
    syncCommunityTimelinesIfDue,
} from './communityShareClient';
import { declineSceneTextRequest, fetchSceneTextRequests, sendRequestedScene } from './sceneTextRequests';
import { parsePastedScene, type SceneBlock } from './sceneReleaseText';
import { SCENE_AUTHOR_AGREEMENT_VERSION } from './sceneAgreement';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const RELEASE_ID = '44444444-4444-4444-8444-444444444444';
const SECRET_KEY = 'rt-community-share-connection-secret';
const SCENE_TEXT = 'SCENE_TEXT_TRACER_DO_NOT_LEAK';
const BLOCKS: SceneBlock[] = parsePastedScene(`Mira opened the door. ${SCENE_TEXT}\n\n***\n\nIt was *cold*.`);
const BASE_KEYS = ['action', 'connection_id', 'current_secret', 'plugin_book_key'];
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const RELEASE_REQUEST = { id: REQUEST_ID, scene_id: 'scn_a1b2c3d4', kind: 'release' as const, release_version: null };
const UPDATE_REQUEST = { id: REQUEST_ID, scene_id: 'scn_a1b2c3d4', kind: 'update' as const, release_version: 2 };
const requestRow = (extra: Record<string, unknown> = {}) => ({
    id: REQUEST_ID, scene_id: 'scn_a1b2c3d4', scene_title: '1 Scene', kind: 'release', rating: 'mature', audience: 'named',
    asked_at: '2026-11-22T10:00:00Z', expires_at: '2026-12-06T10:00:00Z', release_id: null, release_version: null, ...extra
});

const releaseRow = (extra: Record<string, unknown> = {}) => ({
    id: RELEASE_ID,
    scene_id: 'scn_a1b2c3d4',
    scene_title: '1 Scene',
    version: 2,
    rating: 'general',
    words: 7,
    text_hash: 'a'.repeat(64),
    hidden: false,
    released_at: '2026-11-15T10:00:00Z',
    updated_at: '2026-11-15T11:00:00Z',
    readers: 1,
    ...extra
});

const statusAnswer = (extra: Record<string, unknown> = {}) => ({
    project_id: PROJECT_ID,
    consent: true,
    standing: null,
    has_timeline: true,
    limit: 3,
    releases: [releaseRow()],
    ...extra
});

const releaseAnswer = () => ({
    release: {
        id: RELEASE_ID,
        scene_order: 1,
        scene_title: '1 Scene',
        stable: true,
        bound_order: 1,
        version: 1,
        rating: 'general',
        words: 7,
        hidden: false,
        released_at: '2026-11-15T10:00:00Z',
        updated_at: '2026-11-15T10:00:00Z'
    }
});

function harness() {
    const secrets = new Map<string, string>([[SECRET_KEY, 'rtcs_current-secret']]);
    const book = { id: 'book-1', title: 'Private Title', publicLabel: 'Public Name', sourceFolder: 'Books/Private Path' };
    const scenes = [{
        title: '1 Scene', date: '', path: 'Books/Private Path/1 Scene.md', sceneId: 'scn_a1b2c3d4',
        subplot: 'Main Plot', synopsis: 'A synopsis.', itemType: 'Scene', Character: ['Mira'],
    }];
    const settings = buildDefaultCommunityShareSettings();
    // Level 4: the gate for scene text.
    settings.enabled = true;
    settings.tier = 4;
    settings.audience = 'public';
    settings.sceneTextLevel = true;
    settings.connection = {
        status: 'connected',
        connectionId: 'conn-1',
        profileId: 'profile-1',
        projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    // The scene's note. No client call reads it: text arrives only as the blocks
    // the Send dialog hands to sendRequestedScene.
    const readNote = vi.fn(async () => `---\nClass: Scene\n---\n${SCENE_TEXT}`);
    const plugin = {
        manifest: { version: '7.4.0' },
        app: {
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (id: string, value: string) => { secrets.set(id, value); },
                delete: (id: string) => { secrets.delete(id); },
                listSecrets: () => Array.from(secrets.keys())
            },
            vault: {
                read: readNote,
                cachedRead: readNote,
                getFolderByPath: (path: string) => ({ path }),
                getMarkdownFiles: () => [{ path: 'Books/Private Path/1 Scene.md' }],
            },
            metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
            workspace: { layoutReady: true }
        },
        settings: { activeBookId: 'book-1', books: [book], actCount: 3, communityShare: settings },
        getSceneDataService: () => ({ getSceneDataWithBookMeta: async () => ({ items: scenes as unknown[], bookMeta: null as unknown }) }),
        getBookMeta: (): unknown => null,
        getWritingSessionService: () => ({ getRangeStats: async () => ({}) }),
        saveSettings: vi.fn(async () => undefined)
    };
    return { plugin, book, scenes, readNote };
}

/** Answer every request by endpoint and record it. */
function respond(sceneRelease: { status?: number; body: unknown }) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { url: string }) => {
        if (options.url.endsWith('scene-release-sync')) {
            return { status: sceneRelease.status ?? 200, text: JSON.stringify(sceneRelease.body) };
        }
        if (options.url.endsWith('community-project-sync')) {
            return { status: 200, text: JSON.stringify({ ok: true, created: 0, updated: 1, projects: [] }) };
        }
        if (options.url.endsWith('timeline-share-sync')) {
            return {
                status: 200,
                text: JSON.stringify({
                    ok: true,
                    shared: true,
                    project_id: PROJECT_ID,
                    share: { status: 'private', scene_count: 1, revealed_count: 0, hidden_scene_fields: [], generic_subplot_names: false }
                })
            };
        }
        return { status: 200, text: JSON.stringify({ ok: true }) };
    }) as never);
    return request;
}

const sent = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => options as unknown as { url: string; body: string });

const sceneCalls = (request: ReturnType<typeof vi.spyOn>) =>
    sent(request)
        .filter(options => options.url.endsWith('/scene-release-sync'))
        .map(options => JSON.parse(options.body) as Record<string, unknown>);

const keysOf = (body: Record<string, unknown>) => Object.keys(body).sort();

describe('scene-release-sync requests carry exactly the documented keys', () => {
    beforeEach(() => vi.clearAllMocks());

    it('status: the connection, the action and the book, and no text', async () => {
        const h = harness();
        const request = respond({ body: statusAnswer() });
        const status = await fetchSceneReleaseStatus(h.plugin as never, h.book);
        expect(status.releases[0].text_hash).toBe('a'.repeat(64));
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual(BASE_KEYS);
        expect(body).toEqual({
            connection_id: 'conn-1',
            current_secret: 'rtcs_current-secret',
            action: 'status',
            plugin_book_key: 'book-1'
        });
        expect(sent(request)).toHaveLength(1);
        expect(h.readNote).not.toHaveBeenCalled();
    });

    it('consent: includes the displayed agreement version, and no text', async () => {
        const h = harness();
        const request = respond({ body: { ok: true, version: SCENE_AUTHOR_AGREEMENT_VERSION } });
        await acceptSceneReleaseTerms(h.plugin as never, h.book);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'terms_version'].sort());
        expect(body.action).toBe('consent');
        expect(body.terms_version).toBe(SCENE_AUTHOR_AGREEMENT_VERSION);
    });

    it('requests: the action and the book, and no text', async () => {
        const h = harness();
        const request = respond({ body: { ok: true, requests: [requestRow()] } });
        const requests = await fetchSceneTextRequests(h.plugin as never, h.book);
        expect(requests).toEqual([requestRow()]);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual(BASE_KEYS);
        expect(body.action).toBe('requests');
    });

    it('decline: the request id, and no text', async () => {
        const h = harness();
        const request = respond({ body: { ok: true } });
        await declineSceneTextRequest(h.plugin as never, h.book, REQUEST_ID);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'request_id'].sort());
        expect(body).toMatchObject({ action: 'decline', request_id: REQUEST_ID });
    });

    it('release: the request id, the scene id and the blocks it was handed; the rating is the request\'s, so none is sent', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        const result = await sendRequestedScene(h.plugin as never, h.book, { request: RELEASE_REQUEST, blocks: BLOCKS });
        expect(result.release.version).toBe(1);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'blocks', 'request_id', 'scene_id'].sort());
        expect(body).toMatchObject({ action: 'release', request_id: REQUEST_ID, scene_id: 'scn_a1b2c3d4', plugin_book_key: 'book-1' });
        expect(body.blocks).toEqual(BLOCKS);
        // The blocks arrive as an argument. The client reads no note of its own.
        expect(h.readNote).not.toHaveBeenCalled();
    });

    it('update: the same, plus the version the status reported', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await sendRequestedScene(h.plugin as never, h.book, { request: UPDATE_REQUEST, blocks: BLOCKS });
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'blocks', 'expected_version', 'request_id', 'scene_id'].sort());
        expect(body).toMatchObject({ action: 'update', request_id: REQUEST_ID, expected_version: 2 });
    });

    it('only release and update carry blocks', async () => {
        const h = harness();
        const request = respond({ body: statusAnswer() });
        await fetchSceneReleaseStatus(h.plugin as never, h.book);
        respond({ body: { ok: true, version: SCENE_AUTHOR_AGREEMENT_VERSION } });
        await acceptSceneReleaseTerms(h.plugin as never, h.book);
        respond({ body: { ok: true, requests: [] } });
        await fetchSceneTextRequests(h.plugin as never, h.book);
        respond({ body: { ok: true } });
        await declineSceneTextRequest(h.plugin as never, h.book, REQUEST_ID);
        for (const options of sent(request)) {
            expect(options.body).not.toContain('blocks');
            expect(options.body).not.toContain(SCENE_TEXT);
        }
    });
});

describe('sendRequestedScene refuses before anything is sent', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a scene id the author typed', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await expect(sendRequestedScene(h.plugin as never, h.book, { request: { ...RELEASE_REQUEST, scene_id: 'The Storm' }, blocks: BLOCKS }))
            .rejects.toMatchObject({ code: 'invalid_request' });
        expect(request).not.toHaveBeenCalled();
    });

    it('an update without the released version', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await expect(sendRequestedScene(h.plugin as never, h.book, { request: { ...UPDATE_REQUEST, release_version: null }, blocks: BLOCKS }))
            .rejects.toMatchObject({ code: 'invalid_request' });
        expect(request).not.toHaveBeenCalled();
    });

    it('text with no words, and text past the word limit', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await expect(sendRequestedScene(h.plugin as never, h.book, { request: RELEASE_REQUEST, blocks: [] }))
            .rejects.toMatchObject({ code: 'empty_text' });
        const long = Array.from({ length: 101 }, () => ({ kind: 'p' as const, runs: [Array.from({ length: 100 }, () => 'word').join(' ')] }));
        await expect(sendRequestedScene(h.plugin as never, h.book, { request: RELEASE_REQUEST, blocks: long }))
            .rejects.toMatchObject({ code: 'too_long', message: expect.stringContaining('10,000 words') });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Pause, and any level below 4, send nothing about scene text', () => {
    beforeEach(() => vi.clearAllMocks());

    const everyCall = (plugin: never, book: { id: string }) => [
        () => fetchSceneReleaseStatus(plugin, book),
        () => acceptSceneReleaseTerms(plugin, book),
        () => fetchSceneTextRequests(plugin, book),
        () => declineSceneTextRequest(plugin, book, REQUEST_ID),
        () => sendRequestedScene(plugin, book, { request: RELEASE_REQUEST, blocks: BLOCKS }),
        () => sendRequestedScene(plugin, book, { request: UPDATE_REQUEST, blocks: BLOCKS }),
    ];

    it('paused: no status, consent, requests, decline, release or update', async () => {
        const h = harness();
        await pauseCommunitySharing(h.plugin as never);
        const request = respond({ body: statusAnswer() });
        for (const call of everyCall(h.plugin as never, h.book)) {
            await expect(call()).rejects.toMatchObject({ code: 'sharing_paused' });
        }
        expect(request).not.toHaveBeenCalled();
    });

    it.each([
        ['Level 3', { sceneTextLevel: false, tier: 4 }],
        ['Level 2', { sceneTextLevel: false, tier: 2 }],
        ['Private', { enabled: false, tier: 0, sceneTextLevel: false }],
    ])('at %s: nothing is listed or sent', async (_label, level) => {
        const h = harness();
        Object.assign(h.plugin.settings.communityShare, level);
        const request = respond({ body: statusAnswer() });
        for (const call of everyCall(h.plugin as never, h.book)) {
            await expect(call()).rejects.toMatchObject({ code: 'sharing_level_required' });
        }
        expect(request).not.toHaveBeenCalled();
    });

    it('stops a Send when Pause lands while the connection secret is read', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        const storage = h.plugin.app.secretStorage;
        const read = storage.getSecret;
        storage.getSecret = (id: string) => {
            h.plugin.settings.communityShare.sharingPaused = true;
            return read(id);
        };
        await expect(sendRequestedScene(h.plugin as never, h.book, { request: RELEASE_REQUEST, blocks: BLOCKS }))
            .rejects.toMatchObject({ code: 'sharing_paused' });
        expect(request).not.toHaveBeenCalled();
    });

    it('sends nothing from a disconnected vault', async () => {
        const h = harness();
        const request = respond({ body: statusAnswer() });
        h.plugin.settings.communityShare.connection.status = 'disconnected';
        await expect(fetchSceneReleaseStatus(h.plugin as never, h.book))
            .rejects.toMatchObject({ code: 'connection_required' });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('the website\'s answers', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        'unauthorized', 'invalid_request', 'project_mapping_required', 'not_found', 'account_flagged',
        'account_deletion_pending', 'consent_required', 'explicit_not_open', 'unknown_scene', 'already_released',
        'scene_limit_reached', 'scene_under_review', 'revision_conflict', 'too_long', 'empty_text', 'invalid_text',
        'server_error', 'ask_on_community', 'request_not_found', 'request_canceled', 'request_expired', 'request_declined',
        'request_sent', 'request_mismatch', 'scene_position_shared', 'public_consent_required', 'timeline_not_public'
    ])('surfaces %s as a CommunityShareError with the website\'s message', async code => {
        const h = harness();
        respond({ status: 409, body: { error: { code, message: `The website says ${code}.` }, limit: 3 } });
        const failure = await sendRequestedScene(h.plugin as never, h.book, { request: RELEASE_REQUEST, blocks: BLOCKS })
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(CommunityShareError);
        expect(failure).toMatchObject({ code, message: `The website says ${code}.` });
    });

    it('uses its own message when the website sends none', async () => {
        const h = harness();
        respond({ status: 500, body: {} });
        await expect(fetchSceneReleaseStatus(h.plugin as never, h.book))
            .rejects.toMatchObject({ code: 'scene_release_failed', message: expect.stringMatching(/scene service/) });
    });

    it.each([
        ['a project id that is not a UUID', { project_id: 'not-a-uuid' }],
        ['a hash that is not SHA-256 hex', { releases: [releaseRow({ text_hash: 'abc' })] }],
        ['an unknown rating', { releases: [releaseRow({ rating: 'explicit' })] }],
        ['an unknown standing', { standing: 'suspended' }],
        ['a missing limit', { limit: undefined }],
    ])('refuses a malformed status: %s', async (_label, extra) => {
        const h = harness();
        respond({ body: statusAnswer(extra) });
        await expect(fetchSceneReleaseStatus(h.plugin as never, h.book))
            .rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('accepts a detached release and an account in poor standing', async () => {
        const h = harness();
        respond({ body: statusAnswer({ standing: 'account_flagged', releases: [releaseRow({ scene_id: null, hidden: true })] }) });
        const status = await fetchSceneReleaseStatus(h.plugin as never, h.book);
        expect(status.standing).toBe('account_flagged');
        expect(status.releases[0].scene_id).toBeNull();
    });

    it.each([
        ['a request id that is not a UUID', { id: 'r1' }],
        ['a scene id that is not a scene id', { scene_id: 'The Storm' }],
        ['an unknown kind', { kind: 'paste' }],
        ['an unknown rating', { rating: 'explicit' }],
        ['an unknown audience', { audience: 'anyone' }],
        ['an update that names no release', { kind: 'update' }],
    ])('refuses a malformed request list: %s', async (_label, extra) => {
        const h = harness();
        respond({ body: { ok: true, requests: [requestRow(extra)] } });
        await expect(fetchSceneTextRequests(h.plugin as never, h.book))
            .rejects.toMatchObject({ code: 'invalid_response' });
    });
});

describe('the old Share scene body switch', () => {
    it('is not carried over: an author who had it on chooses Level 4', () => {
        const settings = normalizeCommunityShareSettings({
            ...buildDefaultCommunityShareSettings(),
            sceneBodyShares: { 'book-1': { profileId: 'profile-1', enabled: true } },
        } as never);
        expect(JSON.stringify(settings)).not.toContain('sceneBodyShares');
        expect(settings.sceneTextLevel).toBe(false);
    });

    it('a Send stores no text and no hash in settings', async () => {
        const h = harness();
        respond({ body: statusAnswer() });
        await fetchSceneReleaseStatus(h.plugin as never, h.book);
        respond({ body: releaseAnswer() });
        await sendRequestedScene(h.plugin as never, h.book, { request: RELEASE_REQUEST, blocks: BLOCKS });
        const stored = JSON.stringify(h.plugin.settings);
        expect(stored).not.toContain(SCENE_TEXT);
        expect(stored).not.toContain('a'.repeat(64));
        expect(stored).not.toContain('blocks');
    });
});

describe('background sync never sends scene text', () => {
    beforeEach(() => vi.clearAllMocks());

    it('every scheduled entry point runs at Level 4, and none reaches scene-release-sync', async () => {
        const h = harness();
        const plugin = h.plugin as never;
        respond({ body: statusAnswer() });
        await startTimelineSharing(plugin, h.book as never);
        // The standing share at Level 4, with a timeline change waiting.
        h.plugin.settings.communityShare.scheduledPublishEnabled = true;
        h.scenes[0].synopsis = 'Changed.';

        const request = respond({ body: statusAnswer() });
        // What main.ts schedules: the 20 s kickoff, the 6 h interval and the load-time sync.
        await syncCommunityShareIfDue(plugin);
        await syncCommunityTimelinesIfDue(plugin);
        await syncCommunityProjectsIfConnected(plugin);
        await scheduleCommunityProjectSync(plugin);
        await syncCommunityDailyIfEligible(plugin);
        // And the catch-up after a pause.
        await pauseCommunitySharing(plugin);
        h.scenes[0].synopsis = 'Changed again.';
        await resumeCommunitySharing(plugin);

        const requests = sent(request);
        // The sync did run and did send: the timeline went out.
        expect(requests.some(options => options.url.endsWith('timeline-share-sync'))).toBe(true);
        expect(requests.filter(options => options.url.includes('scene-release-sync'))).toEqual([]);
        for (const options of requests) {
            expect(options.body).not.toContain('"blocks"');
            expect(options.body).not.toContain(SCENE_TEXT);
        }
        // No scene note was read to feed any of it.
        expect(h.readNote).not.toHaveBeenCalled();
    });
});

describe('the call that sends text has one caller, behind its one button', () => {
    const SRC = resolve(process.cwd(), 'src');
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
    });
    const files = sources(SRC).map(path => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));
    const naming = (needle: string) => files.filter(file => file.text.includes(needle)).map(file => file.path).sort();
    const count = (text: string, needle: string) => text.split(needle).length - 1;

    it('scene-release-sync is named in the client only', () => {
        expect(naming("'scene-release-sync'")).toEqual(['communityShare/communityShareClient.ts']);
    });

    it('sendRequestedScene is defined with the request shapes and called only by the Send dialog', () => {
        expect(naming('sendRequestedScene')).toEqual([
            'communityShare/sceneTextRequests.ts',
            'modals/SceneTextSendModal.ts',
        ]);
        const requests = files.find(file => file.path === 'communityShare/sceneTextRequests.ts')!.text;
        expect(count(requests, 'sendRequestedScene(')).toBe(1);
        expect(requests).toContain('export async function sendRequestedScene(');
    });

    it('the Send dialog calls it once, from the handler of its Send button', () => {
        const modal = files.find(file => file.path === 'modals/SceneTextSendModal.ts')!.text;
        expect(count(modal, 'sendRequestedScene(')).toBe(1);
        const send = modal.slice(modal.indexOf('private async send('));
        expect(send).toContain('await sendRequestedScene(');
        // send() runs only from that button's click.
        expect(count(modal, 'this.send(')).toBe(1);
        expect(modal).toContain('.onClick(() => this.send(draft))');
        // The note is read again, and compared, before the text goes.
        expect(send.indexOf('readSceneReleaseDraft(')).toBeGreaterThan(-1);
        expect(send.indexOf('now.hash !== previewed.hash')).toBeLessThan(send.indexOf('await sendRequestedScene('));
        expect(send.indexOf('readSceneReleaseDraft(')).toBeLessThan(send.indexOf('now.hash !== previewed.hash'));
    });

    it('nothing main.ts schedules knows about scene text', () => {
        const main = files.find(file => file.path === 'main.ts')!.text;
        // One exception: registering the Send scene link, which runs only when the author opens it.
        const linkLines = main.split('\n').filter(line => line.includes('SceneReleaseLink'));
        expect(linkLines.map(line => line.trim())).toEqual([
            "import { registerSceneReleaseLink } from './services/SceneReleaseLinkService';",
            'registerSceneReleaseLink(this);',
        ]);
        const rest = main.split('\n').filter(line => !line.includes('SceneReleaseLink')).join('\n');
        expect(rest).not.toMatch(/sceneRelease|SceneRelease|sendRequestedScene|sceneText|SceneText/);
    });

    it('the Send scene link registers one protocol handler and sends no text', () => {
        const service = files.find(file => file.path === 'services/SceneReleaseLinkService.ts')!.text;
        expect(count(service, 'registerObsidianProtocolHandler(')).toBe(1);
        expect(service).not.toMatch(/sendRequestedScene|registerInterval|setInterval/);
    });
});
