/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * What Vault → Community reads from the vault for scene text, and how it
 * lines up with what the website reports.
 *
 * Nothing here sends scene text. A scene's note is read, cleaned and hashed in
 * the vault; "changed since release" is that hash beside the hash the website
 * reports. The list reads only the notes of scenes that are already released,
 * and the Send dialog reads the one scene it shows. Nothing read here is kept:
 * neither text nor hash is written to settings or to disk.
 */

import { TFile, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import type { BookProfile } from '../types/settings';
import { CommunityShareError, fetchSceneReleaseStatus, type SceneReleaseStatus, type SceneReleaseSummary } from './communityShareClient';
import { fetchSceneTextRequests, type SceneTextRequest } from './sceneTextRequests';
import { normalizeCommunityShareSettings, timelineShareFor } from './communityShareSettings';
import {
    sceneBlocksFromNote,
    sceneTextHash,
    sceneTextProblem,
    sceneWordCount,
    type SceneBlock,
    type SceneTextProblem,
} from './sceneReleaseText';
import { timelineSceneNotes, type TimelineSceneNote } from './timelineSharePayload';

/** One scene's text as a release would send it, read from its note just now. */
export interface SceneReleaseDraft {
    blocks: SceneBlock[];
    /** The hash the website would report for these blocks. */
    hash: string;
    words: number;
    /** Why the website would refuse this text, or null when it can be released. */
    problem: SceneTextProblem | null;
}

/** Read one scene note and run the release pipeline on it. Held in memory only. */
export async function readSceneReleaseDraft(app: App, path: string): Promise<SceneReleaseDraft> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
        throw new CommunityShareError('scene_note_missing', t('ui.communityShareClient.sceneNoteMissing'));
    }
    const blocks = sceneBlocksFromNote(await app.vault.read(file));
    return {
        blocks,
        hash: await sceneTextHash(blocks),
        words: sceneWordCount(blocks),
        problem: sceneTextProblem(blocks),
    };
}

export type SceneReleaseRowState =
    /** A vault scene with no id to name it by. */
    | 'unavailable'
    | 'not_released'
    /** Released, and the vault's cleaned text is the released text. */
    | 'released'
    /** Released, and the vault's cleaned text differs from the released text. */
    | 'changed'
    /** Hidden from readers: held after review, or waiting for review (hiddenSceneNote says which). */
    | 'hidden'
    /** A release the website holds that matches no scene in this vault. */
    | 'website';

export interface SceneReleaseRow {
    state: SceneReleaseRowState;
    title: string;
    /** The vault's scene note; absent on a `website` row. */
    scene?: TimelineSceneNote;
    /** The website's release; absent while the scene is not released. */
    release?: SceneReleaseSummary;
}

/**
 * The book's scenes in manuscript order, each with its one state, then the
 * releases that match no scene here. `localHashes` maps a released scene's id
 * to the hash of the vault's own cleaned text.
 */
export function buildSceneReleaseRows(
    scenes: readonly TimelineSceneNote[],
    releases: readonly SceneReleaseSummary[],
    localHashes: ReadonlyMap<string, string>
): SceneReleaseRow[] {
    const bySceneId = new Map<string, SceneReleaseSummary>();
    for (const release of releases) {
        if (release.scene_id && !bySceneId.has(release.scene_id)) bySceneId.set(release.scene_id, release);
    }
    const matched = new Set<string>();
    const rows: SceneReleaseRow[] = scenes.map(scene => {
        if (!scene.sceneId) return { state: 'unavailable', title: scene.title, scene };
        const release = bySceneId.get(scene.sceneId);
        if (!release) return { state: 'not_released', title: scene.title, scene };
        matched.add(release.id);
        const state = release.hidden
            ? 'hidden'
            : localHashes.get(scene.sceneId) === release.text_hash ? 'released' : 'changed';
        return { state, title: scene.title, scene, release };
    });
    for (const release of releases) {
        if (!matched.has(release.id)) rows.push({ state: 'website', title: release.scene_title, release });
    }
    return rows;
}

/** Hash the vault's text of each released scene: one read per released scene, no others. */
async function releasedSceneHashes(
    app: App,
    scenes: readonly TimelineSceneNote[],
    releases: readonly SceneReleaseSummary[]
): Promise<Map<string, string>> {
    const released = new Set(releases.map(release => release.scene_id));
    const hashes = new Map<string, string>();
    for (const scene of scenes) {
        if (!scene.sceneId || !released.has(scene.sceneId)) continue;
        hashes.set(scene.sceneId, (await readSceneReleaseDraft(app, scene.path)).hash);
    }
    return hashes;
}

export interface SceneReleaseList {
    status: SceneReleaseStatus;
    rows: SceneReleaseRow[];
}

/**
 * The website's status (a request with no text in it), the book's scenes from
 * the scene data service, and the local hash of each released scene.
 */
export async function loadSceneReleaseList(
    plugin: RadialTimelinePlugin,
    book: Pick<BookProfile, 'id' | 'sourceFolder'>
): Promise<SceneReleaseList> {
    const status = await fetchSceneReleaseStatus(plugin, book);
    const { items } = await plugin.getSceneDataService().getSceneDataWithBookMeta({ sourcePath: book.sourceFolder });
    const shared = timelineShareFor(normalizeCommunityShareSettings(plugin.settings.communityShare), book.id);
    const scenes = timelineSceneNotes(items, shared?.sceneIdPaths);
    const hashes = await releasedSceneHashes(plugin.app, scenes, status.releases);
    return { status, rows: buildSceneReleaseRows(scenes, status.releases, hashes) };
}

export interface SceneTextState extends SceneReleaseList {
    /** The scenes asked for on Community, still open. */
    requests: SceneTextRequest[];
}

/** Everything the book's scene text rows show: the released scenes and the open requests. */
export async function loadSceneTextState(
    plugin: RadialTimelinePlugin,
    book: Pick<BookProfile, 'id' | 'sourceFolder'>
): Promise<SceneTextState> {
    const list = await loadSceneReleaseList(plugin, book);
    return { ...list, requests: await fetchSceneTextRequests(plugin, book) };
}

/** The vault's note for the scene a request names, or undefined when this book has none. */
export function requestedSceneNote(rows: readonly SceneReleaseRow[], request: Pick<SceneTextRequest, 'scene_id'>): TimelineSceneNote | undefined {
    return rows.find(row => row.scene?.sceneId === request.scene_id)?.scene;
}
