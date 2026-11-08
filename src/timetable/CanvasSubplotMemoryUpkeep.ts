/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { ItemView, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { RadialTimelineSettings } from '../types/settings';
import { canvasTextCards, type StoryCanvasData } from './canvasSketches';
import { cardColor } from './canvasCardSubplots';
import { cardHexReader } from './CanvasSubplotMenu';
import { dropCanvasSubplotMemory, keepCanvases, rebaseCanvasSubplotMemory, rememberedCanvases, reviseCanvasChoices } from './canvasSubplotMemory';

/*
 * Keeps the Canvas card menu's memory (timetable/canvasSubplotMemory) true
 * to the Canvases themselves. A Canvas's choices are checked against its
 * cards whenever its file changes or opens, and every remembered Canvas when
 * Obsidian starts, even a Canvas changed outside Obsidian. A new subplot is
 * offered only while a card wears it; a recolored card's choice rests
 * dormant until the Canvas next opens. Moving a Canvas moves its choices;
 * deleting it, or finding it gone, drops them.
 */

type Memory = RadialTimelineSettings['canvasSubplotMemory'];

export function registerCanvasSubplotMemoryUpkeep(plugin: RadialTimelinePlugin): void {
    const { app } = plugin;

    const update = (change: (memory: Memory) => Memory): void => {
        const memory = plugin.settings.canvasSubplotMemory;
        if (!memory) return;
        const next = change(memory);
        if (JSON.stringify(next) === JSON.stringify(memory)) return;
        if (next) plugin.settings.canvasSubplotMemory = next;
        else delete plugin.settings.canvasSubplotMemory;
        void plugin.saveSettings().catch((error: unknown) => console.error('[Canvas subplots] Could not save the subplots given to Canvas cards', error));
    };

    const remembers = (path: string): boolean => rememberedCanvases(plugin.settings.canvasSubplotMemory).includes(path);

    /** The cards of a Canvas: from its open view when it has one (current to the last edit), else from its file. */
    const readCards = async (file: TFile, fromFile: boolean): Promise<StoryCanvasData> => {
        const open = fromFile ? undefined : app.workspace.getLeavesOfType('canvas').map(leaf => leaf.view)
            .find(view => view instanceof ItemView && (view as unknown as { file?: TFile | null }).file?.path === file.path);
        const live = (open as unknown as { canvas?: { getData?: () => StoryCanvasData } } | undefined)?.canvas;
        if (live && typeof live.getData === 'function') return live.getData();
        const text = await app.vault.cachedRead(file);
        return text.trim() ? JSON.parse(text) as StoryCanvasData : {}; // SAFE: an empty Canvas file is an empty Canvas
    };

    /**
     * Check a Canvas's choices against its cards. A change to the Canvas
     * keeps the choices of recolored cards dormant, so an undo and redo keep
     * the subplot; opening it, or starting Obsidian, sweeps them.
     */
    const revise = async (path: string, opening: boolean): Promise<void> => {
        if (!remembers(path)) return;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) { update(memory => dropCanvasSubplotMemory(memory, path)); return; }
        const data = await readCards(file, opening);
        const hexOf = cardHexReader(activeDocument);
        const cards = canvasTextCards(data).map(card => ({ id: card.id, hex: hexOf(cardColor(card)) }));
        update(memory => reviseCanvasChoices(memory, path, cards, opening));
    };
    const reviseLogged = (path: string, opening: boolean): void => {
        void revise(path, opening).catch((error: unknown) => console.error(`[Canvas subplots] Could not check the cards of ${path}`, error));
    };

    plugin.registerEvent(app.vault.on('modify', file => { if (file.path.endsWith('.canvas')) reviseLogged(file.path, false); }));
    // A Canvas just opened may still be loading, so it is read from its file.
    plugin.registerEvent(app.workspace.on('file-open', file => { if (file?.path.endsWith('.canvas')) reviseLogged(file.path, true); }));
    plugin.registerEvent(app.vault.on('rename', (file, oldPath) => update(memory => rebaseCanvasSubplotMemory(memory, oldPath, file.path))));
    plugin.registerEvent(app.vault.on('delete', file => update(memory => dropCanvasSubplotMemory(memory, file.path))));
    app.workspace.onLayoutReady(() => {
        update(memory => keepCanvases(memory, path => app.vault.getAbstractFileByPath(path) instanceof TFile));
        for (const path of rememberedCanvases(plugin.settings.canvasSubplotMemory)) reviseLogged(path, true);
    });
}
