/**
 * The preview dialog is where scene text leaves the vault. These tests press
 * its real buttons against the real client, with only Obsidian's widgets and
 * the network faked: the author sees exactly what is sent, and a note that
 * changed after the preview was shown is never sent.
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
import { sceneBlockText, sceneBlocksFromNote, type SceneBlock } from '../communityShare/sceneReleaseText';
import { t } from '../i18n';
import { SceneReleasePreviewModal } from './SceneReleasePreviewModal';

const PATH = 'Book/1 Opening.md';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const FIRST = '---\nClass: Scene\nSynopsis: PRIVATE_SYNOPSIS\n---\nMira opened the door. %% PRIVATE_NOTE %%\n\n***\n\nIt was *cold*.';
const EDITED = '---\nClass: Scene\n---\nMira opened the door.\n\n***\n\nIt was *cold*, and she went in anyway.';

const RELEASE = t('ui.sceneReleaseModal.releaseButton');
const UPDATE = t('ui.sceneReleaseModal.updateButton');

function harness(options: { content?: string; current?: { version: number; rating: 'general' | 'mature' } } = {}) {
    const note = { content: options.content ?? FIRST };
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 2;
    settings.audience = 'public';
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
        manifest: { version: '8.0.4' },
        app,
        settings: { communityShare: settings },
        saveSettings: vi.fn(async () => undefined)
    };
    const onDone = vi.fn();
    const modal = new SceneReleasePreviewModal(app as never, {
        plugin: plugin as never,
        book: { id: 'book-1' },
        scene: { path: PATH, title: '1 Opening', sceneId: 'scn_a1b2c3d4' },
        ...(options.current ? { current: options.current } : {}),
        onDone
    });
    const screen = modal.contentEl as unknown as FakeElement;
    return { modal, screen, note, plugin, onDone };
}

function answerWith(status: number, body: unknown) {
    const request = vi.spyOn(obsidian, 'requestUrl');
    request.mockReset();
    request.mockImplementation((async () => ({ status, text: JSON.stringify(body) })) as never);
    return request;
}

const accepted = () => answerWith(200, {
    release: {
        id: 'release-1', scene_order: 1, scene_title: '1 Opening', stable: true, bound_order: 1, version: 1,
        rating: 'general', words: 7, hidden: false, released_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z'
    }
});

const bodies = (request: ReturnType<typeof vi.spyOn>) =>
    request.mock.calls.map(([options]) => JSON.parse((options as unknown as { body: string }).body) as Record<string, unknown>);

/** The preview pane as plain text, paragraph by paragraph. */
const shown = (screen: FakeElement) => screen.find('ert-scene-release-preview')[0].children.map(paragraph => paragraph.textContent);
const asShown = (blocks: SceneBlock[]) => blocks.map(block => (block.kind === 'break' ? '* * *' : sceneBlockText(block)));

async function opened(h: ReturnType<typeof harness>) {
    h.modal.open();
    await vi.waitFor(() => expect(h.screen.find('ert-scene-release-preview')).toHaveLength(1));
}

describe('the release preview', () => {
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

    it('shows the cleaned text: paragraphs, an italic run as em, a break as * * *', async () => {
        const h = harness();
        accepted();
        await opened(h);
        expect(shown(h.screen)).toEqual(['Mira opened the door.', '* * *', 'It was cold.']);
        const pane = h.screen.find('ert-scene-release-preview')[0];
        expect(pane.all().filter(el => el.tag === 'em').map(el => el.text)).toEqual(['cold']);
        expect(pane.find('ert-scene-release-preview__break')).toHaveLength(1);
        expect(h.screen.content).not.toMatch(/PRIVATE/);
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.previewSubtitle'));
        expect(h.screen.content).toContain('7 words');
    });

    it('offers Release only once a rating is chosen, and says a release reaches nobody yet', async () => {
        const h = harness();
        accepted();
        await opened(h);
        expect(h.screen.buttonNamed(RELEASE).disabled).toBe(true);
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.releaseNote'));
        await h.screen.settings[0].dropdown!.choose('general');
        expect(h.screen.buttonNamed(RELEASE).disabled).toBe(false);
    });

    it('sends exactly the blocks on screen when Release is pressed', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        const onScreen = shown(h.screen);
        await h.screen.settings[0].dropdown!.choose('mature');
        await h.screen.buttonNamed(RELEASE).click();

        const [body] = bodies(request);
        expect(Object.keys(body).sort()).toEqual(['action', 'blocks', 'connection_id', 'current_secret', 'plugin_book_key', 'rating', 'scene_id']);
        expect(body).toMatchObject({ action: 'release', scene_id: 'scn_a1b2c3d4', rating: 'mature' });
        expect(body.blocks).toEqual(sceneBlocksFromNote(FIRST));
        expect(asShown(body.blocks as SceneBlock[])).toEqual(onScreen);
        expect(JSON.stringify(body)).not.toMatch(/PRIVATE/);
        expect(request).toHaveBeenCalledTimes(1);
        expect(notices).toEqual([t('ui.sceneReleaseModal.releasedNotice')]);
        expect(h.onDone).toHaveBeenCalledTimes(1);
        expect(h.modal.isOpen).toBe(false);
    });

    it('sends nothing when the note changed between the preview and the press, and shows the new text', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        await h.screen.settings[0].dropdown!.choose('general');
        const before = shown(h.screen);

        h.note.content = EDITED;
        await h.screen.buttonNamed(RELEASE).click();

        expect(request).not.toHaveBeenCalled();
        expect(h.onDone).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
        expect(h.modal.isOpen).toBe(true);
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.previewChanged'));
        expect(shown(h.screen)).not.toEqual(before);
        expect(shown(h.screen)[2]).toContain('she went in anyway');

        // A second press, with the new text on screen, sends the new text.
        await h.screen.buttonNamed(RELEASE).click();
        const [body] = bodies(request);
        expect(body.blocks).toEqual(sceneBlocksFromNote(EDITED));
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when the note is deleted before the press', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        await h.screen.settings[0].dropdown!.choose('general');
        h.plugin.app.vault.getAbstractFileByPath = () => null;
        await h.screen.buttonNamed(RELEASE).click();
        expect(request).not.toHaveBeenCalled();
        expect(notices).toEqual([t('ui.communityShareClient.sceneNoteMissing')]);
    });

    it('offers no button for a scene with no text after cleaning', async () => {
        const h = harness({ content: '---\nClass: Scene\n---\n%% notes only %%' });
        const request = accepted();
        await opened(h);
        expect(h.screen.content).toContain(t('ui.communityShareClient.sceneReleaseEmpty'));
        expect(h.screen.buttons.map(button => button.text)).toEqual([t('ui.sceneReleaseModal.close')]);
        expect(request).not.toHaveBeenCalled();
    });

    it('offers no button for a scene over 10,000 words, and says so plainly', async () => {
        const paragraph = Array.from({ length: 100 }, () => 'word').join(' ');
        const h = harness({ content: Array.from({ length: 101 }, () => paragraph).join('\n\n') });
        accepted();
        await opened(h);
        expect(h.screen.content).toContain('A scene can be up to 10,000 words');
        expect(h.screen.content).toContain('10,100 words');
        expect(h.screen.buttons.map(button => button.text)).toEqual([t('ui.sceneReleaseModal.close')]);
    });

    it('an update keeps the release\'s rating, names the version it replaces and warns every reader gets it', async () => {
        const h = harness({ current: { version: 3, rating: 'mature' } });
        const request = accepted();
        await opened(h);
        expect(h.screen.content).toContain(t('ui.sceneReleaseModal.updateNote'));
        expect(h.screen.content).not.toContain(t('ui.sceneReleaseModal.releaseNote'));
        await h.screen.buttonNamed(UPDATE).click();
        const [body] = bodies(request);
        expect(body).toMatchObject({ action: 'update', expected_version: 3, rating: 'mature' });
        expect(notices).toEqual([t('ui.sceneReleaseModal.updatedNotice')]);
    });

    it('on a revision conflict, says the release changed on the website and has the list reload', async () => {
        const h = harness({ current: { version: 3, rating: 'general' } });
        const request = answerWith(409, { error: { code: 'revision_conflict', message: 'Changed elsewhere.' } });
        await opened(h);
        await h.screen.buttonNamed(UPDATE).click();
        // One attempt, never retried blindly.
        expect(request).toHaveBeenCalledTimes(1);
        expect(notices).toEqual([t('ui.sceneReleaseModal.revisionConflict')]);
        expect(h.onDone).toHaveBeenCalledTimes(1);
        expect(h.modal.isOpen).toBe(false);
    });

    it('shows the website\'s own message for a refusal, and stays open', async () => {
        const h = harness();
        answerWith(409, { error: { code: 'unknown_scene', message: 'Update the shared timeline first.' } });
        await opened(h);
        await h.screen.settings[0].dropdown!.choose('general');
        await h.screen.buttonNamed(RELEASE).click();
        expect(notices).toEqual(['Update the shared timeline first.']);
        expect(h.onDone).not.toHaveBeenCalled();
        expect(h.modal.isOpen).toBe(true);
        expect(h.screen.buttonNamed(RELEASE).disabled).toBe(false);
    });

    it('sends nothing when sharing is paused after the preview opened', async () => {
        const h = harness();
        const request = accepted();
        await opened(h);
        await h.screen.settings[0].dropdown!.choose('general');
        h.plugin.settings.communityShare.sharingPaused = true;
        await h.screen.buttonNamed(RELEASE).click();
        expect(request).not.toHaveBeenCalled();
        expect(notices).toEqual([t('ui.communityShareClient.sceneReleasePaused')]);
    });
});
