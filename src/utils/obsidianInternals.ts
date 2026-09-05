/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The two undocumented Obsidian surfaces the plugin reaches for: the
 * settings pane and the command manager. Every call site goes through here
 * so the cast lives in one place and a future API change is one edit.
 */

import type { App } from 'obsidian';

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
