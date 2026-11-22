/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The Send scene link from the Community website (contract 2026-11-22):
 *
 *   obsidian://radial-timeline-release?book=<Community book id>&scene=<scene id>&request=<request id>
 *
 * Community shows it while a scene asked for waits for Radial Timeline. `book`
 * is the website project's UUID; `scene` the stable scene id (`scn_` + 8–10
 * hex); `request` the request's UUID. Every other parameter is ignored: the
 * link carries no vault name and no text, and opening it sends nothing but the
 * status and requests reads. Text leaves only from the Send dialog's Send.
 *
 * Everything here is pure, so each branch the link can take is tested without
 * Obsidian or the network. SceneReleaseLinkService wires it to the dialog.
 */

import { t } from '../i18n';
import type { BookProfile, CommunityShareSettings } from '../types/settings';
import { isOpaqueSceneId } from '../utils/sceneIds';
import type { SceneReleaseStatus } from './communityShareClient';
import { COMMUNITY_UUID_RE, canShareSceneText } from './communityShareSettings';
import type { SceneTextRequest } from './sceneTextRequests';

export const SCENE_RELEASE_PROTOCOL_ACTION = 'radial-timeline-release';

export interface SceneReleaseLink {
    /** The website project's UUID, lower case. */
    book: string;
    /** The stable scene id. */
    scene?: string;
    /** The request's UUID, lower case; absent to open Settings at the book. */
    request?: string;
}

/** The link's book, scene and request, or null when one is malformed. Other parameters are ignored. */
export function parseSceneReleaseLink(params: Readonly<Record<string, string | undefined>>): SceneReleaseLink | null {
    const { book, scene, request } = params;
    if (typeof book !== 'string' || !COMMUNITY_UUID_RE.test(book)) return null;
    if (scene !== undefined && !isOpaqueSceneId(scene)) return null;
    if (request !== undefined && !COMMUNITY_UUID_RE.test(request)) return null;
    return {
        book: book.toLowerCase(),
        ...(scene !== undefined ? { scene } : {}),
        ...(request !== undefined ? { request: request.toLowerCase() } : {}),
    };
}

/** A website project as the share context reports it: its id and the Book Manager book it came from. */
export interface SceneReleaseLinkProject {
    id: string;
    plugin_book_key: string | null;
}

export type SceneReleaseLinkRoute =
    /** Say this and stop. */
    | { kind: 'notice'; text: string }
    /** Open Settings → Community at the book, for `book` when one is named, and say this. */
    | { kind: 'settings'; text: string; book?: BookProfile }
    /** Ask the website which project the vault holds for that book. */
    | { kind: 'lookup' }
    /** Read the book's status and requests. */
    | { kind: 'status'; book: BookProfile };

/**
 * The first step, before anything is sent: a vault with no Community
 * connection gets the next step; a paused vault, or one below Level 4, is
 * taken to the setting that says how to change it.
 */
export function sceneReleaseLinkGate(settings: CommunityShareSettings): SceneReleaseLinkRoute {
    if (settings.connection.status !== 'connected') return { kind: 'notice', text: t('ui.sceneReleaseLink.connect') };
    if (settings.sharingPaused) return { kind: 'settings', text: t('ui.communityShareClient.sceneReleasePaused') };
    if (!canShareSceneText(settings)) return { kind: 'settings', text: t('ui.communityShareClient.sceneReleaseLevelRequired') };
    return { kind: 'lookup' };
}

/** The second step, with the website's projects for this connection: which Book Manager book the link names. */
export function sceneReleaseLinkBook(
    books: readonly BookProfile[],
    projects: readonly SceneReleaseLinkProject[],
    link: SceneReleaseLink
): SceneReleaseLinkRoute {
    const project = projects.find(candidate => candidate.id.toLowerCase() === link.book);
    const book = project?.plugin_book_key ? books.find(candidate => candidate.id === project.plugin_book_key) : undefined;
    if (!book) return { kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') };
    if (!book.sourceFolder?.trim()) return { kind: 'settings', text: t('ui.communityShareSection.timelineNoBook'), book };
    return { kind: 'status', book };
}

export type SceneReleaseLinkOpen =
    | { kind: 'notice'; text: string }
    /** Settings → Community at the book; `notice` is said as it opens. */
    | { kind: 'settings'; notice?: string }
    /** The Send dialog for this request. */
    | { kind: 'send'; request: SceneTextRequest };

/** The last step, with the website's status and requests: what opens. */
export function sceneReleaseLinkOpen(
    status: Pick<SceneReleaseStatus, 'project_id' | 'standing'>,
    requests: readonly SceneTextRequest[],
    link: SceneReleaseLink
): SceneReleaseLinkOpen {
    // The website moved the book while the link was being opened.
    if (status.project_id.toLowerCase() !== link.book) return { kind: 'notice', text: t('ui.sceneReleaseLink.otherBook') };
    if (status.standing) return { kind: 'notice', text: t('ui.communityShareSection.sceneBodyStandingNote') };
    if (!link.request) return { kind: 'settings' };
    const request = requests.find(candidate => candidate.id.toLowerCase() === link.request);
    if (!request) return { kind: 'settings', notice: t('ui.sceneReleaseLink.requestMissing') };
    return { kind: 'send', request };
}
