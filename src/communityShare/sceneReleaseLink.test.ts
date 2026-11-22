/**
 * The Send scene link: what it accepts, and where each kind of vault is taken.
 * Pure: no Obsidian, no network.
 */

import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { BookProfile } from '../types/settings';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import {
    SCENE_RELEASE_PROTOCOL_ACTION,
    parseSceneReleaseLink,
    sceneReleaseLinkBook,
    sceneReleaseLinkGate,
    sceneReleaseLinkOpen,
} from './sceneReleaseLink';
import type { SceneTextRequest } from './sceneTextRequests';

const BOOK_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const SCENE = 'scn_0a1b2c3d';

const book = { id: 'book-1', title: 'The Long Night', sourceFolder: 'Book' } as BookProfile;
const projects = [{ id: BOOK_ID, plugin_book_key: 'book-1' }, { id: OTHER_ID, plugin_book_key: 'book-2' }];

/** A connected vault at Level 4. */
function settings(edit: (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => void = () => {}) {
    const s = buildDefaultCommunityShareSettings();
    s.enabled = true;
    s.tier = 4;
    s.audience = 'public';
    s.sceneTextLevel = true;
    s.connection = { status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: BOOK_ID, secretId: 'secret' };
    edit(s);
    return s;
}

const request: SceneTextRequest = {
    id: REQUEST_ID, scene_id: SCENE, scene_title: '1 Opening', kind: 'release', rating: 'general', audience: 'named', asked_at: '2026-11-22T10:00:00Z', expires_at: '2026-12-06T10:00:00Z', release_id: null, release_version: null,
};
const status = (extra: Record<string, unknown> = {}) => ({ project_id: BOOK_ID, standing: null, ...extra });

describe('parseSceneReleaseLink', () => {
    it('is registered under the action the website builds', () => {
        expect(SCENE_RELEASE_PROTOCOL_ACTION).toBe('radial-timeline-release');
    });

    it('reads a book, its scene and the request, lower-casing the ids', () => {
        expect(parseSceneReleaseLink({ book: BOOK_ID })).toEqual({ book: BOOK_ID });
        expect(parseSceneReleaseLink({ book: BOOK_ID.toUpperCase(), scene: SCENE, request: REQUEST_ID.toUpperCase() }))
            .toEqual({ book: BOOK_ID, scene: SCENE, request: REQUEST_ID });
    });

    it('ignores every other parameter', () => {
        expect(parseSceneReleaseLink({ book: BOOK_ID, request: REQUEST_ID, vault: 'Mine', text: 'hello' })).toEqual({ book: BOOK_ID, request: REQUEST_ID });
    });

    it.each([
        ['no book', {}],
        ['a book that is not a UUID', { book: 'The Long Night' }],
        ['a scene that is not a scene id', { book: BOOK_ID, scene: 'Opening' }],
        ['a request that is not a UUID', { book: BOOK_ID, request: 'r1' }],
    ])('refuses %s', (_label, params) => {
        expect(parseSceneReleaseLink(params as Record<string, string>)).toBeNull();
    });
});

describe('sceneReleaseLinkGate', () => {
    it('asks a vault with no connection to connect', () => {
        expect(sceneReleaseLinkGate(settings(s => { s.connection.status = 'disconnected'; })))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.connect') });
    });

    it('takes a paused vault to Settings', () => {
        expect(sceneReleaseLinkGate(settings(s => { s.sharingPaused = true; })))
            .toEqual({ kind: 'settings', text: t('ui.communityShareClient.sceneReleasePaused') });
    });

    it.each([
        ['Level 3', (s: ReturnType<typeof settings>) => { s.sceneTextLevel = false; }],
        ['Private', (s: ReturnType<typeof settings>) => { s.enabled = false; s.tier = 0; }],
    ])('takes a vault at %s to Settings to choose Level 4', (_label, edit) => {
        expect(sceneReleaseLinkGate(settings(edit)))
            .toEqual({ kind: 'settings', text: t('ui.communityShareClient.sceneReleaseLevelRequired') });
    });

    it('goes on to the book at Level 4', () => {
        expect(sceneReleaseLinkGate(settings())).toEqual({ kind: 'lookup' });
    });
});

describe('sceneReleaseLinkBook', () => {
    it('names the Book Manager book the website project came from', () => {
        expect(sceneReleaseLinkBook([book], projects, { book: BOOK_ID })).toEqual({ kind: 'status', book });
    });

    it('says the vault holds another book when it has no such book', () => {
        expect(sceneReleaseLinkBook([book], projects, { book: OTHER_ID }))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') });
    });

    it('takes a book with no source folder to Settings', () => {
        const noFolder = { ...book, sourceFolder: '' };
        expect(sceneReleaseLinkBook([noFolder], projects, { book: BOOK_ID }))
            .toEqual({ kind: 'settings', text: t('ui.communityShareSection.timelineNoBook'), book: noFolder });
    });
});

describe('sceneReleaseLinkOpen', () => {
    it('opens the Send dialog for the request the link names', () => {
        expect(sceneReleaseLinkOpen(status(), [request], { book: BOOK_ID, scene: SCENE, request: REQUEST_ID }))
            .toEqual({ kind: 'send', request });
    });

    it('opens Settings, and says so, when the request is no longer waiting', () => {
        expect(sceneReleaseLinkOpen(status(), [], { book: BOOK_ID, request: REQUEST_ID }))
            .toEqual({ kind: 'settings', notice: t('ui.sceneReleaseLink.requestMissing') });
    });

    it('opens Settings when the link names no request', () => {
        expect(sceneReleaseLinkOpen(status(), [request], { book: BOOK_ID })).toEqual({ kind: 'settings' });
    });

    it('stops when the website moved the book, or the account is in poor standing', () => {
        expect(sceneReleaseLinkOpen(status({ project_id: OTHER_ID }), [request], { book: BOOK_ID, request: REQUEST_ID }))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') });
        expect(sceneReleaseLinkOpen(status({ standing: 'account_flagged' }), [request], { book: BOOK_ID, request: REQUEST_ID }))
            .toEqual({ kind: 'notice', text: t('ui.communityShareSection.sceneBodyStandingNote') });
    });
});
