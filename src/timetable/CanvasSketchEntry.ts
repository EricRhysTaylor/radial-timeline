import { Notice, type Menu, type TAbstractFile, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getActiveBook } from '../utils/books';
import { CanvasSketchModal, type OpenCanvas } from './CanvasSketchModal';

function activeCanvas(plugin: RadialTimelinePlugin): OpenCanvas | null {
    const leaf = plugin.app.workspace.activeLeaf;
    if (!leaf || leaf.view.getViewType() !== 'canvas') return null;
    const view = leaf.view as unknown as { canvas?: Partial<OpenCanvas> };
    const canvas = view.canvas;
    if (!canvas || typeof canvas.getData !== 'function' || typeof canvas.setData !== 'function' || typeof canvas.requestSave !== 'function') return null;
    return canvas as OpenCanvas;
}

function openCanvasSketches(plugin: RadialTimelinePlugin): void {
    const canvas = activeCanvas(plugin);
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
