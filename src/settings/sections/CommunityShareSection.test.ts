/**
 * The row under the level picker says what the website shows. Choosing a
 * level sends nothing: until Begin sharing, the website keeps showing Private
 * (or the last level sent), and the row says so.
 */

import { describe, expect, it } from 'vitest';
import { buildCommunityShareModeUpdate, buildDefaultCommunityShareSettings } from '../../communityShare/communityShareSettings';
import { t } from '../../i18n';
import type { CommunityShareSettings } from '../../types/settings';
import { describeCommunitySharingState } from './CommunityShareSection';

function connected(next: Partial<CommunityShareSettings> = {}): CommunityShareSettings {
    const settings = buildDefaultCommunityShareSettings();
    return {
        ...settings,
        connection: { status: 'connected', connectionId: 'conn-1', secretId: 'secret-1' },
        ...next,
    };
}

const ready = { status: 'ready' as const, previewHash: 'preview', payloadHash: 'payload' };
const level2 = () => connected({ ...buildCommunityShareModeUpdate('profile_books'), preview: ready });

describe('the sharing level row', () => {
    it('a chosen level that was never sent reads as not sent, and the website as Private', () => {
        const state = describeCommunitySharingState(level2());
        expect(state.name).toBe(t('ui.communityShareSection.notSentName', { level: t('ui.communityShareSection.modeShortProfileBooks') }));
        expect(state.desc).toBe(t('ui.communityShareSection.notSentPrivateDesc', { level: t('ui.communityShareSection.modeShortProfileBooks') }));
        expect(state.action).toBe('begin');
        expect(state.canBegin).toBe(true);
    });

    it('after a level change over a live share, names the last shared level as what the website shows', () => {
        const settings = level2();
        settings.publishHistory = [{ id: 'p1', action: 'publish', status: 'success', at: '2026-11-18T10:00:00Z' }];
        const state = describeCommunitySharingState(settings);
        expect(state.desc).toBe(t('ui.communityShareSection.notSentLiveDesc', { level: t('ui.communityShareSection.modeShortProfileBooks') }));
        expect(state.action).toBe('begin');
    });

    it('once sent, names the level in effect on the website and offers Pause', () => {
        const settings = level2();
        settings.scheduledPublishEnabled = true;
        const state = describeCommunitySharingState(settings);
        expect(state.name).toBe(t('ui.communityShareSection.websiteLevelName', { level: t('ui.communityShareSection.modeShortProfileBooks') }));
        expect(state.desc).toBe(t('ui.communityShareSection.sharingOn'));
        expect(state.action).toBe('pause');
    });

    it('waits on the preview before Begin sharing can be pressed', () => {
        const state = describeCommunitySharingState(connected({ ...buildCommunityShareModeUpdate('progress') }));
        expect(state.action).toBe('begin');
        expect(state.canBegin).toBe(false);
        expect(state.name).toBe(t('ui.communityShareSection.notSentName', { level: t('ui.communityShareSection.modeShortProgress') }));
    });

    it('at Private, the website shows Private and the next step is choosing a level', () => {
        const state = describeCommunitySharingState(connected());
        expect(state.name).toBe(t('ui.communityShareSection.websiteLevelName', { level: t('ui.communityShareSection.modeShortPrivate') }));
        expect(state.desc).toBe(t('ui.communityShareSection.privateNextStep'));
        expect(state.canBegin).toBe(false);
    });

    it('before connecting, says the next steps and names no level', () => {
        const state = describeCommunitySharingState({ ...buildDefaultCommunityShareSettings(), ...buildCommunityShareModeUpdate('profile_books'), preview: ready });
        expect(state.name).toBeNull();
        expect(state.desc).toBe(t('ui.communityShareSection.nextSteps'));
        expect(state.canBegin).toBe(false);
    });

    it('while paused, offers Resume', () => {
        const settings = level2();
        settings.sharingPaused = true;
        const state = describeCommunitySharingState(settings);
        expect(state.action).toBe('resume');
        expect(state.name).toBe(t('ui.communityShareSection.websiteLevelPausedName'));
    });

    it('says the next step in its copy, never what will not happen', () => {
        const level = t('ui.communityShareSection.modeShortProfileBooks');
        for (const text of [
            t('ui.communityShareSection.notSentPrivateDesc', { level }),
            t('ui.communityShareSection.notSentLiveDesc', { level }),
            t('ui.communityShareSection.pausedDesc'),
            t('ui.communityShareSection.timelineDetailsDesc'),
            t('ui.communityShareSection.sceneBodyDesc'),
        ]) {
            expect(text).not.toMatch(/\b(never|nothing|unless|won't|can't)\b/i);
        }
    });
});
