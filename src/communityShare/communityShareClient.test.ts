import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    requestUrl: vi.fn()
}));
// Real preview builder behind a spy so a test can interleave an author action
// (Pause) into the await window between "preview built" and "request sent".
vi.mock('./communitySharePreview', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./communitySharePreview')>();
    return { ...actual, buildCommunitySharePreview: vi.fn(actual.buildCommunitySharePreview) };
});

import * as obsidian from 'obsidian';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import { buildCommunitySharePreview } from './communitySharePreview';
import {
    beginCommunitySharing,
    canPostSessionsToFeed,
    confirmCommunityShareActivation,
    disconnectCommunityShare,
    postSessionToCommunityFeed,
    resumeCommunitySharing,
    fetchCommunityShareContext,
    pauseCommunitySharing,
    publishCommunityShareReport,
    revokeCommunityShareReport,
    syncCommunityDailyIfEligible,
    syncCommunityProjects,
    syncCommunityShareIfDue,
    uploadAprToCommunity
} from './communityShareClient';

function createPluginHarness(options: {
    failConnectionSecretStorage?: boolean;
    poisonConnectionSecretValue?: string;
} = {}) {
    const secrets = new Map<string, string>();
    const plugin = {
        app: {
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (id: string, value: string) => {
                    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
                        throw new Error(`Invalid secret id: ${id}`);
                    }
                    if (options.failConnectionSecretStorage && id === 'rt-community-share-connection-secret') {
                        throw new Error('Secret storage unavailable for connection');
                    }
                    if (options.poisonConnectionSecretValue !== undefined
                        && id === 'rt-community-share-connection-secret'
                        && value === options.poisonConnectionSecretValue) {
                        // Model a replace that clobbers the existing secret and
                        // THEN fails to persist the new value (keychain rejected
                        // the write after clearing the slot).
                        secrets.delete(id);
                        throw new Error('Secret storage rejected the connection secret write');
                    }
                    secrets.set(id, value);
                },
                delete: (id: string) => {
                    secrets.delete(id);
                },
                listSecrets: () => Array.from(secrets.keys())
            }
        },
        settings: {
            activeBookId: 'book-1',
            books: [{
                id: 'book-1',
                title: 'Private Local Draft Title',
                publicLabel: 'Public Project Alias',
                sourceFolder: 'Books/Private Path',
                genre: 'Fantasy'
            }],
            communityShare: buildDefaultCommunityShareSettings()
        },
        getWritingSessionService: () => ({
            getRangeStats: async () => ({
                startDate: '2026-06-21',
                endDate: '2026-06-27',
                days: 7,
                targetMode: 'words',
                minutesLogged: 63,
                sessionsCompleted: 4,
                wordsDrafted: 1234,
                daysWithSessions: 3,
                daysGoalMet: 2,
                sessionCountByMode: { drafting: 4, revising: 0, editing: 0, planning: 0 },
                minutesByMode: { drafting: 63, revising: 0, editing: 0, planning: 0 },
                scenesCompletedByStage: { Zero: 0, Author: 0, House: 0, Press: 0 },
                freshScenesCompleted: 0,
                revisionScenesCompleted: 0,
                sceneCompletionEvents: []
            })
        }),
        getSceneData: async () => [],
        saveSettings: vi.fn(async () => undefined)
    };
    return { plugin, secrets };
}

async function armReadyToPublish(harness: ReturnType<typeof createPluginHarness>, tier = 3) {
    const { plugin, secrets } = harness;
    const settings = plugin.settings.communityShare;
    settings.enabled = true;
    settings.tier = tier;
    settings.audience = 'public';
    settings.connection = {
        status: 'connected',
        connectionId: 'conn-1',
        profileId: 'profile-1',
        projectId: 'project-1',
        secretId: 'rt.community-share.connection-secret'
    };
    settings.fieldPolicy['project.title'] = true;
    settings.fieldPolicy['activity.words_added'] = true;
    secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
    const preview = await buildCommunitySharePreview(plugin as never);
    settings.preview = {
        status: 'ready',
        generatedAt: '2026-06-27T12:00:00.000Z',
        previewHash: preview.previewHash,
        payloadHash: preview.payloadHash,
        reportPeriod: 'weekly',
        summary: preview.summary
    };
    return preview;
}

const publishedBody = {
    ok: true,
    publish_id: 'publish-1',
    version_id: 'version-1',
    public_slug: 'csr_public',
    status: 'published',
    published_at: '2026-06-27T19:00:00.000Z',
    superseded_version_id: null
};

describe('Community Share mutators write against live state, not a pre-await snapshot', () => {
    it('keeps a Pause that lands while the publish request is in flight', async () => {
        const harness = createPluginHarness();
        const { plugin } = harness;
        vi.clearAllMocks();
        await armReadyToPublish(harness);
        plugin.settings.communityShare.scheduledPublishEnabled = true;

        // The author clicks Pause while the payload is on the wire.
        vi.spyOn(obsidian, 'requestUrl').mockImplementation(async () => {
            await pauseCommunitySharing(plugin as never);
            return { status: 201, text: JSON.stringify(publishedBody) } as never;
        });

        await publishCommunityShareReport(plugin as never);

        const after = plugin.settings.communityShare;
        // The publish is recorded — the payload did leave…
        expect(after.connection.publicSlug).toBe('csr_public');
        expect(after.publishHistory.map(entry => entry.action)).toEqual(['pause', 'publish']);
        // …but the Pause is not reverted by it.
        expect(after.sharingPaused).toBe(true);
        expect(after.scheduledPublishEnabled).toBe(false);
    });

    it('skips the scheduled sync cleanly when a Pause lands while the preview is building', async () => {
        const harness = createPluginHarness();
        const { plugin } = harness;
        vi.clearAllMocks();
        await armReadyToPublish(harness);
        plugin.settings.communityShare.scheduledPublishEnabled = true;
        const request = vi.spyOn(obsidian, 'requestUrl');

        const realBuild = (await vi.importActual<typeof import('./communitySharePreview')>('./communitySharePreview')).buildCommunitySharePreview;
        vi.mocked(buildCommunitySharePreview).mockImplementationOnce(async (p) => {
            const preview = await realBuild(p);
            await pauseCommunitySharing(plugin as never);
            return preview;
        });

        const outcome = await syncCommunityShareIfDue(plugin as never);

        expect(outcome).toBe('skipped');
        expect(request).not.toHaveBeenCalled();
        const after = plugin.settings.communityShare;
        expect(after.sharingPaused).toBe(true);
        expect(after.scheduledPublishEnabled).toBe(false);
        // No failed-sync entry: a Pause during the build is not an error.
        expect(after.publishHistory.map(entry => entry.action)).toEqual(['pause']);
        expect(after.lastError).toBeUndefined();
    });

    it('shares one in-flight run between overlapping scheduled syncs', async () => {
        const harness = createPluginHarness();
        const { plugin } = harness;
        vi.clearAllMocks();
        await armReadyToPublish(harness);
        plugin.settings.communityShare.scheduledPublishEnabled = true;

        let release: (() => void) | null = null;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const request = vi.spyOn(obsidian, 'requestUrl').mockImplementation(async () => {
            await gate;
            return { status: 201, text: JSON.stringify(publishedBody) } as never;
        });

        // Startup timer and the settings preview builder overlap.
        const first = syncCommunityShareIfDue(plugin as never);
        const second = syncCommunityShareIfDue(plugin as never);
        expect(second).toBe(first);
        release?.();

        await expect(first).resolves.toBe('synced');
        await expect(second).resolves.toBe('synced');
        expect(request.mock.calls.filter(([args]) => String((args as { url: string }).url).includes('/community-share-publish'))).toHaveLength(1);
        expect(plugin.settings.communityShare.publishHistory.filter(entry => entry.action === 'sync')).toHaveLength(1);

        // The guard releases: a later sync runs on its own.
        const third = syncCommunityShareIfDue(plugin as never);
        expect(third).not.toBe(first);
        await third;
    });
});

describe('Community Share checks the live state right before each request leaves', () => {
    it.each([
        ['connection replacement', 'connection_changed', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.connection.connectionId = 'conn-2'; }],
        ['secret slot replacement', 'connection_changed', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.connection.secretId = 'different-secret'; }],
        ['project replacement', 'connection_changed', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.connection.projectId = 'project-2'; }],
        ['private audience', 'publish_locked', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.audience = 'private_draft'; }],
        ['manual publishing disabled', 'publish_locked', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.manualPublishEnabled = false; }],
        ['tier changed', 'preview_stale', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.tier = 2; }],
        ['field permission withdrawn', 'preview_stale', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.fieldPolicy['project.title'] = false; }],
        ['preview invalidated', 'preview_stale', (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => { s.preview.status = 'stale'; }],
    ] as const)('blocks a report after %s during preview preparation', async (_label, code, mutate) => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness);
        const { plugin } = harness;
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockClear();
        const realBuild = (await vi.importActual<typeof import('./communitySharePreview')>('./communitySharePreview')).buildCommunitySharePreview;
        vi.mocked(buildCommunitySharePreview).mockImplementationOnce(async p => {
            const preview = await realBuild(p);
            mutate(plugin.settings.communityShare);
            return preview;
        });
        await expect(publishCommunityShareReport(plugin as never)).rejects.toMatchObject({ code });
        expect(request).not.toHaveBeenCalled();
        expect(plugin.settings.communityShare.publishHistory).toEqual([]);
    });

    it('blocks a scheduled report if scheduling is disabled during its own preview build', async () => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness);
        const { plugin } = harness;
        plugin.settings.communityShare.scheduledPublishEnabled = true;
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockClear();
        const realBuild = (await vi.importActual<typeof import('./communitySharePreview')>('./communitySharePreview')).buildCommunitySharePreview;
        vi.mocked(buildCommunitySharePreview).mockImplementationOnce(async p => {
            const preview = await realBuild(p);
            plugin.settings.communityShare.scheduledPublishEnabled = false;
            return preview;
        });
        await expect(publishCommunityShareReport(plugin as never, 'scheduled')).rejects.toMatchObject({ code: 'publish_locked' });
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['projects', 'context', 'apr', 'session', 'revoke'] as const)('blocks %s on connection replacement during secret lookup', async operation => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness);
        const { plugin } = harness;
        plugin.settings.communityShare.publishHistory = [{ id: 'publish-1', publishId: 'publish-1', action: 'publish', status: 'success', at: '2026-09-05T12:00:00Z' }];
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockClear();
        const storage = plugin.app.secretStorage;
        const original = storage.getSecret;
        storage.getSecret = id => {
            plugin.settings.communityShare.connection.connectionId = 'replacement';
            return original(id);
        };
        const calls = {
            projects: () => syncCommunityProjects(plugin as never),
            context: () => fetchCommunityShareContext(plugin as never),
            apr: () => uploadAprToCommunity(plugin as never, { svg: '<svg/>', width: 100, height: 100, teaserLevel: 'full', updateFrequency: 'manual', bookKey: 'book-1' }),
            session: () => postSessionToCommunityFeed(plugin as never, { audience: 'community', body: 'Session', stats: { minutes: 30, words: 500, mode: 'drafting' } }),
            revoke: () => revokeCommunityShareReport(plugin as never),
        };
        await expect(calls[operation]()).rejects.toMatchObject({ code: 'connection_changed' });
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['apr', 'session', 'daily'] as const)('blocks %s when sharing level drops during secret lookup', async operation => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness, 4);
        const { plugin } = harness;
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockClear();
        if (operation === 'daily') {
            const now = new Date();
            const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            (plugin as { getWritingSessionService: unknown }).getWritingSessionService = () => ({
                getSettings: () => ({ records: [{ id: 'today', mode: 'drafting', startedAt: now.toISOString(), endedAt: now.toISOString(), sessionDate: date, elapsedMs: 60000, wordsAdded: 50 }] })
            });
        }
        const storage = plugin.app.secretStorage;
        const original = storage.getSecret;
        storage.getSecret = id => {
            plugin.settings.communityShare.tier = 1;
            return original(id);
        };
        if (operation === 'daily') {
            await syncCommunityDailyIfEligible(plugin as never);
        } else {
            const send = operation === 'apr'
                ? uploadAprToCommunity(plugin as never, { svg: '<svg/>', width: 100, height: 100, teaserLevel: 'full', updateFrequency: 'manual', bookKey: 'book-1' })
                : postSessionToCommunityFeed(plugin as never, { audience: 'community', body: 'Session', stats: { minutes: 30, words: 500, mode: 'drafting' } });
            await expect(send).rejects.toMatchObject({ code: 'sharing_level_required' });
        }
        expect(request).not.toHaveBeenCalled();
    });

    it('refuses to publish when a Pause lands while the preview is building', async () => {
        const harness = createPluginHarness();
        const { plugin } = harness;
        vi.clearAllMocks();
        await armReadyToPublish(harness);
        const request = vi.spyOn(obsidian, 'requestUrl');
        const realBuild = (await vi.importActual<typeof import('./communitySharePreview')>('./communitySharePreview')).buildCommunitySharePreview;
        vi.mocked(buildCommunitySharePreview).mockImplementationOnce(async (p) => {
            const preview = await realBuild(p);
            await pauseCommunitySharing(plugin as never);
            return preview;
        });

        await expect(publishCommunityShareReport(plugin as never)).rejects.toMatchObject({ code: 'sharing_paused' });
        expect(request).not.toHaveBeenCalled();
        expect(plugin.settings.communityShare.sharingPaused).toBe(true);
    });

    it('does not send daily aggregates when a disconnect lands while they are being built', async () => {
        const harness = createPluginHarness();
        const { plugin } = harness;
        vi.clearAllMocks();
        await armReadyToPublish(harness, 4);
        const request = vi.spyOn(obsidian, 'requestUrl');
        const service = plugin.getWritingSessionService();
        (plugin as { getWritingSessionService: unknown }).getWritingSessionService = () => ({
            ...service,
            // The aggregate build reads the session records; a disconnect lands mid-read.
            getSettings: () => {
                plugin.settings.communityShare.connection.status = 'disconnected';
                return { records: [] };
            }
        });

        await syncCommunityDailyIfEligible(plugin as never);

        expect(request).not.toHaveBeenCalled();
    });

    it('refuses a project sync when the vault was disconnected while the secret was being read', async () => {
        const harness = createPluginHarness();
        const { plugin, secrets } = harness;
        vi.clearAllMocks();
        await armReadyToPublish(harness);
        const request = vi.spyOn(obsidian, 'requestUrl');
        const storage = plugin.app.secretStorage;
        const realGet = storage.getSecret;
        storage.getSecret = (id: string) => {
            // A concurrent disconnect cleared local state before the secret came back.
            plugin.settings.communityShare.connection.status = 'disconnected';
            return realGet.call(storage, id);
        };
        expect(secrets.has('rt-community-share-connection-secret')).toBe(true);

        await expect(syncCommunityProjects(plugin as never)).rejects.toMatchObject({ code: 'connection_required' });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Community Share activation client', () => {
    it('confirms activation with only a hashed installation id and stores the returned secret privately', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 201,
            text: JSON.stringify({
                connection_id: 'conn-1',
                connection_secret: 'rtcs_returned-secret',
                secret_expires_at: null,
                profile_id: 'profile-1',
                project_id: 'project-1',
                profile_display: 'Eric',
                project_title: 'Book 1'
            })
        } as never);

        await confirmCommunityShareActivation(plugin as never, 'activation-token-from-website');

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body: string; url: string };
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(request.url).toContain('/community-activation-confirm');
        expect(body.activation_token).toBe('activation-token-from-website');
        expect(body.plugin_installation_id_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(body.installation_label).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('rtpi_');

        expect(secrets.get('rt-community-share-installation-id')).toMatch(/^rtpi_/);
        expect(secrets.get('rt-community-share-connection-secret')).toBe('rtcs_returned-secret');
        expect(plugin.settings.communityShare.connection.status).toBe('connected');
        expect(plugin.settings.communityShare.connection.secretId).toBe('rt.community-share.connection-secret');
        expect(plugin.settings.communityShare.connection.profileId).toBe('profile-1');
        expect(plugin.settings.communityShare.connection.projectId).toBe('project-1');
        expect(plugin.settings.communityShare.preview.status).toBe('stale');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('cleans up the server connection if the returned secret cannot be stored locally', async () => {
        const { plugin, secrets } = createPluginHarness({ failConnectionSecretStorage: true });
        vi.clearAllMocks();
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl')
            .mockResolvedValueOnce({
                status: 201,
                text: JSON.stringify({
                    connection_id: 'conn-1',
                    connection_secret: 'rtcs_returned-secret',
                    secret_expires_at: null,
                    profile_id: 'profile-1',
                    project_id: 'project-1'
                })
            } as never)
            .mockResolvedValueOnce({
                status: 200,
                text: JSON.stringify({ ok: true })
            } as never);

        await expect(confirmCommunityShareActivation(plugin as never, 'activation-token-from-website'))
            .rejects
            .toMatchObject({ code: 'secret_storage_failed' });

        expect(secrets.get('rt-community-share-installation-id')).toMatch(/^rtpi_/);
        expect(secrets.has('rt-community-share-connection-secret')).toBe(false);
        expect(plugin.settings.communityShare.connection.status).toBe('disconnected');
        expect(plugin.saveSettings).not.toHaveBeenCalled();

        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
        const cleanupRequest = mockedRequestUrl.mock.calls[1]?.[0] as { body: string; url: string };
        const cleanupBody = JSON.parse(cleanupRequest.body) as Record<string, unknown>;
        expect(cleanupRequest.url).toContain('/community-share-disconnect');
        expect(cleanupBody.connection_id).toBe('conn-1');
        expect(cleanupBody.current_secret).toBe('rtcs_returned-secret');
        expect(cleanupBody.mode).toBe('disconnect_only');
    });

    it('restores the prior connection secret when a replace fails to store the new one', async () => {
        // A reconnect over a working connection returns a new secret. If the
        // replace clobbers the old secret and then fails to verify, the old
        // still-referenced connection must not be left without its secret.
        const { plugin, secrets } = createPluginHarness({ poisonConnectionSecretValue: 'rtcs_new-secret' });
        vi.clearAllMocks();
        secrets.set('rt-community-share-connection-secret', 'rtcs_old-secret');
        plugin.settings.communityShare = buildDefaultCommunityShareSettings();
        plugin.settings.communityShare.enabled = true;
        plugin.settings.communityShare.connection = {
            status: 'connected',
            connectionId: 'conn-old',
            profileId: 'profile-old',
            projectId: 'project-old',
            secretId: 'rt.community-share.connection-secret'
        };

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl')
            .mockResolvedValueOnce({
                status: 201,
                text: JSON.stringify({
                    connection_id: 'conn-new',
                    connection_secret: 'rtcs_new-secret',
                    secret_expires_at: null,
                    profile_id: 'profile-new',
                    project_id: 'project-new'
                })
            } as never)
            .mockResolvedValueOnce({
                status: 200,
                text: JSON.stringify({ ok: true })
            } as never);

        await expect(confirmCommunityShareActivation(plugin as never, 'activation-token-from-website'))
            .rejects
            .toMatchObject({ code: 'secret_storage_failed' });

        // The prior working secret is restored, not destroyed.
        expect(secrets.get('rt-community-share-connection-secret')).toBe('rtcs_old-secret');
        // The unstored NEW server-side connection is cleaned up, and settings
        // still reference the old, still-valid connection.
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
        expect((mockedRequestUrl.mock.calls[1]?.[0] as { url: string }).url).toContain('/community-share-disconnect');
        expect(plugin.settings.communityShare.connection.connectionId).toBe('conn-old');
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('publishes only after a ready preview and records the returned public slug', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.tier = 3;
        settings.audience = 'public';
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        settings.fieldPolicy['project.title'] = true;
        settings.fieldPolicy['activity.words_added'] = true;
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');

        const preview = await buildCommunitySharePreview(plugin as never);
        settings.preview = {
            status: 'ready',
            generatedAt: '2026-06-27T12:00:00.000Z',
            previewHash: preview.previewHash,
            payloadHash: preview.payloadHash,
            reportPeriod: 'weekly',
            summary: preview.summary
        };

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 201,
            text: JSON.stringify({
                ok: true,
                publish_id: 'publish-1',
                version_id: 'version-1',
                public_slug: 'csr_public',
                status: 'published',
                published_at: '2026-06-27T19:00:00.000Z',
                superseded_version_id: null
            })
        } as never);

        await publishCommunityShareReport(plugin as never);

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body: string; url: string };
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(request.url).toContain('/community-share-publish');
        expect(body.current_secret).toBe('rtcs_current-secret');
        expect(body.preview_hash).toBe(preview.previewHash);
        expect(body.payload).toEqual(preview.payload);
        expect(JSON.stringify(body.payload)).not.toContain('Private Local Draft Title');
        expect(plugin.settings.communityShare.connection.publicSlug).toBe('csr_public');
        expect(plugin.settings.communityShare.preview.status).toBe('stale');
        expect(plugin.settings.communityShare.publishHistory[0]?.versionId).toBe('version-1');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('refuses to publish while sharing is paused, even with a ready preview', async () => {
        // Guards the Pause/sync race: a Pause landing after a sync path cleared
        // its own paused-check but before publish runs must still stop the
        // payload from leaving the vault.
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.tier = 4;
        settings.audience = 'public';
        settings.sharingPaused = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        settings.fieldPolicy['project.title'] = true;
        settings.fieldPolicy['activity.words_added'] = true;
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');

        const preview = await buildCommunitySharePreview(plugin as never);
        settings.preview = {
            status: 'ready',
            generatedAt: '2026-06-27T12:00:00.000Z',
            previewHash: preview.previewHash,
            payloadHash: preview.payloadHash,
            reportPeriod: 'weekly',
            summary: preview.summary
        };

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');

        await expect(publishCommunityShareReport(plugin as never))
            .rejects
            .toMatchObject({ code: 'sharing_paused' });
        expect(mockedRequestUrl).not.toHaveBeenCalled();
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('revokes the latest published report using the private connection secret', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        settings.publishHistory.push({
            id: 'version-1',
            action: 'publish',
            status: 'success',
            at: '2026-06-27T19:00:00.000Z',
            publishId: 'publish-1',
            versionId: 'version-1',
            publicSlug: 'csr_public'
        });
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({
                ok: true,
                publish_id: 'publish-1',
                status: 'revoked',
                revoked_at: '2026-06-27T20:00:00.000Z'
            })
        } as never);

        await revokeCommunityShareReport(plugin as never);

        const body = JSON.parse((mockedRequestUrl.mock.calls[0]?.[0] as { body: string }).body) as Record<string, unknown>;
        expect(body.publish_id).toBe('publish-1');
        expect(body.current_secret).toBe('rtcs_current-secret');
        expect(plugin.settings.communityShare.publishHistory.at(-1)?.action).toBe('revoke');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('disconnects and removes the local connection secret', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({
                ok: true,
                connection_id: 'conn-1',
                status: 'disconnected',
                mode: 'disconnect_only',
                affected_publishes: 0,
                disconnected_at: '2026-06-27T20:30:00.000Z'
            })
        } as never);

        await disconnectCommunityShare(plugin as never);

        const body = JSON.parse((mockedRequestUrl.mock.calls[0]?.[0] as { body: string }).body) as Record<string, unknown>;
        expect(body.connection_id).toBe('conn-1');
        expect(body.current_secret).toBe('rtcs_current-secret');
        expect(body.mode).toBe('disconnect_only');
        expect(secrets.has('rt-community-share-connection-secret')).toBe(false);
        expect(plugin.settings.communityShare.enabled).toBe(false);
        expect(plugin.settings.communityShare.connection.status).toBe('disconnected');
        expect(plugin.settings.communityShare.connection.secretId).toBeUndefined();
        expect(plugin.settings.communityShare.publishHistory.at(-1)?.action).toBe('disconnect');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('clears local connection state when the local secret is missing, without calling the server', async () => {
        // A vault that lost its secret must still be able to escape "Connected".
        const { plugin } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        // Intentionally do NOT seed the connection secret — it is missing.
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');

        const result = await disconnectCommunityShare(plugin as never);

        expect(mockedRequestUrl).not.toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(plugin.settings.communityShare.enabled).toBe(false);
        expect(plugin.settings.communityShare.connection.status).toBe('disconnected');
        expect(plugin.settings.communityShare.connection.secretId).toBeUndefined();
        expect(plugin.settings.communityShare.publishHistory.at(-1)?.action).toBe('disconnect');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('clears local connection state even when the disconnect server call returns a malformed body', async () => {
        // Best-effort server call: an unexpected 2xx body must not strand the
        // vault in a permanent "Connected" state.
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({ unexpected: 'shape' })
        } as never);

        const result = await disconnectCommunityShare(plugin as never);

        expect(result.ok).toBe(true);
        expect(secrets.has('rt-community-share-connection-secret')).toBe(false);
        expect(plugin.settings.communityShare.connection.status).toBe('disconnected');
        expect(plugin.settings.communityShare.connection.secretId).toBeUndefined();
        expect(plugin.settings.communityShare.publishHistory.at(-1)?.action).toBe('disconnect');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('sends the campaign APR to the community site with the connection secret', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.tier = 2;
        settings.audience = 'public';
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({
                ok: true,
                status: 'private',
                teaser_level: 'ring',
                public_url: null,
                updated_at: '2026-07-04T12:00:00.000Z'
            })
        } as never);

        const result = await uploadAprToCommunity(plugin as never, {
            svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            width: 480,
            height: 480,
            teaserLevel: 'ring',
            updateFrequency: 'daily',
            bookKey: 'book-1',
            campaignLabel: 'Newsletter'
        });

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body: string; url: string };
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(request.url).toContain('/community-apr-upload');
        expect(body.current_secret).toBe('rtcs_current-secret');
        expect(body.plugin_book_key).toBe('book-1');
        expect(body.project_id).toBeUndefined();
        expect(body.teaser_level).toBe('ring');
        expect(body.update_frequency).toBe('daily');
        expect(body.campaign_label).toBe('Newsletter');
        expect(result.status).toBe('private');
    });

    it('blocks APR upload while the sharing level is Private', async () => {
        const { plugin } = createPluginHarness();
        plugin.settings.communityShare.enabled = true;
        plugin.settings.communityShare.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };

        await expect(uploadAprToCommunity(plugin as never, {
            svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            width: 480,
            height: 480,
            teaserLevel: 'ring',
            updateFrequency: 'manual',
            bookKey: 'book-1'
        })).rejects.toMatchObject({ code: 'sharing_level_required' });
    });

    it('syncs Book Manager books as private community project shells', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        (plugin.settings as { books?: unknown }).books = [
            {
                id: 'book-1',
                title: 'Private Draft Title',
                publicLabel: 'Public Title',
                publicDescription: 'A public logline.',
                // Per-book publishing targets ride along with each book.
                stageTargetDates: {
                    Zero: '2026-07-01',
                    Author: '2026-07-31',
                    House: 'not-a-date' // malformed -> sent as null (clears), never breaks the sync
                }
            },
            { id: 'book-2', title: 'Second Book' }
        ];
        (plugin.settings as { enableZeroDraftMode?: unknown }).enableZeroDraftMode = true;

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({
                ok: true,
                created: 2,
                updated: 0,
                projects: [
                    { id: 'p-1', book_key: 'book-1', title: 'Public Title', visibility: 'private' },
                    { id: 'p-2', book_key: 'book-2', title: 'Second Book', visibility: 'private' }
                ]
            })
        } as never);

        const result = await syncCommunityProjects(plugin as never);

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body: string; url: string };
        const body = JSON.parse(request.body) as { projects: Array<Record<string, unknown>> };
        expect(request.url).toContain('/community-project-sync');
        expect(body.projects[0]).toEqual({
            book_key: 'book-1',
            title: 'Public Title',
            logline: 'A public logline.',
            order_index: 0,
            // Each book carries its OWN targets; malformed/missing dates go as
            // null (clears server value), never as garbage.
            zero_target_date: '2026-07-01',
            author_target_date: '2026-07-31',
            house_target_date: null,
            press_target_date: null,
            // Zero-draft mode is a vault-global working mode -> active book only.
            zero_draft_mode: true
        });
        // A book with a public label sends the label, never its working title.
        expect(JSON.stringify(body)).not.toContain('Private Draft Title');
        // A book with no public label sends its working title: the contract's
        // share-surfaces amendment stores every book as a PRIVATE shell that only
        // the author can see on My Share until they switch it on there. See
        // docs/engineering/standards/writing-session-privacy.md, "On connection".
        expect(body.projects[1].title).toBe('Second Book');
        // Book Manager array order rides along so the website can mirror it.
        expect(body.projects[1].order_index).toBe(1);
        // A book without targets still sends its dates (as null) — the plugin
        // is the per-book source of truth — but not the active-only mode flag.
        expect(body.projects[1].zero_target_date).toBeNull();
        expect(body.projects[1].press_target_date).toBeNull();
        expect(body.projects[1]).not.toHaveProperty('zero_draft_mode');
        expect(result.created).toBe(2);
    });

    it('sends two weeks of daily aggregates when the standing share is active at the progress level', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.tier = 4;
        settings.audience = 'public';
        settings.scheduledPublishEnabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        (plugin as { getWritingSessionService: unknown }).getWritingSessionService = () => ({
            getSettings: () => ({
                records: [{
                    id: 'session-1',
                    mode: 'drafting',
                    startedAt: `${todayKey}T09:00:00.000Z`,
                    endedAt: `${todayKey}T10:03:00.000Z`,
                    sessionDate: todayKey,
                    elapsedMs: 63 * 60000,
                    wordsAdded: 1234
                }]
            })
        });

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({ ok: true, upserted: 14 })
        } as never);

        await syncCommunityDailyIfEligible(plugin as never);

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body: string; url: string };
        expect(request.url).toContain('/community-daily-sync');
        const body = JSON.parse(request.body) as {
            connection_id: string;
            current_secret: string;
            days: Array<Record<string, unknown>>;
            hour_mode_mix: Record<string, { drafting: number; revising: number; planning: number }>;
        };
        expect(body.connection_id).toBe('conn-1');
        expect(body.current_secret).toBe('rtcs_current-secret');
        expect(body.days).toHaveLength(14);
        const todayEntry = body.days.at(-1);
        expect(todayEntry?.date).toBe(todayKey);
        expect(todayEntry?.minutes_total).toBe(65);
        expect(todayEntry?.words_added).toBe(1250);
        expect(todayEntry?.session_count).toBe(1);
        expect(todayEntry?.mode_mix).toEqual({ drafting: 100 });
        expect(todayEntry?.scenes_completed_by_stage).toEqual({ Zero: 0, Author: 0, House: 0, Press: 0 });
        // Companion trailing-28-day hour x mode rollup rides the same sync,
        // same tier-4 gate, no separate opt-in.
        const startHour = new Date(`${todayKey}T09:00:00.000Z`).getHours();
        expect(body.hour_mode_mix[String(startHour)]).toEqual({ drafting: 63, revising: 0, planning: 0 });
        expect(Object.keys(body.hour_mode_mix)).toHaveLength(1);
        // Aggregates only — no session ids, paths, or timestamps on the wire.
        expect(request.body).not.toContain('session-1');
        expect(request.body).not.toContain('T09:00');
    });

    it('never sends daily aggregates below the progress sharing level', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.tier = 2;
        settings.audience = 'public';
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl');

        await syncCommunityDailyIfEligible(plugin as never);

        expect(mockedRequestUrl).not.toHaveBeenCalled();
    });

    it('stops scheduled sharing when the daily sync hits a standing-authorization failure', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.tier = 4;
        settings.audience = 'public';
        settings.scheduledPublishEnabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        (plugin as { getWritingSessionService: unknown }).getWritingSessionService = () => ({
            getSettings: () => ({ records: [] })
        });
        vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 403,
            text: JSON.stringify({ error: { code: 'connection_not_active', message: 'Share is not active.' } })
        } as never);

        await expect(syncCommunityDailyIfEligible(plugin as never)).resolves.toBeUndefined();

        expect(plugin.settings.communityShare.scheduledPublishEnabled).toBe(false);
        expect(plugin.settings.communityShare.publishHistory.at(-1)).toMatchObject({
            action: 'sync',
            status: 'failed'
        });
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('reads the canonical website share context with the connection secret', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');

        const mockedRequestUrl = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 200,
            text: JSON.stringify({
                ok: true,
                connected_project_id: 'project-1',
                profile: { handle: 'eric', display_name: 'Eric', avatar_url: null, member_role: 'author' },
                projects: [{
                    id: 'project-1',
                    plugin_book_key: 'book-1',
                    title: 'Website Canonical Title',
                    logline: 'Website logline.',
                    status: 'querying',
                    genre_l1: 'Fiction',
                    genre_l2: 'Science Fiction',
                    genre_l3: null,
                    custom_genre_label: 'Solarpunk noir',
                    visibility: 'public'
                }]
            })
        } as never);

        const result = await fetchCommunityShareContext(plugin as never);

        const request = mockedRequestUrl.mock.calls[0]?.[0] as { body: string; url: string };
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(request.url).toContain('/community-share-context');
        expect(body).toEqual({ connection_id: 'conn-1', current_secret: 'rtcs_current-secret' });
        expect(result.profile?.display_name).toBe('Eric');
        expect(result.projects[0]?.title).toBe('Website Canonical Title');
        expect(result.projects[0]?.status).toBe('querying');
    });

    it('surfaces a clear error when the website context cannot be loaded', async () => {
        const { plugin, secrets } = createPluginHarness();
        vi.clearAllMocks();
        const settings = plugin.settings.communityShare;
        settings.enabled = true;
        settings.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: 'project-1',
            secretId: 'rt.community-share.connection-secret'
        };
        secrets.set('rt-community-share-connection-secret', 'rtcs_current-secret');
        vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
            status: 401,
            text: JSON.stringify({ error: { code: 'connection_secret_invalid', message: 'The current connection secret is not valid.' } })
        } as never);

        await expect(fetchCommunityShareContext(plugin as never))
            .rejects
            .toMatchObject({ code: 'connection_secret_invalid' });
    });
});

describe('standing-share exits: begin, pause, resume, session post', () => {
    it('beginCommunitySharing publishes, then turns the standing share on and unpaused', async () => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness);
        const { plugin } = harness;
        vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({ status: 200, text: JSON.stringify(publishedBody) } as never);

        const result = await beginCommunitySharing(plugin as never);

        expect(result.publish_id).toBe('publish-1');
        expect(plugin.settings.communityShare.scheduledPublishEnabled).toBe(true);
        expect(plugin.settings.communityShare.sharingPaused).toBe(false);
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('pauseCommunitySharing freezes every exit and records the pause', async () => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness);
        const { plugin } = harness;
        plugin.settings.communityShare.scheduledPublishEnabled = true;

        await pauseCommunitySharing(plugin as never);

        const share = plugin.settings.communityShare;
        expect(share.sharingPaused).toBe(true);
        expect(share.scheduledPublishEnabled).toBe(false);
        expect(share.publishHistory.at(-1)?.action).toBe('pause');
        expect(canPostSessionsToFeed(plugin as never)).toBe(false);
    });

    it('resumeCommunitySharing lifts the freeze, records the resume, and lets the syncs run', async () => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness);
        const { plugin } = harness;
        await pauseCommunitySharing(plugin as never);
        const request = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({ status: 200, text: JSON.stringify(publishedBody) } as never);

        await resumeCommunitySharing(plugin as never);

        const share = plugin.settings.communityShare;
        expect(share.sharingPaused).toBe(false);
        expect(share.scheduledPublishEnabled).toBe(true);
        expect(share.publishHistory.some(entry => entry.action === 'resume')).toBe(true);
        expect(canPostSessionsToFeed(plugin as never)).toBe(true);
        // Nothing the resume triggers may throw; the syncs own their failures.
        expect(request).toHaveBeenCalled();
    });

    it('postSessionToCommunityFeed needs Level 3 and sends only the post body and stats', async () => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness, 2);
        const { plugin } = harness;
        const post = { audience: 'community' as const, body: 'Drafted 500 words.', stats: { minutes: 30, words: 500, mode: 'drafting' as const } };

        await expect(postSessionToCommunityFeed(plugin as never, post)).rejects.toMatchObject({ code: 'sharing_level_required' });

        plugin.settings.communityShare.tier = 3;
        const request = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({ status: 200, text: JSON.stringify({ ok: true }) } as never);
        await postSessionToCommunityFeed(plugin as never, post);

        const call = request.mock.calls.at(-1)?.[0] as { url: string; body: string };
        expect(call.url.endsWith('/community-session-post')).toBe(true);
        const sent = JSON.parse(call.body) as Record<string, unknown>;
        expect(sent).toEqual({
            connection_id: 'conn-1',
            current_secret: 'rtcs_current-secret',
            body: 'Drafted 500 words.',
            session: { minutes: 30, words: 500, mode: 'drafting' }
        });
    });

    it('postSessionToCommunityFeed surfaces the server error code and treats a 2xx without ok as invalid', async () => {
        const harness = createPluginHarness();
        await armReadyToPublish(harness, 3);
        const { plugin } = harness;
        const post = { audience: 'community' as const, body: 'x', stats: { minutes: 1, mode: 'planning' as const } };
        const request = vi.spyOn(obsidian, 'requestUrl');

        request.mockResolvedValueOnce({ status: 403, text: JSON.stringify({ error: { code: 'scope_rejected', message: 'nope' } }) } as never);
        await expect(postSessionToCommunityFeed(plugin as never, post)).rejects.toMatchObject({ code: 'scope_rejected', message: 'nope' });

        request.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ ok: false }) } as never);
        await expect(postSessionToCommunityFeed(plugin as never, post)).rejects.toMatchObject({ code: 'invalid_response' });
    });
});
