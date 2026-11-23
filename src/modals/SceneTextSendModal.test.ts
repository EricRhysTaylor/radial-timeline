/**
 * Send scene to Community is where scene text leaves the vault. These tests
 * press its real buttons against the real client, with only Obsidian's widgets
 * and the network faked: the author sees exactly what is sent and with which
 * request, a note that changed after it was shown is never sent, and Decline
 * sends no text.
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
import { notices, resetFakeDom, type FakeElement } from '../../tests/mocks/fakeDom';
import { buildDefaultCommunityShareSettings } from '../communityShare/communityShareSettings';
import { SCENE_AUTHOR_AGREEMENT_VERSION } from '../communityShare/sceneAgreement';
import { sceneBlockText, sceneBlocksFromNote, type SceneBlock } from '../communityShare/sceneReleaseText';
import type { SceneTextRequest } from '../communityShare/sceneTextRequests';
import { t } from '../i18n';
import { SceneTextSendModal } from './SceneTextSendModal';

const PATH = 'Book/1 Opening.md';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const FIRST = '---\nClass: Scene\nSynopsis: PRIVATE_SYNOPSIS\n---\nMira opened the door. %% PRIVATE_NOTE %%\n\n***\n\nIt was *cold*.';
const EDITED = '---\nClass: Scene\n---\nMira opened the door.\n\n***\n\nIt was *cold*, and she went in anyway.';

const SEND = t('ui.sceneReleaseModal.sendButton');
const DECLINE = t('ui.sceneReleaseModal.declineButton');

const REQUEST: SceneTextRequest = {
    id: REQUEST_ID, scene_id: 'scn_a1b2c3d4', scene_title: '1 Opening', kind: 'release', rating: 'mature', audience: 'named',
    asked_at: '2026-11-22T10:00:00Z', expires_at: '2026-12-06T10:00:00Z', release_id: null, release_version: null,
};

function harness(options: { content?: string; request?: Partial<SceneTextRequest>; scenePath?: string | null; consent?: boolean } = {}) {
    const note = { content: options.content ?? FIRST };
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 4;
    settings.audience = 'public';
    settings.sceneTextLevel = true;
    settings.sceneTextTermsVersion = SCENE_AUTHOR_AGREEMENT_VERSION;
    settings.connection = {
        status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: PROJECT_ID,
        secretId: 'rt.community-share.connection-secret'
    };
    const app = {
        secretStorage: { getSecret: () => 'rtcs_current-secret' },
        vault: {
            getAbstractFileByPath: (path: string) => (path === PATH ? new TFile(path) : null),
            read: vi.fn(async () => note.content)
        }
    };
    const plugin = {
        manifest: { version: '8.1.0' },
        app,
        settings: { communityShare: settings },
        saveSettings: vi.fn(async () => undefined)
    };
    const onDone = vi.fn();
    const request = { ...REQUEST, ...options.request };
    const modal = new SceneTextSendModal(app as never, {
        plugin: plugin as never,
        book: { id: 'book-1', title: 'Private Title', publicLabel: 'The Long Night' },
        request,
        ...(options.scenePath === null ? {} : { scenePath: options.scenePath ?? PATH }),
        status: {
            consent: options.consent ?? true,
            releases: [{
                id: 'release-1', scene_id: 'scn_a1b2c3d4', scene_title: '1 Opening', version: 3, rating: 'general', words: 7,
                text_hash: 'a'.repeat(64), hidden: false, hold: null, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', readers: 2,
            }],
        },
        onDone
    });
    const screen = modal.contentEl as unknown as FakeElement;
    return { modal, screen, note, plugin, onDone };
}

function answerWith(status: number, body: unknown) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async (options: { body: string }) => {
        const action = (JSON.parse(options.body) as { action?: string }).action;
        if (action === 'consent') return { status: 200, text: JSON.stringify({ ok: true, version: SCENE_AUTHOR_AGREEMENT_VERSION }) };
        return { status, text: JSON.stringify(body) };
    }) as never);
    return request;
}

const accepted = (visibility: { hidden: boolean; hold: null | 'privacy' | 'copyright' } = { hidden: false, hold: null }) => answerWith(200, {
    release: {
        id: 'release-1', scene_title: '1 Opening', version: 1,
        rating: 'mature', words: 7, ...visibility, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z'
    }
});

const bodies = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => JSON.parse((options as unknown as { body: string }).body) as Record<string, unknown>);

/** The preview pane as plain text, paragraph by paragraph. */
const shown = (screen: FakeElement) => screen.find('ert-scene-release-preview')[0].children.map(paragraph => paragraph.textContent);
const asShown = (blocks: SceneBlock[]) => blocks.map(block => (block.kind === 'break' ? '* * *' : sceneBlockText(block)));
/** The figures, label → value. */
const figures = (screen: FakeElement) => Object.fromEntries(screen.find('ert-gossamer-proc-stat-item')
    .map(cell => [cell.find('ert-gossamer-proc-stat-label')[0].text, cell.find('ert-gossamer-proc-stat-value')[0].text]));

async function opened(h: ReturnType<typeof harness>) {
    h.modal.open();
    await vi.waitFor(() => expect(h.screen.find('ert-scene-release-preview')).toHaveLength(1));
}

describe('Send scene to Community', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetFakeDom();
    });

    it('opening it sends nothing', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        expect(request).not.toHaveBeenCalled();
    });

    it('names the scene in the pill and shows what Community asked for: words, rating, readers, book', async () => {
        const h = harness();
        accepted();
        await opened(h);
        expect(h.screen.find('ert-modal-badge')[0].text).toBe(t('ui.sceneReleaseModal.sendBadge', { title: '1 Opening' }));
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.sendTitle'));
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.textLabel'));
        // A first release has no subtitle: the request and the button say what happens.
        expect(h.screen.find('ert-modal-subtitle')).toEqual([]);
        expect(figures(h.screen)).toEqual({
            [t('ui.sceneReleaseModal.figureWords')]: '7',
            [t('ui.sceneReleaseModal.figureRating')]: t('ui.sceneReleaseModal.ratingMature'),
            [t('ui.sceneReleaseModal.figureReaders')]: t('ui.sceneReleaseModal.readersNamed'),
            [t('ui.sceneReleaseModal.figureBook')]: 'The Long Night',
        });
        expect(shown(h.screen)).toEqual(['Mira opened the door.', '* * *', 'It was cold.']);
        expect(h.screen.content).not.toMatch(/PRIVATE/);
        expect(h.screen.buttons.map(button => button.text)).toEqual([DECLINE, SEND]);
    });

    it('Send sends exactly the blocks on screen, with the request id and no rating of its own', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        const onScreen = shown(h.screen);
        await h.screen.buttonNamed(SEND).click();
        const [body] = bodies(request);
        expect(Object.keys(body).sort()).toEqual(['action', 'blocks', 'connection_id', 'current_secret', 'plugin_book_key', 'request_id', 'scene_id']);
        expect(body).toMatchObject({ action: 'release', request_id: REQUEST_ID, scene_id: 'scn_a1b2c3d4' });
        expect(body.blocks).toEqual(sceneBlocksFromNote(FIRST));
        expect(asShown(body.blocks as SceneBlock[])).toEqual(onScreen);
        expect(JSON.stringify(body)).not.toMatch(/PRIVATE/);
        expect(notices).toEqual([t('ui.sceneReleaseModal.sentNotice')]);
        expect(h.onDone).toHaveBeenCalledTimes(1);
        expect(h.modal.isOpen).toBe(false);
    });

    it('an update names the version it replaces', async () => {
        const h = harness({ request: { kind: 'update', release_id: 'release-1', release_version: 3 } });
        const request = accepted();
        await opened(h);
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.sendSubtitleUpdate'));
        await h.screen.buttonNamed(SEND).click();
        expect(bodies(request)[0]).toMatchObject({ action: 'update', request_id: REQUEST_ID, expected_version: 3 });
        expect(notices).toEqual([t('ui.sceneReleaseModal.updatedNotice')]);
    });

    it.each([
        ['text a person held before', { hidden: true, hold: 'copyright' as const }, () => t('ui.sceneReleaseModal.stateHeld', { reason: t('ui.sceneReleaseModal.holdCopyright') })],
        ['a held scene sent again', { hidden: true, hold: null }, () => t('ui.sceneReleaseModal.stateWaiting')],
    ])('a scene hidden on arrival (%s) is never announced as updated for every reader', async (_label, visibility, note) => {
        const h = harness({ request: { kind: 'update', release_id: 'release-1', release_version: 3 } });
        accepted(visibility);
        await opened(h);
        await h.screen.buttonNamed(SEND).click();
        expect(notices).toEqual([t('ui.sceneReleaseModal.sentHiddenNotice', { note: note() })]);
        expect(notices[0]).not.toMatch(/report/i);
        expect(h.onDone).toHaveBeenCalledTimes(1);
    });

    it('records on the website the agreement given on choosing Level 4, then sends', async () => {
        const h = harness({ consent: false });
        const request = accepted();
        await opened(h);
        await h.screen.buttonNamed(SEND).click();
        expect(bodies(request).map(body => body.action)).toEqual(['consent', 'release']);
    });

    it('sends nothing when the note changed after it was shown, and shows the new text', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        h.note.content = EDITED;
        await h.screen.buttonNamed(SEND).click();
        expect(request).not.toHaveBeenCalled();
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.previewChanged'));
        expect(shown(h.screen)[2]).toContain('she went in anyway');
        expect(h.modal.isOpen).toBe(true);
    });

    it('Decline sends the request id and no text', async () => {
        const h = harness();
        const request = answerWith(200, { ok: true });
        await opened(h);
        await h.screen.buttonNamed(DECLINE).click();
        const [body] = bodies(request);
        expect(Object.keys(body).sort()).toEqual(['action', 'connection_id', 'current_secret', 'plugin_book_key', 'request_id']);
        expect(body).toMatchObject({ action: 'decline', request_id: REQUEST_ID });
        expect(notices).toEqual([t('ui.sceneReleaseModal.declinedNotice')]);
        expect(h.onDone).toHaveBeenCalledTimes(1);
    });

    it('a scene this vault does not hold offers Decline only', async () => {
        const h = harness({ scenePath: null });
        const request = accepted();
        h.modal.open();
        await vi.waitFor(() => expect(h.screen.content).toContain(t('ui.sceneReleaseModal.sendSceneMissing')));
        expect(h.screen.buttons.map(button => button.text)).toEqual([DECLINE]);
        expect(request).not.toHaveBeenCalled();
    });

    it('offers no Send for a scene with no text after cleaning', async () => {
        const h = harness({ content: '---\nClass: Scene\n---\n%% notes only %%' });
        accepted();
        await opened(h);
        expect(h.screen.content).toContain(t('ui.communityShareClient.sceneReleaseEmpty'));
        expect(h.screen.buttons.map(button => button.text)).toEqual([DECLINE]);
    });

    it('sends nothing when sharing is paused after it opened', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        h.plugin.settings.communityShare.sharingPaused = true;
        await h.screen.buttonNamed(SEND).click();
        expect(request).not.toHaveBeenCalled();
        expect(notices).toEqual([t('ui.communityShareClient.sceneReleasePaused')]);
    });
});
