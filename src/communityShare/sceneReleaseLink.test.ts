/**
 * The Release scenes link: what it accepts, and where each kind of vault is
 * taken. Pure: no Obsidian, no network.
 */

import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { BookProfile } from '../types/settings';
import { buildDefaultCommunityShareSettings } from './communityShareSettings';
import type { SceneReleaseSummary } from './communityShareClient';
import {
    SCENE_RELEASE_PROTOCOL_ACTION,
    parseSceneReleaseLink,
    sceneReleaseLinkBook,
    sceneReleaseLinkGate,
    sceneReleaseLinkOpen,
} from './sceneReleaseLink';
import type { SceneReleaseRow } from './sceneReleaseVault';

const BOOK_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const SCENE = 'scn_0a1b2c3d';

const book = { id: 'book-1', title: 'The Long Night', sourceFolder: 'Book' } as BookProfile;
const otherBook = { id: 'book-2', title: 'Second Book', sourceFolder: 'Second' } as BookProfile;
const projects = [{ id: BOOK_ID, plugin_book_key: 'book-1' }, { id: OTHER_ID, plugin_book_key: 'book-2' }];

/** A connected vault at a public level, timeline shared, Share scene body on for book-1. */
function settings(edit: (s: ReturnType<typeof buildDefaultCommunityShareSettings>) => void = () => {}) {
    const s = buildDefaultCommunityShareSettings();
    s.enabled = true;
    s.tier = 2;
    s.audience = 'public';
    s.connection = { status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: BOOK_ID, secretId: 'secret' };
    s.timelineShares = {
        'book-1': { profileId: 'profile-1', enabled: true },
        'book-2': { profileId: 'profile-1', enabled: true },
    };
    s.sceneBodyShares = { 'book-1': { profileId: 'profile-1', enabled: true, projectId: BOOK_ID } };
    edit(s);
    return s;
}

function release(extra: Partial<SceneReleaseSummary> = {}): SceneReleaseSummary {
    return {
        id: 'rel-1', scene_id: SCENE, scene_title: 'Opening', version: 1, rating: 'general', words: 900,
        text_hash: 'a'.repeat(64), hidden: false, released_at: '2026-11-01', updated_at: '2026-11-01', readers: 2, ...extra,
    };
}

const sceneNote = { path: 'Book/1 Opening.md', title: '1 Opening', sceneId: SCENE };
const status = (extra: Record<string, unknown> = {}) => ({ project_id: BOOK_ID, standing: null, limit: 3, releases: [] as SceneReleaseSummary[], ...extra });

describe('parseSceneReleaseLink', () => {
    it('is registered under the action the website builds', () => {
        expect(SCENE_RELEASE_PROTOCOL_ACTION).toBe('radial-timeline-release');
    });

    it('reads a book, and a book with a scene', () => {
        expect(parseSceneReleaseLink({ book: BOOK_ID })).toEqual({ book: BOOK_ID });
        expect(parseSceneReleaseLink({ book: BOOK_ID, scene: SCENE })).toEqual({ book: BOOK_ID, scene: SCENE });
        expect(parseSceneReleaseLink({ book: BOOK_ID, scene: 'scn_0a1b2c3d4e' })).toEqual({ book: BOOK_ID, scene: 'scn_0a1b2c3d4e' });
    });

    it('lower-cases an upper-case UUID', () => {
        expect(parseSceneReleaseLink({ book: BOOK_ID.toUpperCase() })).toEqual({ book: BOOK_ID });
    });

    it('ignores every other parameter, the vault name and action included', () => {
        expect(parseSceneReleaseLink({
            action: 'radial-timeline-release', vault: 'Somebody', book: BOOK_ID, scene: SCENE, text: 'hello', release: 'now',
        })).toEqual({ book: BOOK_ID, scene: SCENE });
    });

    it.each([
        ['missing', undefined],
        ['empty', ''],
        ['not a UUID', 'my-book'],
        ['one digit short', '33333333-3333-4333-8333-33333333333'],
        ['padded', ` ${BOOK_ID}`],
        ['with a suffix', `${BOOK_ID}x`],
        ['not hex', '3333333g-3333-4333-8333-333333333333'],
    ])('refuses a book id that is %s', (_label, value) => {
        expect(parseSceneReleaseLink({ book: value })).toBeNull();
    });

    it.each([
        ['empty', ''],
        ['too short', 'scn_0a1b2c3'],
        ['too long', 'scn_0a1b2c3d4e5'],
        ['upper case', 'scn_0A1B2C3D'],
        ['without the prefix', '0a1b2c3d'],
        ['not hex', 'scn_0a1b2c3z'],
        ['a title', 'scn_opening'],
        ['padded', ` ${SCENE}`],
    ])('refuses a scene id that is %s, rather than opening the wrong thing', (_label, value) => {
        expect(parseSceneReleaseLink({ book: BOOK_ID, scene: value })).toBeNull();
    });
});

describe('sceneReleaseLinkGate', () => {
    it('gives the next step to a vault with no Community connection', () => {
        const route = sceneReleaseLinkGate(buildDefaultCommunityShareSettings());
        expect(route).toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.connect') });
        expect(t('ui.sceneReleaseLink.connect')).toBe('Connect this vault to Community in Settings → Radial Timeline → Community, then open the link again.');
    });

    it('takes a paused vault, and one at the Private level, to Private scenes', () => {
        expect(sceneReleaseLinkGate(settings(s => { s.sharingPaused = true; })))
            .toEqual({ kind: 'settings', text: t('ui.communityShareSection.sceneBodyPausedNote') });
        expect(sceneReleaseLinkGate(settings(s => { s.enabled = false; s.tier = 1; s.audience = 'private_draft'; })))
            .toEqual({ kind: 'settings', text: t('ui.communityShareSection.sceneBodyLevelNote') });
    });

    it('asks the website for the book once the vault can release', () => {
        expect(sceneReleaseLinkGate(settings())).toEqual({ kind: 'lookup' });
    });
});

describe('sceneReleaseLinkBook', () => {
    it('reads the status of the book the link names', () => {
        expect(sceneReleaseLinkBook(settings(), [book, otherBook], projects, { book: BOOK_ID }))
            .toEqual({ kind: 'status', book });
    });

    it('opens nothing for a book this vault does not hold', () => {
        const third = { book: '55555555-5555-4555-8555-555555555555' };
        expect(sceneReleaseLinkBook(settings(), [book], projects, third))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') });
        // The website knows the project, but its book is not in this vault's Book Manager.
        expect(sceneReleaseLinkBook(settings(), [book], projects, { book: OTHER_ID }))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') });
        // A project with no book key came from elsewhere.
        expect(sceneReleaseLinkBook(settings(), [book], [{ id: BOOK_ID, plugin_book_key: null }], { book: BOOK_ID }))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') });
    });

    it('takes the author to Share scene body when it is off, and never turns it on', () => {
        const s = settings();
        const route = sceneReleaseLinkBook(s, [book, otherBook], projects, { book: OTHER_ID });
        expect(route).toEqual({ kind: 'settings', text: 'Turn on Share scene body for Second Book, then open the link again.', book: otherBook });
        expect(s.sceneBodyShares?.['book-2']).toBeUndefined();
    });

    it('treats a Share scene body record made for another account as off', () => {
        const s = settings(live => { live.sceneBodyShares = { 'book-1': { profileId: 'profile-old', enabled: true } }; });
        expect(sceneReleaseLinkBook(s, [book], projects, { book: BOOK_ID }).kind).toBe('settings');
    });

    it('sends a book whose timeline is not shared to the Timeline step first', () => {
        const s = settings(live => { live.timelineShares = {}; });
        expect(sceneReleaseLinkBook(s, [book], projects, { book: BOOK_ID }))
            .toEqual({ kind: 'settings', text: t('ui.communityShareSection.sceneBodyTimelineNote'), book });
    });
});

describe('sceneReleaseLinkOpen', () => {
    const notReleased: SceneReleaseRow = { state: 'not_released', title: sceneNote.title, scene: sceneNote };

    it('opens the list for a link with no scene', () => {
        expect(sceneReleaseLinkOpen(status(), [notReleased], { book: BOOK_ID })).toEqual({ kind: 'list' });
    });

    it('opens the preview for a scene not yet released', () => {
        expect(sceneReleaseLinkOpen(status(), [notReleased], { book: BOOK_ID, scene: SCENE }))
            .toEqual({ kind: 'preview', scene: { path: sceneNote.path, title: sceneNote.title, sceneId: SCENE } });
    });

    it.each(['released', 'changed', 'hidden'] as const)('opens the list at a scene that is %s', state => {
        const row: SceneReleaseRow = { state, title: sceneNote.title, scene: sceneNote, release: release({ hidden: state === 'hidden' }) };
        expect(sceneReleaseLinkOpen(status({ releases: [release()] }), [row], { book: BOOK_ID, scene: SCENE }))
            .toEqual({ kind: 'list', focusSceneId: SCENE });
    });

    it('opens the list at an unreleased scene when the book is at its limit', () => {
        const releases = [release({ id: 'a', scene_id: 'scn_aaaaaaaa' }), release({ id: 'b', scene_id: 'scn_bbbbbbbb' })];
        expect(sceneReleaseLinkOpen(status({ limit: 2, releases }), [notReleased], { book: BOOK_ID, scene: SCENE }))
            .toEqual({ kind: 'list', focusSceneId: SCENE });
    });

    it('opens the list, and says so, when the scene is not in this book', () => {
        const missing = sceneReleaseLinkOpen(status(), [notReleased], { book: BOOK_ID, scene: 'scn_ffffffff' });
        expect(missing).toEqual({ kind: 'list', notice: t('ui.sceneReleaseLink.sceneMissing') });
        // A release the website holds that matches no scene here is not a scene the vault can open.
        const website: SceneReleaseRow = { state: 'website', title: 'Gone', release: release({ scene_id: 'scn_ffffffff' }) };
        expect(sceneReleaseLinkOpen(status(), [website], { book: BOOK_ID, scene: 'scn_ffffffff' })).toEqual(missing);
    });

    it('opens nothing when the website answers for a different book', () => {
        expect(sceneReleaseLinkOpen(status({ project_id: OTHER_ID }), [notReleased], { book: BOOK_ID, scene: SCENE }))
            .toEqual({ kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') });
    });

    it('opens nothing while the account is flagged', () => {
        expect(sceneReleaseLinkOpen(status({ standing: 'account_flagged' }), [notReleased], { book: BOOK_ID, scene: SCENE }))
            .toEqual({ kind: 'notice', text: t('ui.communityShareSection.sceneBodyStandingNote') });
    });
});
