import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { deleteSecret, getSecret, isSecretStorageAvailable, setSecret } from '../ai/credentials/secretStorage';
import { canShareAprToCommunity, deriveCommunityShareMode, normalizeCommunityShareSettings } from './communityShareSettings';
import { COMMUNITY_SHARE_REPORT_SCHEMA_VERSION, buildCommunityDailyEntries, buildCommunityHourModeMixEntries, buildCommunitySharePreview } from './communitySharePreview';
import type { CommunityShareConnectionSettings, CommunityShareFieldKey, CommunitySharePublishHistoryEntry, CommunityShareSettings } from '../types/settings';
import type { SessionFeedPost } from '../services/WritingSessionLog';

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
 * POST one community function and return its parsed success body. A non-2xx
 * answer becomes a CommunityShareError carrying the server's code and message
 * when it sent them and `failure` otherwise; a 2xx body that fails `isSuccess`
 * is an invalid_response. Callers check consent (assertStillSendable) first.
 */
async function postCommunityFunction<T>(
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
        body: JSON.stringify(body),
        throw: false
    });
    const parsed = parseResponseJson(response.text);
    if (response.status < 200 || response.status >= 300) {
        const error = (parsed as CommunityErrorBody).error;
        throw new CommunityShareError(
            error?.code || failure.code, // SAFE: non-2xx response carrying no structured code; the caller names the call that failed
            error?.message || failure.message // SAFE: user-facing text used only when the error body carries no message
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
    const parsed = await postCommunityFunction(
        'community-activation-confirm',
        {
            activation_token: token,
            plugin_installation_id_hash: pluginInstallationIdHash
        },
        isActivationConfirmSuccess,
        { code: 'activation_failed', message: 'Community connection failed. Generate a new code and try again.' },
        'Community connection returned an unexpected response.'
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
        sharingPaused: false,
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

function assertReportPublishAllowed(settings: CommunityShareSettings, mode: 'manual' | 'scheduled'): void {
    if (settings.audience !== 'public' || settings.tier < 1 || settings.tier > 4
        || !settings.manualPublishEnabled || (mode === 'scheduled' && !settings.scheduledPublishEnabled)) {
        throw new CommunityShareError('publish_locked', 'Sharing requires an enabled public sharing level.');
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
        throw new CommunityShareError('sharing_paused', 'Sharing is paused. Resume sharing before publishing.');
    }
    if (!current.enabled || current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) {
        throw new CommunityShareError('connection_required', 'Connect Community Share before sharing.');
    }
    assertReportPublishAllowed(current, mode);
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
    const live = assertStillSendable(plugin, current.connection);
    assertReportPublishAllowed(live, mode);
    const fieldsChanged = Object.entries(current.fieldPolicy).some(([key, enabled]) => live.fieldPolicy[key as CommunityShareFieldKey] !== enabled);
    if (fieldsChanged || live.tier !== current.tier || live.preview.status !== 'ready'
        || live.preview.previewHash !== preview.previewHash || live.preview.payloadHash !== preview.payloadHash) {
        throw new CommunityShareError('preview_stale', 'Sharing changed while preparing the report. Review the preview before sharing.');
    }

    const parsed = await postCommunityFunction(
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
        { code: 'publish_failed', message: 'Community sharing failed. Review the preview and try again.' },
        'Community sharing returned an unexpected response.'
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

/**
 * Whether the LIVE settings still permit a request to leave. Every sender
 * awaits (secret storage, preview or aggregate builds) between its gate and
 * its send, and Pause or Disconnect can land in that window. A disconnect
 * clears local state even when the server call fails, so a secret fetched
 * before it must not be usable after it. Checked immediately before each
 * `requestUrl`; `allowPaused` is for author actions that must work while
 * paused (revoke) and for read-only lookups. The captured connection identity
 * must still match: a replacement connection cannot authorize an old secret.
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

function assertStillSendable(plugin: RadialTimelinePlugin, expected: CommunityShareConnectionSettings, allowPaused = false): CommunityShareSettings {
    const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!live.enabled || live.connection.status !== 'connected' || !live.connection.connectionId) {
        throw new CommunityShareError('connection_required', 'Community Share was disconnected before the request could be sent.');
    }
    if (!allowPaused && live.sharingPaused) {
        throw new CommunityShareError('sharing_paused', 'Sharing was paused before the request could be sent.');
    }
    if (!isSameConnection(live.connection, expected)) {
        throw new CommunityShareError('connection_changed', 'The Community connection changed before the request could be sent. Try again.');
    }
    return live;
}

async function requireActiveConnection(plugin: RadialTimelinePlugin): Promise<{
    connectionId: string;
    projectId: string;
    currentSecret: string;
    connection: CommunityShareConnectionSettings;
}> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId || !current.connection.projectId) { // SAFE: connection precondition — any missing piece throws connection_required below, no silent default
        throw new CommunityShareError('connection_required', 'Connect Community Share before syncing with the website.');
    }
    const currentSecret = await getSecret(plugin.app, current.connection.secretId);
    if (!currentSecret) {
        throw new CommunityShareError('connection_secret_missing', 'The private connection secret is missing. Reconnect Community Share.');
    }
    return {
        connectionId: current.connection.connectionId,
        projectId: current.connection.projectId,
        currentSecret,
        connection: current.connection
    };
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
            'Sending an APR to Community requires Level 2 (Profile, books + APR) or Level 3 (Writing activity).'
        );
    }
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);
    const bookKey = args.bookKey.trim();
    if (!bookKey) {
        throw new CommunityShareError('project_mapping_required', 'Choose a campaign book before sending its APR to Community.');
    }
    const live = assertStillSendable(plugin, connection);
    if (!canShareAprToCommunity(live)) {
        throw new CommunityShareError('sharing_level_required', 'The sharing level changed before the APR could be sent.');
    }

    const parsed = await postCommunityFunction(
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
        { code: 'apr_upload_failed', message: 'Could not send the progress report to the community site.' },
        'The progress report upload returned an unexpected response.'
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
        'community-share-context',
        {
            connection_id: connectionId,
            current_secret: currentSecret
        },
        isCommunityShareContext,
        { code: 'share_context_failed', message: 'Could not load your public profile from the website.' },
        'The website profile lookup returned an unexpected response.'
    );
    return parsed;
}

/**
 * Sync every Book Manager book to the community website as a project shell.
 * New shells arrive PRIVATE; the author chooses what to share on the website.
 * Sync never changes visibility and never deletes shells.
 */
export async function syncCommunityProjects(plugin: RadialTimelinePlugin): Promise<ProjectSyncSuccess> {
    const { connectionId, currentSecret, connection } = await requireActiveConnection(plugin);

    const books = (plugin.settings.books ?? []).slice(0, 50); // SAFE: no books configured means nothing to sync; the empty-list branch below returns early
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
    assertStillSendable(plugin, connection);

    const parsed = await postCommunityFunction(
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
        { code: 'project_sync_failed', message: 'Could not sync books to the community site.' },
        'The project sync returned an unexpected response.'
    );
    return parsed;
}

/**
 * Fire-and-forget project sync for plugin load: silently no-ops when
 * Community Share is not connected, and never throws into the caller.
 */
export async function syncCommunityProjectsIfConnected(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.sharingPaused || current.connection.status !== 'connected' || !current.connection.connectionId) return; // SAFE: load-time sync precondition — disabled, paused, or disconnected is the documented no-op for this fire-and-forget path
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

export async function pauseCommunitySharing(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const at = new Date().toISOString();
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        scheduledPublishEnabled: false,
        // Hard freeze: block report sync, daily aggregates, project shell sync,
        // APR uploads, and session feed posts until the author resumes.
        sharingPaused: true,
        publishHistory: appendHistory(current, {
            id: `pause-${at}`,
            action: 'pause',
            status: 'success',
            at,
            message: 'Sharing paused. Nothing leaves this vault until resumed; already shared data stays visible.'
        })
    });
    await plugin.saveSettings();
}

export async function resumeCommunitySharing(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const at = new Date().toISOString();
    plugin.settings.communityShare = normalizeCommunityShareSettings({
        ...current,
        sharingPaused: false,
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
    // Push anything that changed while paused so the website catches up, then
    // refresh the daily aggregate companion. Both handle their own failures.
    await syncCommunityShareIfDue(plugin);
    await syncCommunityDailyIfEligible(plugin);
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
 * Fire-and-forget daily-activity sync: sends the last two weeks of per-day
 * aggregates (community_daily) so the author page can show weekly stats,
 * plus the optional `hour_mode_mix` companion field — a trailing 28-day,
 * undated rollup of session minutes by local start hour and mode, for the
 * community "activity dial." Consent-consistent — runs only while the
 * standing share is active at the progress level (public, tier 4); private,
 * paused, or revoked shares never send either field. Silent by design: a
 * standing-authorization failure stops scheduled sharing (same auto-stop
 * rule as the report sync); transient failures only log to the console,
 * never Notices, never repeated history entries.
 */
export async function syncCommunityDailyIfEligible(plugin: RadialTimelinePlugin): Promise<void> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (!current.enabled || current.sharingPaused) return;
    if (current.connection.status !== 'connected' || !current.connection.connectionId || !current.connection.secretId) return;
    if (current.audience !== 'public' || current.tier !== 4) return;

    try {
        const currentSecret = await getSecret(plugin.app, current.connection.secretId);
        if (!currentSecret) return;

        const days = await buildCommunityDailyEntries(plugin);
        if (!days.length) return;
        // Same tier-4 public gate as `days` above — hour_mode_mix is a
        // companion rollup of the identical session store, not a separately
        // gated field. Optional on the wire: the server accepts its absence.
        const hourModeMix = await buildCommunityHourModeMixEntries(plugin);
        // Pause is a hard freeze and a disconnect revokes the secret we hold:
        // honour either if it landed while the aggregates were building.
        const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
        if (!isStillSendable(live, current.connection) || live.audience !== 'public' || live.tier !== 4) return;

        await postCommunityFunction(
            'community-daily-sync',
            {
                connection_id: current.connection.connectionId,
                current_secret: currentSecret,
                days,
                hour_mode_mix: hourModeMix
            },
            isOkResponse,
            { code: 'daily_sync_failed', message: 'Daily activity sync failed.' },
            'Daily activity sync returned an unexpected response.'
        );
    } catch (error) {
        const code = error instanceof CommunityShareError ? error.code : 'daily_sync_failed';
        const message = error instanceof Error ? error.message : 'Daily activity sync failed.';
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

    try {
        const preview = await buildCommunitySharePreview(plugin);
        if (preview.payloadHash === current.connection.lastSyncedPayloadHash) return 'skipped';
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
        const message = error instanceof Error ? error.message : 'Community sharing sync failed.';
        const stopped = SYNC_STOP_CODES.has(code);
        const at = new Date().toISOString();
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
            lastError: message
        }));
        await plugin.saveSettings();
        return 'failed';
    }
}

async function callReportAction(
    plugin: RadialTimelinePlugin,
    endpoint: 'community-share-revoke' | 'community-share-delete' | 'community-share-disconnect',
    body: Record<string, unknown>
): Promise<ReportActionSuccess> {
    return postCommunityFunction(
        endpoint,
        body,
        isReportActionSuccess,
        { code: 'community_share_action_failed', message: 'Community Share action failed. Try again.' },
        'Community Share returned an unexpected response.'
    );
}

export async function revokeCommunityShareReport(plugin: RadialTimelinePlugin): Promise<ReportActionSuccess> {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const publishId = latestPublishId(current);
    if (!publishId) throw new CommunityShareError('publish_required', 'Publish a report before revoking it.');
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
        connection: {
            ...live.connection,
            status: 'disconnected',
            disconnectedAt: at,
            lastSyncedPayloadHash: undefined,
            secretId: undefined
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
 * Level 3 (writing activity). UI gates the toggle on this;
 * the edge function re-verifies every gate server-side.
 */
export function canPostSessionsToFeed(plugin: RadialTimelinePlugin): boolean {
    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
    return !current.sharingPaused
        && current.connection.status === 'connected'
        && Boolean(current.connection.connectionId)
        && Boolean(current.connection.secretId)
        && current.audience === 'public'
        && deriveCommunityShareMode(current) === 'progress';
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
        throw new CommunityShareError('sharing_level_required', 'Posting to the community feed requires Level 3 (writing activity).');
    }
    const secret = await getConnectedSecret(plugin, current);
    assertStillSendable(plugin, current.connection);
    if (!canPostSessionsToFeed(plugin)) {
        throw new CommunityShareError('sharing_level_required', 'The sharing level changed before the session could be posted.');
    }
    await postCommunityFunction(
        'community-session-post',
        {
            connection_id: current.connection.connectionId,
            current_secret: secret,
            body: post.body,
            session: post.stats
        },
        isOkResponse,
        { code: 'post_failed', message: 'Could not post this session to the community feed.' },
        'The session post returned an unexpected response.'
    );
}
