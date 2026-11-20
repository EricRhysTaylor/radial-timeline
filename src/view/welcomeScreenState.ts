/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Whether the timeline view shows the welcome screen instead of the timeline.
 *
 * - Asked for (the Welcome link or the Welcome screen command): always, even
 *   in a book with scenes, until closed.
 * - Otherwise once per vault: a vault with no scenes and no book folder yet
 *   opens on it until the author closes it (`welcomeScreenClosed`, saved in
 *   this vault's plugin data). After that the empty timeline shows instead.
 */
export function shouldShowWelcomeScreen(state: {
    requested: boolean;
    hasScenes: boolean;
    closed: boolean;
    hasSourceFolder: boolean;
}): boolean {
    if (state.requested) return true;
    return !state.hasScenes && !state.closed && !state.hasSourceFolder;
}
