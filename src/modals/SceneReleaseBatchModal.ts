/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Release scenes, several at once: the confirm step for the scenes checked in
 * the list, then each sent one at a time, then a line saying how it went.
 *
 * The batch release reads the note of each checked scene when it opens and
 * shows its title and word count. On the press each note is read again; a
 * scene whose cleaned text is not the text read when the dialog opened is not
 * sent and is named in the result. Nothing runs before the press.
 */

import { App, ButtonComponent, Notice, Setting } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
    CommunityShareError,
    releaseSceneBody,
    sceneTextProblemMessage,
    takeDownSceneRelease,
    type SceneReleaseRating,
    type SceneReleaseSummary,
} from '../communityShare/communityShareClient';
import { readSceneReleaseDraft, type SceneReleaseDraft } from '../communityShare/sceneReleaseVault';
import { t, tCount } from '../i18n';
import type { BookProfile } from '../types/settings';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';
import { mountRatingChoice } from './SceneReleasePreviewModal';

/** One scene's result: null when it went through, else why not, in the author's words. */
export interface SceneBatchOutcome {
    title: string;
    reason: string | null;
}

type BatchPhase = 'confirm' | 'running' | 'done';

function errorText(error: unknown, fallback: string): string {
    return error instanceof CommunityShareError ? error.message : fallback;
}

/** "Released 2 of 3." and one line for each scene that did not go. */
export function batchResultLines(resultKey: string, outcomes: readonly SceneBatchOutcome[]): string[] {
    const done = outcomes.filter(outcome => outcome.reason === null).length;
    return [
        t(resultKey, { done, total: outcomes.length }),
        ...outcomes.flatMap(outcome => (outcome.reason === null
            ? []
            : [t('ui.sceneReleaseModal.batchFailure', { title: outcome.title, reason: outcome.reason })])),
    ];
}

function renderResult(parent: HTMLElement, lines: readonly string[]): void {
    const [summary, ...failures] = lines;
    const result = parent.createDiv({ cls: 'ert-scene-release-batch-result' });
    result.createDiv({ text: summary });
    for (const failure of failures) result.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: failure });
}

export interface BatchReleaseScene {
    path: string;
    title: string;
    sceneId: string;
}

export interface SceneReleaseBatchOptions {
    plugin: RadialTimelinePlugin;
    book: Pick<BookProfile, 'id'>;
    /** The checked unreleased scenes, in list order. The list has already checked they fit the limit. */
    scenes: readonly BatchReleaseScene[];
    /** Called once: after the batch ran (true), or when the dialog closed with nothing sent (false). */
    onDone: (ran: boolean) => void;
}

interface ReleaseEntry {
    scene: BatchReleaseScene;
    draft: SceneReleaseDraft | null;
    /** Why this scene can't be released as it is, or null. */
    problem: string | null;
}

export class SceneReleaseBatchModal extends ErtModal {
    private entries: ReleaseEntry[] | null = null;
    private rating: SceneReleaseRating = 'general';
    private phase: BatchPhase = 'confirm';
    private sentCount = 0;
    private outcomes: SceneBatchOutcome[] = [];
    private primary: ButtonComponent | null = null;
    private closed = false;
    private settled = false;

    constructor(app: App, private readonly options: SceneReleaseBatchOptions) {
        super(app);
    }

    onOpen(): void {
        this.applyShell({ width: 'min(560px, 92vw)', shellClasses: ['ert-modal--scene-release-batch'] });
        this.render();
        void this.load();
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.empty();
        // While running, the batch finishes and settles on its own.
        if (this.phase === 'confirm') this.settle(false);
    }

    private settle(ran: boolean): void {
        if (this.settled) return;
        this.settled = true;
        this.options.onDone(ran);
    }

    private async load(): Promise<void> {
        const entries: ReleaseEntry[] = [];
        for (const scene of this.options.scenes) {
            try {
                const draft = await readSceneReleaseDraft(this.app, scene.path);
                entries.push({ scene, draft, problem: draft.problem ? sceneTextProblemMessage(draft.problem) : null });
            } catch (error) {
                entries.push({ scene, draft: null, problem: errorText(error, t('ui.communityShareClient.sceneNoteMissing')) });
            }
        }
        this.entries = entries;
        this.render();
    }

    private sendable(): ReleaseEntry[] {
        return (this.entries ?? []).filter(entry => entry.draft && !entry.problem);
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        contentEl.empty();
        this.primary = null;
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.badge') },
            title: t('ui.sceneReleaseModal.batchRelease', { scenes: tCount('scene', this.options.scenes.length) }),
        });

        const entries = this.entries;
        if (!entries) {
            contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.batchReading') });
            this.mountButton(t('common.cancel'));
            return;
        }

        const listEl = contentEl.createDiv({ cls: 'ert-scene-release-batch-list' });
        for (const entry of entries) {
            const row = new Setting(listEl).setName(entry.scene.title);
            if (entry.draft) row.setDesc(tCount('word', entry.draft.words));
            if (entry.problem) row.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: entry.problem });
        }

        if (this.phase === 'done') {
            renderResult(contentEl, batchResultLines('ui.sceneReleaseModal.batchReleaseResult', this.outcomes));
            this.mountButton(t('ui.sceneReleaseModal.close'));
            return;
        }

        const sendable = this.sendable().length;
        if (sendable === 0) {
            this.mountButton(t('ui.sceneReleaseModal.close'));
            return;
        }
        mountRatingChoice(contentEl, this.rating, rating => { this.rating = rating; });
        contentEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.sceneReleaseModal.batchReleaseNote') });

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
        this.primary = new ButtonComponent(actions)
            .setButtonText(t('ui.sceneReleaseModal.batchRelease', { scenes: tCount('scene', sendable) }))
            .setCta()
            .onClick(() => this.send());
        this.syncPrimary();
    }

    private mountButton(label: string): void {
        new ButtonComponent(this.mountActions())
            .setButtonText(label)
            .onClick(() => this.close());
    }

    /** While sending, the button says how far it has got and can't be pressed again. */
    private syncPrimary(): void {
        if (!this.primary || this.phase !== 'running') return;
        this.primary
            .setDisabled(true)
            .setButtonText(t('ui.sceneReleaseModal.batchReleasing', { done: this.sentCount, total: this.sendable().length }));
    }

    /** The primary button: each scene in turn, one request at a time. */
    private async send(): Promise<void> {
        const entries = this.entries;
        if (this.phase !== 'confirm' || !entries) return;
        const rating = this.rating;
        this.phase = 'running';
        const outcomes: SceneBatchOutcome[] = [];
        for (const entry of entries) {
            if (!entry.draft || entry.problem) {
                outcomes.push({ title: entry.scene.title, reason: entry.problem });
                continue;
            }
            this.sentCount += 1;
            this.syncPrimary();
            outcomes.push({ title: entry.scene.title, reason: await this.releaseOne(entry.scene, entry.draft, rating) });
        }
        this.outcomes = outcomes;
        this.phase = 'done';
        if (this.closed) new Notice(batchResultLines('ui.sceneReleaseModal.batchReleaseResult', outcomes).join('\n'));
        this.render();
        this.settle(true);
    }

    /** Release one scene with the text read when the dialog opened; null when it went through. */
    private async releaseOne(scene: BatchReleaseScene, confirmed: SceneReleaseDraft, rating: SceneReleaseRating): Promise<string | null> {
        try {
            // The author confirmed the scene as read when this dialog opened. If
            // the note has changed since, neither text goes.
            const now = await readSceneReleaseDraft(this.app, scene.path);
            if (now.hash !== confirmed.hash) return t('ui.sceneReleaseModal.batchChanged');
            await releaseSceneBody(this.options.plugin, this.options.book, {
                sceneId: scene.sceneId,
                rating,
                blocks: confirmed.blocks,
            });
            return null;
        } catch (error) {
            return errorText(error, t('ui.sceneReleaseModal.sendFailed'));
        }
    }
}

export interface BatchTakeDownScene {
    title: string;
    release: SceneReleaseSummary;
}

export interface SceneTakeDownBatchOptions {
    plugin: RadialTimelinePlugin;
    book: Pick<BookProfile, 'id'>;
    /** The checked released scenes, in list order. */
    scenes: readonly BatchTakeDownScene[];
    /** Called once: after the batch ran (true), or when the dialog closed with nothing taken down (false). */
    onDone: (ran: boolean) => void;
}

/** Take down, several at once: the single take-down's own words, said once, then each in turn. */
export class SceneTakeDownBatchModal extends ErtModal {
    private phase: BatchPhase = 'confirm';
    private doneCount = 0;
    private outcomes: SceneBatchOutcome[] = [];
    private primary: ButtonComponent | null = null;
    private closed = false;
    private settled = false;

    constructor(app: App, private readonly options: SceneTakeDownBatchOptions) {
        super(app);
    }

    onOpen(): void {
        this.applyShell({ width: 'min(560px, 92vw)', shellClasses: ['ert-modal--scene-release-batch'] });
        this.render();
    }

    onClose(): void {
        this.closed = true;
        this.contentEl.empty();
        if (this.phase === 'confirm') this.settle(false);
    }

    private settle(ran: boolean): void {
        if (this.settled) return;
        this.settled = true;
        this.options.onDone(ran);
    }

    private render(): void {
        if (this.closed) return;
        const { contentEl } = this;
        const { scenes } = this.options;
        contentEl.empty();
        this.primary = null;
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.badge') },
            title: t('ui.sceneReleaseModal.batchTakeDownTitle', { scenes: tCount('scene', scenes.length) }),
        });

        const listEl = contentEl.createDiv({ cls: 'ert-scene-release-batch-list' });
        for (const scene of scenes) new Setting(listEl).setName(scene.title);

        if (this.phase === 'done') {
            renderResult(contentEl, batchResultLines('ui.sceneReleaseModal.batchTakeDownResult', this.outcomes));
            new ButtonComponent(this.mountActions())
                .setButtonText(t('ui.sceneReleaseModal.close'))
                .onClick(() => this.close());
            return;
        }

        contentEl.createDiv({ text: t('ui.sceneReleaseModal.takeDownMessage') });
        // Taking down a scene that is hidden after a report has a consequence on the website: said once, as the single take-down says it.
        const hidden = scenes.filter(scene => scene.release.hidden);
        if (hidden.length > 0) {
            contentEl.createDiv({ text: t('ui.sceneReleaseModal.batchTakeDownHidden', { titles: hidden.map(scene => scene.title).join(', ') }) });
            contentEl.createDiv({ text: t('ui.sceneReleaseModal.takeDownHiddenConsequence') });
        }

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
        this.primary = new ButtonComponent(actions)
            .setButtonText(t('ui.sceneReleaseModal.batchTakeDown', { scenes: tCount('scene', scenes.length) }))
            .setCta()
            .onClick(() => this.run());
    }

    private syncPrimary(): void {
        if (!this.primary || this.phase !== 'running') return;
        this.primary
            .setDisabled(true)
            .setButtonText(t('ui.sceneReleaseModal.batchTakingDown', { done: this.doneCount, total: this.options.scenes.length }));
    }

    private async run(): Promise<void> {
        if (this.phase !== 'confirm') return;
        const { plugin, book, scenes } = this.options;
        this.phase = 'running';
        const outcomes: SceneBatchOutcome[] = [];
        for (const scene of scenes) {
            this.doneCount += 1;
            this.syncPrimary();
            try {
                await takeDownSceneRelease(plugin, book, scene.release.id);
                outcomes.push({ title: scene.title, reason: null });
            } catch (error) {
                outcomes.push({ title: scene.title, reason: errorText(error, t('ui.sceneReleaseModal.takeDownFailed')) });
            }
        }
        this.outcomes = outcomes;
        this.phase = 'done';
        if (this.closed) new Notice(batchResultLines('ui.sceneReleaseModal.batchTakeDownResult', outcomes).join('\n'));
        this.render();
        this.settle(true);
    }
}
