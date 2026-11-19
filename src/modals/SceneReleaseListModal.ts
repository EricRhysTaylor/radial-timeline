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
import { SceneReleaseBatchModal, SceneTakeDownBatchModal, type BatchReleaseScene, type BatchTakeDownScene } from './SceneReleaseBatchModal';
import { ensureReleaseTerms } from './SceneReleaseConsentModal';
import { SceneReleasePreviewModal } from './SceneReleasePreviewModal';
import {
    batchKeyOf,
    batchSelectable,
    batchSelection,
    keepSelectable,
    releasePlacesLeft,
    selectableKeys,
    type SceneBatchKind,
} from './sceneReleaseSelection';

function errorText(error: unknown, fallback: string): string {
    return error instanceof CommunityShareError ? error.message : fallback;
}

function releaseFacts(key: string, release: SceneReleaseSummary): string {
    return t(key, { version: release.version, readers: tCount('reader', release.readers) });
}

/** The row's name in the list, and in a batch confirm. */
function rowName(row: SceneReleaseRow): string {
    return row.state === 'website' ? t('ui.sceneReleaseModal.websiteRelease', { title: row.title }) : row.title;
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
 * Text is sent from the preview or the batch release this opens, never from
 * here. Rows can be checked to release, or take down, several at once.
 */
export class SceneReleaseListModal extends ErtModal {
    private list: SceneReleaseList | null = null;
    private error: string | null = null;
    private busy = false;
    private closed = false;
    private loads = 0;
    /** The checked rows, by batchKeyOf. Kept across a reload while the row is still selectable. */
    private checked = new Set<string>();
    private boxes = new Map<string, HTMLInputElement>();
    private selectEl: HTMLElement | null = null;
    private batchNoteEl: HTMLElement | null = null;
    private batchEl: HTMLElement | null = null;
    /** The focused scene is scrolled to once, on the first list shown; its highlight stays. */
    private scrolledToFocus = false;

    constructor(
        app: App,
        private readonly plugin: RadialTimelinePlugin,
        private readonly book: BookProfile,
        /** The website's releases changed: the settings block rereads its count. */
        private readonly onChanged: () => void,
        /** A scene to scroll to and highlight (the Release scenes link), by its scene id. */
        private readonly focusSceneId?: string
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
        // A failed quiet refresh keeps the list that is on screen.
        if (quiet && !list) return;
        this.list = list;
        this.error = error;
        if (list) this.checked = keepSelectable(list.rows, this.checked, list.status);
        this.render();
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        contentEl.empty();
        this.boxes.clear();
        this.selectEl = null;
        this.batchNoteEl = null;
        this.batchEl = null;
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

        // Select all, above the list so it stays put while the list scrolls.
        this.selectEl = contentEl.createDiv({ cls: 'ert-scene-release-select' });

        const listEl = contentEl.createDiv({ cls: 'ert-scene-release-list' });
        if (rows.length === 0) {
            listEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.listEmpty') });
        }
        const blocked = this.busy || status.standing !== null;
        let focusEl: HTMLElement | null = null;
        for (const row of rows) {
            const setting = new Setting(listEl)
                .setName(rowName(row))
                .setDesc(stateText(row));
            this.mountCheckbox(setting, row);
            const { scene, release } = row;
            const sceneId = scene?.sceneId;
            if (this.focusSceneId && sceneId === this.focusSceneId) {
                setting.settingEl.addClass('ert-scene-release-row--focus');
                focusEl = setting.settingEl;
            }
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

        this.batchNoteEl = contentEl.createDiv({ cls: 'ert-scene-release-batch-note' });
        // The batch bar: its own row above the footer, shown when anything is checked.
        this.batchEl = contentEl.createDiv({ cls: 'ert-scene-release-batch' });
        const actions = this.mountActions();
        actions.createEl('a', {
            text: t('ui.communityShareSection.sceneBodyReadersLink'),
            href: `${COMMUNITY_SITE_URL}/me/scenes/${encodeURIComponent(status.project_id)}`,
            attr: { target: '_blank', rel: 'noopener' },
        });
        this.addClose(actions);
        this.syncBatch();
        if (focusEl && !this.scrolledToFocus) {
            this.scrolledToFocus = true;
            focusEl.scrollIntoView({ block: 'center' });
        }
    }

    /** A checkbox at the start of the row; a spacer on a row that can't join a batch, so the titles line up. */
    private mountCheckbox(setting: Setting, row: SceneReleaseRow): void {
        const list = this.list;
        const key = batchKeyOf(row);
        if (!list || !key) {
            setting.settingEl.prepend(setting.settingEl.createSpan({ cls: 'ert-scene-release-check ert-scene-release-check--none' }));
            return;
        }
        // The checkbox is named by the row's own visible title.
        setting.nameEl.id = `ert-scene-release-name-${key}`;
        const box = setting.settingEl.createEl('input', {
            type: 'checkbox',
            cls: 'ert-scene-release-check',
            attr: { 'aria-labelledby': setting.nameEl.id },
        });
        setting.settingEl.prepend(box);
        box.checked = this.checked.has(key);
        box.disabled = this.busy || !batchSelectable(row, list.status);
        box.addEventListener('change', () => {
            if (box.checked) this.checked.add(key);
            else this.checked.delete(key);
            this.syncBatch();
        });
        this.boxes.set(key, box);
    }

    /**
     * Bring the checkboxes, Select all, the limit note and the batch bar in line
     * with what is checked, in place: the list keeps its scroll position.
     */
    private syncBatch(): void {
        const list = this.list;
        const { selectEl, batchNoteEl, batchEl } = this;
        if (!list || !selectEl || !batchNoteEl || !batchEl) return;
        const { rows, status } = list;
        for (const [key, box] of this.boxes) box.checked = this.checked.has(key);
        const selection = batchSelection(rows, this.checked, status);
        const left = releasePlacesLeft(status);
        const over = selection.release.length - left;

        selectEl.empty();
        const selectAll = (kind: SceneBatchKind, label: string) => {
            const keys = selectableKeys(rows, kind, status);
            if (keys.length === 0) return;
            new ButtonComponent(selectEl)
                .setButtonText(label)
                .setDisabled(this.busy)
                .onClick(() => {
                    for (const key of keys) this.checked.add(key);
                    this.syncBatch();
                });
        };
        selectAll('release', t('ui.sceneReleaseModal.selectUnreleased'));
        selectAll('takeDown', t('ui.sceneReleaseModal.selectReleased'));
        if (this.checked.size > 0) {
            new ButtonComponent(selectEl)
                .setButtonText(t('ui.sceneReleaseModal.selectNone'))
                .setDisabled(this.busy)
                .onClick(() => {
                    this.checked.clear();
                    this.syncBatch();
                });
        }

        batchNoteEl.empty();
        if (over > 0) {
            batchNoteEl.createDiv({
                cls: ERT_CLASSES.FIELD_NOTE,
                text: t('ui.sceneReleaseModal.batchOverLimit', { left: tCount('scene', left), over: tCount('scene', over) }),
            });
        }

        batchEl.empty();
        if (selection.release.length > 0) {
            new ButtonComponent(batchEl)
                .setButtonText(t('ui.sceneReleaseModal.batchRelease', { scenes: tCount('scene', selection.release.length) }))
                .setCta()
                .setDisabled(this.busy || over > 0)
                .onClick(() => this.releaseChecked());
        }
        if (selection.takeDown.length > 0) {
            new ButtonComponent(batchEl)
                .setButtonText(t('ui.sceneReleaseModal.batchTakeDown', { scenes: tCount('scene', selection.takeDown.length) }))
                .setDisabled(this.busy)
                .onClick(() => this.takeDownChecked());
        }
    }

    /** Release N scenes: the release terms first if they are not on record, then one confirm for all. */
    private async releaseChecked(): Promise<void> {
        const list = this.list;
        if (!list || this.busy) return;
        const scenes: BatchReleaseScene[] = batchSelection(list.rows, this.checked, list.status).release.flatMap(row => {
            const sceneId = row.scene?.sceneId;
            return row.scene && sceneId ? [{ path: row.scene.path, title: row.scene.title, sceneId }] : [];
        });
        if (scenes.length === 0 || scenes.length > releasePlacesLeft(list.status)) return;
        // Busy from the first press: recording the terms awaits the network, and a
        // second press in that window would open a second batch for the same scenes.
        this.busy = true;
        try {
            if (!await ensureReleaseTerms(this.plugin, this.book, list.status)) {
                this.busy = false;
                return;
            }
        } catch (error) {
            this.busy = false;
            new Notice(errorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
            return;
        }
        if (this.list === list) this.list = { ...list, status: { ...list.status, consent: true } };
        new SceneReleaseBatchModal(this.app, {
            plugin: this.plugin,
            book: this.book,
            scenes,
            onDone: ran => this.batchDone(ran),
        }).open();
    }

    /** Take down N scenes: one confirm naming them, then each in turn. */
    private takeDownChecked(): void {
        const list = this.list;
        if (!list || this.busy) return;
        const scenes: BatchTakeDownScene[] = batchSelection(list.rows, this.checked, list.status).takeDown.flatMap(row => (
            row.release ? [{ title: rowName(row), release: row.release }] : []
        ));
        if (scenes.length === 0) return;
        this.busy = true;
        new SceneTakeDownBatchModal(this.app, {
            plugin: this.plugin,
            book: this.book,
            scenes,
            onDone: ran => this.batchDone(ran),
        }).open();
    }

    private batchDone(ran: boolean): void {
        this.busy = false;
        if (!ran) return;
        this.checked.clear();
        this.changed();
    }

    private addClose(actions: HTMLElement): void {
        new ButtonComponent(actions)
            .setButtonText(t('ui.sceneReleaseModal.close'))
            .onClick(() => this.close());
    }

    private openPreview(scene: { path: string; title: string; sceneId: string }, current?: SceneReleaseSummary): void {
        if (this.busy) return;
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
            message: release.hidden
                ? `${t('ui.sceneReleaseModal.takeDownHiddenMessage')} ${t('ui.sceneReleaseModal.takeDownHiddenConsequence')}`
                : t('ui.sceneReleaseModal.takeDownMessage'),
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
