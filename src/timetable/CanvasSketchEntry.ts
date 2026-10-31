import { ItemView, Notice, type Menu, type TAbstractFile, TFile, type View } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getActiveBook } from '../utils/books';
import { CanvasSketchModal, type OpenCanvas } from './CanvasSketchModal';

function canvasForView(source: View | undefined): OpenCanvas | null {
    if (!source || source.getViewType() !== 'canvas') return null;
    const view = source as unknown as { canvas?: Partial<OpenCanvas> };
    const canvas = view.canvas;
    if (!canvas || typeof canvas.getData !== 'function' || typeof canvas.setData !== 'function' || typeof canvas.requestSave !== 'function') return null;
    return canvas as OpenCanvas;
}

function activeCanvas(plugin: RadialTimelinePlugin): OpenCanvas | null {
    return canvasForView(plugin.app.workspace.activeLeaf?.view);
}

function openCanvasSketches(plugin: RadialTimelinePlugin, canvas = activeCanvas(plugin)): void {
    if (!canvas) { new Notice(t('ui.canvasSketch.openCanvas')); return; }
    const books = (plugin.settings.books ?? []).filter(book => book.sourceFolder.trim());
    const active = getActiveBook(plugin.settings);
    const selected = books.find(book => book.id === active?.id) ?? books[0];
    if (!selected) { new Notice(t('ui.canvasSketch.noBook')); return; }
    new CanvasSketchModal(plugin.app, plugin, canvas, books, selected, () =>
        plugin.app.workspace.getLeavesOfType('canvas').some(leaf => (leaf.view as unknown as { canvas?: OpenCanvas }).canvas === canvas),
    ).open();
}

export function registerCanvasSketches(plugin: RadialTimelinePlugin): void {
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
            const action = view.addAction('pencil-line', t('ui.canvasSketch.command'), () => {
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
        name: t('ui.canvasSketch.command'),
        checkCallback: checking => {
            if (!activeCanvas(plugin)) return false;
            if (!checking) openCanvasSketches(plugin);
            return true;
        },
    });
    plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== 'canvas' || plugin.app.workspace.getActiveFile()?.path !== file.path || !activeCanvas(plugin)) return;
        menu.addItem(item => item.setTitle(t('ui.canvasSketch.command')).setIcon('pencil-line').onClick(() => openCanvasSketches(plugin)));
    }));
}
