/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The main plot: the subplot that owns ring 1, the outermost ring.
 *
 * A scene with no Subplot belongs to it, beat notes are filed under it, and it
 * can be renamed in the Subplot Manager but never deleted. It is called
 * "Main Plot" until the author renames it — most books start with one thread,
 * and that is the natural name for it.
 *
 * Code reads the name through getMainPlotName() rather than threading settings
 * through every caller, the same way t() reads the active locale. The plugin
 * syncs it from settings.mainPlotName on load and on every save.
 */

export const DEFAULT_MAIN_PLOT_NAME = 'Main Plot';

let mainPlotName = DEFAULT_MAIN_PLOT_NAME;

export function getMainPlotName(): string {
    return mainPlotName;
}

export function syncMainPlotName(settings: { mainPlotName?: string }): void {
    const name = typeof settings.mainPlotName === 'string' ? settings.mainPlotName.trim() : '';
    mainPlotName = name.length > 0 ? name : DEFAULT_MAIN_PLOT_NAME;
}
