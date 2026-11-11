import { ItemView, Notice, type Menu, type TAbstractFile, TFile, type View } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getActiveBook, getBookIdForPath } from '../utils/books';
import { markTimetableRows } from './timetableRegistry';
import { isPromotable } from '../services/PromoteToSceneService';
import { runPromotion } from '../services/PromoteToSceneEntry';
import { CanvasConvertModal, type OpenCanvas } from './CanvasConvertModal';
import { registerCanvasCardPresentation } from './CanvasCardPresentation';
import { registerCanvasSubplotMemoryUpkeep } from './CanvasSubplotMemoryUpkeep';
import { rebaseStoryMapProvenance } from './storyMapProvenance';
import { SubplotCanvasModal } from './SubplotCanvasModal';
import { canvasTextCards } from './canvasSketches';

/** An open Canvas and the file it shows. */
interface CanvasInView { canvas: OpenCanvas; path: string }

function canvasForView(source: View | null | undefined): CanvasInView | null {
    if (!source || source.getViewType() !== 'canvas') return null;
    const view = source as unknown as { canvas?: Partial<OpenCanvas>; file?: TFile | null };
    const canvas = view.canvas;
    const path = view.file?.path;
    if (!path || !canvas || typeof canvas.getData !== 'function' || typeof canvas.setData !== 'function' || typeof canvas.requestSave !== 'function') return null;
    return { canvas: canvas as OpenCanvas, path };
}

function activeCanvas(plugin: RadialTimelinePlugin): CanvasInView | null {
    return canvasForView(plugin.app.workspace.getActiveViewOfType(ItemView));
}

function openCanvasSketches(plugin: RadialTimelinePlugin, open = activeCanvas(plugin)): void {
    if (!open) { new Notice(t('ui.canvasSketch.openCanvas')); return; }
    const { canvas, path } = open;
    const eligible = new Set(canvasTextCards(canvas.getData()).map(card => card.id));
    const selectedCards = canvas.selection instanceof Set ? [...canvas.selection] : [];
    if (!selectedCards.some(node => { const data = node.getData?.(); return data?.id && eligible.has(data.id); })) {
        new Notice(t('ui.canvasSketch.selectIdea'), 8000);
        return;
    }
    const books = plugin.settings.books.filter(book => book.sourceFolder.trim());
    const active = getActiveBook(plugin.settings);
    const selected = books.find(book => book.id === active?.id) ?? books[0];
    if (!selected) { new Notice(t('ui.canvasSketch.noBook')); return; }
    new CanvasConvertModal(plugin.app, plugin, canvas, path, books, selected, () =>
        plugin.app.workspace.getLeavesOfType('canvas').some(leaf => (leaf.view as unknown as { canvas?: OpenCanvas }).canvas === canvas),
    ).open();
}

export function registerCanvasSketches(plugin: RadialTimelinePlugin): void {
    registerCanvasCardPresentation(plugin);
    registerCanvasSubplotMemoryUpkeep(plugin);
    plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
        const records = plugin.settings.storyMapProvenance;
        if (!records) return;
        const next = rebaseStoryMapProvenance(records, oldPath, file.path);
        if (JSON.stringify(records) === JSON.stringify(next)) return;
        plugin.settings.storyMapProvenance = next;
        void plugin.saveSettings().catch((error: unknown) => console.error('[Story map] Could not save renamed map details', error));
    }));
    plugin.addCommand({ id: 'create-subplot-canvas', name: t('ui.subplotCanvas.paletteCommand'), callback: () => new SubplotCanvasModal(plugin.app, plugin).open() });
    // Track each open Canvas, including inactive and split leaves. Bind the
    // action to its own view rather than whichever leaf happens to have focus.
    const actions = new Map<View, HTMLElement>();
    let running = true;
    const refreshActions = (): void => {
        if (!running) return;
        const open = new Set<View>();
        plugin.app.workspace.iterateAllLeaves(leaf => {
            const view = leaf.view;
            if (!(view instanceof ItemView) || view.getViewType() !== 'canvas') return;
            open.add(view);
            const existing = actions.get(view);
            if (existing && view.containerEl.contains(existing)) return;
            existing?.remove();
            const action = view.addAction('replace', t('ui.canvasSketch.command'), () => {
                openCanvasSketches(plugin, canvasForView(view));
            });
            action.addClass('ert-canvas-sketch-action');
            actions.set(view, action);
        });
        for (const [view, action] of actions) {
            if (!open.has(view)) { action.remove(); actions.delete(view); }
        }
    };
    const workspace = plugin.app.workspace;
    plugin.registerEvent(workspace.on('layout-change', refreshActions));
    plugin.registerEvent(workspace.on('active-leaf-change', refreshActions));
    plugin.registerEvent(workspace.on('file-open', refreshActions));
    workspace.onLayoutReady(refreshActions);
    plugin.register(() => {
        running = false;
        for (const action of actions.values()) action.remove();
        actions.clear();
    });
    plugin.addCommand({
        id: 'canvas-cards-to-sketches',
        name: t('ui.canvasSketch.paletteCommand'),
        checkCallback: checking => {
            if (!activeCanvas(plugin)) return false;
            if (!checking) openCanvasSketches(plugin);
            return true;
        },
    });
    plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        const sourceView = plugin.app.workspace.getActiveViewOfType(ItemView);
        const nodes = sourceView?.getViewType() === 'canvas' ? (sourceView as unknown as { canvas?: { nodes?: Map<string, { getData?: () => { file?: string } }> } }).canvas?.nodes : undefined;
        if (file instanceof TFile && file.extension === 'md' && nodes instanceof Map && [...nodes.values()].some(node => node.getData?.().file === file.path)) {
            const bookId = getBookIdForPath(plugin.settings.books, file.path);
            if (!bookId) return;
            menu.addItem(item => item.setTitle(t('ui.canvasSketch.showTimetable')).setSection('radial-timeline').setIcon('rt-logo').onClick(() => {
                void (async () => {
                    await plugin.setActiveBookId(bookId);
                    await plugin.openTimetable();
                    window.setTimeout(() => markTimetableRows(file.path, null, true), 300);
                })();
            }));
            if (plugin.isSceneFile(file.path)) menu.addItem(item => item.setTitle(t('ui.canvasSketch.showTimeline')).setSection('radial-timeline').setIcon('rt-logo').onClick(() => {
                void (async () => { await plugin.setActiveBookId(bookId); await plugin.revealSceneOnTimeline(file.path); })();
            }));
            if (isPromotable(plugin.app, plugin.settings, file)) menu.addItem(item => item.setTitle(t('ui.canvasSketch.promote')).setSection('radial-timeline').setIcon('rt-logo').onClick(() => { void runPromotion(plugin, [file]); }));
            return;
        }
        if (!(file instanceof TFile) || file.extension !== 'canvas' || plugin.app.workspace.getActiveFile()?.path !== file.path || !activeCanvas(plugin)) return;
        menu.addItem(item => item.setTitle(`Radial Timeline: ${t('ui.canvasSketch.command')}`).setSection('radial-timeline').setIcon('rt-logo').onClick(() => openCanvasSketches(plugin)));
    }));
}
