/*
 * Radial Timeline — Writing Session Log Projections
 *
 * Single sanctioned exit point for session data leaving the author's device
 * to any audience. Read `docs/engineering/standards/writing-session-privacy.md`
 * BEFORE changing any function in this file. Privacy guarantees are enforced
 * by `WritingSessionLog.privacy.test.ts` (tracer test).
 *
 * Contract:
 *   - projectPrivate(record):          full row, this device only
 *   - projectFriends(record, opts):    per-session row, sensitive fields stripped
 *   - projectCommunityDaily(rows[]):   daily aggregate, NEVER per-session
 *   - buildCommunityHourModeMix(...):  28-day hour x mode minutes rollup,
 *     NEVER per-session and NEVER dated — only a recurring local-hour habit
 *     shape, aggregated across the trailing window.
 *   - projectSessionFeedPost(record):  author-composed public feed post — the
 *     ONLY exit that may carry `note`, and only because the author explicitly
 *     armed the per-save "post to community feed" toggle at the top sharing
 *     level. It is an authored post (equivalent to typing on the website
 *     feed), not data exhaust.
 *
 * NEVER emitted to friends or community at any tier:
 *   - scenePaths
 *   - scenesCompletedPaths
 *   - scenesActivity (per-scene time/words — contains scene paths)
 *   - note (EXCEPT via projectSessionFeedPost under the explicit per-save toggle)
 *   - raw scene titles
 *
 * Adding a field to WritingSessionRecord requires:
 *   1. Decide its tier (private / opt-in / social).
 *   2. Update this file.
 *   3. Add a tracer string for the field to the privacy test.
 */

import type {
    WritingSessionMode,
    WritingSessionRecord,
    WritingSessionStage,
} from '../types/settings';
import { STAGE_ORDER } from '../utils/constants';

export type SessionLogAudience = 'private' | 'friends' | 'community';

// -- Shared canonical row that survives all rendering ------------------------

/**
 * Canonical "what happened in this session" row, derived from a record.
 * The `private` projection returns this shape verbatim. The `friends`
 * projection strips/reshapes it. Community never produces this — it
 * aggregates to a daily row.
 */
export interface PrivateSessionLogRow {
    audience: 'private';
    id: string;
    endedAt: string;                 // minute precision
    startedAt: string;
    /**
     * Author's chosen attribution day (YYYY-MM-DD, local). When present, the
     * day label in the UI should prefer this over `endedAt` so a session
     * deliberately backdated via the completion modal renders on the day the
     * author meant it to. Falls back to the day-portion of `endedAt`.
     */
    sessionDate?: string;
    durationMs: number;
    mode: WritingSessionMode;
    stage?: WritingSessionStage;
    bookId?: string;
    bookTitle?: string;
    wordsAdded?: number;
    pagesEdited?: number;
    scenesCompletedCount: number;
    scenesTouchedCount: number;
    /** PRIVATE. Vault paths of touched scenes. */
    scenePaths: string[];
    /** PRIVATE. Vault paths of scenes that completed during the session. */
    scenesCompletedPaths: string[];
    /** PRIVATE. Free-form author note. */
    note?: string;
}

export interface FriendsSessionLogRow {
    audience: 'friends';
    /** Stable id for client-side dedupe. Hashed at upload time server-side; here it is the raw record id, but the friends row is only ever emitted via projectFriends so the boundary is clean. */
    id: string;
    /** Hour precision. */
    date: string;
    durationMin: number;
    mode: WritingSessionMode;
    stage?: WritingSessionStage;
    wordsAdded?: number;
    pagesEdited?: number;
    scenesCompletedCount: number;
    scenesTouchedCount: number;
    /** Present only when the author has opted in for this book. */
    bookTitle?: string;
}

export interface CommunityDailyRow {
    audience: 'community';
    /** Day precision. */
    date: string;
    minutesTotal: number;
    sessionCount: number;
    /** Rounded to nearest 50 to coarsen specificity. */
    wordsAdded: number;
    scenesCompletedByStage: Record<WritingSessionStage, number>;
    /**
     * Mode mix as a fraction of total minutes (0..1). Sums to 1 when
     * minutesTotal > 0, otherwise all zeros.
     */
    modeMix: Record<WritingSessionMode, number>;
}

export interface FriendsProjectionOptions {
    /** Per-book opt-in for emitting bookTitle. False by default. */
    shareBookTitle?: boolean;
}

// -- Time precision (privacy axis, not a binary flag) ------------------------

export function redactTime(iso: string | undefined, audience: SessionLogAudience): string {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    if (audience === 'private') {
        // Minute precision: zero seconds and ms.
        parsed.setUTCSeconds(0, 0);
        return parsed.toISOString();
    }
    if (audience === 'friends') {
        parsed.setUTCMinutes(0, 0, 0);
        return parsed.toISOString();
    }
    // community: day precision (YYYY-MM-DD)
    return parsed.toISOString().slice(0, 10);
}

// -- Projections -------------------------------------------------------------

const ALL_STAGES: WritingSessionStage[] = [...STAGE_ORDER, 'Mixed'];
const ALL_MODES: WritingSessionMode[] = ['drafting', 'revising', 'editing', 'planning'];

function zeroStageCounts(): Record<WritingSessionStage, number> {
    return ALL_STAGES.reduce<Record<WritingSessionStage, number>>((acc, stage) => {
        acc[stage] = 0;
        return acc;
    }, {} as Record<WritingSessionStage, number>);
}

function zeroModeMix(): Record<WritingSessionMode, number> {
    return ALL_MODES.reduce<Record<WritingSessionMode, number>>((acc, mode) => {
        acc[mode] = 0;
        return acc;
    }, {} as Record<WritingSessionMode, number>);
}

function roundToNearest(value: number, step: number): number {
    if (step <= 0) return Math.round(value);
    return Math.round(value / step) * step;
}

export function projectPrivate(record: WritingSessionRecord): PrivateSessionLogRow {
    return {
        audience: 'private',
        id: record.id,
        endedAt: redactTime(record.endedAt, 'private'),
        startedAt: redactTime(record.startedAt, 'private'),
        sessionDate: record.sessionDate,
        durationMs: Math.max(0, record.elapsedMs ?? 0),
        mode: record.mode,
        stage: record.stage,
        bookId: record.bookId,
        bookTitle: record.bookTitle,
        wordsAdded: record.wordsAdded,
        pagesEdited: record.pagesEdited,
        scenesCompletedCount: record.scenesCompletedPaths?.length
            ?? record.scenesCompleted
            ?? 0,
        scenesTouchedCount: record.scenePaths?.length ?? 0,
        scenePaths: [...(record.scenePaths ?? [])],
        scenesCompletedPaths: [...(record.scenesCompletedPaths ?? [])],
        note: record.note,
    };
}

export function projectFriends(
    record: WritingSessionRecord,
    options: FriendsProjectionOptions = {},
): FriendsSessionLogRow {
    return {
        audience: 'friends',
        id: record.id,
        date: redactTime(record.endedAt, 'friends'),
        durationMin: Math.max(0, Math.round((record.elapsedMs ?? 0) / 60000)),
        mode: record.mode,
        stage: record.stage,
        wordsAdded: record.wordsAdded,
        pagesEdited: record.pagesEdited,
        scenesCompletedCount: record.scenesCompletedPaths?.length
            ?? record.scenesCompleted
            ?? 0,
        scenesTouchedCount: record.scenePaths?.length ?? 0,
        bookTitle: options.shareBookTitle ? record.bookTitle : undefined,
        // INTENTIONALLY ABSENT: scenePaths, scenesCompletedPaths, note,
        // raw startedAt, raw endedAt, bookId.
    };
}

/**
 * Roll a set of records into a single daily community row. Caller is
 * responsible for grouping by day; this function aggregates one day at a
 * time. NEVER returns per-session detail.
 */
export function projectCommunityDaily(
    date: string,
    records: WritingSessionRecord[],
): CommunityDailyRow {
    const dayPrecision = redactTime(`${date}T00:00:00Z`, 'community');
    const stageCounts = zeroStageCounts();
    const modeMinutes = zeroModeMix();
    let totalMinutes = 0;
    let totalWords = 0;

    for (const record of records) {
        const minutes = Math.max(0, Math.round((record.elapsedMs ?? 0) / 60000)); // SAFE: elapsedMs is optional on a session record; an unmeasured session contributes 0 minutes
        totalMinutes += minutes;
        modeMinutes[record.mode] += minutes;
        totalWords += Math.max(0, record.wordsAdded ?? 0);
        const completedCount = record.scenesCompletedPaths?.length
            ?? record.scenesCompleted
            ?? 0;
        if (completedCount > 0 && record.stage) {
            stageCounts[record.stage] += completedCount;
        }
    }

    const modeMix = zeroModeMix();
    if (totalMinutes > 0) {
        for (const mode of ALL_MODES) {
            modeMix[mode] = modeMinutes[mode] / totalMinutes;
        }
    }

    return {
        audience: 'community',
        date: dayPrecision,
        minutesTotal: totalMinutes,
        sessionCount: records.length,
        wordsAdded: roundToNearest(totalWords, 50),
        scenesCompletedByStage: stageCounts,
        modeMix,
    };
}

// -- Session feed post (author-composed, explicit per-save opt-in) -----------

/** Server-enforced community_posts body length limits. */
export const SESSION_FEED_POST_BODY_MAX = 1000;
export const SESSION_FEED_POST_BODY_MIN = 3;

export interface SessionFeedPost {
    audience: 'community';
    /** Post text: stats headline plus the author's note. Never paths or raw titles. */
    body: string;
    /** Structured stats mirrored into post metadata for feed rendering. */
    stats: {
        minutes: number;
        words?: number;
        mode: WritingSessionMode;
    };
}

const FEED_MODE_LABELS: Record<WritingSessionMode, string> = {
    drafting: 'Drafting',
    revising: 'Revision',
    editing: 'Line edit',
    planning: 'Planning',
};

/**
 * Author-composed public feed post for one saved session. This is a sanctioned
 * `note` exit — callable ONLY when the author armed the per-save "post to
 * community feed" toggle; callers must gate on that toggle plus the top
 * sharing level. Deliberately excludes bookId/bookTitle (the server snapshots
 * the PUBLIC project title), scene paths, scene titles, and exact timestamps.
 */
export function projectSessionFeedPost(record: WritingSessionRecord): SessionFeedPost {
    const minutes = Math.max(1, Math.round((record.elapsedMs ?? 0) / 60000)); // SAFE: elapsedMs is optional; the Math.max(1) floor keeps a logged session from reading as zero-length
    const words = record.mode === 'drafting' || (record.wordsAdded ?? 0) > 0 // SAFE: wordsAdded is optional; no recorded delta reads as no words added
        ? Math.max(0, record.wordsAdded ?? 0) || undefined // SAFE: wordsAdded is optional, and a zero delta is omitted from the log line entirely
        : undefined;
    const headline = [
        FEED_MODE_LABELS[record.mode],
        `${minutes} min`,
        words ? `${words} words` : undefined,
    ].filter(Boolean).join(' · ');
    const note = record.note?.trim();
    const body = note
        ? `${headline}\n\n${note}`.slice(0, SESSION_FEED_POST_BODY_MAX)
        : headline.slice(0, SESSION_FEED_POST_BODY_MAX);
    return {
        audience: 'community',
        body,
        stats: { minutes, words, mode: record.mode },
    };
}

// -- Window helpers (used by service surfaces) -------------------------------

export interface SessionLogWindow {
    /** Inclusive endDate (YYYY-MM-DD). Defaults to today (caller-supplied). */
    endDate: string;
    /** Number of days back from endDate to include, inclusive. */
    days: number;
}

/**
 * Effective attribution day for a record (YYYY-MM-DD). Prefers the author's
 * `sessionDate` choice; falls back to the LOCAL day of `endedAt`. Never UTC
 * day — a session saved at 6pm Pacific is "today" for the author even though
 * UTC has rolled to tomorrow. All window / grouping logic must use this.
 */
function effectiveDayFor(record: WritingSessionRecord): string {
    if (record.sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(record.sessionDate)) {
        return record.sessionDate;
    }
    const parsed = new Date(record.endedAt);
    if (Number.isNaN(parsed.getTime())) return '';
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Add `delta` calendar days to a YYYY-MM-DD string (local-day arithmetic). */
function addDays(yyyymmdd: string, delta: number): string {
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + delta);
    const y2 = date.getFullYear();
    const m2 = String(date.getMonth() + 1).padStart(2, '0');
    const d2 = String(date.getDate()).padStart(2, '0');
    return `${y2}-${m2}-${d2}`;
}

export function filterRecordsForWindow(
    records: WritingSessionRecord[],
    window: SessionLogWindow,
): WritingSessionRecord[] {
    const end = window.endDate;
    if (!end) return [];
    const start = addDays(end, -(Math.max(1, window.days) - 1));
    return records.filter(record => {
        const day = effectiveDayFor(record);
        return Boolean(day) && day >= start && day <= end;
    });
}

/**
 * Private-audience session log for a window, newest first. The renderer is
 * the only intended consumer.
 */
export function buildPrivateSessionLog(params: {
    records: WritingSessionRecord[];
    window: SessionLogWindow;
    limit?: number;
}): PrivateSessionLogRow[] {
    const filtered = filterRecordsForWindow(params.records, params.window)
        .slice()
        .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    const sliced = typeof params.limit === 'number' ? filtered.slice(0, params.limit) : filtered;
    return sliced.map(projectPrivate);
}

/**
 * Community-audience daily aggregate log for a window. One row per day with
 * at least one session. NEVER per-session.
 */
export function buildCommunityDailyLog(params: {
    records: WritingSessionRecord[];
    window: SessionLogWindow;
}): CommunityDailyRow[] {
    const filtered = filterRecordsForWindow(params.records, params.window);
    const byDay = new Map<string, WritingSessionRecord[]>();
    for (const record of filtered) {
        // Group by the SAME effective day the window filter uses, so window
        // membership and grouping never disagree (would otherwise produce
        // empty days or orphaned records).
        const day = effectiveDayFor(record);
        if (!day) continue;
        const bucket = byDay.get(day);
        if (bucket) bucket.push(record);
        else byDay.set(day, [record]);
    }
    return [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, dayRecords]) => projectCommunityDaily(day, dayRecords));
}

// -- Community hour x mode rollup (trailing window, no date) -----------------

/** Trailing window for the hour x mode community rollup, inclusive of today. */
export const COMMUNITY_HOUR_MODE_MIX_WINDOW_DAYS = 28;

/** Minutes per folded mode for one local hour bucket (0-23). */
export interface CommunityHourModeMinutes {
    drafting: number;
    revising: number;
    planning: number;
}

type HourModeKey = 'drafting' | 'revising' | 'planning';

function zeroHourModeMinutes(): CommunityHourModeMinutes {
    return { drafting: 0, revising: 0, planning: 0 };
}

/**
 * Folds a session's mode into one of the three hour-dial buckets. `editing`
 * folds into `revising` (line-edit time reads as revision on the dial); any
 * other/unrecognized mode value is dropped rather than guessed at.
 */
function foldHourMode(mode: WritingSessionMode): HourModeKey | undefined {
    if (mode === 'editing') return 'revising';
    if (mode === 'drafting' || mode === 'revising' || mode === 'planning') return mode;
    return undefined;
}

/**
 * Trailing-28-day (inclusive of today) rollup of session minutes bucketed by
 * the session's LOCAL wall-clock start hour (0-23 as a string key). "Local"
 * means this device's own timezone at read time — no timezone conversion —
 * because the community dial aggregates every writer's own local hour, not a
 * shared clock. Each session's full minutes attribute to its start hour only
 * (no splitting across hour boundaries). Hours with zero total activity are
 * omitted entirely. Aggregate-only and undated, like `projectCommunityDaily`:
 * NEVER per-session, no scene paths, no notes, no book identity, no calendar
 * date — only a recurring hour-of-day shape.
 */
export function buildCommunityHourModeMix(params: {
    records: WritingSessionRecord[];
    endDate: string;
}): Record<string, CommunityHourModeMinutes> {
    const filtered = filterRecordsForWindow(params.records, {
        endDate: params.endDate,
        days: COMMUNITY_HOUR_MODE_MIX_WINDOW_DAYS,
    });
    const byHour = new Map<number, CommunityHourModeMinutes>();
    for (const record of filtered) {
        const started = new Date(record.startedAt);
        if (Number.isNaN(started.getTime())) continue;
        const minutes = Math.max(0, Math.round((record.elapsedMs ?? 0) / 60000)); // SAFE: elapsedMs is optional on a session record; an unmeasured session contributes 0 minutes
        if (minutes <= 0) continue;
        const modeKey = foldHourMode(record.mode);
        if (!modeKey) continue;
        const hour = started.getHours();
        const bucket = byHour.get(hour) ?? zeroHourModeMinutes();
        bucket[modeKey] += minutes;
        byHour.set(hour, bucket);
    }
    const out: Record<string, CommunityHourModeMinutes> = {};
    [...byHour.keys()].sort((a, b) => a - b).forEach(hour => {
        out[String(hour)] = byHour.get(hour) as CommunityHourModeMinutes;
    });
    return out;
}
