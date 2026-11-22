/**
 * Settings → Community → Vault → Community, the active book at Level 4: the
 * scenes asked for on Community and the scenes released. The block runs
 * against the real client and settings; only Obsidian's widgets and the
 * network are faked.
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

import * as obsidian from 'obsidian';
import { TFile } from 'obsidian';
import { FakeElement, FakeModal, resetFakeDom } from '../../../tests/mocks/fakeDom';
import { buildDefaultCommunityShareSettings } from '../../communityShare/communityShareSettings';
import { parsePastedScene, sceneTextHash } from '../../communityShare/sceneReleaseText';
import { SceneTextSendModal } from '../../modals/SceneTextSendModal';
import { t, tCount } from '../../i18n';
import { forgetSceneTextState, knownSceneTextCounts, renderCommunitySceneTextBlock } from './CommunitySceneTextBlock';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const ASKED = t('ui.communityShareSection.requestsName');
const RELEASED = t('ui.communityShareSection.releasedName');

const NOTES: Record<string, string> = {
    'Book/1 Opening.md': '---\nClass: Scene\n---\nThe door opened.',
    'Book/2 Storm.md': '---\nClass: Scene\n---\nThe storm came. Then it left.',
};

function harness() {
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 4;
    settings.audience = 'public';
    settings.sceneTextLevel = true;
    settings.connection = {
        status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    settings.timelineShares = { 'book-1': { profileId: 'profile-1', enabled: true } };
    const book = { id: 'book-1', title: 'Private Title', publicLabel: 'The Long Night', sourceFolder: 'Book' };
    const items = Object.keys(NOTES).map((path, index) => ({
        itemType: 'Scene', title: path.split('/').pop()!.replace(/\.md$/, ''), date: '', path, subplot: 'Main Plot', sceneId: `scn_0000000${index + 1}`,
    }));
    const plugin = {
        manifest: { version: '8.1.0' },
        app: {
            secretStorage: { getSecret: () => 'rtcs_current-secret' },
            vault: {
                getAbstractFileByPath: (path: string) => (path in NOTES ? new TFile(path) : null),
                read: vi.fn(async (file: TFile) => NOTES[file.path]),
            },
        },
        settings: { communityShare: settings, books: [book], activeBookId: 'book-1' },
        getSceneDataService: () => ({ getSceneDataWithBookMeta: async () => ({ items, bookMeta: null }) }),
        saveSettings: vi.fn(async () => undefined),
    };
    const screen = new FakeElement();
    const render = (): void => {
        screen.empty();
        renderCommunitySceneTextBlock({ plugin: plugin as never, containerEl: screen as never, book: book as never, rerender: render });
    };
    const row = (name: string) => screen.settings.find(setting => setting.name === name);
    return { plugin, settings, book, screen, render, row };
}

/** The website: a status with one released scene (released as "The storm came."), and one request. */
async function website() {
    const released = await sceneTextHash(parsePastedScene('The storm came.'));
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { body: string }) => {
        const action = (JSON.parse(options.body) as { action?: string }).action;
        if (action === 'requests') {
            return { status: 200, text: JSON.stringify({ ok: true, requests: [{
                id: REQUEST_ID, scene_id: 'scn_00000001', scene_title: '1 Opening', kind: 'release', rating: 'general', audience: 'public',
                asked_at: '2026-11-22T10:00:00Z', expires_at: '2026-12-06T10:00:00Z', release_id: null, release_version: null,
            }] }) };
        }
        return { status: 200, text: JSON.stringify({
            project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 3,
            releases: [{
                id: 'release-2', scene_id: 'scn_00000002', scene_title: '2 Storm', version: 1, rating: 'general', words: 3,
                text_hash: released, hidden: false, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', readers: 2,
            }],
        }) };
    }) as never);
    return request;
}

const actions = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => (JSON.parse((options as unknown as { body: string }).body) as { action: string }).action);

describe('scenes asked for, and released, at Level 4', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetFakeDom();
        forgetSceneTextState();
    });

    it.each([
        ['Level 3', (s: ReturnType<typeof harness>['settings']) => { s.sceneTextLevel = false; }],
        ['paused', (s: ReturnType<typeof harness>['settings']) => { s.sharingPaused = true; }],
    ])('below Level 4, or %s, shows nothing and reads nothing', async (_label, edit) => {
        const h = harness();
        const request = await website();
        edit(h.settings);
        h.render();
        expect(h.screen.settings).toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });

    it('with the timeline not kept updated, says so once and reads nothing', async () => {
        const h = harness();
        const request = await website();
        h.settings.timelineShares = undefined;
        h.render();
        expect(h.row(ASKED)!.desc).toBe(t('ui.communityShareSection.sceneTextTimelineFirst'));
        expect(request).not.toHaveBeenCalled();
    });

    it('lists each request with Review, and each released scene with its readers and a changed note', async () => {
        const h = harness();
        const request = await website();
        h.render();
        await vi.waitFor(() => expect(h.row(RELEASED)).toBeDefined());
        expect(actions(request)).toEqual(['status', 'requests']);
        expect(h.row(ASKED)!.desc).toBe(tCount('sceneAsked', 1));
        const asked = h.row('1 Opening')!;
        expect(asked.desc).toContain(t('ui.communityShareSection.requestKindRelease'));
        expect(asked.buttons.map(button => button.text)).toEqual([t('ui.communityShareSection.requestReview')]);
        expect(h.row(RELEASED)!.desc).toBe(t('ui.communityShareSection.releasedCount', { count: 1, limit: 3 }));
        const storm = h.row('2 Storm')!;
        expect(storm.desc).toContain(tCount('reader', 2));
        expect(storm.desc).toContain(t('ui.communityShareSection.releasedChanged'));
        const link = h.screen.all().find(el => el.tag === 'a')!;
        expect(link.href).toBe(`https://community.radialtimeline.com/me/scenes/${PROJECT_ID}`);
        expect(knownSceneTextCounts(h.settings, h.book as never)).toEqual({ asked: 1, released: 1 });
        // Reading sent no text.
        for (const [options] of request.mock.calls) expect((options as unknown as { body: string }).body).not.toContain('blocks');
    });

    it('Review opens the Send dialog for that request', async () => {
        const h = harness();
        await website();
        h.render();
        await vi.waitFor(() => expect(h.row('1 Opening')).toBeDefined());
        await h.row('1 Opening')!.buttons[0].click();
        expect(FakeModal.opened[0]).toBeInstanceOf(SceneTextSendModal);
    });
});
