import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { deleteSecret, getSecret, isSecretStorageAvailable, setSecret } from '../ai/credentials/secretStorage';
import { normalizeCommunityShareSettings } from './communityShareSettings';
import { COMMUNITY_SHARE_REPORT_SCHEMA_VERSION, buildCommunityDailyEntries, buildCommunitySharePreview } from './communitySharePreview';
import type { CommunitySharePublishHistoryEntry, CommunityShareSettings } from '../types/settings';

const FUNCTIONS_BASE_URL = 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/functions/v1';
const INSTALLATION_SECRET_ID = 'rt.community-share.installation-id';
const CONNECTION_SECRET_ID = 'rt.community-share.connection-secret';

interface ActivationConfirmSuccess {
    connection_id: string;
    connection_secret: string;
    secret_expires_at: string | null;
    profile_id: string;
    project_id: string;
    profile_display?: string;
    project_title?: string;
}

interface ActivationConfirmError {
    error?: {
        code?: string;
        message?: string;
    };
}

interface PublishSuccess {
    ok: true;
    publish_id: string;
    version_id: string;
    public_slug: string;
    status: string;
    published_at: string;
    superseded_version_id?: string | null;
}

interface ReportActionSuccess {
    ok: true;
    publish_id?: string;
    connection_id?: string;
    status: string;
    revoked_at?: string;
    deleted_at?: string;
    disconnected_at?: string;
    mode?: string;
    affected_publishes?: number;
    tombstoned?: boolean;
}

export class CommunityShareError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'CommunityShareError';
        this.code = code;
    }
}

function randomBase64Url(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
    return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function parseResponseJson(text: string): unknown {
    if (!text.trim()) return {};
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function isActivationConfirmSuccess(value: unknown): value is ActivationConfirmSuccess {
    const body = value as Partial<ActivationConfirmSuccess>;
    return typeof body?.connection_id === 'string'
        && typeof body.connection_secret === 'string'
        && typeof body.profile_id === 'string'
        && typeof body.project_id === 'string';
}

function isPublishSuccess(value: unknown): value is PublishSuccess {
    const body = value as Partial<PublishSuccess>;
    return body?.ok === true
        && typeof body.publish_id === 'string'
        && typeof body.version_id === 'string'
        && typeof body.public_slug === 'string'
        && typeof body.published_at === 'string';
}

function isReportActionSuccess(value: unknown): value is ReportActionSuccess {
    const body = value as Partial<ReportActionSuccess>;
    return body?.ok === true && typeof body.status === 'string';
}

function connectionSecretId(): string {
    return CONNECTION_SECRET_ID;
}

function latestPublishId(settings: CommunityShareSettings): string | null {
    for (let index = settings.publishHistory.length - 1; index >= 0; index--) {
        const entry = settings.publishHistory[index];
        if ((entry?.action === 'publish' || entry?.action === 'sync') && entry.status === 'success' && entry.publishId) {
            return entry.publishId;
        }
    }
    return null;
}

async function getConnectedSecret(plugin: RadialTimelinePlugin, settings: CommunityShareSettings): Promise<string> {
    if (!settings.connection.connectionId || !settings.connection.secretId) {
        throw new CommunityShareError('connection_required', 'Connect Community Share first.');
    }
    const secret = await getSecret(plugin.app, settings.connection.secretId);
    if (!secret) {
        throw new CommunityShareError('connection_secret_missing', 'The private connection secret is missing. Reconnect Community Share.');
    }
    return secret;
}

function appendHistory(
    settings: CommunityShareSettings,
    entry: CommunitySharePublishHistoryEntry
): CommunitySharePublishHistoryEntry[] {
    return [...settings.publishHistory, entry].slice(-25);
}

async function getOrCreateInstallationId(plugin: RadialTimelinePlugin): Promise<string> {
    const existing = await getSecret(plugin.app, INSTALLATION_SECRET_ID);
    if (existing) return existing;

    const next = `rtpi_${randomBase64Url(24)}`;
    const stored = await setSecret(plugin.app, INSTALLATION_SECRET_ID, next);
    if (!stored) {
        throw new CommunityShareError('secret_storage_unavailable', 'Private secret storage is unavailable, so Community Share cannot connect safely.');
    }
    return next;
}

async function cleanupUnstoredConnection(connectionId: string, currentSecret: string): Promise<void> {
    try {
        await requestUrl({
            url: `${FUNCTIONS_BASE_URL}/community-share-disconnect`,
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify({
                connection_id: connectionId,
                current_secret: currentSecret,
                mode: 'disconnect_only'
            }),
            throw: false
        });
    } catch {
        // Best effort only. The user can generate a fresh website connection code.
    }
}

export async function confirmCommunityShareActivation(
    plugin: RadialTimelinePlugin,
    activationToken: string
): Promise<ActivationConfirmSuccess> {
    const token = activationToken.trim();
    if (token.length < 16) {
        throw new CommunityShareError('invalid_activation_token', 'Paste the full connection code from the website.');
    }
    if (!isSecretStorageAvailable(plugin.app)) {
        throw new CommunityShareError('secret_storage_unavailable', 'Private secret storage is unavailable, so Community Share cannot connect safely.');
    }

    const installationId = await getOrCreateInstallationId(plugin);
    const pluginInstallationIdHash = await sha256Hex(installationId);
    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/community-activation-confirm`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
            activation_token: token,
            plugin_installation_id_hash: pluginInstallationIdHash
        }),
        throw: false
    });

    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const body = parsed as ActivationConfirmError;
        throw new CommunityShareError(
            body.error?.code || 'activation_failed',
            body.error?.message || 'Community connection failed. Generate a new code and try again.'
        );
    }
    if (!isActivationConfirmSuccess(parsed)) {
        throw new CommunityShareError('invalid_response', 'Community connection returned an unexpected response.');
    }

    const secretId = connectionSecretId();
    const storedSecret = await setSecret(plugin.app, secretId, parsed.connection_secret);
    const verifiedSecret = storedSecret ? await getSecret(plugin.app, secretId) : null;
    if (verifiedSecret !== parsed.connection_secret) {
        await cleanupUnstoredConnection(parsed.connection_id, parsed.connection_secret);
        throw new CommunityShareError(
            'secret_storage_failed',
            'The website connection was confirmed, but RT could not save it locally. Generate a new connection code and try again.'
        );
    }

    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        enabled: true,
        connection: {
            ...current.connection,
            status: 'connected',
            connectionId: parsed.connection_id,
            profileId: parsed.profile_id,
            projectId: parsed.project_id,
            connectedAt: new Date().toISOString(),
            lastSyncedAt: new Date().toISOString(),
            secretId
        },
        preview: {
            ...current.preview,
            status: 'stale'
        },
        lastError: undefined
    });
    await plugin.saveSettings();
    return parsed;
}

export async function publishCommunityShareReport(
    plugin: RadialTimelinePlugin,
    mode: 'manual' | 'scheduled' = 'manual'
): Promise<PublishSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) {
        throw new CommunityShareError('connection_required', 'Connect Community Share before sharing.');
    }
    if (current.audience !== 'public' || current.tier < 1 || current.tier > 4 || current.manualPublishEnabled !== true) {
        throw new CommunityShareError('publish_locked', 'Sharing requires a public sharing level.');
    }
    if (current.preview.status !== 'ready' || !current.preview.previewHash || !current.preview.payloadHash) {
        throw new CommunityShareError('preview_required', 'Review the complete preview in the sharing settings before sharing.');
    }

    const currentSecret = await getSecret(plugin.app, current.connection.secretId);
    if (!currentSecret) {
        throw new CommunityShareError('connection_secret_missing', 'The private connection secret is missing. Reconnect Community Share.');
    }

    const preview = await buildCommunitySharePreview(plugin);
    if (preview.previewHash !== current.preview.previewHash || preview.payloadHash !== current.preview.payloadHash) {
        throw new CommunityShareError('preview_stale', 'The complete preview is out of date. Reopen the sharing settings to refresh it, then try again.');
    }

    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/community-share-publish`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
            connection_id: current.connection.connectionId,
            current_secret: currentSecret,
            publish_mode: mode,
            audience: 'public',
            tier: current.tier,
            field_manifest: preview.fieldManifest,
            redaction_manifest: preview.redactionManifest,
            payload: preview.payload,
            schema_version: COMMUNITY_SHARE_REPORT_SCHEMA_VERSION,
            preview_hash: preview.previewHash,
            report_period: preview.reportPeriod
        }),
        throw: false
    });

    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const body = parsed as ActivationConfirmError;
        throw new CommunityShareError(
            body.error?.code || 'publish_failed',
            body.error?.message || 'Community sharing failed. Review the preview and try again.'
        );
    }
    if (!isPublishSuccess(parsed)) {
        throw new CommunityShareError('invalid_response', 'Community sharing returned an unexpected response.');
    }

    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        connection: {
            ...current.connection,
            publicSlug: parsed.public_slug,
            lastSyncedAt: parsed.published_at,
            lastSyncedPayloadHash: preview.payloadHash
        },
        preview: {
            ...current.preview,
            status: 'stale'
        },
        publishHistory: [
            ...current.publishHistory,
            {
                id: parsed.version_id,
                action: mode === 'scheduled' ? 'sync' : 'publish',
                status: 'success',
                at: parsed.published_at,
                publishId: parsed.publish_id,
                versionId: parsed.version_id,
                publicSlug: parsed.public_slug,
                message: mode === 'scheduled' ? 'Shared data refreshed automatically.' : 'Sharing published to the community site.'
            }
        ],
        lastError: undefined
    });
    await plugin.saveSettings();
    return parsed;
}

interface AprUploadSuccess {
    ok: boolean;
    status: 'private' | 'active';
    teaser_level: string;
    public_url: string | null;
    updated_at: string;
}

interface ProjectSyncSuccess {
    ok: boolean;
    created: number;
    updated: number;
    projects: Array<{ id: string; book_key: string; title: string; visibility: string }>;
}

export interface CommunityShareContextProfile {
    handle: string | null;
    display_name: string | null;
    avatar_url: string | null;
    member_role: string | null;
}

export interface CommunityShareContextProject {
    id: string;
    plugin_book_key: string | null;
    title: string;
    logline: string | null;
    status: string | null;
    genre_l1: string | null;
    genre_l2: string | null;
    genre_l3: string | null;
    custom_genre_label: string | null;
    visibility: string;
}

export interface CommunityShareContext {
    ok: true;
    connected_project_id: string | null;
    profile: CommunityShareContextProfile | null;
    projects: CommunityShareContextProject[];
}

function isAprUploadSuccess(value: unknown): value is AprUploadSuccess {
    const v = value as AprUploadSuccess;
    return !!v && v.ok === true && (v.status === 'private' || v.status === 'active');
}

function isProjectSyncSuccess(value: unknown): value is ProjectSyncSuccess {
    const v = value as ProjectSyncSuccess;
    return !!v && v.ok === true && Array.isArray(v.projects);
}

function isCommunityShareContext(value: unknown): value is CommunityShareContext {
    const v = value as CommunityShareContext;
    return !!v && v.ok === true && Array.isArray(v.projects);
}

async function requireActiveConnection(plugin: RadialTimelinePlugin): Promise<{
    connectionId: string;
    projectId: string;
    currentSecret: string;
}> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId || !current.connection.projectId) {
        throw new CommunityShareError('connection_required', 'Connect Community Share before syncing with the website.');
    }
    const currentSecret = await getSecret(plugin.app, current.connection.secretId);
    if (!currentSecret) {
        throw new CommunityShareError('connection_secret_missing', 'The private connection secret is missing. Reconnect Community Share.');
    }
    return {
        connectionId: current.connection.connectionId,
        projectId: current.connection.projectId,
        currentSecret
    };
}

/**
 * Send a campaign's rendered APR (portable SVG) to the community website.
 * The artifact arrives PRIVATE on the author's My Share page; activating
 * public display is a website-only action per the share-surfaces contract.
 */
export async function uploadAprToCommunity(
    plugin: RadialTimelinePlugin,
    args: { svg: string; width: number; height: number; teaserLevel: 'ring' | 'scenes' | 'colors' | 'full'; campaignLabel?: string }
): Promise<AprUploadSuccess> {
    const { connectionId, projectId, currentSecret } = await requireActiveConnection(plugin);

    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/community-apr-upload`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
            connection_id: connectionId,
            current_secret: currentSecret,
            project_id: projectId,
            teaser_level: args.teaserLevel,
            svg: args.svg,
            width: args.width,
            height: args.height,
            campaign_label: args.campaignLabel?.slice(0, 60)
        }),
        throw: false
    });

    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const body = parsed as ActivationConfirmError;
        throw new CommunityShareError(
            body.error?.code || 'apr_upload_failed',
            body.error?.message || 'Could not send the progress report to the community site.'
        );
    }
    if (!isAprUploadSuccess(parsed)) {
        throw new CommunityShareError('invalid_response', 'The progress report upload returned an unexpected response.');
    }
    return parsed;
}

/**
 * Read the canonical website-managed share identity a publish attaches to:
 * profile identity plus each project shell's public fields (title, logline,
 * status, genre path, custom genre label, visibility). READ-only — the
 * Complete Preview renders these as "From your website profile" instead of
 * plugin-local stand-ins.
 */
export async function fetchCommunityShareContext(plugin: RadialTimelinePlugin): Promise<CommunityShareContext> {
    const { connectionId, currentSecret } = await requireActiveConnection(plugin);

    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/community-share-context`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
            connection_id: connectionId,
            current_secret: currentSecret
        }),
        throw: false
    });

    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const body = parsed as ActivationConfirmError;
        throw new CommunityShareError(
            body.error?.code || 'share_context_failed',
            body.error?.message || 'Could not load your public profile from the website.'
        );
    }
    if (!isCommunityShareContext(parsed)) {
        throw new CommunityShareError('invalid_response', 'The website profile lookup returned an unexpected response.');
    }
    return parsed;
}

/**
 * Sync every Book Manager book to the community website as a project shell.
 * New shells arrive PRIVATE; the author chooses what to share on the website.
 * Sync never changes visibility and never deletes shells.
 */
export async function syncCommunityProjects(plugin: RadialTimelinePlugin): Promise<ProjectSyncSuccess> {
    const { connectionId, currentSecret } = await requireActiveConnection(plugin);

    const books = (plugin.settings.books ?? []).slice(0, 50);
    if (!books.length) {
        return { ok: true, created: 0, updated: 0, projects: [] };
    }

    // Publishing targets are per book (BookProfile.stageTargetDates): every
    // book sends its own four dates — value or null, so a cleared date clears
    // the server copy too. Zero-draft mode is still a vault-global working
    // mode, so it rides along on the active book only. All of it stays private
    // server-side until the author reveals it in My Share.
    const targetDate = (value?: string): string | null =>
        value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    const activeBookId = plugin.settings.activeBookId;

    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/community-project-sync`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
            connection_id: connectionId,
            current_secret: currentSecret,
            projects: books.map((book, index) => ({
                book_key: book.id,
                title: (book.publicLabel || book.title || 'Untitled book').slice(0, 140),
                logline: book.publicDescription ? book.publicDescription.slice(0, 240) : undefined,
                // Book Manager array order — the website renders books in this order.
                order_index: index,
                zero_target_date: targetDate(book.stageTargetDates?.Zero),
                author_target_date: targetDate(book.stageTargetDates?.Author),
                house_target_date: targetDate(book.stageTargetDates?.House),
                press_target_date: targetDate(book.stageTargetDates?.Press),
                ...(book.id === activeBookId ? {
                    zero_draft_mode: plugin.settings.enableZeroDraftMode === true
                } : {})
            }))
        }),
        throw: false
    });

    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const body = parsed as ActivationConfirmError;
        throw new CommunityShareError(
            body.error?.code || 'project_sync_failed',
            body.error?.message || 'Could not sync books to the community site.'
        );
    }
    if (!isProjectSyncSuccess(parsed)) {
        throw new CommunityShareError('invalid_response', 'The project sync returned an unexpected response.');
    }
    return parsed;
}

/**
 * Fire-and-forget project sync for plugin load: silently no-ops when
 * Community Share is not connected, and never throws into the caller.
 */
export async function syncCommunityProjectsIfConnected(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.connection.status !== 'connected' || !current.connection.connectionId) return;
    try {
        await syncCommunityProjects(plugin);
    } catch (error) {
        console.warn('Community project sync skipped:', error instanceof Error ? error.message : error);
    }
}

// ── Throttled project sync ──────────────────────────────────────────────────
// Settings edits (target dates, Zero-draft mode) call this instead of syncing
// directly: the first call in a quiet stretch fires immediately, and any
// further calls inside the window coalesce into ONE trailing sync when the
// window closes. The website is never hit more than twice per window no
// matter how many fields the author touches, and the last edit always lands.
const PROJECT_SYNC_WINDOW_MS = 5 * 60 * 1000;
let lastProjectSyncAt = 0;
let pendingProjectSync: number | null = null;

export function scheduleCommunityProjectSync(plugin: RadialTimelinePlugin): void {
    const elapsed = Date.now() - lastProjectSyncAt;
    if (elapsed >= PROJECT_SYNC_WINDOW_MS) {
        lastProjectSyncAt = Date.now();
        void syncCommunityProjectsIfConnected(plugin);
        return;
    }
    if (pendingProjectSync !== null) return; // trailing sync already queued
    pendingProjectSync = window.setTimeout(() => {
        pendingProjectSync = null;
        lastProjectSyncAt = Date.now();
        void syncCommunityProjectsIfConnected(plugin);
    }, PROJECT_SYNC_WINDOW_MS - elapsed);
}

export async function beginCommunitySharing(plugin: RadialTimelinePlugin): Promise<PublishSuccess> {
    const result = await publishCommunityShareReport(plugin, 'manual');
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: true
    });
    await plugin.saveSettings();
    // Companion daily-aggregate sync rides along with the successful publish;
    // it never blocks or fails the publish itself.
    await syncCommunityDailyIfEligible(plugin);
    return result;
}

export async function pauseCommunitySharing(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const at = new Date().toISOString();
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: false,
        publishHistory: appendHistory(current, {
            id: `pause-${at}`,
            action: 'pause',
            status: 'success',
            at,
            message: 'Sharing paused. Already shared data stays visible until revoked.'
        })
    });
    await plugin.saveSettings();
}

// Error codes that mean the standing authorization itself is broken; continuing
// to retry syncs would violate the contract's auto-stop rule.
const SYNC_STOP_CODES = new Set([
    'connection_required',
    'connection_not_active',
    'connection_disconnected',
    'connection_secret_invalid',
    'connection_secret_expired',
    'connection_secret_missing',
    'scope_rejected',
    'publish_locked',
    'field_not_permitted',
    'tier_out_of_range',
    'sensitive_field_not_public'
]);

interface DailySyncSuccess {
    ok: true;
}

function isDailySyncSuccess(value: unknown): value is DailySyncSuccess {
    return (value as Partial<DailySyncSuccess>)?.ok === true;
}

/**
 * Fire-and-forget daily-activity sync: sends the last two weeks of per-day
 * aggregates (community_daily) so the author page can show weekly stats.
 * Consent-consistent — runs only while the standing share is active at the
 * progress level (public, tier 4); private, paused, or revoked shares never
 * send. Silent by design: a standing-authorization failure stops scheduled
 * sharing (same auto-stop rule as the report sync); transient failures only
 * log to the console, never Notices, never repeated history entries.
 */
export async function syncCommunityDailyIfEligible(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) return;
    if (current.audience !== 'public' || current.tier !== 4) return;

    try {
        const currentSecret = await getSecret(plugin.app, current.connection.secretId);
        if (!currentSecret) return;

        const days = await buildCommunityDailyEntries(plugin);
        if (!days.length) return;

        const response = await requestUrl({
            url: `${FUNCTIONS_BASE_URL}/community-daily-sync`,
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify({
                connection_id: current.connection.connectionId,
                current_secret: currentSecret,
                days
            }),
            throw: false
        });

        const parsed = parseResponseJson(response.text);
        if (response.status < 200 || response.status >= 300) {
            const body = parsed as ActivationConfirmError;
            throw new CommunityShareError(
                body.error?.code || 'daily_sync_failed',
                body.error?.message || 'Daily activity sync failed.'
            );
        }
        if (!isDailySyncSuccess(parsed)) {
            throw new CommunityShareError('invalid_response', 'Daily activity sync returned an unexpected response.');
        }
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'daily_sync_failed';
        const message = error instanceof Error ? error.message : 'Daily activity sync failed.';
        if (SYNC_STOP_CODES.has(code)) {
            const after = normalizeCommunityShareSettings(plugin.settings.communityShare);
            const at = new Date().toISOString();
            plugin.settings.communityShare = normalizeCommunityShareSettings({
                ...after,
                scheduledPublishEnabled: false,
                publishHistory: appendHistory(after, {
                    id: `daily-sync-${at}`,
                    action: 'sync',
                    status: 'failed',
                    at,
                    message: `${message} Sharing stopped.`
                }),
                lastError: message
            });
            await plugin.saveSettings();
        } else {
            console.warn('Community daily activity sync failed:', message);
        }
    }
}

/**
 * Standing-share sync: while sharing is on, keep the live report current.
 * Silent by design (no Notices) — outcomes land in settings/history and the
 * sharing settings screen. Skips when nothing changed since the last sync.
 */
export async function syncCommunityShareIfDue(plugin: RadialTimelinePlugin): Promise<'synced' | 'skipped' | 'failed'> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || !current.scheduledPublishEnabled) return 'skipped';
    if (current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) return 'skipped';
    if (current.audience !== 'public' || current.tier < 1 || current.tier > 4) return 'skipped';

    try {
        const preview = await buildCommunitySharePreview(plugin);
        if (preview.payloadHash === current.connection.lastSyncedPayloadHash) return 'skipped';

        plugin.settings.communityShare = normalizeCommunityShareSettings({
            ...current,
            preview: {
                status: 'ready',
                generatedAt: new Date().toISOString(),
                previewHash: preview.previewHash,
                payloadHash: preview.payloadHash,
                reportPeriod: 'weekly',
                summary: preview.summary
            }
        });
        await plugin.saveSettings();
        await publishCommunityShareReport(plugin, 'scheduled');
        // Companion daily-aggregate sync rides along with the successful
        // report sync; it handles its own failures and never throws.
        await syncCommunityDailyIfEligible(plugin);
        return 'synced';
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'sync_failed';
        const message = error instanceof Error ? error.message : 'Community sharing sync failed.';
        const stopped = SYNC_STOP_CODES.has(code);
        const after = normalizeCommunityShareSettings(plugin.settings.communityShare);
        const at = new Date().toISOString();
        plugin.settings.communityShare = normalizeCommunityShareSettings({
            ...after,
            scheduledPublishEnabled: stopped ? false : after.scheduledPublishEnabled,
            publishHistory: appendHistory(after, {
                id: `sync-${at}`,
                action: 'sync',
                status: 'failed',
                at,
                message: stopped ? `${message} Sharing stopped.` : message
            }),
            lastError: message
        });
        await plugin.saveSettings();
        return 'failed';
    }
}

async function callReportAction(
    plugin: RadialTimelinePlugin,
    endpoint: 'community-share-revoke' | 'community-share-delete' | 'community-share-disconnect',
    body: Record<string, unknown>
): Promise<ReportActionSuccess> {
    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/${endpoint}`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify(body),
        throw: false
    });
    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const errorBody = parsed as ActivationConfirmError;
        throw new CommunityShareError(
            errorBody.error?.code || 'community_share_action_failed',
            errorBody.error?.message || 'Community Share action failed. Try again.'
        );
    }
    if (!isReportActionSuccess(parsed)) {
        throw new CommunityShareError('invalid_response', 'Community Share returned an unexpected response.');
    }
    return parsed;
}

export async function revokeCommunityShareReport(plugin: RadialTimelinePlugin): Promise<ReportActionSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const publishId = latestPublishId(current);
    if (!publishId) throw new CommunityShareError('publish_required', 'Publish a report before revoking it.');
    const secret = await getConnectedSecret(plugin, current);
    const result = await callReportAction(plugin, 'community-share-revoke', {
        publish_id: publishId,
        current_secret: secret
    });
    const at = result.revoked_at || new Date().toISOString();
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: false,
        connection: {
            ...current.connection,
            lastSyncedPayloadHash: undefined
        },
        publishHistory: appendHistory(current, {
            id: `revoke-${at}`,
            action: 'revoke',
            status: 'success',
            at,
            publishId,
            message: 'Sharing revoked and taken off the website.'
        }),
        lastError: undefined
    });
    await plugin.saveSettings();
    return result;
}

export async function deleteCommunityShareReport(plugin: RadialTimelinePlugin): Promise<ReportActionSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const publishId = latestPublishId(current);
    if (!publishId) throw new CommunityShareError('publish_required', 'Publish a report before deleting shared data.');
    const secret = await getConnectedSecret(plugin, current);
    const result = await callReportAction(plugin, 'community-share-delete', {
        publish_id: publishId,
        current_secret: secret,
        confirm: true,
        delete_reason: 'plugin_user_requested'
    });
    const at = result.deleted_at || new Date().toISOString();
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: false,
        connection: {
            ...current.connection,
            lastSyncedPayloadHash: undefined
        },
        publishHistory: appendHistory(current, {
            id: `delete-${at}`,
            action: 'delete',
            status: 'success',
            at,
            publishId,
            message: 'Shared data deleted from the website.'
        }),
        preview: {
            ...current.preview,
            status: 'stale',
            previewHash: undefined,
            payloadHash: undefined
        },
        lastError: undefined
    });
    await plugin.saveSettings();
    return result;
}

export async function disconnectCommunityShare(plugin: RadialTimelinePlugin): Promise<ReportActionSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const secret = await getConnectedSecret(plugin, current);
    const result = await callReportAction(plugin, 'community-share-disconnect', {
        connection_id: current.connection.connectionId,
        current_secret: secret,
        mode: 'disconnect_only'
    });
    const at = result.disconnected_at || new Date().toISOString();
    if (current.connection.secretId) {
        await deleteSecret(plugin.app, current.connection.secretId);
    }
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        enabled: false,
        scheduledPublishEnabled: false,
        connection: {
            ...current.connection,
            status: 'disconnected',
            disconnectedAt: at,
            lastSyncedPayloadHash: undefined,
            secretId: undefined
        },
        publishHistory: appendHistory(current, {
            id: `disconnect-${at}`,
            action: 'disconnect',
            status: 'success',
            at,
            message: 'Plugin disconnected from Community Share.'
        }),
        preview: {
            status: 'not_generated'
        },
        lastError: undefined
    });
    await plugin.saveSettings();
    return result;
}
