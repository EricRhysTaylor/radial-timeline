/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * What Community answers when a book made on the website is brought into the
 * vault (`timeline-transfer-sync`): the shapes, and the checks every answer
 * passes before anything is written.
 *
 * Pure: no vault, no network, no settings. Each reader returns a clean copy
 * holding only the fields named here, or null when the answer is not in that
 * shape, so nothing else an answer carries can reach a note.
 */

import { isOpaqueSceneId } from '../utils/sceneIds';
import { COMMUNITY_UUID_RE } from './communityShareSettings';
import type { SceneBlock, SceneRun } from './sceneReleaseText';

export const TRANSFER_SCENE_STATUSES = ['todo', 'working', 'complete', 'due'] as const;
export const TRANSFER_PUBLISH_STAGES = ['zero', 'author', 'house', 'press'] as const;
export type TransferSceneStatus = (typeof TRANSFER_SCENE_STATUSES)[number];
export type TransferPublishStage = (typeof TRANSFER_PUBLISH_STAGES)[number];

/** The most scenes a timeline document can hold: the timeline engine's own limit. */
const MAX_TRANSFER_SCENES = 20_000;
const TEXT_HASH_RE = /^[0-9a-f]{64}$/;

/** One scene of the author's stored timeline: the details a timeline carries, and nothing else. */
export interface TransferScene {
    /** The permanent scene id: `scn_` and 8 to 10 hex digits. */
    id: string;
    /** The scene's number in the manuscript, from 1. */
    order: number;
    title: string;
    act: number;
    subplots: string[];
    status: TransferSceneStatus;
    publishStage: TransferPublishStage;
    /** The cast in the author's order. The first name is the point-of-view character. */
    characters: string[];
    povMode?: string;
    when?: string;
    synopsis?: string;
}

export interface TransferDocument {
    book: { title: string; actCount: number };
    scenes: TransferScene[];
}

/** One scene's released text as Community stores it, with the hash it reports. */
export interface TransferReleasedText {
    sceneId: string;
    blocks: SceneBlock[];
    textHash: string;
}

/** A book waiting for this vault, as the list answers it. */
export interface BookTransferOffer {
    transferId: string;
    title: string;
    sceneCount: number;
    releasedTextCount: number;
    includeReleasedText: boolean;
    openedAt: string;
    expiresAt: string;
}

/** A waiting book's timeline and, by the author's choice, its released text. */
export interface BookTransferRead {
    transferId: string;
    expiresAt: string;
    document: TransferDocument;
    releasedText: TransferReleasedText[];
}

export interface BookTransferDone {
    projectId: string;
    pluginBookKey: string;
}

export type BookTransferStateName = 'open' | 'done' | 'cancelled' | 'expired';

export interface BookTransferState {
    state: BookTransferStateName;
    cancelReason?: string;
    pluginBookKey?: string;
    expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isWhole(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isTransferId(value: unknown): value is string {
    return typeof value === 'string' && COMMUNITY_UUID_RE.test(value);
}

function textList(value: unknown, allowEmpty: boolean): string[] | null {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
    return value.every(isText) ? [...value] as string[] : null;
}

function optionalText(value: unknown): { ok: true; text?: string } | { ok: false } {
    if (value === undefined || value === null) return { ok: true };
    return typeof value === 'string' ? { ok: true, ...(value ? { text: value } : {}) } : { ok: false };
}

function readScene(value: unknown): TransferScene | null {
    if (!isRecord(value)) return null;
    const subplots = textList(value.subplots, false);
    const characters = textList(value.characters, true);
    const status = TRANSFER_SCENE_STATUSES.find(known => known === value.status);
    const publishStage = TRANSFER_PUBLISH_STAGES.find(known => known === value.publishStage);
    const povMode = optionalText(value.povMode);
    const when = optionalText(value.when);
    const synopsis = optionalText(value.synopsis);
    if (typeof value.id !== 'string' || !isOpaqueSceneId(value.id) || !isWhole(value.order) || typeof value.title !== 'string'
        || !isWhole(value.act) || !subplots || !characters || !status || !publishStage
        || !povMode.ok || !when.ok || !synopsis.ok) return null;
    return {
        id: value.id,
        order: value.order,
        title: value.title,
        act: value.act,
        subplots,
        status,
        publishStage,
        characters,
        ...(povMode.text ? { povMode: povMode.text } : {}),
        ...(when.text ? { when: when.text } : {}),
        ...(synopsis.text ? { synopsis: synopsis.text } : {}),
    };
}

/**
 * The stored timeline, or null when it is not one this plugin can write: every
 * scene a scene on a permanent id, each id and each scene number used once.
 */
export function readTransferDocument(value: unknown): TransferDocument | null {
    if (!isRecord(value) || !isRecord(value.book) || !Array.isArray(value.scenes)) return null;
    const { title, actCount } = value.book;
    if (!isText(title) || !title.trim() || !isWhole(actCount)) return null;
    if (value.scenes.length === 0 || value.scenes.length > MAX_TRANSFER_SCENES) return null;
    const scenes: TransferScene[] = [];
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const raw of value.scenes) {
        // Only a scene is written as a scene note. The stored field is absent on older documents.
        if (isRecord(raw) && raw.itemType !== undefined && String(raw.itemType).toLowerCase() !== 'scene') return null;
        const scene = readScene(raw);
        if (!scene || ids.has(scene.id) || orders.has(scene.order)) return null;
        ids.add(scene.id);
        orders.add(scene.order);
        scenes.push(scene);
    }
    scenes.sort((a, b) => a.order - b.order);
    return { book: { title: title.trim(), actCount }, scenes };
}

function readRun(value: unknown): SceneRun | null {
    if (typeof value === 'string') return value;
    if (isRecord(value) && typeof value.em === 'string' && Object.keys(value).length === 1) return { em: value.em };
    return null;
}

function readBlock(value: unknown): SceneBlock | null {
    if (!isRecord(value)) return null;
    if (value.kind === 'break') return Object.keys(value).length === 1 ? { kind: 'break' } : null;
    if (value.kind !== 'p' || !Array.isArray(value.runs) || Object.keys(value).length !== 2) return null;
    const runs: SceneRun[] = [];
    for (const raw of value.runs) {
        const run = readRun(raw);
        if (run === null) return null;
        runs.push(run);
    }
    return { kind: 'p', runs };
}

/** The stored blocks, rebuilt key by key in the order the hash is taken over: `kind`, then `runs`. */
export function readSceneBlocks(value: unknown): SceneBlock[] | null {
    if (!Array.isArray(value)) return null;
    const blocks: SceneBlock[] = [];
    for (const raw of value) {
        const block = readBlock(raw);
        if (!block) return null;
        blocks.push(block);
    }
    return blocks;
}

function readReleasedText(value: unknown, document: TransferDocument): TransferReleasedText[] | null {
    if (!Array.isArray(value)) return null;
    const sceneIds = new Set(document.scenes.map(scene => scene.id));
    const seen = new Set<string>();
    const released: TransferReleasedText[] = [];
    for (const raw of value) {
        if (!isRecord(raw)) return null;
        const blocks = readSceneBlocks(raw.blocks);
        const { scene_id: sceneId, text_hash: textHash } = raw;
        // Released text goes only into a note this book's timeline names, once.
        if (typeof sceneId !== 'string' || !sceneIds.has(sceneId) || seen.has(sceneId)) return null;
        if (!blocks || typeof textHash !== 'string' || !TEXT_HASH_RE.test(textHash)) return null;
        seen.add(sceneId);
        released.push({ sceneId, blocks, textHash });
    }
    return released;
}

function readOffer(value: unknown): BookTransferOffer | null {
    if (!isRecord(value)) return null;
    const { transfer_id: transferId, title, scene_count: sceneCount, released_text_count: releasedTextCount,
        include_released_text: includeReleasedText, opened_at: openedAt, expires_at: expiresAt } = value;
    if (!isTransferId(transferId) || typeof title !== 'string' || !isCount(sceneCount) || !isCount(releasedTextCount)
        || typeof includeReleasedText !== 'boolean' || !isText(openedAt) || !isText(expiresAt)) return null;
    return { transferId: transferId.toLowerCase(), title, sceneCount, releasedTextCount, includeReleasedText, openedAt, expiresAt };
}

/** The answer to `list`: the books waiting for this vault. */
export function readBookTransferList(value: unknown): BookTransferOffer[] | null {
    if (!isRecord(value) || value.ok !== true || !Array.isArray(value.transfers)) return null;
    const offers: BookTransferOffer[] = [];
    for (const raw of value.transfers) {
        const offer = readOffer(raw);
        if (!offer) return null;
        offers.push(offer);
    }
    return offers;
}

/** The answer to `read` for the transfer that was asked for. */
export function readBookTransferRead(value: unknown, transferId: string): BookTransferRead | null {
    if (!isRecord(value) || value.ok !== true) return null;
    if (!isTransferId(value.transfer_id) || value.transfer_id.toLowerCase() !== transferId.toLowerCase() || !isText(value.expires_at)) return null;
    const document = readTransferDocument(value.document);
    if (!document) return null;
    const releasedText = readReleasedText(value.released_text, document);
    if (!releasedText) return null;
    return { transferId: transferId.toLowerCase(), expiresAt: value.expires_at, document, releasedText };
}

/** The answer to `done`: Community now follows the vault for this book, under this book key. */
export function readBookTransferDone(value: unknown, pluginBookKey: string): BookTransferDone | null {
    if (!isRecord(value) || value.ok !== true || value.state !== 'done' || value.edited_in !== 'vault') return null;
    if (typeof value.project_id !== 'string' || !COMMUNITY_UUID_RE.test(value.project_id)) return null;
    if (value.plugin_book_key !== pluginBookKey) return null;
    return { projectId: value.project_id, pluginBookKey };
}

const STATE_NAMES: readonly BookTransferStateName[] = ['open', 'done', 'cancelled', 'expired'];

/** The answer to `state`. */
export function readBookTransferState(value: unknown): BookTransferState | null {
    if (!isRecord(value) || value.ok !== true) return null;
    const state = STATE_NAMES.find(known => known === value.state);
    const cancelReason = optionalText(value.cancel_reason);
    const pluginBookKey = optionalText(value.plugin_book_key);
    if (!state || !cancelReason.ok || !pluginBookKey.ok || !isText(value.expires_at)) return null;
    return {
        state,
        ...(cancelReason.text ? { cancelReason: cancelReason.text } : {}),
        ...(pluginBookKey.text ? { pluginBookKey: pluginBookKey.text } : {}),
        expiresAt: value.expires_at,
    };
}
