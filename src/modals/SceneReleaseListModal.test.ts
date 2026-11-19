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
import { SCENE_AUTHOR_AGREEMENT_VERSION } from '../communityShare/sceneAgreement';
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

function harness(focusSceneId?: string) {
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
    const modal = new SceneReleaseListModal(app as never, plugin as never, book as never, onChanged, focusSceneId);
    const screen = modal.contentEl as unknown as FakeElement;
    const named = (name: string) => screen.settings.find(setting => setting.name === name)!;
    return { modal, screen, plugin, read, onChanged, named };
}

/** The website: answers each action; `refuse` maps a scene id or release id to a refusal. */
function website(status: Record<string, unknown>, refuse: Record<string, { code: string; message: string }> = {}) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { body: string }) => {
        const body = JSON.parse(options.body) as { action?: string; scene_id?: string; release_id?: string; rating?: string };
        const refusal = refuse[body.scene_id ?? body.release_id ?? ''];
        if (refusal) return { status: 409, text: JSON.stringify({ error: refusal }) };
        if (body.action === 'take_down') return { status: 200, text: JSON.stringify({ ok: true }) };
        if (body.action === 'consent') return { status: 200, text: JSON.stringify({ ok: true, version: SCENE_AUTHOR_AGREEMENT_VERSION }) };
        if (body.action === 'release') {
            return {
                status: 200,
                text: JSON.stringify({ release: {
                    id: `new-${body.scene_id}`, scene_title: 'Scene', version: 1, rating: body.rating, words: 1, hidden: false,
                    released_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z',
                } }),
            };
        }
        return { status: 200, text: JSON.stringify(status) };
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

    it('opened from a Release scenes link, highlights that scene and scrolls to it once', async () => {
        const h = harness('scn_00000002');
        const request = website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        const storm = h.named('2 Storm').settingEl as unknown as FakeElement;
        expect(storm.classList.contains('ert-scene-release-row--focus')).toBe(true);
        expect(storm.scrolledIntoView).toBe(1);
        expect(h.screen.settings.filter(setting => (setting.settingEl as unknown as FakeElement).classList.contains('ert-scene-release-row--focus')))
            .toHaveLength(1);
        // Its buttons are the list's own: a released scene offers Take down.
        expect(h.named('2 Storm').buttons.map(button => button.text)).toEqual([TAKE_DOWN]);
        expect(sent(request).map(body => body.action)).toEqual(['status']);
    });

    it('has one scroll area, the list: the header and footer sit outside it', async () => {
        const h = harness();
        website({ project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5, releases: await releases() });
        await opened(h);
        const modalEl = (h.modal as unknown as { modalEl: FakeElement }).modalEl;
        expect(modalEl.classList.contains('ert-modal--scene-release-list')).toBe(true);
        const list = h.screen.find('ert-scene-release-list')[0];
        expect(h.screen.children).toContain(list);
        expect(list.find('ert-modal-header')).toHaveLength(0);
        expect(list.find('ert-modal-actions')).toHaveLength(0);
        expect(h.screen.children.map(child => child.cls).filter(cls => cls === 'ert-modal-header' || cls === 'ert-modal-actions'))
            .toEqual(['ert-modal-header', 'ert-modal-actions']);
        expect(list.settings).toHaveLength(6);
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
        expect(preview.buttonNamed(t('ui.sceneReleaseModal.ratingMature')).buttonEl.getAttribute('aria-pressed')).toBe('true');
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

describe('Release scenes, several at once', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetFakeDom();
    });

    const STATUS = { project_id: PROJECT_ID, consent: true, standing: null, has_timeline: true, limit: 5 };
    /** Released: 2 Storm and the website's own r9. Unreleased: 1 Opening, 3 Letter, 4 Trial. */
    const twoReleased = async () => (await releases()).filter(release => release.id === 'r2' || release.id === 'r9');
    const box = (h: ReturnType<typeof harness>, name: string) => h.named(name).settingEl.checkboxes[0];
    const batchDialog = () => FakeModal.opened[FakeModal.opened.length - 1].contentEl as unknown as FakeElement;
    const actions = (request: ReturnType<typeof vi.spyOn>) => sent(request).map(body => body.action);

    it('puts a checkbox on each row that can join a batch, and none on a scene that has no id', async () => {
        const h = harness();
        website({ ...STATUS, releases: await releases() });
        await opened(h);
        expect(h.screen.settings.map(setting => setting.settingEl.checkboxes.length)).toEqual([1, 1, 1, 1, 0, 1]);
        // The checkbox comes first in its row, before the title.
        expect(h.named('2 Storm').settingEl.children[0].type).toBe('checkbox');
        // Named by the row's own visible title.
        expect(box(h, '2 Storm').getAttribute('aria-labelledby')).toBe(h.named('2 Storm').nameEl.id);
        expect(h.named('2 Storm').nameEl.id).toBe('ert-scene-release-name-release:r2');
        // Nothing checked: no batch bar.
        expect(h.screen.find('ert-scene-release-batch')[0].children).toHaveLength(0);
    });

    it('shows one batch button for each kind checked, with its count', async () => {
        const h = harness();
        website({ ...STATUS, releases: await releases() });
        await opened(h);
        box(h, '2 Storm').toggle();
        expect(h.screen.find('ert-scene-release-batch')[0].buttons.map(button => button.text)).toEqual(['Take down 1 scene']);
        box(h, 'Released from the website: Website r9').toggle();
        box(h, '1 Opening').toggle();
        expect(h.screen.find('ert-scene-release-batch')[0].buttons.map(button => button.text))
            .toEqual(['Release 1 scene', 'Take down 2 scenes']);
        box(h, '2 Storm').toggle();
        box(h, 'Released from the website: Website r9').toggle();
        expect(h.screen.find('ert-scene-release-batch')[0].buttons.map(button => button.text)).toEqual(['Release 1 scene']);
    });

    it('Select all released and Select all unreleased check every row of their kind; Clear selection unchecks them', async () => {
        const h = harness();
        website({ ...STATUS, limit: 10, releases: await twoReleased() });
        await opened(h);
        const select = h.screen.find('ert-scene-release-select')[0];
        expect(select.buttons.map(button => button.text)).toEqual(['Select all unreleased', 'Select all released']);
        await select.buttonNamed('Select all released').click();
        expect(h.screen.checkboxes.filter(el => el.checked)).toEqual([box(h, '2 Storm'), box(h, 'Released from the website: Website r9')]);
        await select.buttonNamed('Select all unreleased').click();
        expect(h.screen.find('ert-scene-release-batch')[0].buttons.map(button => button.text))
            .toEqual(['Release 3 scenes', 'Take down 2 scenes']);
        await select.buttonNamed('Clear selection').click();
        expect(h.screen.checkboxes.filter(el => el.checked)).toEqual([]);
        expect(select.buttons.map(button => button.text)).toEqual(['Select all unreleased', 'Select all released']);
    });

    it('at the limit, or while the website has paused the account, only released scenes can be checked', async () => {
        const atLimit = harness();
        website({ ...STATUS, limit: 4, releases: await releases() });
        await opened(atLimit);
        expect(box(atLimit, '1 Opening').disabled).toBe(true);
        expect(box(atLimit, '2 Storm').disabled).toBe(false);
        expect(atLimit.screen.find('ert-scene-release-select')[0].buttons.map(button => button.text)).toEqual(['Select all released']);

        resetFakeDom();
        const paused = harness();
        website({ ...STATUS, standing: 'account_flagged', releases: await releases() });
        await opened(paused);
        expect(box(paused, '1 Opening').disabled).toBe(true);
        expect(box(paused, '4 Trial').disabled).toBe(false);
    });

    it('says how many places are left when more are checked, and releases only once the count fits', async () => {
        const h = harness();
        website({ ...STATUS, limit: 4, releases: await twoReleased() });
        await opened(h);
        await h.screen.find('ert-scene-release-select')[0].buttonNamed('Select all unreleased').click();
        expect(h.screen.find('ert-scene-release-batch-note')[0].content)
            .toBe('2 scenes can still be released. Uncheck 1 scene to release the rest.');
        expect(h.screen.buttonNamed('Release 3 scenes').disabled).toBe(true);
        box(h, '4 Trial').toggle();
        expect(h.screen.find('ert-scene-release-batch-note')[0].content).toBe('');
        expect(h.screen.buttonNamed('Release 2 scenes').disabled).toBe(false);
    });

    it('keeps what is checked when the list rereads the website', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await releases() });
        await opened(h);
        box(h, '2 Storm').toggle();
        fakeWindow.dispatch('focus');
        await vi.waitFor(() => expect(actions(request)).toEqual(['status', 'status']));
        await vi.waitFor(() => expect(box(h, '2 Storm').checked).toBe(true));
        expect(h.screen.buttonNamed('Take down 1 scene').disabled).toBe(false);
    });

    it('batch release: one confirm listing each scene, its word count and any problem, General by default', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await twoReleased() });
        h.read.mockImplementation(async (file: TFile) => (file.path === 'Book/4 Trial.md' ? '---\nClass: Scene\n---\n' : NOTES[file.path]));
        await opened(h);
        await h.screen.find('ert-scene-release-select')[0].buttonNamed('Select all unreleased').click();
        await h.screen.buttonNamed('Release 3 scenes').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));

        expect(batch.find('ert-modal-title')[0].text).toBe('Release 3 scenes');
        expect(batch.find('ert-scene-release-batch-list')[0].settings.map(setting => [setting.name, setting.desc])).toEqual([
            // The word count, then the scene's opening line (one paragraph: no closing line).
            ['1 Opening', '1 word UNRELEASED_ONE'],
            ['3 Letter', '3 words The letter, rewritten.'],
            ['4 Trial', `0 words ${t('ui.communityShareClient.sceneReleaseEmpty')}`],
        ]);
        expect(batch.content).toContain('General: for any reader.');
        expect(batch.content).toContain('Mature: for adult readers.');
        expect(batch.content).toContain('Next, choose their readers on the website.');
        expect(batch.buttonNamed('General').buttonEl.getAttribute('aria-pressed')).toBe('true');
        // Only the scenes that can go are counted on the button.
        expect(batch.buttons.filter(button => button.cta).map(button => button.text)).toEqual(['Release 2 scenes']);
        // Nothing is sent before the press.
        expect(actions(request)).toEqual(['status']);
    });

    it('batch release: each scene\'s full text is behind Show text, folded until asked for', async () => {
        const h = harness();
        website({ ...STATUS, releases: await twoReleased() });
        h.read.mockImplementation(async (file: TFile) => (file.path === 'Book/3 Letter.md'
            ? '---\nClass: Scene\n---\nDear Anna,\n\nThe middle.\n\nYours, Tom.'
            : NOTES[file.path]));
        await opened(h);
        box(h, '3 Letter').toggle();
        await h.screen.buttonNamed('Release 1 scene').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));

        expect(batch.find('ert-scene-release-excerpt')[0].children.map(line => line.text)).toEqual(['Dear Anna,', '… Yours, Tom.']);
        const preview = batch.find('ert-scene-release-batch-preview')[0];
        expect(preview.hidden).toBe(true);
        expect(preview.content).toBe('Dear Anna, The middle. Yours, Tom.');
        expect(batch.find('ert-scene-release-batch-attention')).toHaveLength(0);
        await batch.buttonNamed('Show text').click();
        expect(preview.hidden).toBe(false);
        await batch.buttonNamed('Hide text').click();
        expect(preview.hidden).toBe(true);
        // A clean scene needs nothing more: it goes on the one press.
        expect(batch.buttonNamed('Release 1 scene').disabled).toBe(false);
    });

    it('batch release: a scene with text that looks like a note opens showing it, and goes only once marked Looks right', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await twoReleased() });
        h.read.mockImplementation(async (file: TFile) => (file.path === 'Book/3 Letter.md'
            ? '---\nClass: Scene\n---\nThe letter arrived. [check the postmark date]\n\nShe read it twice.'
            : NOTES[file.path]));
        await opened(h);
        box(h, '1 Opening').toggle();
        box(h, '3 Letter').toggle();
        await h.screen.buttonNamed('Release 2 scenes').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));

        expect(batch.find('ert-scene-release-batch-attention')[0].text).toBe(t('ui.sceneReleaseModal.batchAttention'));
        expect(batch.find('ert-scene-release-note-hint')[0].text)
            .toBe('Looks like a note: “The letter arrived. [check the postmark date]”');
        // The flagged scene's text is open; the clean one's is folded.
        expect(batch.find('ert-scene-release-batch-preview').map(preview => preview.hidden)).toEqual([true, false]);
        // Until it is marked, only the clean scene is counted.
        expect(batch.buttons.filter(button => button.cta).map(button => button.text)).toEqual(['Release 1 scene']);
        const looksRight = batch.find('ert-scene-release-looks-right')[0].checkboxes[0];
        looksRight.toggle();
        expect(batch.buttonNamed('Release 2 scenes').disabled).toBe(false);
        looksRight.toggle();
        await batch.buttonNamed('Release 1 scene').click();

        expect(sent(request).filter(body => body.action === 'release').map(body => body.scene_id)).toEqual(['scn_00000001']);
        expect(JSON.stringify(sent(request))).not.toContain('postmark');
        expect(batch.find('ert-scene-release-batch-result')[0].children.map(line => line.text))
            .toEqual(['Released 1 of 2.', `3 Letter: ${t('ui.sceneReleaseModal.batchLeftOut')}`]);
    });

    it('batch release: with only flagged scenes, nothing can be pressed until one is marked Looks right', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await twoReleased() });
        h.read.mockImplementation(async (file: TFile) => (file.path === 'Book/1 Opening.md'
            ? '---\nClass: Scene\n---\nTK opening line.'
            : NOTES[file.path]));
        await opened(h);
        box(h, '1 Opening').toggle();
        await h.screen.buttonNamed('Release 1 scene').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));
        expect(batch.buttonNamed('Release 0 scenes').disabled).toBe(true);
        batch.find('ert-scene-release-looks-right')[0].checkboxes[0].toggle();
        await batch.buttonNamed('Release 1 scene').click();
        expect(sent(request).filter(body => body.action === 'release').map(body => body.scene_id)).toEqual(['scn_00000001']);
    });

    it('batch release sends each scene in turn with the chosen rating, then says how it went and rereads the list', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await twoReleased() });
        await opened(h);
        box(h, '1 Opening').toggle();
        box(h, '3 Letter').toggle();
        await h.screen.buttonNamed('Release 2 scenes').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));
        await batch.buttonNamed('Mature').click();
        await batch.buttonNamed('Release 2 scenes').click();

        const releasesSent = sent(request).filter(body => body.action === 'release');
        expect(releasesSent.map(body => [body.scene_id, body.rating])).toEqual([['scn_00000001', 'mature'], ['scn_00000003', 'mature']]);
        expect(releasesSent[0].blocks).toEqual(parsePastedScene('UNRELEASED_ONE'));
        expect(releasesSent.every(body => !('expected_version' in body))).toBe(true);
        expect(batch.find('ert-scene-release-batch-result')[0].content).toBe('Released 2 of 2.');
        expect(batch.buttons.map(button => button.text)).toEqual(['Close']);
        await vi.waitFor(() => expect(actions(request)).toEqual(['status', 'release', 'release', 'status']));
        expect(h.onChanged).toHaveBeenCalledTimes(1);
        // The selection went with the batch.
        await vi.waitFor(() => expect(h.screen.checkboxes.filter(el => el.checked)).toEqual([]));
    });

    it('batch release names each scene that did not go, and why, in plain words', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await twoReleased() }, {
            scn_00000003: { code: 'scene_under_review', message: 'This scene is being checked. Try again once the check is done.' },
        });
        h.read.mockImplementation(async (file: TFile) => (file.path === 'Book/4 Trial.md' ? '---\nClass: Scene\n---\n' : NOTES[file.path]));
        await opened(h);
        await h.screen.find('ert-scene-release-select')[0].buttonNamed('Select all unreleased').click();
        await h.screen.buttonNamed('Release 3 scenes').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));
        await batch.buttonNamed('Release 2 scenes').click();

        expect(sent(request).filter(body => body.action === 'release').map(body => body.scene_id)).toEqual(['scn_00000001', 'scn_00000003']);
        const result = batch.find('ert-scene-release-batch-result')[0].children.map(line => line.text);
        expect(result).toEqual([
            'Released 1 of 3.',
            '3 Letter: This scene is being checked. Try again once the check is done.',
            `4 Trial: ${t('ui.communityShareClient.sceneReleaseEmpty')}`,
        ]);
    });

    it('batch release sends nothing for a scene whose note changed after the dialog opened', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await twoReleased() });
        await opened(h);
        box(h, '1 Opening').toggle();
        box(h, '3 Letter').toggle();
        await h.screen.buttonNamed('Release 2 scenes').click();
        const batch = batchDialog();
        await vi.waitFor(() => expect(batch.find('ert-scene-release-batch-list')).toHaveLength(1));
        h.read.mockImplementation(async (file: TFile) => (file.path === 'Book/1 Opening.md' ? '---\nClass: Scene\n---\nA new opening.' : NOTES[file.path]));
        await batch.buttonNamed('Release 2 scenes').click();

        expect(sent(request).filter(body => body.action === 'release').map(body => body.scene_id)).toEqual(['scn_00000003']);
        expect(JSON.stringify(sent(request))).not.toContain('A new opening.');
        expect(batch.find('ert-scene-release-batch-result')[0].children.map(line => line.text))
            .toEqual(['Released 1 of 2.', `1 Opening: ${t('ui.sceneReleaseModal.batchChanged')}`]);
    });

    it('batch release asks for the release terms first when they are not on record', async () => {
        const h = harness();
        const request = website({ ...STATUS, consent: false, releases: await twoReleased() });
        await opened(h);
        box(h, '1 Opening').toggle();
        const pressing = h.screen.buttonNamed('Release 1 scene').click();
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(2));
        await batchDialog().buttonNamed(t('ui.sceneReleaseModal.consentAgree')).click();
        await pressing;
        expect(actions(request)).toEqual(['status', 'consent']);
        expect(FakeModal.opened).toHaveLength(3);
        await vi.waitFor(() => expect(batchDialog().find('ert-scene-release-batch-list')).toHaveLength(1));
    });

    it('batch release does nothing when the author cancels the release terms', async () => {
        const h = harness();
        const request = website({ ...STATUS, consent: false, releases: await twoReleased() });
        await opened(h);
        box(h, '1 Opening').toggle();
        const pressing = h.screen.buttonNamed('Release 1 scene').click();
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(2));
        await batchDialog().buttonNamed('Cancel').click();
        await pressing;
        expect(actions(request)).toEqual(['status']);
        expect(FakeModal.opened).toHaveLength(2);
        // Still checked, still offered.
        expect(h.screen.buttonNamed('Release 1 scene').disabled).toBe(false);
    });

    it('batch take-down: one confirm naming the scenes, in the single take-down\'s words', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await releases() });
        await opened(h);
        box(h, '2 Storm').toggle();
        box(h, 'Released from the website: Website r9').toggle();
        await h.screen.buttonNamed('Take down 2 scenes').click();
        const confirm = batchDialog();
        expect(confirm.find('ert-modal-title')[0].text).toBe('Take down 2 scenes?');
        expect(confirm.find('ert-scene-release-batch-list')[0].settings.map(setting => setting.name))
            .toEqual(['2 Storm', 'Released from the website: Website r9']);
        expect(confirm.content).toContain(t('ui.sceneReleaseModal.takeDownMessage'));
        expect(confirm.content).not.toContain(t('ui.sceneReleaseModal.takeDownHiddenConsequence'));
        await confirm.buttonNamed('Cancel').click();
        expect(actions(request)).toEqual(['status']);
        expect(h.onChanged).not.toHaveBeenCalled();
    });

    it('batch take-down says what follows for a scene hidden after a report, once', async () => {
        const h = harness();
        website({ ...STATUS, releases: await releases() });
        await opened(h);
        await h.screen.find('ert-scene-release-select')[0].buttonNamed('Select all released').click();
        await h.screen.buttonNamed('Take down 4 scenes').click();
        const confirm = batchDialog();
        const consequence = t('ui.sceneReleaseModal.takeDownHiddenConsequence');
        expect(confirm.content).toContain('Hidden after a reader\'s report: 4 Trial.');
        expect(confirm.content.split(consequence)).toHaveLength(2);
    });

    it('batch take-down takes each down in turn, says how it went, and rereads the list', async () => {
        const h = harness();
        const request = website({ ...STATUS, releases: await releases() }, {
            r4: { code: 'not_found', message: 'This release is no longer on the website.' },
        });
        await opened(h);
        box(h, '2 Storm').toggle();
        box(h, '4 Trial').toggle();
        await h.screen.buttonNamed('Take down 2 scenes').click();
        const confirm = batchDialog();
        await confirm.buttonNamed('Take down 2 scenes').click();

        expect(sent(request).filter(body => body.action === 'take_down')).toEqual([
            { connection_id: 'conn-1', current_secret: 'rtcs_current-secret', plugin_book_key: 'book-1', action: 'take_down', release_id: 'r2' },
            { connection_id: 'conn-1', current_secret: 'rtcs_current-secret', plugin_book_key: 'book-1', action: 'take_down', release_id: 'r4' },
        ]);
        expect(confirm.find('ert-scene-release-batch-result')[0].children.map(line => line.text))
            .toEqual(['Took down 1 of 2.', '4 Trial: This release is no longer on the website.']);
        await vi.waitFor(() => expect(actions(request)).toEqual(['status', 'take_down', 'take_down', 'status']));
        expect(h.onChanged).toHaveBeenCalledTimes(1);
    });

    it('the single take-down of a hidden scene still says the whole consequence', async () => {
        const h = harness();
        website({ ...STATUS, releases: await releases() });
        await opened(h);
        const pressing = h.named('4 Trial').buttons[0].click();
        await vi.waitFor(() => expect(FakeModal.opened).toHaveLength(2));
        const confirm = batchDialog();
        expect(confirm.content).toContain(
            'The text is deleted. You keep the feedback you received, with the short passages it quotes. This scene is hidden after a reader\'s report, so once you take it down,'
        );
        await confirm.buttonNamed('Cancel').click();
        await pressing;
    });
});
