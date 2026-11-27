/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { Platform, type App } from 'obsidian';

/**
 * Obsidian's Appearance → Native menus (desktop only). Menus then render
 * through the OS: titles as plain text, no icons, no DOM to hang a tooltip on.
 * Never set (null) means Obsidian's platform default, which is on for macOS
 * (App.updateUseNativeMenu).
 */
export function usesNativeMenus(app: App): boolean {
    if (!Platform.isDesktopApp) return false;
    // SAFE: Vault.getConfig is not in Obsidian's public typings; 'nativeMenus' is the Appearance setting's config key. Absent getConfig reads as off (Obsidian's own menus).
    const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
    const setting = vault.getConfig?.('nativeMenus');
    return setting === true || (setting === null && Platform.isMacOS);
}

/**
 * The title of an item Radial Timeline adds to a note's or file's menu with
 * the Radial Timeline logo. Obsidian's own menus show the logo, so the title
 * is the action alone; native menus show no icons, so the name leads it.
 */
export function logoMenuTitle(app: App, action: string): string {
    return usesNativeMenus(app) ? `Radial Timeline: ${action}` : action;
}
