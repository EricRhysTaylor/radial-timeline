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
import { isUntitledName } from '../utils/noteTitle';
import { t, tCount } from '../i18n';
import type { TimelineItem } from '../types';
import { sortByManuscriptOrder } from '../utils/sceneHelpers';
import { buildTableRow } from '../timetable/timetableModel';
import { orderSketches, sketchAnchor } from '../timetable/sketchPlacement';
import { readSceneId } from '../utils/sceneIds';
import { getBookIdForPath } from '../utils/books';

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
            const view = plugin.app.workspace.activeLeaf?.view as { getViewType?: () => string; canvas?: { nodes?: Map<string, { getData?: () => { file?: string } }> } } | undefined;
            if (view?.getViewType?.() === 'canvas' && view.canvas?.nodes instanceof Map
                && [...view.canvas.nodes.values()].some(node => node.getData?.().file === target.path)) return;
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
export async function runPromotion(plugin: RadialTimelinePlugin, files: TFile[], openPromoted?: (file: TFile) => Promise<void>): Promise<void> {
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
    let defaultAnchorPath: string | null = null;
    let followingSketches: string[] = [];
    if (only && !only.prefix) {
        sceneData = await plugin.getSceneData({ sourcePath: only.book.sourceFolder });
        anchors = promotionAnchors(sceneData);
        const fm = app.metadataCache.getFileCache(only.file)?.frontmatter;
        const sketchAct = only.fromSketch ? buildTableRow(only.file.path, only.file.basename, fm, settings).act : null;
        if (sketchAct !== null) {
            anchors = anchorsInSketchAct(anchors, sketchAct, anchor => {
                const file = app.vault.getFileByPath(anchor.path);
                return file ? buildTableRow(file.path, file.basename, app.metadataCache.getFileCache(file)?.frontmatter, settings).act : null;
            });
        }
        const anchorId = only.fromSketch ? sketchAnchor(fm) : null;
        if (anchorId) {
            const items = app.vault.getMarkdownFiles().filter(file => getBookIdForPath(settings.books, file.path) === only.book.id)
                .map(file => {
                    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
                    return { row: buildTableRow(file.path, file.basename, frontmatter, settings), frontmatter };
                });
            const matching = items.filter(item => item.row.kind === 'scene' && readSceneId(item.frontmatter) === anchorId);
            const ordered = orderSketches(items);
            if (matching.length !== 1 || ordered.problems.has(only.file.path)) {
                new Notice(t('ui.timetable.sketchPromotionAnchorProblem'), 8000);
                return;
            }
            defaultAnchorPath = matching[0].row.path;
            if (!anchors.some(anchor => anchor.path === defaultAnchorPath)) {
                new Notice(t('ui.timetable.sketchPromotionAnchorProblem'), 8000);
                return;
            }
            const gap = ordered.items.filter(item => item.row.kind === 'sketch' && sketchAnchor(item.frontmatter) === anchorId
                && item.row.act === matching[0].row.act);
            const position = gap.findIndex(item => item.row.path === only.file.path);
            followingSketches = gap.slice(position + 1).map(item => item.row.path);
        }
    }
    if ((!only || only.prefix) && plan.entries.some(entry => entry.fromSketch && sketchAnchor(app.metadataCache.getFileCache(entry.file)?.frontmatter))) {
        new Notice(t('ui.timetable.sketchPromotionSingle'), 8000);
        return;
    }

    const modal = new PromoteToSceneModal(app, plan, {
        advancedDefault: settings.sceneAdvancedPropertiesEnabled ?? true,
        bookLabel,
        anchors,
        defaultAnchorPath,
        // "Untitled sketch" never becomes "12.5 Untitled sketch": the scene gets a title first.
        askTitle: only !== undefined && isUntitledName(only.file.basename, t('ui.timetable.newSketchName')),
    });
    const choice = await modal.waitForBegin();
    if (!choice) return;

    const result = await applyPromotion(app, settings, plan, {
        advanced: choice.advanced,
        anchorPath: choice.anchorPath,
        sceneData,
        beatModel: resolveSelectedBeatModelFromSettings(settings),
        title: choice.title,
        sketchPlacement: defaultAnchorPath && choice.anchorPath === defaultAnchorPath
            ? { anchorId: sketchAnchor(app.metadataCache.getFileCache(only!.file)?.frontmatter)!, followingSketches } : undefined,
        onProgress: (current, total, name) => modal.updateProgress(t('ui.promoteToScene.progress', { name, current, total })),
    });
    plugin.refreshTimelineIfNeeded(null);

    for (const failure of result.failed) {
        console.error(`[PromoteToScene] ${failure.file.path}: ${failure.message}`);
    }
    if (result.failed.length > 0) {
        if (result.failed.some(failure => failure.message === 'No safe scene number is available at this position.')) {
            new Notice(t('ui.timetable.sketchNoSafeNumber'), 10000);
        }
        await modal.finishWithDismiss(t('ui.promoteToScene.doneWithErrors', {
            promoted: tCount('note', result.promoted.length),
            names: result.failed.map(failure => failure.file.basename).join(', '),
        }), result.promoted.length === 0);
        return;
    }
    if (only) {
        const finalName = result.renamed[0] ? basename(result.renamed[0].to).replace(/\.md$/, '') : only.file.basename;
        const promoted = result.promoted[0];
        await modal.finishWithDismiss(t('ui.promoteToScene.doneOne', { name: finalName }), false,
            promoted ? () => openPromoted ? openPromoted(promoted) : app.workspace.openLinkText(promoted.path, '', false) : undefined);
        return;
    }
    await modal.finishWithDismiss(t('ui.promoteToScene.doneMany', { notes: tCount('note', result.promoted.length) }));
}

/** A position offered for a sketch must agree with its existing act. */
export function anchorsInSketchAct(anchors: PromotionAnchorOption[], act: number, actFor: (anchor: PromotionAnchorOption) => number | null): PromotionAnchorOption[] {
    return anchors.filter(anchor => actFor(anchor) === act);
}

/**
 * The scenes a promoted note can follow. getSceneData lists a scene once per
 * subplot ring it belongs to; the Position menu offers each scene once, in
 * reading order.
 */
export function promotionAnchors(sceneData: TimelineItem[]): PromotionAnchorOption[] {
    const scenes = new Map<string, TimelineItem>();
    for (const item of sceneData) {
        if (item.itemType === 'Scene' && typeof item.path === 'string' && !scenes.has(item.path)) scenes.set(item.path, item);
    }
    return [...scenes.values()]
        .sort(sortByManuscriptOrder)
        .map(item => ({ path: item.path as string, label: basename(item.path as string).replace(/\.md$/, '') }));
}
