import type {
    CommunityBookTransferRecord,
    CommunityDailyBackfillRecord,
    CommunityDeskLampsRecord,
    CommunityShareAudience,
    CommunityServerDisconnect,
    CommunityShareConnectionSettings,
    CommunityShareFieldKey,
    CommunityShareFieldPolicy,
    CommunityShareSettings,
    CommunityShareTier,
    CommunitySharingNoticeOwed,
    CommunityTimelineShareRecord
} from '../types/settings';

export const COMMUNITY_SHARE_SCHEMA_VERSION = 1;

export const COMMUNITY_SHARE_FIELD_KEYS: CommunityShareFieldKey[] = [
    'project.title',
    'project.alias',
    'project.description',
    'project.status',
    'project.genre',
    'project.custom_genre_label',
    'activity.report_period',
    'activity.writing_days',
    'activity.minutes_total',
    'activity.words_added',
    'activity.session_count',
    'activity.mode_mix',
    'activity.scenes_completed_by_stage',
    'activity.stage_mix',
    'activity.completed_scene_count',
    'activity.revised_scene_count',
    'activity.streak',
    'structure.real_scene_titles',
    'activity.exact_session_timestamps'
];

export function buildDefaultCommunityShareFieldPolicy(): CommunityShareFieldPolicy {
    return {
        'project.title': false,
        'project.alias': false,
        'project.description': false,
        'project.status': false,
        'project.genre': false,
        'project.custom_genre_label': false,
        'activity.report_period': false,
        'activity.writing_days': false,
        'activity.minutes_total': false,
        'activity.words_added': false,
        'activity.session_count': false,
        'activity.mode_mix': false,
        'activity.scenes_completed_by_stage': false,
        'activity.stage_mix': false,
        'activity.completed_scene_count': false,
        'activity.revised_scene_count': false,
        'activity.streak': false,
        'structure.real_scene_titles': false,
        'activity.exact_session_timestamps': false
    };
}

// Author-facing sharing modes (bundle-level opt-in per the amended product
// contract). Tiers and field manifests stay the wire-level machinery.
export type CommunityShareMode = 'private' | 'profile_books' | 'progress' | 'scene_text';

/**
 * What Level 4 shares besides the scene text the author releases: the level
 * below it whose report it also sends. Eric called Level 4 "the final level"
 * (2026-11-22), so it includes Level 3's writing activity; whether it should is
 * his open question, and this is the one line to change.
 */
export const SCENE_TEXT_LEVEL_INCLUDES: 'profile_books' | 'progress' = 'progress';

/**
 * Whether a level shares writing activity: Level 3, and Level 4 when it
 * includes Level 3 (SCENE_TEXT_LEVEL_INCLUDES). The one answer to that
 * question: the tier, the field policy, the sharing details and the session
 * feed all ask it here.
 */
export function modeIncludesActivity(mode: CommunityShareMode): boolean {
    return mode === 'progress' || (mode === 'scene_text' && SCENE_TEXT_LEVEL_INCLUDES === 'progress');
}

export const COMMUNITY_SHARE_MODE_TIERS: Record<CommunityShareMode, CommunityShareTier> = {
    private: 0,
    profile_books: 2,
    progress: 4,
    scene_text: modeIncludesActivity('scene_text') ? 4 : 2
};

const PROJECT_BUNDLE: CommunityShareFieldKey[] = [
    'project.title',
    'project.alias',
    'project.description',
    'project.status',
    'project.genre',
    'project.custom_genre_label'
];

const ACTIVITY_BUNDLE: CommunityShareFieldKey[] = [
    'activity.report_period',
    'activity.writing_days',
    'activity.minutes_total',
    'activity.words_added',
    'activity.session_count',
    'activity.mode_mix',
    'activity.scenes_completed_by_stage',
    'activity.stage_mix',
    'activity.completed_scene_count',
    'activity.revised_scene_count',
    'activity.streak'
];

export function buildCommunityShareFieldPolicyForMode(mode: CommunityShareMode): CommunityShareFieldPolicy {
    const policy = buildDefaultCommunityShareFieldPolicy();
    if (mode === 'private') return policy;
    for (const key of PROJECT_BUNDLE) policy[key] = true;
    if (modeIncludesActivity(mode)) {
        for (const key of ACTIVITY_BUNDLE) policy[key] = true;
    }
    return policy;
}

export function deriveCommunityShareMode(settings: CommunityShareSettings): CommunityShareMode {
    if (!settings.enabled || settings.tier === 0) return 'private';
    if (settings.sceneTextLevel === true) return 'scene_text';
    return settings.tier >= 3 ? 'progress' : 'profile_books';
}

/**
 * Whether the daily sync sends per-day totals and the writing-time pattern:
 * a level that shares writing activity, at tier 4 (the gate the daily sync
 * checks). Review sharing details lists them whenever this is true.
 */
export function sendsDailyActivity(settings: CommunityShareSettings): boolean {
    return modeIncludesActivity(deriveCommunityShareMode(settings)) && settings.tier === 4;
}

/**
 * Level 4: the plugin may list the scenes asked for on Community and send one
 * on the author's press. Below it, nothing about scene text is read or sent.
 */
export function canShareSceneText(settings: CommunityShareSettings): boolean {
    return canShareTimelineToCommunity(settings) && deriveCommunityShareMode(settings) === 'scene_text';
}

/** Settings whose vault holds a live Community connection with a stored secret. */
export type ActiveCommunityShareSettings = CommunityShareSettings & {
    connection: CommunityShareConnectionSettings & { status: 'connected'; connectionId: string; secretId: string };
};

/**
 * A live connection with a stored secret, at ANY sharing level, Private
 * included. Used on its own only where nothing about the author's books or
 * progress is sent: Desk Lamps (plan D12: a Desk Lamp needs a connected vault,
 * not a sharing level) and the title-bar Mailbox, which only reads. Every
 * sharing call goes through hasActiveCommunityConnection.
 */
export function hasCommunityConnection(settings: CommunityShareSettings): settings is ActiveCommunityShareSettings {
    return settings.connection.status === 'connected'
        && Boolean(settings.connection.connectionId)
        && Boolean(settings.connection.secretId);
}

/**
 * The "this vault shares" check: Community on (any level but an explicitly
 * chosen Private), connected, with a connection id and a stored secret id.
 * Every sharing call (requireActiveConnection, report publish, project shell
 * sync) uses it, so choosing Private stops them all.
 */
export function hasActiveCommunityConnection(settings: CommunityShareSettings): settings is ActiveCommunityShareSettings {
    return settings.enabled && hasCommunityConnection(settings);
}

/**
 * The vault is expected to keep its Book Manager list synced to the Community
 * website (community-project-sync): Community on, sharing not paused, and a
 * live connection with a stored secret. The load and settings-edit syncs run
 * only in this state, and the Mailbox shows its Community sync row only in it.
 */
export function expectsBookListSync(settings: CommunityShareSettings): settings is ActiveCommunityShareSettings {
    return hasActiveCommunityConnection(settings) && !settings.sharingPaused;
}

type BookListSyncFields = Pick<CommunityShareConnectionSettings, 'bookListSyncedAt' | 'bookListSyncError' | 'bookListSyncFailedAt'>;

/** The book-list sync record: ISO times and a message, each kept only when it is a non-empty string. */
function normalizeBookListSync(connection: Partial<CommunityShareConnectionSettings>): BookListSyncFields {
    const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
    const syncedAt = text(connection.bookListSyncedAt);
    const error = text(connection.bookListSyncError);
    const failedAt = text(connection.bookListSyncFailedAt);
    return {
        ...(syncedAt ? { bookListSyncedAt: syncedAt } : {}),
        // A failure is the error and its time together; half of one is dropped.
        ...(error && failedAt ? { bookListSyncError: error, bookListSyncFailedAt: failedAt } : {})
    };
}

/** APR is a curated project artifact available from Level 2 upward. */
export function canShareAprToCommunity(settings: CommunityShareSettings): boolean {
    return settings.enabled
        && !settings.sharingPaused
        && settings.connection.status === 'connected'
        && settings.audience === 'public'
        && settings.tier >= 2
        && settings.tier <= 4;
}

/** A timeline is a curated project artifact too, so it follows the APR's level. */
export function canShareTimelineToCommunity(settings: CommunityShareSettings): boolean {
    return canShareAprToCommunity(settings);
}

export function buildCommunityShareModeUpdate(mode: CommunityShareMode): Partial<CommunityShareSettings> {
    return {
        enabled: mode !== 'private',
        tier: COMMUNITY_SHARE_MODE_TIERS[mode],
        audience: mode === 'private' ? 'private_draft' : 'public',
        fieldPolicy: buildCommunityShareFieldPolicyForMode(mode),
        sceneTextLevel: mode === 'scene_text'
    };
}

export function buildDefaultCommunityShareSettings(): CommunityShareSettings {
    return {
        schemaVersion: COMMUNITY_SHARE_SCHEMA_VERSION,
        enabled: false,
        tier: 0,
        audience: 'private_draft',
        manualPublishEnabled: true,
        scheduledPublishEnabled: false,
        sharingPaused: false,
        sceneTextLevel: false,
        workingNowEnabled: false,
        fieldPolicy: buildDefaultCommunityShareFieldPolicy(),
        redactionPolicy: {},
        connection: {
            status: 'disconnected'
        },
        preview: {
            status: 'not_generated'
        },
        publishHistory: []
    };
}

function coerceTier(value: unknown): CommunityShareTier {
    // Nothing produces tier 5, and publish requires tier <= 4 — a persisted 5
    // would silently lock publishing (publish_locked) with no author-visible
    // cause. Clamp it to the highest publishable tier instead of leaving it
    // stuck.
    if (value === 5) return 4;
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : 0; // SAFE: sharing-tier allowlist — anything unrecognized normalizes to 0 (share nothing), the fail-closed privacy default
}

function coerceAudience(value: unknown): CommunityShareAudience {
    return value === 'public'
        || value === 'followers'
        || value === 'trusted_authors'
        || value === 'private_link'
        || value === 'private_draft'
        ? value
        : 'private_draft';
}

function normalizeDailyBackfill(value: unknown): CommunityDailyBackfillRecord | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Partial<CommunityDailyBackfillRecord>;
    if (typeof record.version !== 'number' || !Number.isInteger(record.version)) return undefined;
    if (typeof record.profileId !== 'string' || !record.profileId) return undefined;
    if (typeof record.connectionId !== 'string' || !record.connectionId) return undefined;
    if (typeof record.wordsIncluded !== 'boolean') return undefined;
    return {
        version: record.version,
        profileId: record.profileId,
        connectionId: record.connectionId,
        wordsIncluded: record.wordsIncluded
    };
}

/** A website id (project, question): only a UUID becomes part of a link. */
export const COMMUNITY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeDeskLamps(value: unknown): CommunityDeskLampsRecord | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Partial<CommunityDeskLampsRecord>;
    if (typeof record.profileId !== 'string' || !record.profileId) return undefined;
    const audience: string[] = [];
    for (const id of Array.isArray(record.audience) ? record.audience : []) {
        if (typeof id !== 'string' || !COMMUNITY_UUID_RE.test(id)) continue;
        const lower = id.toLowerCase();
        if (!audience.includes(lower)) audience.push(lower);
    }
    return {
        profileId: record.profileId,
        audience,
        ...(typeof record.activeSessionId === 'string' && record.activeSessionId ? { activeSessionId: record.activeSessionId } : {})
    };
}

function normalizeSceneIdPaths(value: unknown): { sceneIdPaths: Record<string, string> } | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const paths: Record<string, string> = {};
    for (const [id, path] of Object.entries(value as Record<string, unknown>)) {
        if (id && typeof path === 'string' && path) paths[id] = path;
    }
    return Object.keys(paths).length > 0 ? { sceneIdPaths: paths } : undefined;
}

function normalizeTimelineShares(value: unknown): Record<string, CommunityTimelineShareRecord> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const records: Record<string, CommunityTimelineShareRecord> = {};
    for (const [bookId, raw] of Object.entries(value as Record<string, unknown>)) {
        const record = raw as Partial<CommunityTimelineShareRecord> | null;
        if (!bookId || !record || typeof record.profileId !== 'string' || !record.profileId) continue;
        records[bookId] = {
            profileId: record.profileId,
            enabled: record.enabled === true,
            ...(typeof record.lastSentHash === 'string' ? { lastSentHash: record.lastSentHash } : {}),
            ...(typeof record.lastSentAt === 'string' ? { lastSentAt: record.lastSentAt } : {}),
            ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
            ...(Array.isArray(record.droppedReveals)
                ? { droppedReveals: record.droppedReveals.filter((n): n is number => Number.isInteger(n)) }
                : {}),
            ...(Number.isInteger(record.scenesWithoutStableId) ? { scenesWithoutStableId: record.scenesWithoutStableId } : {}),
            ...(normalizeSceneIdPaths(record.sceneIdPaths) ?? {}), // SAFE: a share record saved before sceneIdPaths existed holds none
            ...(record.enabled !== true && isTime(record.updatesStoppedAt) ? { updatesStoppedAt: record.updatesStoppedAt } : {}),
            ...normalizeUpdatesNotice(record.updatesNoticeOwed),
        };
    }
    return Object.keys(records).length > 0 ? records : undefined;
}

const isTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function normalizeUpdatesNotice(value: unknown): Pick<CommunityTimelineShareRecord, 'updatesNoticeOwed'> {
    if (!value || typeof value !== 'object') return {};
    const owed = value as { action?: unknown; stoppedAt?: unknown };
    if (owed.action !== 'stop' && owed.action !== 'resume') return {};
    return { updatesNoticeOwed: { action: owed.action, ...(isTime(owed.stoppedAt) ? { stoppedAt: owed.stoppedAt } : {}) } };
}

function normalizeSharingNotice(value: unknown): CommunitySharingNoticeOwed | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const owed = value as { action?: unknown; pausedAt?: unknown };
    if (owed.action !== 'pause' && owed.action !== 'resume') return undefined;
    // A pause is told with its own time; one without a time cannot be told.
    if (owed.action === 'pause' && !isTime(owed.pausedAt)) return undefined;
    return { action: owed.action, ...(isTime(owed.pausedAt) ? { pausedAt: owed.pausedAt } : {}) };
}

function normalizeServerDisconnect(value: unknown): CommunityServerDisconnect | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Partial<CommunityServerDisconnect>;
    return {
        at: isTime(record.at) ? record.at : null,
        by: record.by === 'vault' || record.by === 'community' || record.by === 'system' ? record.by : null,
        cause: record.cause === 'new_connection' ? 'new_connection' : 'disconnect',
    };
}

export const COMMUNITY_BOOK_TRANSFER_SCHEMA_VERSION = 1;

const BOOK_TRANSFER_PHASES: ReadonlySet<unknown> = new Set(['writing', 'written', 'cancelled']);

/**
 * Book-from-Community records, field by field. A record of another schema
 * version, or with a field missing, is dropped: a run with no record writes
 * into no existing folder, so a dropped record can never cause a second write.
 */
function normalizeBookTransfers(value: unknown): Record<string, CommunityBookTransferRecord> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const text = (field: unknown): field is string => typeof field === 'string' && field.length > 0;
    const records: Record<string, CommunityBookTransferRecord> = {};
    for (const [transferId, raw] of Object.entries(value as Record<string, unknown>)) {
        const record = raw as Partial<CommunityBookTransferRecord> | null;
        if (!COMMUNITY_UUID_RE.test(transferId) || !record || record.schemaVersion !== COMMUNITY_BOOK_TRANSFER_SCHEMA_VERSION) continue;
        if (!text(record.profileId) || !text(record.connectionId) || !text(record.bookId) || !text(record.folder) || !text(record.title)) continue;
        if (!BOOK_TRANSFER_PHASES.has(record.phase) || !text(record.startedAt)) continue;
        const notes: Record<string, string> = {};
        if (record.notes && typeof record.notes === 'object' && !Array.isArray(record.notes)) {
            for (const [sceneId, path] of Object.entries(record.notes as Record<string, unknown>)) {
                if (sceneId && text(path)) notes[sceneId] = path;
            }
        }
        records[transferId.toLowerCase()] = {
            schemaVersion: COMMUNITY_BOOK_TRANSFER_SCHEMA_VERSION,
            profileId: record.profileId,
            connectionId: record.connectionId,
            bookId: record.bookId,
            folder: record.folder,
            title: record.title,
            folderCreated: record.folderCreated === true,
            notes,
            phase: record.phase as CommunityBookTransferRecord['phase'], // SAFE: checked against BOOK_TRANSFER_PHASES above
            startedAt: record.startedAt,
        };
    }
    return Object.keys(records).length > 0 ? records : undefined;
}

/**
 * The book-from-Community records of the connected profile and connection,
 * as [transfer id, record]. A record made for another account or connection is
 * ignored, as timelineShareFor ignores one.
 */
export function bookTransferRecords(settings: CommunityShareSettings): Array<[string, CommunityBookTransferRecord]> {
    const { profileId, connectionId } = settings.connection;
    if (!profileId || !connectionId) return [];
    return Object.entries(settings.bookTransfers ?? {}) // SAFE: no record means no book is on its way
        .filter(([, record]) => record.profileId === profileId && record.connectionId === connectionId);
}

/** One transfer's record for the connected profile and connection. */
export function bookTransferFor(settings: CommunityShareSettings, transferId: string): CommunityBookTransferRecord | undefined {
    return bookTransferRecords(settings).find(([id]) => id === transferId.toLowerCase())?.[1];
}

/**
 * This book's timeline record for the connected profile. A record made for
 * another account is ignored, the way deskLampChoices ignores one: consent was
 * given to send to that account, not this one.
 */
export function timelineShareFor(settings: CommunityShareSettings, bookId: string): CommunityTimelineShareRecord | undefined {
    const record = settings.timelineShares?.[bookId];
    if (!record || !settings.connection.profileId || record.profileId !== settings.connection.profileId) return undefined;
    return record;
}

/**
 * The Desk Lamps choices for the connected profile. A record made for another
 * profile (a different account connected since) is ignored, so its friends are
 * never pre-ticked and its session never lit for the new profile.
 */
export function deskLampChoices(settings: CommunityShareSettings): { audience: string[]; activeSessionId?: string } {
    const record = settings.deskLamps;
    if (!record || !settings.connection.profileId || record.profileId !== settings.connection.profileId) return { audience: [] };
    return { audience: record.audience, activeSessionId: record.activeSessionId };
}

export function normalizeCommunityShareSettings(raw?: Partial<CommunityShareSettings>): CommunityShareSettings {
    // Legacy `dailyBackfillVersion` (unreleased, PR #44) was one scalar per
    // vault: it cannot say which profile/connection received the backfill or
    // whether words were in it, and it survived activating a different
    // connection — the exact misattribution it is being replaced for. It is
    // dropped rather than migrated, so a vault holding it re-sends the season
    // backfill once under the current gates. That re-send is idempotent on the
    // server (per-day upsert) and fully consented at send time; attributing
    // the scalar to the current connection could instead mark a profile that
    // never received the backfill as complete.
    let input: Partial<CommunityShareSettings> | undefined;
    if (raw) {
        const copy: Partial<CommunityShareSettings> & { dailyBackfillVersion?: unknown; sceneBodyShares?: unknown } = { ...raw };
        delete copy.dailyBackfillVersion;
        // The per-book Share scene body switch is gone (2026-11-22). An author
        // who had it on chooses Level 4: carrying it over would share more than
        // was agreed to.
        delete copy.sceneBodyShares;
        input = copy;
    }
    const defaults = buildDefaultCommunityShareSettings();
    const fieldPolicy = buildDefaultCommunityShareFieldPolicy();
    const incomingPolicy: Partial<CommunityShareFieldPolicy> = input?.fieldPolicy ?? {};
    for (const key of COMMUNITY_SHARE_FIELD_KEYS) {
        fieldPolicy[key] = incomingPolicy[key] === true;
    }

    const connection = input?.connection ?? defaults.connection;
    const preview = input?.preview ?? defaults.preview;
    const publishHistory = Array.isArray(input?.publishHistory)
        ? input.publishHistory.slice(-25)
        : [];

    return {
        ...defaults,
        ...input,
        schemaVersion: COMMUNITY_SHARE_SCHEMA_VERSION,
        enabled: input?.enabled === true,
        tier: coerceTier(input?.tier),
        audience: coerceAudience(input?.audience),
        manualPublishEnabled: input?.manualPublishEnabled !== false,
        // Standing share state: true while the author has sharing turned on
        // (set by Begin sharing, cleared by Pause/Revoke/Delete/Disconnect).
        scheduledPublishEnabled: input?.scheduledPublishEnabled === true,
        // Hard-freeze flag: absent in pre-existing data normalizes to false,
        // so an untouched connection keeps its current behavior.
        sharingPaused: input?.sharingPaused === true,
        sharingPausedAt: input?.sharingPaused === true && isTime(input.sharingPausedAt) ? input.sharingPausedAt : undefined,
        sharingNoticeOwed: normalizeSharingNotice(input?.sharingNoticeOwed),
        sceneTextLevel: input?.sceneTextLevel === true,
        sceneTextTermsVersion: typeof input?.sceneTextTermsVersion === 'string' && input.sceneTextTermsVersion ? input.sceneTextTermsVersion : undefined,
        workingNowEnabled: false,
        fieldPolicy,
        redactionPolicy: input?.redactionPolicy && typeof input.redactionPolicy === 'object' ? input.redactionPolicy : {},
        connection: {
            status: connection.status ?? 'disconnected',
            connectionId: connection.connectionId,
            activationTokenId: connection.activationTokenId,
            profileId: connection.profileId,
            projectId: connection.projectId,
            publicSlug: connection.publicSlug,
            connectedAt: connection.connectedAt,
            lastSyncedAt: connection.lastSyncedAt,
            lastSyncedPayloadHash: connection.lastSyncedPayloadHash,
            disconnectedAt: connection.disconnectedAt,
            // Community's word on a disconnect stands only while this vault is disconnected.
            serverDisconnect: connection.status === 'disconnected' ? normalizeServerDisconnect(connection.serverDisconnect) : undefined,
            secretId: connection.secretId,
            ...normalizeBookListSync(connection)
        },
        preview: {
            status: preview.status ?? 'not_generated',
            generatedAt: preview.generatedAt,
            previewHash: preview.previewHash,
            payloadHash: preview.payloadHash,
            reportPeriod: preview.reportPeriod,
            summary: preview.summary
        },
        publishHistory,
        lastError: input?.lastError,
        dailyBackfill: normalizeDailyBackfill(input?.dailyBackfill),
        deskLamps: normalizeDeskLamps(input?.deskLamps),
        timelineShares: normalizeTimelineShares(input?.timelineShares),
        bookTransfers: normalizeBookTransfers(input?.bookTransfers)
    };
}
