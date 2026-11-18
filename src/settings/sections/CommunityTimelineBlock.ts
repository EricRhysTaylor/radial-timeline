/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Settings → Community → Timeline: share a book's timeline without exporting a
 * file. The website holds the truth about the share: whether it is live and
 * which details show. This block reads that and writes the author's choices
 * back. Going live stays a click on the website.
 */

import { Notice, Setting, setIcon, type ToggleComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import {
    CommunityShareError,
    fetchTimelineShareStatus,
    setTimelineShareDetails,
    startTimelineSharing,
    stopTimelineSharing,
    type TimelineSceneDetail,
    type TimelineShareAnswer,
} from '../../communityShare/communityShareClient';
import { COMMUNITY_SITE_URL } from '../../communityShare/communityMailbox';
import {
    canShareTimelineToCommunity,
    normalizeCommunityShareSettings,
    timelineShareFor,
} from '../../communityShare/communityShareSettings';
import { confirmWithErtModal } from '../../modals/ErtConfirmModal';
import { ERT_CLASSES } from '../../ui/classes';
import type { BookProfile, CommunityTimelineShareRecord } from '../../types/settings';
import { addHeadingIcon, applyErtHeaderLayout } from '../wikiLink';
import { t } from '../../i18n';
import { renderTimelinePreview } from '../../communityShare/timelinePreview';

export interface CommunityTimelineBlockProps {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    book: BookProfile | undefined;
    rerender: () => void;
}

// The section rerenders on every save, so the website's answer lives here and
// refreshes at most once per TTL, like the website context beside it.
interface TimelineStatusCache {
    key: string;
    fetchedAt: number;
    answer?: TimelineShareAnswer;
    error?: string;
}
let statusCache: TimelineStatusCache | null = null;
let statusInflight = false;
// Bumped whenever a write clears the cache, so a status read that started
// before the write cannot cache its older answer as fresh.
let statusEpoch = 0;
const detailSaves = new Set<string>();
const STATUS_TTL_MS = 60 * 1000;

const getDetailLabels = (): Array<{ field: TimelineSceneDetail; label: string }> => [
    { field: 'title', label: t('ui.communityShareSection.timelineDetailTitle') },
    { field: 'synopsis', label: t('ui.communityShareSection.timelineDetailSynopsis') },
    { field: 'characters', label: t('ui.communityShareSection.timelineDetailCast') },
    { field: 'povMode', label: t('ui.communityShareSection.timelineDetailPov') },
    { field: 'when', label: t('ui.communityShareSection.timelineDetailWhen') },
];

function errorText(error: unknown, fallback: string): string {
    return error instanceof CommunityShareError ? error.message : fallback;
}

export function shareDescription(
    book: BookProfile,
    record: CommunityTimelineShareRecord | undefined,
    answer: TimelineShareAnswer | undefined
): string {
    if (!answer) return t('ui.communityShareSection.timelineShareChecking');
    if (!record?.enabled) {
        return answer.shared
            ? t('ui.communityShareSection.timelineShareOffExisting')
            : t('ui.communityShareSection.timelineShareOff', { book: book.publicLabel || book.title }); // SAFE: the public label is optional; the book's own title is always set
    }
    return answer.share?.status === 'active'
        ? t('ui.communityShareSection.timelineShareLive')
        : t('ui.communityShareSection.timelineSharePrivate');
}

function addNote(setting: Setting, text: string, kind: 'note' | 'sent' | 'warning' = 'note'): void {
    setting.descEl.createDiv({ cls: `${ERT_CLASSES.FIELD_NOTE} ert-community-timeline-${kind}`, text });
}

export function renderCommunityTimelineBlock({ plugin, containerEl, book, rerender }: CommunityTimelineBlockProps): void {
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const block = containerEl.createDiv({ cls: ERT_CLASSES.STACK });
    const heading = new Setting(block)
        .setName(t('ui.communityShareSection.timelineHeading'))
        .setHeading()
        .setDesc(t('ui.communityShareSection.timelineDesc'));
    addHeadingIcon(heading, 'orbit');
    applyErtHeaderLayout(heading);

    if (settings.connection.status !== 'connected') {
        new Setting(block).setDesc(t('ui.communityShareSection.connectToLoadNote'));
        return;
    }
    // Private level does not send a book identifier to the website.
    const canShare = canShareTimelineToCommunity(settings);
    if (!settings.sharingPaused && !canShare) {
        new Setting(block).setDesc(t('ui.communityShareSection.timelineLevelNote'));
        return;
    }
    if (!book || !book.sourceFolder?.trim()) {
        new Setting(block).setDesc(t('ui.communityShareSection.timelineNoBook'));
        return;
    }

    const bookId = book.id;
    const record = timelineShareFor(settings, bookId);
    const paused = settings.sharingPaused;
    const key = `${settings.connection.connectionId ?? ''}:${bookId}`; // SAFE: before Community connects there is no connection id to key on
    const cached = statusCache?.key === key ? statusCache : null;
    const stale = !cached || Date.now() - cached.fetchedAt >= STATUS_TTL_MS;
    const answer = stale ? undefined : cached?.answer;
    const share = answer?.share;
    if (stale && !statusInflight) {
        statusInflight = true;
        const requestedAt = Date.now();
        const epochAtStart = statusEpoch;
        // A send or detail save while this was out makes its answer out of date.
        const newerCached = () => statusEpoch !== epochAtStart
            || (statusCache?.key === key && statusCache.fetchedAt >= requestedAt);
        void fetchTimelineShareStatus(plugin, bookId)
            .then(next => {
                if (!newerCached()) statusCache = { key, fetchedAt: Date.now(), answer: next };
            })
            .catch((error: unknown) => {
                if (newerCached()) return;
                statusCache = {
                    key,
                    fetchedAt: Date.now(),
                    error: errorText(error, t('ui.communityShareSection.timelineStatusFailed')),
                };
            })
            .finally(() => {
                statusInflight = false;
                rerender();
            });
    }

    const shareRow = new Setting(block)
        .setName(t('ui.communityShareSection.timelineShareName'))
        .setDesc(cached?.error && !answer
            ? t('ui.communityShareSection.timelineStatusUnknown')
            : shareDescription(book, record, answer))
        .addToggle(toggle => {
            toggle.setValue(record?.enabled === true).setDisabled(paused || (!canShare && !record?.enabled));
            toggle.onChange(async next => {
                if (!next) {
                    try {
                        await stopTimelineSharing(plugin, bookId);
                        new Notice(t('ui.communityShareSection.timelineStoppedNotice'));
                    } catch (error) {
                        console.error('Could not stop timeline sharing:', error);
                    }
                    rerender();
                    return;
                }
                const confirmed = await confirmWithErtModal(plugin.app, {
                    title: t('ui.communityShareSection.timelineConfirmTitle'),
                    message: t('ui.communityShareSection.timelineConfirmMessage'),
                    confirmText: t('ui.communityShareSection.timelineConfirmButton'),
                });
                if (!confirmed) {
                    rerender();
                    return;
                }
                toggle.setDisabled(true);
                try {
                    const sent = await startTimelineSharing(plugin, book);
                    statusCache = null; // Re-read the website's filtered preview after the send.
                    statusEpoch++;
                    new Notice(sent.share?.status === 'active'
                        ? t('ui.communityShareSection.timelineUpdatedNotice')
                        : t('ui.communityShareSection.timelineSentNotice'));
                } catch (error) {
                    new Notice(errorText(error, t('ui.communityShareSection.timelineSendFailed')));
                }
                rerender();
            });
        });

    if (paused) addNote(shareRow, t('ui.communityShareSection.timelinePausedNote'));
    else if (!canShare) addNote(shareRow, t('ui.communityShareSection.timelineLevelNote'));
    if (record?.enabled) addNote(shareRow, t('ui.communityShareSection.timelineStopNote'));
    if (record?.lastSentAt) {
        const sentAt = new Date(record.lastSentAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
        addNote(shareRow, t('ui.communityShareSection.timelineLastSent', { date: sentAt }), 'sent');
    }
    if (record?.lastError) addNote(shareRow, record.lastError, 'warning');
    if (record?.enabled && cached?.error && cached.error !== record.lastError) addNote(shareRow, cached.error, 'warning');
    if (record?.droppedReveals?.length) {
        addNote(shareRow, t('ui.communityShareSection.timelineRevealsDropped', { scenes: record.droppedReveals.join(', ') }), 'warning');
    }
    if (record?.scenesWithoutStableId) {
        addNote(shareRow, t('ui.communityShareSection.timelineNoStableIds', { count: record.scenesWithoutStableId }), 'warning');
    }

    if (!answer?.shared || !share) return;

    // An open settings pane must not keep presenting an expired preview as current.
    const checkedAt = cached!.fetchedAt;
    window.setTimeout(() => {
        if (block.isConnected && statusCache?.key === key && statusCache.fetchedAt === checkedAt) rerender();
    }, Math.max(1, STATUS_TTL_MS - (Date.now() - checkedAt) + 10));
    const summary = block.createDiv({ cls: 'ert-community-wheel-card' });
    const visual = summary.createDiv({ cls: 'ert-community-wheel-card__image' });
    const text = summary.createDiv({ cls: 'ert-community-wheel-card__text' });
    text.createDiv({ cls: 'ert-community-wheel-card__title', text: book.publicLabel || book.title });
    const access = answer.reader_access === 'available' ? t('ui.communityShareSection.timelineReaderAvailable')
        : answer.reader_access === 'unavailable' ? t('ui.communityShareSection.timelineReaderUnavailable')
        : t('ui.communityShareSection.timelineReaderUnknown');
    text.createDiv({ text: access });
    text.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.timelineThumbnailNote') });
    text.createDiv({ text: t('ui.communityShareSection.timelineRevealCount', { revealed: share.revealed_count, total: share.scene_count }) });
    if (cached) text.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.timelineCheckedAt', { date: new Date(cached.fetchedAt).toLocaleString() }) });
    if (!answer.preview_document || !renderTimelinePreview(visual, answer.preview_document)) {
        visual.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.timelinePreviewUnavailable') });
    }


    const reviewRow = new Setting(block)
        .setName(t('ui.communityShareSection.timelineReviewName'))
        .setDesc(t('ui.communityShareSection.timelineReviewDesc'));
    const preview = reviewRow.controlEl.createEl('a', {
        cls: 'ert-community-timeline-preview',
        href: `${COMMUNITY_SITE_URL}/me/timeline/${encodeURIComponent(answer.project_id)}`,
        attr: { target: '_blank', rel: 'noopener' },
    });
    preview.createSpan({ text: t('ui.communityShareSection.timelineReviewButton') });
    const previewIcon = preview.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(previewIcon, 'external-link');

    const detailToggles: ToggleComponent[] = [];
    const saveDetails = async (details: Parameters<typeof setTimelineShareDetails>[2]): Promise<void> => {
        if (detailSaves.has(key)) return;
        detailSaves.add(key);
        detailToggles.forEach(toggle => { toggle.setDisabled(true); });
        try {
            await setTimelineShareDetails(plugin, bookId, details);
            statusCache = null; // A detail change needs a new reader-facing preview.
            statusEpoch++;
        } catch (error) {
            // A lost response does not prove the website rejected the change.
            // Re-read its state before another privacy choice can be made.
            if (statusCache?.key === key) statusCache = null;
            statusEpoch++;
            new Notice(errorText(error, t('ui.communityShareSection.timelineDetailsFailed')));
        } finally {
            detailSaves.delete(key);
            rerender();
        }
    };

    const detailsHeading = new Setting(block)
        .setName(t('ui.communityShareSection.timelineDetailsName'))
        .setDesc(t('ui.communityShareSection.timelineDetailsDesc'));
    applyErtHeaderLayout(detailsHeading);
    const hidden = new Set(share.hidden_scene_fields);
    for (const { field, label } of getDetailLabels()) {
        new Setting(block)
            .setName(label)
            .addToggle(toggle => {
                detailToggles.push(toggle);
                toggle.setValue(!hidden.has(field)).setDisabled(paused || !canShare || detailSaves.has(key)).onChange(async shown => {
                    const next = new Set(hidden);
                    if (shown) next.delete(field);
                    else next.add(field);
                    await saveDetails({ hiddenSceneFields: [...next] });
                });
            });
    }

    new Setting(block)
        .setName(t('ui.communityShareSection.timelineGenericName'))
        .setDesc(t('ui.communityShareSection.timelineGenericDesc'))
        .addToggle(toggle => {
            detailToggles.push(toggle);
            toggle.setValue(share.generic_subplot_names)
            .setDisabled(paused || !canShare || detailSaves.has(key))
            .onChange(async generic => {
                await saveDetails({ genericSubplotNames: generic });
            });
        });
}
