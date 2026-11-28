/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t, tCount } from '../i18n';
import { DragConfirmModal } from '../modals/DragConfirmModal';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { fileStem } from '../utils/paths';
import {
    applySceneNumberUpdates,
    buildRippleRenamePlan,
    renamedBasename,
    SceneReorderVerificationError,
    type RippleRenamePlan,
    type SceneReorderProgress,
} from './SceneReorderService';

/*
 * Renumbering a book: every scene becomes a whole number in book order (1, 2,
 * 3) and every active beat a minor of the scene before it (1.01, 1.02). This
 * is the one ripple renumber. A drag runs it afterwards when Ripple rename is
 * on; the author runs it any time from Settings, the export window or the
 * command. Filenames only; no note's content changes.
 */

/** One progress line for a running rename, e.g. "Ripple rename: renamed 3/7". */
export function formatRenameProgressLine(prefix: string, progress: SceneReorderProgress): string {
    if (progress.phase === 'scan') {
        if (progress.totalFiles === 0) return t('ui.outerRingDragController.progressNoRenames', { prefix });
        return t('ui.outerRingDragController.progressPlanning', { prefix, count: progress.totalFiles });
    }
    if (progress.phase === 'rename') {
        return t('ui.outerRingDragController.progressRenamed', { prefix, renamed: progress.renamedFiles, total: progress.totalFiles });
    }
    if (progress.totalFiles === 0) {
        return t('ui.outerRingDragController.progressNoRenames', { prefix });
    }
    return t('ui.outerRingDragController.progressRenamed', { prefix, renamed: progress.totalFiles, total: progress.totalFiles });
}

/** The book's renumber plan. sourcePath picks a book other than the active one. */
export async function planBookRenumber(plugin: RadialTimelinePlugin, sourcePath?: string): Promise<RippleRenamePlan> {
    const sceneData = await plugin.getSceneData(sourcePath ? { sourcePath } : undefined);
    return buildRippleRenamePlan(sceneData, {
        beatModel: resolveSelectedBeatModelFromSettings(plugin.settings)
    });
}

/** Rename the plan's notes and check the result. Throws when a rename fails or the check finds a problem. */
async function applyBookRenumber(
    plugin: RadialTimelinePlugin,
    plan: RippleRenamePlan,
    onStatus?: (message: string) => void
): Promise<void> {
    await applySceneNumberUpdates(plugin.app, plan.updates, {
        onProgress: (progress) => {
            onStatus?.(formatRenameProgressLine(t('ui.outerRingDragController.rippleRenamePrefix'), progress));
        },
        verification: {
            expectedOrderedPaths: plan.orderedPaths,
            expectedNumbersByPath: plan.expectedNumbersByPath,
        },
        onWarning: () => {
            new Notice(t('ui.outerRingDragController.potentialIssueNotice'), 8000);
        },
    });
}

function describeRenumberFailure(error: unknown): string {
    if (error instanceof SceneReorderVerificationError) {
        console.warn('Ripple rename verification warning:', error);
        return t('ui.outerRingDragController.rippleVerificationIssue');
    }
    console.error('Ripple rename failed:', error);
    return t('ui.outerRingDragController.rippleFailed');
}

/**
 * The renumber that follows a drag: no confirmation of its own (the drag's
 * already counted it). Status goes to the drag's window, or to a Notice.
 */
export async function runRippleRenumber(plugin: RadialTimelinePlugin, onStatus?: (message: string) => void): Promise<void> {
    const say = (message: string, noticeMs: number) => {
        if (onStatus) onStatus(message);
        else new Notice(message, noticeMs);
    };
    try {
        const plan = await planBookRenumber(plugin);
        if (plan.needRename === 0) {
            say(t('ui.outerRingDragController.rippleAlreadyNormalized'), 2600);
            return;
        }
        say(t('ui.outerRingDragController.rippleNeedRename', { count: plan.needRename, checked: plan.checked }), 3200);
        await applyBookRenumber(plugin, plan, onStatus);
    } catch (error) {
        say(describeRenumberFailure(error), 5000);
    }
}

export interface OpenBookRenumberOptions {
    /** A book other than the active one (its scene folder). */
    sourcePath?: string;
    /** After the window closes on a finished renumber. */
    onDone?: () => void;
}

/**
 * Renumber the book on demand: list every rename, ask, then rename. Works
 * whether or not Ripple rename is on, since the author asked for it.
 */
export async function openBookRenumber(plugin: RadialTimelinePlugin, options: OpenBookRenumberOptions = {}): Promise<void> {
    const plan = await planBookRenumber(plugin, options.sourcePath);
    if (plan.needRename === 0) {
        new Notice(t('ui.bookRenumber.alreadyInOrder'), 3000);
        return;
    }

    const renames = plan.updates.map(update => ({
        from: fileStem(update.path),
        to: renamedBasename(update.path, update.newNumber),
    }));
    const modal = new DragConfirmModal(
        plugin.app,
        {
            badge: t('ui.bookRenumber.badge'),
            title: t('ui.bookRenumber.title'),
            sectionTitle: t('ui.bookRenumber.sectionTitle'),
            actionSummary: t('ui.bookRenumber.summary', { checked: tCount('note', plan.checked) }),
            renameCount: plan.needRename,
            renames,
        },
        []
    );
    if (!await modal.waitForBegin()) return;

    try {
        await applyBookRenumber(plugin, plan, (message) => modal.updateProgress(message));
        plugin.refreshTimelineIfNeeded(null);
        await modal.finishWithDismiss(t('ui.bookRenumber.done', { notes: tCount('note', plan.needRename) }));
    } catch (error) {
        plugin.refreshTimelineIfNeeded(null);
        await modal.finishWithDismiss(describeRenumberFailure(error), true);
    }
    options.onDone?.();
}
