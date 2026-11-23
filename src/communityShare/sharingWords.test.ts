/**
 * Who paused what, and when: the shapes Community answers, and the words the
 * plugin shows for them (platform HANDOFF 2026-11-22, "The shapes").
 */

import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { readBookSharingState, readServerDisconnect, readSharingEvents, readVaultSharingState } from './sharingState';
import { accountPausedNote, formatCommunityDate, refusalMessage, serverDisconnectNote, sharingEventText, sharingHistoryRows } from './sharingWords';

const AT = '2026-11-22T13:20:00Z';
const date = formatCommunityDate(AT);

describe('reading Community\'s sharing state', () => {
    it('reads each part of a book\'s state, and null for what does not stand', () => {
        const state = readBookSharingState({
            vault_updates_paused: { at: AT, side: 'community', cause: 'restore' },
            timeline_updates_stopped: null,
            update_held: { at: AT },
            timeline: { status: 'private', changed_at: AT, side: 'community', cause: 'author' },
            vault_sharing_paused: { at: AT, side: 'vault' },
            account_paused: null,
            history: [{ event: 'vault_updates_paused', side: 'community', at: AT, cause: 'restore', project_id: 'p', scene_title: null }],
        });
        expect(state).toEqual({
            vaultUpdatesPaused: { at: AT, side: 'community', cause: 'restore' },
            timelineUpdatesStopped: null,
            updateHeld: { at: AT },
            timeline: { status: 'private', changedAt: AT, side: 'community', cause: 'author' },
            vaultSharingPaused: { at: AT, side: 'vault', cause: null },
            accountPaused: null,
            history: [{ event: 'vault_updates_paused', side: 'community', at: AT, cause: 'restore', sceneTitle: null }],
        });
        expect(readBookSharingState(undefined)).toBeNull();
        expect(readVaultSharingState({ sharing_paused: null, account_paused: { at: AT, side: 'moderation', cause: 'moderation' }, history: [] }))
            .toEqual({ sharingPaused: null, accountPaused: { at: AT, side: 'moderation', cause: 'moderation' }, history: [] });
    });

    it('leaves out an event it cannot read, and keeps a scene title only on a take-down', () => {
        expect(readSharingEvents([
            { event: 'something_new', side: 'vault', at: AT },
            { event: 'sharing_paused', side: 'nobody', at: AT },
            { event: 'sharing_paused', side: 'vault', at: 'not a time' },
            { event: 'sharing_resumed', side: 'vault', at: AT, scene_title: 'Ignored' },
            { event: 'scene_taken_down', side: 'community', at: AT, scene_title: 'A Reply in Bark' },
        ])).toEqual([
            { event: 'sharing_resumed', side: 'vault', at: AT, cause: null, sceneTitle: null },
            { event: 'scene_taken_down', side: 'community', at: AT, cause: null, sceneTitle: 'A Reply in Bark' },
        ]);
    });

    it('reads who disconnected a connection, and a disconnect from before the side was kept', () => {
        expect(readServerDisconnect({ disconnected_at: AT, disconnected_by: 'community', cause: 'disconnect' })).toEqual({ at: AT, by: 'community', cause: 'disconnect' });
        expect(readServerDisconnect({ disconnected_at: AT, disconnected_by: 'vault', cause: 'new_connection' })).toEqual({ at: AT, by: 'vault', cause: 'new_connection' });
        expect(readServerDisconnect({ disconnected_at: null, disconnected_by: null })).toEqual({ at: null, by: null, cause: 'disconnect' });
    });
});

describe('the words for who and when', () => {
    it('names the side of a disconnect, with the next step', () => {
        expect(serverDisconnectNote({ at: AT, by: 'community', cause: 'disconnect' })).toBe(t('ui.communitySharing.disconnectedCommunity', { date }));
        expect(serverDisconnectNote({ at: AT, by: 'vault', cause: 'disconnect' })).toBe(t('ui.communitySharing.disconnectedVault', { date }));
        expect(serverDisconnectNote({ at: AT, by: 'community', cause: 'new_connection' })).toBe(t('ui.communitySharing.disconnectedReplaced', { date }));
        expect(serverDisconnectNote({ at: AT, by: 'system', cause: 'disconnect' })).toBe(t('ui.communitySharing.disconnectedSystem', { date }));
        expect(serverDisconnectNote({ at: null, by: null, cause: 'disconnect' })).toBe(t('ui.communitySharing.disconnectedUndated'));
        expect(t('ui.communitySharing.disconnectedCommunity', { date })).toBe(`Disconnected on Community on ${date}. Connect again with a new connection code.`);
    });

    it('says who paused an account, and since when', () => {
        expect(accountPausedNote({ at: AT, cause: 'moderation' })).toBe(`Paused by Radial Timeline moderation on ${date}. To ask about it, write to community@radialtimeline.com.`);
        expect(accountPausedNote({ at: AT, cause: 'account_deletion' })).toBe(t('ui.communitySharing.accountDeletion', { date }));
    });

    it('words a refusal only when Community said when', () => {
        expect(refusalMessage('book_disconnected', { at: AT, side: 'community' })).toBe(t('ui.communitySharing.bookDisconnected', { date }));
        expect(refusalMessage('book_disconnected', undefined)).toBeNull();
        expect(refusalMessage('update_held', { held_at: AT })).toBe(t('ui.communitySharing.updateHeld', { date }));
        expect(refusalMessage('vault_updates_paused', { paused_at: AT, side: 'community', cause: 'restore' }))
            .toBe(`Paused on Community when an earlier timeline was restored, on ${date}. Resume vault updates on the book's Share page.`);
        expect(refusalMessage('connection_not_active', {})).toBeNull();
        expect(refusalMessage('server_error', { at: AT })).toBeNull();
    });

    it('lists the history newest first, take-downs by title only', () => {
        const rows = sharingHistoryRows([
            { event: 'sharing_paused', side: 'vault', at: '2026-11-20T10:00:00Z', cause: null, sceneTitle: null },
            { event: 'scene_taken_down', side: 'community', at: '2026-11-22T10:00:00Z', cause: null, sceneTitle: 'A Reply in Bark' },
            { event: 'scene_taken_down', side: 'community', at: '2026-11-22T11:00:00Z', cause: null, sceneTitle: null },
            { event: 'vault_updates_paused', side: 'community', at: '2026-11-21T10:00:00Z', cause: 'restore', sceneTitle: null },
        ]);
        expect(rows.map(row => row.text)).toEqual([
            'A Reply in Bark taken down on Community',
            'Vault updates paused on Community when an earlier timeline was restored',
            'Sharing paused in Radial Timeline',
        ]);
    });

    it('has words for every event and side Community sends', () => {
        const cases: Array<[Parameters<typeof sharingEventText>[0]['event'], Parameters<typeof sharingEventText>[0]['side'], string | null]> = [
            ['sharing_resumed', 'vault', null], ['disconnected', 'community', 'new_connection'], ['disconnected', 'vault', 'disconnect'],
            ['vault_updates_resumed', 'vault', 'transfer'], ['timeline_updates_stopped', 'vault', null], ['timeline_updates_resumed', 'vault', null],
            ['timeline_offline', 'community', 'author'], ['timeline_offline', 'community', 'account_deletion'], ['timeline_public', 'community', 'author'],
            ['book_disconnected', 'community', null], ['account_paused', 'moderation', 'moderation'], ['account_paused', 'community', 'account_deletion'],
            ['account_resumed', 'moderation', 'moderation'], ['account_resumed', 'community', 'account_deletion'],
        ];
        for (const [event, side, cause] of cases) {
            const text = sharingEventText({ event, side, at: AT, cause, sceneTitle: null });
            expect(text, `${event} ${side} ${cause}`).toBeTruthy();
            expect(text).not.toMatch(/ui\.communitySharing/);
        }
    });

    it('says the next step in its copy, never what will not happen', () => {
        for (const key of ['pausedHere', 'pausedHereUntold', 'vaultUpdatesPaused', 'vaultUpdatesPausedRestore', 'updateHeld', 'bookDisconnected', 'disconnectedCommunity', 'accountModeration', 'accountDeletion']) {
            const text = t(`ui.communitySharing.${key}`, { date });
            expect(text).not.toMatch(/\b(never|nothing|unless|won't|can't|isn't|doesn't|wheel|block|tick)\b/i);
            expect(text).not.toMatch(/deleted on the website/i);
        }
    });
});
