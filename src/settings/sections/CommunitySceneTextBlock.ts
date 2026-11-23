/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Settings → Community → Vault → Community, the active book at Level 4: the
 * scenes asked for on Community, each with Review (the Send scene to Community
 * dialog), and the scenes released, each saying when the vault's text has
 * changed since (contract 2026-11-22, "Scene text asked on Community, sent
 * from the vault").
 *
 * Reading these sends no text: a status read and a requests read, each naming
 * the book only. Text leaves only from the dialog's Send.
 */

import { Setting } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { CommunityShareError } from '../../communityShare/communityShareClient';
import { COMMUNITY_SITE_URL } from '../../communityShare/communityMailbox';
import { canShareSceneText, normalizeCommunityShareSettings, timelineShareFor } from '../../communityShare/communityShareSettings';
import { loadSceneTextState, requestedSceneNote, type SceneTextState } from '../../communityShare/sceneReleaseVault';
import type { SceneTextRequest } from '../../communityShare/sceneTextRequests';
import { SceneTextSendModal } from '../../modals/SceneTextSendModal';
import { ERT_CLASSES, ERT_DATA } from '../../ui/classes';
import type { BookProfile, CommunityShareSettings } from '../../types/settings';
import { COMMUNITY_PRIVATE_SCENES_SECTION_KEY } from '../settingsAnchors';
import { formatCommunityDate } from '../../communityShare/sharingWords';
import { t, tCount } from '../../i18n';

export interface CommunitySceneTextBlockProps {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    book: BookProfile;
    rerender: () => void;
}

// The section rerenders on every save, so the website's answer lives here and
// refreshes at most once per TTL, like the Timeline block's.
interface SceneTextCache {
    key: string;
    fetchedAt: number;
    state?: SceneTextState;
    error?: string;
}
let stateCache: SceneTextCache | null = null;
let stateInflight = false;
const STATE_TTL_MS = 60 * 1000;

function cacheKey(settings: CommunityShareSettings, book: Pick<BookProfile, 'id'>): string {
    return `${settings.connection.connectionId ?? ''}:${book.id}`; // SAFE: before Community connects there is no connection id, and nothing is fetched
}

/** Forget the website's answer, so the next render reads it again (after a Send, a Decline, or a link). */
export function forgetSceneTextState(): void {
    stateCache = null;
}

/** What Vault → Community's line counts for the active book: known only after the website answered. */
export function knownSceneTextCounts(settings: CommunityShareSettings, book: BookProfile | undefined): { asked?: number; released?: number } {
    if (!book || !canShareSceneText(settings)) return {};
    const state = stateCache?.key === cacheKey(settings, book) ? stateCache.state : undefined;
    return state ? { asked: state.requests.length, released: state.status.releases.length } : {};
}

/** Open the Send dialog for one request. Shared with the obsidian://radial-timeline-release link. */
export function openSceneTextRequest(plugin: RadialTimelinePlugin, book: BookProfile, state: SceneTextState, request: SceneTextRequest, onDone: () => void): void {
    new SceneTextSendModal(plugin.app, {
        plugin,
        book,
        request,
        scenePath: requestedSceneNote(state.rows, request)?.path,
        status: state.status,
        onDone,
    }).open();
}

export function renderCommunitySceneTextBlock({ plugin, containerEl, book, rerender }: CommunitySceneTextBlockProps): void {
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    // The section renders this block only at Level 4; while paused nothing is read, and the Vault → Community row says so.
    if (!canShareSceneText(settings)) return;
    // Keyed so the obsidian://radial-timeline-release link can open Settings here.
    const block = containerEl.createDiv({ cls: ERT_CLASSES.STACK, attr: { [ERT_DATA.SECTION]: COMMUNITY_PRIVATE_SCENES_SECTION_KEY } });
    if (!timelineShareFor(settings, book.id)?.enabled) {
        new Setting(block)
            .setName(t('ui.communityShareSection.requestsName'))
            .setDesc(t('ui.communityShareSection.sceneTextTimelineFirst'));
        return;
    }

    const key = cacheKey(settings, book);
    const cached = stateCache?.key === key ? stateCache : null;
    const state = cached?.state;
    if ((!cached || Date.now() - cached.fetchedAt >= STATE_TTL_MS) && !stateInflight) {
        stateInflight = true;
        void loadSceneTextState(plugin, book)
            .then(next => { stateCache = { key, fetchedAt: Date.now(), state: next }; })
            .catch((error: unknown) => {
                stateCache = {
                    key,
                    fetchedAt: Date.now(),
                    error: error instanceof CommunityShareError ? error.message : t('ui.communityShareSection.sceneBodyStatusFailed'),
                };
            })
            .finally(() => {
                stateInflight = false;
                rerender();
            });
    }
    const changed = (): void => {
        forgetSceneTextState();
        rerender();
    };

    // Scenes asked for on Community: each opens the Send dialog.
    const requests = state?.requests ?? [];
    const asked = new Setting(block)
        .setName(t('ui.communityShareSection.requestsName'))
        .setDesc(state
            ? requests.length ? tCount('sceneAsked', requests.length) : t('ui.communityShareSection.requestsNone')
            : cached?.error ?? t('ui.communityShareSection.timelineShareChecking'));
    if (state?.status.standing) asked.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.sceneBodyStandingNote') });
    for (const request of requests) {
        new Setting(block)
            .setName(request.scene_title)
            .setDesc(t('ui.communityShareSection.requestAsked', {
                kind: t(request.kind === 'update' ? 'ui.communityShareSection.requestKindUpdate' : 'ui.communityShareSection.requestKindRelease'),
                date: formatCommunityDate(request.asked_at),
            }))
            .addButton(button => button
                .setButtonText(t('ui.communityShareSection.requestReview'))
                .setCta()
                .setDisabled(Boolean(state?.status.standing))
                .onClick(() => {
                    if (!state) return;
                    openSceneTextRequest(plugin, book, state, request, changed);
                }));
    }

    if (!state) return;
    // Released scenes: readers, and whether the vault's text has changed since.
    const released = state.rows.filter(row => row.release);
    const releasedRow = new Setting(block)
        .setName(t('ui.communityShareSection.releasedName'))
        .setDesc(t('ui.communityShareSection.releasedCount', { count: state.status.releases.length, limit: state.status.limit }));
    releasedRow.controlEl.createEl('a', {
        text: t('ui.communityShareSection.sceneBodyReadersLink'),
        href: `${COMMUNITY_SITE_URL}/me/scenes/${encodeURIComponent(state.status.project_id)}`,
        attr: { target: '_blank', rel: 'noopener' },
    });
    for (const row of released) {
        const release = row.release!; // SAFE: filtered to rows with a release above
        const item = new Setting(block)
            .setName(row.title)
            .setDesc(t('ui.communityShareSection.releasedRow', {
                readers: tCount('reader', release.readers),
                date: formatCommunityDate(release.updated_at),
            }));
        const note = row.state === 'changed' ? 'ui.communityShareSection.releasedChanged'
            : row.state === 'hidden' ? 'ui.sceneReleaseModal.stateHidden'
                : row.state === 'website' ? 'ui.communityShareSection.releasedNotInVault' : null;
        if (note) item.descEl.createDiv({ cls: `${ERT_CLASSES.FIELD_NOTE} ert-community-timeline-warning`, text: t(note) });
    }
}
