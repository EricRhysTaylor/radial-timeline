/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { MarkdownRenderer } from 'obsidian';
import type { Component } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { EmbeddedReleaseNotesEntry } from '../types';
import { parseReleaseVersion, formatPublishedDate } from './releases';

export { formatPublishedDate };

export interface ReleaseNotesRenderOptions {
    /**
     * If provided and equal to `featuredEntry.version`, the featured release starts
     * collapsed instead of expanded — persists the user's explicit dismissal.
     */
    dismissedFeaturedVersion?: string;
    /**
     * Called when the user toggles the featured release's `<details>` element.
     * `dismissed` is true if the user just closed it, false if they re-opened it.
     */
    onFeaturedToggle?: (dismissed: boolean) => void;
}

export async function renderReleaseNotesList(
    containerEl: HTMLElement,
    entries: EmbeddedReleaseNotesEntry[],
    featuredEntry: EmbeddedReleaseNotesEntry,
    plugin: RadialTimelinePlugin,
    component: Component,
    cssPrefix: string,
    detailClasses: string = '',
    options: ReleaseNotesRenderOptions = {}
): Promise<void> {
    const detailClassName = [ `${cssPrefix}-details`, detailClasses ].filter(Boolean).join(' ');
    const featuredDismissed = options.dismissedFeaturedVersion === featuredEntry.version;

    // Render all entries as collapsible details, with the featured entry expanded by default
    for (const entry of entries) {
        const versionLabel = parseReleaseVersion(entry.version)?.fullLabel ?? (entry.title || entry.version);
        const details = containerEl.createEl('details', { cls: detailClassName });

        const isFeatured = entry.version === featuredEntry.version;

        // Expand the featured release by default, unless the user has explicitly collapsed it.
        if (isFeatured && !featuredDismissed) {
            details.open = true;
        }

        if (isFeatured) {
            details.addClass(`${cssPrefix}-details-major`);
            if (options.onFeaturedToggle) {
                const onFeaturedToggle = options.onFeaturedToggle;
                plugin.registerDomEvent(details, 'toggle', () => {
                    onFeaturedToggle(!details.open);
                });
            }
        }

        const summaryEl = details.createEl('summary', { cls: `${cssPrefix}-details-summary` });
        summaryEl.createSpan({
            text: versionLabel,
            cls: `${cssPrefix}-details-summary-label`
        });

        const dateText = formatPublishedDate(entry.publishedAt);
        if (dateText) {
            summaryEl.createSpan({
                text: '•',
                cls: `${cssPrefix}-details-summary-divider`
            });
            summaryEl.createSpan({
                text: dateText,
                cls: `${cssPrefix}-details-summary-date`
            });
        }

        if (isFeatured) {
            summaryEl.createSpan({
                text: 'Latest',
                cls: `${cssPrefix}-details-summary-badge`
            });
        }

        const entryBody = details.createDiv({ cls: `${cssPrefix}-details-body markdown-preview-view` });
        await MarkdownRenderer.render(plugin.app, entry.body ?? '', entryBody, '', component);
    }
}
