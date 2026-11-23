/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The words for who paused what, and when: standing notes, the refusals
 * Community answers with a time, and the Sharing history rows. One sentence
 * and the next step each; dates in the one Community format.
 */

import { t } from '../i18n';
import type { CommunityServerDisconnect } from '../types/settings';
import { readServerDisconnect, readTime, type SharingEvent, type SharingPart, type SharingSide } from './sharingState';

/**
 * The one date format of the Community settings, "November 18, 2026 at 4:01 PM",
 * with non-breaking spaces so a line never ends in the middle of a date.
 */
export function formatCommunityDate(value: string | number): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }).replace(/\s/g, ' ');
}

/** Vault updates for a book paused on Community: by the author, or by a restore. */
export function vaultUpdatesPausedNote(part: Pick<SharingPart, 'at' | 'side' | 'cause'>): string {
    const date = formatCommunityDate(part.at);
    if (part.side === 'system') return t('ui.communitySharing.vaultUpdatesPausedSystem', { date });
    return part.cause === 'restore'
        ? t('ui.communitySharing.vaultUpdatesPausedRestore', { date })
        : t('ui.communitySharing.vaultUpdatesPaused', { date });
}

export function updateHeldNote(at: string): string {
    return t('ui.communitySharing.updateHeld', { date: formatCommunityDate(at) });
}

export function bookDisconnectedNote(at: string): string {
    return t('ui.communitySharing.bookDisconnected', { date: formatCommunityDate(at) });
}

/** A Community account paused by moderation, or while its deletion is pending. */
export function accountPausedNote(part: Pick<SharingPart, 'at' | 'cause'>): string {
    const date = formatCommunityDate(part.at);
    return part.cause === 'account_deletion'
        ? t('ui.communitySharing.accountDeletion', { date })
        : t('ui.communitySharing.accountModeration', { date });
}

/** The note under the connection code after Community said this vault was disconnected. */
export function serverDisconnectNote(disconnect: CommunityServerDisconnect): string {
    if (!disconnect.at) return t('ui.communitySharing.disconnectedUndated');
    const date = formatCommunityDate(disconnect.at);
    if (disconnect.cause === 'new_connection') return t('ui.communitySharing.disconnectedReplaced', { date });
    if (disconnect.by === 'community') return t('ui.communitySharing.disconnectedCommunity', { date });
    if (disconnect.by === 'vault') return t('ui.communitySharing.disconnectedVault', { date });
    return t('ui.communitySharing.disconnectedSystem', { date });
}

/**
 * The plugin's own sentence for a refusal Community answered with a time, or
 * null to keep Community's sentence. `details` are the body's fields beside
 * `error`.
 */
export function refusalMessage(code: string, details: Record<string, unknown> | undefined): string | null {
    if (code === 'vault_updates_paused') {
        const at = readTime(details?.paused_at);
        const side = details?.side === 'system' ? 'system' : 'community';
        return at ? vaultUpdatesPausedNote({ at, side, cause: typeof details?.cause === 'string' ? details.cause : null }) : null;
    }
    if (code === 'update_held') {
        const at = readTime(details?.held_at);
        return at ? updateHeldNote(at) : null;
    }
    if (code === 'book_disconnected') {
        const at = readTime(details?.at);
        return at ? bookDisconnectedNote(at) : null;
    }
    // A server from before 2026-11-22 sends no time or side: its own sentence stands.
    if (code === 'connection_disconnected') return details ? serverDisconnectNote(readServerDisconnect(details)) : null;
    if (code === 'connection_not_active' && details?.cause === 'account_deletion_pending') {
        const at = readTime(details.since);
        return at ? accountPausedNote({ at, cause: 'account_deletion' }) : null;
    }
    return null;
}

type EventWords = Partial<Record<SharingSide, string>> & { [cause: string]: string | undefined };

/**
 * Each event's words by its cause first, then its side. An event or side with
 * no words here is left out of the list rather than shown as a code.
 */
const EVENT_WORDS: Record<SharingEvent['event'], EventWords> = {
    sharing_paused: { vault: 'sharingPausedVault', system: 'sharingPausedSystem' },
    sharing_resumed: { vault: 'sharingResumedVault', system: 'sharingResumedSystem' },
    disconnected: { new_connection: 'disconnectedReplaced', vault: 'disconnectedVault', community: 'disconnectedCommunity', system: 'disconnectedSystem' },
    vault_updates_paused: { restore: 'vaultUpdatesPausedRestore', community: 'vaultUpdatesPausedCommunity', system: 'vaultUpdatesPausedSystem' },
    vault_updates_resumed: { transfer: 'vaultUpdatesResumedTransfer', community: 'vaultUpdatesResumedCommunity', system: 'vaultUpdatesResumedSystem' },
    timeline_updates_stopped: { vault: 'timelineUpdatesStopped' },
    timeline_updates_resumed: { vault: 'timelineUpdatesResumed' },
    timeline_offline: { account_deletion: 'timelineOfflineDeletion', community: 'timelineOfflineCommunity', system: 'timelineOfflineSystem' },
    timeline_public: { account_deletion: 'timelinePublicDeletion', community: 'timelinePublicCommunity', system: 'timelinePublicSystem' },
    book_disconnected: { community: 'bookDisconnected', system: 'bookDisconnected' },
    account_paused: { account_deletion: 'accountPausedDeletion', moderation: 'accountPausedModeration' },
    account_resumed: { account_deletion: 'accountResumedDeletion', moderation: 'accountResumedModeration' },
    scene_taken_down: { vault: 'sceneTakenDownVault', community: 'sceneTakenDownCommunity', system: 'sceneTakenDownSystem' },
};

/** What happened, said plainly; null for an event this client has no words for. */
export function sharingEventText(event: SharingEvent): string | null {
    const words = EVENT_WORDS[event.event];
    const key = (event.cause ? words[event.cause] : undefined) ?? words[event.side];
    if (!key) return null;
    if (event.event === 'scene_taken_down') {
        // A take-down names its scene by title only; one without a title is left out.
        return event.sceneTitle ? t(`ui.communitySharing.events.${key}`, { title: event.sceneTitle }) : null;
    }
    return t(`ui.communitySharing.events.${key}`);
}

/** Sharing history rows, newest first, each "date · what happened". */
export function sharingHistoryRows(events: SharingEvent[]): Array<{ at: string; text: string }> {
    return [...events]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .map(event => ({ at: event.at, text: sharingEventText(event) }))
        .filter((row): row is { at: string; text: string } => row.text !== null);
}
