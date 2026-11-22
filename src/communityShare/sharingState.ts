/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Who paused or stopped what, and when, as Community answers it (platform
 * HANDOFF, "2026-11-22 Sharing pauses say who and when", "The shapes"). The
 * book's state comes with `timeline-share-sync` `status`; the vault's with
 * `community-share-context` `history`. Every part is null while it does not
 * stand. A part or event this client cannot read is left out, never guessed.
 */

import type { CommunityServerDisconnect } from '../types/settings';

export type SharingSide = 'vault' | 'community' | 'moderation' | 'system';

export const SHARING_EVENT_NAMES = [
    'sharing_paused', 'sharing_resumed', 'disconnected', 'vault_updates_paused', 'vault_updates_resumed',
    'timeline_updates_stopped', 'timeline_updates_resumed', 'timeline_offline', 'timeline_public',
    'book_disconnected', 'account_paused', 'account_resumed', 'scene_taken_down',
] as const;
export type SharingEventName = typeof SHARING_EVENT_NAMES[number];

export interface SharingEvent {
    event: SharingEventName;
    side: SharingSide;
    at: string;
    cause: string | null;
    sceneTitle: string | null;
}

/** One standing pause: when, which side, and why when the side says more than one thing. */
export interface SharingPart {
    at: string;
    side: SharingSide;
    cause: string | null;
}

export interface TimelineStatusPart {
    status: 'private' | 'active';
    changedAt: string | null;
    side: SharingSide | null;
    cause: string | null;
}

export interface BookSharingState {
    vaultUpdatesPaused: SharingPart | null;
    timelineUpdatesStopped: SharingPart | null;
    updateHeld: { at: string } | null;
    timeline: TimelineStatusPart | null;
    vaultSharingPaused: SharingPart | null;
    accountPaused: SharingPart | null;
    history: SharingEvent[];
}

export interface VaultSharingState {
    sharingPaused: SharingPart | null;
    accountPaused: SharingPart | null;
    history: SharingEvent[];
}

const SIDES: ReadonlySet<unknown> = new Set(['vault', 'community', 'moderation', 'system']);
const EVENTS: ReadonlySet<unknown> = new Set(SHARING_EVENT_NAMES);

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** An ISO time the client can show, or null. */
export function readTime(value: unknown): string | null {
    return typeof value === 'string' && value && !Number.isNaN(Date.parse(value)) ? value : null;
}

const readSide = (value: unknown): SharingSide | null => (SIDES.has(value) ? value as SharingSide : null); // SAFE: checked against SIDES
const readText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function readPart(value: unknown): SharingPart | null {
    if (!isObject(value)) return null;
    const at = readTime(value.at);
    const side = readSide(value.side);
    return at && side ? { at, side, cause: readText(value.cause) } : null;
}

export function readSharingEvents(value: unknown): SharingEvent[] {
    if (!Array.isArray(value)) return [];
    const events: SharingEvent[] = [];
    for (const raw of value) {
        if (!isObject(raw) || !EVENTS.has(raw.event)) continue;
        const at = readTime(raw.at);
        const side = readSide(raw.side);
        if (!at || !side) continue;
        events.push({
            event: raw.event as SharingEventName, // SAFE: checked against EVENTS
            side,
            at,
            cause: readText(raw.cause),
            sceneTitle: raw.event === 'scene_taken_down' ? readText(raw.scene_title) : null,
        });
    }
    return events;
}

/** A book's sharing state from `status.sharing`; null when the answer carries none. */
export function readBookSharingState(value: unknown): BookSharingState | null {
    if (!isObject(value)) return null;
    const held = isObject(value.update_held) ? readTime(value.update_held.at) : null;
    const timeline: TimelineStatusPart | null = isObject(value.timeline) && (value.timeline.status === 'private' || value.timeline.status === 'active')
        ? {
            status: value.timeline.status,
            changedAt: readTime(value.timeline.changed_at),
            side: readSide(value.timeline.side),
            cause: readText(value.timeline.cause),
        }
        : null;
    return {
        vaultUpdatesPaused: readPart(value.vault_updates_paused),
        timelineUpdatesStopped: readPart(value.timeline_updates_stopped),
        updateHeld: held ? { at: held } : null,
        timeline,
        vaultSharingPaused: readPart(value.vault_sharing_paused),
        accountPaused: readPart(value.account_paused),
        history: readSharingEvents(value.history),
    };
}

/** The vault's sharing state from a notice or `history` answer; null when it carries none. */
export function readVaultSharingState(value: unknown): VaultSharingState | null {
    if (!isObject(value)) return null;
    return {
        sharingPaused: readPart(value.sharing_paused),
        accountPaused: readPart(value.account_paused),
        history: readSharingEvents(value.history),
    };
}

/**
 * Who disconnected a connection and when, from a 409 `connection_disconnected`
 * body. A disconnect from before 2026-11-22 has no side and may have no time.
 */
export function readServerDisconnect(details: Record<string, unknown> | undefined): CommunityServerDisconnect {
    const by = details?.disconnected_by;
    return {
        at: readTime(details?.disconnected_at),
        by: by === 'vault' || by === 'community' || by === 'system' ? by : null,
        cause: details?.cause === 'new_connection' ? 'new_connection' : 'disconnect',
    };
}
