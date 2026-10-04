import { describe, expect, it } from 'vitest';
import {
    buildCommunityShareFieldPolicyForMode,
    buildCommunityShareModeUpdate,
    buildDefaultCommunityShareSettings,
    canShareAprToCommunity,
    deriveCommunityShareMode,
    deskLampChoices,
    hasActiveCommunityConnection,
    hasCommunityConnection,
    normalizeCommunityShareSettings
} from './communityShareSettings';

describe('Community Share settings', () => {
    it('defaults to fully off and public-safe launch guardrails', () => {
        const settings = buildDefaultCommunityShareSettings();

        expect(settings.enabled).toBe(false);
        expect(settings.tier).toBe(0);
        expect(settings.audience).toBe('private_draft');
        expect(settings.manualPublishEnabled).toBe(true);
        expect(settings.scheduledPublishEnabled).toBe(false);
        expect(settings.workingNowEnabled).toBe(false);
        expect(settings.connection.status).toBe('disconnected');
        expect(settings.preview.status).toBe('not_generated');
        expect(Object.values(settings.fieldPolicy).every(value => value === false)).toBe(true);
    });

    it('normalizes future launch fields back off and keeps the standing share state', () => {
        const settings = normalizeCommunityShareSettings({
            enabled: true,
            tier: 5,
            audience: 'followers',
            scheduledPublishEnabled: true,
            workingNowEnabled: true,
            fieldPolicy: {
                ...buildDefaultCommunityShareSettings().fieldPolicy,
                'project.title': true,
                'activity.exact_session_timestamps': true
            }
        });

        expect(settings.enabled).toBe(true);
        // Persisted tier 5 clamps to the highest publishable tier (4) so it can
        // never silently lock publishing; see the dedicated clamp test below.
        expect(settings.tier).toBe(4);
        expect(settings.audience).toBe('followers');
        // Standing share (contract amendment 2026-07-03): scheduledPublishEnabled
        // is the persisted sharing-on state and must round-trip.
        expect(settings.scheduledPublishEnabled).toBe(true);
        expect(settings.workingNowEnabled).toBe(false);
        expect(settings.fieldPolicy['project.title']).toBe(true);
        expect(settings.fieldPolicy['activity.exact_session_timestamps']).toBe(true);
    });

    it('clamps a persisted tier 5 to 4 so publishing is never silently locked', () => {
        // Nothing produces tier 5 and publish requires tier <= 4, so a stray 5
        // must not strand the vault in a permanent publish_locked state.
        const clamped = normalizeCommunityShareSettings({ enabled: true, tier: 5 });
        expect(clamped.tier).toBe(4);
        // Still maps to the progress mode (tier >= 3) rather than falling back
        // to private, so the author keeps the sharing level they chose.
        expect(deriveCommunityShareMode(clamped)).toBe('progress');
    });

    it('coerces an out-of-range tier back to private', () => {
        expect(normalizeCommunityShareSettings({ enabled: true, tier: 9 as never }).tier).toBe(0);
        expect(normalizeCommunityShareSettings({ enabled: true, tier: -1 as never }).tier).toBe(0);
    });

    it('defaults the standing share state off when absent', () => {
        const settings = normalizeCommunityShareSettings({ enabled: true, tier: 2 });
        expect(settings.scheduledPublishEnabled).toBe(false);
    });

    it('clips publish history to a small local audit tail', () => {
        const history = Array.from({ length: 30 }, (_, index) => ({
            id: `entry-${index}`,
            action: 'publish' as const,
            status: 'success' as const,
            at: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
        }));

        const settings = normalizeCommunityShareSettings({ publishHistory: history });

        expect(settings.publishHistory).toHaveLength(25);
        expect(settings.publishHistory[0]?.id).toBe('entry-5');
        expect(settings.publishHistory[24]?.id).toBe('entry-29');
    });

    it('maps sharing modes to launch-safe tier, audience, and field bundles', () => {
        const privateUpdate = buildCommunityShareModeUpdate('private');
        expect(privateUpdate.enabled).toBe(false);
        expect(privateUpdate.tier).toBe(0);
        expect(privateUpdate.audience).toBe('private_draft');
        expect(Object.values(privateUpdate.fieldPolicy ?? {}).every(value => value === false)).toBe(true);

        const booksUpdate = buildCommunityShareModeUpdate('profile_books');
        expect(booksUpdate.enabled).toBe(true);
        expect(booksUpdate.tier).toBe(2);
        expect(booksUpdate.audience).toBe('public');
        expect(booksUpdate.fieldPolicy?.['project.title']).toBe(true);
        expect(booksUpdate.fieldPolicy?.['activity.words_added']).toBe(false);

        const progressUpdate = buildCommunityShareModeUpdate('progress');
        expect(progressUpdate.tier).toBe(4);
        expect(progressUpdate.fieldPolicy?.['project.title']).toBe(true);
        expect(progressUpdate.fieldPolicy?.['activity.words_added']).toBe(true);
        expect(progressUpdate.fieldPolicy?.['activity.streak']).toBe(true);
    });

    it('never enables sensitive structure fields in any mode bundle', () => {
        for (const mode of ['private', 'profile_books', 'progress'] as const) {
            const policy = buildCommunityShareFieldPolicyForMode(mode);
            expect(policy['structure.real_scene_titles']).toBe(false);
            expect(policy['activity.exact_session_timestamps']).toBe(false);
        }
    });

    it('allows the separate APR artifact from Profile + books upward, never while private', () => {
        const base = buildDefaultCommunityShareSettings();
        const connection = { status: 'connected' as const, connectionId: 'connection-1' };

        expect(canShareAprToCommunity(normalizeCommunityShareSettings({
            ...base,
            ...buildCommunityShareModeUpdate('private'),
            connection
        }))).toBe(false);
        expect(canShareAprToCommunity(normalizeCommunityShareSettings({
            ...base,
            ...buildCommunityShareModeUpdate('profile_books'),
            connection
        }))).toBe(true);
        expect(canShareAprToCommunity(normalizeCommunityShareSettings({
            ...base,
            ...buildCommunityShareModeUpdate('progress'),
            connection
        }))).toBe(true);
    });

    it('derives the sharing mode from stored tier and enabled state', () => {
        expect(deriveCommunityShareMode(buildDefaultCommunityShareSettings())).toBe('private');
        expect(deriveCommunityShareMode(normalizeCommunityShareSettings({ enabled: true, tier: 0 }))).toBe('private');
        expect(deriveCommunityShareMode(normalizeCommunityShareSettings({ enabled: false, tier: 4 }))).toBe('private');
        expect(deriveCommunityShareMode(normalizeCommunityShareSettings({ enabled: true, tier: 1 }))).toBe('profile_books');
        expect(deriveCommunityShareMode(normalizeCommunityShareSettings({ enabled: true, tier: 2 }))).toBe('profile_books');
        expect(deriveCommunityShareMode(normalizeCommunityShareSettings({ enabled: true, tier: 3 }))).toBe('progress');
        expect(deriveCommunityShareMode(normalizeCommunityShareSettings({ enabled: true, tier: 5 }))).toBe('progress');
    });
});

describe('hasActiveCommunityConnection', () => {
    const connected = () => normalizeCommunityShareSettings({
        enabled: true,
        connection: { status: 'connected', connectionId: 'conn-1', secretId: 'rt.community-share.connection-secret' }
    });

    it('is true only with Community on, connected, and both ids present', () => {
        expect(hasActiveCommunityConnection(connected())).toBe(true);
        expect(hasActiveCommunityConnection({ ...connected(), enabled: false })).toBe(false);
        expect(hasActiveCommunityConnection({ ...connected(), connection: { ...connected().connection, status: 'disconnected' } })).toBe(false);
        expect(hasActiveCommunityConnection({ ...connected(), connection: { ...connected().connection, connectionId: undefined } })).toBe(false);
        expect(hasActiveCommunityConnection({ ...connected(), connection: { ...connected().connection, secretId: undefined } })).toBe(false);
        expect(hasActiveCommunityConnection(buildDefaultCommunityShareSettings())).toBe(false);
    });

    it('ignores a paused share: pausing stops sharing, not the connection', () => {
        expect(hasActiveCommunityConnection({ ...connected(), sharingPaused: true })).toBe(true);
    });
});

describe('Desk Lamps settings', () => {
    const MAYA = '11111111-1111-4111-8111-111111111111';
    const connection = {
        status: 'connected' as const,
        connectionId: 'conn-1',
        profileId: 'profile-1',
        projectId: null,
        secretId: 'rt.community-share.connection-secret'
    };

    it('counts a connection at the Private level as connected for Desk Lamps only', () => {
        const settings = normalizeCommunityShareSettings({ enabled: false, connection });
        expect(hasCommunityConnection(settings)).toBe(true);
        expect(hasActiveCommunityConnection(settings)).toBe(false);
        expect(hasActiveCommunityConnection({ ...settings, enabled: true })).toBe(true);
        expect(hasCommunityConnection(normalizeCommunityShareSettings({ connection: { ...connection, secretId: undefined } }))).toBe(false);
    });

    it('keeps only profile ids in the audience, lowercased and de-duplicated', () => {
        const settings = normalizeCommunityShareSettings({
            connection,
            deskLamps: { profileId: 'profile-1', audience: [MAYA.toUpperCase(), MAYA, 'not-an-id', 7 as never], activeSessionId: 'session-1' }
        });
        expect(settings.deskLamps).toEqual({ profileId: 'profile-1', audience: [MAYA], activeSessionId: 'session-1' });
        expect(normalizeCommunityShareSettings({ deskLamps: { audience: [MAYA] } as never }).deskLamps).toBeUndefined();
    });

    it('ignores choices made for another profile', () => {
        const mine = normalizeCommunityShareSettings({ connection, deskLamps: { profileId: 'profile-1', audience: [MAYA], activeSessionId: 's' } });
        expect(deskLampChoices(mine)).toEqual({ audience: [MAYA], activeSessionId: 's' });
        const theirs = normalizeCommunityShareSettings({ connection, deskLamps: { profileId: 'profile-2', audience: [MAYA], activeSessionId: 's' } });
        expect(deskLampChoices(theirs)).toEqual({ audience: [] });
    });
});
