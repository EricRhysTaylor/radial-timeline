import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./communityShareClient', () => ({
    syncDeskLamps: vi.fn()
}));

import { syncDeskLamps, type DeskLampsAnswer, type LitDeskLamp } from './communityShareClient';
import { buildDefaultCommunityShareSettings, normalizeCommunityShareSettings } from './communityShareSettings';
import {
    DeskLamps,
    deskLampList,
    deskLampRowLabel,
    deskLampsTooltip,
    formatLampDuration,
    joinFirstNames,
    nextDeskLampBulletins,
    ownDeskLampLine,
    sessionDeskLampLine
} from './deskLamps';
import type { ActiveWritingSession } from '../types/settings';

const MAYA = '11111111-1111-4111-8111-111111111111';
const PRIYA = '22222222-2222-4222-8222-222222222222';
const THEO = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const MIN = 60e3;

function lit(id: string, name: string, minutesAgo: number, patch: Partial<LitDeskLamp> = {}): LitDeskLamp {
    return {
        profile_id: id,
        handle: name.toLowerCase().split(' ')[0],
        display_name: name,
        place: 'Portland',
        state: 'lit',
        mode: 'drafting',
        lit_at: new Date(NOW - minutesAgo * MIN).toISOString().replace('.000Z', 'Z'),
        ...patch
    };
}

const EMPTY: DeskLampsAnswer = { ok: true, light: null, lamps: [], lit: [], invites_received: 0 };
const FRIENDS = [
    { profile_id: MAYA, handle: 'maya', display_name: 'Maya Chen' },
    { profile_id: PRIYA, handle: 'priya', display_name: 'Priya Nair' },
    { profile_id: THEO, handle: 'theo', display_name: 'Theo Brand' }
];
const answer = (patch: Partial<DeskLampsAnswer>): DeskLampsAnswer => ({ ...EMPTY, ...patch });

describe('the living list (D15)', () => {
    it('formats time at 5-minute precision, "just started" under 5', () => {
        expect(formatLampDuration(4 * MIN + 59e3)).toBeNull();
        expect(formatLampDuration(5 * MIN)).toBe('5 min');
        expect(formatLampDuration(49 * MIN)).toBe('45 min');
        expect(formatLampDuration(70 * MIN)).toBe('1 h 10 min');
        expect(formatLampDuration(120 * MIN)).toBe('2 h');
    });

    it('reads like the plan: name · place · mode · time, breaks and bulletins', () => {
        expect(deskLampRowLabel({ kind: 'lamp', at: 0, lamp: lit(MAYA, 'Maya Chen', 45) }, NOW)).toBe('Maya Chen · Portland · Drafting · 45 min');
        expect(deskLampRowLabel({ kind: 'lamp', at: 0, lamp: lit(MAYA, 'Maya Chen', 2, { place: null }) }, NOW)).toBe('Maya Chen · Drafting · just started');
        expect(deskLampRowLabel({ kind: 'lamp', at: 0, lamp: lit(THEO, 'Theo Brand', 90, { state: 'break', mode: 'planning', place: 'Lisbon' }) }, NOW))
            .toBe('Theo Brand · Lisbon · Planning · on a break');
        expect(deskLampRowLabel({
            kind: 'bulletin', at: NOW,
            bulletin: { profile_id: MAYA, handle: 'maya', display_name: 'Maya Chen', place: 'Portland', off_at: NOW, on_for_ms: 130 * MIN }
        }, NOW)).toBe('Maya Chen · Portland · lamp off after 2 h 10 min');
    });

    it('turns a lamp that went off since a recent check into a bulletin, and only then', () => {
        const previous = { lit: [lit(MAYA, 'Maya Chen', 130), lit(PRIYA, 'Priya Nair', 30)], at: NOW - MIN };
        const bulletins = nextDeskLampBulletins(previous, [lit(PRIYA, 'Priya Nair', 31)], [], NOW);
        expect(bulletins).toEqual([{ profile_id: MAYA, handle: 'maya', display_name: 'Maya Chen', place: 'Portland', off_at: NOW, on_for_ms: 130 * MIN }]);
        // A check 10 minutes or more ago says nothing about "just now".
        expect(nextDeskLampBulletins({ ...previous, at: NOW - 10 * MIN }, [], [], NOW)).toEqual([]);
        // Bulletins last 30 minutes, and go when the lamp comes back on.
        expect(nextDeskLampBulletins(null, [], bulletins, NOW + 29 * MIN)).toHaveLength(1);
        expect(nextDeskLampBulletins(null, [], bulletins, NOW + 30 * MIN)).toEqual([]);
        expect(nextDeskLampBulletins(null, [lit(MAYA, 'Maya Chen', 0)], bulletins, NOW + MIN)).toEqual([]);
    });

    it('sorts by freshest change, shows 12 rows and counts the lamps below the fold', () => {
        const lamps = Array.from({ length: 17 }, (_, i) => lit(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, `Writer ${i}`, 10 + i * 10));
        const bulletin = { profile_id: MAYA, handle: 'maya', display_name: 'Maya Chen', place: 'Portland', off_at: NOW - MIN, on_for_ms: 130 * MIN };
        const list = deskLampList(lamps, [bulletin], NOW);
        expect(list.rows).toHaveLength(12);
        expect(list.rows[0]).toMatchObject({ kind: 'bulletin' });
        expect(list.rows[1]).toMatchObject({ kind: 'lamp', lamp: { display_name: 'Writer 0' } });
        expect(list.hiddenLamps).toBe(6);
        expect(deskLampList(lamps, [bulletin], NOW, Number.POSITIVE_INFINITY).rows).toHaveLength(18);
    });

    it('counts only lit lamps on the badge, and says why a check failed', () => {
        const view = {
            visible: true,
            answer: answer({ lit: [lit(MAYA, 'Maya Chen', 5), lit(THEO, 'Theo Brand', 5, { state: 'break' })], invites_received: 1 }),
            error: null,
            bulletins: [],
            own: { kind: 'no_session' as const }
        };
        expect(deskLampsTooltip(view)).toBe('Desk Lamps: 1 friend at their desk · 1 Desk Lamp invite waiting');
        expect(deskLampsTooltip({ ...view, error: 'Network down' })).toBe("Desk Lamps: couldn't check (Network down).");
    });

    it('names your own lamp by first names', () => {
        expect(joinFirstNames(['Maya Chen', 'Priya Nair'])).toBe('Maya and Priya');
        expect(joinFirstNames(['Maya Chen', 'Priya Nair', 'Theo Brand', 'Ada Osei', 'Jun Park'])).toBe('Maya, Priya and 3 others');
        expect(ownDeskLampLine({ kind: 'no_session' })).toBe('Your lamp is off. Start a session to light it.');
        expect(ownDeskLampLine({ kind: 'on', state: 'lit', names: ['Maya Chen', 'Priya Nair'], count: 2 })).toBe('Your lamp is lit for Maya and Priya.');
        expect(ownDeskLampLine({ kind: 'on', state: 'break', names: ['Maya Chen'], count: 1 })).toBe('Maya sees you on a break.');
        expect(sessionDeskLampLine({ kind: 'on', state: 'lit', names: ['Maya Chen', 'Priya Nair'], count: 2 })).toBe('Lamp lit for Maya and Priya');
        expect(sessionDeskLampLine({ kind: 'on', state: 'lit', names: [], count: 2 })).toBe('Lamp lit for 2 Desk Lamps');
        expect(sessionDeskLampLine({ kind: 'no_session' })).toBeNull();
    });
});

describe('DeskLamps', () => {
    const syncMock = vi.mocked(syncDeskLamps);
    let focused = true;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        syncMock.mockReset();
        syncMock.mockResolvedValue(answer({ lamps: FRIENDS }));
        focused = true;
        vi.stubGlobal('activeDocument', { hasFocus: () => focused });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function session(patch: Partial<ActiveWritingSession> = {}): ActiveWritingSession {
        return {
            id: 'session-1',
            bookTitle: 'Secret Book',
            mode: 'drafting',
            stage: 'Zero',
            startedAt: '2026-10-04T11:47:00.000Z',
            lastResumedAt: '2026-10-04T11:47:00.000Z',
            elapsedMsBeforePause: 0,
            ...patch
        };
    }

    function harness(options: { connected?: boolean; toggle?: boolean; enabled?: boolean } = {}) {
        let active: ActiveWritingSession | undefined;
        const communityShare = buildDefaultCommunityShareSettings();
        // Private level by default: Desk Lamps needs a connection, not a level.
        communityShare.enabled = options.enabled === true;
        if (options.connected !== false) {
            communityShare.connection = {
                status: 'connected',
                connectionId: 'conn-1',
                profileId: 'profile-1',
                projectId: null,
                secretId: 'rt.community-share.connection-secret'
            };
        }
        const plugin = {
            settings: { showDeskLamps: options.toggle, communityShare },
            getWritingSessionService: () => ({ getActiveSession: () => active }),
            saveSettings: vi.fn(async () => { deskLamps.settingsChanged(); })
        };
        const deskLamps = new DeskLamps(plugin as never);
        return {
            plugin,
            deskLamps,
            setSession(next: ActiveWritingSession | undefined) {
                active = next;
                deskLamps.settingsChanged(); // the session service saves settings on every change
            }
        };
    }

    const sentLights = () => syncMock.mock.calls.map(call => call.length > 1 ? call[1] : 'read');

    it('never calls, and stays hidden, unless connected with the toggle on', async () => {
        for (const options of [{ connected: false }, { toggle: false }]) {
            const { deskLamps } = harness(options);
            deskLamps.subscribe(() => {});
            await vi.runOnlyPendingTimersAsync();
            expect(deskLamps.view().visible).toBe(false);
            expect(deskLamps.panelFriends()).toEqual([]);
        }
        expect(syncMock).not.toHaveBeenCalled();
    });

    it('works at the Private level and shows once there is a Desk Lamp or an invite (D12, D14)', async () => {
        const { deskLamps } = harness();
        deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(deskLamps.view().visible).toBe(true));
        expect(sentLights()).toEqual([undefined]);

        syncMock.mockResolvedValue(EMPTY);
        await vi.advanceTimersByTimeAsync(61e3);
        expect(deskLamps.view().visible).toBe(false);
    });

    it('lights only for a session shared by choice, then sends only real changes', async () => {
        const { deskLamps, setSession } = harness();
        deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

        // Started without ticking anyone: no lamp.
        setSession(session());
        await deskLamps.shareSession('session-1', []);
        expect(syncMock).toHaveBeenCalledTimes(1);

        // Ticked: lit at once, start floored to 5 minutes.
        await deskLamps.shareSession('session-1', [MAYA, PRIYA]);
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2));
        expect(sentLights()[1]).toEqual({ state: 'lit', mode: 'drafting', lit_at: '2026-10-04T11:45:00.000Z', audience: [MAYA, PRIYA] });
        expect(deskLamps.view().own).toEqual({ kind: 'on', state: 'lit', names: ['Maya Chen', 'Priya Nair'], count: 2 });

        // The idle auto-pause changes nothing a friend sees: no call.
        setSession(session({ pausedAt: '2026-10-04T11:58:00.000Z', idleAuto: true }));
        await vi.advanceTimersByTimeAsync(10e3);
        expect(syncMock).toHaveBeenCalledTimes(2);

        // A manual pause is "on a break", sent at once.
        setSession(session({ pausedAt: '2026-10-04T11:58:00.000Z', idleAuto: false }));
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(3));
        expect(sentLights()[2]).toMatchObject({ state: 'break' });

        // Save or discard: the lamp goes off.
        setSession(undefined);
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(4));
        expect(sentLights()[3]).toBeNull();
    });

    it('refreshes a lit lamp every minute whatever view shows, and stops when it goes off', async () => {
        const { deskLamps, setSession } = harness();
        setSession(session());
        await deskLamps.shareSession('session-1', [MAYA]);
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
        focused = false; // no view, no focus: a lit lamp still refreshes
        await vi.advanceTimersByTimeAsync(3 * 61e3);
        expect(syncMock).toHaveBeenCalledTimes(4);
        expect(sentLights().every(light => light && typeof light === 'object')).toBe(true);

        await deskLamps.setSessionAudience([]);
        await vi.waitFor(() => expect(sentLights().at(-1)).toBeNull());
        const calls = syncMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(3 * 60 * 60e3);
        expect(syncMock).toHaveBeenCalledTimes(calls);
    });

    it('with the lamp off, reads every minute only while a view shows and the window has focus', async () => {
        const { deskLamps } = harness();
        const unsubscribe = deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(61e3);
        expect(syncMock).toHaveBeenCalledTimes(2);
        focused = false;
        await vi.advanceTimersByTimeAsync(5 * 61e3);
        expect(syncMock).toHaveBeenCalledTimes(2);
        focused = true;
        unsubscribe();
        await vi.advanceTimersByTimeAsync(5 * 61e3);
        expect(syncMock).toHaveBeenCalledTimes(2);
    });

    it('before the first Desk Lamp, reads on the Mailbox schedule', async () => {
        syncMock.mockResolvedValue(answer({ invites_received: 1 }));
        const { deskLamps } = harness();
        deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(30 * 60e3);
        expect(syncMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(36 * 60e3);
        expect(syncMock).toHaveBeenCalledTimes(2);
    });

    it('pausing sharing turns the lamp off; friends stay visible (D12)', async () => {
        const { deskLamps, plugin, setSession } = harness();
        deskLamps.subscribe(() => {});
        setSession(session());
        await deskLamps.shareSession('session-1', [MAYA]);
        await vi.waitFor(() => expect(sentLights().some(light => light && typeof light === 'object')).toBe(true));
        plugin.settings.communityShare = normalizeCommunityShareSettings({ ...plugin.settings.communityShare, sharingPaused: true });
        deskLamps.settingsChanged();
        await vi.waitFor(() => expect(sentLights().at(-1)).toBeNull());
        expect(deskLamps.view()).toMatchObject({ visible: true, own: { kind: 'sharing_paused' } });
    });

    it('turning Desk Lamps off here turns a lit lamp off, hides it, and stops checking', async () => {
        const { deskLamps, plugin, setSession } = harness();
        deskLamps.subscribe(() => {});
        setSession(session());
        await deskLamps.shareSession('session-1', [MAYA]);
        await vi.waitFor(() => expect(syncMock.mock.calls.length).toBeGreaterThanOrEqual(2));
        plugin.settings.showDeskLamps = false;
        deskLamps.settingsChanged();
        await vi.waitFor(() => expect(sentLights().at(-1)).toBeNull());
        expect(deskLamps.view().visible).toBe(false);
        const calls = syncMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(2 * 60 * 60e3);
        expect(syncMock).toHaveBeenCalledTimes(calls);
    });

    it('ignores choices made for another profile', async () => {
        const { deskLamps, plugin, setSession } = harness();
        plugin.settings.communityShare.deskLamps = { profileId: 'someone-else', audience: [MAYA], activeSessionId: 'session-1' };
        setSession(session());
        await vi.advanceTimersByTimeAsync(2 * 61e3);
        expect(syncMock).not.toHaveBeenCalled();
        expect(deskLamps.rememberedAudience()).toEqual([]);
    });

    it('keeps the button and the friends through a failed check, without a count', async () => {
        const { deskLamps } = harness();
        syncMock.mockResolvedValueOnce(answer({ lamps: FRIENDS, lit: [lit(MAYA, 'Maya Chen', 20)] }));
        deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(deskLamps.view().visible).toBe(true));
        syncMock.mockRejectedValueOnce(new Error('Could not check Desk Lamps.'));
        await vi.advanceTimersByTimeAsync(61e3);
        expect(deskLamps.view()).toMatchObject({ visible: true, error: 'Could not check Desk Lamps.' });
        expect(deskLamps.panelFriends()).toHaveLength(3);
    });

    it('makes a bulletin when a friend turns their lamp off between minute checks', async () => {
        const { deskLamps } = harness();
        syncMock.mockResolvedValueOnce(answer({ lamps: FRIENDS, lit: [lit(MAYA, 'Maya Chen', 130)] }));
        deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(deskLamps.view().answer?.lit).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(61e3);
        expect(deskLamps.view().bulletins).toMatchObject([{ profile_id: MAYA, display_name: 'Maya Chen' }]);
    });

    it('turns a lit lamp off on unload, best effort', async () => {
        const { deskLamps, setSession } = harness();
        setSession(session());
        await deskLamps.shareSession('session-1', [MAYA]);
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
        deskLamps.destroy();
        expect(sentLights().at(-1)).toBeNull();
    });

    it('orders the session panel: last ticked first, then by name', async () => {
        const { deskLamps, setSession } = harness();
        deskLamps.subscribe(() => {});
        await vi.waitFor(() => expect(deskLamps.panelFriends()).toHaveLength(3));
        setSession(session());
        await deskLamps.shareSession('session-1', [THEO]);
        expect(deskLamps.panelFriends().map(friend => friend.display_name)).toEqual(['Theo Brand', 'Maya Chen', 'Priya Nair']);
        expect(deskLamps.rememberedAudience()).toEqual([THEO]);
    });
});
