/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The website's "Open in Obsidian" link for a book being added to the vault:
 *
 *   obsidian://radial-timeline-transfer?id=<transfer id>
 *
 * Opens the same preview as the Book from Community card. Opening the link
 * writes nothing: the preview reads the book, and notes are written only on
 * Create book.
 */

import { Notice, type ObsidianProtocolData } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
    COMMUNITY_UUID_RE,
    canShareTimelineToCommunity,
    hasCommunityConnection,
    normalizeCommunityShareSettings,
} from '../communityShare/communityShareSettings';
import { t } from '../i18n';
import { BookFromCommunityModal } from '../modals/BookFromCommunityModal';
import { forgetBookTransferList } from '../settings/sections/CommunityBookFromCommunityBlock';

export const BOOK_FROM_COMMUNITY_PROTOCOL_ACTION = 'radial-timeline-transfer';

/** What the link opens: the preview, or one sentence with the next step. */
export function bookFromCommunityLinkRoute(
    plugin: Pick<RadialTimelinePlugin, 'settings'>,
    params: Readonly<Record<string, string | undefined>>
): { kind: 'open'; transferId: string } | { kind: 'notice'; text: string } {
    const id = params.id?.trim() ?? ''; // SAFE: a link with no id is the incomplete link answered below
    if (!COMMUNITY_UUID_RE.test(id)) return { kind: 'notice', text: t('ui.bookFromCommunity.linkInvalid') };
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!hasCommunityConnection(settings) || !settings.enabled) return { kind: 'notice', text: t('ui.bookFromCommunity.linkConnect') };
    if (settings.sharingPaused) return { kind: 'notice', text: t('ui.bookFromCommunity.linkPaused') };
    if (!canShareTimelineToCommunity(settings)) return { kind: 'notice', text: t('ui.bookFromCommunity.linkLevel') };
    return { kind: 'open', transferId: id.toLowerCase() };
}

/** Register the link once, on plugin load. */
export function registerBookFromCommunityLink(plugin: RadialTimelinePlugin): void {
    plugin.registerObsidianProtocolHandler(BOOK_FROM_COMMUNITY_PROTOCOL_ACTION, (params: ObsidianProtocolData) => {
        const route = bookFromCommunityLinkRoute(plugin, params);
        if (route.kind === 'notice') {
            new Notice(route.text);
            return;
        }
        // The preview reads the book itself; the Settings card reads the list fresh after the link and after any change.
        forgetBookTransferList();
        new BookFromCommunityModal(plugin.app, plugin, route.transferId, { onChanged: forgetBookTransferList }).open();
    });
}
