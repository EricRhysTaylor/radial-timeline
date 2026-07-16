/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Discord chip — a dumb renderer over the public `discord-presence` edge
 * function. Successor to the office-hours chip after the 2026-07-15 pivot
 * from scheduled sessions to always-on Discord support.
 *
 * Single source of truth is the server: the endpoint returns the ANSWER
 * ({ online, url }) — presence comes from Discord itself (via Lanyard), the
 * invite URL from the office_hours config row. This module never guesses.
 *
 * Trust rules (inherited from the office-hours chip, spec §5): absence by
 * choice (community connect off) is silent — no chip at all. Failure is
 * quiet — a fetch error reads as offline (muted), the chip is NEVER green
 * on stale data, and alerts never escalate to an Obsidian Notice.
 */

import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { normalizeCommunityShareSettings } from './communityShareSettings';
import { tooltip as applyTooltip } from '../utils/tooltip';

const DISCORD_PRESENCE_URL = 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/functions/v1/discord-presence';

const POLL_MS = 60e3; // presence flips fast; a minute keeps the light honest
const JITTER_MS = 10e3; // 0–10 s added to every poll
const FRESH_FOR_MS = 5 * 60e3; // green requires a success within the last 5 min
const WAKE_REFETCH_GAP_MS = 30e3; // debounce focus/visibility refetches

interface PresenceAnswer {
    online: boolean;
    url: string;
}

function isPresenceAnswer(value: unknown): value is PresenceAnswer {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.online === 'boolean' && typeof v.url === 'string';
}

export class DiscordChip {
    private readonly plugin: RadialTimelinePlugin;
    private data: PresenceAnswer | null = null;
    private lastSuccessAt = 0; // last successful refresh — the freshness clock
    private lastAttemptAt = 0; // last fetch attempt (wake debounce)
    private timer: number | null = null;
    private host: HTMLElement | null = null;
    private el: HTMLAnchorElement | null = null;
    private fetching = false;
    private destroyed = false;

    constructor(plugin: RadialTimelinePlugin) {
        this.plugin = plugin;
        void this.refetch(); // refetch on load
    }

    /** Signed in (connected) AND the community connect toggle is on. */
    private eligible(): boolean {
        const cs = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        return cs.enabled
            && cs.connection.status === 'connected'
            && Boolean(cs.connection.connectionId);
    }

    /**
     * Mount the chip into a persistent title-bar host (right of the writing-
     * session control). The host outlives popover re-renders; state lives on
     * this controller.
     */
    mount(host: HTMLElement): void {
        this.host = host;
        this.sync();
    }

    /**
     * Ensure the chip element exists iff eligible, then let update() paint it.
     * Cheap and idempotent — safe to call on the session tick to catch a
     * community connect/disconnect. A fresh connection re-arms the poll.
     */
    sync(): void {
        const host = this.host;
        if (!host) return;
        if (this.destroyed || !this.eligible()) {
            this.el?.remove();
            this.el = null;
            return;
        }
        if (this.el && this.el.isConnected) return; // already mounted; the poll drives content
        const el = host.createEl('a', { cls: 'ert-timeline-discord-chip ert-hidden' });
        el.rel = 'noopener';
        this.el = el;
        this.update();
        // Just became eligible with no armed poll (toggle flipped on) — refresh.
        if (this.timer === null) void this.refetch();
    }

    /** Refetch on window focus / visibilitychange (laptop-was-asleep case). */
    onWake(): void {
        if (this.destroyed || !this.eligible()) return;
        if (Date.now() - this.lastAttemptAt < WAKE_REFETCH_GAP_MS) return;
        void this.refetch();
    }

    destroy(): void {
        this.destroyed = true;
        this.clearTimer();
        this.el?.remove();
        this.el = null;
        this.host = null;
    }

    // ── data freshness ──────────────────────────────────────────────────────

    private async refetch(): Promise<void> {
        if (this.destroyed || this.fetching) return;
        if (!this.eligible()) {
            this.clearTimer();
            return;
        }
        this.fetching = true;
        this.lastAttemptAt = Date.now();
        try {
            const res = await requestUrl({ url: DISCORD_PRESENCE_URL, method: 'GET', throw: false });
            if (res.status >= 200 && res.status < 300) {
                const body: unknown = JSON.parse(res.text);
                if (isPresenceAnswer(body)) {
                    this.data = body;
                    this.lastSuccessAt = Date.now();
                }
            }
        } catch {
            // Network failure: keep last-known data. update() refuses to show
            // green once the freshness window lapses, so a dead network can
            // only ever mute the chip, never light it.
        } finally {
            this.fetching = false;
            this.update();
            this.armTimer();
        }
    }

    private clearTimer(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    private armTimer(): void {
        this.clearTimer();
        if (this.destroyed || !this.eligible()) return;
        this.timer = window.setTimeout(() => void this.refetch(), POLL_MS + Math.random() * JITTER_MS);
    }

    // ── rendering ───────────────────────────────────────────────────────────

    private update(): void {
        const el = this.el;
        if (!el || !el.isConnected) return;
        const data = this.data;
        if (!this.eligible() || !data) {
            el.classList.add('ert-hidden');
            return;
        }

        // Green ONLY on fresh data — stale presence reads as offline.
        const online = data.online && Date.now() - this.lastSuccessAt < FRESH_FOR_MS;

        el.setText(online ? 'Discord · online' : 'Discord');
        el.classList.toggle('is-live', online);
        el.classList.remove('ert-hidden');
        el.href = data.url;
        applyTooltip(
            el,
            online
                ? 'Eric is on Discord right now — ask away'
                : 'Radial Timeline community on Discord — ask anytime',
            'bottom'
        );
    }
}
