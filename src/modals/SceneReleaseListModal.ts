/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent, Notice, Setting } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { CommunityShareError, takeDownSceneRelease, type SceneReleaseSummary } from '../communityShare/communityShareClient';
import { COMMUNITY_SITE_URL } from '../communityShare/communityMailbox';
import { loadSceneReleaseList, type SceneReleaseList, type SceneReleaseRow } from '../communityShare/sceneReleaseVault';
import { t, tCount } from '../i18n';
import type { BookProfile } from '../types/settings';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';
import { confirmWithErtModal } from './ErtConfirmModal';
import { SceneReleasePreviewModal } from './SceneReleasePreviewModal';

function errorText(error: unknown, fallback: string): string {
    return error instanceof CommunityShareError ? error.message : fallback;
}

function releaseFacts(key: string, release: SceneReleaseSummary): string {
    return t(key, { version: release.version, readers: tCount('reader', release.readers) });
}

function stateText(row: SceneReleaseRow): string {
    const release = row.release;
    if (row.state === 'unavailable') {
        return row.scene?.idProblem === 'duplicate'
            ? t('ui.sceneReleaseModal.stateDuplicateSceneId')
            : t('ui.sceneReleaseModal.stateNoSceneId');
    }
    if (!release) return t('ui.sceneReleaseModal.stateNotReleased');
    if (release.hidden) return t('ui.sceneReleaseModal.stateHidden');
    return row.state === 'changed'
        ? releaseFacts('ui.sceneReleaseModal.stateChanged', release)
        : releaseFacts('ui.sceneReleaseModal.stateReleased', release);
}

/**
 * Release scenes: the active book's scenes in manuscript order, each with its
 * one state from the website's status. Opening it sends a status request (no
 * text) and reads the notes of released scenes only, to tell which changed.
 * Text is sent from the preview this opens, never from here.
 */
export class SceneReleaseListModal extends ErtModal {
    private list: SceneReleaseList | null = null;
    private error: string | null = null;
    private busy = false;
    private closed = false;
    private loads = 0;

    constructor(
        app: App,
        private readonly plugin: RadialTimelinePlugin,
        private readonly book: BookProfile,
        /** The website's releases changed: the settings block rereads its count. */
        private readonly onChanged: () => void
    ) {
        super(app);
    }

    onOpen(): void {
        // One scroll area, the list: the header, count and footer stay put in a short window.
        this.applyShell({ width: 'min(660px, 92vw)', shellClasses: ['ert-modal--scene-release-list'] });
        // Readers are chosen on the website: coming back to Obsidian rereads the status, so the
        // reader counts are the website's, not the ones from when the dialog opened.
        this.contentEl.ownerDocument.win.addEventListener('focus', this.onWindowFocus);
        void this.reload();
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.ownerDocument.win.removeEventListener('focus', this.onWindowFocus);
        this.contentEl.empty();
    }

    private readonly onWindowFocus = (): void => {
        // Not while loading or while a take-down runs: those reread the status when they finish.
        if (this.closed || this.busy || !this.list) return;
        void this.reload(true);
    };

    /** `quiet`: keep the list on screen while the new status loads (a refresh, not a first load). */
    private async reload(quiet = false): Promise<void> {
        const load = ++this.loads;
        if (!quiet) {
            this.list = null;
            this.error = null;
            this.render();
        }
        let list: SceneReleaseList | null = null;
        let error: string | null = null;
        try {
            list = await loadSceneReleaseList(this.plugin, this.book);
        } catch (caught) {
            error = errorText(caught, t('ui.sceneReleaseModal.listFailed'));
        }
        // A newer reload owns the dialog now.
        if (load !== this.loads) return;
        this.list = list;
        this.error = error;
        this.render();
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        contentEl.empty();
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.badge') },
            title: t('ui.sceneReleaseModal.listTitle'),
            subtitle: t('ui.sceneReleaseModal.listSubtitle', { book: this.book.title }),
        });

        const list = this.list;
        if (!list) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: this.error ?? t('ui.sceneReleaseModal.listLoading') });
            const actions = this.mountActions();
            if (this.error) {
                new ButtonComponent(actions)
                    .setButtonText(t('ui.sceneReleaseModal.listRetry'))
                    .onClick(() => this.reload());
            }
            this.addClose(actions);
            return;
        }

        const { status, rows } = list;
        const atLimit = status.releases.length >= status.limit;
        contentEl.createDiv({ text: t('ui.sceneReleaseModal.listCount', { count: status.releases.length, limit: status.limit }) });
        if (atLimit) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.listAtLimit') });
        }
        if (status.standing) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.sceneBodyStandingNote') });
        }

        const listEl = contentEl.createDiv({ cls: 'ert-scene-release-list' });
        if (rows.length === 0) {
            listEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.listEmpty') });
        }
        const blocked = this.busy || status.standing !== null;
        for (const row of rows) {
            const setting = new Setting(listEl)
                .setName(row.state === 'website' ? t('ui.sceneReleaseModal.websiteRelease', { title: row.title }) : row.title)
                .setDesc(stateText(row));
            const { scene, release } = row;
            const sceneId = scene?.sceneId;
            if (row.state === 'not_released' && scene && sceneId) {
                setting.addButton(button => button
                    .setButtonText(t('ui.sceneReleaseModal.previewAndRelease'))
                    .setDisabled(blocked || atLimit)
                    .onClick(() => this.openPreview({ path: scene.path, title: scene.title, sceneId })));
            }
            if (row.state === 'changed' && scene && sceneId && release) {
                setting.addButton(button => button
                    .setButtonText(t('ui.sceneReleaseModal.previewAndUpdate'))
                    .setDisabled(blocked)
                    .onClick(() => this.openPreview({ path: scene.path, title: scene.title, sceneId }, release)));
            }
            if (release) {
                setting.addButton(button => button
                    .setButtonText(t('ui.sceneReleaseModal.takeDown'))
                    .setDisabled(this.busy)
                    .onClick(() => this.takeDown(row.title, release)));
            }
        }

        const actions = this.mountActions();
        actions.createEl('a', {
            text: t('ui.communityShareSection.sceneBodyReadersLink'),
            href: `${COMMUNITY_SITE_URL}/me/scenes/${encodeURIComponent(status.project_id)}`,
            attr: { target: '_blank', rel: 'noopener' },
        });
        this.addClose(actions);
    }

    private addClose(actions: HTMLElement): void {
        new ButtonComponent(actions)
            .setButtonText(t('ui.sceneReleaseModal.close'))
            .onClick(() => this.close());
    }

    private openPreview(scene: { path: string; title: string; sceneId: string }, current?: SceneReleaseSummary): void {
        new SceneReleasePreviewModal(this.app, {
            plugin: this.plugin,
            book: this.book,
            scene,
            ...(current ? { current: { version: current.version, rating: current.rating } } : {}),
            onDone: () => this.changed(),
        }).open();
    }

    private async takeDown(title: string, release: SceneReleaseSummary): Promise<void> {
        const confirmed = await confirmWithErtModal(this.app, {
            title: t('ui.sceneReleaseModal.takeDownTitle', { title }),
            // Taking down a scene that is hidden after a report has a consequence on the website: say it first.
            message: t(release.hidden ? 'ui.sceneReleaseModal.takeDownHiddenMessage' : 'ui.sceneReleaseModal.takeDownMessage'),
            confirmText: t('ui.sceneReleaseModal.takeDown'),
        });
        if (!confirmed || this.busy) return;
        this.busy = true;
        this.render();
        try {
            await takeDownSceneRelease(this.plugin, this.book, release.id);
            new Notice(t('ui.sceneReleaseModal.takenDownNotice'));
        } catch (error) {
            new Notice(errorText(error, t('ui.sceneReleaseModal.takeDownFailed')));
        }
        this.busy = false;
        // A refusal can mean the website's state moved, so both paths reread it.
        this.changed();
    }

    private changed(): void {
        this.onChanged();
        if (!this.closed) void this.reload();
    }
}
