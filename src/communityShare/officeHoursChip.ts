/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Office-hours chip — a dumb renderer over the public `office-hours` edge
 * function. Spec: Platform/OFFICE-HOURS-CHIP-SPEC.md (approved 2026-07-14).
 *
 * Single source of truth is the server: the endpoint returns the ANSWER
 * ({ next, end, canceled, url, liveUrl }) — this module never re-implements
 * cadence math, so a cancel/reschedule on the config row propagates here.
 *
 * Update model (spec §4):
 * - Layer 1 — exact local `setTimeout`s: session start (paranoia refetch
 *   BEFORE flipping green), session end (flip back), local midnight
 *   ("tomorrow" → "today" copy roll).
 * - Layer 2 — adaptive polling (>24h → 6h, 1–24h → 1h, <1h/live → 10 min)
 *   with 0–60s jitter, plus refetch on plugin load and window focus /
 *   visibilitychange (via onWake()).
 *
 * Trust rules (spec §5): absence by choice (toggle off / not connected) is
 * silent — no chip at all. Absence by failure is visible — after >24h of
 * failed refreshes the chip stays with a ⚠ stale marker and never flips
 * green. Alerts live on the chip only; never an Obsidian Notice.
 */

import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { normalizeCommunityShareSettings } from './communityShareSettings';
import { tooltip as applyTooltip } from '../utils/tooltip';

const OFFICE_HOURS_URL = 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/functions/v1/office-hours';

const HOUR_MS = 3600e3;
const STALE_AFTER_MS = 24 * HOUR_MS;
const POLL_FAR_MS = 6 * HOUR_MS; // next session > 24 h out
const POLL_NEAR_MS = HOUR_MS; // 1–24 h out
const POLL_CLOSE_MS = 10 * 60e3; // < 1 h out or live
const JITTER_MS = 60e3; // 0–60 s added to every timer
const WAKE_REFETCH_GAP_MS = 60e3; // debounce focus/visibility refetches
const MAX_TIMEOUT_MS = 0x7fffffff; // setTimeout clamp (~24.8 days)

const STALE_TOOLTIP = "Couldn't refresh the schedule — this may have changed";

interface OfficeHoursAnswer {
    next: string | null;
    end: string | null;
    canceled: boolean;
    url: string;
    liveUrl: string;
}

function isOfficeHoursAnswer(value: unknown): value is OfficeHoursAnswer {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (v.next === null || typeof v.next === 'string')
        && (v.end === null || typeof v.end === 'string')
        && typeof v.canceled === 'boolean'
        && typeof v.url === 'string'
        && typeof v.liveUrl === 'string';
}

/** Local calendar-day stamp for today/tomorrow copy (user's own timezone). */
function localDayStamp(d: Date): number {
    return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function nextLocalMidnight(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

/** "11 AM" / "4:30 PM" in the user's locale + timezone (exact, not a guess). */
function localTimeShort(start: Date): string {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
        .format(start)
        .replace(':00', '');
}

/** "today" / "tomorrow" / "Fri" relative to the user's local calendar. */
function relativeDayWord(now: Date, start: Date): string {
    const startStamp = localDayStamp(start);
    if (startStamp === localDayStamp(now)) return 'today';
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
    if (startStamp === localDayStamp(tomorrow)) return 'tomorrow';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(start);
}

export class OfficeHoursChip {
    private readonly plugin: RadialTimelinePlugin;
    private data: OfficeHoursAnswer | null = null;
    private lastSuccessAt = 0; // last successful fetch (staleness clock)
    private lastAttemptAt = 0; // last fetch attempt (paranoia + wake debounce)
    private timers: number[] = [];
    private el: HTMLAnchorElement | null = null;
    private fetching = false;
    private destroyed = false;

    constructor(plugin: RadialTimelinePlugin) {
        this.plugin = plugin;
        void this.refetch(); // refetch on load (spec §4)
    }

    /** Signed in (connected) AND the community connect toggle is on. */
    private eligible(): boolean {
        const cs = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        return cs.enabled
            && cs.connection.status === 'connected'
            && Boolean(cs.connection.connectionId);
    }

    /**
     * Mount the chip into the session-panel header. Called on every panel
     * render (the panel empties itself); state lives on this controller, so
     * the chip re-appears in whatever state the schedule is in.
     */
    renderInto(header: HTMLElement): void {
        this.el = null;
        if (this.destroyed || !this.eligible()) return; // absence by choice is silent
        const el = header.createEl('a', { cls: 'ert-timeline-session-panel__oh-chip ert-hidden' });
        el.rel = 'noopener';
        this.el = el;
        this.update();
    }

    /** Refetch on window focus / visibilitychange (laptop-was-asleep case). */
    onWake(): void {
        if (this.destroyed || !this.eligible()) return;
        if (Date.now() - this.lastAttemptAt < WAKE_REFETCH_GAP_MS) return;
        void this.refetch();
    }

    destroy(): void {
        this.destroyed = true;
        this.clearTimers();
        this.el = null;
    }

    // ── data freshness ──────────────────────────────────────────────────────

    private async refetch(): Promise<void> {
        if (this.destroyed || this.fetching) return;
        if (!this.eligible()) {
            this.clearTimers();
            return;
        }
        this.fetching = true;
        this.lastAttemptAt = Date.now();
        try {
            const res = await requestUrl({ url: OFFICE_HOURS_URL, method: 'GET', throw: false });
            if (res.status >= 200 && res.status < 300) {
                const body: unknown = JSON.parse(res.text);
                if (isOfficeHoursAnswer(body)) {
                    this.data = body;
                    this.lastSuccessAt = Date.now();
                }
            }
        } catch {
            // Network failure: keep last-known data. Brief unreachability shows
            // normally; the staleness clock handles prolonged failure (spec §5).
        } finally {
            this.fetching = false;
            this.update();
            this.armTimers();
        }
    }

    private clearTimers(): void {
        for (const id of this.timers) window.clearTimeout(id);
        this.timers = [];
    }

    private armTimers(): void {
        this.clearTimers();
        if (this.destroyed || !this.eligible()) return;
        const now = Date.now();
        const jitter = Math.random() * JITTER_MS;

        // Layer 2 — adaptive poll by proximity to the next session.
        let pollMs = POLL_FAR_MS;
        const start = this.data?.next ? Date.parse(this.data.next) : NaN;
        const end = this.data?.end ? Date.parse(this.data.end) : NaN;
        if (Number.isFinite(start)) {
            const untilStart = start - now;
            const beforeEnd = Number.isFinite(end) ? now < end : untilStart > 0;
            if (beforeEnd && untilStart < HOUR_MS) pollMs = POLL_CLOSE_MS;
            else if (untilStart < 24 * HOUR_MS) pollMs = POLL_NEAR_MS;
        }
        this.timers.push(window.setTimeout(() => void this.refetch(), pollMs + jitter));

        // Layer 1 — exact state flips.
        if (Number.isFinite(start) && start > now && start - now < MAX_TIMEOUT_MS) {
            // Paranoia refetch at the start instant — update() only flips green
            // after a fetch attempt at/after the start, so the refetch always
            // precedes the flip (catches a minutes-before cancellation).
            this.timers.push(window.setTimeout(() => void this.refetch(), start - now));
        }
        if (Number.isFinite(end) && end > now && end - now < MAX_TIMEOUT_MS) {
            this.timers.push(window.setTimeout(() => {
                this.update();
                void this.refetch(); // roll straight to the next session
            }, end - now + 1000));
        }

        // Local-midnight rollover: "tomorrow" → "today" copy.
        const midnightDelay = nextLocalMidnight(new Date(now)).getTime() - now;
        this.timers.push(window.setTimeout(() => {
            this.update();
            this.armTimers();
        }, midnightDelay + 1000 + jitter));
    }

    // ── rendering ───────────────────────────────────────────────────────────

    private update(): void {
        const el = this.el;
        if (!el || !el.isConnected) return;
        const data = this.data;
        if (!this.eligible() || !data || !data.next || !data.end) {
            el.classList.add('ert-hidden');
            return;
        }

        const now = Date.now();
        const start = Date.parse(data.next);
        const end = Date.parse(data.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || now >= end) {
            // Last-known session is already over and nothing fresher is known —
            // an ended session must never keep advertising itself.
            el.classList.add('ert-hidden');
            return;
        }

        const stale = now - this.lastSuccessAt > STALE_AFTER_MS;
        // Green requires: not canceled, inside the window, data not stale, and
        // a fetch attempt at/after the start instant (paranoia refetch, §4).
        const live = !data.canceled
            && now >= start
            && !stale
            && this.lastAttemptAt >= start;

        const startDate = new Date(start);
        const nowDate = new Date(now);
        let text: string;
        if (live) {
            text = 'OH live now';
        } else if (data.canceled) {
            text = `OH ${relativeDayWord(nowDate, startDate)} · Canceled`;
        } else {
            text = `OH ${relativeDayWord(nowDate, startDate)} · ${localTimeShort(startDate)}`;
        }
        if (stale) text += ' · ⚠';

        el.setText(text);
        el.classList.toggle('is-live', live);
        el.classList.remove('ert-hidden');
        el.href = live && data.liveUrl ? data.liveUrl : data.url;
        applyTooltip(
            el,
            stale
                ? STALE_TOOLTIP
                : `Office hours — ${new Intl.DateTimeFormat(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                }).format(startDate).replace(':00', '')}${data.canceled ? ' · Canceled' : ''}`,
            'bottom'
        );
    }
}
