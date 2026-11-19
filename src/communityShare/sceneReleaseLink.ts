/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The Release scenes link, and the Private scenes gates it shares with
 * Settings → Community.
 *
 *   obsidian://radial-timeline-release?book=<Community book id>[&scene=<scene id>]
 *
 * The Community website builds this link. `book` is the website project's
 * UUID; `scene` is the stable scene id (`scn_` + 8–10 hex) the timeline sync
 * sends. Every other parameter is ignored: the link carries no vault name and
 * no text, and opening it sends nothing but status reads. Text still leaves
 * only from the preview's Release / Update button.
 *
 * Everything here is pure, so each branch the link can take is tested without
 * Obsidian or the network. SceneReleaseLinkService wires it to the dialogs.
 */

import { t } from '../i18n';
import type { BookProfile, CommunityShareSettings } from '../types/settings';
import { isOpaqueSceneId } from '../utils/sceneIds';
import type { SceneReleaseStatus } from './communityShareClient';
import {
    COMMUNITY_UUID_RE,
    canShareTimelineToCommunity,
    sceneBodyShareFor,
    timelineShareFor,
} from './communityShareSettings';
import type { SceneReleaseRow } from './sceneReleaseVault';

export const SCENE_RELEASE_PROTOCOL_ACTION = 'radial-timeline-release';

export interface SceneReleaseLink {
    /** The website project's UUID, lower case. */
    book: string;
    /** The stable scene id; absent to open the list. */
    scene?: string;
}

/** The link's book and scene, or null when either is malformed. Other parameters are ignored. */
export function parseSceneReleaseLink(params: Readonly<Record<string, string | undefined>>): SceneReleaseLink | null {
    const { book, scene } = params;
    if (typeof book !== 'string' || !COMMUNITY_UUID_RE.test(book)) return null;
    if (scene === undefined) return { book: book.toLowerCase() };
    if (!isOpaqueSceneId(scene)) return null;
    return { book: book.toLowerCase(), scene };
}

/** Why Share scene body can't be turned on for this book right now, in the author's words; null when it can. */
export function sceneBodyUnavailableReason(settings: CommunityShareSettings, book: BookProfile | undefined): string | null {
    if (settings.connection.status !== 'connected') return t('ui.communityShareSection.sceneBodyConnectNote');
    if (settings.sharingPaused) return t('ui.communityShareSection.sceneBodyPausedNote');
    // The same gate as the Timeline block: a scene is released onto the shared timeline.
    if (!canShareTimelineToCommunity(settings)) return t('ui.communityShareSection.sceneBodyLevelNote');
    if (!book || !book.sourceFolder?.trim()) return t('ui.communityShareSection.timelineNoBook');
    if (!timelineShareFor(settings, book.id)?.enabled) return t('ui.communityShareSection.sceneBodyTimelineNote');
    return null;
}

/** A website project as the share context reports it: its id and the Book Manager book it came from. */
export interface SceneReleaseLinkProject {
    id: string;
    plugin_book_key: string | null;
}

export type SceneReleaseLinkRoute =
    /** Say this and stop. */
    | { kind: 'notice'; text: string }
    /** Open Settings → Community at Private scenes, for `book` when one is named, and say this. */
    | { kind: 'settings'; text: string; book?: BookProfile }
    /** Ask the website which project the vault holds for that book. */
    | { kind: 'lookup' }
    /** Read the book's release status. */
    | { kind: 'status'; book: BookProfile };

/**
 * The first step, before anything is sent: a vault with no Community
 * connection gets the next step; a paused vault, or one at the Private level,
 * is taken to the setting that says how to change it.
 */
export function sceneReleaseLinkGate(settings: CommunityShareSettings): SceneReleaseLinkRoute {
    if (settings.connection.status !== 'connected') return { kind: 'notice', text: t('ui.sceneReleaseLink.connect') };
    if (settings.sharingPaused) return { kind: 'settings', text: t('ui.communityShareSection.sceneBodyPausedNote') };
    if (!canShareTimelineToCommunity(settings)) return { kind: 'settings', text: t('ui.communityShareSection.sceneBodyLevelNote') };
    return { kind: 'lookup' };
}

/**
 * The second step, with the website's projects for this connection: which
 * Book Manager book the link names, and whether it is ready to release from.
 * Share scene body is never turned on here: the author is taken to it.
 */
export function sceneReleaseLinkBook(
    settings: CommunityShareSettings,
    books: readonly BookProfile[],
    projects: readonly SceneReleaseLinkProject[],
    link: SceneReleaseLink
): SceneReleaseLinkRoute {
    const project = projects.find(candidate => candidate.id.toLowerCase() === link.book);
    const book = project?.plugin_book_key ? books.find(candidate => candidate.id === project.plugin_book_key) : undefined;
    if (!book) return { kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') };
    const unavailable = sceneBodyUnavailableReason(settings, book);
    if (unavailable) return { kind: 'settings', text: unavailable, book };
    if (!sceneBodyShareFor(settings, book.id)?.enabled) {
        return { kind: 'settings', text: t('ui.sceneReleaseLink.turnOnSceneBody', { book: book.title }), book };
    }
    return { kind: 'status', book };
}

export type SceneReleaseLinkOpen =
    | { kind: 'notice'; text: string }
    /** The list; `focusSceneId` scrolls to and highlights that scene, `notice` is said as it opens. */
    | { kind: 'list'; focusSceneId?: string; notice?: string }
    /** The preview for a first release of this scene. */
    | { kind: 'preview'; scene: { path: string; title: string; sceneId: string } };

/**
 * The last step, with the website's status and the book's scenes: what opens.
 * Only a scene the list would offer Preview and release for opens its preview.
 * A scene already released opens the list at that scene, where its update and
 * take-down are, so an update is always chosen beside the released version.
 */
export function sceneReleaseLinkOpen(
    status: Pick<SceneReleaseStatus, 'project_id' | 'standing' | 'limit' | 'releases'>,
    rows: readonly SceneReleaseRow[],
    link: SceneReleaseLink
): SceneReleaseLinkOpen {
    // The website moved the book while the link was being opened.
    if (status.project_id.toLowerCase() !== link.book) return { kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') };
    if (status.standing) return { kind: 'notice', text: t('ui.communityShareSection.sceneBodyStandingNote') };
    if (!link.scene) return { kind: 'list' };
    const row = rows.find(candidate => candidate.scene?.sceneId === link.scene);
    const scene = row?.scene;
    if (!row || !scene) return { kind: 'list', notice: t('ui.sceneReleaseLink.sceneMissing') };
    const atLimit = status.releases.length >= status.limit;
    if (row.state === 'not_released' && !atLimit) {
        return { kind: 'preview', scene: { path: scene.path, title: scene.title, sceneId: link.scene } };
    }
    return { kind: 'list', focusSceneId: link.scene };
}
