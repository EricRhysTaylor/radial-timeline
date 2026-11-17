/**
 * Settings → Community → Private scenes. The block runs against the real
 * client and settings; only Obsidian's widgets and the network are faked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../tests/mocks/obsidian', async (original) => {
    const dom = await import('../../../tests/mocks/fakeDom');
    return {
        ...await original<typeof import('../../../tests/mocks/obsidian')>(),
        Modal: dom.FakeModal,
        ButtonComponent: dom.FakeButton,
        Setting: dom.FakeSetting,
        Notice: dom.FakeNotice,
        requestUrl: vi.fn()
    };
});
vi.mock('../wikiLink', () => ({ addHeadingIcon: () => {}, applyErtHeaderLayout: () => {} }));

import * as obsidian from 'obsidian';
import { FakeElement, FakeModal, notices, resetFakeDom } from '../../../tests/mocks/fakeDom';
import { buildDefaultCommunityShareSettings, sceneBodyShareFor } from '../../communityShare/communityShareSettings';
import { SceneReleaseListModal } from '../../modals/SceneReleaseListModal';
import { t } from '../../i18n';
import { renderCommunitySceneBodyBlock } from './CommunitySceneBodyBlock';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SHARE = t('ui.communityShareSection.sceneBodyShareName');
const RELEASED = t('ui.communityShareSection.sceneBodyReleasedName');
let connections = 0;

function harness() {
    // The block caches the website's answer per connection and book.
    const connectionId = `conn-${++connections}`;
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 2;
    settings.audience = 'public';
    settings.connection = {
        status: 'connected', connectionId, profileId: 'profile-1', projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    settings.timelineShares = { 'book-1': { profileId: 'profile-1', enabled: true } };
    const book = { id: 'book-1', title: 'Private Title', publicLabel: 'Public Name', sourceFolder: 'Book' };
    const plugin = {
        manifest: { version: '8.0.4' },
        app: { secretStorage: { getSecret: () => 'rtcs_current-secret' } },
        settings: { communityShare: settings, books: [book], activeBookId: 'book-1' },
        saveSettings: vi.fn(async () => undefined)
    };
    const screen = new FakeElement();
    const render = (): void => {
        screen.empty();
        renderCommunitySceneBodyBlock({ plugin: plugin as never, containerEl: screen as never, book: book as never, rerender: render });
    };
    const row = (name: string) => screen.settings.find(setting => setting.name === name);
    const shareRow = () => row(SHARE)!;
    return { plugin, settings: () => plugin.settings.communityShare, book, screen, render, row, shareRow };
}

const status = (extra: Record<string, unknown> = {}) => ({
    project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 3, releases: [], ...extra
});

/** Answer status with `answer`; a consent call with ok. Every request is recorded. */
function website(answer: unknown) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { body: string }) => {
        const action = (JSON.parse(options.body) as { action?: string }).action;
        return { status: 200, text: JSON.stringify(action === 'consent' ? { ok: true, version: '2026-11-14' } : answer) };
    }) as never);
    return request;
}

const actions = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => JSON.parse((options as unknown as { body: string }).body) as Record<string, unknown>);

const consentDialog = () => FakeModal.opened[FakeModal.opened.length - 1];
const dialogScreen = (modal: FakeModal) => modal.contentEl as unknown as FakeElement;

describe('Share scene body', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetFakeDom();
    });

    it('is off by default, and rendering the block sends nothing', () => {
        const h = harness();
        const request = website(status());
        h.render();
        expect(h.shareRow().toggle!.value).toBe(false);
        expect(h.shareRow().toggle!.disabled).toBe(false);
        expect(h.shareRow().desc).toContain(t('ui.communityShareSection.sceneBodyShareOff'));
        expect(h.screen.content).toContain(t('ui.communityShareSection.sceneBodyDesc'));
        expect(h.row(RELEASED)).toBeUndefined();
        expect(request).not.toHaveBeenCalled();
    });

    it.each([
        ['the vault is not connected', (h: ReturnType<typeof harness>) => { h.settings().connection.status = 'disconnected'; }, 'ui.communityShareSection.sceneBodyConnectNote'],
        ['sharing is paused', (h: ReturnType<typeof harness>) => { h.settings().sharingPaused = true; }, 'ui.communityShareSection.sceneBodyPausedNote'],
        ['the level is Private', (h: ReturnType<typeof harness>) => { h.settings().enabled = false; h.settings().tier = 0; }, 'ui.communityShareSection.sceneBodyLevelNote'],
        ['the timeline is not shared', (h: ReturnType<typeof harness>) => { h.settings().timelineShares = undefined; }, 'ui.communityShareSection.sceneBodyTimelineNote'],
    ])('is unavailable, and says why, when %s', (_label, arrange, note) => {
        const h = harness();
        const request = website(status());
        arrange(h);
        h.render();
        expect(h.shareRow().toggle!.disabled).toBe(true);
        expect(h.shareRow().desc).toContain(t(note));
        expect(request).not.toHaveBeenCalled();
    });

    it('turning it on asks the website, shows the release terms, and stays off on Cancel', async () => {
        const h = harness();
        const request = website(status({ consent: false }));
        h.render();
        const turningOn = h.shareRow().toggle!.flip(true);
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(1));

        const terms = dialogScreen(consentDialog());
        expect(terms.content).toContain(t('ui.sceneReleaseModal.consentTitle'));
        // Five numbered clauses, in the website's wording.
        const clauses = terms.all().filter(el => el.tag === 'li');
        expect(clauses.map(clause => clause.find('ert-release-terms__text')[0].text)).toEqual([
            'The text is stored on Radial Timeline\'s servers until you take it down.',
            'Each reader you name can read it. Anyone who can read it can copy it, so a release can\'t be fully recalled.',
            'You wrote it and have the right to share it.',
            'Sharing text, even privately, can matter to a publisher or a contest. Check your own agreements.',
            'The Community\'s terms of use apply to private scenes too. A reader can report a scene that violates them. A reported scene is hidden and its text is sent to our AI provider to be checked. The scene is restored if the check finds no violation.',
        ]);
        expect(clauses.map(clause => clause.find('ert-release-terms__number')[0].text)).toEqual(['1', '2', '3', '4', '5']);
        expect(terms.buttons.map(button => button.text)).toEqual(['Cancel', 'I agree']);

        await terms.buttonNamed('Cancel').click();
        await turningOn;
        expect(actions(request).map(body => body.action)).toEqual(['status']);
        expect(sceneBodyShareFor(h.settings(), 'book-1')?.enabled).not.toBe(true);
        expect(h.shareRow().toggle!.value).toBe(false);
    });

    it('records the agreement only on I agree, then turns on', async () => {
        const h = harness();
        const request = website(status({ consent: false }));
        h.render();
        const turningOn = h.shareRow().toggle!.flip(true);
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(1));
        await dialogScreen(consentDialog()).buttonNamed('I agree').click();
        await turningOn;

        const sent = actions(request);
        expect(sent.map(body => body.action)).toEqual(['status', 'consent']);
        for (const body of sent) {
            expect(Object.keys(body).sort()).toEqual(['action', 'connection_id', 'current_secret', 'plugin_book_key']);
        }
        expect(sceneBodyShareFor(h.settings(), 'book-1')).toEqual({ profileId: 'profile-1', enabled: true, projectId: PROJECT_ID });
        expect(h.shareRow().toggle!.value).toBe(true);
        expect(h.shareRow().desc).toContain(t('ui.communityShareSection.sceneBodyOffNote'));
    });

    it('skips the terms for an account that already agreed', async () => {
        const h = harness();
        const request = website(status());
        h.render();
        await h.shareRow().toggle!.flip(true);
        expect(FakeModal.opened).toEqual([]);
        expect(actions(request).map(body => body.action)).toEqual(['status']);
        expect(sceneBodyShareFor(h.settings(), 'book-1')?.enabled).toBe(true);
    });

    it('stays off, and says so, when the account\'s sharing is paused by the website', async () => {
        const h = harness();
        website(status({ consent: false, standing: 'account_flagged' }));
        h.render();
        await h.shareRow().toggle!.flip(true);
        expect(FakeModal.opened).toEqual([]);
        expect(notices).toEqual([t('ui.communityShareSection.sceneBodyStandingNote')]);
        expect(sceneBodyShareFor(h.settings(), 'book-1')?.enabled).not.toBe(true);
    });

    it('stays off when the website has no timeline for the book', async () => {
        const h = harness();
        website(status({ has_timeline: false }));
        h.render();
        await h.shareRow().toggle!.flip(true);
        expect(notices).toEqual([t('ui.communityShareSection.sceneBodyTimelineNote')]);
        expect(sceneBodyShareFor(h.settings(), 'book-1')?.enabled).not.toBe(true);
    });

    it('shows the website\'s reason when the status can\'t be read', async () => {
        const h = harness();
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockReset();
        request.mockImplementation((async () => ({
            status: 409,
            text: JSON.stringify({ error: { code: 'project_mapping_required', message: 'Sync this book to My Share first.' } })
        })) as never);
        h.render();
        await h.shareRow().toggle!.flip(true);
        expect(notices).toEqual(['Sync this book to My Share first.']);
        expect(sceneBodyShareFor(h.settings(), 'book-1')?.enabled).not.toBe(true);
    });

    it('when on, shows the count, the readers link and Release scenes…', async () => {
        const h = harness();
        website(status({ releases: [{
            id: 'r1', scene_id: 'scn_a1b2c3d4', scene_title: '1 Scene', version: 1, rating: 'general', words: 5,
            text_hash: 'a'.repeat(64), hidden: false, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', readers: 0
        }] }));
        h.render();
        await h.shareRow().toggle!.flip(true);

        const released = h.row(RELEASED)!;
        expect(released.desc).toBe('1 of 3 scenes released');
        const link = h.screen.all().find(el => el.tag === 'a')!;
        expect(link.text).toBe('Choose readers on the website');
        expect(link.href).toBe(`https://community.radialtimeline.com/me/scenes/${PROJECT_ID}`);
        expect(h.screen.content).toContain(t('ui.communityShareSection.sceneBodyReadersDesc'));

        await released.buttons[0].click();
        expect(FakeModal.opened[0]).toBeInstanceOf(SceneReleaseListModal);
    });

    it('turning it off sends nothing: releases stay as they are', async () => {
        const h = harness();
        website(status());
        h.render();
        await h.shareRow().toggle!.flip(true);
        const request = website(status());
        await h.shareRow().toggle!.flip(false);
        expect(request).not.toHaveBeenCalled();
        expect(sceneBodyShareFor(h.settings(), 'book-1')?.enabled).toBe(false);
        expect(h.row(RELEASED)).toBeUndefined();
    });

    it('can still be turned off after the timeline stops being shared', async () => {
        const h = harness();
        website(status());
        h.render();
        await h.shareRow().toggle!.flip(true);
        h.settings().timelineShares = undefined;
        h.render();
        expect(h.shareRow().toggle!.disabled).toBe(false);
        expect(h.shareRow().desc).toContain(t('ui.communityShareSection.sceneBodyTimelineNote'));
        expect(h.row(RELEASED)).toBeUndefined();
    });

    it('stores no scene text and no hash', async () => {
        const h = harness();
        website(status({ releases: [{
            id: 'r1', scene_id: 'scn_a1b2c3d4', scene_title: 'WEBSITE_TITLE', version: 1, rating: 'general', words: 5,
            text_hash: 'b'.repeat(64), hidden: false, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', readers: 2
        }] }));
        h.render();
        await h.shareRow().toggle!.flip(true);
        const stored = JSON.stringify(h.plugin.settings);
        expect(stored).not.toContain('b'.repeat(64));
        expect(stored).not.toContain('WEBSITE_TITLE');
    });
});
