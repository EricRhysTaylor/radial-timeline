/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Community mailbox: the title-bar Mailbox pill (mail icon + "Mailbox") right
 * of the writing-session control, where the Discord pill was until 7.3.2. It
 * works like the website account chip, in the same colours: the admin support
 * inbox count (red while a request is unread, blue while requests only await
 * a reply), else a gold count of what waits on you (your requests with a team
 * reply, your questions with new replies, and Desk Lamp invites; the website
 * account chip counts the same). Clicking opens a menu like the website's
 * account menu: Requests, New replies, Desk Lamp invites, and the Support
 * inbox for admins, each with its own count.
 *
 * The server is the single source of truth: `community-mailbox` returns the
 * facts the website itself shows. This module never computes a count and
 * never marks anything read. The menu opens the website, and reading there
 * clears the badge on the next check.
 *
 * Shown on a vault connected to the Community at any sharing level, Private
 * included (it only reads; Eric, 2026-10-03), with the Advanced toggle on
 * (the default). It checks only while a timeline view shows it: when the
 * first view opens, hourly after that, and when a timeline window regains
 * focus (the "I just read it on the website" return). A failed check keeps
 * the pill, drops the badge and says why in the tooltip; it never raises a
 * Notice.
 */

import { Menu } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { tooltip as applyTooltip } from '../utils/tooltip';
import { fetchCommunityMailbox, type CommunityMailboxAnswer } from './communityShareClient';
import { hasCommunityConnection, normalizeCommunityShareSettings } from './communityShareSettings';

export const COMMUNITY_SITE_URL = 'https://community.radialtimeline.com';
/** My Share: where a member manages what they share, blocks, and Desk Lamps. */
export const COMMUNITY_MY_SHARE_URL = `${COMMUNITY_SITE_URL}/me`;
/** My Share's Desk Lamps section, where invites are answered. */
export const COMMUNITY_DESK_LAMPS_URL = `${COMMUNITY_MY_SHARE_URL}#desk-lamps`;

const POLL_MS = 60 * 60e3;
const JITTER_MS = 5 * 60e3; // 0–5 min added to every hourly check
const WAKE_REFETCH_GAP_MS = 60e3; // debounce focus/visibility checks

export interface MailboxView {
    /** Connected to the Community and the toggle is on. */
    visible: boolean;
    /** The last successful check; null before the first one and after a failure. */
    answer: CommunityMailboxAnswer | null;
    /** Why the last check failed, when it did. */
    error: string | null;
}

/**
 * One count in the website chip's colours: red `unread` (support requests
 * the admin has not opened), blue `awaiting` (open requests awaiting a team
 * reply), gold `new` (conversations with new replies for you).
 */
export interface MailboxBadge {
    tone: 'unread' | 'awaiting' | 'new';
    count: number;
}

/** The admin support inbox badge (website lib/support.ts adminInboxBadge). */
function inboxBadge(answer: CommunityMailboxAnswer | null): MailboxBadge | null {
    const admin = answer?.admin;
    if (!admin) return null;
    if (admin.unread > 0) return { tone: 'unread', count: admin.unread };
    if (admin.awaiting > 0) return { tone: 'awaiting', count: admin.awaiting };
    return null;
}

/** The pill's badge: the inbox count when there is one, else the gold count of new replies and Desk Lamp invites. */
export function mailboxBadge(answer: CommunityMailboxAnswer | null): MailboxBadge | null {
    if (!answer) return null;
    const inbox = inboxBadge(answer);
    if (inbox) return inbox;
    const fresh = answer.support_unread + answer.replies.count + answer.desk_lamp_invites;
    return fresh > 0 ? { tone: 'new', count: fresh } : null;
}

export interface MailboxMenuEntry {
    label: string;
    icon: string;
    url: string;
    badge: MailboxBadge | null;
}

/**
 * The pill's menu, item for item the mailbox part of the website account
 * menu: Requests, New replies (only while there are some; opens the newest
 * question with a reply), Desk Lamp invites (only while some wait; opens My
 * Share's Desk Lamps section), and the Support inbox for admins.
 */
export function mailboxMenuEntries(answer: CommunityMailboxAnswer | null): MailboxMenuEntry[] {
    const entries: MailboxMenuEntry[] = [{
        label: 'Requests',
        icon: 'mail',
        url: `${COMMUNITY_SITE_URL}/requests`,
        badge: answer && answer.support_unread > 0 ? { tone: 'new', count: answer.support_unread } : null
    }];
    if (answer && answer.replies.count > 0 && answer.replies.latest_post_id) {
        entries.push({
            label: 'New replies',
            icon: 'reply',
            url: `${COMMUNITY_SITE_URL}/posts/${answer.replies.latest_post_id}`,
            badge: { tone: 'new', count: answer.replies.count }
        });
    }
    if (answer && answer.desk_lamp_invites > 0) {
        entries.push({
            label: 'Desk Lamp invites',
            icon: 'lamp-ceiling',
            url: COMMUNITY_DESK_LAMPS_URL,
            badge: { tone: 'new', count: answer.desk_lamp_invites }
        });
    }
    if (answer?.admin) {
        entries.push({ label: 'Support inbox', icon: 'inbox', url: `${COMMUNITY_SITE_URL}/admin/support`, badge: inboxBadge(answer) });
    }
    return entries;
}

export function mailboxTooltip(view: MailboxView): string {
    if (view.error) return `Mailbox: couldn't check for new replies (${view.error}).`;
    const answer = view.answer;
    if (!answer) return 'Mailbox';
    const notes: string[] = [];
    const inbox = inboxBadge(answer);
    if (inbox?.tone === 'unread') notes.push(`${inbox.count} unread in the support inbox`);
    if (inbox?.tone === 'awaiting') notes.push(`${inbox.count} awaiting a reply in the support inbox`);
    if (answer.support_unread === 1) notes.push('a new reply in Requests');
    else if (answer.support_unread > 1) notes.push(`new replies on ${answer.support_unread} requests`);
    if (answer.replies.count === 1) notes.push('new replies to your question');
    else if (answer.replies.count > 1) notes.push(`new replies to ${answer.replies.count} of your questions`);
    if (answer.desk_lamp_invites === 1) notes.push('a Desk Lamp invite waiting');
    else if (answer.desk_lamp_invites > 1) notes.push(`${answer.desk_lamp_invites} Desk Lamp invites waiting`);
    return notes.length ? `Mailbox: ${notes.join(' · ')}` : 'Mailbox: nothing new';
}

/** Paint a badge element (the pill's corner, or a menu item). */
function paintBadge(el: HTMLElement, badge: MailboxBadge | null): void {
    el.hidden = badge === null;
    el.className = 'ert-mailbox-badge';
    el.setText('');
    if (!badge) return;
    el.classList.add(`is-${badge.tone}`);
    el.setText(badge.count > 99 ? '99+' : String(badge.count));
}

/** Paint one title-bar Mailbox pill from the shared state. */
export function paintMailboxButton(button: HTMLElement, badgeEl: HTMLElement, view: MailboxView): void {
    button.hidden = !view.visible;
    if (!view.visible) return;
    paintBadge(badgeEl, mailboxBadge(view.answer));
    button.classList.toggle('is-stale', view.error !== null);
    const label = mailboxTooltip(view);
    button.setAttribute('aria-label', label);
    applyTooltip(button, label, 'bottom');
}

/** Open the pill's menu just below it; each item opens its Community page. */
export function openMailboxMenu(anchor: HTMLElement, answer: CommunityMailboxAnswer | null): void {
    const doc = anchor.ownerDocument;
    const menu = new Menu();
    for (const entry of mailboxMenuEntries(answer)) {
        menu.addItem(item => {
            const title = doc.win.createFragment();
            title.appendText(entry.label);
            if (entry.badge) {
                const badgeEl = title.createSpan();
                paintBadge(badgeEl, entry.badge);
                badgeEl.classList.add('ert-mailbox-badge--menu');
            }
            item.setTitle(title)
                .setIcon(entry.icon)
                .onClick(() => { window.open(entry.url, '_blank'); });
        });
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, doc);
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
        if (!hasCommunityConnection(share)) return null;
        return `${share.connection.connectionId}|${share.connection.secretId}`;
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
