/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Settings → Community → Book from Community: a card for each book the author
 * chose Add to my vault for on the website, and for each one already on its
 * way. Review opens the preview (BookFromCommunityModal); nothing is written
 * from here.
 *
 * Quiet by design: with nothing waiting, or a website that does not answer
 * this call yet, the block renders nothing and logs nothing.
 */

import { Setting } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { listBookTransfers } from '../../communityShare/communityShareClient';
import type { BookTransferOffer } from '../../communityShare/bookTransferDocument';
import { obsidianBookTransferDeps } from '../../communityShare/bookTransferWriter';
import {
    bookTransferRecords,
    canShareTimelineToCommunity,
    normalizeCommunityShareSettings,
} from '../../communityShare/communityShareSettings';
import { BookFromCommunityModal } from '../../modals/BookFromCommunityModal';
import { ERT_CLASSES } from '../../ui/classes';
import { t, tCount } from '../../i18n';

export interface CommunityBookFromCommunityBlockProps {
    plugin: RadialTimelinePlugin;
    /** The Community tab's own element: new each time Settings opens, kept across the section's rerenders. */
    viewEl: HTMLElement;
    containerEl: HTMLElement;
    rerender: () => void;
}

// The website's list of waiting books. Each time Settings opens (a new view)
// it is read fresh, so a book the author just chose Add to my vault for shows
// at once. The section rerenders on every save, so within one open view the
// answer is kept, and read again at most once per TTL.
let listCache: { view: HTMLElement; key: string; fetchedAt: number; offers: BookTransferOffer[] } | null = null;
let listRequest: { view: HTMLElement; key: string } | null = null;
const LIST_TTL_MS = 60 * 1000;

/** Forget the list, so the next render of any view reads it fresh. */
export function forgetBookTransferList(): void {
    listCache = null;
    listRequest = null;
}

export function renderCommunityBookFromCommunityBlock({ plugin, viewEl, containerEl, rerender }: CommunityBookFromCommunityBlockProps): void {
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (settings.connection.status !== 'connected' || !settings.connection.connectionId) return;

    const key = settings.connection.connectionId;
    const cached = listCache?.view === viewEl && listCache.key === key ? listCache : null;
    const canList = canShareTimelineToCommunity(settings) && !settings.sharingPaused;
    const asking = listRequest?.view === viewEl && listRequest.key === key;
    if (canList && (!cached || Date.now() - cached.fetchedAt >= LIST_TTL_MS) && !asking) {
        const request = { view: viewEl, key };
        listRequest = request;
        void listBookTransfers(plugin)
            // Nothing waiting, a website that does not answer this call yet, or
            // no network: no card, and nothing to report.
            .catch((): BookTransferOffer[] => [])
            .then(offers => {
                // A newer view, or a change from the preview, asked again since: this answer is out of date.
                if (listRequest !== request) return;
                listRequest = null;
                listCache = { view: viewEl, key, fetchedAt: Date.now(), offers };
                if (viewEl.isConnected) rerender();
            });
    }

    const offers = canList ? cached?.offers ?? [] : []; // SAFE: before this view's first answer nothing is known to be waiting
    const records = bookTransferRecords(settings);
    if (offers.length === 0 && records.length === 0) return;

    const changed = (): void => {
        forgetBookTransferList();
        rerender();
    };
    const open = (transferId: string): void => {
        new BookFromCommunityModal(plugin.app, plugin, transferId, { onChanged: changed }).open();
    };

    const block = containerEl.createDiv({ cls: ERT_CLASSES.STACK });
    const recordIds = new Set(records.map(([transferId]) => transferId));
    for (const [transferId, record] of records) {
        const row = new Setting(block).setName(t('ui.bookFromCommunity.cardName'));
        if (record.phase === 'cancelled') {
            row.setDesc(t('ui.bookFromCommunity.cardCancelled', { title: record.title, folder: record.folder }))
                .addButton(button => button
                    .setButtonText(t('ui.bookFromCommunity.cardCancelledButton'))
                    .onClick(async () => {
                        await obsidianBookTransferDeps(plugin).store.remove(transferId);
                        changed();
                    }));
            continue;
        }
        const offer = offers.find(entry => entry.transferId === transferId);
        row.setDesc(offer ? t('ui.bookFromCommunity.cardDesc', { title: record.title, scenes: tCount('scene', offer.sceneCount) }) : record.title)
            .addButton(button => button
                .setButtonText(t('ui.bookFromCommunity.cardContinue'))
                .setCta()
                .onClick(() => open(transferId)));
    }
    for (const offer of offers) {
        if (recordIds.has(offer.transferId)) continue;
        new Setting(block)
            .setName(t('ui.bookFromCommunity.cardName'))
            .setDesc(t('ui.bookFromCommunity.cardDesc', { title: offer.title, scenes: tCount('scene', offer.sceneCount) }))
            .addButton(button => button
                .setButtonText(t('ui.bookFromCommunity.cardReview'))
                .setCta()
                .onClick(() => open(offer.transferId)));
    }
}
