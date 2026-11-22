/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Scenes asked for on Community, and the vault's answer (contract 2026-11-22,
 * "Scene text asked on Community, sent from the vault").
 *
 * On Community the author asks for a scene of a book edited in Radial
 * Timeline, choosing its rating and readers there. The request waits; nothing
 * is sent. Here the plugin lists the open requests for a book, and the author
 * answers each one: Send (the scene's text, with the request's id) or Decline.
 * A release or an update always names the request it answers, so the vault
 * answers asks and never starts one.
 *
 * Every shape the website sends for requests, and every key the plugin sends
 * with them, is in this module and nowhere else.
 *
 * Wire shapes: the platform HANDOFF, "2026-11-22 Scene text asked on Community,
 * sent from the vault" (branch `scene-text-asks`), Plugin table:
 *   requests                                          → { ok: true, requests: SceneTextRequest[] } (open ones, oldest first)
 *   decline  { request_id }                           → { ok: true, request }
 *   release  { request_id, scene_id, blocks }         → { release, request }
 *   update   { request_id, scene_id, expected_version, blocks } → { release, request }
 * A release or update without request_id is refused (`ask_on_community`).
 */

import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import type { BookProfile } from '../types/settings';
import { isOpaqueSceneId } from '../utils/sceneIds';
import {
    CommunityShareError,
    isSceneReleaseResult,
    postSceneRelease,
    sceneTextProblemMessage,
    type SceneReleaseRating,
    type SceneReleaseResult,
} from './communityShareClient';
import { COMMUNITY_UUID_RE } from './communityShareSettings';
import { sceneTextProblem, type SceneBlock } from './sceneReleaseText';

/** Who reads the scene, as the author chose on Community: named readers, or everyone signed in. */
export type SceneTextAudience = 'named' | 'public';

/** One open request for a scene's text. Never carries the text. */
export interface SceneTextRequest {
    id: string;
    /** The stable id of the timeline scene asked for. */
    scene_id: string;
    scene_title: string;
    /** `release` for a first release, `update` to replace a released scene's text. */
    kind: 'release' | 'update';
    rating: SceneReleaseRating;
    audience: SceneTextAudience;
    asked_at: string;
    expires_at: string;
    /** For an update: the release now on the scene and its version, which the update replaces. Else null. */
    release_id: string | null;
    release_version: number | null;
}

const KINDS: ReadonlySet<unknown> = new Set(['release', 'update']);
const RATINGS: ReadonlySet<unknown> = new Set(['general', 'mature']);
const AUDIENCES: ReadonlySet<unknown> = new Set(['named', 'public']);

export function isSceneTextRequest(value: unknown): value is SceneTextRequest {
    if (!value || typeof value !== 'object') return false;
    const request = value as Partial<SceneTextRequest>;
    // The id becomes part of a link and a request body: only a UUID is accepted.
    return typeof request.id === 'string' && COMMUNITY_UUID_RE.test(request.id)
        && typeof request.scene_id === 'string' && isOpaqueSceneId(request.scene_id)
        && typeof request.scene_title === 'string'
        && KINDS.has(request.kind)
        && RATINGS.has(request.rating)
        && AUDIENCES.has(request.audience)
        && typeof request.asked_at === 'string'
        && typeof request.expires_at === 'string'
        && (request.release_id === null || typeof request.release_id === 'string')
        && (request.release_version === null || (Number.isInteger(request.release_version) && (request.release_version as number) >= 1))
        // An update names the release it replaces.
        && (request.kind === 'release' || (typeof request.release_id === 'string' && request.release_version !== null));
}

function isOk(value: unknown): value is { ok: true } {
    return !!value && typeof value === 'object' && (value as { ok?: unknown }).ok === true;
}

export function isSceneTextRequestList(value: unknown): value is { ok: true; requests: SceneTextRequest[] } {
    if (!isOk(value)) return false;
    const requests = (value as { requests?: unknown }).requests;
    return Array.isArray(requests) && requests.every(isSceneTextRequest);
}


/** The open requests for this book. The request names the book and carries no text. */
export async function fetchSceneTextRequests(plugin: RadialTimelinePlugin, book: Pick<BookProfile, 'id'>): Promise<SceneTextRequest[]> {
    return (await postSceneRelease(plugin, book, { action: 'requests' }, isSceneTextRequestList)).requests;
}

/** Decline a request: the website shows it declined. Carries no text. */
export async function declineSceneTextRequest(plugin: RadialTimelinePlugin, book: Pick<BookProfile, 'id'>, requestId: string): Promise<void> {
    await postSceneRelease(plugin, book, { action: 'decline', request_id: requestId }, isOk);
}

/**
 * Send the scene a request asks for: its first release, or, for an update,
 * the replacement of the released text (the version the request names). The
 * rating and readers are the request's, set on Community.
 *
 * The one call that sends scene text. Call it only from the Send button of the
 * Send scene to Community dialog, with the blocks that dialog rendered.
 */
export async function sendRequestedScene(
    plugin: RadialTimelinePlugin,
    book: Pick<BookProfile, 'id'>,
    send: { request: Pick<SceneTextRequest, 'id' | 'scene_id' | 'kind' | 'release_version'>; blocks: readonly SceneBlock[] }
): Promise<SceneReleaseResult> {
    const { request, blocks } = send;
    if (!isOpaqueSceneId(request.scene_id)) {
        throw new CommunityShareError('invalid_request', t('ui.communityShareClient.sceneReleaseNoSceneId'));
    }
    const problem = sceneTextProblem(blocks);
    if (problem) {
        throw new CommunityShareError(problem === 'empty' ? 'empty_text' : 'too_long', sceneTextProblemMessage(problem));
    }
    if (request.kind === 'update' && request.release_version === null) {
        throw new CommunityShareError('invalid_request', t('ui.communityShareClient.sceneTextUpdateUnknown'));
    }
    const action = request.kind === 'release'
        ? { action: 'release', request_id: request.id, scene_id: request.scene_id, blocks }
        : { action: 'update', request_id: request.id, scene_id: request.scene_id, expected_version: request.release_version, blocks };
    return postSceneRelease(plugin, book, action, isSceneReleaseResult);
}
