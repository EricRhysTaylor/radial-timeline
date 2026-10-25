/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The undocumented Obsidian surfaces the plugin reaches for: the settings
 * pane, the command manager, a leaf's tab header and a Bases view's own
 * filters. Every call site goes through here so the cast lives in one place
 * and a future API change is one edit.
 */

import type { App, BasesConfigFileFilter, BasesViewConfig, WorkspaceLeaf } from 'obsidian';

export const PLUGIN_SETTINGS_TAB_ID = 'radial-timeline';

type SettingPane = { open: () => void; openTabById: (id: string) => void };
type CommandManager = { executeCommandById?: (id: string) => unknown };

/** Open Obsidian's settings pane on `tabId`. False when the private surface is absent. */
export function openSettingsTab(app: App, tabId: string = PLUGIN_SETTINGS_TAB_ID): boolean {
    const setting = (app as unknown as { setting?: SettingPane }).setting; // SAFE: the settings pane is not in Obsidian's public typings; this is the one cast for it
    if (!setting) return false;
    setting.open();
    setting.openTabById(tabId);
    return true;
}

/** Run a command by id. False when the command manager is absent. */
export function executeCommandById(app: App, commandId: string): boolean {
    const commands = (app as unknown as { commands?: CommandManager }).commands; // SAFE: the command manager is not in Obsidian's public typings; this is the one cast for it
    if (!commands?.executeCommandById) return false;
    commands.executeCommandById(commandId);
    return true;
}

/** The leaf whose tab header is `header`, or null. Tab headers carry no leaf id in the DOM. */
export function leafForTabHeader(app: App, header: Element): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    app.workspace.iterateAllLeaves(leaf => {
        if ((leaf as unknown as { tabHeaderEl?: Element }).tabHeaderEl === header) found = leaf; // SAFE: a leaf's tab header is not in Obsidian's public typings; this is the one cast for it
    });
    return found;
}

/**
 * A Bases view's own filters ("This view" in the filter menu), in the form a
 * `.base` file stores them; undefined when the view has none. The public
 * config has no getter for them.
 */
export function basesViewFilters(config: BasesViewConfig): BasesConfigFileFilter | undefined {
    const filters = (config as unknown as { filters?: { serialize?: () => BasesConfigFileFilter } }).filters; // SAFE: a view's own filters are not in Obsidian's public typings; this is the one cast for them
    return typeof filters?.serialize === 'function' ? filters.serialize() : undefined;
}
