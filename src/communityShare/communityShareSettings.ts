import type {
    CommunityShareAudience,
    CommunityShareFieldKey,
    CommunityShareFieldPolicy,
    CommunityShareSettings,
    CommunityShareTier
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
export type CommunityShareMode = 'private' | 'profile_books' | 'progress';

export const COMMUNITY_SHARE_MODE_TIERS: Record<CommunityShareMode, CommunityShareTier> = {
    private: 0,
    profile_books: 2,
    progress: 4
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
    if (mode === 'progress') {
        for (const key of ACTIVITY_BUNDLE) policy[key] = true;
    }
    return policy;
}

export function deriveCommunityShareMode(settings: CommunityShareSettings): CommunityShareMode {
    if (!settings.enabled || settings.tier === 0) return 'private';
    return settings.tier >= 3 ? 'progress' : 'profile_books';
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

export function buildCommunityShareModeUpdate(mode: CommunityShareMode): Partial<CommunityShareSettings> {
    return {
        enabled: mode !== 'private',
        tier: COMMUNITY_SHARE_MODE_TIERS[mode],
        audience: mode === 'private' ? 'private_draft' : 'public',
        fieldPolicy: buildCommunityShareFieldPolicyForMode(mode)
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

export function normalizeCommunityShareSettings(input?: Partial<CommunityShareSettings>): CommunityShareSettings {
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
            secretId: connection.secretId
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
        lastError: input?.lastError
    };
}
