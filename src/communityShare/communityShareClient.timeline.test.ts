import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    apiVersion: '1.9.0',
    Platform: {},
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import { buildDefaultCommunityShareSettings, timelineShareFor } from './communityShareSettings';
import {
    fetchTimelineShareStatus,
    pauseCommunitySharing,
    resumeCommunitySharing,
    setTimelineShareDetails,
    startTimelineSharing,
    stopTimelineSharing,
    syncCommunityProjectsIfConnected,
    syncCommunityTimelinesIfDue
} from './communityShareClient';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SECRET_KEY = 'rt-community-share-connection-secret';

const answer = (status: 'private' | 'active' = 'private', extra: Record<string, unknown> = {}) => ({
    ok: true,
    shared: true,
    project_id: PROJECT_ID,
    share: { status, scene_count: 1, revealed_count: 0, hidden_scene_fields: [], generic_subplot_names: false },
    summary: { scenes_without_stable_id: 0, reveals_dropped: [] },
    ...extra
});

function harness() {
    const secrets = new Map<string, string>([[SECRET_KEY, 'rtcs_current-secret']]);
    const book = { id: 'book-1', title: 'Private Title', publicLabel: 'Public Name', sourceFolder: 'Books/Private Path' };
    const scenes = [{
        title: '1 Scene', date: '', path: 'Books/Private Path/1 Scene.md', sceneId: 'scn_a1b2c3d4',
        subplot: 'Main Plot', synopsis: 'A synopsis.', itemType: 'Scene', Character: ['Mira'],
    }];
    const sceneData = vi.fn(async (_options?: unknown) => ({ items: scenes as unknown[], bookMeta: null as unknown }));
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
        manifest: { version: '7.4.0' },
        app: {
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (id: string, value: string) => { secrets.set(id, value); },
                delete: (id: string) => { secrets.delete(id); },
                listSecrets: () => Array.from(secrets.keys())
            }
        },
        settings: { activeBookId: 'book-1', books: [book], actCount: 3, communityShare: settings },
        getSceneDataService: () => ({ getSceneDataWithBookMeta: sceneData }),
        // The plugin-wide BookMeta: whichever book was read last.
        getBookMeta: vi.fn((): unknown => null),
        getWritingSessionService: () => ({ getRangeStats: async () => ({}) }),
        saveSettings: vi.fn(async () => undefined)
    };
    return { plugin, book, scenes, sceneData };
}

function respondWith(...bodies: Array<{ status?: number; body: unknown }>) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    let index = 0;
    request.mockImplementation((async () => {
        const next = bodies[Math.min(index, bodies.length - 1)];
        index += 1;
        return { status: next.status ?? 200, text: JSON.stringify(next.body) };
    }) as never);
    return request;
}

/** Answer each call by endpoint: a project sync, or the timeline function. */
function respondToProjectSyncAndTimeline(timeline: unknown) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { url: string }) => ({
        status: 200,
        text: JSON.stringify(options.url.endsWith('community-project-sync')
            ? { ok: true, created: 0, updated: 1, projects: [] }
            : timeline)
    })) as never);
    return request;
}

/**
 * Hold one timeline request until `release()`: `sent` resolves once it is out.
 * Every other call answers at once, as a project sync or a private share.
 */
function heldTimelineRequest(matches: (body: Record<string, unknown>) => boolean, heldBody: unknown, heldStatus = 200) {
    let markSent: () => void = () => undefined;
    let release: () => void = () => undefined;
    const sent = new Promise<void>(resolve => { markSent = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { url: string; body: string }) => {
        if (options.url.endsWith('community-project-sync')) {
            return { status: 200, text: JSON.stringify({ ok: true, created: 0, updated: 1, projects: [] }) };
        }
        if (matches(JSON.parse(options.body) as Record<string, unknown>)) {
            markSent();
            await held;
            return { status: heldStatus, text: JSON.stringify(heldBody) };
        }
        return { status: 200, text: JSON.stringify(answer()) };
    }) as never);
    return { sent, release: () => release() };
}

const timelineCalls = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls
        .map(([options]) => options as unknown as { url: string; body: string })
        .filter(options => options.url.endsWith('timeline-share-sync'))
        .map(options => JSON.parse(options.body) as Record<string, unknown>);

async function started(h: ReturnType<typeof harness>) {
    respondToProjectSyncAndTimeline(answer());
    await startTimelineSharing(h.plugin as never, h.book as never);
}

describe('Share timeline', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is off by default and sends nothing', async () => {
        const h = harness();
        const request = respondWith({ body: answer() });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
    });

    it('turning it on syncs the book list, then creates the timeline with the connection secret', async () => {
        const h = harness();
        const request = respondToProjectSyncAndTimeline(answer());
        await startTimelineSharing(h.plugin as never, h.book as never);

        const urls = request.mock.calls.map(([options]) => (options as unknown as { url: string }).url);
        expect(urls[0]).toMatch(/community-project-sync$/);
        const [body] = timelineCalls(request);
        expect(body).toMatchObject({
            connection_id: 'conn-1',
            current_secret: 'rtcs_current-secret',
            action: 'push',
            plugin_book_key: 'book-1',
            create: true
        });
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(true);
        expect(record?.lastSentHash).toBeTruthy();
    });

    it('sends the public book name, no vault path, and no status of its own', async () => {
        const h = harness();
        const request = respondToProjectSyncAndTimeline(answer());
        await startTimelineSharing(h.plugin as never, h.book as never);
        const [body] = timelineCalls(request);
        const sent = JSON.stringify(body);
        expect(sent).toContain('Public Name');
        expect(sent).not.toContain('Private Title');
        expect(sent).not.toContain('Private Path');
        expect(body).not.toHaveProperty('status');
    });

    it('reads the book it was asked for', async () => {
        const h = harness();
        await started(h);
        expect(h.sceneData).toHaveBeenCalledWith({ sourcePath: 'Books/Private Path' });
    });

    it('sends the metadata read with this book, not whichever book was read last', async () => {
        const h = harness();
        h.sceneData.mockResolvedValue({ items: h.scenes, bookMeta: { title: 'Book One', subtitle: 'First Subtitle', author: 'A. One' } });
        h.plugin.getBookMeta.mockReturnValue({ title: 'Other Book', subtitle: 'Other Subtitle', author: 'B. Other' });
        const request = respondToProjectSyncAndTimeline(answer());
        await startTimelineSharing(h.plugin as never, h.book as never);
        const sent = JSON.stringify(timelineCalls(request)[0]);
        expect(sent).toContain('First Subtitle');
        expect(sent).toContain('A. One');
        expect(sent).not.toContain('Other Subtitle');
        expect(sent).not.toContain('B. Other');
    });

    it('refuses to send a book that reads as empty', async () => {
        const h = harness();
        h.sceneData.mockResolvedValue({ items: [], bookMeta: null });
        const request = respondToProjectSyncAndTimeline(answer());
        await expect(startTimelineSharing(h.plugin as never, h.book as never))
            .rejects.toMatchObject({ code: 'empty_timeline' });
        expect(timelineCalls(request)).toEqual([]);
    });

    it('is refused at the Private level', async () => {
        const h = harness();
        h.plugin.settings.communityShare.enabled = false;
        h.plugin.settings.communityShare.tier = 0;
        const request = respondWith({ body: answer() });
        await expect(startTimelineSharing(h.plugin as never, h.book as never))
            .rejects.toMatchObject({ code: 'sharing_level_required' });
        expect(request).not.toHaveBeenCalled();
    });

    it('turning it off stops updates and sends nothing', async () => {
        const h = harness();
        await started(h);
        const request = respondWith({ body: answer() });
        await stopTimelineSharing(h.plugin as never, 'book-1');
        h.scenes[0].synopsis = 'Changed.';
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.enabled).toBe(false);
    });
});

describe('Timeline updates with the book sync', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends a change, without create', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const [body] = timelineCalls(request);
        expect(body.action).toBe('push');
        expect(body).not.toHaveProperty('create');
    });

    it('sends nothing when nothing changed', async () => {
        const h = harness();
        await started(h);
        const request = respondWith({ body: answer() });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
    });

    it('rides the project sync once the vault is ready', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        (h.plugin.app as unknown as { workspace: { layoutReady: boolean } }).workspace = { layoutReady: true };
        const request = respondToProjectSyncAndTimeline(answer('active'));
        await syncCommunityProjectsIfConnected(h.plugin as never);
        expect(timelineCalls(request)).toHaveLength(1);
    });

    it('does not ride the load-time project sync, before the vault is indexed', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        (h.plugin.app as unknown as { workspace: { layoutReady: boolean } }).workspace = { layoutReady: false };
        const request = respondToProjectSyncAndTimeline(answer('active'));
        await syncCommunityProjectsIfConnected(h.plugin as never);
        expect(timelineCalls(request)).toEqual([]);
    });

    it('records reveals that could not follow their scene', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondWith({ body: answer('active', { summary: { scenes_without_stable_id: 2, reveals_dropped: [4, 9] } }) });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.droppedReveals).toEqual([4, 9]);
        expect(record?.scenesWithoutStableId).toBe(2);
    });

    it('turns itself off when the timeline was deleted on the website', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondWith({ status: 404, body: { error: { code: 'timeline_not_shared', message: 'Gone.' } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(false);
        expect(record?.lastError).toBeTruthy();
    });

    it('keeps sharing on after a passing failure, and says why', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondWith({ status: 500, body: { error: { code: 'server_error', message: 'Try again.' } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(true);
        expect(record?.lastError).toBe('Try again.');
    });

    it('never sends to an account the author did not turn it on for', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        h.plugin.settings.communityShare.connection.profileId = 'profile-2';
        const request = respondWith({ body: answer() });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Pause is a full outbound freeze', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stops timeline updates', async () => {
        const h = harness();
        await started(h);
        await pauseCommunitySharing(h.plugin as never);
        h.scenes[0].synopsis = 'Changed.';
        const request = respondWith({ body: answer() });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
    });

    it('stops an update already reading the book', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        const request = respondWith({ body: answer() });
        h.sceneData.mockImplementationOnce(async () => {
            await pauseCommunitySharing(h.plugin as never);
            return { items: h.scenes, bookMeta: null };
        });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.lastError).toBeUndefined();
    });

    it('stops turning sharing on', async () => {
        const h = harness();
        h.plugin.settings.communityShare.sharingPaused = true;
        const request = respondWith({ body: answer() });
        await expect(startTimelineSharing(h.plugin as never, h.book as never)).rejects.toBeTruthy();
        expect(timelineCalls(request)).toEqual([]);
    });

    it('stops detail changes', async () => {
        const h = harness();
        await started(h);
        await pauseCommunitySharing(h.plugin as never);
        const request = respondWith({ body: answer() });
        await expect(setTimelineShareDetails(h.plugin as never, 'book-1', { genericSubplotNames: true }))
            .rejects.toMatchObject({ code: 'sharing_paused' });
        expect(request).not.toHaveBeenCalled();
    });

    it('still reads the share, which sends nothing about the book', async () => {
        const h = harness();
        await started(h);
        await pauseCommunitySharing(h.plugin as never);
        const request = respondWith({ body: answer('active') });
        await fetchTimelineShareStatus(h.plugin as never, 'book-1');
        expect(timelineCalls(request)[0]).toEqual({
            connection_id: 'conn-1',
            current_secret: 'rtcs_current-secret',
            action: 'status',
            plugin_book_key: 'book-1'
        });
    });

    it('catches up on Resume', async () => {
        const h = harness();
        await started(h);
        await pauseCommunitySharing(h.plugin as never);
        h.scenes[0].synopsis = 'Changed.';
        const request = respondWith({ body: answer('active') });
        await resumeCommunitySharing(h.plugin as never);
        expect(timelineCalls(request)).toHaveLength(1);
    });
});

describe('Timeline details', () => {
    beforeEach(() => vi.clearAllMocks());

    it('writes the choice to the website and keeps no copy', async () => {
        const h = harness();
        await started(h);
        const request = respondWith({ body: answer() });
        await setTimelineShareDetails(h.plugin as never, 'book-1', { hiddenSceneFields: ['synopsis', 'when'] });
        expect(timelineCalls(request)[0]).toMatchObject({
            action: 'set_details',
            plugin_book_key: 'book-1',
            hidden_scene_fields: ['synopsis', 'when']
        });
        expect(JSON.stringify(h.plugin.settings.communityShare)).not.toContain('synopsis');
    });

    it('a sync sends no detail choice, so it can never overwrite one made on the website', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const [body] = timelineCalls(request);
        expect(body).not.toHaveProperty('hidden_scene_fields');
        expect(body).not.toHaveProperty('generic_subplot_names');
    });
});

describe('fetchTimelineShareStatus', () => {
    beforeEach(() => vi.clearAllMocks());

    it('turns sharing off when the website no longer has the timeline', async () => {
        const h = harness();
        await started(h);
        respondWith({ body: { ok: true, shared: false, project_id: PROJECT_ID } });
        await fetchTimelineShareStatus(h.plugin as never, 'book-1');
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.enabled).toBe(false);
    });

    it('ignores a "not shared" answer to a request sent before Share timeline was turned on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
            const h = harness();
            const status = heldTimelineRequest(body => body.action === 'status', { ok: true, shared: false, project_id: PROJECT_ID });
            const pending = fetchTimelineShareStatus(h.plugin as never, 'book-1');
            await status.sent;
            vi.setSystemTime(new Date('2026-11-08T10:00:05Z'));
            await startTimelineSharing(h.plugin as never, h.book as never);
            status.release();
            await pending;
            const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
            expect(record?.enabled).toBe(true);
            expect(record?.lastError).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('a background update refused before Share timeline was turned on again leaves sharing on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
            const h = harness();
            await started(h);
            h.scenes[0].synopsis = 'Changed.';
            const update = heldTimelineRequest(body => body.action === 'push' && !body.create, { error: { code: 'timeline_not_shared', message: 'Gone.' } }, 404);
            const pending = syncCommunityTimelinesIfDue(h.plugin as never);
            await update.sent;
            vi.setSystemTime(new Date('2026-11-08T10:00:05Z'));
            await stopTimelineSharing(h.plugin as never, 'book-1');
            await startTimelineSharing(h.plugin as never, h.book as never);
            update.release();
            await pending;
            const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
            expect(record?.enabled).toBe(true);
            expect(record?.lastError).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('refuses a malformed answer', async () => {
        const h = harness();
        await started(h);
        respondWith({ body: { ok: true, shared: true, project_id: 'not-a-uuid' } });
        await expect(fetchTimelineShareStatus(h.plugin as never, 'book-1'))
            .rejects.toMatchObject({ code: 'invalid_response' });
    });
});
