import type RadialTimelinePlugin from '../main';
import type {
    BookProfile,
    CommunityShareFieldKey,
    CommunityShareSettings,
    WritingSessionMode
} from '../types/settings';
import { buildDailyWritingStats, type WritingRangeStats } from '../services/WritingSessionService';
import {
    buildCommunityHourModeMix,
    type CommunityHourModeMinutes
} from '../services/WritingSessionLog';
import type { TimelineItem } from '../types';
import { buildProgressSnapshot } from '../progress/progressSnapshot';
import { STAGE_ORDER, type Stage } from '../utils/constants';
import { isSceneInBook } from '../utils/books';
import { COMMUNITY_SHARE_FIELD_KEYS, normalizeCommunityShareSettings } from './communityShareSettings';

export const COMMUNITY_SHARE_REPORT_SCHEMA_VERSION = 'community-share-report-v1';

export interface CommunitySharePreviewBuild {
    payload: Record<string, unknown>;
    fieldManifest: Record<string, { enabled: boolean; tier: number; precision: string; public: boolean; sensitive: boolean }>;
    redactionManifest: Record<string, unknown>;
    reportPeriod: { start_date: string; end_date: string };
    payloadHash: string;
    previewHash: string;
    summary: string;
}

const FIELD_META: Record<CommunityShareFieldKey, { tier: number; precision: string; sensitive?: boolean }> = {
    'project.title': { tier: 2, precision: 'display' },
    'project.alias': { tier: 2, precision: 'display' },
    'project.description': { tier: 2, precision: 'display' },
    'project.status': { tier: 2, precision: 'display' },
    'project.genre': { tier: 2, precision: 'display' },
    'project.custom_genre_label': { tier: 2, precision: 'display' },
    'activity.report_period': { tier: 3, precision: 'coarse' },
    'activity.writing_days': { tier: 3, precision: 'aggregate' },
    'activity.minutes_total': { tier: 3, precision: 'rounded' },
    'activity.words_added': { tier: 3, precision: 'rounded' },
    'activity.session_count': { tier: 3, precision: 'bucketed' },
    'activity.mode_mix': { tier: 3, precision: 'coarse' },
    'activity.scenes_completed_by_stage': { tier: 3, precision: 'aggregate' },
    'activity.stage_mix': { tier: 4, precision: 'aggregate' },
    'activity.completed_scene_count': { tier: 4, precision: 'aggregate' },
    'activity.revised_scene_count': { tier: 4, precision: 'aggregate' },
    'activity.streak': { tier: 4, precision: 'rounded' },
    'structure.real_scene_titles': { tier: 5, precision: 'exact', sensitive: true },
    'activity.exact_session_timestamps': { tier: 5, precision: 'exact', sensitive: true }
};

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`;
}

function toHex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function canonicalHash(value: unknown): Promise<string> {
    return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))));
}

function localDateString(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function shiftDate(date: Date, days: number): Date {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + days);
    return copy;
}

function cleanPublicString(value: unknown, max = 240): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().replace(/\s+/g, ' ');
    return trimmed.length ? trimmed.slice(0, max) : undefined;
}

function roundTo(value: number, step: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value / step) * step;
}

function bucketCount(value: number): string {
    if (value <= 0) return '0';
    if (value <= 3) return '1-3';
    if (value <= 7) return '4-7';
    if (value <= 14) return '8-14';
    return '15+';
}

function percentMix(values: Record<string, number>): Record<string, number> {
    const total = Object.values(values).reduce((sum, value) => sum + Math.max(0, value), 0);
    if (total <= 0) return {};
    const out: Record<string, number> = {};
    Object.entries(values).forEach(([key, value]) => {
        if (value > 0) out[key] = Math.round((value / total) * 100);
    });
    return out;
}

function publicProjectTitle(book: BookProfile | undefined): string | undefined {
    return cleanPublicString(book?.publicLabel, 120);
}

/**
 * Current stage mix: every scene in the connected book counted by its
 * normalized publish stage — a point-in-time distribution, NOT filtered by
 * report period or completion. Reuses buildProgressSnapshot (the canonical
 * stage-distribution computation the timeline progress views render from),
 * so the published mix can never drift from what the plugin shows locally.
 */
function buildCurrentStageMix(scenes: TimelineItem[], book: BookProfile | undefined): Record<Stage, number> {
    const snapshot = buildProgressSnapshot(scenes.filter(scene => isSceneInBook(scene, book)));
    const mix = {} as Record<Stage, number>;
    STAGE_ORDER.forEach(stage => { mix[stage] = snapshot.stageStates[stage].sceneCount; });
    return mix;
}

function buildFieldValue(key: CommunityShareFieldKey, book: BookProfile | undefined, stats: WritingRangeStats, stageMix: Record<Stage, number>): unknown {
    const title = publicProjectTitle(book);
    const modeKeys: WritingSessionMode[] = ['drafting', 'revising', 'editing', 'planning'];
    switch (key) {
        case 'project.title':
        case 'project.alias':
            return title;
        case 'project.description':
            return cleanPublicString(book?.publicDescription, 500);
        case 'project.status':
            return cleanPublicString(book?.projectStage, 80);
        case 'project.genre':
        case 'project.custom_genre_label':
            return cleanPublicString(book?.genre, 80);
        case 'activity.report_period':
            return { label: 'Last 7 days', days: stats.days };
        case 'activity.writing_days':
            return stats.daysWithSessions;
        case 'activity.minutes_total':
            return roundTo(stats.minutesLogged, 5);
        case 'activity.words_added':
            return roundTo(stats.wordsDrafted, 50);
        case 'activity.session_count':
            return bucketCount(stats.sessionsCompleted);
        case 'activity.mode_mix':
            return percentMix(Object.fromEntries(modeKeys.map(mode => [mode, stats.minutesByMode[mode] ?? 0])));
        case 'activity.scenes_completed_by_stage':
            return stats.scenesCompletedByStage;
        case 'activity.stage_mix':
            return stageMix;
        case 'activity.completed_scene_count':
            return stats.freshScenesCompleted + stats.revisionScenesCompleted;
        case 'activity.revised_scene_count':
            return stats.revisionScenesCompleted;
        case 'activity.streak':
            return `${stats.daysWithSessions} writing day${stats.daysWithSessions === 1 ? '' : 's'} in the last 7`;
        default:
            return undefined;
    }
}

function shouldIncludeField(key: CommunityShareFieldKey, settings: CommunityShareSettings): boolean {
    const meta = FIELD_META[key];
    return settings.fieldPolicy[key] === true
        && settings.audience === 'public'
        && settings.tier >= meta.tier
        && meta.tier <= 4
        && meta.sensitive !== true;
}

/** One day of shared community activity — aggregates only, mirroring community_daily. */
export interface CommunityDailyEntry {
    date: string;
    minutes_total: number;
    session_count: number;
    words_added: number;
    scenes_completed_by_stage: Record<Stage, number>;
    mode_mix: Record<string, number>;
}

/** Days of daily aggregates sent per sync (server caps at 30). */
export const COMMUNITY_DAILY_WINDOW_DAYS = 14;

/**
 * Per-day activity aggregates for the community website's daily table.
 * Reuses buildDailyWritingStats — the canonical per-day computation the
 * plugin's own stats views render from — over the same vault-wide session
 * records and scene-completion events the weekly report payload uses, so
 * the shared numbers can never drift from what the plugin shows locally.
 *
 * Redaction matches the tier-4 report field policy exactly: minutes rounded
 * to 5, words rounded to 50, mode mix as coarse percentages, completed
 * scenes as per-stage counts. Aggregates only — no session rows, no
 * timestamps, no scene names or paths ever leave the vault.
 */
export async function buildCommunityDailyEntries(
    plugin: RadialTimelinePlugin,
    days: number = COMMUNITY_DAILY_WINDOW_DAYS
): Promise<CommunityDailyEntry[]> {
    const sessions = plugin.getWritingSessionService().getSettings().records;
    const scenes = await plugin.getSceneData();
    const modeKeys: WritingSessionMode[] = ['drafting', 'revising', 'editing', 'planning'];
    const entries: CommunityDailyEntry[] = [];
    for (let offset = days - 1; offset >= 0; offset--) {
        const date = localDateString(shiftDate(new Date(), -offset));
        const stats = buildDailyWritingStats({ date, sessions, scenes });
        entries.push({
            date,
            minutes_total: roundTo(stats.minutesLogged, 5),
            session_count: stats.sessionsCompleted,
            words_added: roundTo(stats.wordsDrafted, 50),
            scenes_completed_by_stage: stats.scenesCompletedByStage,
            mode_mix: percentMix(Object.fromEntries(modeKeys.map(mode => [mode, stats.minutesByMode[mode] ?? 0]))) // SAFE: a mode with no recorded minutes contributes 0 to the percentage mix
        });
    }
    return entries;
}

/**
 * Optional companion field on the daily sync payload: a trailing-28-day
 * (inclusive of today) rollup of session minutes by local start hour and
 * folded mode (drafting/revising/planning — `editing` folds into
 * `revising`), for the community "activity dial." Reads the same vault-wide
 * session records `buildCommunityDailyEntries` reads and delegates to the
 * canonical `buildCommunityHourModeMix` projection in WritingSessionLog, so
 * it can never drift from — or duplicate — the plugin's own session store.
 * Ships under the exact same tier-4 public gate as the rest of the daily
 * sync; callers must not send it under any other condition.
 */
export async function buildCommunityHourModeMixEntries(
    plugin: RadialTimelinePlugin
): Promise<Record<string, CommunityHourModeMinutes>> {
    const sessions = plugin.getWritingSessionService().getSettings().records;
    return buildCommunityHourModeMix({ records: sessions, endDate: localDateString() });
}

export async function buildCommunitySharePreview(plugin: RadialTimelinePlugin): Promise<CommunitySharePreviewBuild> {
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const book = plugin.settings.books.find(candidate => candidate.id === plugin.settings.activeBookId) ?? plugin.settings.books[0];
    const end = localDateString();
    const start = localDateString(shiftDate(new Date(), -6));
    const stats = await plugin.getWritingSessionService().getRangeStats(7, end);
    const scenes = await plugin.getSceneData();
    const stageMix = buildCurrentStageMix(scenes, book);

    const fieldManifest: CommunitySharePreviewBuild['fieldManifest'] = {};
    const payload: Record<string, unknown> = {};
    for (const key of COMMUNITY_SHARE_FIELD_KEYS) {
        const meta = FIELD_META[key];
        const enabled = shouldIncludeField(key, settings);
        fieldManifest[key] = {
            enabled,
            tier: meta.tier,
            precision: meta.precision,
            public: settings.audience === 'public',
            sensitive: meta.sensitive === true
        };
        if (!enabled) continue;
        const value = buildFieldValue(key, book, stats, stageMix);
        if (value !== undefined && value !== null && value !== '') {
            payload[key] = value;
        }
    }

    const redactionManifest = {};
    const reportPeriod = { start_date: start, end_date: end };
    const payloadHash = await canonicalHash({
        payload,
        field_manifest: fieldManifest,
        redaction_manifest: redactionManifest,
        tier: settings.tier,
        audience: settings.audience,
        profile_id: settings.connection.profileId ?? '',
        project_id: settings.connection.projectId ?? '',
        report_period: reportPeriod,
        schema_version: COMMUNITY_SHARE_REPORT_SCHEMA_VERSION
    });
    const previewHash = await canonicalHash({
        payload_hash: payloadHash,
        field_manifest: fieldManifest,
        redaction_manifest: redactionManifest,
        tier: settings.tier,
        audience: settings.audience,
        report_period: reportPeriod,
        schema_version: COMMUNITY_SHARE_REPORT_SCHEMA_VERSION
    });

    const included = Object.keys(payload).length;
    return {
        payload,
        fieldManifest,
        redactionManifest,
        reportPeriod,
        payloadHash,
        previewHash,
        summary: `${included} public field${included === 1 ? '' : 's'} ready for review.`
    };
}
