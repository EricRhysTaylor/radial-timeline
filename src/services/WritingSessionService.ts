import { Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import type {
    ActiveWritingSession,
    SceneActivityRecord,
    WritingSessionMode,
    WritingSessionRecord,
    WritingSessionStage,
    WritingSessionStagePreference,
    WritingSessionTargetMode,
    WritingSessionsSettings
} from '../types/settings';
import { STAGE_ORDER } from '../utils/constants';
import { getActiveBook, isSceneInBook } from '../utils/books';
import { isCompleteStatus, normalizePublishStage } from '../progress/progressSnapshot';
import { getRuntimeSettings } from '../utils/runtimeEstimator';
import { normalizeStatus } from '../utils/text';
import { buildPrivateSessionLog, type PrivateSessionLogRow } from './WritingSessionLog';
import { countWords, extractBodyText } from '../utils/manuscript';
import { RT_SYSTEM_FOLDER } from '../utils/systemFolder';

const MAX_SESSION_RECORDS = 500;

/**
 * Bumped whenever the persisted writing-session data shape changes in a way
 * that future plugin releases or the companion website must migrate. Stamped
 * onto settings and the portable vault export so the author's data stays
 * forward-readable even after they stop using this plugin.
 */
export const WRITING_SESSIONS_SCHEMA_VERSION = 6;

/** Auto-track: default idle gap before a running session auto-pauses. */
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
/** Auto-track: hard bounds for a user-configured idle timeout. */
const MIN_IDLE_TIMEOUT_MS = 30 * 1000;
const MAX_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * If a running session goes this long without a heartbeat it is assumed the
 * app was closed/crashed and the dead time is not real writing time. Elapsed
 * time is frozen at the last heartbeat instead of counting the gap.
 */
const ACTIVE_SESSION_STALE_MS = 5 * 60 * 1000;

/** Minimum spacing between heartbeat writes so we don't save every tick. */
const HEARTBEAT_PERSIST_MS = 30 * 1000;

/**
 * Author-owned, plain-JSON copy of every session, written into the vault so
 * the data is portable, human-visible, survives the 500-record settings cap,
 * and stays with the author if they uninstall the plugin. Local only — never
 * uploaded.
 */
const PORTABLE_LOG_FOLDER = RT_SYSTEM_FOLDER;
const PORTABLE_LOG_PATH = `${PORTABLE_LOG_FOLDER}/Writing Sessions.json`;

export type PortableSessionLogRead =
    | { kind: 'ok'; records: WritingSessionRecord[] }
    | { kind: 'unreadable'; reason: string };

/**
 * Parse the author-owned session archive. Returns `unreadable` rather than an
 * empty record set so the caller can tell "no history yet" apart from "the
 * history is there but damaged" — the two need opposite write behaviour.
 */
export function parsePortableSessionLog(text: string): PortableSessionLogRead {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return { kind: 'unreadable', reason: error instanceof Error ? error.message : 'invalid JSON' };
    }
    const records = (parsed as { records?: unknown } | null)?.records;
    if (!Array.isArray(records)) {
        return { kind: 'unreadable', reason: 'no "records" array' };
    }
    const valid: WritingSessionRecord[] = [];
    for (const raw of records) {
        const rec = raw as WritingSessionRecord;
        if (rec?.id && rec.startedAt && rec.endedAt) valid.push(rec);
    }
    return { kind: 'ok', records: valid };
}

/** Dated quarantine path for an archive that could not be parsed. */
export function buildCorruptSessionLogPath(when: Date): string {
    const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
    return `${PORTABLE_LOG_FOLDER}/Writing Sessions.corrupt-${stamp}.json`;
}

type Stage = typeof STAGE_ORDER[number];

export interface WritingSessionCompletionInput {
    elapsedMs?: number;
    sessionDate?: string;
    wordsAdded?: number;
    typedWords?: number;
    netWordDelta?: number;
    scenesCompleted?: number;
    scenePaths?: string[];
    scenesCompletedPaths?: string[];
    pagesEdited?: number;
    note?: string;
}

export interface WritingSessionStartOptions {
    mode?: WritingSessionMode;
    stage?: WritingSessionStagePreference;
    goalMinutes?: number;
    goalWords?: number;
    targetMode?: WritingSessionTargetMode;
}

export interface WritingSessionSceneSuggestion {
    path: string;
    title?: string;
    stage?: WritingSessionStage;
    status?: string;
    reason: 'active' | 'open' | 'working' | 'modified';
}

export interface SceneCompletionEvent {
    date: string;
    stage: Stage;
    workKind: 'fresh' | 'revision';
    revisionRound: Stage;
    sceneId?: string;
    path?: string;
    title?: string;
    bookId?: string;
    bookTitle?: string;
}

export interface DailyWritingStats {
    date: string;
    minutesLogged: number;
    sessionsCompleted: number;
    wordsDrafted: number;
    sessionCountByMode: Record<WritingSessionMode, number>;
    minutesByMode: Record<WritingSessionMode, number>;
    scenesCompletedByStage: Record<Stage, number>;
    sceneCompletionEvents: SceneCompletionEvent[];
}

export interface DailyWritingSessionProgress {
    date: string;
    targetMode: WritingSessionTargetMode;
    dailyTargetMinutes?: number;
    dailyTargetWords?: number;
    minutesLogged: number;
    wordsLogged: number;
    sessionsCompleted: number;
    remainingMinutes?: number;
    remainingWords?: number;
    overGoalMinutes: number;
    overGoalWords: number;
}

export interface WritingRangeStats {
    startDate: string;
    endDate: string;
    days: number;
    targetMode: WritingSessionTargetMode;
    dailyTargetMinutes?: number;
    dailyTargetWords?: number;
    minutesLogged: number;
    sessionsCompleted: number;
    wordsDrafted: number;
    daysWithSessions: number;
    daysGoalMet: number;
    sessionCountByMode: Record<WritingSessionMode, number>;
    minutesByMode: Record<WritingSessionMode, number>;
    scenesCompletedByStage: Record<Stage, number>;
    freshScenesCompleted: number;
    revisionScenesCompleted: number;
    sceneCompletionEvents: SceneCompletionEvent[];
}

const EMPTY_MODE_COUNTS: Record<WritingSessionMode, number> = {
    drafting: 0,
    revising: 0,
    editing: 0,
    planning: 0,
};

function cloneModeCounts(): Record<WritingSessionMode, number> {
    return { ...EMPTY_MODE_COUNTS };
}

function emptyStageCounts(): Record<Stage, number> {
    return {
        Zero: 0,
        Author: 0,
        House: 0,
        Press: 0,
    };
}

function nowIso(): string {
    return new Date().toISOString();
}

function localDateString(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
    const [yearRaw, monthRaw, dayRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return new Date();
    }
    return new Date(year, month - 1, day);
}

function addLocalDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function dateRangeSet(endDate: string, days: number): { startDate: string; dates: Set<string> } {
    const safeDays = Math.max(1, Math.round(days));
    const end = parseLocalDate(endDate);
    const start = addLocalDays(end, -(safeDays - 1));
    const dates = new Set<string>();
    for (let index = 0; index < safeDays; index++) {
        dates.add(localDateString(addLocalDays(start, index)));
    }
    return { startDate: localDateString(start), dates };
}

function dateKey(value: string | undefined): string {
    const raw = value ?? '';
    if (raw.includes('T')) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return localDateString(parsed);
        }
    }
    return raw.slice(0, 10);
}

function isDateKey(value: string | undefined): value is string {
    return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function coerceSessionDate(value: string | undefined, fallbackIso: string): string {
    return isDateKey(value) ? value : dateKey(fallbackIso);
}

function recordDateKey(record: WritingSessionRecord): string {
    return coerceSessionDate(record.sessionDate, record.endedAt);
}

function generateSessionId(): string {
    return `wrs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function coerceMode(mode: WritingSessionMode | undefined): WritingSessionMode {
    if (mode === 'drafting' || mode === 'revising' || mode === 'editing' || mode === 'planning') {
        return mode;
    }
    return 'drafting';
}

function coerceStage(stage: WritingSessionStage | undefined): WritingSessionStage | undefined {
    if (stage === 'Mixed') return 'Mixed';
    return STAGE_ORDER.find(candidate => candidate === stage);
}

function coerceStagePreference(stage: WritingSessionStagePreference | undefined): WritingSessionStagePreference {
    if (stage === 'auto' || stage === 'Mixed') return stage;
    return STAGE_ORDER.find(candidate => candidate === stage) ?? 'auto';
}

function coerceTargetMode(mode: WritingSessionTargetMode | undefined): WritingSessionTargetMode {
    return mode === 'words' || mode === 'both' ? mode : 'time';
}

function formatSceneStatus(status: TimelineItem['status']): string | undefined {
    if (Array.isArray(status)) return status.filter(Boolean).join(', ') || undefined;
    return status?.toString().trim() || undefined;
}

function uniquePaths(paths: Array<string | undefined>): string[] {
    return [...new Set(paths.map(path => path?.trim()).filter((path): path is string => Boolean(path)))];
}

function nonNegativeInt(value: number | undefined): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.round(value ?? 0)); // SAFE: finite by the guard above; ?? 0 only satisfies the type
}

/** Coerce a persisted per-scene activity map, dropping malformed/empty entries. */
function normalizeSceneActivityMap(
    raw: Record<string, { activeMs?: number; typedWords?: number }> | undefined
): Record<string, { activeMs: number; typedWords: number }> | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<string, { activeMs: number; typedWords: number }> = {};
    for (const [path, totals] of Object.entries(raw)) {
        const trimmed = path?.trim();
        if (!trimmed) continue;
        const activeMs = nonNegativeInt(totals?.activeMs);
        const typedWords = nonNegativeInt(totals?.typedWords);
        if (activeMs === 0 && typedWords === 0) continue;
        out[trimmed] = { activeMs, typedWords };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** Coerce a persisted per-scene activity record array, dropping empty entries. */
function normalizeSceneActivityArray(raw: SceneActivityRecord[] | undefined): SceneActivityRecord[] {
    if (!Array.isArray(raw)) return [];
    const out: SceneActivityRecord[] = [];
    for (const entry of raw) {
        const path = entry?.path?.trim();
        if (!path) continue;
        const activeMs = nonNegativeInt(entry.activeMs);
        const typedWords = nonNegativeInt(entry.typedWords);
        if (activeMs === 0 && typedWords === 0) continue;
        out.push({ path, activeMs, typedWords });
    }
    return out;
}

/** Accumulate per-scene active-ms / typed-words onto the running session. */
function addSceneActivity(
    active: ActiveWritingSession,
    path: string,
    delta: { activeMs?: number; typedWords?: number }
): void {
    const trimmed = path.trim();
    if (!trimmed) return;
    const map = active.sceneActivity ?? (active.sceneActivity = {});
    const entry = map[trimmed] ?? (map[trimmed] = { activeMs: 0, typedWords: 0 });
    entry.activeMs += Math.max(0, Math.round(delta.activeMs ?? 0)); // SAFE: omitted delta = no time to add
    entry.typedWords += Math.max(0, Math.round(delta.typedWords ?? 0)); // SAFE: omitted delta = no words to add
}

/** Serialize a running session's per-scene map into a record array (drops empties). */
function sceneActivityToArray(map: Record<string, { activeMs: number; typedWords: number }> | undefined): SceneActivityRecord[] {
    if (!map) return [];
    return Object.entries(map)
        .map(([path, totals]) => ({
            path,
            activeMs: Math.max(0, Math.round(totals.activeMs || 0)), // SAFE: floor guards malformed persisted number
            typedWords: Math.max(0, Math.round(totals.typedWords || 0)), // SAFE: floor guards malformed persisted number
        }))
        .filter(entry => entry.activeMs > 0 || entry.typedWords > 0);
}

function positiveInteger(value: number | undefined): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const rounded = Math.max(0, Math.round(value ?? 0));
    return rounded > 0 ? rounded : undefined;
}

function positiveMinutes(value: number | undefined): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const rounded = Math.max(0, Math.round(value ?? 0));
    return rounded > 0 ? rounded : undefined;
}

function coerceWeeklyGoalDays(value: number | undefined): number {
    if (!Number.isFinite(value)) return 7;
    return Math.min(7, Math.max(1, Math.round(value ?? 7)));
}

function coerceIdleTimeoutMs(value: number | undefined): number {
    if (!Number.isFinite(value)) return DEFAULT_IDLE_TIMEOUT_MS;
    return Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(MIN_IDLE_TIMEOUT_MS, Math.round(value ?? DEFAULT_IDLE_TIMEOUT_MS)));
}

/**
 * True when a running session's heartbeat is older than the stale threshold,
 * i.e. the app was almost certainly closed/crashed during the gap.
 */
function isActiveSessionStale(session: ActiveWritingSession, at = new Date()): boolean {
    if (session.pausedAt || !session.lastSeenAt) return false;
    const seenAt = Date.parse(session.lastSeenAt);
    if (!Number.isFinite(seenAt)) return false;
    return at.getTime() - seenAt > ACTIVE_SESSION_STALE_MS;
}

function nextLocalMidnightMs(value: string | undefined): number {
    const date = value ? new Date(value) : undefined;
    if (!date || Number.isNaN(date.getTime())) return NaN;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function activeSessionCutoffMs(session: ActiveWritingSession, at = new Date()): number {
    const atMs = at.getTime();
    const cutoffs = [atMs];
    const seenAt = session.lastSeenAt ? Date.parse(session.lastSeenAt) : NaN;
    if (isActiveSessionStale(session, at) && Number.isFinite(seenAt)) {
        cutoffs.push(seenAt);
    }
    const dayBoundary = nextLocalMidnightMs(session.lastResumedAt);
    if (Number.isFinite(dayBoundary) && atMs > dayBoundary) {
        cutoffs.push(dayBoundary);
    }
    return Math.min(...cutoffs);
}

function hasCrossedActiveSessionDayBoundary(session: ActiveWritingSession, at = new Date()): boolean {
    if (session.pausedAt) return false;
    const dayBoundary = nextLocalMidnightMs(session.lastResumedAt);
    return Number.isFinite(dayBoundary) && at.getTime() > dayBoundary;
}

function activeElapsedMs(session: ActiveWritingSession, at = new Date()): number {
    const elapsedBeforePause = Math.max(0, session.elapsedMsBeforePause || 0);
    if (session.pausedAt) return elapsedBeforePause;
    const resumedAt = Date.parse(session.lastResumedAt);
    if (!Number.isFinite(resumedAt)) return elapsedBeforePause;
    // Abandoned session: stop counting at the last heartbeat, not `at`, so a
    // forgotten timer left running across an app quit doesn't report hours of
    // phantom writing time.
    const cutoff = activeSessionCutoffMs(session, at);
    return elapsedBeforePause + Math.max(0, cutoff - resumedAt);
}

export function normalizeWritingSessionsSettings(settings: WritingSessionsSettings | undefined): WritingSessionsSettings {
    const records = Array.isArray(settings?.records)
        ? settings.records
            .filter((record): record is WritingSessionRecord => Boolean(record?.id && record.startedAt && record.endedAt))
            .slice(-MAX_SESSION_RECORDS)
        : [];
    const defaultMode = coerceMode(settings?.defaults?.defaultMode);
    const defaultStage = coerceStagePreference(settings?.defaults?.defaultStage);
    const targetMode = coerceTargetMode(settings?.defaults?.targetMode);
    const weeklyGoalDays = coerceWeeklyGoalDays(settings?.defaults?.weeklyGoalDays);
    const writingStatsOpen = settings?.defaults?.writingStatsOpen === true;
    const idleTimeoutMs = coerceIdleTimeoutMs(settings?.defaults?.idleTimeoutMs);
    // Default OFF: posting session summaries to the community feed is opt-in
    // at every layer, matching the Community Share doctrine.
    const postSessionsToFeed = settings?.defaults?.postSessionsToFeed === true;
    const active = settings?.active;
    return {
        schemaVersion: WRITING_SESSIONS_SCHEMA_VERSION,
        defaults: { defaultMode, defaultStage, targetMode, weeklyGoalDays, writingStatsOpen, idleTimeoutMs, postSessionsToFeed },
        ...(active ? {
            active: {
                ...active,
                mode: coerceMode(active.mode),
                stage: coerceStage(active.stage),
                stagePreference: coerceStagePreference(active.stagePreference),
                targetMode: coerceTargetMode(active.targetMode),
                goalMinutes: positiveMinutes(active.goalMinutes),
                goalWords: positiveInteger(active.goalWords),
                typedWords: Math.max(0, Math.round(active.typedWords || 0)),
                wordSnapshot: active.wordSnapshot && Number.isFinite(active.wordSnapshot.startedWords) && Array.isArray(active.wordSnapshot.paths)
                    ? {
                        startedWords: Math.max(0, Math.round(active.wordSnapshot.startedWords || 0)),
                        paths: uniquePaths(active.wordSnapshot.paths),
                    }
                    : undefined,
                countdownSegmentStartElapsedMs: Number.isFinite(active.countdownSegmentStartElapsedMs)
                    ? Math.max(0, Math.round(active.countdownSegmentStartElapsedMs ?? 0))
                    : undefined,
                lastActivityAt: typeof active.lastActivityAt === 'string' ? active.lastActivityAt : undefined,
                idleAuto: active.idleAuto === true,
                sceneActivity: normalizeSceneActivityMap(active.sceneActivity),
                currentScenePath: typeof active.currentScenePath === 'string' ? active.currentScenePath : undefined,
            }
        } : {}),
        records: records.map(record => ({
            ...record,
            mode: coerceMode(record.mode),
            stage: coerceStage(record.stage),
            stagePreference: coerceStagePreference(record.stagePreference),
            sessionDate: isDateKey(record.sessionDate) ? record.sessionDate : undefined,
            wordsAdded: positiveInteger(record.wordsAdded),
            typedWords: positiveInteger(record.typedWords),
            netWordDelta: Number.isFinite(record.netWordDelta) ? Math.round(record.netWordDelta ?? 0) : undefined,
            scenePaths: uniquePaths(record.scenePaths ?? []),
            scenesCompletedPaths: uniquePaths(record.scenesCompletedPaths ?? []),
            scenesActivity: normalizeSceneActivityArray(record.scenesActivity),
        })),
    };
}

export function collectSceneCompletionEvents(scenes: TimelineItem[]): SceneCompletionEvent[] {
    return scenes.flatMap(scene => {
        if (!isCompleteStatus(scene.status) || !scene.due) return [];
        const date = dateKey(scene.due);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
        const stage = normalizePublishStage(scene['Publish Stage']);
        return [{
            date,
            stage,
            workKind: stage === 'Zero' ? 'fresh' : 'revision',
            revisionRound: stage,
            sceneId: scene.sceneId,
            path: scene.path,
            title: scene.title,
            bookId: scene.bookId,
            bookTitle: scene.bookTitle,
        }];
    });
}

export function buildDailyWritingStats(params: {
    date: string;
    sessions: WritingSessionRecord[];
    scenes: TimelineItem[];
}): DailyWritingStats {
    const { date, sessions, scenes } = params;
    const sessionCountByMode = cloneModeCounts();
    const minutesByMode = cloneModeCounts();
    let minutesLogged = 0;
    let wordsDrafted = 0;

    const sessionsForDate = sessions.filter(session => recordDateKey(session) === date);
    sessionsForDate.forEach(session => {
        const mode = coerceMode(session.mode);
        const minutes = Math.round(Math.max(0, session.elapsedMs || 0) / 60000);
        sessionCountByMode[mode] += 1;
        minutesByMode[mode] += minutes;
        minutesLogged += minutes;
        if (mode === 'drafting') {
            wordsDrafted += positiveInteger(session.wordsAdded) ?? 0;
        }
    });

    const scenesCompletedByStage = emptyStageCounts();
    const sceneCompletionEvents = collectSceneCompletionEvents(scenes).filter(event => event.date === date);
    sceneCompletionEvents.forEach(event => {
        scenesCompletedByStage[event.stage] += 1;
    });

    return {
        date,
        minutesLogged,
        sessionsCompleted: sessionsForDate.length,
        wordsDrafted,
        sessionCountByMode,
        minutesByMode,
        scenesCompletedByStage,
        sceneCompletionEvents,
    };
}

export function buildDailyWritingSessionProgress(params: {
    date: string;
    sessions: WritingSessionRecord[];
    targetMode?: WritingSessionTargetMode;
    dailyTargetMinutes?: number;
    dailyTargetWords?: number;
}): DailyWritingSessionProgress {
    let minutesLogged = 0;
    let wordsLogged = 0;
    let sessionsCompleted = 0;
    params.sessions.forEach(session => {
        if (recordDateKey(session) !== params.date) return;
        sessionsCompleted += 1;
        minutesLogged += Math.round(Math.max(0, session.elapsedMs || 0) / 60000);
        if (coerceMode(session.mode) === 'drafting') {
            wordsLogged += positiveInteger(session.wordsAdded) ?? 0;
        }
    });

    const targetMode = coerceTargetMode(params.targetMode);
    const dailyTargetMinutes = positiveMinutes(params.dailyTargetMinutes);
    const dailyTargetWords = positiveInteger(params.dailyTargetWords);
    const remainingMinutes = dailyTargetMinutes
        ? Math.max(0, dailyTargetMinutes - minutesLogged)
        : undefined;
    const remainingWords = dailyTargetWords
        ? Math.max(0, dailyTargetWords - wordsLogged)
        : undefined;
    const overGoalMinutes = dailyTargetMinutes
        ? Math.max(0, minutesLogged - dailyTargetMinutes)
        : 0;
    const overGoalWords = dailyTargetWords
        ? Math.max(0, wordsLogged - dailyTargetWords)
        : 0;

    return {
        date: params.date,
        targetMode,
        dailyTargetMinutes,
        dailyTargetWords,
        minutesLogged,
        wordsLogged,
        sessionsCompleted,
        remainingMinutes,
        remainingWords,
        overGoalMinutes,
        overGoalWords,
    };
}

export function buildWritingRangeStats(params: {
    endDate: string;
    days: number;
    sessions: WritingSessionRecord[];
    scenes: TimelineItem[];
    targetMode?: WritingSessionTargetMode;
    dailyTargetMinutes?: number;
    dailyTargetWords?: number;
}): WritingRangeStats {
    const safeDays = Math.max(1, Math.round(params.days));
    const { startDate, dates } = dateRangeSet(params.endDate, safeDays);
    const sessionCountByMode = cloneModeCounts();
    const minutesByMode = cloneModeCounts();
    const minutesByDate = new Map<string, number>();
    let minutesLogged = 0;
    let wordsDrafted = 0;
    let sessionsCompleted = 0;

    params.sessions.forEach(session => {
        const sessionDate = recordDateKey(session);
        if (!dates.has(sessionDate)) return;
        const mode = coerceMode(session.mode);
        const minutes = Math.round(Math.max(0, session.elapsedMs || 0) / 60000);
        sessionsCompleted += 1;
        sessionCountByMode[mode] += 1;
        minutesByMode[mode] += minutes;
        minutesLogged += minutes;
        minutesByDate.set(sessionDate, (minutesByDate.get(sessionDate) ?? 0) + minutes);
        if (mode === 'drafting') {
            wordsDrafted += positiveInteger(session.wordsAdded) ?? 0;
        }
    });

    const scenesCompletedByStage = emptyStageCounts();
    let freshScenesCompleted = 0;
    let revisionScenesCompleted = 0;
    const sceneCompletionEvents = collectSceneCompletionEvents(params.scenes).filter(event => dates.has(event.date));
    sceneCompletionEvents.forEach(event => {
        scenesCompletedByStage[event.stage] += 1;
        if (event.workKind === 'fresh') freshScenesCompleted += 1;
        else revisionScenesCompleted += 1;
    });

    const targetMode = coerceTargetMode(params.targetMode);
    const dailyTargetMinutes = positiveMinutes(params.dailyTargetMinutes);
    const dailyTargetWords = positiveInteger(params.dailyTargetWords);
    const daysWithSessions = [...minutesByDate.values()].filter(minutes => minutes > 0).length;
    const wordsByDate = new Map<string, number>();
    params.sessions.forEach(session => {
        const sessionDate = recordDateKey(session);
        if (!dates.has(sessionDate) || coerceMode(session.mode) !== 'drafting') return;
        wordsByDate.set(sessionDate, (wordsByDate.get(sessionDate) ?? 0) + (positiveInteger(session.wordsAdded) ?? 0));
    });
    const daysGoalMet = [...dates].filter(date => {
        const minuteMet = dailyTargetMinutes ? (minutesByDate.get(date) ?? 0) >= dailyTargetMinutes : true;
        const wordMet = dailyTargetWords ? (wordsByDate.get(date) ?? 0) >= dailyTargetWords : true;
        if (targetMode === 'time') return dailyTargetMinutes ? minuteMet : false;
        if (targetMode === 'words') return dailyTargetWords ? wordMet : false;
        return Boolean(dailyTargetMinutes || dailyTargetWords) && minuteMet && wordMet;
    }).length;

    return {
        startDate,
        endDate: params.endDate,
        days: safeDays,
        targetMode,
        dailyTargetMinutes,
        dailyTargetWords,
        minutesLogged,
        sessionsCompleted,
        wordsDrafted,
        daysWithSessions,
        daysGoalMet,
        sessionCountByMode,
        minutesByMode,
        scenesCompletedByStage,
        freshScenesCompleted,
        revisionScenesCompleted,
        sceneCompletionEvents,
    };
}

export class WritingSessionService {
    private hydrated = false;
    private lastHeartbeatPersistMs = 0;
    private lastActivityPersistMs = 0;

    constructor(private plugin: RadialTimelinePlugin) {}

    /**
     * Normalize persisted settings exactly once (at plugin load), then reuse
     * the normalized object. Avoids re-allocating the records array on every
     * read — `getSettings()` is called from a 1-second UI tick.
     */
    async hydrate(): Promise<void> {
        this.hydrated = false;
        this.getSettings();
        await this.reconcileActiveSession();
    }

    getSettings(): WritingSessionsSettings {
        const existing = this.plugin.settings.writingSessions;
        if (this.hydrated && existing) return existing;
        const normalized = normalizeWritingSessionsSettings(existing);
        this.plugin.settings.writingSessions = normalized;
        this.hydrated = true;
        return normalized;
    }

    /**
     * Convert a session abandoned by an app crash/quit into a paused session
     * frozen at its last heartbeat, so the author resumes/stops from real
     * elapsed time instead of hours of dead time. Runs once on load.
     */
    private async reconcileActiveSession(): Promise<void> {
        const settings = this.getSettings();
        const active = settings.active;
        if (!active || active.pausedAt) return;
        if (!isActiveSessionStale(active) && !hasCrossedActiveSessionDayBoundary(active)) return;
        const cutoffMs = activeSessionCutoffMs(active);
        active.elapsedMsBeforePause = activeElapsedMs(active);
        active.pausedAt = new Date(cutoffMs).toISOString();
        await this.plugin.saveSettings();
    }

    /**
     * Heartbeat for the running session. Called from the UI tick; persists at
     * most once per HEARTBEAT_PERSIST_MS so a hard quit loses at worst that
     * much unrecorded time (and never counts the dead gap — see activeElapsedMs).
     */
    async markActiveSessionSeen(): Promise<void> {
        const settings = this.getSettings();
        const active = settings.active;
        if (!active || active.pausedAt) return;
        if (hasCrossedActiveSessionDayBoundary(active)) {
            const now = new Date();
            const cutoffMs = activeSessionCutoffMs(active, now);
            active.elapsedMsBeforePause = activeElapsedMs(active, now);
            active.pausedAt = new Date(cutoffMs).toISOString();
            await this.plugin.saveSettings();
            return;
        }
        active.lastSeenAt = nowIso();
        const now = Date.now();
        if (now - this.lastHeartbeatPersistMs < HEARTBEAT_PERSIST_MS) return;
        this.lastHeartbeatPersistMs = now;
        await this.plugin.saveSettings();
    }

    registerTypedWords(count: number, scenePath?: string): void {
        const active = this.getActiveSession();
        if (!active || active.pausedAt || count <= 0) return;
        const words = Math.round(count);
        active.typedWords = Math.max(0, Math.round(active.typedWords || 0)) + words;
        // Per-scene attribution only when the typing happened in a scene file.
        if (scenePath) addSceneActivity(active, scenePath, { typedWords: words });
    }

    /**
     * Auto-track activity signal — call when real writing activity happens
     * (keystroke, cursor move, scroll, scene switch) while focused on a scene;
     * the caller owns that focus+scene gate.
     *
     * Auto-track governs a session the author has already begun — it never
     * starts one. With no active session this is a no-op (opening a scene is
     * not "writing"). For a running session it:
     *
     * - Idle-auto-paused → resumes silently so typing keeps counting.
     * - Manual pause → left untouched (the author's explicit hold).
     * - Running → advances the activity clock that drives idle detection.
     *
     * The synchronous mutations (clearing an idle pause) run before the first
     * await, so a caller that fires this immediately before counting typed words
     * sees the session already running.
     */
    async onActivity(scenePath?: string): Promise<void> {
        const active = this.getActiveSession();
        if (!active) return;
        const iso = nowIso();
        if (active.pausedAt) {
            if (!active.idleAuto) return; // manual hold — respect the author's override
            active.pausedAt = undefined;
            active.idleAuto = false;
            active.lastResumedAt = iso;
            active.lastSeenAt = iso;
            active.lastActivityAt = iso;
            // Resume fresh on the focused scene — the idle gap is never credited.
            if (scenePath) active.currentScenePath = scenePath;
            this.lastHeartbeatPersistMs = Date.now();
            await this.plugin.saveSettings();
            return;
        }
        // Running session. Close out the window since the last activity.
        const prevMs = Date.parse(active.lastActivityAt || active.lastResumedAt);
        const idleTimeout = this.getIdleTimeoutMs();
        const gap = Number.isFinite(prevMs) ? Date.now() - prevMs : 0;
        if (gap > idleTimeout) {
            // A long gap the idle tick never paused (e.g. the window was
            // backgrounded and its timers were throttled). Bank elapsed up to the
            // last activity and start a fresh window so the away-time is excluded
            // from both the session clock and per-scene totals.
            active.elapsedMsBeforePause = activeElapsedMs(active, new Date(prevMs));
            active.lastResumedAt = iso;
        } else if (gap > 0 && active.currentScenePath) {
            // Credit the window to the scene focused during it, so per-scene times
            // sum to roughly the session elapsed.
            addSceneActivity(active, active.currentScenePath, { activeMs: gap });
        }
        if (scenePath) active.currentScenePath = scenePath;
        active.lastActivityAt = iso;
        // Keep the crash heartbeat fresh on real activity, independent of the
        // UI tick (which throttles when the window is backgrounded).
        active.lastSeenAt = iso;
        const now = Date.now();
        if (now - this.lastActivityPersistMs < HEARTBEAT_PERSIST_MS) return;
        this.lastActivityPersistMs = now;
        await this.plugin.saveSettings();
    }

    /**
     * Auto-track idle pause, driven from the 1-second UI tick. After the idle
     * timeout a running session is paused, frozen at the last activity (interior
     * idle gaps never accrue), and resumes silently on the next activity. The
     * session is never auto-saved — it persists until the author saves it.
     * Manual pauses are left alone. Returns true if it paused, so the caller can
     * re-render. `onActivity` is the resume/keepalive counterpart and also banks
     * a long gap even if this tick was throttled (backgrounded window).
     */
    async maybeHandleIdle(): Promise<boolean> {
        const active = this.getActiveSession();
        if (!active || active.pausedAt) return false; // already paused (manual or idle) — nothing to do
        const lastActivityMs = Date.parse(active.lastActivityAt || active.lastResumedAt);
        if (!Number.isFinite(lastActivityMs)) return false;
        if (Date.now() - lastActivityMs <= this.getIdleTimeoutMs()) return false;
        // Idle: freeze elapsed at the last activity and pause. Resumes silently on
        // the next activity. The session is NEVER auto-saved — it persists until
        // the author saves it, so work after a long break is never lost.
        const cutoff = new Date(lastActivityMs);
        active.elapsedMsBeforePause = activeElapsedMs(active, cutoff);
        active.pausedAt = cutoff.toISOString();
        active.idleAuto = true;
        await this.plugin.saveSettings();
        return true;
    }

    getActiveSession(): ActiveWritingSession | undefined {
        return this.getSettings().active;
    }

    /** Active file path if it is a scene, else undefined — the unit of per-scene attribution. */
    private getActiveScenePath(): string | undefined {
        const path = this.plugin.app?.workspace?.getActiveFile?.()?.path;
        if (!path || typeof this.plugin.isSceneFile !== 'function') return undefined;
        return this.plugin.isSceneFile(path) ? path : undefined;
    }

    /**
     * Per-scene time + typed-word totals for the local day — today's saved
     * records plus the in-progress session — newest-effort first. A memory aid
     * for the save popover; values are advisory (active-ms ≈ session elapsed).
     */
    getTodaySceneActivity(at = new Date()): SceneActivityRecord[] {
        const todayKey = localDateString(at);
        const totals = new Map<string, { activeMs: number; typedWords: number }>();
        const add = (path: string, activeMs: number, typedWords: number): void => {
            const entry = totals.get(path) ?? { activeMs: 0, typedWords: 0 }; // SAFE: first sighting of a scene starts a zero accumulator
            entry.activeMs += activeMs;
            entry.typedWords += typedWords;
            totals.set(path, entry);
        };
        for (const record of this.getSettings().records) {
            if (recordDateKey(record) !== todayKey) continue;
            for (const scene of record.scenesActivity ?? []) add(scene.path, scene.activeMs, scene.typedWords); // SAFE: pre-v6 records have no per-scene data
        }
        const active = this.getActiveSession();
        if (active?.sceneActivity) {
            for (const [path, t] of Object.entries(active.sceneActivity)) add(path, t.activeMs, t.typedWords);
        }
        return [...totals.entries()]
            .map(([path, t]) => ({ path, activeMs: t.activeMs, typedWords: t.typedWords }))
            .filter(entry => entry.activeMs > 0 || entry.typedWords > 0)
            .sort((a, b) => b.activeMs - a.activeMs || b.typedWords - a.typedWords);
    }

    getActiveElapsedMs(at = new Date()): number {
        const active = this.getActiveSession();
        return active ? activeElapsedMs(active, at) : 0;
    }

    getDefaultGoalMinutes(): number | undefined {
        return positiveMinutes(getRuntimeSettings(this.plugin.settings).sessionPlanning?.dailyMinutes);
    }

    getDefaultGoalWords(): number | undefined {
        return positiveInteger(getRuntimeSettings(this.plugin.settings).sessionPlanning?.dailyWords);
    }

    getDefaultTargetMode(): WritingSessionTargetMode {
        return coerceTargetMode(this.getSettings().defaults.targetMode);
    }

    async setDefaultMode(mode: WritingSessionMode): Promise<void> {
        const settings = this.getSettings();
        settings.defaults.defaultMode = coerceMode(mode);
        await this.plugin.saveSettings();
    }

    async setDefaultStage(stage: WritingSessionStagePreference): Promise<void> {
        const settings = this.getSettings();
        settings.defaults.defaultStage = coerceStagePreference(stage);
        await this.plugin.saveSettings();
    }

    async setDefaultTargetMode(mode: WritingSessionTargetMode): Promise<void> {
        const settings = this.getSettings();
        settings.defaults.targetMode = coerceTargetMode(mode);
        await this.plugin.saveSettings();
    }

    getIdleTimeoutMs(): number {
        return coerceIdleTimeoutMs(this.getSettings().defaults.idleTimeoutMs);
    }

    /** Remembered default for the per-save "post to community feed" toggle. */
    isPostSessionsToFeedEnabled(): boolean {
        return this.getSettings().defaults.postSessionsToFeed === true;
    }

    async setPostSessionsToFeed(enabled: boolean): Promise<void> {
        const settings = this.getSettings();
        if (settings.defaults.postSessionsToFeed === (enabled === true)) return;
        settings.defaults.postSessionsToFeed = enabled === true;
        await this.plugin.saveSettings();
    }

    async setWeeklyGoalDays(days: number | undefined): Promise<void> {
        const settings = this.getSettings();
        settings.defaults.weeklyGoalDays = coerceWeeklyGoalDays(days);
        await this.plugin.saveSettings();
    }

    /**
     * Resolve which of the touched scenes actually completed during the
     * session. Caller may pre-compute via completion.scenesCompletedPaths;
     * otherwise we intersect touched scenes with the current Complete set so
     * attribution is durable on the record even if the scene later moves
     * stages.
     */
    private async resolveScenesCompletedPaths(completion: WritingSessionCompletionInput): Promise<string[]> {
        if (Array.isArray(completion.scenesCompletedPaths)) {
            return uniquePaths(completion.scenesCompletedPaths);
        }
        const touched = uniquePaths(completion.scenePaths ?? []);
        if (touched.length === 0) return [];
        try {
            const scenes = await this.plugin.getSceneData();
            const completePaths = new Set(scenes
                .filter(scene => isCompleteStatus(scene.status) && Boolean(scene.path))
                .map(scene => scene.path as string));
            return touched.filter(path => completePaths.has(path));
        } catch {
            return [];
        }
    }

    private getOpenScenePaths(): string[] {
        const workspace = this.plugin.app?.workspace;
        const activePath = workspace?.getActiveFile?.()?.path;
        const leaves = workspace?.getLeavesOfType?.('markdown') ?? [];
        const openPaths = leaves.map(leaf => {
            const view = (leaf as { view?: { file?: { path?: string } } }).view;
            return view?.file?.path;
        });
        return uniquePaths([activePath, ...openPaths]);
    }

    private getSceneFileModifiedAt(path: string): number | undefined {
        const file = this.plugin.app?.vault?.getAbstractFileByPath?.(path) as { stat?: { mtime?: number } } | null | undefined;
        const mtime = file?.stat?.mtime;
        return Number.isFinite(mtime) ? mtime : undefined;
    }

    private async readSceneWordCount(path: string): Promise<number> {
        const vault = this.plugin.app?.vault;
        const file = vault?.getAbstractFileByPath?.(path);
        if (!(file instanceof TFile)) return 0;
        try {
            return countWords(extractBodyText(await vault.read(file)));
        } catch {
            return 0;
        }
    }

    private async captureOpenSceneWordSnapshot(): Promise<ActiveWritingSession['wordSnapshot'] | undefined> {
        if (typeof this.plugin.getSceneData !== 'function') return undefined;
        const scenes: TimelineItem[] = await this.plugin.getSceneData().catch(() => []);
        const scenePaths = new Set(scenes
            .filter(scene => Boolean(scene.path) && this.isSceneInActiveBook(scene))
            .map(scene => scene.path as string));
        const paths = uniquePaths(this.getOpenScenePaths().filter(path => scenePaths.has(path)));
        if (paths.length === 0) return undefined;
        let startedWords = 0;
        for (const path of paths) {
            startedWords += await this.readSceneWordCount(path);
        }
        return { startedWords, paths };
    }

    async getActiveNetWordDelta(active: ActiveWritingSession | undefined = this.getActiveSession()): Promise<number | undefined> {
        if (!active?.wordSnapshot?.paths.length) return undefined;
        let currentWords = 0;
        for (const path of active.wordSnapshot.paths) {
            currentWords += await this.readSceneWordCount(path);
        }
        return currentWords - active.wordSnapshot.startedWords;
    }

    private isSceneInActiveBook(scene: TimelineItem): boolean {
        return isSceneInBook(scene, getActiveBook(this.plugin.settings));
    }

    private resolveAutoStage(scenes: TimelineItem[]): WritingSessionStage {
        const scopedScenes = scenes.filter(scene => this.isSceneInActiveBook(scene));
        const workingStages = new Set(scopedScenes
            .filter(scene => normalizeStatus(scene.status) === 'Working')
            .map(scene => normalizePublishStage(scene['Publish Stage'])));
        if (workingStages.size === 1) return [...workingStages][0];
        if (workingStages.size > 1) return 'Mixed';

        const stageWithIncomplete = [...STAGE_ORDER].reverse().find(stage =>
            scopedScenes.some(scene => normalizePublishStage(scene['Publish Stage']) === stage && !isCompleteStatus(scene.status))
        );
        if (stageWithIncomplete) return stageWithIncomplete;

        return [...STAGE_ORDER].reverse().find(stage =>
            scopedScenes.some(scene => normalizePublishStage(scene['Publish Stage']) === stage)
        ) ?? 'Zero';
    }

    private async resolveSessionStage(preference: WritingSessionStagePreference): Promise<WritingSessionStage> {
        if (preference !== 'auto') return coerceStage(preference) ?? 'Zero';
        try {
            return this.resolveAutoStage(await this.plugin.getSceneData());
        } catch {
            return 'Zero';
        }
    }

    async start(options: WritingSessionMode | WritingSessionStartOptions = {}): Promise<ActiveWritingSession> {
        const settings = this.getSettings();
        if (settings.active) {
            throw new Error('A writing session is already active.');
        }
        const startOptions: WritingSessionStartOptions = typeof options === 'string'
            ? { mode: options }
            : options;
        const book = getActiveBook(this.plugin.settings);
        const startedAt = nowIso();
        const stagePreference = coerceStagePreference(startOptions.stage ?? settings.defaults.defaultStage);
        const stage = await this.resolveSessionStage(stagePreference);
        const targetMode = coerceTargetMode(startOptions.targetMode ?? settings.defaults.targetMode);
        const goalMinutes = positiveMinutes(startOptions.goalMinutes);
        const goalWords = positiveInteger(startOptions.goalWords);
        const active: ActiveWritingSession = {
            id: generateSessionId(),
            bookId: book?.id,
            bookTitle: book?.title,
            mode: coerceMode(startOptions.mode ?? settings.defaults.defaultMode),
            stage,
            stagePreference,
            startedAt,
            lastResumedAt: startedAt,
            lastSeenAt: startedAt,
            lastActivityAt: startedAt,
            idleAuto: false,
            elapsedMsBeforePause: 0,
            targetMode,
            goalMinutes,
            goalWords,
            typedWords: 0,
            wordSnapshot: await this.captureOpenSceneWordSnapshot(),
            countdownSegmentStartElapsedMs: goalMinutes ? 0 : undefined,
            sceneActivity: {},
            currentScenePath: this.getActiveScenePath(),
        };
        settings.active = active;
        this.lastHeartbeatPersistMs = Date.now();
        await this.plugin.saveSettings();
        return active;
    }

    async pause(): Promise<ActiveWritingSession> {
        const settings = this.getSettings();
        const active = settings.active;
        if (!active) throw new Error('No writing session is active.');
        if (active.pausedAt) return active;
        const pausedAt = new Date();
        active.elapsedMsBeforePause = activeElapsedMs(active, pausedAt);
        active.pausedAt = pausedAt.toISOString();
        // Manual hold: auto-track must not silently resume or finalize this.
        active.idleAuto = false;
        await this.plugin.saveSettings();
        return active;
    }

    async resume(): Promise<ActiveWritingSession> {
        const settings = this.getSettings();
        const active = settings.active;
        if (!active) throw new Error('No writing session is active.');
        if (!active.pausedAt) return active;
        active.pausedAt = undefined;
        active.idleAuto = false;
        active.lastResumedAt = nowIso();
        active.lastSeenAt = active.lastResumedAt;
        active.lastActivityAt = active.lastResumedAt;
        this.lastHeartbeatPersistMs = Date.now();
        await this.plugin.saveSettings();
        return active;
    }

    async continueCountdown(): Promise<ActiveWritingSession> {
        const settings = this.getSettings();
        const active = settings.active;
        if (!active) throw new Error('No writing session is active.');
        if (!active.goalMinutes) throw new Error('Only countdown sessions can be continued.');
        const now = new Date();
        const elapsedBeforeNextSegment = activeElapsedMs(active, now);
        active.elapsedMsBeforePause = elapsedBeforeNextSegment;
        active.countdownSegmentStartElapsedMs = elapsedBeforeNextSegment;
        active.pausedAt = undefined;
        active.idleAuto = false;
        active.lastResumedAt = now.toISOString();
        active.lastSeenAt = active.lastResumedAt;
        active.lastActivityAt = active.lastResumedAt;
        this.lastHeartbeatPersistMs = Date.now();
        await this.plugin.saveSettings();
        return active;
    }

    async stop(completion: WritingSessionCompletionInput = {}): Promise<WritingSessionRecord> {
        const settings = this.getSettings();
        const active = settings.active;
        if (!active) throw new Error('No writing session is active.');
        const endedAt = new Date();
        const record: WritingSessionRecord = {
            id: active.id,
            bookId: active.bookId,
            bookTitle: active.bookTitle,
            mode: active.mode,
            stage: active.stage,
            stagePreference: active.stagePreference,
            startedAt: active.startedAt,
            endedAt: endedAt.toISOString(),
            sessionDate: coerceSessionDate(completion.sessionDate, active.startedAt),
            elapsedMs: Math.max(0, Math.round(completion.elapsedMs ?? activeElapsedMs(active, endedAt))),
            wordsAdded: positiveInteger(completion.wordsAdded),
            typedWords: positiveInteger(completion.typedWords ?? active.typedWords),
            netWordDelta: Number.isFinite(completion.netWordDelta) ? Math.round(completion.netWordDelta ?? 0) : undefined,
            scenesCompleted: positiveInteger(completion.scenesCompleted),
            scenePaths: uniquePaths(completion.scenePaths ?? []),
            scenesCompletedPaths: await this.resolveScenesCompletedPaths(completion),
            pagesEdited: positiveInteger(completion.pagesEdited),
            note: completion.note?.trim() || undefined,
            source: 'timer',
            scenesActivity: sceneActivityToArray(active.sceneActivity),
        };
        const allRecords = [...settings.records, record];
        settings.records = allRecords.slice(-MAX_SESSION_RECORDS);
        settings.active = undefined;
        await this.plugin.saveSettings();
        // Mirror the full history (pre-cap) into the author-owned vault file so
        // records pruned from settings are never permanently lost.
        await this.flushPortableSessionLog(allRecords);
        return record;
    }

    /**
     * Write/refresh the author-owned portable JSON log in the vault. Merges by
     * id with any existing file so the complete history survives the in-settings
     * MAX_SESSION_RECORDS cap and a plugin uninstall. Best-effort: a failure
     * here must never break stopping a session.
     *
     * An archive that cannot be parsed is never written over — it is renamed
     * aside and a fresh log started, so the only copy of the pre-cap history
     * survives even when this function cannot merge it.
     */
    private async flushPortableSessionLog(currentRecords: WritingSessionRecord[]): Promise<void> {
        try {
            const vault = this.plugin.app?.vault;
            if (!vault) return;

            const byId = new Map<string, WritingSessionRecord>();
            let existing = vault.getAbstractFileByPath(PORTABLE_LOG_PATH) as TFile | null;
            if (existing) {
                const read = parsePortableSessionLog(await vault.read(existing));
                if (read.kind === 'unreadable') {
                    // Preserve the damaged archive under a dated name rather
                    // than merging into nothing and overwriting the original.
                    const quarantinePath = buildCorruptSessionLogPath(new Date());
                    await vault.rename(existing, quarantinePath);
                    existing = null;
                    new Notice(
                        `Could not read ${PORTABLE_LOG_PATH} (${read.reason}). Your history was NOT overwritten — `
                        + `the damaged file is now ${quarantinePath} and a fresh log has been started.`,
                        0
                    );
                } else {
                    for (const rec of read.records) byId.set(rec.id, rec);
                }
            }
            for (const rec of currentRecords) byId.set(rec.id, rec);

            const merged = [...byId.values()].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
            const payload = `${JSON.stringify({
                schemaVersion: WRITING_SESSIONS_SCHEMA_VERSION,
                generatedBy: 'Radial Timeline',
                generatedAt: nowIso(),
                records: merged,
            }, null, 2)}\n`;

            if (!vault.getAbstractFileByPath(PORTABLE_LOG_FOLDER)) {
                await vault.createFolder(PORTABLE_LOG_FOLDER).catch(() => undefined);
            }
            if (existing) {
                await vault.modify(existing, payload);
            } else {
                await vault.create(PORTABLE_LOG_PATH, payload);
            }
        } catch (error) {
            console.warn('[RT WritingSession] Could not write portable session log:', error);
        }
    }

    async collectTouchedSceneSuggestions(active: ActiveWritingSession | undefined = this.getActiveSession()): Promise<WritingSessionSceneSuggestion[]> {
        if (!active) return [];
        const scenes = await this.plugin.getSceneData();
        const sceneByPath = new Map(scenes
            .filter(scene => Boolean(scene.path) && this.isSceneInActiveBook(scene))
            .map(scene => [scene.path as string, scene]));
        const suggestions = new Map<string, WritingSessionSceneSuggestion>();
        const addSuggestion = (scene: TimelineItem | undefined, reason: WritingSessionSceneSuggestion['reason']) => {
            if (!scene?.path || suggestions.has(scene.path)) return;
            suggestions.set(scene.path, {
                path: scene.path,
                title: scene.title,
                stage: normalizePublishStage(scene['Publish Stage']),
                status: formatSceneStatus(scene.status),
                reason,
            });
        };

        this.getOpenScenePaths().forEach((path, index) => addSuggestion(sceneByPath.get(path), index === 0 ? 'active' : 'open'));

        scenes
            .filter(scene => this.isSceneInActiveBook(scene) && normalizeStatus(scene.status) === 'Working')
            .forEach(scene => addSuggestion(scene, 'working'));

        const startedAt = Date.parse(active.startedAt);
        if (Number.isFinite(startedAt)) {
            scenes
                .filter(scene => scene.path && this.isSceneInActiveBook(scene))
                .forEach(scene => {
                    const modifiedAt = this.getSceneFileModifiedAt(scene.path as string);
                    if (modifiedAt && modifiedAt >= startedAt) addSuggestion(scene, 'modified');
                });
        }

        return [...suggestions.values()].slice(0, 8);
    }

    async discard(): Promise<void> {
        const settings = this.getSettings();
        if (!settings.active) throw new Error('No writing session is active.');
        settings.active = undefined;
        await this.plugin.saveSettings();
    }

    async getDailyStats(date = localDateString()): Promise<DailyWritingStats> {
        const scenes = await this.plugin.getSceneData();
        return buildDailyWritingStats({
            date,
            sessions: this.getSettings().records,
            scenes,
        });
    }

    getDailySessionProgress(date = localDateString()): DailyWritingSessionProgress {
        return buildDailyWritingSessionProgress({
            date,
            sessions: this.getSettings().records,
            targetMode: this.getDefaultTargetMode(),
            dailyTargetMinutes: this.getDefaultGoalMinutes(),
            dailyTargetWords: this.getDefaultGoalWords(),
        });
    }

    async getRangeStats(days: number, endDate = localDateString()): Promise<WritingRangeStats> {
        const scenes = await this.plugin.getSceneData();
        return buildWritingRangeStats({
            endDate,
            days,
            sessions: this.getSettings().records,
            scenes,
            targetMode: this.getDefaultTargetMode(),
            dailyTargetMinutes: this.getDefaultGoalMinutes(),
            dailyTargetWords: this.getDefaultGoalWords(),
        });
    }

    /**
     * Private-audience session log for a window. Renderers (settings cards
     * expand panel, timeline session popover) consume this directly.
     *
     * For non-private audiences the renderer must NOT call this method —
     * instead use the dedicated `buildPrivateSessionLog` / friends /
     * community projections in `WritingSessionLog.ts` to enforce the
     * privacy contract.
     */
    getPrivateSessionLog(params: { days: number; endDate?: string; limit?: number }): PrivateSessionLogRow[] {
        return buildPrivateSessionLog({
            records: this.getSettings().records,
            window: { endDate: params.endDate ?? localDateString(), days: params.days },
            limit: params.limit,
        });
    }
}
