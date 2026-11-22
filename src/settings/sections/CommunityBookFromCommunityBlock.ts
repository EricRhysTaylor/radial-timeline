/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Settings → Community → Community → Vault: the website-to-vault direction.
 * Its row counts the books waiting and opens by itself when one is; inside, a
 * row for each book the author chose Add to my vault for on the website, and
 * for each one already on its way. Review opens the preview
 * (BookFromCommunityModal); nothing is written from here.
 *
 * With nothing waiting, or a website that does not answer this call yet, the
 * row stays closed and dimmed, "No books waiting", with how a book gets here
 * inside. Nothing is logged.
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
import { renderCommunityDirection } from './communityDirectionRow';

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
    const key = settings.connection.status === 'connected' ? settings.connection.connectionId : undefined;
    const canList = key !== undefined && canShareTimelineToCommunity(settings) && !settings.sharingPaused;
    const cached = canList && listCache?.view === viewEl && listCache.key === key ? listCache : null;
    const asking = listRequest?.view === viewEl && listRequest.key === key;
    if (canList && (!cached || Date.now() - cached.fetchedAt >= LIST_TTL_MS) && !asking) {
        const request = { view: viewEl, key };
        listRequest = request;
        void listBookTransfers(plugin)
            // Nothing waiting, a website that does not answer this call yet, or
            // no network: the count stays 0, and nothing is reported.
            .catch((): BookTransferOffer[] => [])
            .then(offers => {
                // A newer view, or a change from the preview, asked again since: this answer is out of date.
                if (listRequest !== request) return;
                listRequest = null;
                listCache = { view: viewEl, key, fetchedAt: Date.now(), offers };
                if (viewEl.isConnected) rerender();
            });
    }

    const offers = cached?.offers ?? []; // SAFE: before this view's first answer nothing is known to be waiting
    const records = key !== undefined ? bookTransferRecords(settings) : [];
    const recordIds = new Set(records.map(([transferId]) => transferId));
    const newOffers = offers.filter(offer => !recordIds.has(offer.transferId));
    const waiting = newOffers.length + records.filter(([, record]) => record.phase !== 'cancelled').length;

    // The count is known once the website can be asked: connected, at a level that shares, not paused.
    const summary = waiting > 0
        ? tCount('bookWaiting', waiting)
        : t(!key
            ? 'ui.bookFromCommunity.importConnect'
            : settings.sharingPaused
                ? 'ui.bookFromCommunity.importPaused'
                : !canList ? 'ui.bookFromCommunity.importLevel' : 'ui.bookFromCommunity.importNone');
    const groupEl = renderCommunityDirection(containerEl, {
        view: viewEl,
        direction: 'import',
        name: t('ui.bookFromCommunity.importName'),
        summary,
        muted: waiting === 0,
        needsAuthor: waiting > 0,
    });
    if (waiting === 0) groupEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.bookFromCommunity.importEmpty') });

    const changed = (): void => {
        forgetBookTransferList();
        rerender();
    };
    const open = (transferId: string): void => {
        new BookFromCommunityModal(plugin.app, plugin, transferId, { onChanged: changed }).open();
    };

    for (const [transferId, record] of records) {
        const bookRow = new Setting(groupEl).setName(record.title);
        if (record.phase === 'cancelled') {
            bookRow.setDesc(t('ui.bookFromCommunity.cancelled', { folder: record.folder }))
                .addButton(button => button
                    .setButtonText(t('ui.bookFromCommunity.cardCancelledButton'))
                    .onClick(async () => {
                        try {
                            await obsidianBookTransferDeps(plugin).store.remove(transferId);
                        } catch (error) {
                            // Plugin data could not be saved; the record stays on the card.
                            console.error('Book from Community could not save its record:', error);
                            return;
                        }
                        changed();
                    }));
            continue;
        }
        bookRow.setDesc(t('ui.bookFromCommunity.cardStarted', { folder: record.folder }))
            .addButton(button => button
                .setButtonText(t('ui.bookFromCommunity.cardContinue'))
                .setCta()
                .onClick(() => open(transferId)));
    }
    for (const offer of newOffers) {
        new Setting(groupEl)
            .setName(offer.title)
            .setDesc(tCount('scene', offer.sceneCount))
            .addButton(button => button
                .setButtonText(t('ui.bookFromCommunity.cardReview'))
                .setCta()
                .onClick(() => open(offer.transferId)));
    }
}
