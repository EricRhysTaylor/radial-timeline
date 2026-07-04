import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { deleteSecret, getSecret, isSecretStorageAvailable, setSecret } from '../ai/credentials/secretStorage';
import { normalizeCommunityShareSettings } from './communityShareSettings';
import { COMMUNITY_SHARE_REPORT_SCHEMA_VERSION, buildCommunitySharePreview } from './communitySharePreview';
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

export async function beginCommunitySharing(plugin: RadialTimelinePlugin): Promise<PublishSuccess> {
    const result = await publishCommunityShareReport(plugin, 'manual');
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: true
    });
    await plugin.saveSettings();
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
