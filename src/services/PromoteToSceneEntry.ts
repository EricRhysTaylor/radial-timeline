/*
 * Promote to scene: entry points
 * ------------------------------
 * The command palette entry, the file-explorer menu item for a single note,
 * and the folder and multi-selection items that promote several notes at once.
 * All of them run the same flow: plan, confirm, apply, refresh the timeline.
 */

import { Notice, TFile, TFolder, type Menu, type TAbstractFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { applyPromotion, isPromotable, planPromotion, type PromotionPlan } from './PromoteToSceneService';
import { PromoteToSceneModal, type PromotionAnchorOption } from '../modals/PromoteToSceneModal';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { basename } from '../utils/paths';
import { t, tCount } from '../i18n';
import type { TimelineItem } from '../types';

const PROMOTE_ICON = 'file-up';

export function registerPromoteToScene(plugin: RadialTimelinePlugin): void {
    plugin.addCommand({
        id: 'promote-to-scene',
        name: t('commands.promoteToScene'),
        checkCallback: (checking: boolean) => {
            const file = plugin.app.workspace.getActiveFile();
            if (!file || !isPromotable(plugin.app, plugin.settings, file)) return false;
            if (!checking) void runPromotion(plugin, [file]);
            return true;
        },
    });

    plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu: Menu, target: TAbstractFile) => {
        if (target instanceof TFile) {
            if (!isPromotable(plugin.app, plugin.settings, target)) return;
            addMenuItem(menu, t('ui.promoteToScene.menuItem'), () => runPromotion(plugin, [target]));
            return;
        }
        if (target instanceof TFolder) {
            // Direct children only, so subfolders such as cut or archive folders are never swept in.
            const notes = target.children.filter((child): child is TFile => child instanceof TFile);
            const count = planPromotion(plugin.app, plugin.settings, notes).entries.length;
            if (count === 0) return;
            addMenuItem(menu, t('ui.promoteToScene.menuItemMany', { notes: tCount('note', count) }), () => runPromotion(plugin, notes));
        }
    }));

    plugin.registerEvent(plugin.app.workspace.on('files-menu', (menu: Menu, targets: TAbstractFile[]) => {
        const notes = targets.filter((target): target is TFile => target instanceof TFile);
        const count = planPromotion(plugin.app, plugin.settings, notes).entries.length;
        if (count === 0) return;
        addMenuItem(menu, t('ui.promoteToScene.menuItemMany', { notes: tCount('note', count) }), () => runPromotion(plugin, notes));
    }));
}

function addMenuItem(menu: Menu, title: string, run: () => Promise<void>): void {
    menu.addItem(item => item
        .setTitle(title)
        .setIcon(PROMOTE_ICON)
        .onClick(() => { void run(); }));
}

function explainNothingToPromote(plan: PromotionPlan, files: TFile[]): string {
    if (files.length !== 1 || plan.skipped.length !== 1) return t('ui.promoteToScene.noticeNothing');
    const skip = plan.skipped[0];
    const name = skip.file.basename;
    switch (skip.reason) {
        case 'alreadyScene': return t('ui.promoteToScene.noticeAlreadyScene', { name });
        case 'otherClass': return t('ui.promoteToScene.noticeOtherClass', { name, className: skip.className ?? '' });
        case 'notInBook': return t('ui.promoteToScene.noticeNotInBook', { name });
        case 'notMarkdown': return t('ui.promoteToScene.noticeNothing');
    }
}

/** Plan, confirm and apply a promotion for the given notes. */
export async function runPromotion(plugin: RadialTimelinePlugin, files: TFile[]): Promise<void> {
    const { app, settings } = plugin;
    const plan = planPromotion(app, settings, files);
    if (plan.entries.length === 0) {
        new Notice(explainNothingToPromote(plan, files), 6000);
        return;
    }

    const books = [...new Map(plan.entries.map(entry => [entry.book.id, entry.book])).values()];
    const bookLabel = books.length === 1 ? books[0].title : t('ui.promoteToScene.severalBooks');
    const only = plan.entries.length === 1 ? plan.entries[0] : undefined;

    let sceneData: TimelineItem[] | undefined;
    let anchors: PromotionAnchorOption[] | null = null;
    if (only && !only.prefix) {
        sceneData = await plugin.getSceneData({ sourcePath: only.book.sourceFolder });
        anchors = sceneData
            .filter(item => item.itemType === 'Scene' && typeof item.path === 'string')
            .map(item => ({ path: item.path as string, label: basename(item.path as string).replace(/\.md$/, '') }));
    }

    const modal = new PromoteToSceneModal(app, plan, {
        advancedDefault: settings.sceneAdvancedPropertiesEnabled ?? true,
        bookLabel,
        anchors,
    });
    const choice = await modal.waitForBegin();
    if (!choice) return;

    const result = await applyPromotion(app, settings, plan, {
        advanced: choice.advanced,
        anchorPath: choice.anchorPath,
        sceneData,
        beatModel: resolveSelectedBeatModelFromSettings(settings),
        onProgress: (current, total, name) => modal.updateProgress(t('ui.promoteToScene.progress', { name, current, total })),
    });
    plugin.refreshTimelineIfNeeded(null);

    for (const failure of result.failed) {
        console.error(`[PromoteToScene] ${failure.file.path}: ${failure.message}`);
    }
    if (result.failed.length > 0) {
        await modal.finishWithDismiss(t('ui.promoteToScene.doneWithErrors', {
            promoted: tCount('note', result.promoted.length),
            names: result.failed.map(failure => failure.file.basename).join(', '),
        }), result.promoted.length === 0);
        return;
    }
    if (only) {
        const finalName = result.renamed[0] ? basename(result.renamed[0].to).replace(/\.md$/, '') : only.file.basename;
        await modal.finishWithDismiss(t('ui.promoteToScene.doneOne', { name: finalName }));
        return;
    }
    await modal.finishWithDismiss(t('ui.promoteToScene.doneMany', { notes: tCount('note', result.promoted.length) }));
}
