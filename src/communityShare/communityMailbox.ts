import { setAccessibleLabel } from '../utils/domTooltip';
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
 *
 * While the vault keeps a non-empty book list synced (expectsBookListSync), the menu
 * also carries one Community sync row read from the connection's book-list
 * sync record: when the list last reached the website, in red when the
 * latest attempt failed or no sync has succeeded for COMMUNITY_SYNC_OVERDUE_MS.
 * Choosing it syncs now. A row needing attention counts one toward the
 * pill's gold count, like the other things that wait on you.
 */

import { Menu, Notice, Platform, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getFormattingLocale, t } from '../i18n';
import { tooltip as applyTooltip } from '../utils/tooltip';
import type { CommunityShareSettings } from '../types/settings';
import { fetchCommunityMailbox, syncCommunityProjects, type CommunityMailboxAnswer } from './communityShareClient';
import { expectsBookListSync, hasCommunityConnection, normalizeCommunityShareSettings } from './communityShareSettings';

export const COMMUNITY_SITE_URL = 'https://community.radialtimeline.com';
/** My Share: where a member manages what they share, blocks, and Desk Lamps. */
export const COMMUNITY_MY_SHARE_URL = `${COMMUNITY_SITE_URL}/me`;
/** My Share's Desk Lamps section, where invites are answered. */
export const COMMUNITY_DESK_LAMPS_URL = `${COMMUNITY_MY_SHARE_URL}#desk-lamps`;

const POLL_MS = 60 * 60e3;
const JITTER_MS = 5 * 60e3; // 0–5 min added to every hourly check
const WAKE_REFETCH_GAP_MS = 60e3; // debounce focus/visibility checks

/**
 * No successful book-list sync for longer than this turns the Community sync
 * row red. Matches the Community website, which flags a vault whose book list
 * has not synced for the same 7 days.
 */
export const COMMUNITY_SYNC_OVERDUE_MS = 7 * 24 * 60 * 60e3;

/**
 * The Community sync row's state. `healthy`: the latest sync succeeded within
 * the overdue window. `failed`: the latest attempt failed (the reason is the
 * stored error). `overdue`: no success for longer than the window. `pending`:
 * no sync has succeeded yet on a connection younger than the window.
 * `syncing`: a Sync now is on its way.
 */
export type CommunitySyncState =
    | { status: 'healthy'; syncedAt: number }
    | { status: 'failed'; error: string }
    | { status: 'overdue'; syncedAt: number | null }
    | { status: 'pending' }
    | { status: 'syncing' };

function parseTime(value: string | undefined): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * The row for these settings at `now`; null when the vault is not expected to
 * sync its book list (no row). With no books in the Book Manager there is no
 * list to send (syncCommunityProjects sends nothing and records nothing), so
 * there is no row either, rather than one that turns red after 7 days.
 */
export function communitySyncState(share: CommunityShareSettings, now: number, hasBooks: boolean): CommunitySyncState | null {
    if (!expectsBookListSync(share) || !hasBooks) return null;
    const { bookListSyncError, bookListSyncedAt, connectedAt } = share.connection;
    if (bookListSyncError) return { status: 'failed', error: bookListSyncError };
    const syncedAt = parseTime(bookListSyncedAt);
    if (syncedAt !== null) {
        return now - syncedAt > COMMUNITY_SYNC_OVERDUE_MS ? { status: 'overdue', syncedAt } : { status: 'healthy', syncedAt };
    }
    // Never synced: overdue once the connection itself is older than the window.
    const since = parseTime(connectedAt);
    return since !== null && now - since > COMMUNITY_SYNC_OVERDUE_MS ? { status: 'overdue', syncedAt: null } : { status: 'pending' };
}

/** Failed and overdue rows wait on the author, like an unread reply. */
export function syncNeedsAttention(state: CommunitySyncState | null): boolean {
    return state?.status === 'failed' || state?.status === 'overdue';
}

/** "5 minutes ago", "yesterday", "9 days ago" in the interface language. */
function relativeTime(then: number, now: number): string {
    const elapsed = Math.max(0, now - then);
    const format = new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' });
    if (elapsed < 3_600_000) return format.format(-Math.floor(elapsed / 60_000), 'minute');
    if (elapsed < 86_400_000) return format.format(-Math.floor(elapsed / 3_600_000), 'hour');
    return format.format(-Math.floor(elapsed / 86_400_000), 'day');
}

export interface CommunitySyncRow {
    /** What the row says. */
    text: string;
    /** Red (Obsidian's warning menu item): failed or overdue. */
    warning: boolean;
    /** False while a Sync now is on its way. */
    canSync: boolean;
}

export function communitySyncRow(state: CommunitySyncState, now: number): CommunitySyncRow {
    switch (state.status) {
        case 'syncing':
            return { text: t('ui.communityMailbox.syncing'), warning: false, canSync: false };
        case 'failed':
            return { text: t('ui.communityMailbox.syncFailed', { error: state.error }), warning: true, canSync: true };
        case 'pending':
            return { text: t('ui.communityMailbox.notSyncedYet'), warning: false, canSync: true };
        case 'healthy':
        case 'overdue': {
            const warning = state.status === 'overdue';
            if (state.syncedAt === null) return { text: t('ui.communityMailbox.notSyncedYet'), warning, canSync: true };
            const text = now - state.syncedAt < 60_000
                ? t('ui.communityMailbox.syncedJustNow')
                : t('ui.communityMailbox.syncedAgo', { time: relativeTime(state.syncedAt, now) });
            return { text, warning, canSync: true };
        }
    }
}

/**
 * The automatic book-list sync cadence. main.ts registers the community sync
 * interval at layout-ready with this period and records when it did
 * (plugin.communitySyncIntervalStartedAt).
 */
export const COMMUNITY_AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60e3;

/**
 * The interval's next tick after `now`: start + n × interval, with n the
 * smallest whole number of periods that lands strictly after `now`. A tick
 * exactly at `now` is firing, so the next one is a full period on.
 */
export function nextAutoSyncAt(startedAt: number, now: number, interval: number = COMMUNITY_AUTO_SYNC_INTERVAL_MS): number {
    const elapsedTicks = Math.max(0, Math.floor((now - startedAt) / interval));
    return startedAt + (elapsedTicks + 1) * interval;
}

/** A local time in the interface language ("3:45 PM"), with the date when it is not on `now`'s day ("Nov 8, 1:45 AM"). */
export function formatAutoSyncTime(at: number, now: number): string {
    const when = new Date(at);
    const today = new Date(now);
    const sameDay = when.getFullYear() === today.getFullYear()
        && when.getMonth() === today.getMonth()
        && when.getDate() === today.getDate();
    const options: Intl.DateTimeFormatOptions = sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return new Intl.DateTimeFormat(getFormattingLocale(), options).format(when);
}

/**
 * The row's tooltip: clicking syncs now, and when the next automatic sync is
 * due (left out before the interval starts at layout-ready). A failed row
 * puts its reason first. None while a Sync now is on its way.
 */
export function communitySyncTooltip(state: CommunitySyncState, nextAt: number | null, now: number): string | null {
    if (state.status === 'syncing') return null;
    const hint = nextAt === null
        ? t('ui.communityMailbox.syncTooltipNoSchedule')
        : t('ui.communityMailbox.syncTooltip', { time: formatAutoSyncTime(nextAt, now) });
    if (state.status !== 'failed') return hint;
    return t('ui.communityMailbox.syncTooltipWithReason', {
        reason: t('ui.communityMailbox.syncFailed', { error: state.error }),
        hint
    });
}

/**
 * The row's text in a native (OS) menu, which shows no icon and no tooltip:
 * the status, then that clicking syncs and when the next automatic sync is
 * due. The status leads, so a failure keeps its reason first. While syncing
 * the status says it all.
 */
export function communitySyncNativeText(state: CommunitySyncState, nextAt: number | null, now: number): string {
    const status = communitySyncRow(state, now).text;
    if (state.status === 'syncing') return status;
    return nextAt === null
        ? t('ui.communityMailbox.syncRowNativeNoSchedule', { status })
        : t('ui.communityMailbox.syncRowNative', { status, time: formatAutoSyncTime(nextAt, now) });
}

/**
 * Obsidian's Appearance → Native menus (desktop only). Menus then render
 * through the OS: titles as plain text, no icons, no DOM to hang a tooltip on.
 */
export function usesNativeMenus(app: App): boolean {
    if (!Platform.isDesktopApp) return false;
    // SAFE: Vault.getConfig is not in Obsidian's public typings; 'nativeMenus' is the Appearance setting's config key. Absent getConfig reads as off (Obsidian's own menus).
    const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
    return vault.getConfig?.('nativeMenus') === true;
}

export interface MailboxView {
    /** Connected to the Community and the toggle is on. */
    visible: boolean;
    /** The last successful check; null before the first one and after a failure. */
    answer: CommunityMailboxAnswer | null;
    /** Why the last check failed, when it did. */
    error: string | null;
    /** The Community sync row; null when the vault does not sync its book list. */
    sync: CommunitySyncState | null;
    /** When the next automatic book-list sync is due, for the row's tooltip; null with no row or before the interval starts. */
    nextAutoSyncAt: number | null;
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

/**
 * The pill's badge: the inbox count when there is one, else the gold count of
 * new replies, Desk Lamp invites, and a Community sync row that needs
 * attention (one). The sync row is local, so it counts before the first check
 * and after a failed one too.
 */
export function mailboxBadge(answer: CommunityMailboxAnswer | null, syncAttention = false): MailboxBadge | null {
    const inbox = inboxBadge(answer);
    if (inbox) return inbox;
    const fresh = (answer ? answer.support_unread + answer.replies.count + answer.desk_lamp_invites : 0) + (syncAttention ? 1 : 0);
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
        label: t('ui.communityMailbox.menuRequests'),
        icon: 'mail',
        url: `${COMMUNITY_SITE_URL}/requests`,
        badge: answer && answer.support_unread > 0 ? { tone: 'new', count: answer.support_unread } : null
    }];
    if (answer && answer.replies.count > 0 && answer.replies.latest_post_id) {
        entries.push({
            label: t('ui.communityMailbox.menuNewReplies'),
            icon: 'reply',
            url: `${COMMUNITY_SITE_URL}/posts/${answer.replies.latest_post_id}`,
            badge: { tone: 'new', count: answer.replies.count }
        });
    }
    if (answer && answer.desk_lamp_invites > 0) {
        entries.push({
            label: t('ui.communityMailbox.menuDeskLampInvites'),
            icon: 'lamp-ceiling',
            url: COMMUNITY_DESK_LAMPS_URL,
            badge: { tone: 'new', count: answer.desk_lamp_invites }
        });
    }
    if (answer?.admin) {
        entries.push({ label: t('ui.communityMailbox.menuSupportInbox'), icon: 'inbox', url: `${COMMUNITY_SITE_URL}/admin/support`, badge: inboxBadge(answer) });
    }
    return entries;
}

export function mailboxTooltip(view: MailboxView): string {
    if (view.error) return t('ui.communityMailbox.tooltipError', { error: view.error });
    const answer = view.answer;
    const syncNote = syncNeedsAttention(view.sync) ? t('ui.communityMailbox.syncNeedsAttention') : null;
    if (!answer) return syncNote ? t('ui.communityMailbox.tooltip', { notes: syncNote }) : t('ui.communityMailbox.tooltipTitle');
    const notes: string[] = [];
    const inbox = inboxBadge(answer);
    if (inbox?.tone === 'unread') notes.push(t('ui.communityMailbox.inboxUnread', { count: inbox.count }));
    if (inbox?.tone === 'awaiting') notes.push(t('ui.communityMailbox.inboxAwaiting', { count: inbox.count }));
    if (answer.support_unread === 1) notes.push(t('ui.communityMailbox.newReplyInRequests'));
    else if (answer.support_unread > 1) notes.push(t('ui.communityMailbox.newRepliesOnRequests', { count: answer.support_unread }));
    if (answer.replies.count === 1) notes.push(t('ui.communityMailbox.newRepliesToQuestion'));
    else if (answer.replies.count > 1) notes.push(t('ui.communityMailbox.newRepliesToQuestions', { count: answer.replies.count }));
    if (answer.desk_lamp_invites === 1) notes.push(t('ui.communityMailbox.deskLampInviteWaiting'));
    else if (answer.desk_lamp_invites > 1) notes.push(t('ui.communityMailbox.deskLampInvitesWaiting', { count: answer.desk_lamp_invites }));
    if (syncNote) notes.push(syncNote);
    return notes.length ? t('ui.communityMailbox.tooltip', { notes: notes.join(' · ') }) : t('ui.communityMailbox.nothingNew');
}

function badgeText(badge: MailboxBadge): string {
    return badge.count > 99 ? '99+' : String(badge.count);
}

/** Paint a badge element (the pill's corner, or a menu item). */
function paintBadge(el: HTMLElement, badge: MailboxBadge | null): void {
    el.hidden = badge === null;
    el.className = 'ert-mailbox-badge';
    el.setText('');
    if (!badge) return;
    el.classList.add(`is-${badge.tone}`);
    el.setText(badgeText(badge));
}

/** A menu entry's title in a native menu, which drops the styled badge: "Requests (2)". */
export function nativeMenuEntryTitle(entry: MailboxMenuEntry): string {
    return entry.badge ? `${entry.label} (${badgeText(entry.badge)})` : entry.label;
}

/** Paint one title-bar Mailbox pill from the shared state. */
export function paintMailboxButton(button: HTMLElement, badgeEl: HTMLElement, view: MailboxView): void {
    button.hidden = !view.visible;
    if (!view.visible) return;
    paintBadge(badgeEl, mailboxBadge(view.answer, syncNeedsAttention(view.sync)));
    button.classList.toggle('is-stale', view.error !== null);
    const label = mailboxTooltip(view);
    setAccessibleLabel(button, label);
    applyTooltip(button, label, 'bottom');
}

/**
 * Open the pill's menu just below it; each item opens its Community page.
 * Below them, while the vault syncs its book list, the Community sync row:
 * choosing it runs `onSyncNow`. `nativeMenus` (usesNativeMenus) moves the
 * row's action and timing from its icon and tooltip into its text.
 */
export function openMailboxMenu(anchor: HTMLElement, view: MailboxView, onSyncNow: () => void, nativeMenus: boolean): void {
    const doc = anchor.ownerDocument;
    const menu = new Menu();
    for (const entry of mailboxMenuEntries(view.answer)) {
        menu.addItem(item => {
            if (nativeMenus) {
                // The badge span would run into the label as plain text.
                item.setTitle(nativeMenuEntryTitle(entry));
            } else {
                const title = doc.win.createFragment();
                title.appendText(entry.label);
                if (entry.badge) {
                    const badgeEl = title.createSpan();
                    paintBadge(badgeEl, entry.badge);
                    badgeEl.classList.add('ert-mailbox-badge--menu');
                }
                item.setTitle(title);
            }
            item.setIcon(entry.icon)
                .onClick(() => { window.open(entry.url, '_blank'); });
        });
    }
    if (view.sync) {
        const now = Date.now();
        const row = communitySyncRow(view.sync, now);
        // A native menu shows neither the icon nor the tooltip, so the row's
        // own text carries the action and the next sync time there.
        const hint = nativeMenus ? null : communitySyncTooltip(view.sync, view.nextAutoSyncAt, now);
        const text = nativeMenus ? communitySyncNativeText(view.sync, view.nextAutoSyncAt, now) : row.text;
        menu.addSeparator();
        menu.addItem(item => {
            // The whole row is the Sync now control; its icon says so.
            const title = doc.win.createFragment();
            const label = title.createSpan();
            label.setText(text);
            item.setTitle(title)
                .setIcon(row.warning ? 'alert-triangle' : 'refresh-cw')
                .setWarning(row.warning)
                .setDisabled(!row.canSync)
                .onClick(() => { if (row.canSync) onSyncNow(); });
            // MenuItem exposes no element, so reach the row through its title
            // label. A native (OS) menu has no DOM row and shows no tooltip.
            const rowEl = label.closest('.menu-item');
            if (hint && rowEl?.instanceOf(HTMLElement)) applyTooltip(rowEl, hint, 'bottom');
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
    /** A Sync now is on its way. */
    private syncing = false;
    /** The book-list sync record last painted, so a settings save that changes it repaints. */
    private syncKey: string;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly plugin: RadialTimelinePlugin) {
        this.connectionKey = this.currentKey();
        this.syncKey = this.currentSyncKey();
    }

    view(): MailboxView {
        const visible = this.connectionKey !== null;
        const now = Date.now();
        let sync: CommunitySyncState | null = null;
        if (visible) {
            sync = communitySyncState(normalizeCommunityShareSettings(this.plugin.settings.communityShare), now, this.hasBooks());
            if (sync && this.syncing) sync = { status: 'syncing' };
        }
        const startedAt = this.plugin.communitySyncIntervalStartedAt;
        const nextAutoSync = sync && typeof startedAt === 'number' ? nextAutoSyncAt(startedAt, now) : null;
        return { visible, answer: this.answer, error: this.error, sync, nextAutoSyncAt: nextAutoSync };
    }

    /**
     * The Community sync row's Sync now: send the book list at once (the
     * existing project sync, not the throttled one) and repaint. The outcome
     * is recorded on the connection by syncCommunityProjects; the menu has
     * closed by now, so a Notice says how it went.
     */
    async syncNow(): Promise<void> {
        if (this.destroyed || this.syncing) return;
        this.syncing = true;
        this.emit();
        let failure: string | null = null;
        try {
            await syncCommunityProjects(this.plugin);
        } catch (e) {
            failure = e instanceof Error ? e.message : String(e);
        }
        this.syncing = false;
        if (this.destroyed) return;
        this.syncKey = this.currentSyncKey();
        this.emit();
        new Notice(failure === null
            ? t('ui.communityMailbox.syncedJustNow')
            : t('ui.communityMailbox.syncFailed', { error: failure }));
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
        const syncKey = this.currentSyncKey();
        if (key === this.connectionKey) {
            // Same connection: repaint only when its book-list sync record changed.
            if (syncKey !== this.syncKey) {
                this.syncKey = syncKey;
                this.emit();
            }
            return;
        }
        this.connectionKey = key;
        this.syncKey = syncKey;
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

    /** Everything the Community sync row reads from settings, as one comparable string. */
    private currentSyncKey(): string {
        const share = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        const { bookListSyncedAt, bookListSyncError, bookListSyncFailedAt, connectedAt } = share.connection;
        return JSON.stringify([expectsBookListSync(share), this.hasBooks(), bookListSyncedAt, bookListSyncError, bookListSyncFailedAt, connectedAt]);
    }

    /** Whether the Book Manager has a book list to sync. */
    private hasBooks(): boolean {
        return (this.plugin.settings.books ?? []).length > 0; // SAFE: settings saved before the Book Manager have no books array, which is no books
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
