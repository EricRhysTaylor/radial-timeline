/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent, Notice, Setting } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
    CommunityShareError,
    releaseSceneBody,
    sceneTextProblemMessage,
    type SceneReleaseRating,
} from '../communityShare/communityShareClient';
import type { SceneBlock } from '../communityShare/sceneReleaseText';
import { readSceneReleaseDraft, type SceneReleaseDraft } from '../communityShare/sceneReleaseVault';
import { t, tCount } from '../i18n';
import type { BookProfile } from '../types/settings';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';

export interface SceneReleasePreviewOptions {
    plugin: RadialTimelinePlugin;
    book: Pick<BookProfile, 'id'>;
    scene: { path: string; title: string; sceneId: string };
    /** The release this replaces, from the website's status; absent for a first release. */
    current?: { version: number; rating: SceneReleaseRating };
    /** The website's releases changed, or may have: reload the list. */
    onDone: () => void;
}

/** After these refusals the list on screen no longer matches the website. */
const LIST_OUT_OF_DATE = new Set(['revision_conflict', 'already_released', 'not_found', 'scene_under_review', 'scene_limit_reached']);

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

/**
 * The preview before a release or an update: exactly what readers will see.
 *
 * The scene's text leaves the vault here and nowhere else, on the press of the
 * one primary button. The blocks on screen are the blocks that are sent. If the
 * note changed between showing them and the press, nothing is sent and the new
 * text is shown instead.
 */
export class SceneReleasePreviewModal extends ErtModal {
    private draft: SceneReleaseDraft | null = null;
    private loadError: string | null = null;
    private changed = false;
    private sending = false;
    private closed = false;
    private rating: SceneReleaseRating | '';
    private primary: ButtonComponent | null = null;

    constructor(app: App, private readonly options: SceneReleasePreviewOptions) {
        super(app);
        this.rating = options.current ? options.current.rating : '';
    }

    onOpen(): void {
        this.applyShell({ width: 'min(660px, 92vw)' });
        this.render();
        void this.load();
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.empty();
    }

    private async load(): Promise<void> {
        try {
            this.draft = await readSceneReleaseDraft(this.app, this.options.scene.path);
        } catch (error) {
            this.loadError = error instanceof CommunityShareError ? error.message : t('ui.communityShareClient.sceneNoteMissing');
        }
        this.render();
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        const { scene, current } = this.options;
        contentEl.empty();
        this.primary = null;
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.badge') },
            title: scene.title,
            subtitle: t('ui.sceneReleaseModal.previewSubtitle'),
        });

        const draft = this.draft;
        if (!draft) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: this.loadError ?? t('ui.sceneReleaseModal.previewLoading') });
            this.mountClose();
            return;
        }

        if (this.changed) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.previewChanged') });
        }
        renderSceneBlocks(contentEl.createDiv({ cls: 'ert-scene-release-preview' }), draft.blocks);
        contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: tCount('word', draft.words) });

        if (draft.problem) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: sceneTextProblemMessage(draft.problem) });
            this.mountClose();
            return;
        }

        const ratingRow = new Setting(contentEl)
            .setName(t('ui.sceneReleaseModal.ratingName'))
            .addDropdown(dropdown => {
                if (!current) dropdown.addOption('', t('ui.sceneReleaseModal.ratingChoose'));
                dropdown.addOption('general', t('ui.sceneReleaseModal.ratingGeneral'));
                dropdown.addOption('mature', t('ui.sceneReleaseModal.ratingMature'));
                dropdown.setValue(this.rating);
                dropdown.onChange(value => {
                    this.rating = value === 'general' || value === 'mature' ? value : '';
                    this.syncPrimary();
                });
            });
        ratingRow.descEl.createDiv({ text: t('ui.sceneReleaseModal.ratingGeneralDesc') });
        ratingRow.descEl.createDiv({ text: t('ui.sceneReleaseModal.ratingMatureDesc') });
        ratingRow.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.ratingNote') });

        contentEl.createDiv({
            cls: ERT_CLASSES.FIELD_NOTE,
            text: current ? t('ui.sceneReleaseModal.updateNote') : t('ui.sceneReleaseModal.releaseNote'),
        });

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
        this.primary = new ButtonComponent(actions)
            .setButtonText(current ? t('ui.sceneReleaseModal.updateButton') : t('ui.sceneReleaseModal.releaseButton'))
            .setCta()
            .onClick(() => this.send(draft));
        this.syncPrimary();
    }

    /** Release / Update waits for a rating, and for a send already on its way. */
    private syncPrimary(): void {
        this.primary?.setDisabled(!this.rating || this.sending);
    }

    private mountClose(): void {
        new ButtonComponent(this.mountActions())
            .setButtonText(t('ui.sceneReleaseModal.close'))
            .onClick(() => this.close());
    }

    /** The primary button: the one place scene text is sent from. */
    private async send(previewed: SceneReleaseDraft): Promise<void> {
        const { plugin, book, scene, current } = this.options;
        const rating = this.rating;
        if (this.sending || previewed.problem || !rating) return;
        this.sending = true;
        this.syncPrimary();
        try {
            // The author approved the text on screen. If the note has changed
            // since, neither text goes: the new one is shown for a fresh look.
            const now = await readSceneReleaseDraft(this.app, scene.path);
            if (now.hash !== previewed.hash) {
                this.draft = now;
                this.changed = true;
                this.sending = false;
                this.render();
                return;
            }
            await releaseSceneBody(plugin, book, {
                sceneId: scene.sceneId,
                rating,
                blocks: previewed.blocks,
                ...(current ? { expectedVersion: current.version } : {}),
            });
        } catch (error) {
            const code = error instanceof CommunityShareError ? error.code : '';
            new Notice(code === 'revision_conflict'
                ? t('ui.sceneReleaseModal.revisionConflict')
                : error instanceof CommunityShareError ? error.message : t('ui.sceneReleaseModal.sendFailed'));
            this.sending = false;
            if (LIST_OUT_OF_DATE.has(code)) this.finish();
            else this.syncPrimary();
            return;
        }
        new Notice(current ? t('ui.sceneReleaseModal.updatedNotice') : t('ui.sceneReleaseModal.releasedNotice'));
        this.finish();
    }

    /** Close, unless the author already did, and have the list reload from the website. */
    private finish(): void {
        if (!this.closed) this.close();
        this.options.onDone();
    }
}
