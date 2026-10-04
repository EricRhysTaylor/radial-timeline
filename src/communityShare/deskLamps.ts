/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Desk Lamps: close writing friends who see each other's live writing
 * sessions (plan docs/engineering/plans/desk-lamps-plan.md, D1–D15; privacy
 * doctrine docs/engineering/standards/writing-session-privacy.md).
 *
 * Three parts live here:
 *
 * 1. The exit point. `projectDeskLampLight` turns the open session into the
 *    lamp: exactly state, mode, lit_at and audience. Nothing else from
 *    ActiveWritingSession (book title, stage, goals, countdown) crosses.
 *    Only a manual Pause reads as "break"; the auto-track idle pause stays
 *    "lit", so it never shows and never sends.
 *
 * 2. The living list (D15). The title-bar lamp's popover: lamps that are on,
 *    sorted by lit_at, mixed with "lamp off" bulletins sorted by the moment
 *    this device saw the lamp go off, freshest first, at most 12 rows.
 *    Bulletins are made here from answers already received and are held in
 *    memory only: never stored, never sent.
 *
 * 3. The one plugin-wide DeskLamps. It re-projects the lamp on every settings
 *    save (like the Mailbox) and sends only when the projected lamp changes:
 *    start, manual pause, resume, save, discard, audience changes, pausing
 *    sharing, the toggle. While the lamp is on it refreshes every minute,
 *    whatever view shows. While it is off it reads every minute with a
 *    timeline view showing and the window focused, or on the Mailbox's
 *    schedule before the first accepted Desk Lamp. A failed check keeps the
 *    button, drops the count and says why in the tooltip; it never raises a
 *    Notice.
 *
 * Desk Lamps needs a connected vault, not a sharing level: it works at
 * Private too (D12). The server keeps one live row per connection and no
 * history (D11).
 */

import { Menu } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { ActiveWritingSession, WritingSessionMode } from '../types/settings';
import { tooltip as applyTooltip } from '../utils/tooltip';
import { COMMUNITY_DESK_LAMPS_URL, COMMUNITY_SITE_URL } from './communityMailbox';
import { syncDeskLamps, type DeskLampFriend, type DeskLampLight, type DeskLampsAnswer, type LitDeskLamp } from './communityShareClient';
import { deskLampChoices, hasCommunityConnection, normalizeCommunityShareSettings } from './communityShareSettings';

/** The popover's row limit (D15). */
const DESK_LAMP_MAX_ROWS = 12;
/** Session panel first-use line (plan "Session panel"). */
export const DESK_LAMP_PANEL_NOTE = 'Ticked friends see that you\'re writing, your city, the kind of writing, and how long, until you save or end the session.';

const FIVE_MINUTES_MS = 5 * 60e3;
const LAMP_REFRESH_MS = 60e3;
const IDLE_POLL_MS = 60 * 60e3;
const JITTER_MS = 5 * 60e3; // 0–5 min added to every hourly check
const WAKE_REFETCH_GAP_MS = 60e3; // debounce focus/visibility checks
/** A bulletin is made only when the previous check was this recent ("just now"). */
const BULLETIN_FRESH_MS = 10 * 60e3;
/** How long a bulletin stays in the list. */
const BULLETIN_TTL_MS = 30 * 60e3;
const OFF = 'off';

const MODE_LABELS: Record<WritingSessionMode, string> = {
    drafting: 'Drafting',
    revising: 'Revising',
    editing: 'Editing',
    planning: 'Planning'
};

// ---------------------------------------------------------------------------
// 1. The exit point
// ---------------------------------------------------------------------------

/** The session start floored to 5 minutes (D7), ISO UTC; null when unparseable. */
function floorToFiveMinutes(iso: string): string | null {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    return new Date(Math.floor(ms / FIVE_MINUTES_MS) * FIVE_MINUTES_MS).toISOString();
}

/**
 * The lamp for an open session, shared with `audience`. Exactly four keys.
 * Null when the session start cannot be read: no lamp rather than a guess.
 */
export function projectDeskLampLight(session: ActiveWritingSession, audience: readonly string[]): DeskLampLight | null {
    const litAt = floorToFiveMinutes(session.startedAt);
    if (!litAt) return null;
    return {
        state: session.pausedAt && session.idleAuto !== true ? 'break' : 'lit',
        mode: session.mode,
        lit_at: litAt,
        audience: [...audience]
    };
}

// ---------------------------------------------------------------------------
// 2. The living list
// ---------------------------------------------------------------------------

/** A friend's lamp this device saw go off. Memory only. */
export interface DeskLampBulletin {
    profile_id: string;
    handle: string;
    display_name: string;
    place: string | null;
    /** When this device saw the lamp gone (ms). */
    off_at: number;
    /** How long it had been on, from its lit_at to off_at (ms). */
    on_for_ms: number;
}

export type DeskLampRow =
    | { kind: 'lamp'; at: number; lamp: LitDeskLamp }
    | { kind: 'bulletin'; at: number; bulletin: DeskLampBulletin };

/**
 * The bulletins after a check: a friend whose lamp was on at the previous
 * check and is gone now becomes one, but only when that check was under 10
 * minutes ago, so a bulletin always means "just now". Bulletins expire after
 * 30 minutes and vanish when that friend's lamp comes back on.
 */
export function nextDeskLampBulletins(
    previous: { lit: readonly LitDeskLamp[]; at: number } | null,
    lit: readonly LitDeskLamp[],
    bulletins: readonly DeskLampBulletin[],
    now: number
): DeskLampBulletin[] {
    const onNow = new Set(lit.map(lamp => lamp.profile_id));
    const next = bulletins.filter(bulletin => now - bulletin.off_at < BULLETIN_TTL_MS && !onNow.has(bulletin.profile_id));
    if (!previous || now - previous.at >= BULLETIN_FRESH_MS) return next;
    for (const lamp of previous.lit) {
        if (onNow.has(lamp.profile_id) || next.some(bulletin => bulletin.profile_id === lamp.profile_id)) continue;
        next.push({
            profile_id: lamp.profile_id,
            handle: lamp.handle,
            display_name: lamp.display_name,
            place: lamp.place,
            off_at: now,
            on_for_ms: Math.max(0, now - Date.parse(lamp.lit_at))
        });
    }
    return next;
}

function rowName(row: DeskLampRow): string {
    return row.kind === 'lamp' ? row.lamp.display_name : row.bulletin.display_name;
}

/**
 * The popover's rows, freshest change first (D15): a lamp that is on by its
 * lit_at, a bulletin by when it went off. `hiddenLamps` counts the lamps
 * below the fold for the "N more at their desks" footer.
 */
export function deskLampList(
    lit: readonly LitDeskLamp[],
    bulletins: readonly DeskLampBulletin[],
    now: number,
    limit = DESK_LAMP_MAX_ROWS
): { rows: DeskLampRow[]; hiddenLamps: number } {
    const rows: DeskLampRow[] = [
        ...lit.map((lamp): DeskLampRow => ({ kind: 'lamp', at: Date.parse(lamp.lit_at), lamp })),
        ...bulletins
            .filter(bulletin => now - bulletin.off_at < BULLETIN_TTL_MS)
            .map((bulletin): DeskLampRow => ({ kind: 'bulletin', at: bulletin.off_at, bulletin }))
    ];
    rows.sort((a, b) => b.at - a.at || rowName(a).localeCompare(rowName(b)));
    return {
        rows: rows.slice(0, limit),
        hiddenLamps: rows.slice(limit).filter(row => row.kind === 'lamp').length
    };
}

/** Elapsed time floored to 5 minutes ("45 min", "1 h 10 min"); null under 5 minutes. */
export function formatLampDuration(ms: number): string | null {
    const minutes = Math.floor(ms / FIVE_MINUTES_MS) * 5;
    if (minutes < 5) return null;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest} min`;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function dotJoin(parts: Array<string | null>): string {
    return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** "Maya Chen · Portland · Drafting · 45 min", "… · on a break", "Maya Chen · Portland · lamp off after 2 h 10 min". */
export function deskLampRowLabel(row: DeskLampRow, now: number): string {
    if (row.kind === 'bulletin') {
        const { bulletin } = row;
        return dotJoin([bulletin.display_name, bulletin.place, `lamp off after ${formatLampDuration(bulletin.on_for_ms) ?? 'a few minutes'}`]); // SAFE: D7 — under 5 minutes has no 5-minute figure
    }
    const { lamp } = row;
    const status = lamp.state === 'break'
        ? 'on a break'
        : formatLampDuration(now - Date.parse(lamp.lit_at)) ?? 'just started'; // SAFE: D7 — a lamp under 5 minutes old reads "just started"
    return dotJoin([lamp.display_name, lamp.place, MODE_LABELS[lamp.mode], status]);
}

/** The badge: friends whose lamp is lit. Breaks and bulletins never count. */
function litDeskLampCount(answer: DeskLampsAnswer | null): number {
    return answer ? answer.lit.filter(lamp => lamp.state === 'lit').length : 0;
}

/** "Maya", "Maya and Priya", "Maya, Priya and Theo", "Maya, Priya and 3 others". */
export function joinFirstNames(names: readonly string[]): string {
    const first = names.map(name => name.trim().split(/\s+/)[0] || name);
    if (first.length <= 1) return first.join('');
    if (first.length === 2) return `${first[0]} and ${first[1]}`;
    if (first.length === 3) return `${first[0]}, ${first[1]} and ${first[2]}`;
    return `${first[0]}, ${first[1]} and ${first.length - 2} others`;
}

/**
 * Your own lamp, as your friends see it. `on` only once the server has
 * accepted exactly this lamp; until then `lighting`, and `refused` when the
 * server said no (the panel never claims a lamp that isn't lit).
 */
export type OwnDeskLamp =
    | { kind: 'no_session' }
    | { kind: 'not_shared' }
    | { kind: 'sharing_paused' }
    | { kind: 'lighting'; names: string[]; count: number }
    | { kind: 'refused'; reason: string }
    | { kind: 'on'; state: 'lit' | 'break'; names: string[]; count: number };

function sharedWith(own: { names: string[]; count: number }): string {
    return own.names.length === own.count
        ? joinFirstNames(own.names)
        : `${own.count} Desk Lamp${own.count === 1 ? '' : 's'}`;
}

export function ownDeskLampLine(own: OwnDeskLamp): string {
    switch (own.kind) {
        case 'no_session': return 'Your lamp is off. Start a session to light it.';
        case 'not_shared': return 'Your lamp is off for this session.';
        case 'sharing_paused': return 'Your lamp is off while sharing is paused.';
        case 'lighting': return `Lighting your lamp for ${sharedWith(own)}…`;
        case 'refused': return `Your lamp isn't lit: ${own.reason}`;
        case 'on': return own.state === 'break'
            ? `${sharedWith(own)} ${own.count === 1 ? 'sees' : 'see'} you on a break.`
            : `Your lamp is lit for ${sharedWith(own)}.`;
    }
}

/** The running session panel's line: "Lamp lit for Maya and Priya". */
export function sessionDeskLampLine(own: OwnDeskLamp): string | null {
    switch (own.kind) {
        case 'no_session': return null;
        case 'not_shared': return 'Lamp off';
        case 'sharing_paused': return 'Lamp off while sharing is paused';
        case 'lighting': return `Lighting lamp for ${sharedWith(own)}…`;
        case 'refused': return `Lamp not lit: ${own.reason}`;
        case 'on': return `Lamp lit for ${sharedWith(own)}`;
    }
}

function invitesWaitingLine(count: number): string {
    return count === 1 ? '1 Desk Lamp invite waiting' : `${count} Desk Lamp invites waiting`;
}

export interface DeskLampsView {
    /** Connected, the toggle on, and at least one Desk Lamp or invite (D14). */
    visible: boolean;
    /** The last successful check; kept through a failure so the lamp list survives a blip. */
    answer: DeskLampsAnswer | null;
    /** Why the last check failed, when it did. */
    error: string | null;
    bulletins: readonly DeskLampBulletin[];
    own: OwnDeskLamp;
}

export function deskLampsTooltip(view: DeskLampsView): string {
    if (view.error) return `Desk Lamps: couldn't check (${view.error}).`;
    const lit = litDeskLampCount(view.answer);
    const notes = [lit === 0 ? 'nobody at their desk' : lit === 1 ? '1 friend at their desk' : `${lit} friends at their desks`];
    const invites = view.answer?.invites_received ?? 0; // SAFE: before the first answer no invite is known
    if (invites > 0) notes.push(invitesWaitingLine(invites));
    return `Desk Lamps: ${notes.join(' · ')}`;
}

function profileUrl(handle: string): string {
    return `${COMMUNITY_SITE_URL}/authors/${encodeURIComponent(handle)}`;
}

/** Paint one title-bar lamp from the shared state. */
export function paintDeskLampButton(button: HTMLElement, badgeEl: HTMLElement, view: DeskLampsView): void {
    button.hidden = !view.visible;
    if (!view.visible) return;
    const count = view.error ? 0 : litDeskLampCount(view.answer);
    badgeEl.hidden = count === 0;
    badgeEl.setText(count > 99 ? '99+' : String(count));
    button.classList.toggle('is-stale', view.error !== null);
    const label = deskLampsTooltip(view);
    button.setAttribute('aria-label', label);
    applyTooltip(button, label, 'bottom');
}

function openUrl(url: string): void {
    window.open(url, '_blank');
}

/**
 * The living list, just below the lamp: up to 12 rows (all of them after
 * "N more at their desks"), then your own lamp, invites waiting, and
 * "Manage Desk Lamps…". A row opens that friend's Community profile.
 */
export function openDeskLampsMenu(anchor: HTMLElement, deskLamps: DeskLamps, showAll = false): void {
    const doc = anchor.ownerDocument;
    const view = deskLamps.view();
    const now = Date.now();
    const menu = new Menu();
    if (view.error) {
        menu.addItem(item => item.setTitle(`Couldn't check Desk Lamps: ${view.error}`).setIcon('circle-alert').setDisabled(true));
    } else {
        const list = deskLampList(view.answer?.lit ?? [], view.bulletins, now, showAll ? Number.POSITIVE_INFINITY : DESK_LAMP_MAX_ROWS); // SAFE: before the first answer no lamp is known
        if (list.rows.length === 0) {
            menu.addItem(item => item.setTitle('No Desk Lamps lit right now').setIcon('lamp').setDisabled(true));
        }
        for (const row of list.rows) {
            const off = row.kind === 'bulletin';
            const onBreak = row.kind === 'lamp' && row.lamp.state === 'break';
            const handle = row.kind === 'lamp' ? row.lamp.handle : row.bulletin.handle;
            menu.addItem(item => {
                const title = doc.win.createFragment();
                const text = title.createSpan({ cls: 'ert-desk-lamps-row', text: deskLampRowLabel(row, now) });
                text.classList.toggle('is-break', onBreak);
                text.classList.toggle('is-off', off);
                item.setTitle(title)
                    .setIcon(off ? 'lamp' : onBreak ? 'pause' : 'lamp-desk')
                    .onClick(() => openUrl(profileUrl(handle)));
            });
        }
        if (list.hiddenLamps > 0) {
            menu.addItem(item => item
                .setTitle(`${list.hiddenLamps} more at their desks`)
                .setIcon('chevrons-down')
                // The menu closes on click; reopen in place with every row.
                .onClick(() => { window.setTimeout(() => openDeskLampsMenu(anchor, deskLamps, true), 0); }));
        }
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle(ownDeskLampLine(view.own)).setIcon('lamp-desk').setDisabled(true));
    const invites = view.answer?.invites_received ?? 0; // SAFE: before the first answer no invite is known
    if (invites > 0) {
        menu.addItem(item => item.setTitle(invitesWaitingLine(invites)).setIcon('mail-plus').onClick(() => openUrl(COMMUNITY_DESK_LAMPS_URL)));
    }
    menu.addItem(item => item.setTitle('Manage Desk Lamps…').setIcon('users').onClick(() => openUrl(COMMUNITY_DESK_LAMPS_URL)));
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, doc);
}

/**
 * The running session's "who sees my lamp" menu: one checkable row per Desk
 * Lamp, and "Turn lamp off" while it is on. Ticking a friend lights the lamp
 * for this session; unticking the last one turns it off.
 */
export function openSessionDeskLampMenu(anchor: HTMLElement, deskLamps: DeskLamps): void {
    const doc = anchor.ownerDocument;
    const chosen = new Set(deskLamps.sessionAudience());
    const menu = new Menu();
    for (const friend of deskLamps.panelFriends()) {
        menu.addItem(item => item
            .setTitle(friend.display_name)
            .setChecked(chosen.has(friend.profile_id))
            .onClick(() => {
                const next = chosen.has(friend.profile_id)
                    ? [...chosen].filter(id => id !== friend.profile_id)
                    : [...chosen, friend.profile_id];
                void deskLamps.setSessionAudience(next);
            }));
    }
    if (chosen.size > 0) {
        menu.addSeparator();
        menu.addItem(item => item.setTitle('Turn lamp off').setIcon('lamp').onClick(() => { void deskLamps.setSessionAudience([]); }));
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, doc);
}

// ---------------------------------------------------------------------------
// 3. The one plugin-wide DeskLamps
// ---------------------------------------------------------------------------

/** What this vault's lamp should be right now: the lamp to send, or off and why. */
type LampState =
    | { on: true; light: DeskLampLight; signature: string; audience: string[] }
    | { on: false; reason: 'disabled' | 'no_session' | 'not_shared' | 'sharing_paused' };

export class DeskLamps {
    private answer: DeskLampsAnswer | null = null;
    private error: string | null = null;
    /** The last successful check's lamps, for bulletins. */
    private previous: { lit: LitDeskLamp[]; at: number } | null = null;
    private bulletins: DeskLampBulletin[] = [];
    /** The connection Desk Lamps belongs to; null = not connected. */
    private connectionKey: string | null;
    private enabled: boolean;
    /** Bumped whenever the connection changes, so an older answer is dropped. */
    private generation = 0;
    private busy = false;
    /** The lamp a call in flight is sending (its signature); null while only reading. */
    private inFlightSignature: string | null = null;
    /** A change arrived while a call was out: check again when it lands. */
    private pending = false;
    /** The lamp the server holds for this connection as last confirmed: 'off' or the lamp's signature. */
    private sentSignature = OFF;
    private lastAttemptAt = 0;
    private timer: number | null = null;
    private destroyed = false;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly plugin: RadialTimelinePlugin) {
        this.connectionKey = this.currentKey();
        this.enabled = this.plugin.settings.showDeskLamps !== false;
        // A session shared before a reload is still open: relight it at once
        // (unload turned it off), without waiting for a timeline view.
        if (this.lampState().on) void this.check();
    }

    view(): DeskLampsView {
        const answer = this.answer;
        return {
            visible: this.connectionKey !== null && this.enabled && answer !== null
                && (answer.lamps.length > 0 || answer.invites_received > 0),
            answer,
            error: this.error,
            bulletins: this.bulletins,
            own: this.ownLamp()
        };
    }

    /**
     * The accepted Desk Lamps for the session panel: the friends ticked last
     * time first (most recently shared with), then the rest by name. Empty
     * when not connected or turned off here.
     */
    panelFriends(): DeskLampFriend[] {
        if (!this.canRead()) return [];
        const rank = new Map(this.choices().audience.map((id, index) => [id, index]));
        const last = Number.MAX_SAFE_INTEGER;
        return [...this.friends()].sort((a, b) =>
            (rank.get(a.profile_id) ?? last) - (rank.get(b.profile_id) ?? last)
            || a.display_name.localeCompare(b.display_name));
    }

    /** The running session panel's line ("Lamp lit for Maya and Priya"); null with no Desk Lamp to share with. */
    sessionLine(): string | null {
        if (!this.canRead() || this.friends().length === 0) return null;
        return sessionDeskLampLine(this.ownLamp());
    }

    /** The last choice, to pre-tick the Begin Session panel (D5). */
    rememberedAudience(): string[] {
        return this.choices().audience;
    }

    /** Who the open session is shared with; empty when its lamp is off. */
    sessionAudience(): string[] {
        const session = this.plugin.getWritingSessionService().getActiveSession();
        const choices = this.choices();
        return session && choices.activeSessionId === session.id ? choices.audience : [];
    }

    /** Begin Session: remember the choice and light the lamp for this session if anyone is ticked. */
    async shareSession(sessionId: string, audience: readonly string[]): Promise<void> {
        await this.writeChoices(audience, audience.length > 0 ? sessionId : undefined);
    }

    /** The running panel changed who sees the lamp; an empty list turns it off. */
    async setSessionAudience(audience: readonly string[]): Promise<void> {
        const session = this.plugin.getWritingSessionService().getActiveSession();
        if (!session) return;
        await this.writeChoices(audience, audience.length > 0 ? session.id : undefined);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        if (this.listeners.size === 1 && this.canRead() && this.timer === null && !this.busy) {
            if (Date.now() - this.lastAttemptAt < WAKE_REFETCH_GAP_MS) this.armTimer();
            else void this.check();
        }
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0 && !this.busy) this.armTimer();
        };
    }

    /**
     * Settings were saved: a session started, paused, resumed, saved or was
     * discarded, the lamp's audience changed, sharing paused or resumed, the
     * toggle moved, or the connection changed. Cheap when nothing that
     * matters changed: the lamp is re-projected and sent only if it differs.
     */
    settingsChanged(): void {
        if (this.destroyed) return;
        const key = this.currentKey();
        if (key !== this.connectionKey) {
            // A lamp on the old connection ends with it: the server hides and
            // sweeps lamps of connections that are no longer active.
            this.connectionKey = key;
            this.generation++;
            this.answer = null;
            this.error = null;
            this.previous = null;
            this.bulletins = [];
            this.sentSignature = OFF;
            this.clearTimer();
            this.emit();
            if (this.listeners.size > 0 || this.lampState().on) void this.check();
            return;
        }
        const enabled = this.plugin.settings.showDeskLamps !== false;
        if (enabled !== this.enabled) {
            this.enabled = enabled;
            this.clearTimer();
            this.emit();
            // On: read at once. Off: the check turns a lit lamp off, then stops.
            void this.check();
            return;
        }
        const expected = this.inFlightSignature ?? this.sentSignature;
        if (this.desiredSignature() !== expected) void this.check();
    }

    /** A timeline window regained focus or became visible. */
    onWake(): void {
        if (this.destroyed || !this.canRead() || this.listeners.size === 0) return;
        if (Date.now() - this.lastAttemptAt < WAKE_REFETCH_GAP_MS) return;
        void this.check();
    }

    /** Plugin unload: turn a lit lamp off, best effort. If it never lands, the server's 5-minute rule ends the lamp. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.clearTimer();
        this.listeners.clear();
        if (this.connectionKey !== null && (this.sentSignature !== OFF || this.inFlightSignature !== null)) {
            void syncDeskLamps(this.plugin, null).catch(() => undefined); // SAFE: best-effort unload; the server sweeps a lamp 5 minutes after its last refresh
        }
    }

    private currentKey(): string | null {
        const share = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        if (!hasCommunityConnection(share) || !share.connection.profileId) return null;
        return `${share.connection.connectionId}|${share.connection.secretId}|${share.connection.profileId}`;
    }

    private canRead(): boolean {
        return this.connectionKey !== null && this.enabled;
    }

    /** The accepted Desk Lamps from the last answer; none are known before the first. */
    private friends(): DeskLampFriend[] {
        return this.answer ? this.answer.lamps : [];
    }

    private choices(): { audience: string[]; activeSessionId?: string } {
        return deskLampChoices(normalizeCommunityShareSettings(this.plugin.settings.communityShare));
    }

    private async writeChoices(audience: readonly string[], activeSessionId: string | undefined): Promise<void> {
        const share = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        const profileId = share.connection.profileId;
        if (!hasCommunityConnection(share) || !profileId) return;
        this.plugin.settings.communityShare = normalizeCommunityShareSettings({
            ...share,
            deskLamps: { profileId, audience: [...audience], activeSessionId }
        });
        await this.plugin.saveSettings();
    }

    /** The one derivation of this vault's lamp: what is sent, and what the panel and popover say. */
    private lampState(): LampState {
        if (!this.canRead()) return { on: false, reason: 'disabled' };
        const session = this.plugin.getWritingSessionService().getActiveSession();
        if (!session) return { on: false, reason: 'no_session' };
        const share = normalizeCommunityShareSettings(this.plugin.settings.communityShare);
        const choices = deskLampChoices(share);
        if (choices.activeSessionId !== session.id || choices.audience.length === 0) return { on: false, reason: 'not_shared' };
        if (share.sharingPaused) return { on: false, reason: 'sharing_paused' };
        // An unreadable session start sends no lamp (projectDeskLampLight).
        const light = projectDeskLampLight(session, choices.audience);
        if (!light) return { on: false, reason: 'not_shared' };
        return { on: true, light, signature: JSON.stringify(light), audience: choices.audience };
    }

    private desiredSignature(): string {
        const state = this.lampState();
        return state.on ? state.signature : OFF;
    }

    /** The server holds a lamp, or should: refresh every minute, whatever view shows. */
    private lampOn(): boolean {
        return this.desiredSignature() !== OFF || this.sentSignature !== OFF;
    }

    private ownLamp(): OwnDeskLamp {
        const state = this.lampState();
        if (!state.on) return { kind: state.reason === 'disabled' ? 'not_shared' : state.reason };
        // Before the first answer the names are unknown; after it, only accepted
        // Desk Lamps count (the server trims the audience to them).
        const chosen = new Set(state.audience);
        const names = this.friends().filter(friend => chosen.has(friend.profile_id)).map(friend => friend.display_name);
        const count = this.answer ? names.length : state.audience.length;
        if (count === 0) return { kind: 'not_shared' };
        if (this.sentSignature === state.signature) return { kind: 'on', state: state.light.state, names, count };
        if (!this.busy && this.error) return { kind: 'refused', reason: this.error };
        return { kind: 'lighting', names, count };
    }

    private async check(): Promise<void> {
        if (this.destroyed || this.connectionKey === null) return;
        if (this.busy) {
            this.pending = true;
            return;
        }
        const state = this.lampState();
        const signature = state.on ? state.signature : OFF;
        // Send when the lamp should be on, or to turn off one the server holds;
        // otherwise only read, and not at all while turned off here.
        const send = state.on || this.sentSignature !== OFF;
        if (!send && !this.enabled) return;
        const generation = this.generation;
        this.busy = true;
        this.inFlightSignature = send ? signature : null;
        this.lastAttemptAt = Date.now();
        this.clearTimer();
        let answer: DeskLampsAnswer | null = null;
        let error: string | null = null;
        try {
            answer = await syncDeskLamps(this.plugin, send ? (state.on ? state.light : null) : undefined);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
        this.busy = false;
        this.inFlightSignature = null;
        if (this.destroyed) return;
        // The connection changed while this was out: settingsChanged already
        // asked for a fresh check (pending), and this answer belongs to no one.
        const current = generation === this.generation;
        if (current) {
            if (answer) {
                if (send) this.sentSignature = signature;
                const now = Date.now();
                this.bulletins = nextDeskLampBulletins(this.previous, answer.lit, this.bulletins, now);
                this.previous = { lit: answer.lit, at: now };
                this.answer = answer;
            }
            this.error = error;
            this.emit();
        }
        if (this.pending) {
            this.pending = false;
            void this.check();
            return;
        }
        if (current) this.armTimer();
    }

    private armTimer(): void {
        this.clearTimer();
        if (this.destroyed || this.connectionKey === null) return;
        let delay: number;
        if (this.lampOn()) delay = LAMP_REFRESH_MS;
        else if (!this.enabled || this.listeners.size === 0) return;
        else if (this.friends().length > 0) delay = LAMP_REFRESH_MS;
        else delay = IDLE_POLL_MS + Math.random() * JITTER_MS;
        this.timer = window.setTimeout(() => {
            this.timer = null;
            this.tick();
        }, delay);
    }

    private tick(): void {
        // With the lamp off, the minute reads run only while you're looking.
        if (!this.lampOn() && this.friends().length > 0 && !activeDocument.hasFocus()) {
            this.armTimer();
            return;
        }
        void this.check();
    }

    private clearTimer(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    private emit(): void {
        this.listeners.forEach(listener => listener());
    }
}
