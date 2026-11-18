/**
 * Release scenes: the list dialog against the real client and vault reader,
 * with only Obsidian's widgets and the network faked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tests/mocks/obsidian', async (original) => {
    const dom = await import('../../tests/mocks/fakeDom');
    return {
        ...await original<typeof import('../../tests/mocks/obsidian')>(),
        Modal: dom.FakeModal,
        ButtonComponent: dom.FakeButton,
        Setting: dom.FakeSetting,
        Notice: dom.FakeNotice,
        requestUrl: vi.fn()
    };
});

import * as obsidian from 'obsidian';
import { TFile } from 'obsidian';
import { FakeModal, fakeWindow, notices, resetFakeDom, type FakeElement } from '../../tests/mocks/fakeDom';
import { buildDefaultCommunityShareSettings } from '../communityShare/communityShareSettings';
import { parsePastedScene, sceneTextHash } from '../communityShare/sceneReleaseText';
import { t } from '../i18n';
import type { TimelineItem } from '../types';
import { SceneReleaseListModal } from './SceneReleaseListModal';
import { SceneReleasePreviewModal } from './SceneReleasePreviewModal';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const TAKE_DOWN = t('ui.sceneReleaseModal.takeDown');
const PREVIEW_RELEASE = t('ui.sceneReleaseModal.previewAndRelease');
const PREVIEW_UPDATE = t('ui.sceneReleaseModal.previewAndUpdate');

const NOTES: Record<string, string> = {
    'Book/1 Opening.md': '---\nClass: Scene\n---\nUNRELEASED_ONE',
    'Book/2 Storm.md': '---\nClass: Scene\n---\nThe storm came.',
    'Book/3 Letter.md': '---\nClass: Scene\n---\nThe letter, rewritten.',
    'Book/4 Trial.md': '---\nClass: Scene\n---\nThe trial.',
    'Book/5 Typed id.md': '---\nClass: Scene\n---\nUNRELEASED_FIVE',
};

const row = (id: string, sceneId: string | null, extra: Record<string, unknown> = {}) => ({
    id, scene_id: sceneId, scene_title: `Website ${id}`, version: 2, rating: 'mature', words: 3,
    text_hash: 'a'.repeat(64), hidden: false, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z',
    readers: 2, ...extra
});

async function releases() {
    return [
        row('r2', 'scn_00000002', { text_hash: await sceneTextHash(parsePastedScene('The storm came.')), readers: 1 }),
        row('r3', 'scn_00000003', { text_hash: await sceneTextHash(parsePastedScene('The letter.')) }),
        row('r4', 'scn_00000004', { hidden: true }),
        row('r9', null),
    ];
}

function harness() {
    const read = vi.fn(async (file: TFile) => NOTES[file.path]);
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 2;
    settings.audience = 'public';
    settings.connection = {
        status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    const items: TimelineItem[] = Object.keys(NOTES).map((path, index) => ({
        itemType: 'Scene', title: path.split('/').pop()!.replace(/\.md$/, ''), date: '', path, subplot: 'Main Plot',
        sceneId: index === 4 ? 'The Typed Id' : `scn_0000000${index + 1}`
    }));
    const app = {
        secretStorage: { getSecret: () => 'rtcs_current-secret' },
        vault: { getAbstractFileByPath: (path: string) => (path in NOTES ? new TFile(path) : null), read }
    };
    const plugin = {
        manifest: { version: '8.0.4' },
        app,
        settings: { communityShare: settings },
        getSceneDataService: () => ({ getSceneDataWithBookMeta: async () => ({ items, bookMeta: null }) }),
        saveSettings: vi.fn(async () => undefined)
    };
    const onChanged = vi.fn();
    const book = { id: 'book-1', title: 'The Book', sourceFolder: 'Book' };
    const modal = new SceneReleaseListModal(app as never, plugin as never, book as never, onChanged);
    const screen = modal.contentEl as unknown as FakeElement;
    const named = (name: string) => screen.settings.find(setting => setting.name === name)!;
    return { modal, screen, plugin, read, onChanged, named };
}

function website(status: Record<string, unknown>) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { body: string }) => {
        const action = (JSON.parse(options.body) as { action?: string }).action;
        return { status: 200, text: JSON.stringify(action === 'take_down' ? { ok: true } : status) };
    }) as never);
    return request;
}

const sent = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => JSON.parse((options as unknown as { body: string }).body) as Record<string, unknown>);

async function opened(h: ReturnType<typeof harness>) {
    h.modal.open();
    await vi.waitFor(() => expect(h.screen.find('ert-scene-release-list')).toHaveLength(1));
}

describe('Release scenes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetFakeDom();
    });

    it('lists the book\'s scenes in manuscript order, each with one state and its buttons', async () => {
        const h = harness();
        website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);

        expect(h.screen.settings.map(setting => [setting.name, setting.desc, setting.buttons.map(button => button.text)])).toEqual([
            ['1 Opening', 'Not released', [PREVIEW_RELEASE]],
            ['2 Storm', 'Released · version 2 · 1 reader', [TAKE_DOWN]],
            ['3 Letter', 'Changed since release · version 2 · 2 readers', [PREVIEW_UPDATE, TAKE_DOWN]],
            ['4 Trial', 'Hidden after a reader\'s report. The website shows why and how it comes back.', [TAKE_DOWN]],
            ['5 Typed id', t('ui.sceneReleaseModal.stateNoSceneId'), []],
            ['Released from the website: Website r9', 'Released · version 2 · 2 readers', [TAKE_DOWN]],
        ]);
        expect(h.screen.content).toContain('4 of 5 released');
        expect(h.screen.content).not.toContain(t('ui.sceneReleaseModal.listAtLimit'));
        const link = h.screen.all().find(el => el.tag === 'a')!;
        expect(link.href).toBe(`https://community.radialtimeline.com/me/scenes/${PROJECT_ID}`);
    });

    it('opening it sends one status request with no text, and reads only released scenes', async () => {
        const h = harness();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        expect(sent(request)).toEqual([
            { connection_id: 'conn-1', current_secret: 'rtcs_current-secret', plugin_book_key: 'book-1', action: 'status' }
        ]);
        expect(h.read.mock.calls.map(([file]) => file.path)).toEqual(['Book/2 Storm.md', 'Book/3 Letter.md', 'Book/4 Trial.md']);
    });

    it('at the limit, says so and offers no new release', async () => {
        const h = harness();
        website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 4, releases: await releases() });
        await opened(h);
        expect(h.screen.content).toContain('4 of 4 released');
        expect(h.screen.content).toContain('Take one down to release another.');
        expect(h.named('1 Opening').buttons[0].disabled).toBe(true);
        // An update replaces a release, so it is still offered.
        expect(h.named('3 Letter').buttons[0].disabled).toBe(false);
    });

    it('Preview and release opens the preview for that scene, sending nothing itself', async () => {
        const h = harness();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        await h.named('1 Opening').buttons[0].click();
        const preview = FakeModal.opened[FakeModal.opened.length - 1];
        expect(preview).toBeInstanceOf(SceneReleasePreviewModal);
        await vi.waitFor(() => expect((preview.contentEl as unknown as FakeElement).content).toContain('UNRELEASED_ONE'));
        expect(sent(request).map(body => body.action)).toEqual(['status']);
    });

    it('Preview and update carries the version and rating the website reported', async () => {
        const h = harness();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        await h.named('3 Letter').buttons[0].click();
        const preview = FakeModal.opened[FakeModal.opened.length - 1].contentEl as unknown as FakeElement;
        await vi.waitFor(() => expect(preview.find('ert-scene-release-preview')).toHaveLength(1));
        expect(preview.settings[0].dropdown!.value).toBe('mature');
        // Nothing is sent until the author presses the preview's own button.
        expect(sent(request).map(body => body.action)).toEqual(['status']);
    });

    it('Take down asks first, and does nothing on Cancel', async () => {
        const h = harness();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        const pressing = h.named('2 Storm').buttons[0].click();
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(2));
        const confirm = FakeModal.opened[1].contentEl as unknown as FakeElement;
        expect(confirm.content).toContain('Take down "2 Storm"?');
        expect(confirm.content).toContain('The text is deleted and readers lose it at once. You keep the feedback you received, with the short passages it quotes.');
        await confirm.buttonNamed('Cancel').click();
        await pressing;
        expect(sent(request).map(body => body.action)).toEqual(['status']);
        expect(h.onChanged).not.toHaveBeenCalled();
    });

    it('Take down sends the release id and no text, then rereads the website', async () => {
        const h = harness();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        const pressing = h.named('Released from the website: Website r9').buttons[0].click();
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(2));
        await (FakeModal.opened[1].contentEl as unknown as FakeElement).buttonNamed(TAKE_DOWN).click();
        await pressing;
        await vi.waitFor(() => expect(sent(request).map(body => body.action)).toEqual(['status', 'take_down', 'status']));
        expect(sent(request)[1]).toEqual({
            connection_id: 'conn-1', current_secret: 'rtcs_current-secret', plugin_book_key: 'book-1',
            action: 'take_down', release_id: 'r9'
        });
        expect(notices).toEqual([t('ui.sceneReleaseModal.takenDownNotice')]);
        expect(h.onChanged).toHaveBeenCalledTimes(1);
    });

    it('offers no release or update while the account\'s sharing is paused by the website', async () => {
        const h = harness();
        website({ project_id: PROJECT_ID, consent: true, standing: 'account_flagged', has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        expect(h.screen.content).toContain(t('ui.communityShareSection.sceneBodyStandingNote'));
        expect(h.named('1 Opening').buttons[0].disabled).toBe(true);
        expect(h.named('3 Letter').buttons[0].disabled).toBe(true);
        // Removing text is still the author's to do.
        expect(h.named('2 Storm').buttons[0].disabled).toBe(false);
    });

    it('lists the scenes in manuscript order even when the vault hands them over reversed', async () => {
        const h = harness();
        const items = (await h.plugin.getSceneDataService().getSceneDataWithBookMeta()).items.slice().reverse();
        h.plugin.getSceneDataService = () => ({ getSceneDataWithBookMeta: async () => ({ items, bookMeta: null }) });
        website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        expect(h.screen.settings.map(setting => setting.name).slice(0, 5)).toEqual(['1 Opening', '2 Storm', '3 Letter', '4 Trial', '5 Typed id']);
    });

    it('rereads the website when Obsidian gets focus back, so a reader added there is counted', async () => {
        const h = harness();
        const first = await releases();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: first });
        await opened(h);
        expect(h.named('2 Storm').desc).toBe('Released · version 2 · 1 reader');

        // The author names a second reader on the website, then comes back to Obsidian.
        const later = first.map(release => (release.id === 'r2' ? { ...release, readers: 2 } : release));
        request.mockImplementation((async () => ({
            status: 200,
            text: JSON.stringify({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: later }),
        })) as never);
        fakeWindow.dispatch('focus');
        await vi.waitFor(() => expect(h.named('2 Storm').desc).toBe('Released · version 2 · 2 readers'));
        expect(sent(request).map(body => body.action)).toEqual(['status', 'status']);
    });

    it('stops listening for focus once closed', async () => {
        const h = harness();
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        expect(fakeWindow.listening('focus')).toBe(1);
        h.modal.close();
        expect(fakeWindow.listening('focus')).toBe(0);
        fakeWindow.dispatch('focus');
        expect(sent(request).map(body => body.action)).toEqual(['status']);
    });

    it('says why when the website can\'t be read, and offers to try again', async () => {
        const h = harness();
        const request = vi.spyOn(obsidian, 'requestUrl');
        request.mockReset();
        request.mockImplementation((async () => ({
            status: 409,
            text: JSON.stringify({ error: { code: 'project_mapping_required', message: 'Sync this book to My Share first.' } })
        })) as never);
        h.modal.open();
        await vi.waitFor(() => expect(h.screen.content).toContain('Sync this book to My Share first.'));
        expect(h.screen.buttons.map(button => button.text)).toEqual([t('ui.sceneReleaseModal.listRetry'), t('ui.sceneReleaseModal.close')]);
        expect(h.read).not.toHaveBeenCalled();
    });
});
