/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Community mailbox: the title-bar mail icon right of the writing-session
 * control (where the Discord pill was until 7.3.2). It mirrors the website
 * account chip: the admin support inbox count (red while a request is unread,
 * blue while requests only await a reply), else a dot for an unread reply (a
 * team reply in Requests, or a reply to one of your questions).
 *
 * The server is the single source of truth: `community-mailbox` returns the
 * facts the website itself shows. This module never computes a count and
 * never marks anything read. Clicking opens the website, and reading there
 * clears the mark on the next check.
 *
 * Shown only on a vault connected to the Community, with the Advanced toggle
 * on (the default). It checks only while a timeline view shows it: when the
 * first view opens, hourly after that, and when a timeline window regains
 * focus (the "I just read it on the website" return). A failed check keeps
 * the icon, drops the mark and says why in the tooltip; it never raises a
 * Notice.
 */

import type RadialTimelinePlugin from '../main';
import { tooltip as applyTooltip } from '../utils/tooltip';
import { fetchCommunityMailbox, type CommunityMailboxAnswer } from './communityShareClient';
import { normalizeCommunityShareSettings } from './communityShareSettings';

export const COMMUNITY_SITE_URL = 'https://community.radialtimeline.com';

const POLL_MS = 60 * 60e3;
const JITTER_MS = 5 * 60e3; // 0–5 min added to every hourly check
const WAKE_REFETCH_GAP_MS = 60e3; // debounce focus/visibility checks
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MailboxView {
    /** Connected to the Community and the toggle is on. */
    visible: boolean;
    /** The last successful check; null before the first one and after a failure. */
    answer: CommunityMailboxAnswer | null;
    /** Why the last check failed, when it did. */
    error: string | null;
}

export type MailboxMark =
    | { kind: 'count'; tone: 'unread' | 'awaiting'; count: number }
    | { kind: 'dot' }
    | null;

/** The website chip's mark: the inbox count when there is one, else a dot for any unread reply. */
export function mailboxMark(answer: CommunityMailboxAnswer | null): MailboxMark {
    if (!answer) return null;
    if (answer.admin && answer.admin.unread > 0) return { kind: 'count', tone: 'unread', count: answer.admin.unread };
    if (answer.admin && answer.admin.awaiting > 0) return { kind: 'count', tone: 'awaiting', count: answer.admin.awaiting };
    if (answer.support_unread || answer.replies.count > 0) return { kind: 'dot' };
    return null;
}

/** Where a click goes: to whatever the mark is about, else Requests. */
export function mailboxDestination(answer: CommunityMailboxAnswer | null): string {
    if (answer?.admin && (answer.admin.unread > 0 || answer.admin.awaiting > 0)) return `${COMMUNITY_SITE_URL}/admin/support`;
    if (answer?.support_unread) return `${COMMUNITY_SITE_URL}/requests`;
    // The id is server input: only a UUID becomes part of the link.
    const post = answer?.replies.latest_post_id;
    if (answer && answer.replies.count > 0 && post && UUID_RE.test(post)) return `${COMMUNITY_SITE_URL}/posts/${post}`;
    return `${COMMUNITY_SITE_URL}/requests`;
}

export function mailboxTooltip(view: MailboxView): string {
    if (view.error) return `Community mailbox: couldn't check for new replies (${view.error}). Click to open it on the website.`;
    const answer = view.answer;
    if (!answer) return 'Community mailbox';
    const notes: string[] = [];
    if (answer.admin && answer.admin.unread > 0) notes.push(`${answer.admin.unread} unread in the support inbox`);
    else if (answer.admin && answer.admin.awaiting > 0) notes.push(`${answer.admin.awaiting} awaiting a reply in the support inbox`);
    if (answer.support_unread) notes.push('a new reply in Requests');
    if (answer.replies.count === 1) notes.push('new replies to your question');
    else if (answer.replies.count > 1) notes.push(`new replies to ${answer.replies.count} of your questions`);
    return notes.length ? `Community mailbox: ${notes.join(' · ')}` : 'Community mailbox: nothing new';
}

/** Paint one title-bar mailbox button from the shared state. */
export function paintMailboxButton(button: HTMLElement, markEl: HTMLElement, view: MailboxView): void {
    button.hidden = !view.visible;
    if (!view.visible) return;
    const mark = mailboxMark(view.answer);
    markEl.hidden = mark === null;
    markEl.className = 'ert-timeline-mailbox__mark';
    markEl.setText('');
    if (mark?.kind === 'count') {
        markEl.classList.add('is-count', mark.tone === 'unread' ? 'is-unread' : 'is-awaiting');
        markEl.setText(mark.count > 99 ? '99+' : String(mark.count));
    } else if (mark?.kind === 'dot') {
        markEl.classList.add('is-dot');
    }
    button.classList.toggle('is-stale', view.error !== null);
    const label = mailboxTooltip(view);
    button.setAttribute('aria-label', label);
    applyTooltip(button, label, 'bottom');
}

/**
 * The one plugin-wide mailbox. Timeline views subscribe to paint their
 * button; checking runs only while at least one view is subscribed.
 */
export class CommunityMailbox {
    private answer: CommunityMailboxAnswer | null = null;
    private error: string | null = null;
    /** The connection the mailbox belongs to; null = hidden. */
    private connectionKey: string | null = null;
    /** Bumped whenever the connection changes, so an older answer is dropped. */
    private generation = 0;
    private inFlightGeneration: number | null = null;
    private lastAttemptAt = 0;
    private timer: number | null = null;
    private destroyed = false;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly plugin: RadialTimelinePlugin) {
        this.connectionKey = this.currentKey();
    }

    view(): MailboxView {
        return { visible: this.connectionKey !== null, answer: this.answer, error: this.error };
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        if (this.listeners.size === 1 && this.connectionKey !== null && this.timer === null) {
            if (Date.now() - this.lastAttemptAt < WAKE_REFETCH_GAP_MS) this.armTimer();
            else void this.refresh();
        }
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0) this.clearTimer();
        };
    }

    /** Settings were saved (the toggle, or a Community connect / disconnect). Cheap when nothing changed. */
    settingsChanged(): void {
        if (this.destroyed) return;
        const key = this.currentKey();
        if (key === this.connectionKey) return;
        this.connectionKey = key;
        this.generation++;
        this.answer = null;
        this.error = null;
        this.clearTimer();
        this.emit();
        if (key !== null && this.listeners.size > 0) void this.refresh();
    }

    /** A timeline window regained focus or became visible. */
    onWake(): void {
        if (this.destroyed || this.connectionKey === null || this.listeners.size === 0) return;
        if (Date.now() - this.lastAttemptAt < WAKE_REFETCH_GAP_MS) return;
        void this.refresh();
    }

    destroy(): void {
        this.destroyed = true;
        this.clearTimer();
        this.listeners.clear();
    }

    private currentKey(): string | null {
        if (this.plugin.settings.showCommunityMailbox === false) return null;
        const share = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        const { status, connectionId, secretId } = share.connection;
        if (!share.enabled || status !== 'connected' || !connectionId || !secretId) return null;
        return `${connectionId}|${secretId}`;
    }

    private async refresh(): Promise<void> {
        const generation = this.generation;
        if (this.inFlightGeneration === generation) return;
        this.inFlightGeneration = generation;
        this.lastAttemptAt = Date.now();
        this.clearTimer();
        let answer: CommunityMailboxAnswer | null = null;
        let error: string | null = null;
        try {
            answer = await fetchCommunityMailbox(this.plugin);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
        if (this.inFlightGeneration === generation) this.inFlightGeneration = null;
        // The connection changed (or the plugin unloaded) while this was out.
        if (this.destroyed || generation !== this.generation) return;
        this.answer = answer;
        this.error = error;
        this.emit();
        this.armTimer();
    }

    private armTimer(): void {
        this.clearTimer();
        if (this.destroyed || this.connectionKey === null || this.listeners.size === 0) return;
        this.timer = window.setTimeout(() => {
            this.timer = null;
            void this.refresh();
        }, POLL_MS + Math.random() * JITTER_MS);
    }

    private clearTimer(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    private emit(): void {
        this.listeners.forEach(listener => listener());
    }
}
