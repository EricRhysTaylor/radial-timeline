/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Settings → Community → Private scenes: release the text of chosen scenes of
 * the active book to readers the author names on the website.
 *
 * Share scene body is a local, per-book switch, off by default. Turning it on
 * reads the website's status and records the author's agreement to the release
 * terms; it sends no text, and neither does anything else in this block. Text
 * leaves only from the preview dialog's Release / Update button. The website
 * holds which scenes are released and who reads them; this block reads that.
 */

import { Notice, Setting } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import {
    CommunityShareError,
    acceptSceneReleaseTerms,
    fetchSceneReleaseStatus,
    setSceneBodySharing,
    type SceneReleaseStatus,
} from '../../communityShare/communityShareClient';
import { COMMUNITY_SITE_URL } from '../../communityShare/communityMailbox';
import {
    canShareTimelineToCommunity,
    normalizeCommunityShareSettings,
    sceneBodyShareFor,
    timelineShareFor,
} from '../../communityShare/communityShareSettings';
import { confirmSceneReleaseTerms } from '../../modals/SceneReleaseConsentModal';
import { SceneReleaseListModal } from '../../modals/SceneReleaseListModal';
import { ERT_CLASSES } from '../../ui/classes';
import type { BookProfile, CommunityShareSettings } from '../../types/settings';
import { addHeadingIcon, applyErtHeaderLayout } from '../wikiLink';
import { t } from '../../i18n';

export interface CommunitySceneBodyBlockProps {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    book: BookProfile | undefined;
    rerender: () => void;
}

// The section rerenders on every save, so the website's answer lives here and
// refreshes at most once per TTL, like the Timeline block's.
interface SceneStatusCache {
    key: string;
    fetchedAt: number;
    answer?: SceneReleaseStatus;
    error?: string;
}
let statusCache: SceneStatusCache | null = null;
let statusInflight = false;
const STATUS_TTL_MS = 60 * 1000;

function errorText(error: unknown, fallback: string): string {
    return error instanceof CommunityShareError ? error.message : fallback;
}

function addNote(setting: Setting, text: string): void {
    setting.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text });
}

/** Why Share scene body can't be turned on right now, in the author's words; null when it can. */
function unavailableReason(settings: CommunityShareSettings, book: BookProfile | undefined): string | null {
    if (settings.connection.status !== 'connected') return t('ui.communityShareSection.sceneBodyConnectNote');
    if (settings.sharingPaused) return t('ui.communityShareSection.sceneBodyPausedNote');
    // The same gate as the Timeline block: a scene is released onto the shared timeline.
    if (!canShareTimelineToCommunity(settings)) return t('ui.communityShareSection.sceneBodyLevelNote');
    if (!book || !book.sourceFolder?.trim()) return t('ui.communityShareSection.timelineNoBook');
    if (!timelineShareFor(settings, book.id)?.enabled) return t('ui.communityShareSection.sceneBodyTimelineNote');
    return null;
}

/**
 * The release terms, agreed once per account. Shows the consent dialog only
 * when the website has no agreement on record, and records one only when the
 * author presses I agree.
 */
async function ensureReleaseTerms(plugin: RadialTimelinePlugin, book: BookProfile, status: SceneReleaseStatus): Promise<boolean> {
    if (status.consent) return true;
    if (!await confirmSceneReleaseTerms(plugin.app)) return false;
    await acceptSceneReleaseTerms(plugin, book);
    return true;
}

export function renderCommunitySceneBodyBlock({ plugin, containerEl, book, rerender }: CommunitySceneBodyBlockProps): void {
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const block = containerEl.createDiv({ cls: ERT_CLASSES.STACK });
    const heading = new Setting(block)
        .setName(t('ui.communityShareSection.sceneBodyHeading'))
        .setHeading()
        .setDesc(t('ui.communityShareSection.sceneBodyDesc'));
    addHeadingIcon(heading, 'book-open-text');
    applyErtHeaderLayout(heading);
    heading.descEl.createEl('br');
    heading.descEl.createEl('a', { text: t('ui.communityShareSection.sceneBodyTermsLink'), href: `${COMMUNITY_SITE_URL}/agreements#private-scene-sharing`, attr: { target: '_blank', rel: 'noopener' } });

    const unavailable = unavailableReason(settings, book);
    const record = book ? sceneBodyShareFor(settings, book.id) : undefined;
    const on = record?.enabled === true;
    const key = `${settings.connection.connectionId ?? ''}:${book?.id ?? ''}`; // SAFE: before Community connects, or with no book, there is nothing to key on and nothing is fetched

    const shareRow = new Setting(block)
        .setName(t('ui.communityShareSection.sceneBodyShareName'))
        .setDesc(on && book
            ? t('ui.communityShareSection.sceneBodyShareOn', { book: book.publicLabel || book.title }) // SAFE: the public label is optional; the book's own title is always set
            : t('ui.communityShareSection.sceneBodyShareOff'))
        .addToggle(toggle => {
            // Off is always reachable: it is local and sends nothing.
            toggle.setValue(on).setDisabled(!book || (unavailable !== null && !on));
            toggle.onChange(async next => {
                if (!book) return;
                if (!next) {
                    await setSceneBodySharing(plugin, book.id, false);
                    rerender();
                    return;
                }
                toggle.setDisabled(true);
                try {
                    const status = await fetchSceneReleaseStatus(plugin, book);
                    if (status.standing) {
                        new Notice(t('ui.communityShareSection.sceneBodyStandingNote'));
                    } else if (!status.has_timeline) {
                        new Notice(t('ui.communityShareSection.sceneBodyTimelineNote'));
                    } else if (await ensureReleaseTerms(plugin, book, status)) {
                        await setSceneBodySharing(plugin, book.id, true, status.project_id);
                        statusCache = { key, fetchedAt: Date.now(), answer: { ...status, consent: true } };
                    }
                } catch (error) {
                    new Notice(errorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
                }
                rerender();
            });
        });

    if (unavailable) addNote(shareRow, unavailable);
    if (on) addNote(shareRow, t('ui.communityShareSection.sceneBodyOffNote'));
    if (!on || unavailable || !book) return;

    const cached = statusCache?.key === key ? statusCache : null;
    const answer = cached?.answer;
    const stale = !cached || Date.now() - cached.fetchedAt >= STATUS_TTL_MS;
    if (stale && !statusInflight) {
        statusInflight = true;
        const requestedAt = Date.now();
        // Turning the switch on, or a change in the dialog, caches its own newer answer.
        const newerCached = () => statusCache?.key === key && statusCache.fetchedAt >= requestedAt;
        void fetchSceneReleaseStatus(plugin, book)
            .then(next => {
                if (!newerCached()) statusCache = { key, fetchedAt: Date.now(), answer: next };
            })
            .catch((error: unknown) => {
                if (newerCached()) return;
                statusCache = {
                    key,
                    fetchedAt: Date.now(),
                    error: errorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')),
                };
            })
            .finally(() => {
                statusInflight = false;
                rerender();
            });
    }

    const releasedRow = new Setting(block)
        .setName(t('ui.communityShareSection.sceneBodyReleasedName'))
        .setDesc(answer
            ? t('ui.communityShareSection.sceneBodyReleasedCount', { count: answer.releases.length, limit: answer.limit })
            : cached?.error ?? t('ui.communityShareSection.timelineShareChecking'))
        .addButton(button => button
            .setButtonText(t('ui.communityShareSection.sceneBodyReleaseButton'))
            .setDisabled(!answer || answer.standing !== null)
            .onClick(async () => {
                if (!answer) return;
                try {
                    if (!await ensureReleaseTerms(plugin, book, answer)) return;
                } catch (error) {
                    new Notice(errorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
                    return;
                }
                if (statusCache?.key === key && statusCache.answer) {
                    statusCache = { ...statusCache, answer: { ...statusCache.answer, consent: true } };
                }
                new SceneReleaseListModal(plugin.app, plugin, book, () => {
                    // Released, updated or taken down: read the count again.
                    if (statusCache?.key === key) statusCache = null;
                    rerender();
                }).open();
            }));
    if (answer?.standing) addNote(releasedRow, t('ui.communityShareSection.sceneBodyStandingNote'));

    const projectId = answer?.project_id ?? record?.projectId;
    if (!projectId) return;
    const readersRow = new Setting(block)
        .setName(t('ui.communityShareSection.sceneBodyReadersName'))
        .setDesc(t('ui.communityShareSection.sceneBodyReadersDesc'));
    readersRow.controlEl.createEl('a', {
        text: t('ui.communityShareSection.sceneBodyReadersLink'),
        href: `${COMMUNITY_SITE_URL}/me/scenes/${encodeURIComponent(projectId)}`,
        attr: { target: '_blank', rel: 'noopener' },
    });
}
