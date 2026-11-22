/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Send scene to Community: the vault's answer to a scene asked for on
 * Community (contract 2026-11-22, "Scene text asked on Community, sent from
 * the vault"). It shows exactly what would be sent: the book, the scene, the
 * rating and readers chosen on Community, the word count, and the text as
 * readers will see it. Then Send or Decline.
 *
 * The scene's text leaves the vault here and nowhere else, on the press of
 * Send. The blocks on screen are the blocks that are sent. If the note changed
 * between showing them and the press, nothing is sent and the new text is
 * shown instead.
 */

import { App, ButtonComponent, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { CommunityShareError, sceneTextProblemMessage, type SceneReleaseStatus } from '../communityShare/communityShareClient';
import type { SceneBlock } from '../communityShare/sceneReleaseText';
import { declineSceneTextRequest, sendRequestedScene, type SceneTextRequest } from '../communityShare/sceneTextRequests';
import { readSceneReleaseDraft, type SceneReleaseDraft } from '../communityShare/sceneReleaseVault';
import { t } from '../i18n';
import type { BookProfile } from '../types/settings';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';
import { ensureReleaseTerms } from './SceneReleaseConsentModal';

export interface SceneTextSendOptions {
    plugin: RadialTimelinePlugin;
    book: Pick<BookProfile, 'id' | 'title' | 'publicLabel'>;
    request: SceneTextRequest;
    /** The vault's note for the scene; absent when this book has no such scene. */
    scenePath?: string;
    /** The website's status: whether it holds the author's agreement to the release terms. */
    status: Pick<SceneReleaseStatus, 'consent'>;
    /** The request was answered, or may have been: read the book's state again. */
    onDone: () => void;
}

/** After these refusals the request on screen no longer matches the website. */
const STATE_OUT_OF_DATE = new Set([
    'revision_conflict', 'already_released', 'not_found', 'scene_under_review', 'scene_limit_reached',
    'request_not_found', 'request_canceled', 'request_expired', 'request_declined', 'request_sent', 'request_mismatch',
]);

/** The blocks as paragraphs, an italic run as `em`, a break as a centered "* * *". */
export function renderSceneBlocks(parent: HTMLElement, blocks: readonly SceneBlock[]): void {
    for (const block of blocks) {
        if (block.kind === 'break') {
            parent.createEl('p', { cls: 'ert-scene-release-preview__break', text: '* * *' });
            continue;
        }
        const paragraph = parent.createEl('p');
        for (const run of block.runs) {
            if (typeof run === 'string') paragraph.appendText(run);
            else paragraph.createEl('em', { text: run.em });
        }
    }
}

export class SceneTextSendModal extends ErtModal {
    private draft: SceneReleaseDraft | null = null;
    private loadError: string | null = null;
    private changed = false;
    private busy = false;
    private closed = false;
    private buttons: ButtonComponent[] = [];

    constructor(app: App, private readonly options: SceneTextSendOptions) {
        super(app);
    }

    onOpen(): void {
        this.applyShell({ width: 'min(660px, 92vw)', containerClasses: ['ert-scene-text-send'] });
        this.render();
        void this.load();
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.empty();
    }

    private async load(): Promise<void> {
        const { scenePath } = this.options;
        if (!scenePath) {
            this.loadError = t('ui.sceneReleaseModal.sendSceneMissing');
        } else {
            try {
                this.draft = await readSceneReleaseDraft(this.app, scenePath);
            } catch (error) {
                this.loadError = error instanceof CommunityShareError ? error.message : t('ui.communityShareClient.sceneNoteMissing');
            }
        }
        this.render();
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        const { request, book } = this.options;
        contentEl.empty();
        this.buttons = [];
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.sendBadge', { title: request.scene_title }) },
            title: t('ui.sceneReleaseModal.sendTitle'),
            // An update replaces what readers have; a first release needs no line.
            ...(request.kind === 'update' ? { subtitle: t('ui.sceneReleaseModal.sendSubtitleUpdate') } : {}),
        });

        const draft = this.draft;
        const figures = contentEl.createDiv({ cls: 'ert-gossamer-proc-stats ert-scene-text-send__figures' });
        for (const [label, value] of [
            [t('ui.sceneReleaseModal.figureWords'), draft ? draft.words.toLocaleString() : '…'],
            [t('ui.sceneReleaseModal.figureRating'), t(request.rating === 'mature' ? 'ui.sceneReleaseModal.ratingMature' : 'ui.sceneReleaseModal.ratingGeneral')],
            [t('ui.sceneReleaseModal.figureReaders'), t(request.audience === 'public' ? 'ui.sceneReleaseModal.readersPublic' : 'ui.sceneReleaseModal.readersNamed')],
            [t('ui.sceneReleaseModal.figureBook'), book.publicLabel || book.title], // SAFE: the public label is optional; the book's own title is always set
        ]) {
            const cell = figures.createDiv({ cls: 'ert-gossamer-proc-stat-item' });
            cell.createDiv({ cls: 'ert-gossamer-proc-stat-label', text: label });
            cell.createDiv({ cls: 'ert-gossamer-proc-stat-value', text: value });
        }

        const actions = (): HTMLElement => this.mountActions();
        if (!draft) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: this.loadError ?? t('ui.sceneReleaseModal.previewLoading') });
            if (this.loadError) this.mountDecline(actions());
            return;
        }
        if (this.changed) contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.previewChanged') });
        contentEl.createDiv({ cls: 'ert-scene-text-send__label', text: t('ui.sceneReleaseModal.textLabel') });
        renderSceneBlocks(contentEl.createDiv({ cls: 'ert-scene-release-preview' }), draft.blocks);
        if (draft.problem) contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: sceneTextProblemMessage(draft.problem) });

        const row = actions();
        this.mountDecline(row);
        if (!draft.problem) {
            this.buttons.push(new ButtonComponent(row)
                .setButtonText(t('ui.sceneReleaseModal.sendButton'))
                .setCta()
                .onClick(() => this.send(draft)));
        }
        this.syncButtons();
    }

    private mountDecline(row: HTMLElement): void {
        this.buttons.push(new ButtonComponent(row)
            .setButtonText(t('ui.sceneReleaseModal.declineButton'))
            .onClick(() => this.decline()));
        this.syncButtons();
    }

    /** Send and Decline wait for an answer already on its way. */
    private syncButtons(): void {
        for (const button of this.buttons) button.setDisabled(this.busy);
    }

    private async decline(): Promise<void> {
        const { plugin, book, request } = this.options;
        if (this.busy) return;
        this.busy = true;
        this.syncButtons();
        try {
            await declineSceneTextRequest(plugin, book, request.id);
        } catch (error) {
            new Notice(error instanceof CommunityShareError ? error.message : t('ui.sceneReleaseModal.declineFailed'));
            this.busy = false;
            this.syncButtons();
            return;
        }
        new Notice(t('ui.sceneReleaseModal.declinedNotice'));
        this.finish();
    }

    /** Send: the one place scene text leaves the vault. */
    private async send(previewed: SceneReleaseDraft): Promise<void> {
        const { plugin, book, request, status, scenePath } = this.options;
        if (this.busy || previewed.problem || !scenePath) return;
        this.busy = true;
        this.syncButtons();
        try {
            // The author approved the text on screen. If the note has changed
            // since, neither text goes: the new one is shown for a fresh look.
            const now = await readSceneReleaseDraft(this.app, scenePath);
            if (now.hash !== previewed.hash) {
                this.draft = now;
                this.changed = true;
                this.busy = false;
                this.render();
                return;
            }
            if (!await ensureReleaseTerms(plugin, book, status)) {
                this.busy = false;
                this.syncButtons();
                return;
            }
            await sendRequestedScene(plugin, book, { request, blocks: previewed.blocks });
        } catch (error) {
            const code = error instanceof CommunityShareError ? error.code : '';
            new Notice(code === 'revision_conflict'
                ? t('ui.sceneReleaseModal.revisionConflict')
                : error instanceof CommunityShareError ? error.message : t('ui.sceneReleaseModal.sendFailed'));
            this.busy = false;
            if (STATE_OUT_OF_DATE.has(code)) this.finish();
            else this.syncButtons();
            return;
        }
        new Notice(t(request.kind === 'update' ? 'ui.sceneReleaseModal.updatedNotice' : 'ui.sceneReleaseModal.sentNotice'));
        this.finish();
    }

    /** Close, unless the author already did, and have Settings read the book's state again. */
    private finish(): void {
        if (!this.closed) this.close();
        this.options.onDone();
    }
}
