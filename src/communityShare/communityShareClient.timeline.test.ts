import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    apiVersion: '1.9.0',
    Platform: {},
    normalizePath: (path: string) => path.replace(/\/+$/, ''),
    requestUrl: vi.fn()
}));

import * as obsidian from 'obsidian';
import { buildDefaultCommunityShareSettings, normalizeCommunityShareSettings, timelineShareFor } from './communityShareSettings';
import { formatCommunityDate } from './sharingWords';
import { t } from '../i18n';
import {
    fetchTimelineShareStatus,
    fetchVaultSharingState,
    pauseCommunitySharing,
    resumeCommunitySharing,
    setTimelineShareDetails,
    startTimelineSharing,
    stopTimelineSharing,
    syncCommunityProjectsIfConnected,
    syncCommunityTimelinesIfDue,
    timelineHeldNote
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
    // The vault as Obsidian holds it once loaded: the book's folder, and each
    // note in it read into the metadata cache.
    const vault = {
        folders: new Set<string>(['Books/Private Path']),
        files: [{ path: 'Books/Private Path/1 Scene.md' }],
        unread: new Set<string>(),
    };
    const plugin = {
        manifest: { version: '7.4.0' },
        app: {
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (id: string, value: string) => { secrets.set(id, value); },
                delete: (id: string) => { secrets.delete(id); },
                listSecrets: () => Array.from(secrets.keys())
            },
            workspace: { layoutReady: true },
            vault: {
                getFolderByPath: (path: string) => (vault.folders.has(path) ? { path } : null),
                getMarkdownFiles: () => vault.files,
            },
            metadataCache: {
                getFileCache: (file: { path: string }) => (vault.unread.has(file.path) ? null : { frontmatter: {} }),
            },
        },
        settings: { activeBookId: 'book-1', books: [book], actCount: 3, communityShare: settings },
        getSceneDataService: () => ({ getSceneDataWithBookMeta: sceneData }),
        // The plugin-wide BookMeta: whichever book was read last.
        getBookMeta: vi.fn((): unknown => null),
        getWritingSessionService: () => ({ getRangeStats: async () => ({}) }),
        saveSettings: vi.fn(async () => undefined)
    };
    return { plugin, book, scenes, sceneData, vault };
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

    it('refuses to start when duplicate IDs have no known owner', async () => {
        const h = harness();
        h.scenes.unshift({ ...h.scenes[0], title: '0 Copy', path: 'Books/Private Path/0 Copy.md' });
        const request = respondToProjectSyncAndTimeline(answer());
        await expect(startTimelineSharing(h.plugin as never, h.book as never)).rejects.toThrow(/same scene ID/i);
        expect(timelineCalls(request)).toHaveLength(0);
    });

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

    it('turning it off stops updates and tells Community only that it stopped', async () => {
        const h = harness();
        await started(h);
        const request = respondWith({ body: answer() });
        await stopTimelineSharing(h.plugin as never, 'book-1');
        h.scenes[0].synopsis = 'Changed.';
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineCalls(request)).toEqual([{
            action: 'stop_updates',
            connection_id: 'conn-1',
            current_secret: 'rtcs_current-secret',
            plugin_book_key: 'book-1',
        }]);
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

    it('keeps the scene id on the original when the author duplicates its note', async () => {
        const h = harness();
        await started(h);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.sceneIdPaths)
            .toEqual({ scn_a1b2c3d4: 'Books/Private Path/1 Scene.md' });

        // The copy keeps the scn_ id and is read first.
        h.scenes.unshift({ ...h.scenes[0], title: '0 Copy', path: 'Books/Private Path/0 Copy.md' });
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const [body] = timelineCalls(request);
        const items = (body.export as { items: Array<{ title?: string; sceneId?: string }> }).items;
        expect(items.map(item => [item.title, item.sceneId])).toEqual([['0 Copy', undefined], ['1 Scene', 'scn_a1b2c3d4']]);
        expect(JSON.stringify(body)).not.toContain('Private Path');
    });

    it('does not send an ambiguous duplicate when an older share has no recorded owner', async () => {
        const h = harness();
        await started(h);
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        if (!record) throw new Error('expected shared timeline');
        delete record.sceneIdPaths;
        h.scenes.unshift({ ...h.scenes[0], title: '0 Copy', path: 'Books/Private Path/0 Copy.md' });
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineCalls(request)).toHaveLength(0);
        const after = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(after?.enabled).toBe(true);
        expect(after?.lastError).toMatch(/same scene ID/i);

        // The author keeps the old ID on the original and gives the copy its own.
        h.scenes[0].sceneId = 'scn_0f0f0f0f';
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const [sent] = timelineCalls(request);
        expect((sent.export as { items: Array<{ title?: string; sceneId?: string }> }).items.map(item => [item.title, item.sceneId]))
            .toEqual([['0 Copy', 'scn_0f0f0f0f'], ['1 Scene', 'scn_a1b2c3d4']]);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.lastError).toBeUndefined();
    });

    it('follows a renamed note that holds an id, with nothing sent', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].path = 'Books/Private Path/1 Scene Renamed.md';
        const request = respondWith({ body: answer() });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(request).not.toHaveBeenCalled();
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.sceneIdPaths)
            .toEqual({ scn_a1b2c3d4: 'Books/Private Path/1 Scene Renamed.md' });
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
        // The pause notice alone, and no timeline.
        expect(timelineCalls(request)).toEqual([]);
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
            include_preview: true,
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

describe('a timeline the vault has not finished reading is held in the vault (spec section 5)', () => {
    beforeEach(() => vi.clearAllMocks());

    const holds: Array<[string, (h: ReturnType<typeof harness>) => void]> = [
        ['Obsidian is still opening the vault', h => { h.plugin.app.workspace.layoutReady = false; }],
        ['the book\'s folder is not in the vault', h => { h.vault.folders.clear(); }],
        ['a note in the folder is not read yet', h => { h.vault.unread.add('Books/Private Path/1 Scene.md'); }],
    ];

    it.each(holds)('holds a background update while %s, sends nothing and records nothing', async (_case, hold) => {
        const h = harness();
        await started(h);
        const before = JSON.stringify(timelineShareFor(h.plugin.settings.communityShare, 'book-1'));
        h.scenes[0].synopsis = 'Changed.';
        hold(h);
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineCalls(request)).toEqual([]);
        expect(JSON.stringify(timelineShareFor(h.plugin.settings.communityShare, 'book-1'))).toBe(before);
        expect(h.sceneData).toHaveBeenCalledTimes(1);
    });

    it('says why updates are held, with the next step, for as long as the hold lasts', async () => {
        const h = harness();
        await started(h);
        expect(timelineHeldNote(h.plugin as never, h.book)).toBeNull();
        h.vault.unread.add('Books/Private Path/1 Scene.md');
        expect(timelineHeldNote(h.plugin as never, h.book))
            .toBe(t('ui.communityShareSection.timelineHeldUnread', { note: 'Books/Private Path/1 Scene.md' }));
        h.vault.unread.clear();
        h.vault.folders.clear();
        expect(timelineHeldNote(h.plugin as never, h.book))
            .toBe(t('ui.communityShareSection.timelineHeldFolder', { folder: 'Books/Private Path' }));
        // Still opening the vault: that passes on its own, so nothing is said.
        h.plugin.app.workspace.layoutReady = false;
        expect(timelineHeldNote(h.plugin as never, h.book)).toBeNull();
    });

    it('sends on the next cycle once the vault is read', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        h.vault.unread.add('Books/Private Path/1 Scene.md');
        await syncCommunityTimelinesIfDue(h.plugin as never);
        h.vault.unread.clear();
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineCalls(request)).toHaveLength(1);
    });

    it('a note outside the book does not hold it', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        h.vault.files.push({ path: 'Other/Unread.md' });
        h.vault.unread.add('Other/Unread.md');
        const request = respondWith({ body: answer('active') });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineCalls(request)).toHaveLength(1);
    });

    it('turning it on while the vault is still being read says so and sends nothing', async () => {
        const h = harness();
        h.vault.unread.add('Books/Private Path/1 Scene.md');
        const request = respondToProjectSyncAndTimeline(answer());
        await expect(startTimelineSharing(h.plugin as never, h.book as never))
            .rejects.toThrow(/still reading/i);
        expect(timelineCalls(request)).toEqual([]);
    });
});

// -- Who paused, and when (Eric's decision, 2026-11-22) -----------------------

const vaultState = (sharingPaused: unknown = null) => ({ ok: true, sharing: { sharing_paused: sharingPaused, account_paused: null, history: [] } });
const bookState = { ok: true, project_id: PROJECT_ID, sharing: { vault_updates_paused: null, timeline_updates_stopped: null, update_held: null, timeline: null, vault_sharing_paused: null, account_paused: null, history: [] } };

type Reply = { status?: number; body: unknown };
/**
 * Answer by endpoint and action ("community-share-context:pause",
 * "timeline-share-sync:push"); a reply list is used in order, its last one
 * after that. Anything else answers as a project sync or a private share.
 */
function respondByAction(replies: Record<string, Reply | Reply[]>) {
    const used = new Map<string, number>();
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { url: string; body: string }) => {
        const endpoint = options.url.split('/').pop()!;
        const body = JSON.parse(options.body) as Record<string, unknown>;
        const key = `${endpoint}:${String(body.action ?? '')}`;
        const entry = replies[key];
        if (entry) {
            const list = Array.isArray(entry) ? entry : [entry];
            const index = used.get(key) ?? 0;
            used.set(key, index + 1);
            const reply = list[Math.min(index, list.length - 1)];
            return { status: reply.status ?? 200, text: JSON.stringify(reply.body) };
        }
        if (endpoint === 'community-project-sync') return { status: 200, text: JSON.stringify({ ok: true, created: 0, updated: 1, projects: [] }) };
        return { status: 200, text: JSON.stringify(answer()) };
    }) as never);
    return request;
}

const calls = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => {
        const { url, body } = options as unknown as { url: string; body: string };
        return { endpoint: url.split('/').pop()!, body: JSON.parse(body) as Record<string, unknown> };
    });

describe('Pause and Resume tell Community who paused, and when', () => {
    beforeEach(() => vi.clearAllMocks());

    it('pauses the vault first, then sends one notice that carries nothing but the connection', async () => {
        const h = harness();
        let pausedWhenSent: boolean | undefined;
        const request = respondByAction({ 'community-share-context:pause': { body: vaultState({ at: '2026-11-22T13:20:00Z', side: 'vault' }) } });
        request.mockImplementationOnce((async () => {
            pausedWhenSent = h.plugin.settings.communityShare.sharingPaused;
            return { status: 200, text: JSON.stringify(vaultState({ at: '2026-11-22T13:20:00Z', side: 'vault' })) };
        }) as never);
        await pauseCommunitySharing(h.plugin as never);
        expect(pausedWhenSent).toBe(true);
        expect(calls(request)).toEqual([{ endpoint: 'community-share-context', body: { action: 'pause', connection_id: 'conn-1', current_secret: 'rtcs_current-secret' } }]);
        const settings = h.plugin.settings.communityShare;
        expect(settings.sharingPausedAt).toBeTruthy();
        expect(settings.sharingNoticeOwed).toBeUndefined();
    });

    it('keeps the pause when the notice fails, and tells its time with the next Resume', async () => {
        const h = harness();
        respondByAction({ 'community-share-context:pause': { status: 503, body: { error: { code: 'server_error', message: 'Down.' } } } });
        await pauseCommunitySharing(h.plugin as never);
        const settings = h.plugin.settings.communityShare;
        expect(settings.sharingPaused).toBe(true);
        expect(settings.sharingNoticeOwed).toEqual({ action: 'pause', pausedAt: settings.sharingPausedAt });
        const pausedAt = settings.sharingPausedAt;

        const request = respondByAction({ 'community-share-context:resume': { body: vaultState() } });
        await resumeCommunitySharing(h.plugin as never);
        const [resume] = calls(request).filter(call => call.body.action === 'resume');
        expect(resume.body).toEqual({ action: 'resume', connection_id: 'conn-1', current_secret: 'rtcs_current-secret', paused_at: pausedAt });
        expect(h.plugin.settings.communityShare.sharingNoticeOwed).toBeUndefined();
        expect(h.plugin.settings.communityShare.sharingPausedAt).toBeUndefined();
    });

    it('resumes even when Community cannot be told, and tells it before the next timeline update', async () => {
        const h = harness();
        await started(h);
        respondByAction({ 'community-share-context:pause': { body: vaultState({ at: '2026-11-22T13:20:00Z', side: 'vault' }) } });
        await pauseCommunitySharing(h.plugin as never);
        respondByAction({ 'community-share-context:resume': { status: 429, body: { error: { code: 'too_many_notices', message: 'Later.' } } } });
        await resumeCommunitySharing(h.plugin as never);
        expect(h.plugin.settings.communityShare.sharingPaused).toBe(false);
        expect(h.plugin.settings.communityShare.sharingNoticeOwed).toEqual({ action: 'resume' });

        h.scenes[0].synopsis = 'Changed again.';
        const request = respondByAction({ 'community-share-context:resume': { body: vaultState() }, 'timeline-share-sync:push': { body: answer('active') } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(calls(request).map(call => `${call.endpoint}:${String(call.body.action)}`)).toEqual(['community-share-context:resume', 'timeline-share-sync:push']);
        expect(h.plugin.settings.communityShare.sharingNoticeOwed).toBeUndefined();
    });

    it('sends the resume again without a time Community refuses', async () => {
        const h = harness();
        respondByAction({ 'community-share-context:pause': { status: 500, body: { error: { code: 'server_error', message: 'Down.' } } } });
        await pauseCommunitySharing(h.plugin as never);
        const request = respondByAction({
            'community-share-context:resume': [
                { status: 400, body: { error: { code: 'invalid_time', message: 'Check the clock.' } } },
                { body: vaultState() },
            ],
        });
        await resumeCommunitySharing(h.plugin as never);
        const resumes = calls(request).filter(call => call.body.action === 'resume').map(call => call.body);
        expect(resumes[0]).toHaveProperty('paused_at');
        expect(resumes[1]).not.toHaveProperty('paused_at');
        expect(h.plugin.settings.communityShare.sharingNoticeOwed).toBeUndefined();
    });

    it('reads the vault\'s sharing state at any level, sending nothing about the books', async () => {
        const h = harness();
        h.plugin.settings.communityShare.enabled = false;
        const request = respondByAction({ 'community-share-context:history': { body: { ok: true, sharing: { sharing_paused: null, account_paused: { at: '2026-11-20T09:00:00Z', side: 'moderation', cause: 'moderation' }, history: [] } } } });
        const state = await fetchVaultSharingState(h.plugin as never);
        expect(state.accountPaused).toEqual({ at: '2026-11-20T09:00:00Z', side: 'moderation', cause: 'moderation' });
        expect(calls(request)).toEqual([{ endpoint: 'community-share-context', body: { action: 'history', connection_id: 'conn-1', current_secret: 'rtcs_current-secret' } }]);
    });
});

describe('Keep timeline updated off and on tell Community, and when', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a stop Community did not hear rides the resume, which goes before the push', async () => {
        const h = harness();
        await started(h);
        respondByAction({ 'timeline-share-sync:stop_updates': { status: 503, body: { error: { code: 'server_error', message: 'Down.' } } } });
        await stopTimelineSharing(h.plugin as never, 'book-1');
        const stopped = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(stopped?.updatesNoticeOwed).toEqual({ action: 'stop', stoppedAt: stopped?.updatesStoppedAt });

        const request = respondByAction({ 'timeline-share-sync:resume_updates': { body: bookState }, 'timeline-share-sync:push': { body: answer() } });
        await startTimelineSharing(h.plugin as never, h.book as never);
        const sent = timelineCalls(request);
        expect(sent.map(body => body.action)).toEqual(['resume_updates', 'push']);
        expect(sent[0]).toEqual({ action: 'resume_updates', connection_id: 'conn-1', current_secret: 'rtcs_current-secret', plugin_book_key: 'book-1', stopped_at: stopped?.updatesStoppedAt });
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(true);
        expect(record?.updatesNoticeOwed).toBeUndefined();
        expect(record?.updatesStoppedAt).toBeUndefined();
    });

    it('a resume Community could not take yet goes again before the next push, and the push still goes', async () => {
        const h = harness();
        await started(h);
        respondByAction({ 'timeline-share-sync:stop_updates': { body: bookState } });
        await stopTimelineSharing(h.plugin as never, 'book-1');
        respondByAction({ 'timeline-share-sync:resume_updates': { status: 429, body: { error: { code: 'too_many_notices', message: 'Later.' } } } });
        await startTimelineSharing(h.plugin as never, h.book as never);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.updatesNoticeOwed).toEqual({ action: 'resume' });

        h.scenes[0].synopsis = 'Changed.';
        const request = respondByAction({ 'timeline-share-sync:resume_updates': { body: bookState }, 'timeline-share-sync:push': { body: answer('active') } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineCalls(request).map(body => body.action)).toEqual(['resume_updates', 'push']);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.updatesNoticeOwed).toBeUndefined();
    });

    it('a book with no timeline on Community has nothing to tell', async () => {
        const h = harness();
        await started(h);
        respondByAction({ 'timeline-share-sync:stop_updates': { status: 404, body: { error: { code: 'timeline_not_shared', message: 'Gone.' } } } });
        await stopTimelineSharing(h.plugin as never, 'book-1');
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.updatesNoticeOwed).toBeUndefined();
    });
});

describe('Refusals say who and when', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a book disconnected from this vault on Community turns updates off and says so, never "deleted"', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondByAction({ 'timeline-share-sync:push': { status: 409, body: { error: { code: 'book_disconnected', message: 'Disconnected.' }, at: '2026-11-22T13:20:00Z', side: 'community' } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(false);
        expect(record?.lastError).toBe(t('ui.communitySharing.bookDisconnected', { date: formatCommunityDate('2026-11-22T13:20:00Z') }));
        expect(record?.lastError).not.toMatch(/deleted/i);
    });

    // Handoffs e2e 2026-11-22 (A20, A21): the book-list sync on the next start
    // made the disconnected book again as a stray private card and switched the
    // connection to it. Community now leaves it out and lists it as disconnected.
    it('the book-list sync lists a disconnected book: Keep timeline updated turns off with when, and the binding Community reports is kept', async () => {
        const h = harness();
        await started(h);
        const request = respondByAction({
            'community-project-sync:': {
                body: { ok: true, created: 0, updated: 0, projects: [], removed: [], connection_project_id: null,
                    disconnected: [{ book_key: 'book-1', title: 'Public Name', at: '2026-11-22T20:08:00Z', side: 'community', message: 'Disconnected.' }] },
            },
        });
        await syncCommunityProjectsIfConnected(h.plugin as never);
        const sync = calls(request).find(call => call.endpoint === 'community-project-sync')!;
        // An automatic sync never asks for a new book.
        expect(JSON.stringify(sync.body)).not.toContain('share_as_new_book');
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(false);
        expect(record?.lastError).toBe(t('ui.communitySharing.bookDisconnected', { date: formatCommunityDate('2026-11-22T20:08:00Z') }));
        expect(h.plugin.settings.communityShare.connection.projectId).toBeNull();
    });

    it('turning Keep timeline updated on is the author\'s choice: that one book goes as a new book', async () => {
        const h = harness();
        h.plugin.settings.books = [h.book, { id: 'book-2', title: 'Other', sourceFolder: 'Books/Other' }] as never;
        const request = respondByAction({});
        await startTimelineSharing(h.plugin as never, h.book as never);
        const sync = calls(request).find(call => call.endpoint === 'community-project-sync')!;
        const entries = sync.body.projects as Array<Record<string, unknown>>;
        expect(entries.find(entry => entry.book_key === 'book-1')?.share_as_new_book).toBe(true);
        expect(entries.find(entry => entry.book_key === 'book-2')).not.toHaveProperty('share_as_new_book');
    });

    it('a book-list answer with a malformed disconnected list is refused, not half-read', async () => {
        const h = harness();
        await started(h);
        respondByAction({ 'community-project-sync:': { body: { ok: true, created: 0, updated: 0, projects: [], disconnected: [{ book_key: 'book-1' }] } } });
        await syncCommunityProjectsIfConnected(h.plugin as never);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.enabled).toBe(true);
        expect(h.plugin.settings.communityShare.connection.bookListSyncError).toBeTruthy();
    });

    it('the status read of a disconnected book turns updates off too', async () => {
        const h = harness();
        await started(h);
        respondByAction({ 'timeline-share-sync:status': { status: 409, body: { error: { code: 'book_disconnected', message: 'Disconnected.' }, at: '2026-11-22T13:20:00Z', side: 'community' } } });
        await expect(fetchTimelineShareStatus(h.plugin as never, 'book-1')).rejects.toMatchObject({ code: 'book_disconnected' });
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.enabled).toBe(false);
    });

    it.each([
        ['author', { paused_at: '2026-11-22T13:20:00Z', side: 'community', cause: 'author' }, 'ui.communitySharing.vaultUpdatesPaused'],
        ['restore', { paused_at: '2026-11-22T13:20:00Z', side: 'community', cause: 'restore' }, 'ui.communitySharing.vaultUpdatesPausedRestore'],
        ['system', { paused_at: '2026-11-22T13:20:00Z', side: 'system', cause: 'system' }, 'ui.communitySharing.vaultUpdatesPausedSystem'],
    ])('a push refused while vault updates are paused (%s) says when, and keeps updates on', async (_cause, fields, key) => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondByAction({ 'timeline-share-sync:push': { status: 409, body: { error: { code: 'vault_updates_paused', message: 'Paused.' }, ...fields } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const record = timelineShareFor(h.plugin.settings.communityShare, 'book-1');
        expect(record?.enabled).toBe(true);
        expect(record?.lastError).toBe(t(key, { date: formatCommunityDate('2026-11-22T13:20:00Z') }));
    });

    it('a held update says when it arrived', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondByAction({ 'timeline-share-sync:push': { status: 409, body: { error: { code: 'update_held', message: 'Held.' }, held_at: '2026-11-22T13:20:00Z' } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.lastError).toBe(t('ui.communitySharing.updateHeld', { date: formatCommunityDate('2026-11-22T13:20:00Z') }));
    });

    it('a refusal with no time keeps Community\'s own sentence', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondByAction({ 'timeline-share-sync:push': { status: 409, body: { error: { code: 'vault_updates_paused', message: 'Vault updates for this book are paused on Community.' } } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.lastError).toBe('Vault updates for this book are paused on Community.');
    });

    it('a pending account deletion says since when', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondByAction({ 'timeline-share-sync:push': { status: 409, body: { error: { code: 'connection_not_active', message: 'Paused.' }, cause: 'account_deletion_pending', since: '2026-11-21T08:00:00Z', side: 'community' } } });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(timelineShareFor(h.plugin.settings.communityShare, 'book-1')?.lastError).toBe(t('ui.communitySharing.accountDeletion', { date: formatCommunityDate('2026-11-21T08:00:00Z') }));
    });
});

describe('A connection Community disconnected', () => {
    beforeEach(() => vi.clearAllMocks());

    const refusal = (fields: Record<string, unknown>) => ({ status: 409, body: { error: { code: 'connection_disconnected', message: 'Disconnected.' }, ...fields } });

    it('turns the vault Disconnected, with who and when, and drops the dead key', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        respondByAction({ 'timeline-share-sync:push': refusal({ disconnected_at: '2026-11-22T13:20:00Z', disconnected_by: 'community', cause: 'disconnect' }) });
        await syncCommunityTimelinesIfDue(h.plugin as never);
        const settings = h.plugin.settings.communityShare;
        expect(settings.connection.status).toBe('disconnected');
        expect(settings.connection.serverDisconnect).toEqual({ at: '2026-11-22T13:20:00Z', by: 'community', cause: 'disconnect' });
        expect(settings.connection.secretId).toBeUndefined();
        expect(h.plugin.app.secretStorage.listSecrets()).toEqual([]);
        expect(settings.lastError).toBeUndefined();
        // The book keeps its own record clean: the connection's note says it all.
        expect(timelineShareFor(settings, 'book-1')?.lastError).toBeUndefined();
    });

    it('changes nothing when the answer is for a connection this vault has since replaced', async () => {
        const h = harness();
        await started(h);
        h.scenes[0].synopsis = 'Changed.';
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockReset();
        request.mockImplementation((async () => {
            // A new connection arrives while the old one's update is out.
            h.plugin.settings.communityShare.connection = { ...h.plugin.settings.communityShare.connection, connectionId: 'conn-2' };
            return { status: 409, text: JSON.stringify(refusal({ disconnected_at: '2026-11-22T13:20:00Z', disconnected_by: null, cause: 'new_connection' }).body) };
        }) as never);
        await syncCommunityTimelinesIfDue(h.plugin as never);
        expect(h.plugin.settings.communityShare.connection.status).toBe('connected');
        expect(h.plugin.settings.communityShare.connection.serverDisconnect).toBeUndefined();
    });

    it('a new connection clears Community\'s word on the old one', () => {
        const settings = normalizeCommunityShareSettings({
            ...buildDefaultCommunityShareSettings(),
            connection: { status: 'connected', connectionId: 'conn-2', serverDisconnect: { at: '2026-11-22T13:20:00Z', by: 'community', cause: 'disconnect' } },
        });
        expect(settings.connection.serverDisconnect).toBeUndefined();
    });
});
