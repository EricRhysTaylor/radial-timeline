import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./communityShareClient', () => ({
    fetchCommunityMailbox: vi.fn()
}));

import { fetchCommunityMailbox, type CommunityMailboxAnswer } from './communityShareClient';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import {
    COMMUNITY_DESK_LAMPS_URL,
    COMMUNITY_SITE_URL,
    CommunityMailbox,
    mailboxBadge,
    mailboxMenuEntries,
    mailboxTooltip
} from './communityMailbox';

const QUESTION = '55555555-5555-4555-8555-555555555555';
const EMPTY: CommunityMailboxAnswer = { ok: true, support_unread: 0, replies: { count: 0, latest_post_id: null }, desk_lamp_invites: 0, admin: null };
const answer = (patch: Partial<CommunityMailboxAnswer>): CommunityMailboxAnswer => ({ ...EMPTY, ...patch });

const fetchMock = vi.mocked(fetchCommunityMailbox);

function connectedPlugin(options: { toggle?: boolean; connected?: boolean } = {}) {
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
    return { settings: { showCommunityMailbox: options.toggle, communityShare } };
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
            { label: 'Desk Lamp invites', icon: 'lamp-desk', url: COMMUNITY_DESK_LAMPS_URL, badge: { tone: 'new', count: 2 } }
        ]);
        expect(COMMUNITY_DESK_LAMPS_URL).toBe(`${COMMUNITY_SITE_URL}/me#desk-lamps`);
        expect(mailboxTooltip({ visible: true, answer: answer({ desk_lamp_invites: 1 }), error: null })).toBe('Mailbox: a Desk Lamp invite waiting');
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
        expect(mailboxTooltip({ visible: true, answer: answer({ admin: { unread: 2, awaiting: 3 }, support_unread: 1 }), error: null }))
            .toBe('Mailbox: 2 unread in the support inbox · a new reply in Requests');
        expect(mailboxTooltip({ visible: true, answer: answer({ support_unread: 2, replies: { count: 3, latest_post_id: QUESTION } }), error: null }))
            .toBe('Mailbox: new replies on 2 requests · new replies to 3 of your questions');
        expect(mailboxTooltip({ visible: true, answer: EMPTY, error: null })).toBe('Mailbox: nothing new');
        expect(mailboxTooltip({ visible: true, answer: null, error: 'This connection has been disconnected.' }))
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

    it('checks when the first view subscribes, then hourly while one stays open', async () => {
        fetchMock.mockResolvedValue(answer({ support_unread: 1 }));
        const mailbox = new CommunityMailbox(connectedPlugin() as never);
        const painted = vi.fn();
        const unsubscribe = mailbox.subscribe(painted);
        await vi.waitFor(() => expect(painted).toHaveBeenCalled());
        expect(mailbox.view()).toEqual({ visible: true, answer: answer({ support_unread: 1 }), error: null });
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
        expect(mailbox.view()).toEqual({ visible: false, answer: null, error: null });

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
        await vi.waitFor(() => expect(mailbox.view()).toEqual({ visible: true, answer: EMPTY, error: null }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
