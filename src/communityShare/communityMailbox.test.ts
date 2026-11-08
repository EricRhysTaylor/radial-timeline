import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./communityShareClient', () => ({
    fetchCommunityMailbox: vi.fn(),
    syncCommunityProjects: vi.fn()
}));

import { fetchCommunityMailbox, syncCommunityProjects, type CommunityMailboxAnswer } from './communityShareClient';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import type { CommunityShareSettings } from '../types/settings';
import { Platform } from 'obsidian';
import {
    COMMUNITY_DESK_LAMPS_URL,
    COMMUNITY_SITE_URL,
    COMMUNITY_SYNC_OVERDUE_MS,
    CommunityMailbox,
    COMMUNITY_AUTO_SYNC_INTERVAL_MS,
    communitySyncNativeText,
    communitySyncRow,
    communitySyncTooltip,
    nativeMenuEntryTitle,
    usesNativeMenus,
    formatAutoSyncTime,
    nextAutoSyncAt,
    communitySyncState,
    mailboxBadge,
    mailboxMenuEntries,
    mailboxTooltip,
    syncNeedsAttention
} from './communityMailbox';

const QUESTION = '55555555-5555-4555-8555-555555555555';
const EMPTY: CommunityMailboxAnswer = { ok: true, support_unread: 0, replies: { count: 0, latest_post_id: null }, desk_lamp_invites: 0, admin: null };
const answer = (patch: Partial<CommunityMailboxAnswer>): CommunityMailboxAnswer => ({ ...EMPTY, ...patch });

const fetchMock = vi.mocked(fetchCommunityMailbox);

function connectedPlugin(options: { toggle?: boolean; connected?: boolean; books?: Array<{ id: string }> } = {}) {
    const communityShare = buildDefaultCommunityShareSettings();
    if (options.connected !== false) {
        communityShare.enabled = true;
        communityShare.connection = {
            status: 'connected',
            connectionId: 'conn-1',
            profileId: 'profile-1',
            projectId: null,
            secretId: 'rt.community-share.connection-secret'
        };
    }
    return { settings: { showCommunityMailbox: options.toggle, communityShare, books: options.books ?? [{ id: 'book-1' }] } };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

describe('mailboxBadge works like the website account chip', () => {
    it('shows the inbox count first: red while unread, blue while only awaiting', () => {
        expect(mailboxBadge(answer({ admin: { unread: 2, awaiting: 5 }, support_unread: 1 }))).toEqual({ tone: 'unread', count: 2 });
        expect(mailboxBadge(answer({ admin: { unread: 0, awaiting: 3 } }))).toEqual({ tone: 'awaiting', count: 3 });
    });

    it('otherwise counts conversations with new replies in gold: requests plus questions', () => {
        expect(mailboxBadge(answer({ admin: { unread: 0, awaiting: 0 }, support_unread: 1 }))).toEqual({ tone: 'new', count: 1 });
        expect(mailboxBadge(answer({ support_unread: 2, replies: { count: 3, latest_post_id: QUESTION } }))).toEqual({ tone: 'new', count: 5 });
    });

    it('counts Desk Lamp invites with the new replies, in gold', () => {
        expect(mailboxBadge(answer({ desk_lamp_invites: 1 }))).toEqual({ tone: 'new', count: 1 });
        expect(mailboxBadge(answer({ support_unread: 1, desk_lamp_invites: 2 }))).toEqual({ tone: 'new', count: 3 });
        expect(mailboxBadge(answer({ admin: { unread: 1, awaiting: 0 }, desk_lamp_invites: 2 }))).toEqual({ tone: 'unread', count: 1 });
    });

    it('shows nothing when all is read, and before the first answer', () => {
        expect(mailboxBadge(EMPTY)).toBeNull();
        expect(mailboxBadge(answer({ admin: { unread: 0, awaiting: 0 } }))).toBeNull();
        expect(mailboxBadge(null)).toBeNull();
    });
});

describe('mailboxMenuEntries mirrors the website account menu', () => {
    it('lists Requests, New replies while there are some, and the Support inbox for admins, each with its count', () => {
        expect(mailboxMenuEntries(answer({
            support_unread: 2,
            replies: { count: 1, latest_post_id: QUESTION },
            admin: { unread: 0, awaiting: 4 }
        }))).toEqual([
            { label: 'Requests', icon: 'mail', url: `${COMMUNITY_SITE_URL}/requests`, badge: { tone: 'new', count: 2 } },
            { label: 'New replies', icon: 'reply', url: `${COMMUNITY_SITE_URL}/posts/${QUESTION}`, badge: { tone: 'new', count: 1 } },
            { label: 'Support inbox', icon: 'inbox', url: `${COMMUNITY_SITE_URL}/admin/support`, badge: { tone: 'awaiting', count: 4 } }
        ]);
    });

    it('lists Desk Lamp invites while some wait, opening My Share\'s Desk Lamps section', () => {
        expect(mailboxMenuEntries(answer({ desk_lamp_invites: 2 }))).toEqual([
            { label: 'Requests', icon: 'mail', url: `${COMMUNITY_SITE_URL}/requests`, badge: null },
            { label: 'Desk Lamp invites', icon: 'lamp-ceiling', url: COMMUNITY_DESK_LAMPS_URL, badge: { tone: 'new', count: 2 } }
        ]);
        expect(COMMUNITY_DESK_LAMPS_URL).toBe(`${COMMUNITY_SITE_URL}/me#desk-lamps`);
        expect(mailboxTooltip({ visible: true, answer: answer({ desk_lamp_invites: 1 }), error: null, sync: null, nextAutoSyncAt: null })).toBe('Mailbox: a Desk Lamp invite waiting');
    });

    it('keeps Requests reachable with nothing new, before the first check, and for a member', () => {
        const requestsOnly = [{ label: 'Requests', icon: 'mail', url: `${COMMUNITY_SITE_URL}/requests`, badge: null }];
        expect(mailboxMenuEntries(EMPTY)).toEqual(requestsOnly);
        expect(mailboxMenuEntries(null)).toEqual(requestsOnly);
        expect(mailboxMenuEntries(answer({ admin: { unread: 0, awaiting: 0 } })).map(e => e.label)).toEqual(['Requests', 'Support inbox']);
    });
});

describe('mailboxTooltip', () => {
    it('names what is new, says nothing new, or says why a check failed', () => {
        expect(mailboxTooltip({ visible: true, answer: answer({ admin: { unread: 2, awaiting: 3 }, support_unread: 1 }), error: null, sync: null, nextAutoSyncAt: null }))
            .toBe('Mailbox: 2 unread in the support inbox · a new reply in Requests');
        expect(mailboxTooltip({ visible: true, answer: answer({ support_unread: 2, replies: { count: 3, latest_post_id: QUESTION } }), error: null, sync: null, nextAutoSyncAt: null }))
            .toBe('Mailbox: new replies on 2 requests · new replies to 3 of your questions');
        expect(mailboxTooltip({ visible: true, answer: EMPTY, error: null, sync: null, nextAutoSyncAt: null })).toBe('Mailbox: nothing new');
        expect(mailboxTooltip({ visible: true, answer: null, error: 'This connection has been disconnected.', sync: null, nextAutoSyncAt: null }))
            .toBe("Mailbox: couldn't check for new replies (This connection has been disconnected.).");
    });
});

describe('CommunityMailbox', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fetchMock.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('is hidden, and never checks, unless the vault is connected and the toggle is on', async () => {
        for (const plugin of [connectedPlugin({ connected: false }), connectedPlugin({ toggle: false })]) {
            const mailbox = new CommunityMailbox(plugin as never);
            mailbox.subscribe(() => {});
            await vi.runOnlyPendingTimersAsync();
            expect(mailbox.view().visible).toBe(false);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows and checks at the Private level too: it only reads', async () => {
        fetchMock.mockResolvedValue(answer({ support_unread: 1 }));
        const plugin = connectedPlugin();
        plugin.settings.communityShare.enabled = false; // the author chose Private
        const mailbox = new CommunityMailbox(plugin as never);
        mailbox.subscribe(() => {});
        await vi.waitFor(() => expect(mailbox.view().visible).toBe(true));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('checks when the first view subscribes, then hourly while one stays open', async () => {
        fetchMock.mockResolvedValue(answer({ support_unread: 1 }));
        const mailbox = new CommunityMailbox(connectedPlugin() as never);
        const painted = vi.fn();
        const unsubscribe = mailbox.subscribe(painted);
        await vi.waitFor(() => expect(painted).toHaveBeenCalled());
        expect(mailbox.view()).toEqual({ visible: true, answer: answer({ support_unread: 1 }), error: null, sync: { status: 'pending' }, nextAutoSyncAt: null });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        mailbox.subscribe(() => {}); // a second view does not check again
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(66 * 60e3);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        unsubscribe();
    });

    it('stops checking once no view is subscribed', async () => {
        fetchMock.mockResolvedValue(EMPTY);
        const mailbox = new CommunityMailbox(connectedPlugin() as never);
        const unsubscribe = mailbox.subscribe(() => {});
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        unsubscribe();
        await vi.advanceTimersByTimeAsync(3 * 60 * 60e3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rechecks on focus at most once a minute', async () => {
        fetchMock.mockResolvedValue(EMPTY);
        const mailbox = new CommunityMailbox(connectedPlugin() as never);
        mailbox.subscribe(() => {});
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        mailbox.onWake();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(61e3);
        mailbox.onWake();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });

    it('keeps the icon but drops the mark when a check fails', async () => {
        fetchMock.mockResolvedValueOnce(answer({ support_unread: 1 }));
        const mailbox = new CommunityMailbox(connectedPlugin() as never);
        mailbox.subscribe(() => {});
        await vi.waitFor(() => expect(mailbox.view().answer).not.toBeNull());
        fetchMock.mockRejectedValueOnce(new Error('Could not check your Community mailbox.'));
        await vi.advanceTimersByTimeAsync(61e3);
        mailbox.onWake();
        await vi.waitFor(() => expect(mailbox.view().error).toBe('Could not check your Community mailbox.'));
        expect(mailbox.view()).toMatchObject({ visible: true, answer: null });
    });

    it('hides at once on disconnect or toggle-off, and drops an answer that was still on its way', async () => {
        const pending = deferred<CommunityMailboxAnswer>();
        fetchMock.mockReturnValueOnce(pending.promise);
        const plugin = connectedPlugin();
        const mailbox = new CommunityMailbox(plugin as never);
        const painted = vi.fn();
        mailbox.subscribe(painted);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        plugin.settings.communityShare.connection = { status: 'disconnected' };
        mailbox.settingsChanged();
        expect(mailbox.view().visible).toBe(false);
        expect(painted).toHaveBeenCalledTimes(1);

        pending.resolve(answer({ support_unread: 1 }));
        await vi.runOnlyPendingTimersAsync();
        expect(mailbox.view()).toEqual({ visible: false, answer: null, error: null, sync: null, nextAutoSyncAt: null });

        plugin.settings.showCommunityMailbox = false;
        mailbox.settingsChanged(); // nothing changed for the mailbox: still hidden, no repaint
        expect(painted).toHaveBeenCalledTimes(1);
    });

    it('checks the new connection right away after a reconnect', async () => {
        fetchMock.mockResolvedValue(EMPTY);
        const plugin = connectedPlugin({ connected: false });
        const mailbox = new CommunityMailbox(plugin as never);
        mailbox.subscribe(() => {});
        expect(fetchMock).not.toHaveBeenCalled();
        plugin.settings.communityShare.enabled = true;
        plugin.settings.communityShare.connection = {
            status: 'connected', connectionId: 'conn-2', profileId: 'profile-1', projectId: null,
            secretId: 'rt.community-share.connection-secret'
        };
        mailbox.settingsChanged();
        await vi.waitFor(() => expect(mailbox.view()).toEqual({ visible: true, answer: EMPTY, error: null, sync: { status: 'pending' }, nextAutoSyncAt: null }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('Community sync row', () => {
    const NOW = Date.parse('2026-11-07T12:00:00.000Z');
    const MIN = 60e3;
    const DAY = 24 * 60 * MIN;
    const iso = (ms: number) => new Date(ms).toISOString();

    function share(connection: Partial<CommunityShareSettings['connection']> = {}, patch: Partial<CommunityShareSettings> = {}): CommunityShareSettings {
        const settings = buildDefaultCommunityShareSettings();
        return {
            ...settings,
            enabled: true,
            connection: {
                status: 'connected',
                connectionId: 'conn-1',
                profileId: 'profile-1',
                projectId: null,
                secretId: 'rt.community-share.connection-secret',
                ...connection
            },
            ...patch
        };
    }
    const rowFor = (settings: CommunityShareSettings) => {
        const state = communitySyncState(settings, NOW, true);
        return state && communitySyncRow(state, NOW);
    };

    it('keeps the 7-day threshold the website uses', () => {
        expect(COMMUNITY_SYNC_OVERDUE_MS).toBe(7 * DAY);
    });

    it('says when the book list last reached the website while it is healthy', () => {
        expect(rowFor(share({ bookListSyncedAt: iso(NOW - 5 * MIN) })))
            .toEqual({ text: 'Last synced with Community 5 minutes ago', warning: false, canSync: true });
        expect(rowFor(share({ bookListSyncedAt: iso(NOW - 10e3) }))?.text).toBe('Last synced with Community just now');
        expect(rowFor(share({ bookListSyncedAt: iso(NOW - 3 * 60 * MIN) }))?.text).toBe('Last synced with Community 3 hours ago');
        expect(rowFor(share({ bookListSyncedAt: iso(NOW - 30 * 60 * MIN) }))?.text).toBe('Last synced with Community yesterday');
    });

    it('turns red with the reason when the latest attempt failed, even after a recent success', () => {
        const failed = share({
            bookListSyncedAt: iso(NOW - 5 * MIN),
            bookListSyncError: 'Could not reach the Community website.',
            bookListSyncFailedAt: iso(NOW - MIN)
        });
        expect(communitySyncState(failed, NOW, true)).toEqual({ status: 'failed', error: 'Could not reach the Community website.' });
        expect(rowFor(failed)).toEqual({
            text: "Couldn't sync with Community (Could not reach the Community website.)",
            warning: true,
            canSync: true
        });
    });

    it('stays healthy at exactly 7 days and turns red once a sync is more than 7 days old', () => {
        const atBoundary = share({ bookListSyncedAt: iso(NOW - 7 * DAY) });
        expect(communitySyncState(atBoundary, NOW, true)?.status).toBe('healthy');
        expect(rowFor(atBoundary)).toEqual({ text: 'Last synced with Community 7 days ago', warning: false, canSync: true });

        const pastBoundary = share({ bookListSyncedAt: iso(NOW - 7 * DAY - 1) });
        expect(communitySyncState(pastBoundary, NOW, true)?.status).toBe('overdue');
        expect(rowFor(pastBoundary)).toEqual({ text: 'Last synced with Community 7 days ago', warning: true, canSync: true });
    });

    it('waits calmly for a first sync, and turns red if a connection older than 7 days never synced', () => {
        expect(rowFor(share({ connectedAt: iso(NOW - DAY) })))
            .toEqual({ text: 'Not synced with Community yet', warning: false, canSync: true });
        expect(communitySyncState(share({ connectedAt: iso(NOW - 7 * DAY - 1) }), NOW, true)).toEqual({ status: 'overdue', syncedAt: null });
        expect(rowFor(share({ connectedAt: iso(NOW - 8 * DAY) })))
            .toEqual({ text: 'Not synced with Community yet', warning: true, canSync: true });
    });

    it('shows no row unless the vault syncs its book list: Private, paused, or disconnected', () => {
        expect(communitySyncState(share({}, { enabled: false }), NOW, true)).toBeNull();
        expect(communitySyncState(share({}, { sharingPaused: true }), NOW, true)).toBeNull();
        expect(communitySyncState(share({ status: 'disconnected' }), NOW, true)).toBeNull();
        expect(communitySyncState(buildDefaultCommunityShareSettings(), NOW, true)).toBeNull();
    });

    it('shows no row with an empty Book Manager, so a vault with no books never turns red', () => {
        // Nothing is sent with no books, so bookListSyncedAt is never stamped.
        const neverSynced = share({ connectedAt: iso(NOW - 30 * DAY) });
        expect(communitySyncState(neverSynced, NOW, false)).toBeNull();
        expect(syncNeedsAttention(communitySyncState(neverSynced, NOW, false))).toBe(false);
        // The first book brings the row back.
        expect(communitySyncState(neverSynced, NOW, true)).toEqual({ status: 'overdue', syncedAt: null });
    });

    it('counts a failed or overdue sync once toward the gold count, like other things that wait on you', () => {
        expect(syncNeedsAttention({ status: 'failed', error: 'x' })).toBe(true);
        expect(syncNeedsAttention({ status: 'overdue', syncedAt: null })).toBe(true);
        expect(syncNeedsAttention({ status: 'healthy', syncedAt: NOW })).toBe(false);
        expect(syncNeedsAttention({ status: 'pending' })).toBe(false);
        expect(syncNeedsAttention(null)).toBe(false);

        expect(mailboxBadge(EMPTY, true)).toEqual({ tone: 'new', count: 1 });
        expect(mailboxBadge(answer({ support_unread: 2 }), true)).toEqual({ tone: 'new', count: 3 });
        expect(mailboxBadge(null, true)).toEqual({ tone: 'new', count: 1 });
        expect(mailboxBadge(answer({ admin: { unread: 1, awaiting: 0 } }), true)).toEqual({ tone: 'unread', count: 1 });
        expect(mailboxBadge(EMPTY, false)).toBeNull();
    });

    it('names a sync that needs attention in the tooltip', () => {
        const sync = { status: 'failed', error: 'x' } as const;
        expect(mailboxTooltip({ visible: true, answer: EMPTY, error: null, sync, nextAutoSyncAt: null })).toBe('Mailbox: Community sync needs attention');
        expect(mailboxTooltip({ visible: true, answer: answer({ desk_lamp_invites: 1 }), error: null, sync, nextAutoSyncAt: null }))
            .toBe('Mailbox: a Desk Lamp invite waiting · Community sync needs attention');
        expect(mailboxTooltip({ visible: true, answer: null, error: null, sync, nextAutoSyncAt: null })).toBe('Mailbox: Community sync needs attention');
        expect(mailboxTooltip({ visible: true, answer: EMPTY, error: null, sync: { status: 'healthy', syncedAt: NOW }, nextAutoSyncAt: null })).toBe('Mailbox: nothing new');
    });

    describe('next automatic sync', () => {
        const HOUR = 60 * MIN;
        // Local times: the tooltip shows the author's clock.
        const start = new Date(2026, 10, 7, 9, 45).getTime(); // interval registered 9:45 AM
        const at = (hours: number, minutes = 0) => new Date(2026, 10, 7, hours, minutes).getTime();

        it('runs every 6 hours from when the interval was registered', () => {
            expect(COMMUNITY_AUTO_SYNC_INTERVAL_MS).toBe(6 * HOUR);
        });

        it('lands on the coming tick just before one, and on the following tick at or just after one', () => {
            expect(nextAutoSyncAt(start, start + 6 * HOUR - 1)).toBe(start + 6 * HOUR);
            expect(nextAutoSyncAt(start, start + 6 * HOUR)).toBe(start + 12 * HOUR);
            expect(nextAutoSyncAt(start, start + 6 * HOUR + 1)).toBe(start + 12 * HOUR);
            expect(nextAutoSyncAt(start, start)).toBe(start + 6 * HOUR);
            expect(nextAutoSyncAt(start, start - HOUR)).toBe(start + 6 * HOUR);
        });

        it('carries across midnight and then shows the date', () => {
            const lateEvening = at(21, 46); // just after the 9:45 PM tick
            const next = nextAutoSyncAt(start, lateEvening);
            expect(next).toBe(new Date(2026, 10, 8, 3, 45).getTime());
            expect(formatAutoSyncTime(next, lateEvening)).toMatch(/^Nov 8, 3:45\sAM$/);
            expect(formatAutoSyncTime(at(15, 45), at(13, 0))).toMatch(/^3:45\sPM$/);
        });

        it('says clicking syncs now and when the next automatic sync is due, reason first when it failed', () => {
            const now = at(13, 0);
            const next = at(15, 45);
            expect(communitySyncTooltip({ status: 'healthy', syncedAt: now - 5 * MIN }, next, now))
                .toMatch(/^Click to sync now\. Next automatic sync about 3:45\sPM\.$/);
            expect(communitySyncTooltip({ status: 'overdue', syncedAt: null }, next, now))
                .toMatch(/^Click to sync now\. Next automatic sync about 3:45\sPM\.$/);
            expect(communitySyncTooltip({ status: 'failed', error: 'Could not reach the Community website.' }, next, now))
                .toMatch(/^Couldn't sync with Community \(Could not reach the Community website\.\)\. Click to sync now\. Next automatic sync about 3:45\sPM\.$/);
            expect(communitySyncTooltip({ status: 'pending' }, null, now)).toBe('Click to sync now.');
            expect(communitySyncTooltip({ status: 'syncing' }, next, now)).toBeNull();
        });

        it('reads the interval start from the plugin, and gives no time before layout-ready', () => {
            const plugin = connectedPlugin() as ReturnType<typeof connectedPlugin> & { communitySyncIntervalStartedAt?: number | null };
            const mailbox = new CommunityMailbox(plugin as never);
            expect(mailbox.view().nextAutoSyncAt).toBeNull();
            const startedAt = Date.now() - 1000;
            plugin.communitySyncIntervalStartedAt = startedAt;
            expect(mailbox.view().nextAutoSyncAt).toBe(startedAt + COMMUNITY_AUTO_SYNC_INTERVAL_MS);
            mailbox.destroy();
        });

        describe('with native menus (no icon, no tooltip)', () => {
            const now = at(13, 0);
            const next = at(15, 45);

            it('puts the action and the next sync time in the row text', () => {
                expect(communitySyncNativeText({ status: 'healthy', syncedAt: now - 10e3 }, next, now))
                    .toMatch(/^Last synced with Community just now · click to sync · next about 3:45\sPM$/);
                expect(communitySyncNativeText({ status: 'overdue', syncedAt: now - 8 * 24 * HOUR }, next, now))
                    .toMatch(/^Last synced with Community 8 days ago · click to sync · next about 3:45\sPM$/);
                expect(communitySyncNativeText({ status: 'pending' }, null, now)).toBe('Not synced with Community yet · click to sync');
                expect(communitySyncNativeText({ status: 'syncing' }, next, now)).toBe('Syncing with Community…');
            });

            it('keeps a failure\'s reason first', () => {
                expect(communitySyncNativeText({ status: 'failed', error: 'Could not reach the Community website.' }, next, now))
                    .toMatch(/^Couldn't sync with Community \(Could not reach the Community website\.\) · click to sync · next about 3:45\sPM$/);
            });

            it('shows counts as text, since the styled badge does not render', () => {
                expect(nativeMenuEntryTitle({ label: 'Requests', icon: 'mail', url: 'u', badge: { tone: 'new', count: 2 } })).toBe('Requests (2)');
                expect(nativeMenuEntryTitle({ label: 'Support inbox', icon: 'inbox', url: 'u', badge: { tone: 'unread', count: 140 } })).toBe('Support inbox (99+)');
                expect(nativeMenuEntryTitle({ label: 'Requests', icon: 'mail', url: 'u', badge: null })).toBe('Requests');
            });

            it('reads Obsidian\'s Native menus setting on desktop only', () => {
                const app = (value: unknown) => ({ vault: { getConfig: (key: string) => (key === 'nativeMenus' ? value : undefined) } }) as never;
                const platform = Platform as unknown as { isDesktopApp?: boolean };
                const was = platform.isDesktopApp;
                try {
                    platform.isDesktopApp = true;
                    expect(usesNativeMenus(app(true))).toBe(true);
                    expect(usesNativeMenus(app(false))).toBe(false);
                    expect(usesNativeMenus({ vault: {} } as never)).toBe(false);
                    platform.isDesktopApp = false;
                    expect(usesNativeMenus(app(true))).toBe(false);
                } finally {
                    platform.isDesktopApp = was;
                }
            });
        });
    });

    describe('Sync now', () => {
        const syncMock = vi.mocked(syncCommunityProjects);
        beforeEach(() => {
            fetchMock.mockReset();
            syncMock.mockReset();
            fetchMock.mockResolvedValue(EMPTY);
        });

        it('shows syncing while the sync is out, then repaints from the record it leaves', async () => {
            let finish!: () => void;
            const plugin = connectedPlugin();
            syncMock.mockImplementation(() => new Promise(resolve => {
                finish = () => {
                    plugin.settings.communityShare.connection.bookListSyncedAt = new Date().toISOString();
                    resolve({ ok: true, created: 0, updated: 1, projects: [] });
                };
            }));
            const mailbox = new CommunityMailbox(plugin as never);
            const painted = vi.fn();
            mailbox.subscribe(painted);

            const done = mailbox.syncNow();
            expect(mailbox.view().sync).toEqual({ status: 'syncing' });
            expect(communitySyncRow({ status: 'syncing' }, NOW)).toEqual({ text: 'Syncing with Community…', warning: false, canSync: false });
            void mailbox.syncNow(); // a second click while one is out does nothing
            expect(syncMock).toHaveBeenCalledTimes(1);

            finish();
            await done;
            expect(mailbox.view().sync?.status).toBe('healthy');
            expect(painted.mock.calls.length).toBeGreaterThanOrEqual(2);
            mailbox.destroy();
        });

        it('repaints when a settings save changes the sync record on the same connection', () => {
            const plugin = connectedPlugin();
            const mailbox = new CommunityMailbox(plugin as never);
            const painted = vi.fn();
            mailbox.subscribe(painted);
            painted.mockClear();

            mailbox.settingsChanged(); // nothing changed
            expect(painted).not.toHaveBeenCalled();

            plugin.settings.communityShare.connection.bookListSyncError = 'Could not reach the Community website.';
            plugin.settings.communityShare.connection.bookListSyncFailedAt = new Date().toISOString();
            mailbox.settingsChanged();
            expect(painted).toHaveBeenCalledTimes(1);
            expect(mailbox.view().sync?.status).toBe('failed');
            mailbox.destroy();
        });

        it('leaves the row out with no books, and repaints with it when the first book arrives', () => {
            const plugin = connectedPlugin({ books: [] });
            plugin.settings.communityShare.connection.connectedAt = new Date(Date.now() - 30 * DAY).toISOString();
            const mailbox = new CommunityMailbox(plugin as never);
            const painted = vi.fn();
            mailbox.subscribe(painted);
            painted.mockClear();
            expect(mailbox.view().sync).toBeNull();

            plugin.settings.books = [{ id: 'book-1' }];
            mailbox.settingsChanged();
            expect(painted).toHaveBeenCalledTimes(1);
            expect(mailbox.view().sync?.status).toBe('overdue');
            mailbox.destroy();
        });
    });
});
