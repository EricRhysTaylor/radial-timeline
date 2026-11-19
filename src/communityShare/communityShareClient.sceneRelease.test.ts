/**
 * Private scenes: the only path by which scene text leaves the vault.
 *
 * The storage doctrine, pinned (Platform/COMMUNITY-SHARE-AMENDMENT-2-PRIVATE-SCENE-TEXT.md):
 * every scene-release request carries exactly the documented keys; only
 * `release` and `update` carry text; a paused share sends nothing; and no
 * background sync ever reaches the scene-release function.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    apiVersion: '1.9.0',
    Platform: {},
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import { buildDefaultCommunityShareSettings, sceneBodyShareFor } from './communityShareSettings';
import {
    CommunityShareError,
    acceptSceneReleaseTerms,
    fetchSceneReleaseStatus,
    pauseCommunitySharing,
    releaseSceneBody,
    resumeCommunitySharing,
    scheduleCommunityProjectSync,
    setSceneBodySharing,
    startTimelineSharing,
    syncCommunityDailyIfEligible,
    syncCommunityProjectsIfConnected,
    syncCommunityShareIfDue,
    syncCommunityTimelinesIfDue,
    takeDownSceneRelease
} from './communityShareClient';
import { parsePastedScene, type SceneBlock } from './sceneReleaseText';
import { SCENE_AUTHOR_AGREEMENT_VERSION } from './sceneAgreement';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const RELEASE_ID = '44444444-4444-4444-8444-444444444444';
const SECRET_KEY = 'rt-community-share-connection-secret';
const SCENE_TEXT = 'SCENE_TEXT_TRACER_DO_NOT_LEAK';
const BLOCKS: SceneBlock[] = parsePastedScene(`Mira opened the door. ${SCENE_TEXT}\n\n***\n\nIt was *cold*.`);
const BASE_KEYS = ['action', 'connection_id', 'current_secret', 'plugin_book_key'];

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
    // The scene's note. No client call reads it: text arrives only as the blocks
    // the preview dialog hands to releaseSceneBody.
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
            vault: { read: readNote, cachedRead: readNote },
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
        const request = respond({ body: { ok: true, version: '2026-11-14' } });
        await acceptSceneReleaseTerms(h.plugin as never, h.book);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'terms_version'].sort());
        expect(body.action).toBe('consent');
        expect(body.terms_version).toBe(SCENE_AUTHOR_AGREEMENT_VERSION);
    });

    it('take_down: the release id, and no text', async () => {
        const h = harness();
        const request = respond({ body: { ok: true } });
        await takeDownSceneRelease(h.plugin as never, h.book, RELEASE_ID);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'release_id'].sort());
        expect(body).toMatchObject({ action: 'take_down', release_id: RELEASE_ID });
        expect(JSON.stringify(body)).not.toContain('blocks');
    });

    it('release: the scene id, the rating and the blocks it was handed', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        const result = await releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS });
        expect(result.release.version).toBe(1);
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'blocks', 'rating', 'scene_id'].sort());
        expect(body).toMatchObject({ action: 'release', scene_id: 'scn_a1b2c3d4', rating: 'general', plugin_book_key: 'book-1' });
        expect(body.blocks).toEqual(BLOCKS);
        // The blocks arrive as an argument. The client reads no note of its own.
        expect(h.readNote).not.toHaveBeenCalled();
    });

    it('update: the same, plus the version the status reported', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'mature', blocks: BLOCKS, expectedVersion: 2 });
        const [body] = sceneCalls(request);
        expect(keysOf(body)).toEqual([...BASE_KEYS, 'blocks', 'expected_version', 'rating', 'scene_id'].sort());
        expect(body).toMatchObject({ action: 'update', expected_version: 2, rating: 'mature' });
    });

    it('only release and update carry blocks', async () => {
        const h = harness();
        const request = respond({ body: statusAnswer() });
        await fetchSceneReleaseStatus(h.plugin as never, h.book);
        respond({ body: { ok: true, version: SCENE_AUTHOR_AGREEMENT_VERSION } });
        await acceptSceneReleaseTerms(h.plugin as never, h.book);
        respond({ body: { ok: true } });
        await takeDownSceneRelease(h.plugin as never, h.book, RELEASE_ID);
        for (const options of sent(request)) {
            expect(options.body).not.toContain('blocks');
            expect(options.body).not.toContain(SCENE_TEXT);
        }
    });
});

describe('releaseSceneBody refuses before anything is sent', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a scene id the author typed', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await expect(releaseSceneBody(h.plugin as never, h.book, { sceneId: 'The Storm', rating: 'general', blocks: BLOCKS }))
            .rejects.toMatchObject({ code: 'invalid_request' });
        expect(request).not.toHaveBeenCalled();
    });

    it('text with no words, and text past the word limit', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        await expect(releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: [] }))
            .rejects.toMatchObject({ code: 'empty_text' });
        const long = Array.from({ length: 101 }, () => ({ kind: 'p' as const, runs: [Array.from({ length: 100 }, () => 'word').join(' ')] }));
        await expect(releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: long }))
            .rejects.toMatchObject({ code: 'too_long', message: expect.stringContaining('10,000 words') });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Pause is a full outbound freeze for private scenes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends nothing: no status, consent, release, update or take-down', async () => {
        const h = harness();
        await pauseCommunitySharing(h.plugin as never);
        const request = respond({ body: statusAnswer() });
        const plugin = h.plugin as never;
        const calls = [
            () => fetchSceneReleaseStatus(plugin, h.book),
            () => acceptSceneReleaseTerms(plugin, h.book),
            () => releaseSceneBody(plugin, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS }),
            () => releaseSceneBody(plugin, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS, expectedVersion: 1 }),
            () => takeDownSceneRelease(plugin, h.book, RELEASE_ID)
        ];
        for (const call of calls) {
            await expect(call()).rejects.toMatchObject({ code: 'sharing_paused' });
        }
        expect(request).not.toHaveBeenCalled();
    });

    it('stops a release when Pause lands while the connection secret is read', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        const storage = h.plugin.app.secretStorage;
        const read = storage.getSecret;
        storage.getSecret = (id: string) => {
            h.plugin.settings.communityShare.sharingPaused = true;
            return read(id);
        };
        await expect(releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS }))
            .rejects.toMatchObject({ code: 'sharing_paused' });
        expect(request).not.toHaveBeenCalled();
    });

    it('sends nothing at the Private level or from a disconnected vault', async () => {
        const h = harness();
        const request = respond({ body: releaseAnswer() });
        h.plugin.settings.communityShare.enabled = false;
        h.plugin.settings.communityShare.tier = 0;
        await expect(releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS }))
            .rejects.toMatchObject({ code: 'sharing_level_required' });
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
        'server_error'
    ])('surfaces %s as a CommunityShareError with the website\'s message', async code => {
        const h = harness();
        respond({ status: 409, body: { error: { code, message: `The website says ${code}.` }, limit: 3 } });
        const failure = await releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS })
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
});

describe('Share scene body, the per-book switch', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is off by default', () => {
        const h = harness();
        expect(sceneBodyShareFor(h.plugin.settings.communityShare, 'book-1')).toBeUndefined();
    });

    it('turns on and off without sending anything, and keeps only the switch and the project', async () => {
        const h = harness();
        const request = respond({ body: statusAnswer() });
        await setSceneBodySharing(h.plugin as never, 'book-1', true, PROJECT_ID);
        expect(sceneBodyShareFor(h.plugin.settings.communityShare, 'book-1'))
            .toEqual({ profileId: 'profile-1', enabled: true, projectId: PROJECT_ID });
        await setSceneBodySharing(h.plugin as never, 'book-1', false);
        expect(sceneBodyShareFor(h.plugin.settings.communityShare, 'book-1'))
            .toEqual({ profileId: 'profile-1', enabled: false, projectId: PROJECT_ID });
        expect(request).not.toHaveBeenCalled();
    });

    it('a release stores no text and no hash in settings', async () => {
        const h = harness();
        await setSceneBodySharing(h.plugin as never, 'book-1', true, PROJECT_ID);
        respond({ body: statusAnswer() });
        await fetchSceneReleaseStatus(h.plugin as never, h.book);
        respond({ body: releaseAnswer() });
        await releaseSceneBody(h.plugin as never, h.book, { sceneId: 'scn_a1b2c3d4', rating: 'general', blocks: BLOCKS });
        const stored = JSON.stringify(h.plugin.settings);
        expect(stored).not.toContain(SCENE_TEXT);
        expect(stored).not.toContain('a'.repeat(64));
        expect(stored).not.toContain('blocks');
    });

    it('is ignored for an account the author did not turn it on for', async () => {
        const h = harness();
        await setSceneBodySharing(h.plugin as never, 'book-1', true, PROJECT_ID);
        h.plugin.settings.communityShare.connection.profileId = 'profile-2';
        expect(sceneBodyShareFor(h.plugin.settings.communityShare, 'book-1')).toBeUndefined();
    });
});

describe('background sync never sends scene text', () => {
    beforeEach(() => vi.clearAllMocks());

    it('every scheduled entry point runs with Share scene body on, and none reaches scene-release-sync', async () => {
        const h = harness();
        const plugin = h.plugin as never;
        respond({ body: statusAnswer() });
        await startTimelineSharing(plugin, h.book as never);
        await setSceneBodySharing(plugin, 'book-1', true, PROJECT_ID);
        // The standing share at the progress level, with a timeline change waiting.
        h.plugin.settings.communityShare.tier = 4;
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

describe('the release call has two callers, each behind its own button', () => {
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

    it('releaseSceneBody is defined in the client and called only by the preview and the batch release', () => {
        expect(naming('releaseSceneBody')).toEqual([
            'communityShare/communityShareClient.ts',
            'modals/SceneReleaseBatchModal.ts',
            'modals/SceneReleasePreviewModal.ts'
        ]);
        const client = files.find(file => file.path === 'communityShare/communityShareClient.ts')!.text;
        // Its definition, and no call from inside the client (no sync can reach it).
        expect(count(client, 'releaseSceneBody(')).toBe(1);
        expect(client).toContain('export async function releaseSceneBody(');
    });

    it('the preview dialog calls it once, from the handler of its one primary button', () => {
        const modal = files.find(file => file.path === 'modals/SceneReleasePreviewModal.ts')!.text;
        expect(count(modal, 'releaseSceneBody(')).toBe(1);
        const send = modal.slice(modal.indexOf('private async send('));
        expect(send).toContain('await releaseSceneBody(');
        // send() runs only from that button's click.
        expect(count(modal, 'this.send(')).toBe(1);
        expect(modal).toContain('.onClick(() => this.send(draft));');
        // The note is read again, and compared, before the text goes.
        expect(send.indexOf('readSceneReleaseDraft(')).toBeGreaterThan(-1);
        expect(send.indexOf('now.hash !== previewed.hash')).toBeLessThan(send.indexOf('await releaseSceneBody('));
        expect(send.indexOf('readSceneReleaseDraft(')).toBeLessThan(send.indexOf('now.hash !== previewed.hash'));
    });

    it('the batch release calls it once, per scene, only after the author presses its one primary button', () => {
        const modal = files.find(file => file.path === 'modals/SceneReleaseBatchModal.ts')!.text;
        expect(count(modal, 'releaseSceneBody(')).toBe(1);
        const releaseOne = modal.slice(modal.indexOf('private async releaseOne('));
        expect(releaseOne).toContain('await releaseSceneBody(');
        // releaseOne runs only from send(), and send() only from that button's click.
        expect(count(modal, 'this.releaseOne(')).toBe(1);
        const send = modal.slice(modal.indexOf('private async send('), modal.indexOf('private async releaseOne('));
        expect(send).toContain('this.releaseOne(');
        expect(count(modal, 'this.send(')).toBe(1);
        expect(modal).toContain('.onClick(() => this.send());');
        // Each note is read again, and compared with the text confirmed, before its text goes.
        expect(releaseOne.indexOf('readSceneReleaseDraft(')).toBeGreaterThan(-1);
        expect(releaseOne.indexOf('readSceneReleaseDraft(')).toBeLessThan(releaseOne.indexOf('now.hash !== confirmed.hash'));
        expect(releaseOne.indexOf('now.hash !== confirmed.hash')).toBeLessThan(releaseOne.indexOf('await releaseSceneBody('));
    });

    it('nothing main.ts schedules knows about scene releases', () => {
        const main = files.find(file => file.path === 'main.ts')!.text;
        // One exception: registering the Release scenes link, which runs only when the author opens it.
        const linkLines = main.split('\n').filter(line => line.includes('SceneReleaseLink'));
        expect(linkLines.map(line => line.trim())).toEqual([
            "import { registerSceneReleaseLink } from './services/SceneReleaseLinkService';",
            'registerSceneReleaseLink(this);',
        ]);
        const rest = main.split('\n').filter(line => !line.includes('SceneReleaseLink')).join('\n');
        expect(rest).not.toMatch(/sceneRelease|SceneRelease|releaseSceneBody|sceneBody/);
    });

    it('the Release scenes link registers one protocol handler and sends no text', () => {
        const service = files.find(file => file.path === 'services/SceneReleaseLinkService.ts')!.text;
        expect(count(service, 'registerObsidianProtocolHandler(')).toBe(1);
        expect(service).not.toMatch(/releaseSceneBody|setSceneBodySharing|registerInterval|setInterval/);
    });
});
