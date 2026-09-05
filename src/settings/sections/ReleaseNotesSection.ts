/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { Component } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { DEFAULT_RELEASES_URL } from '../../utils/releases';
import { renderReleaseNotesList } from '../../utils/releaseNotesRenderer';

interface ReleaseNotesSectionArgs {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    component: Component;
}

export async function renderReleaseNotesSection({ plugin, containerEl, component }: ReleaseNotesSectionArgs): Promise<void> {
    const entries = plugin.getReleaseNotesEntries();
    containerEl.createEl('hr', { cls: 'ert-settings-separator' });
    const section = containerEl.createDiv({ cls: 'ert-settings-release-notes' });
    section.createEl('h2', { text: "What's new" });

    if (!entries || entries.length === 0) {
        const fallback = section.createEl('p');
        fallback.setText('Release notes are not available in this build. ');
        const link = fallback.createEl('a', { text: 'View releases on GitHub.', href: DEFAULT_RELEASES_URL });
        link.setAttr('target', '_blank');
        return;
    }

    const featuredEntry = entries[0] ?? entries[entries.length - 1];
    await renderReleaseNotesList(
        section,
        entries,
        featuredEntry,
        plugin,
        component,
        'ert-settings-release-notes',
        '',
        {
            dismissedFeaturedVersion: plugin.settings.dismissedLatestReleaseVersion,
            onFeaturedToggle: (dismissed: boolean) => {
                const nextValue = dismissed ? featuredEntry.version : undefined;
                if (plugin.settings.dismissedLatestReleaseVersion === nextValue) return;
                plugin.settings.dismissedLatestReleaseVersion = nextValue;
                void plugin.saveSettings();
            }
        }
    );
}
