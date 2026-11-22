import { isTimelinePreviewDocument, type TimelinePreviewDocument } from './timelinePreview';
import { SCENE_AUTHOR_AGREEMENT_VERSION } from './sceneAgreement';
import { apiVersion, normalizePath, Platform, requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { deleteSecret, getSecret, isSecretStorageAvailable, setSecret } from '../ai/credentials/secretStorage';
import { COMMUNITY_UUID_RE, canShareAprToCommunity, canShareSceneText, canShareTimelineToCommunity, deriveCommunityShareMode, expectsBookListSync, modeIncludesActivity, hasActiveCommunityConnection, hasCommunityConnection, normalizeCommunityShareSettings, timelineShareFor } from './communityShareSettings';
import { buildTimelineSharePayload, hasAmbiguousSceneIdHolders, sceneIdHolders, timelinePayloadFingerprint } from './timelineSharePayload';
import type { SceneTextProblem } from './sceneReleaseText';
import { readBookSharingState, readServerDisconnect, readVaultSharingState, type BookSharingState, type VaultSharingState } from './sharingState';
import { refusalMessage } from './sharingWords';
import {
    readBookTransferDone,
    readBookTransferList,
    readBookTransferRead,
    readBookTransferState,
    type BookTransferDone,
    type BookTransferOffer,
    type BookTransferRead,
    type BookTransferState,
} from './bookTransferDocument';
import { isPathInFolderScope } from '../utils/pathScope';
import {
    COMMUNITY_DAILY_BACKFILL_DAYS,
    COMMUNITY_DAILY_BACKFILL_VERSION,
    COMMUNITY_DAILY_WINDOW_DAYS,
    COMMUNITY_SHARE_REPORT_SCHEMA_VERSION,
    buildCommunityDailyEntries,
    buildCommunityHourModeMixEntries,
    buildCommunitySharePreview,
    communityDailyIncludesWords
} from './communitySharePreview';
import type { BookProfile, CommunityShareConnectionSettings, CommunityShareFieldKey, CommunitySharePublishHistoryEntry, CommunityShareSettings, CommunitySharingNoticeOwed, CommunityTimelineShareRecord, WritingSessionMode } from '../types/settings';
import type { SessionFeedPost } from '../services/WritingSessionLog';

const FUNCTIONS_BASE_URL = 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/functions/v1';
const INSTALLATION_SECRET_ID = 'rt.community-share.installation-id';
const CONNECTION_SECRET_ID = 'rt.community-share.connection-secret';

interface ActivationConfirmSuccess {
    connection_id: string;
    connection_secret: string;
    secret_expires_at: string | null;
    profile_id: string;
    /** `null` for an activation issued without a book; the first project sync binds one. */
    project_id: string | null;
    profile_display?: string;
    project_title?: string | null;
}

interface CommunityErrorBody {
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
    /** The refusal body's fields beside `error` (a refusal's time and side), when it sent any. */
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'CommunityShareError';
        this.code = code;
        if (details) this.details = details;
    }
}

/** A refusal body's fields beside `error`, or undefined when it has none. */
function refusalDetails(parsed: unknown): Record<string, unknown> | undefined {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const rest = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([key]) => key !== 'error'));
    return Object.keys(rest).length > 0 ? rest : undefined;
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

interface OkResponse {
    ok: true;
}

function isOkResponse(value: unknown): value is OkResponse {
    return (value as Partial<OkResponse>)?.ok === true;
}

interface CommunityCallFailure {
    code: string;
    message: string;
}

/**
 * The client this installation runs, sent as ONE header on every community
 * call: `X-RT-Client: plugin=<manifest version>; obsidian=<apiVersion>;
 * platform=<macos|windows|linux|ios|android>`. The platform records it on the
 * connection (support reads it for bug reports; My Share shows it). Coarse by
 * design: versions and an OS family, never a hostname, user name, device name
 * or vault path.
 */
function communityClientHeaders(plugin: RadialTimelinePlugin): Record<string, string> {
    const parts = [`plugin=${plugin.manifest.version}`, `obsidian=${apiVersion}`];
    const platform = clientPlatform();
    if (platform) parts.push(`platform=${platform}`);
    return { 'X-RT-Client': parts.join('; ') };
}

function clientPlatform(): 'macos' | 'windows' | 'linux' | 'ios' | 'android' | null {
    if (Platform.isIosApp) return 'ios';
    if (Platform.isAndroidApp) return 'android';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isWin) return 'windows';
    if (Platform.isLinux) return 'linux';
    return null;
}

/**
 * POST one community function and return its parsed success body. A non-2xx
 * answer becomes a CommunityShareError carrying the server's code and message
 * when it sent them and `failure` otherwise; a 2xx body that fails `isSuccess`
 * is an invalid_response. Callers check consent (assertStillSendable) first.
 */
async function postCommunityFunction<T>(
    plugin: RadialTimelinePlugin,
    endpoint: string,
    body: Record<string, unknown>,
    isSuccess: (value: unknown) => value is T,
    failure: CommunityCallFailure,
    unexpectedMessage: string
): Promise<T> {
    const response = await requestUrl({
        url: `${FUNCTIONS_BASE_URL}/${endpoint}`,
        method: 'POST',
        contentType: 'application/json',
        headers: communityClientHeaders(plugin),
        body: JSON.stringify(body),
        throw: false
    });
    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const error = (parsed as CommunityErrorBody).error;
        const code = error?.code || failure.code; // SAFE: non-2xx response carrying no structured code; the caller names the call that failed
        const details = refusalDetails(parsed);
        // Community says who disconnected this vault and when: the vault stops
        // calling itself connected (one place for every plugin call).
        if (code === 'connection_disconnected' && typeof body.connection_id === 'string') {
            await recordServerDisconnect(plugin, body.connection_id, details);
        }
        throw new CommunityShareError(
            code,
            refusalMessage(code, details)
                ?? (error?.message || failure.message), // SAFE: user-facing text used only when the error body carries no message
            details
        );
    }
    if (!isSuccess(parsed)) {
        throw new CommunityShareError('invalid_response', unexpectedMessage);
    }
    return parsed;
}

function isActivationConfirmSuccess(value: unknown): value is ActivationConfirmSuccess {
    const body = value as Partial<ActivationConfirmSuccess>;
    return typeof body?.connection_id === 'string'
        && typeof body.connection_secret === 'string'
        && typeof body.profile_id === 'string'
        && (typeof body.project_id === 'string' || body.project_id === null);
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
        throw new CommunityShareError('connection_required', t('ui.communityShareClient.connectFirst'));
    }
    const secret = await getSecret(plugin.app, settings.connection.secretId);
    if (!secret) {
        throw new CommunityShareError('connection_secret_missing', t('ui.communityShareClient.secretMissing'));
    }
    return secret;
}

function appendHistory(
    settings: CommunityShareSettings,
    entry: CommunitySharePublishHistoryEntry
): CommunitySharePublishHistoryEntry[] {
    return [...settings.publishHistory, entry].slice(-25);
}

/**
 * Write Community Share settings against the state that is live NOW, not a
 * snapshot taken before an await. Every mutator here awaits (secret storage,
 * preview build, the network) and the author can click Pause, Resume, or
 * Disconnect in that window; spreading a pre-await snapshot back over the
 * settings silently reverted those clicks. Callers keep their pre-await
 * snapshot for gating and for values they computed from it, and pass an
 * updater that layers only their own changes onto the live state.
 */
export function commitCommunityShare(
    plugin: RadialTimelinePlugin,
    update: (live: CommunityShareSettings) => CommunityShareSettings
): CommunityShareSettings {
    const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const next = normalizeCommunityShareSettings(update(live));
    plugin.settings.communityShare = next;
    return next;
}

/**
 * Community answered that this connection was disconnected (on Community, in
 * another copy of this vault, or when another vault took the book). The vault
 * is disconnected here too, as a local Disconnect leaves it, and keeps who and
 * when for the badge. An answer for a connection this vault has since replaced
 * changes nothing.
 */
async function recordServerDisconnect(plugin: RadialTimelinePlugin, connectionId: string, details: Record<string, unknown> | undefined): Promise<void> {
    const before = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (before.connection.connectionId !== connectionId || before.connection.status !== 'connected') return;
    const disconnect = readServerDisconnect(details);
    const at = disconnect.at ?? new Date().toISOString();
    const secretId = before.connection.secretId;
    let recorded = false;
    commitCommunityShare(plugin, live => {
        if (live.connection.connectionId !== connectionId || live.connection.status !== 'connected') return live;
        recorded = true;
        return {
            ...live,
            scheduledPublishEnabled: false,
            sharingPaused: false,
            sharingPausedAt: undefined,
            sharingNoticeOwed: undefined,
            connection: {
                ...live.connection,
                status: 'disconnected',
                disconnectedAt: at,
                serverDisconnect: disconnect,
                lastSyncedPayloadHash: undefined,
                secretId: undefined,
                bookListSyncedAt: undefined,
                bookListSyncError: undefined,
                bookListSyncFailedAt: undefined
            },
            publishHistory: appendHistory(live, {
                id: `disconnect-${at}`,
                action: 'disconnect',
                status: 'success',
                at,
                message: 'Disconnected, as Community reported.'
            }),
            lastError: undefined
        };
    });
    if (!recorded) return;
    // The key no longer opens anything on Community.
    if (secretId && !await deleteSecret(plugin.app, secretId)) {
        console.warn('Community Share: the disconnected connection secret could not be deleted.');
    }
    await plugin.saveSettings();
}

async function getOrCreateInstallationId(plugin: RadialTimelinePlugin): Promise<string> {
    const existing = await getSecret(plugin.app, INSTALLATION_SECRET_ID);
    if (existing) return existing;

    const next = `rtpi_${randomBase64Url(24)}`;
    const stored = await setSecret(plugin.app, INSTALLATION_SECRET_ID, next);
    if (!stored) {
        throw new CommunityShareError('secret_storage_unavailable', t('ui.communityShareClient.secretStorageUnavailable'));
    }
    return next;
}

async function cleanupUnstoredConnection(plugin: RadialTimelinePlugin, connectionId: string, currentSecret: string): Promise<void> {
    try {
        await requestUrl({
            url: `${FUNCTIONS_BASE_URL}/community-share-disconnect`,
            method: 'POST',
            contentType: 'application/json',
            headers: communityClientHeaders(plugin),
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
        throw new CommunityShareError('invalid_activation_token', t('ui.communityShareClient.pasteFullCode'));
    }
    if (!isSecretStorageAvailable(plugin.app)) {
        throw new CommunityShareError('secret_storage_unavailable', t('ui.communityShareClient.secretStorageUnavailable'));
    }

    const installationId = await getOrCreateInstallationId(plugin);
    const pluginInstallationIdHash = await sha256Hex(installationId);
    const parsed = await postCommunityFunction(
        plugin,
        'community-activation-confirm',
        {
            activation_token: token,
            plugin_installation_id_hash: pluginInstallationIdHash,
            // Declares that this client accepts a null-project confirm. The
            // server refuses a project-less token to clients that omit this
            // (409 plugin_update_required) instead of consuming the token.
            supports_projectless_activation: true
        },
        isActivationConfirmSuccess,
        { code: 'activation_failed', message: t('ui.communityShareClient.activationFailed') },
        t('ui.communityShareClient.activationUnexpected')
    );

    const secretId = connectionSecretId();
    // The connection secret lives under a fixed key, so a reconnect/replace
    // overwrites whatever is already stored. Capture the prior value first and,
    // if the new write fails to verify, restore it (best effort) before we
    // clean up the new server-side connection — otherwise a failed replace
    // would destroy the still-referenced working secret of the old connection.
    const priorSecret = await getSecret(plugin.app, secretId);
    const storedSecret = await setSecret(plugin.app, secretId, parsed.connection_secret);
    const verifiedSecret = storedSecret ? await getSecret(plugin.app, secretId) : null;
    if (verifiedSecret !== parsed.connection_secret) {
        if (priorSecret && priorSecret !== parsed.connection_secret) {
            await setSecret(plugin.app, secretId, priorSecret);
        }
        await cleanupUnstoredConnection(plugin, parsed.connection_id, parsed.connection_secret);
        throw new CommunityShareError(
            'secret_storage_failed',
            t('ui.communityShareClient.secretSaveFailed')
        );
    }

    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    // A new connection starts each book's timeline record afresh too: an error from the old
    // connection (a missing or rejected key, say) is not this one's, and the next send reports
    // anything still wrong.
    const timelineShares = current.timelineShares
        ? Object.fromEntries(Object.entries(current.timelineShares).map(([bookId, record]) => [bookId, { ...record, lastError: undefined }]))
        : undefined;
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        enabled: true,
        sharingPaused: false,
        // A notice owed to the old connection is not this one's to tell.
        sharingNoticeOwed: undefined,
        timelineShares,
        connection: {
            ...current.connection,
            status: 'connected',
            connectionId: parsed.connection_id,
            profileId: parsed.profile_id,
            projectId: parsed.project_id,
            connectedAt: new Date().toISOString(),
            lastSyncedAt: new Date().toISOString(),
            secretId,
            // A new connection starts its own book-list sync record.
            bookListSyncedAt: undefined,
            bookListSyncError: undefined,
            bookListSyncFailedAt: undefined
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

function assertReportPublishAllowed(settings: CommunityShareSettings, mode: 'manual' | 'scheduled'): void {
    if (settings.audience !== 'public' || settings.tier < 1 || settings.tier > 4
        || !settings.manualPublishEnabled || (mode === 'scheduled' && !settings.scheduledPublishEnabled)) {
        throw new CommunityShareError('publish_locked', t('ui.communityShareClient.publishLocked'));
    }
}

export async function publishCommunityShareReport(
    plugin: RadialTimelinePlugin,
    mode: 'manual' | 'scheduled' = 'manual'
): Promise<PublishSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    // Re-read the paused flag at the moment of publish: a Pause clicked after a
    // sync path passed its own paused-check but before reaching this call must
    // still stop the payload from leaving. Resume clears the flag before it
    // syncs, so the explicit resume path is unaffected.
    if (current.sharingPaused) {
        throw new CommunityShareError('sharing_paused', t('ui.communityShareClient.pausedResumeFirst'));
    }
    if (!hasActiveCommunityConnection(current)) {
        throw new CommunityShareError('connection_required', t('ui.communityShareClient.connectBeforeSharing'));
    }
    assertReportPublishAllowed(current, mode);
    if (current.preview.status !== 'ready' || !current.preview.previewHash || !current.preview.payloadHash) {
        throw new CommunityShareError('preview_required', t('ui.communityShareClient.previewRequired'));
    }

    const currentSecret = await getSecret(plugin.app, current.connection.secretId);
    if (!currentSecret) {
        throw new CommunityShareError('connection_secret_missing', t('ui.communityShareClient.secretMissing'));
    }

    const preview = await buildCommunitySharePreview(plugin);
    if (preview.previewHash !== current.preview.previewHash || preview.payloadHash !== current.preview.payloadHash) {
        throw new CommunityShareError('preview_stale', t('ui.communityShareClient.previewOutOfDate'));
    }
    const live = assertStillSendable(plugin, current.connection);
    assertReportPublishAllowed(live, mode);
    const fieldsChanged = Object.entries(current.fieldPolicy).some(([key, enabled]) => live.fieldPolicy[key as CommunityShareFieldKey] !== enabled);
    if (fieldsChanged || live.tier !== current.tier || live.preview.status !== 'ready'
        || live.preview.previewHash !== preview.previewHash || live.preview.payloadHash !== preview.payloadHash) {
        throw new CommunityShareError('preview_stale', t('ui.communityShareClient.sharingChangedWhilePreparing'));
    }

    const parsed = await postCommunityFunction(
        plugin,
        'community-share-publish',
        {
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
        },
        isPublishSuccess,
        { code: 'publish_failed', message: t('ui.communityShareClient.publishFailed') },
        t('ui.communityShareClient.publishUnexpected')
    );

    // The payload has left; record that against the live state so a Pause or
    // Disconnect that landed while the request was in flight is kept.
    commitCommunityShare(plugin, live => ({
        ...live,
        connection: {
            ...live.connection,
            publicSlug: parsed.public_slug,
            lastSyncedAt: parsed.published_at,
            lastSyncedPayloadHash: preview.payloadHash
        },
        preview: {
            ...live.preview,
            status: 'stale'
        },
        publishHistory: [
            ...live.publishHistory,
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
    }));
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
    /** The connection's bound project after this sync (null while unbound); absent on servers that predate project-less activation. */
    connection_project_id?: string | null;
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
    return !!v && v.ok === true && Array.isArray(v.projects)
        && (v.connection_project_id === undefined || v.connection_project_id === null || typeof v.connection_project_id === 'string');
}

function isCommunityShareContext(value: unknown): value is CommunityShareContext {
    const v = value as CommunityShareContext;
    return !!v && v.ok === true && Array.isArray(v.projects);
}

/**
 * Whether the LIVE settings still permit a request to leave. Every sender
 * awaits (secret storage, preview or aggregate builds) between its gate and
 * its send, and Pause or Disconnect can land in that window. A disconnect
 * clears local state even when the server call fails, so a secret fetched
 * before it must not be usable after it. Checked immediately before each
 * `requestUrl`; `allowPaused` is for author actions that must work while
 * paused (revoke) and for read-only lookups. `anyLevel` (assertStillSendable)
 * is for the two calls that work at every sharing level, Private included:
 * Desk Lamps (plan D12) and the Mailbox read. The captured connection
 * identity must still match: a replacement connection cannot authorize an
 * old secret.
 */
function isStillSendable(live: CommunityShareSettings, expected: CommunityShareConnectionSettings, allowPaused = false): boolean {
    if (!live.enabled || live.connection.status !== 'connected' || !live.connection.connectionId) return false;
    if (!allowPaused && live.sharingPaused) return false;
    return isSameConnection(live.connection, expected);
}

function isSameConnection(live: CommunityShareConnectionSettings, expected: CommunityShareConnectionSettings): boolean {
    return live.connectionId === expected.connectionId
        && live.secretId === expected.secretId
        && live.projectId === expected.projectId
        && live.profileId === expected.profileId;
}

function assertStillSendable(plugin: RadialTimelinePlugin, expected: CommunityShareConnectionSettings, allowPaused = false, anyLevel = false): CommunityShareSettings {
    const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if ((!live.enabled && !anyLevel) || live.connection.status !== 'connected' || !live.connection.connectionId) {
        throw new CommunityShareError('connection_required', t('ui.communityShareClient.disconnectedBeforeSend'));
    }
    if (!allowPaused && live.sharingPaused) {
        throw new CommunityShareError('sharing_paused', t('ui.communityShareClient.pausedBeforeSend'));
    }
    if (!isSameConnection(live.connection, expected)) {
        throw new CommunityShareError('connection_changed', t('ui.communityShareClient.connectionChangedBeforeSend'));
    }
    return live;
}

/**
 * An active connection with a stored secret. A bound project is NOT required
 * here: a connection activated without a book carries `projectId: null` until
 * the first project sync binds one, and context + sync must run in that state.
 * Callers that need a bound project check it themselves via
 * `requireBoundProject`. `anyLevel` (Desk Lamps and the Mailbox read) accepts
 * a connection at every sharing level, Private included.
 */
async function requireActiveConnection(plugin: RadialTimelinePlugin, anyLevel = false): Promise<{
    connectionId: string;
    currentSecret: string;
    connection: CommunityShareConnectionSettings;
}> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    // hasActiveCommunityConnection is hasCommunityConnection plus Community on.
    if (!hasCommunityConnection(current) || (!anyLevel && !current.enabled)) {
        throw new CommunityShareError('connection_required', t('ui.communityShareClient.connectBeforeSync'));
    }
    const currentSecret = await getSecret(plugin.app, current.connection.secretId);
    if (!currentSecret) {
        throw new CommunityShareError('connection_secret_missing', t('ui.communityShareClient.secretMissing'));
    }
    return {
        connectionId: current.connection.connectionId,
        currentSecret,
        connection: current.connection
    };
}

/**
 * Calls that attach data to a project (APR upload, session posts) need the
 * connection bound to one. The server answers `409 project_required` for an
 * unbound connection; this is the same refusal raised before the request
 * leaves, so the author gets the fix rather than a failed upload.
 */
function requireBoundProject(connection: CommunityShareConnectionSettings): string {
    if (!connection.projectId) {
        throw new CommunityShareError('project_required', t('ui.communityShareClient.syncBookFirst'));
    }
    return connection.projectId;
}

/**
 * Send a campaign's rendered APR (portable SVG) to the community website.
 * The artifact arrives PRIVATE on the author's My Share page; activating
 * public display is a website-only action per the share-surfaces contract.
 */
export async function uploadAprToCommunity(
    plugin: RadialTimelinePlugin,
    args: {
        svg: string;
        width: number;
        height: number;
        teaserLevel: 'ring' | 'scenes' | 'colors' | 'full';
        updateFrequency: 'manual' | 'daily' | 'weekly' | 'monthly';
        bookKey: string;
        campaignLabel?: string;
    }
): Promise<AprUploadSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!canShareAprToCommunity(current)) {
        throw new CommunityShareError(
            'sharing_level_required',
            t('ui.communityShareClient.aprLevelRequired')
        );
    }
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    requireBoundProject(connection);
    const bookKey = args.bookKey.trim();
    if (!bookKey) {
        throw new CommunityShareError('project_mapping_required', t('ui.communityShareClient.aprBookRequired'));
    }
    const live = assertStillSendable(plugin, connection);
    if (!canShareAprToCommunity(live)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.aprLevelChanged'));
    }

    const parsed = await postCommunityFunction(
        plugin,
        'community-apr-upload',
        {
            connection_id: connectionId,
            current_secret: currentSecret,
            plugin_book_key: bookKey,
            teaser_level: args.teaserLevel,
            update_frequency: args.updateFrequency,
            svg: args.svg,
            width: args.width,
            height: args.height,
            campaign_label: args.campaignLabel?.slice(0, 60)
        },
        isAprUploadSuccess,
        { code: 'apr_upload_failed', message: t('ui.communityShareClient.aprUploadFailed') },
        t('ui.communityShareClient.aprUploadUnexpected')
    );
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
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    assertStillSendable(plugin, connection, true);

    const parsed = await postCommunityFunction(
        plugin,
        'community-share-context',
        {
            connection_id: connectionId,
            current_secret: currentSecret
        },
        isCommunityShareContext,
        { code: 'share_context_failed', message: t('ui.communityShareClient.shareContextFailed') },
        t('ui.communityShareClient.shareContextUnexpected')
    );
    return parsed;
}

/** community-mailbox: the website account chip's mailbox facts for this member. */
export interface CommunityMailboxAnswer {
    ok: true;
    /** The member's requests with a team reply they have not seen. */
    support_unread: number;
    /** The member's questions with unread replies; latest_post_id is the newest (null when count is 0). */
    replies: { count: number; latest_post_id: string | null };
    /** Desk Lamp invites waiting on the member (answered on My Share). */
    desk_lamp_invites: number;
    /** Community admins only: unread requests and requests awaiting a reply. */
    admin: { unread: number; awaiting: number } | null;
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isCommunityMailboxAnswer(value: unknown): value is CommunityMailboxAnswer {
    if (!value || typeof value !== 'object') return false;
    const answer = value as Partial<CommunityMailboxAnswer>;
    const replies = answer.replies;
    const admin = answer.admin;
    return answer.ok === true
        && isCount(answer.support_unread)
        && isCount(answer.desk_lamp_invites)
        && !!replies && isCount(replies.count)
        // The question id becomes part of a link: only a UUID is accepted.
        && (replies.count === 0
            ? replies.latest_post_id === null
            : typeof replies.latest_post_id === 'string' && COMMUNITY_UUID_RE.test(replies.latest_post_id))
        && (admin === null || (!!admin && isCount(admin.unread) && isCount(admin.awaiting)));
}

/**
 * Read the connected member's Community mailbox for the timeline title bar.
 * READ-only: nothing is marked seen (reading happens on the website), and
 * nothing about the author's writing is sent. So it is allowed while sharing
 * is paused and at the Private level: pausing or choosing Private stops your
 * writing leaving, not reading your own replies (Eric, 2026-10-03).
 */
export async function fetchCommunityMailbox(plugin: RadialTimelinePlugin): Promise<CommunityMailboxAnswer> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin, true);
    assertStillSendable(plugin, connection, true, true);
    return postCommunityFunction(
        plugin,
        'community-mailbox',
        {
            connection_id: connectionId,
            current_secret: currentSecret
        },
        isCommunityMailboxAnswer,
        { code: 'mailbox_failed', message: t('ui.communityShareClient.mailboxFailed') },
        t('ui.communityShareClient.mailboxUnexpected')
    );
}

/**
 * A Desk Lamp as it leaves the device: exactly these four keys, built only by
 * deskLamps.projectDeskLampLight (docs/engineering/standards/writing-session-privacy.md).
 */
export interface DeskLampLight {
    state: 'lit' | 'break';
    mode: WritingSessionMode;
    /** The session start floored to 5 minutes, ISO UTC. */
    lit_at: string;
    /** The Desk Lamp profile ids ticked for this session. */
    audience: string[];
}

export interface DeskLampFriend {
    profile_id: string;
    handle: string;
    display_name: string;
}

export interface LitDeskLamp extends DeskLampFriend {
    /** Short label of the friend's broad public place ("Portland"), or null. */
    place: string | null;
    state: 'lit' | 'break';
    mode: WritingSessionMode;
    /** The friend's session start floored to 5 minutes, ISO UTC to the second. */
    lit_at: string;
}

/** community-desk-lamps: this connection's lamp, the member's Desk Lamps, the lamps lit for them, invites waiting. */
export interface DeskLampsAnswer {
    ok: true;
    light: { state: 'lit' | 'break'; audience: string[] } | null;
    lamps: DeskLampFriend[];
    lit: LitDeskLamp[];
    invites_received: number;
}

const DESK_LAMP_STATES: ReadonlySet<unknown> = new Set(['lit', 'break']);
const DESK_LAMP_MODES: ReadonlySet<unknown> = new Set(['drafting', 'revising', 'editing', 'planning']);
const DESK_LAMP_LIT_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function isDeskLampFriend(value: unknown): value is DeskLampFriend {
    if (!value || typeof value !== 'object') return false;
    const friend = value as Partial<DeskLampFriend>;
    return typeof friend.profile_id === 'string' && COMMUNITY_UUID_RE.test(friend.profile_id)
        // The handle becomes a profile link; deskLamps encodes it there.
        && typeof friend.handle === 'string' && friend.handle.length > 0
        && typeof friend.display_name === 'string';
}

function isLitDeskLamp(value: unknown): value is LitDeskLamp {
    if (!isDeskLampFriend(value)) return false;
    const lamp = value as Partial<LitDeskLamp>;
    return (lamp.place === null || typeof lamp.place === 'string')
        && DESK_LAMP_STATES.has(lamp.state)
        && DESK_LAMP_MODES.has(lamp.mode)
        && typeof lamp.lit_at === 'string' && DESK_LAMP_LIT_AT_RE.test(lamp.lit_at);
}

export function isDeskLampsAnswer(value: unknown): value is DeskLampsAnswer {
    if (!value || typeof value !== 'object') return false;
    const answer = value as Partial<DeskLampsAnswer>;
    const light = answer.light;
    return answer.ok === true
        && isCount(answer.invites_received)
        && (light === null || (!!light
            && DESK_LAMP_STATES.has(light.state)
            && Array.isArray(light.audience)
            && light.audience.every(id => typeof id === 'string' && COMMUNITY_UUID_RE.test(id))))
        && Array.isArray(answer.lamps) && answer.lamps.every(isDeskLampFriend)
        && Array.isArray(answer.lit) && answer.lit.every(isLitDeskLamp);
}

/**
 * The plugin's one Desk Lamps call (community-desk-lamps). `light` omitted
 * only reads; `null` turns this vault's lamp off; a DeskLampLight lights it.
 * Every call answers the member's Desk Lamps and the lamps lit for them.
 *
 * Works at every sharing level, Private included (plan D12). Lighting needs
 * sharing unpaused (a paused share sends no lamp); reading and turning the
 * lamp off are allowed while paused.
 */
export async function syncDeskLamps(plugin: RadialTimelinePlugin, light?: DeskLampLight | null): Promise<DeskLampsAnswer> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin, true);
    assertStillSendable(plugin, connection, !light, true);
    const body: Record<string, unknown> = {
        connection_id: connectionId,
        current_secret: currentSecret
    };
    if (light !== undefined) body.light = light;
    return postCommunityFunction(
        plugin,
        'community-desk-lamps',
        body,
        isDeskLampsAnswer,
        { code: 'desk_lamps_failed', message: t('ui.communityShareClient.deskLampsFailed') },
        t('ui.communityShareClient.deskLampsUnexpected')
    );
}

/**
 * Refusals raised because the vault stopped sharing, or changed connection,
 * before the send. The sync was no longer due, so they are not a failed sync
 * and are not recorded on the connection.
 */
const BOOK_LIST_SYNC_NOT_DUE = new Set(['connection_required', 'sharing_paused', 'connection_changed']);

/**
 * Sync every Book Manager book to the community website as a project shell.
 * New shells arrive PRIVATE; the author chooses what to share on the website.
 * Sync never changes visibility and never deletes shells.
 *
 * Every attempt that reaches the website, or fails on the way, is recorded on
 * the connection (bookListSyncedAt, or bookListSyncError + bookListSyncFailedAt)
 * for the Mailbox's Community sync row. With no books nothing is sent and
 * nothing is recorded.
 */
export async function syncCommunityProjects(plugin: RadialTimelinePlugin): Promise<ProjectSyncSuccess> {
    const attemptConnectionId = normalizeCommunityShareSettings(plugin.settings.communityShare).connection.connectionId;
    let parsed: ProjectSyncSuccess | null;
    try {
        parsed = await postCommunityProjects(plugin);
    } catch (error) {
        if (!(error instanceof CommunityShareError && BOOK_LIST_SYNC_NOT_DUE.has(error.code))) {
            await recordBookListSync(plugin, attemptConnectionId, { failed: error instanceof Error ? error.message : String(error) });
        }
        throw error;
    }
    if (!parsed) return { ok: true, created: 0, updated: 0, projects: [] };
    await recordBookListSync(plugin, attemptConnectionId, { synced: parsed });
    return parsed;
}

/**
 * Store one book-list sync outcome on the live connection and save. An
 * outcome for a connection that changed while the sync was out is dropped:
 * it belongs to the old connection.
 *
 * A success also stores the server's binding. The binding is authoritative
 * on every sync: a connection activated without a book is bound to the first
 * synced shell, and the website's "Change book" control
 * (community-connection-rebind) re-points a bound connection at another book;
 * either way the response carries the binding after this call as
 * connection_project_id. Servers that predate the field omit it. A changed
 * binding changes the report's project, so a ready preview goes stale and is
 * reviewed again before the next manual publish.
 */
async function recordBookListSync(
    plugin: RadialTimelinePlugin,
    attemptConnectionId: string | undefined,
    outcome: { synced: ProjectSyncSuccess } | { failed: string }
): Promise<void> {
    const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!attemptConnectionId || live.connection.connectionId !== attemptConnectionId) return;
    const at = new Date().toISOString();
    if ('failed' in outcome) {
        commitCommunityShare(plugin, current => ({
            ...current,
            connection: { ...current.connection, bookListSyncError: outcome.failed, bookListSyncFailedAt: at }
        }));
    } else {
        const bound = outcome.synced.connection_project_id;
        const cached = live.connection.projectId ?? null; // SAFE: an absent cached id and null both mean unbound
        const projectId = bound === undefined ? live.connection.projectId : bound;
        const rebound = bound !== undefined && cached !== bound;
        commitCommunityShare(plugin, current => ({
            ...current,
            connection: {
                ...current.connection,
                projectId,
                bookListSyncedAt: at,
                bookListSyncError: undefined,
                bookListSyncFailedAt: undefined
            },
            preview: rebound && current.preview.status === 'ready'
                ? { ...current.preview, status: 'stale' }
                : current.preview
        }));
    }
    await plugin.saveSettings();
}

/** Send the Book Manager list; null when there are no books, so nothing was sent. */
async function postCommunityProjects(plugin: RadialTimelinePlugin): Promise<ProjectSyncSuccess | null> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);

    const books = (plugin.settings.books ?? []).slice(0, 50); // SAFE: no books configured means nothing to sync; the empty-list branch below returns early
    if (!books.length) return null;

    // Publishing targets are per book (BookProfile.stageTargetDates): every
    // book sends its own four dates — value or null, so a cleared date clears
    // the server copy too. Zero-draft mode is still a vault-global working
    // mode, so it rides along on the active book only. All of it stays private
    // server-side until the author reveals it in My Share.
    const targetDate = (value?: string): string | null =>
        value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    const activeBookId = plugin.settings.activeBookId;
    assertStillSendable(plugin, connection);

    return postCommunityFunction(
        plugin,
        'community-project-sync',
        {
            connection_id: connectionId,
            current_secret: currentSecret,
            projects: books.map((book, index) => ({
                book_key: book.id,
                title: (book.publicLabel || book.title || 'Untitled book').slice(0, 140), // SAFE: the author's public label wins over the private title; the literal is the last-resort label for an unnamed book
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
        },
        isProjectSyncSuccess,
        { code: 'project_sync_failed', message: t('ui.communityShareClient.projectSyncFailed') },
        t('ui.communityShareClient.projectSyncUnexpected')
    );
}

/**
 * Fire-and-forget project sync for plugin load: silently no-ops when
 * Community Share is not connected, and never throws into the caller. A
 * failure is recorded on the connection by syncCommunityProjects, so the
 * Mailbox's Community sync row shows it.
 */
export async function syncCommunityProjectsIfConnected(plugin: RadialTimelinePlugin): Promise<void> {
    if (!expectsBookListSync(normalizeCommunityShareSettings(plugin.settings.communityShare))) return; // SAFE: load-time sync precondition — disabled, paused, or disconnected is the documented no-op for this fire-and-forget path
    try {
        await syncCommunityProjects(plugin);
    } catch (error) {
        console.warn('Community project sync skipped:', error instanceof Error ? error.message : error);
        return;
    }
    // The load-time sync runs before the vault is indexed, and a partial read
    // would drop the reveals of every scene it missed. The 20 s kickoff in
    // main.ts covers that first send.
    if (plugin.app.workspace?.layoutReady) await syncCommunityTimelinesIfDue(plugin);
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

export function scheduleCommunityProjectSync(plugin: RadialTimelinePlugin): Promise<void> {
    const elapsed = Date.now() - lastProjectSyncAt;
    if (elapsed >= PROJECT_SYNC_WINDOW_MS) {
        lastProjectSyncAt = Date.now();
        return syncCommunityProjectsIfConnected(plugin);
    }
    if (pendingProjectSync !== null) return Promise.resolve(); // trailing sync already queued
    pendingProjectSync = window.setTimeout(() => {
        pendingProjectSync = null;
        lastProjectSyncAt = Date.now();
        void syncCommunityProjectsIfConnected(plugin);
    }, PROJECT_SYNC_WINDOW_MS - elapsed);
    return Promise.resolve();
}

/** Drop a queued trailing project sync. Called on plugin unload so the timer never fires against a dead instance. */
export function cancelPendingCommunityProjectSync(): void {
    if (pendingProjectSync !== null) {
        window.clearTimeout(pendingProjectSync);
        pendingProjectSync = null;
    }
}

export async function beginCommunitySharing(plugin: RadialTimelinePlugin): Promise<PublishSuccess> {
    const result = await publishCommunityShareReport(plugin, 'manual');
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: true,
        sharingPaused: false
    });
    await plugin.saveSettings();
    // Companion daily-aggregate sync rides along with the successful publish;
    // it never blocks or fails the publish itself.
    await syncCommunityDailyIfEligible(plugin);
    return result;
}

// -- Sharing notices: who paused, and when (Eric's decision, 2026-11-22) ------
//
// Pause and Resume each tell Community one content-free fact: that it happened,
// and for a resume, the time of a pause whose own notice never arrived. The
// vault acts first and tells Community after: a failed notice never blocks the
// author's choice. A pause Community did not hear is told with the next resume
// (`paused_at`); a resume it did not hear goes again before the next sync.

function isVaultSharingAnswer(value: unknown): value is { ok: true; sharing: VaultSharingState } {
    const body = value as { ok?: unknown; sharing?: unknown };
    return body?.ok === true && readVaultSharingState(body.sharing) !== null;
}

/** One sharing notice, or the history read, on `community-share-context`. Works at every level and while paused. */
async function postSharingNotice(plugin: RadialTimelinePlugin, action: 'pause' | 'resume' | 'history', pausedAt?: string): Promise<VaultSharingState> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin, true);
    assertStillSendable(plugin, connection, true, true);
    const answer = await postCommunityFunction(
        plugin,
        'community-share-context',
        { action, connection_id: connectionId, current_secret: currentSecret, ...(pausedAt ? { paused_at: pausedAt } : {}) },
        isVaultSharingAnswer,
        { code: 'sharing_notice_failed', message: t('ui.communityShareClient.sharingNoticeFailed') },
        t('ui.communityShareClient.sharingNoticeUnexpected')
    );
    return readVaultSharingState(answer.sharing)!; // SAFE: isVaultSharingAnswer read it
}

/**
 * Tell Community the notice it is owed, and clear it once told. A notice made
 * stale by a newer Pause or Resume is left to that one. Never throws.
 */
async function tellOwedSharingNotice(plugin: RadialTimelinePlugin): Promise<void> {
    const owed = normalizeCommunityShareSettings(plugin.settings.communityShare).sharingNoticeOwed;
    if (!owed) return;
    let told = false;
    try {
        await postSharingNotice(plugin, owed.action, owed.action === 'resume' ? owed.pausedAt : undefined);
        told = true;
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'sharing_notice_failed';
        // A time Community refuses (this computer's clock) is told no better by
        // waiting; the resume itself goes again without it.
        if (code === 'invalid_time' && owed.action === 'resume' && owed.pausedAt) {
            commitCommunityShare(plugin, live => (sameNotice(live.sharingNoticeOwed, owed) ? { ...live, sharingNoticeOwed: { action: 'resume' } } : live));
            await plugin.saveSettings();
            return tellOwedSharingNotice(plugin);
        }
        console.warn('Community sharing notice not sent yet:', error instanceof Error ? error.message : error);
    }
    if (!told) return;
    commitCommunityShare(plugin, live => (sameNotice(live.sharingNoticeOwed, owed) ? { ...live, sharingNoticeOwed: undefined } : live));
    await plugin.saveSettings();
}

function sameNotice(a: CommunitySharingNoticeOwed | undefined, b: CommunitySharingNoticeOwed): boolean {
    return !!a && a.action === b.action && a.pausedAt === b.pausedAt;
}

/** Before an outbound sync: a resume Community did not hear goes first. */
async function tellOwedResume(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (current.sharingPaused || current.sharingNoticeOwed?.action !== 'resume' || !hasCommunityConnection(current)) return;
    await tellOwedSharingNotice(plugin);
}

/** The vault's sharing state on Community: its pause, the account's standing, and recent events. Sends nothing about the books. */
export function fetchVaultSharingState(plugin: RadialTimelinePlugin): Promise<VaultSharingState> {
    return postSharingNotice(plugin, 'history');
}

export async function pauseCommunitySharing(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const at = new Date().toISOString();
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: false,
        // Hard freeze: block report sync, daily aggregates, project shell sync,
        // APR uploads, session feed posts and timeline updates until the author
        // resumes. The one exception is the notice below: that it paused, and when.
        sharingPaused: true,
        sharingPausedAt: at,
        sharingNoticeOwed: hasCommunityConnection(current) ? { action: 'pause', pausedAt: at } : undefined,
        publishHistory: appendHistory(current, {
            id: `pause-${at}`,
            action: 'pause',
            status: 'success',
            at,
            message: 'Sharing paused. Only the notice that it paused leaves this vault until resumed; already shared data stays visible.'
        })
    });
    await plugin.saveSettings();
    await tellOwedSharingNotice(plugin);
}

export async function resumeCommunitySharing(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const at = new Date().toISOString();
    const untoldPause = current.sharingNoticeOwed?.action === 'pause' ? current.sharingNoticeOwed.pausedAt : undefined;
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        sharingPaused: false,
        sharingPausedAt: undefined,
        sharingNoticeOwed: hasCommunityConnection(current) ? { action: 'resume', ...(untoldPause ? { pausedAt: untoldPause } : {}) } : undefined,
        scheduledPublishEnabled: true,
        publishHistory: appendHistory(current, {
            id: `resume-${at}`,
            action: 'resume',
            status: 'success',
            at,
            message: 'Sharing resumed.'
        })
    });
    await plugin.saveSettings();
    await tellOwedSharingNotice(plugin);
    // Push anything that changed while paused so the website catches up, then
    // refresh the daily aggregate companion. Both handle their own failures.
    await syncCommunityShareIfDue(plugin);
    await syncCommunityDailyIfEligible(plugin);
    await syncCommunityTimelinesIfDue(plugin);
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


// Server refusals that mean "this server does not accept the backfill
// window" (an older community-daily-sync: 30 entries, 60-day lookback). The
// sync falls back to the normal window and leaves the backfill due.
const BACKFILL_WINDOW_REJECTED_CODES = new Set(['too_many_days', 'date_too_old']);

/**
 * The season backfill is due unless the live connection's recipient has
 * already confirmed one that covers what the current settings would send:
 * - no record (never confirmed, or a legacy vault-wide marker was dropped);
 * - a record from an older COMMUNITY_DAILY_BACKFILL_VERSION;
 * - a record for a different profile or connection (a newly activated
 *   connection gets its own backfill);
 * - a record without words while words are now included.
 */
function isDailyBackfillDue(settings: CommunityShareSettings): boolean {
    const record = settings.dailyBackfill;
    if (!record) return true;
    if (record.version < COMMUNITY_DAILY_BACKFILL_VERSION) return true;
    if (record.profileId !== settings.connection.profileId || record.connectionId !== settings.connection.connectionId) return true;
    return !record.wordsIncluded && communityDailyIncludesWords(settings);
}

/**
 * Fire-and-forget daily-activity sync: sends per-day aggregates
 * (community_daily) so the author page can show weekly stats, plus the
 * optional `hour_mode_mix` companion field — a trailing 28-day, undated
 * rollup of session minutes by local start hour and mode, for the community
 * "activity dial." Consent-consistent — runs only while the standing share
 * is active at the progress level (public, tier 4); private, paused, or
 * revoked shares never send either field.
 *
 * Window: the normal sync sends the trailing COMMUNITY_DAILY_WINDOW_DAYS.
 * While a season backfill is due (see isDailyBackfillDue), it sends
 * COMMUNITY_DAILY_BACKFILL_DAYS instead, under the identical gates, and
 * records `dailyBackfill` — the receiving profile and connection, the
 * backfill version, and whether the days actually carried words — only after
 * the server confirms and only if the live connection is still the one the
 * request went to. A server that rejects the backfill window gets the normal
 * window in the same sync; the backfill stays due for the next one.
 *
 * Silent by design: a standing-authorization failure stops scheduled sharing
 * (same auto-stop rule as the report sync); transient failures only log to
 * the console, never Notices, never repeated history entries.
 */
export async function syncCommunityDailyIfEligible(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.sharingPaused) return;
    if (current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) return;
    if (current.audience !== 'public' || current.tier !== 4) return;

    try {
        const currentSecret = await getSecret(plugin.app, current.connection.secretId);
        if (!currentSecret) return;

        const backfillDue = isDailyBackfillDue(current);
        // Resolves to what was delivered (null when nothing was sent).
        const sendDays = async (windowDays: number): Promise<{ wordsIncluded: boolean } | null> => {
            const days = await buildCommunityDailyEntries(plugin, windowDays);
            if (!days.length) return null;
            // Same tier-4 public gate as `days` above — hour_mode_mix is a
            // companion rollup of the identical session store, not a separately
            // gated field. Optional on the wire: the server accepts its absence.
            const hourModeMix = await buildCommunityHourModeMixEntries(plugin);
            // Pause is a hard freeze and a disconnect revokes the secret we hold:
            // honour either if it landed while the aggregates were building.
            const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
            if (!isStillSendable(live, current.connection) || live.audience !== 'public' || live.tier !== 4) return null;

            await postCommunityFunction(
                plugin,
                'community-daily-sync',
                {
                    connection_id: current.connection.connectionId,
                    current_secret: currentSecret,
                    days,
                    hour_mode_mix: hourModeMix
                },
                isOkResponse,
                { code: 'daily_sync_failed', message: t('ui.communityShareClient.dailySyncFailed') },
                t('ui.communityShareClient.dailySyncUnexpected')
            );
            // Truth from the payload itself, not from settings that may have
            // changed while the entries were building.
            return { wordsIncluded: days.every(day => day.words_added !== undefined && day.words_logged !== undefined) };
        };

        if (!backfillDue) {
            await sendDays(COMMUNITY_DAILY_WINDOW_DAYS);
            return;
        }

        let backfill: { wordsIncluded: boolean } | null = null;
        try {
            backfill = await sendDays(COMMUNITY_DAILY_BACKFILL_DAYS);
        } catch (error) {
            if (!(error instanceof CommunityShareError) || !BACKFILL_WINDOW_REJECTED_CODES.has(error.code)) throw error;
            console.warn(
                `Community daily activity backfill (${COMMUNITY_DAILY_BACKFILL_DAYS} days) was rejected by the server (${error.code}: ${error.message}). `
                + `Sending the normal ${COMMUNITY_DAILY_WINDOW_DAYS}-day window instead; the backfill will be retried on the next sync.`
            );
            await sendDays(COMMUNITY_DAILY_WINDOW_DAYS);
            return;
        }
        const sentConnectionId = current.connection.connectionId;
        const sentProfileId = current.connection.profileId;
        if (!backfill || !sentProfileId) return;
        // The response confirms delivery to the connection the request was
        // sent over. If a reconnect/activation replaced it while the request
        // was out, that completion must not be stamped onto the replacement.
        const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
        if (live.connection.connectionId !== sentConnectionId || live.connection.profileId !== sentProfileId) return;
        const record = {
            version: COMMUNITY_DAILY_BACKFILL_VERSION,
            profileId: sentProfileId,
            connectionId: sentConnectionId,
            wordsIncluded: backfill.wordsIncluded
        };
        commitCommunityShare(plugin, state => ({ ...state, dailyBackfill: record }));
        await plugin.saveSettings();
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'daily_sync_failed';
        const message = error instanceof Error ? error.message : t('ui.communityShareClient.dailySyncFailed');
        if (SYNC_STOP_CODES.has(code)) {
            const at = new Date().toISOString();
            commitCommunityShare(plugin, live => ({
                ...live,
                scheduledPublishEnabled: false,
                publishHistory: appendHistory(live, {
                    id: `daily-sync-${at}`,
                    action: 'sync',
                    status: 'failed',
                    at,
                    message: `${message} Sharing stopped.`
                }),
                lastError: message
            }));
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
// The scheduled sync is reachable from the 20 s startup timer, the 6 h
// interval, Resume, and the settings preview builder. Two of those can
// overlap; a second run while one is in flight would publish the same
// payload twice and write two history entries. Callers share the in-flight
// promise instead.
let shareSyncInflight: Promise<'synced' | 'skipped' | 'failed'> | null = null;

export function syncCommunityShareIfDue(plugin: RadialTimelinePlugin): Promise<'synced' | 'skipped' | 'failed'> {
    if (shareSyncInflight) return shareSyncInflight;
    shareSyncInflight = runShareSync(plugin).finally(() => {
        shareSyncInflight = null;
    });
    return shareSyncInflight;
}

async function runShareSync(plugin: RadialTimelinePlugin): Promise<'synced' | 'skipped' | 'failed'> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || !current.scheduledPublishEnabled) return 'skipped';
    // Belt-and-braces alongside scheduledPublishEnabled: a paused vault never
    // pushes, even if some path left the schedule flag on.
    if (current.sharingPaused) return 'skipped';
    if (current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) return 'skipped';
    if (current.audience !== 'public' || current.tier < 1 || current.tier > 4) return 'skipped';
    await tellOwedResume(plugin);

    try {
        const preview = await buildCommunitySharePreview(plugin);
        if (preview.payloadHash === current.connection.lastSyncedPayloadHash) {
            // The report is unchanged, but a due one-time season backfill must
            // not wait for new writing (a paused author would never get it).
            // syncCommunityDailyIfEligible applies its own pause/tier/connection
            // gates and records the marker only on server success.
            if (isDailyBackfillDue(current)) await syncCommunityDailyIfEligible(plugin);
            return 'skipped';
        }
        // A Pause or Disconnect that landed while the preview was building is
        // a clean skip, not a failed sync with an error entry.
        const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
        if (!isStillSendable(live, current.connection) || !live.scheduledPublishEnabled || !live.manualPublishEnabled
            || live.audience !== 'public' || live.tier !== current.tier) return 'skipped';

        commitCommunityShare(plugin, state => ({
            ...state,
            preview: {
                status: 'ready',
                generatedAt: new Date().toISOString(),
                previewHash: preview.previewHash,
                payloadHash: preview.payloadHash,
                reportPeriod: 'weekly',
                summary: preview.summary
            }
        }));
        await plugin.saveSettings();
        await publishCommunityShareReport(plugin, 'scheduled');
        // Companion daily-aggregate sync rides along with the successful
        // report sync; it handles its own failures and never throws.
        await syncCommunityDailyIfEligible(plugin);
        return 'synced';
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'sync_failed';
        const message = error instanceof Error ? error.message : t('ui.communityShareClient.shareSyncFailed');
        const stopped = SYNC_STOP_CODES.has(code);
        const at = new Date().toISOString();
        // A disconnect Community reported is already recorded, with its own note.
        const reported = code === 'connection_disconnected';
        commitCommunityShare(plugin, live => ({
            ...live,
            scheduledPublishEnabled: stopped ? false : live.scheduledPublishEnabled,
            publishHistory: appendHistory(live, {
                id: `sync-${at}`,
                action: 'sync',
                status: 'failed',
                at,
                message: stopped ? `${message} Sharing stopped.` : message
            }),
            lastError: reported ? live.lastError : message
        }));
        await plugin.saveSettings();
        return 'failed';
    }
}

// -- Timeline sharing (Settings → Community) ----------------------------------

/** A share as the website summarizes it. Never carries the document. */
export interface TimelineShareSummary {
    status: 'private' | 'active';
    scene_count: number;
    revealed_count: number;
    hidden_scene_fields: TimelineSceneDetail[];
    generic_subplot_names: boolean;
}

export type TimelineSceneDetail = 'title' | 'synopsis' | 'characters' | 'povMode' | 'when';

export interface TimelineShareAnswer {
    ok: true;
    shared: boolean;
    project_id: string;
    share?: TimelineShareSummary;
    summary?: { scenes_without_stable_id: number; reveals_dropped: number[] };
    preview_document?: TimelinePreviewDocument;
    reader_access?: "available" | "unavailable" | "unknown";
    /** Who paused or stopped what for this book, and when (`status` only); read by readBookSharingState. */
    sharing?: BookSharingState | null;
}

export function isTimelineShareAnswer(value: unknown): value is TimelineShareAnswer {
    if (!value || typeof value !== 'object') return false;
    const answer = value as Partial<TimelineShareAnswer>;
    const share = answer.share;
    return answer.ok === true
        && typeof answer.shared === 'boolean'
        && typeof answer.project_id === 'string' && COMMUNITY_UUID_RE.test(answer.project_id)
        && (answer.preview_document === undefined || isTimelinePreviewDocument(answer.preview_document))
        && (answer.reader_access === undefined || ["available", "unavailable", "unknown"].includes(answer.reader_access))
        && (answer.shared === false || (!!share
            && (share.status === 'private' || share.status === 'active')
            && Array.isArray(share.hidden_scene_fields)
            && typeof share.generic_subplot_names === 'boolean'));
}

async function postTimelineShare(plugin: RadialTimelinePlugin, body: Record<string, unknown>): Promise<TimelineShareAnswer> {
    const answer = await postCommunityFunction(
        plugin,
        'timeline-share-sync',
        body,
        isTimelineShareAnswer,
        { code: 'timeline_share_failed', message: t('ui.communityShareClient.timelineShareFailed') },
        t('ui.communityShareClient.timelineShareUnexpected')
    );
    return { ...answer, sharing: readBookSharingState((answer as { sharing?: unknown }).sharing) };
}

function isUpdatesNoticeAnswer(value: unknown): value is { ok: true; sharing: unknown } {
    const body = value as { ok?: unknown; sharing?: unknown };
    return body?.ok === true && readBookSharingState(body.sharing) !== null;
}

/**
 * Keep timeline updated turned off or on in this vault: one content-free
 * notice on `timeline-share-sync`, the book's key and, for a resume, the time
 * of a stop whose own notice never arrived. Cleared once told, or when the book
 * has no timeline on Community to tell about. Never throws.
 */
async function tellOwedUpdatesNotice(plugin: RadialTimelinePlugin, bookId: string): Promise<void> {
    const before = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const record = timelineShareFor(before, bookId);
    const owed = record?.updatesNoticeOwed;
    const profileId = before.connection.profileId;
    if (!owed || !profileId) return;
    let settled = false;
    try {
        const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin, true);
        assertStillSendable(plugin, connection, true, true);
        await postCommunityFunction(
            plugin,
            'timeline-share-sync',
            {
                action: owed.action === 'stop' ? 'stop_updates' : 'resume_updates',
                connection_id: connectionId,
                current_secret: currentSecret,
                plugin_book_key: bookId,
                ...(owed.action === 'resume' && owed.stoppedAt ? { stopped_at: owed.stoppedAt } : {}),
            },
            isUpdatesNoticeAnswer,
            { code: 'sharing_notice_failed', message: t('ui.communityShareClient.sharingNoticeFailed') },
            t('ui.communityShareClient.sharingNoticeUnexpected')
        );
        settled = true;
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'sharing_notice_failed';
        // No timeline on Community, or none this vault sends to: nothing to tell.
        settled = code === 'timeline_not_shared' || code === 'book_disconnected' || code === 'book_deleted';
        if (!settled) console.warn('Community timeline notice not sent yet:', error instanceof Error ? error.message : error);
    }
    if (!settled) return;
    await saveTimelineRecord(plugin, bookId, profileId, current => (
        current.updatesNoticeOwed?.action === owed.action && current.updatesNoticeOwed.stoppedAt === owed.stoppedAt
            ? { ...current, updatesNoticeOwed: undefined }
            : current
    ));
}

/**
 * Keep timeline updated turned on again after this vault turned it off: the
 * record owes Community a resume, sent before the next push. A stop Community
 * never heard rides along as `stopped_at`.
 */
function resumeAfterStop(record: CommunityTimelineShareRecord | undefined): Pick<CommunityTimelineShareRecord, 'updatesNoticeOwed'> {
    if (!record?.updatesStoppedAt && !record?.updatesNoticeOwed) return {};
    if (record.updatesNoticeOwed?.action === 'resume') return { updatesNoticeOwed: record.updatesNoticeOwed };
    const untoldStop = record.updatesNoticeOwed?.action === 'stop' ? record.updatesNoticeOwed.stoppedAt : undefined;
    return { updatesNoticeOwed: { action: 'resume', ...(untoldStop ? { stoppedAt: untoldStop } : {}) } };
}

async function saveTimelineRecord(
    plugin: RadialTimelinePlugin,
    bookId: string,
    profileId: string,
    update: (record: CommunityTimelineShareRecord) => CommunityTimelineShareRecord
): Promise<void> {
    commitCommunityShare(plugin, live => {
        // The author may have reconnected as someone else while this was out.
        if (live.connection.profileId !== profileId) return live;
        const base = timelineShareFor(live, bookId) ?? { profileId, enabled: false };
        return { ...live, timelineShares: { ...live.timelineShares, [bookId]: update(base) } };
    });
    await plugin.saveSettings();
}

/** The code of a send held in the vault because the book could not be read whole. Nothing was sent. */
const TIMELINE_SCAN_HELD = 'timeline_scan_held';

/**
 * Why this book's timeline cannot be read whole right now, or null when it
 * can. A timeline built from a partial read looks to the website like scenes
 * the author removed, so a send the plugin knows is incomplete is never made:
 *
 * - `layout`: Obsidian has not finished opening the vault.
 * - `folder`: the book's folder is not in the vault (not created yet on this
 *   device, or still on its way from a sync service).
 * - `unread`: a note in the folder has not been read into Obsidian's metadata
 *   cache yet, so the scene it may hold would be left out.
 */
export function timelineScanHold(plugin: RadialTimelinePlugin, book: Pick<BookProfile, 'sourceFolder'>): 'layout' | 'folder' | 'unread' | null {
    const { workspace, vault, metadataCache } = plugin.app;
    if (!workspace.layoutReady) return 'layout';
    const folder = normalizePath(book.sourceFolder);
    if (!vault.getFolderByPath(folder)) return 'folder';
    const unread = vault.getMarkdownFiles().some(file => isPathInFolderScope(file.path, folder) && metadataCache.getFileCache(file) === null);
    return unread ? 'unread' : null;
}

/**
 * Send one book's timeline. Returns null when nothing changed since the last
 * send. `create` is the author turning Share timeline on; a background update
 * cannot create, so a timeline deleted on the website stays deleted.
 *
 * Checked again immediately before the request leaves: reading the book awaits,
 * and Pause or Disconnect can land in that window.
 */
async function pushTimeline(plugin: RadialTimelinePlugin, book: BookProfile, create: boolean): Promise<TimelineShareAnswer | null> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    const profileId = connection.profileId;
    if (!profileId) throw new CommunityShareError('connection_required', t('ui.communityShareClient.connectBeforeSync'));

    // Keep timeline updated turned back on: Community hears that first, since a
    // push does not end a stop. Turning it on (create) is the moment it is owed.
    const stopped = timelineShareFor(normalizeCommunityShareSettings(plugin.settings.communityShare), book.id);
    if (create && stopped && !stopped.enabled && resumeAfterStop(stopped).updatesNoticeOwed) {
        await saveTimelineRecord(plugin, book.id, profileId, record => ({ ...record, ...resumeAfterStop(record), updatesStoppedAt: undefined }));
    }

    const hold = timelineScanHold(plugin, book);
    if (hold) {
        throw new CommunityShareError(TIMELINE_SCAN_HELD, t(hold === 'folder'
            ? 'ui.communityShareClient.timelineFolderMissing'
            : 'ui.communityShareClient.timelineStillReading'));
    }

    // This book's metadata comes from the same read as its scenes: the plugin-wide
    // BookMeta follows whichever book was read last.
    const { items, bookMeta } = await plugin.getSceneDataService().getSceneDataWithBookMeta({ sourcePath: book.sourceFolder });
    const before = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const previous = timelineShareFor(before, book.id);
    if (hasAmbiguousSceneIdHolders(items, previous?.sceneIdPaths)) {
        throw new CommunityShareError('ambiguous_scene_ids', t('ui.communityShareClient.timelineDuplicateSceneIds'));
    }
    const holders = sceneIdHolders(items, previous?.sceneIdPaths);
    const payload = buildTimelineSharePayload({
        items,
        bookMeta,
        book,
        actCount: plugin.settings.actCount,
        pluginVersion: plugin.manifest.version,
        exportId: crypto.randomUUID(),
        now: new Date(),
        sceneIdHolders: holders,
    });
    if (payload.items.length === 0) {
        throw new CommunityShareError('empty_timeline', t('ui.communityShareClient.timelineNoScenes'));
    }
    if (previous?.updatesNoticeOwed?.action === 'resume') await tellOwedUpdatesNotice(plugin, book.id);

    const hash = await sha256Hex(timelinePayloadFingerprint(payload));
    if (!create && previous?.lastSentHash === hash) {
        // Nothing the website reads changed, but a note that holds an id may have
        // been renamed: remember it under its new path, or a later duplicate could
        // take the id from it.
        if (JSON.stringify(previous.sceneIdPaths ?? {}) !== JSON.stringify(holders)) { // SAFE: a share record saved before sceneIdPaths existed holds none
            await saveTimelineRecord(plugin, book.id, profileId, record => ({ ...record, sceneIdPaths: holders }));
        }
        return null;
    }

    const live = assertStillSendable(plugin, connection);
    if (!canShareTimelineToCommunity(live)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.timelineLevelRequired'));
    }
    const answer = await postTimelineShare(plugin, {
        connection_id: connectionId,
        current_secret: currentSecret,
        action: 'push',
        plugin_book_key: book.id,
        export: payload,
        ...(create ? { create: true } : {}),
    });

    await saveTimelineRecord(plugin, book.id, profileId, record => ({
        profileId,
        enabled: create || record.enabled,
        lastSentHash: hash,
        lastSentAt: new Date().toISOString(),
        droppedReveals: answer.summary?.reveals_dropped ?? [], // SAFE: the share summary is optional in the response; absent = nothing dropped
        scenesWithoutStableId: answer.summary?.scenes_without_stable_id ?? 0, // SAFE: the share summary is optional in the response; absent = none
        sceneIdPaths: holders,
        // A resume Community has not heard yet goes again before the next push.
        ...(record.updatesNoticeOwed ? { updatesNoticeOwed: record.updatesNoticeOwed } : {}),
    }));
    return answer;
}

/**
 * Share timeline, turned on. Sends the book, private: the website holds it until
 * the author reviews it and goes live there. Syncs the book list first, because
 * a timeline attaches to the book's project shell.
 */
export async function startTimelineSharing(plugin: RadialTimelinePlugin, book: BookProfile): Promise<TimelineShareAnswer> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!canShareTimelineToCommunity(current)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.timelineLevelRequired'));
    }
    await syncCommunityProjects(plugin);
    const answer = await pushTimeline(plugin, book, true);
    if (!answer) throw new CommunityShareError('invalid_response', t('ui.communityShareClient.timelineShareUnexpected'));
    return answer;
}

/**
 * Keep timeline updated, turned off. Stops updates, then tells Community only
 * that it stopped, and when: taking the timeline offline or deleting it stays
 * on the website.
 */
export async function stopTimelineSharing(plugin: RadialTimelinePlugin, bookId: string): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const profileId = current.connection.profileId;
    if (!profileId) return;
    const wasOn = timelineShareFor(current, bookId)?.enabled === true;
    const at = new Date().toISOString();
    await saveTimelineRecord(plugin, bookId, profileId, record => ({
        profileId,
        enabled: false,
        ...(wasOn ? { updatesStoppedAt: at, updatesNoticeOwed: { action: 'stop' as const, stoppedAt: at } } : {}),
        ...(!wasOn && record.updatesStoppedAt ? { updatesStoppedAt: record.updatesStoppedAt } : {}),
        ...(!wasOn && record.updatesNoticeOwed ? { updatesNoticeOwed: record.updatesNoticeOwed } : {}),
    }));
    if (wasOn) await tellOwedUpdatesNotice(plugin, bookId);
}

/**
 * True when the book's timeline was sent after `requestedAt`. A "not shared"
 * answer to a request older than that send predates the share (Share timeline
 * turned on while the request was out), so it must not turn sharing off.
 * Turning sharing on always stamps `lastSentAt`.
 */
function sentSince(record: CommunityTimelineShareRecord, requestedAt: number): boolean {
    return !!record.lastSentAt && Date.parse(record.lastSentAt) > requestedAt;
}

/**
 * Read one book's share for the Timeline block. READ-only, so it works while
 * sharing is paused, like the website context. A timeline deleted on the website
 * turns Share timeline off here, so the block never claims a share that is gone.
 */
export async function fetchTimelineShareStatus(plugin: RadialTimelinePlugin, bookId: string): Promise<TimelineShareAnswer> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    assertStillSendable(plugin, connection, true);
    const requestedAt = Date.now();
    const profileId = connection.profileId;
    let answer: TimelineShareAnswer;
    try {
        answer = await postTimelineShare(plugin, {
            connection_id: connectionId,
            current_secret: currentSecret,
            action: 'status',
            include_preview: true,
            plugin_book_key: bookId,
        });
    } catch (error) {
        // Disconnected from this vault on Community: Keep timeline updated turns off here, with when.
        if (error instanceof CommunityShareError && error.code === 'book_disconnected' && profileId) {
            await saveTimelineRecord(plugin, bookId, profileId, record => (
                record.enabled && !sentSince(record, requestedAt) ? { ...record, enabled: false, lastError: error.message } : record
            ));
        }
        throw error;
    }
    const record = timelineShareFor(normalizeCommunityShareSettings(plugin.settings.communityShare), bookId);
    if (!answer.shared && record?.enabled && profileId && !sentSince(record, requestedAt)) {
        await saveTimelineRecord(plugin, bookId, profileId, () => ({
            profileId,
            enabled: false,
            lastError: t('ui.communityShareClient.timelineRemovedOnWebsite'),
        }));
    }
    return answer;
}

/**
 * The author's detail and ring-name choices. The website holds them and applies
 * them where it serves the timeline, so this is a write, never a local setting,
 * and it stops at Pause with everything else outbound.
 */
export async function setTimelineShareDetails(
    plugin: RadialTimelinePlugin,
    bookId: string,
    details: { hiddenSceneFields?: TimelineSceneDetail[]; genericSubplotNames?: boolean }
): Promise<TimelineShareAnswer> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    const live = assertStillSendable(plugin, connection);
    if (!canShareTimelineToCommunity(live)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.timelineLevelRequired'));
    }
    return postTimelineShare(plugin, {
        connection_id: connectionId,
        current_secret: currentSecret,
        action: 'set_details',
        plugin_book_key: bookId,
        ...(details.hiddenSceneFields ? { hidden_scene_fields: details.hiddenSceneFields } : {}),
        ...(details.genericSubplotNames !== undefined ? { generic_subplot_names: details.genericSubplotNames } : {}),
    });
}

let timelineSyncInflight: Promise<void> | null = null;

/**
 * Standing timeline sync: every book with Share timeline on, when its timeline
 * changed. Silent by design, like the report sync: outcomes land on the book's
 * record for the Timeline block. Never throws, and overlapping callers share one
 * run.
 */
export function syncCommunityTimelinesIfDue(plugin: RadialTimelinePlugin): Promise<void> {
    if (timelineSyncInflight) return timelineSyncInflight;
    timelineSyncInflight = runTimelineSync(plugin).finally(() => {
        timelineSyncInflight = null;
    });
    return timelineSyncInflight;
}

async function runTimelineSync(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!canShareTimelineToCommunity(current) || !hasCommunityConnection(current)) return;
    const profileId = current.connection.profileId;
    if (!profileId) return;
    await tellOwedResume(plugin);

    for (const book of plugin.settings.books ?? []) { // SAFE: no books configured means nothing to send
        if (!timelineShareFor(current, book.id)?.enabled || !book.sourceFolder?.trim()) continue;
        const requestedAt = Date.now();
        try {
            await pushTimeline(plugin, book, false);
        } catch (error) {
            const code = error instanceof CommunityShareError ? error.code : 'timeline_share_failed';
            // Pause or Disconnect landing mid-run is a clean stop, not a failure;
            // a disconnect Community reported is recorded with its own note.
            if (code === 'sharing_paused' || code === 'connection_changed' || code === 'connection_disconnected') return;
            // A book that cannot be read whole yet is held here, with nothing
            // sent and nothing recorded, and tried again on the next cycle.
            if (code === TIMELINE_SCAN_HELD) continue;
            const message = error instanceof Error ? error.message : t('ui.communityShareClient.timelineShareFailed');
            const removed = code === 'timeline_not_shared';
            // Disconnected from this vault on Community: updates stop here, with when.
            const ended = removed || code === 'book_disconnected';
            try {
                await saveTimelineRecord(plugin, book.id, profileId, record => {
                    // Share timeline was turned on again while this update was out.
                    if (ended && sentSince(record, requestedAt)) return record;
                    return {
                        ...record,
                        enabled: ended ? false : record.enabled,
                        lastError: removed ? t('ui.communityShareClient.timelineRemovedOnWebsite') : message,
                    };
                });
            } catch (saveError) {
                console.warn('Community timeline sync could not record its outcome:', saveError instanceof Error ? saveError.message : saveError);
            }
            if (SYNC_STOP_CODES.has(code)) return;
        }
    }
}

// -- Book from Community (Settings → Community) -------------------------------
//
// A book whose timeline was made on the website, brought into the vault as a
// new book. The one read the plugin gets: `read` answers the author's own
// stored timeline and, when they ticked it on the website, their own released
// scene text, and only while the website holds an open transfer for this
// connection. Nothing about the vault is sent but the new book's id and the
// scene ids it wrote. Contract: Command Center "Stage B contract"; the writer
// is communityShare/bookTransferWriter.ts.

/** The code of a call the website answered without a refusal code of its own. */
export const BOOK_TRANSFER_FAILED = 'book_transfer_failed';

/** Community no longer holds this transfer (deleted, or past keeping): it has ended, the same as cancelled. */
export function isBookTransferNotFound(error: unknown): boolean {
    return error instanceof CommunityShareError && error.code === 'transfer_not_found';
}

/**
 * One call to timeline-transfer-sync. The outcome is a book whose timeline is
 * kept updated from this vault, so the gate is the timeline's: connected, not
 * paused, and a level above Private. Checked before the secret is read and
 * again immediately before the request leaves, like every sender here.
 */
async function postBookTransfer<T>(
    plugin: RadialTimelinePlugin,
    action: Record<string, unknown>,
    read: (value: unknown) => T | null
): Promise<T> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    const live = assertStillSendable(plugin, connection);
    if (!canShareTimelineToCommunity(live)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.timelineLevelRequired'));
    }
    const unexpected = t('ui.communityShareClient.bookTransferUnexpected');
    const raw = await postCommunityFunction(
        plugin,
        'timeline-transfer-sync',
        { connection_id: connectionId, current_secret: currentSecret, ...action },
        isOkResponse,
        { code: BOOK_TRANSFER_FAILED, message: t('ui.communityShareClient.bookTransferFailed') },
        unexpected
    );
    const answer = read(raw);
    if (answer === null) throw new CommunityShareError('invalid_response', unexpected);
    return answer;
}

/** The books Community is holding for this vault. Sends the connection's credentials and nothing else. */
export function listBookTransfers(plugin: RadialTimelinePlugin): Promise<BookTransferOffer[]> {
    return postBookTransfer(plugin, { action: 'list' }, readBookTransferList);
}

/** One waiting book: its timeline, and its released text when the author ticked that on the website. */
export function readBookTransfer(plugin: RadialTimelinePlugin, transferId: string): Promise<BookTransferRead> {
    return postBookTransfer(plugin, { action: 'read', transfer_id: transferId }, value => readBookTransferRead(value, transferId));
}

/**
 * Tell Community the notes are written. Carries the new book's id and the scene
 * ids, no text. A repeat gets the same answer, so it is safe to send again.
 */
export function finishBookTransfer(
    plugin: RadialTimelinePlugin,
    transferId: string,
    done: { pluginBookKey: string; sceneIds: string[] }
): Promise<BookTransferDone> {
    return postBookTransfer(
        plugin,
        { action: 'done', transfer_id: transferId, plugin_book_key: done.pluginBookKey, scene_ids: done.sceneIds },
        value => readBookTransferDone(value, done.pluginBookKey)
    );
}

/** Where a transfer stands on Community. Asked whenever the plugin is not sure: it never assumes. */
export function fetchBookTransferState(plugin: RadialTimelinePlugin, transferId: string): Promise<BookTransferState> {
    return postBookTransfer(plugin, { action: 'state', transfer_id: transferId }, readBookTransferState);
}

/**
 * Keep timeline updated, turned on for a book Community already follows from
 * this vault (a book just made from Community). Sends nothing itself: the next
 * timeline update goes out with the book sync, without `create`.
 */
export async function keepTimelineUpdated(plugin: RadialTimelinePlugin, bookId: string): Promise<void> {
    const profileId = normalizeCommunityShareSettings(plugin.settings.communityShare).connection.profileId;
    if (!profileId) throw new CommunityShareError('connection_required', t('ui.communityShareClient.connectBeforeSync'));
    await saveTimelineRecord(plugin, bookId, profileId, record => ({ profileId, enabled: true, ...resumeAfterStop(record) }));
}

// -- Scene text (Settings → Community → Vault → Community) --------------------
//
// The only path by which scene text leaves the vault. A scene is asked for on
// Community (contract 2026-11-22, "Scene text asked on Community, sent from
// the vault"); the vault answers: one call in sceneTextRequests.ts sends text,
// and it is called only from the Send button of the "Send scene to Community" dialog
// (SceneReleasePreviewModal), after the author has seen the very blocks that
// go. A release or an update always names the request it answers. No sync,
// timer or startup hook calls it: status, requests, consent and decline carry
// no text, and nothing here runs on its own. Below Level 4 nothing here leaves.
// Request shapes: sceneTextRequests.ts. Doctrine:
// docs/engineering/standards/writing-session-privacy.md.

export type SceneReleaseRating = 'general' | 'mature';

/** One released scene as the website reports it. Never carries the text. */
export interface SceneReleaseSummary {
    id: string;
    /** The stable id of the timeline scene the release sits on now; null when it is detached. */
    scene_id: string | null;
    scene_title: string;
    version: number;
    rating: SceneReleaseRating;
    words: number;
    /** SHA-256 of the released text, as sceneReleaseText.sceneTextHash computes it. */
    text_hash: string;
    /** Hidden from readers after a report: being checked, or held. The website says which. */
    hidden: boolean;
    released_at: string;
    updated_at: string;
    /** How many readers the author named for this scene. A count, never who. */
    readers: number;
}

export interface SceneReleaseStatus {
    project_id: string;
    /** Whether the account has agreed to the release terms. */
    consent: boolean;
    standing: null | 'account_flagged' | 'account_deletion_pending';
    has_timeline: boolean;
    /** Released scenes allowed per book for this account. */
    limit: number;
    releases: SceneReleaseSummary[];
}

/** What the website answers to a release or an update: the fields the plugin reads. */
export interface SceneReleaseResult {
    release: {
        id: string;
        scene_title: string;
        version: number;
        rating: SceneReleaseRating;
        words: number;
        hidden: boolean;
        released_at: string;
        updated_at: string;
    };
}

interface SceneReleaseConsentAnswer {
    ok: true;
    version: string;
}

const SCENE_TEXT_HASH_RE = /^[0-9a-f]{64}$/;
const SCENE_RELEASE_RATINGS: ReadonlySet<unknown> = new Set(['general', 'mature']);
const SCENE_RELEASE_STANDINGS: ReadonlySet<unknown> = new Set([null, 'account_flagged', 'account_deletion_pending']);

function isVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isSceneReleaseSummary(value: unknown): value is SceneReleaseSummary {
    if (!value || typeof value !== 'object') return false;
    const release = value as Partial<SceneReleaseSummary>;
    return typeof release.id === 'string' && release.id.length > 0
        && (release.scene_id === null || typeof release.scene_id === 'string')
        && typeof release.scene_title === 'string'
        && isVersion(release.version)
        && SCENE_RELEASE_RATINGS.has(release.rating)
        && isCount(release.words)
        && typeof release.text_hash === 'string' && SCENE_TEXT_HASH_RE.test(release.text_hash)
        && typeof release.hidden === 'boolean'
        && typeof release.released_at === 'string'
        && typeof release.updated_at === 'string'
        && isCount(release.readers);
}

export function isSceneReleaseStatus(value: unknown): value is SceneReleaseStatus {
    if (!value || typeof value !== 'object') return false;
    const status = value as Partial<SceneReleaseStatus>;
    // The project id becomes part of a link: only a UUID is accepted.
    return typeof status.project_id === 'string' && COMMUNITY_UUID_RE.test(status.project_id)
        && typeof status.consent === 'boolean'
        && SCENE_RELEASE_STANDINGS.has(status.standing)
        && typeof status.has_timeline === 'boolean'
        && isCount(status.limit)
        && Array.isArray(status.releases) && status.releases.every(isSceneReleaseSummary);
}

export function isSceneReleaseResult(value: unknown): value is SceneReleaseResult {
    if (!value || typeof value !== 'object') return false;
    const release = (value as Partial<SceneReleaseResult>).release;
    return !!release && typeof release === 'object'
        && typeof release.id === 'string' && release.id.length > 0
        && typeof release.scene_title === 'string'
        && isVersion(release.version)
        && SCENE_RELEASE_RATINGS.has(release.rating)
        && isCount(release.words)
        && typeof release.hidden === 'boolean'
        && typeof release.released_at === 'string'
        && typeof release.updated_at === 'string';
}

function isSceneReleaseConsentAnswer(value: unknown): value is SceneReleaseConsentAnswer {
    const answer = value as Partial<SceneReleaseConsentAnswer>;
    return answer?.ok === true && answer.version === SCENE_AUTHOR_AGREEMENT_VERSION;
}

/** Why a scene's cleaned text can't be released, in the author's words. */
export function sceneTextProblemMessage(problem: SceneTextProblem): string {
    if (problem === 'empty') return t('ui.communityShareClient.sceneReleaseEmpty');
    if (problem === 'too_many_words') return t('ui.communityShareClient.sceneReleaseTooLong');
    return t('ui.communityShareClient.sceneReleaseTooLarge');
}

/**
 * Whether a scene-text call may leave: a connected vault, sharing not paused
 * (Pause is a full outbound freeze, so even the status read stops), and Level
 * 4, the gate for scene text.
 */
function assertSceneReleaseAllowed(settings: CommunityShareSettings): void {
    if (!hasCommunityConnection(settings)) {
        throw new CommunityShareError('connection_required', t('ui.communityShareClient.connectBeforeSync'));
    }
    if (settings.sharingPaused) {
        throw new CommunityShareError('sharing_paused', t('ui.communityShareClient.sceneReleasePaused'));
    }
    if (!canShareSceneText(settings)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.sceneReleaseLevelRequired'));
    }
}

/**
 * One call to scene-release-sync for one book. `action` holds the action name
 * and exactly that action's own keys: the website refuses any extra or missing
 * key. Gated before the secret is read and again immediately before the
 * request leaves, like every sender here.
 */
export async function postSceneRelease<T>(
    plugin: RadialTimelinePlugin,
    book: Pick<BookProfile, 'id'>,
    action: Record<string, unknown>,
    isSuccess: (value: unknown) => value is T
): Promise<T> {
    assertSceneReleaseAllowed(normalizeCommunityShareSettings(plugin.settings.communityShare));
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    const body = {
        connection_id: connectionId,
        current_secret: currentSecret,
        plugin_book_key: book.id,
        ...action,
    };
    assertSceneReleaseAllowed(assertStillSendable(plugin, connection));
    return postCommunityFunction(
        plugin,
        'scene-release-sync',
        body,
        isSuccess,
        { code: 'scene_release_failed', message: t('ui.communityShareClient.sceneReleaseFailed') },
        t('ui.communityShareClient.sceneReleaseUnexpected')
    );
}

/**
 * What the website holds for this book: its releases with their hashes, the
 * account's consent and standing, and the limit. The request names the book
 * and carries no text; the answer never carries any.
 */
export function fetchSceneReleaseStatus(plugin: RadialTimelinePlugin, book: Pick<BookProfile, 'id'>): Promise<SceneReleaseStatus> {
    return postSceneRelease(plugin, book, { action: 'status' }, isSceneReleaseStatus);
}

/** Record the author's agreement to the release terms, once per account. Carries no text. */
export async function acceptSceneReleaseTerms(plugin: RadialTimelinePlugin, book: Pick<BookProfile, 'id'>): Promise<void> {
    await postSceneRelease(plugin, book, { action: 'consent', terms_version: SCENE_AUTHOR_AGREEMENT_VERSION }, isSceneReleaseConsentAnswer);
}

async function callReportAction(
    plugin: RadialTimelinePlugin,
    endpoint: 'community-share-revoke' | 'community-share-delete' | 'community-share-disconnect',
    body: Record<string, unknown>
): Promise<ReportActionSuccess> {
    return postCommunityFunction(
        plugin,
        endpoint,
        body,
        isReportActionSuccess,
        { code: 'community_share_action_failed', message: t('ui.communityShareClient.actionFailed') },
        t('ui.communityShareClient.actionUnexpected')
    );
}

export async function revokeCommunityShareReport(plugin: RadialTimelinePlugin): Promise<ReportActionSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const publishId = latestPublishId(current);
    if (!publishId) throw new CommunityShareError('publish_required', t('ui.communityShareClient.publishBeforeRevoke'));
    const secret = await getConnectedSecret(plugin, current);
    assertStillSendable(plugin, current.connection, true);
    const result = await callReportAction(plugin, 'community-share-revoke', {
        publish_id: publishId,
        current_secret: secret
    });
    const at = result.revoked_at || new Date().toISOString();
    commitCommunityShare(plugin, live => ({
        ...live,
        scheduledPublishEnabled: false,
        connection: {
            ...live.connection,
            lastSyncedPayloadHash: undefined
        },
        publishHistory: appendHistory(live, {
            id: `revoke-${at}`,
            action: 'revoke',
            status: 'success',
            at,
            publishId,
            message: 'Sharing revoked and taken off the website.'
        }),
        lastError: undefined
    }));
    await plugin.saveSettings();
    return result;
}

export async function disconnectCommunityShare(plugin: RadialTimelinePlugin): Promise<ReportActionSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    // Read the local secret directly instead of via getConnectedSecret: a vault
    // that lost its secret must still be able to escape "Connected" rather than
    // being stranded forever. A missing secret skips the server call; an
    // existing secret keeps the normal disconnect_only behavior.
    const secret = current.connection.secretId
        ? await getSecret(plugin.app, current.connection.secretId)
        : null;
    // disconnect_only: stop updates and drop the local connection key, but
    // leave already-published content live. This matches the website's own
    // disconnect behavior — content management lives on the website. The server
    // call is best-effort: a missing secret, a network error, or a malformed
    // 2xx body must never strand local "Connected" state.
    let result: ReportActionSuccess | null = null;
    if (secret && current.connection.connectionId) {
        try {
            result = await callReportAction(plugin, 'community-share-disconnect', {
                connection_id: current.connection.connectionId,
                current_secret: secret,
                mode: 'disconnect_only'
            });
        } catch (error) {
            // Never log the secret — only the failure reason.
            console.warn(
                'Community Share disconnect server call failed; clearing local state anyway:',
                error instanceof Error ? error.message : error
            );
        }
    }
    const at = result?.disconnected_at || new Date().toISOString();
    if (current.connection.secretId) {
        const deleted = await deleteSecret(plugin.app, current.connection.secretId);
        if (!deleted) {
            console.warn('Community Share disconnect: local connection secret could not be deleted.');
        }
    }
    commitCommunityShare(plugin, live => ({
        ...live,
        enabled: false,
        scheduledPublishEnabled: false,
        sharingPaused: false,
        sharingNoticeOwed: undefined,
        connection: {
            ...live.connection,
            status: 'disconnected',
            disconnectedAt: at,
            serverDisconnect: undefined,
            lastSyncedPayloadHash: undefined,
            secretId: undefined,
            bookListSyncedAt: undefined,
            bookListSyncError: undefined,
            bookListSyncFailedAt: undefined
        },
        publishHistory: appendHistory(live, {
            id: `disconnect-${at}`,
            action: 'disconnect',
            status: 'success',
            at,
            message: 'Vault disconnected. Community account content stays as it is.'
        }),
        preview: {
            status: 'not_generated'
        },
        lastError: undefined
    }));
    await plugin.saveSettings();
    // If the server call was skipped or failed, synthesize a local success so
    // callers still see a clean disconnect — local state is already cleared.
    return result ?? {
        ok: true,
        connection_id: current.connection.connectionId,
        status: 'disconnected',
        mode: 'disconnect_only',
        disconnected_at: at
    };
}

// -- Session feed posts (author-composed, per-save opt-in) --------------------

/**
 * True when the author's standing sharing state allows posting a session
 * summary to the community feed: connected, sharing on, public audience, and
 * a level that shares writing activity (Level 3, and Level 4 when it includes
 * it: modeIncludesActivity). UI gates the toggle on this;
 * the edge function re-verifies every gate server-side.
 */
export function canPostSessionsToFeed(plugin: RadialTimelinePlugin): boolean {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    return !current.sharingPaused
        && current.connection.status === 'connected'
        && Boolean(current.connection.connectionId)
        && Boolean(current.connection.secretId)
        && current.audience === 'public'
        && modeIncludesActivity(deriveCommunityShareMode(current));
}

/**
 * Post one author-composed session summary to the public community feed.
 * Best-effort from the caller's perspective: saving the session must never
 * depend on this call — surface failures as a Notice and move on.
 */
export async function postSessionToCommunityFeed(
    plugin: RadialTimelinePlugin,
    post: SessionFeedPost
): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!canPostSessionsToFeed(plugin)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.feedLevelRequired'));
    }
    requireBoundProject(current.connection);
    const secret = await getConnectedSecret(plugin, current);
    assertStillSendable(plugin, current.connection);
    if (!canPostSessionsToFeed(plugin)) {
        throw new CommunityShareError('sharing_level_required', t('ui.communityShareClient.feedLevelChanged'));
    }
    await postCommunityFunction(
        plugin,
        'community-session-post',
        {
            connection_id: current.connection.connectionId,
            current_secret: secret,
            body: post.body,
            session: post.stats,
            // The book the session was written in; the server matches it only inside this author's books.
            ...(post.bookKey ? { plugin_book_key: post.bookKey } : {})
        },
        isOkResponse,
        { code: 'post_failed', message: t('ui.communityShareClient.postFailed') },
        t('ui.communityShareClient.postUnexpected')
    );
}
