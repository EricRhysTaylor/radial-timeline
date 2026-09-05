import type RadialTimelinePlugin from '../main';
import type { InquirySession, InquirySessionCache, InquirySessionStatus } from './sessionTypes';
import type { InquiryScope } from './state';
import { DEFAULT_INQUIRY_HISTORY_LIMIT } from './constants';
import { readInquirySessionsFromVault, writeInquirySessionsToVault } from './InquiryArtifactStore';
import type { InquiryVaultIdentity } from './sessionArtifact';
import { getActiveBook } from '../utils/books';

export class InquirySessionStore {
    private cache: InquirySessionCache;
    private saveTimeout: number | null = null;

    /**
     * Writes to the vault sidecar are disarmed until hydrate() has loaded it.
     * A freshly constructed store seeds its cache from settings.inquirySessionCache,
     * which is intentionally NEVER persisted to data.json — so after an Obsidian
     * restart / plugin reload / vault copy the cache starts EMPTY. Without this
     * gate, the first interaction (even getSession() bumping lastAccessed) would
     * flush that empty cache over a good sessions.json. This flag is the guard
     * against that load-order clobber. Paired with hydrate(), which reads the
     * sidecar — the single source of truth — before arming writes.
     */
    private hydrated = false;

    constructor(private plugin: RadialTimelinePlugin) {
        this.cache = this.snapshotFromSettings();
        this.prune();
    }

    /**
     * Load the cache from the vault sidecar (the single persisted source of
     * truth) and arm the store for writes. MUST be awaited before any mutation
     * can flush — see the `hydrated` field for the clobber it prevents.
     *
     * A same-process reopen may carry newer, not-yet-flushed work in the
     * in-memory cache; those sessions win over the sidecar on key conflict so a
     * reopen never drops unsaved work. Pure read of the sidecar — does not write
     * it back. On an IO read failure we leave writes DISARMED so a file we
     * couldn't read is never overwritten with an empty set.
     */
    async hydrate(): Promise<void> {
        let sidecarSessions: InquirySession[];
        try {
            sidecarSessions = await readInquirySessionsFromVault(this.plugin.app);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(
                `[RadialTimeline] Failed to read inquiry sessions from vault sidecar; leaving writes disarmed to avoid clobbering it: ${message}`
            );
            return;
        }
        const byKey = new Map<string, InquirySession>();
        for (const session of sidecarSessions) {
            byKey.set(session.key, session);
        }
        // In-memory (potentially newer, unsaved) work wins on conflict.
        for (const session of this.cache.sessions) {
            byKey.set(session.key, session);
        }
        this.cache.sessions = Array.from(byKey.values());
        this.prune();
        // Keep the in-memory mirror consistent so reloadFromSettings()
        // (orphaned-run recovery) re-reads the hydrated set, not a stale cache.
        this.plugin.settings.inquirySessionCache = this.cache;
        this.hydrated = true;
    }

    /**
     * Snapshot + clone the persisted cache from plugin settings. Single
     * source of truth for both initial construction and reloadFromSettings().
     * Pure read — does not write or schedule a save.
     */
    private snapshotFromSettings(): InquirySessionCache {
        const max = DEFAULT_INQUIRY_HISTORY_LIMIT;
        const stored = this.plugin.settings.inquirySessionCache as InquirySessionCache | undefined;
        const cache: InquirySessionCache = stored && Array.isArray(stored.sessions)
            ? {
                sessions: stored.sessions.map(session => ({
                    ...session,
                    targetSceneIds: Array.isArray(session.targetSceneIds)
                        ? session.targetSceneIds.map(value => String(value).trim()).filter(Boolean)
                        : []
                })),
                max: stored.max || max
            }
            : { sessions: [], max };
        cache.max = max;
        return cache;
    }

    /**
     * Re-snapshot from the authoritative persisted cache. Lets a view
     * reopened while another (orphaned) view instance is still finishing a
     * run observe that run's persisted session. Pure re-read: no
     * persistence write, no semantics change. Idempotent.
     */
    reloadFromSettings(): void {
        this.cache = this.snapshotFromSettings();
        this.prune();
    }

    getSession(key: string): InquirySession | undefined {
        const session = this.cache.sessions.find(s => s.key === key);
        if (session) {
            session.lastAccessed = Date.now();
            this.scheduleSave();
        }
        return session;
    }

    peekSession(key: string): InquirySession | undefined {
        return this.cache.sessions.find(s => s.key === key);
    }

    getLatestByBaseKey(baseKey: string): InquirySession | undefined {
        const matches = this.cache.sessions.filter(s => s.baseKey === baseKey);
        if (!matches.length) return undefined;
        matches.sort((a, b) => b.lastAccessed - a.lastAccessed);
        return matches[0];
    }

    getLatestSessionForEngine(provider: string, modelId: string): InquirySession | undefined {
        const normalizedProvider = provider.trim().toLowerCase();
        const normalizedModelId = modelId.trim();
        if (!normalizedProvider || !normalizedModelId) return undefined;
        const matches = this.cache.sessions.filter(session => {
            const sessionProvider = (session.result.aiProvider ?? '').trim().toLowerCase(); // SAFE: legacy sessions may predate provider metadata
            if (sessionProvider !== normalizedProvider) return false;
            const resolvedModel = (session.result.aiModelResolved || '').trim(); // SAFE: engine history lookup checks both optional model fields
            const requestedModel = (session.result.aiModelRequested || '').trim(); // SAFE: engine history lookup checks both optional model fields
            return resolvedModel === normalizedModelId || requestedModel === normalizedModelId;
        });
        if (!matches.length) return undefined;
        matches.sort((a, b) => (b.createdAt || b.lastAccessed) - (a.createdAt || a.lastAccessed));
        return matches[0];
    }

    getLatestSessionForEngineInScope(provider: string, modelId: string, scope: InquiryScope): InquirySession | undefined {
        const normalizedProvider = provider.trim().toLowerCase();
        const normalizedModelId = modelId.trim();
        if (!normalizedProvider || !normalizedModelId) return undefined;
        const matches = this.cache.sessions.filter(session => {
            const sessionScope = session.scope ?? session.result.scope;
            if (sessionScope !== scope) return false;
            const sessionProvider = (session.result.aiProvider ?? '').trim().toLowerCase();
            if (sessionProvider !== normalizedProvider) return false;
            const resolvedModel = (session.result.aiModelResolved || '').trim();
            const requestedModel = (session.result.aiModelRequested || '').trim();
            return resolvedModel === normalizedModelId || requestedModel === normalizedModelId;
        });
        if (!matches.length) return undefined;
        matches.sort((a, b) => (b.createdAt || b.lastAccessed) - (a.createdAt || a.lastAccessed));
        return matches[0];
    }

    getLatestActiveCacheSessionForEngine(
        provider: string,
        modelId: string,
        options?: {
            now?: number;
            cacheReuseFingerprint?: string;
            scope?: InquiryScope;
        }
    ): InquirySession | undefined {
        const normalizedProvider = provider.trim().toLowerCase();
        const normalizedModelId = modelId.trim();
        const normalizedReuseFingerprint = (options?.cacheReuseFingerprint ?? '').trim();
        const now = options?.now ?? Date.now();
        if (!normalizedProvider || !normalizedModelId) return undefined;
        const matches = this.cache.sessions.filter(session => {
            if (!session.cacheWindowExpiresAt || session.cacheWindowExpiresAt <= now) return false;
            const sessionProvider = (session.result.aiProvider ?? '').trim().toLowerCase();
            if (sessionProvider !== normalizedProvider) return false;
            const resolvedModel = (session.result.aiModelResolved || '').trim();
            const requestedModel = (session.result.aiModelRequested || '').trim();
            const modelMatches = resolvedModel === normalizedModelId || requestedModel === normalizedModelId;
            if (!modelMatches) return false;
            if (options?.scope) {
                const sessionScope = session.scope ?? session.result.scope;
                if (sessionScope !== options.scope) return false;
            }
            if (normalizedReuseFingerprint) {
                const sessionReuseFingerprint = (session.cacheReuseFingerprint || session.result.cacheReuseFingerprint || '').trim();
                if (sessionReuseFingerprint !== normalizedReuseFingerprint) return false;
            }
            return true;
        });
        if (!matches.length) return undefined;
        matches.sort((a, b) => (b.createdAt || b.lastAccessed) - (a.createdAt || a.lastAccessed));
        return matches[0];
    }

    getRecentSessions(limit = 10): InquirySession[] {
        const sessions = [...this.cache.sessions];
        sessions.sort((a, b) => (b.createdAt || b.lastAccessed) - (a.createdAt || a.lastAccessed));
        return sessions.slice(0, Math.max(0, limit));
    }

    getSessionCount(): number {
        return this.cache.sessions.length;
    }

    setSession(session: InquirySession): void {
        const index = this.cache.sessions.findIndex(s => s.key === session.key);
        if (index >= 0) {
            this.cache.sessions[index] = session;
        } else {
            this.cache.sessions.push(session);
        }
        this.prune();
        this.persist();
    }

    updateSession(key: string, patch: Partial<InquirySession>): void {
        const session = this.cache.sessions.find(s => s.key === key);
        if (!session) return;
        Object.assign(session, patch);
        session.lastAccessed = Date.now();
        this.persist();
    }

    clearSessions(): void {
        this.cache.sessions = [];
        this.persist();
    }

    clearPendingEditsAppliedFlags(options?: {
        scope?: InquiryScope;
        activeBookId?: string;
        statuses?: InquirySessionStatus[];
    }): number {
        const statusFilter = options?.statuses?.length ? new Set(options.statuses) : null;
        let updated = 0;
        this.cache.sessions.forEach(session => {
            if (!session.pendingEditsApplied) return;
            if (options?.scope && session.scope !== options.scope) return;
            if (options?.activeBookId && session.activeBookId !== options.activeBookId) return;
            if (statusFilter && !statusFilter.has(session.status ?? 'unsaved')) return;
            session.pendingEditsApplied = false;
            updated++;
        });
        if (updated > 0) {
            this.persist();
        }
        return updated;
    }

    markStaleByBaseKey(baseKey: string): void {
        let updated = false;
        this.cache.sessions.forEach(session => {
            if (session.baseKey === baseKey && !session.stale) {
                session.stale = true;
                updated = true;
            }
        });
        if (updated) {
            this.scheduleSave();
        }
    }

    buildBaseKey(parts: {
        questionId: string;
        questionPromptForm?: 'standard' | 'focused';
        questionSignature?: string;
        scope: string;
        scopeKey: string;
        targetSceneIds?: string[];
    }): string {
        const targetSceneKey = Array.isArray(parts.targetSceneIds) && parts.targetSceneIds.length
            ? parts.targetSceneIds.map(value => value.trim()).filter(Boolean).sort().join(',')
            : '';
        const questionPromptForm = parts.questionPromptForm === 'focused' ? 'focused' : 'standard';
        const questionSignature = (parts.questionSignature ?? '').trim();
        return `${parts.questionId}::${questionPromptForm}::${questionSignature}::${parts.scope}::${parts.scopeKey}::${targetSceneKey}`;
    }

    buildKey(baseKey: string, fingerprint: string): string {
        return `${baseKey}::${fingerprint}`;
    }

    private prune(): void {
        const max = DEFAULT_INQUIRY_HISTORY_LIMIT;
        this.cache.max = max;
        if (this.cache.sessions.length <= max) return;
        this.cache.sessions.sort((a, b) => b.lastAccessed - a.lastAccessed);
        this.cache.sessions = this.cache.sessions.slice(0, max);
    }

    private persist(): void {
        this.scheduleSave();
    }

    private scheduleSave(): void {
        // In-memory mirror: the close/reopen recovery flow and the settings
        // session-count snapshot read `settings.inquirySessionCache`. This copy
        // is NEVER persisted to data.json (stripped in persistSettingsInternal);
        // the vault sidecar below is the single persisted source of truth.
        this.plugin.settings.inquirySessionCache = this.cache;
        if (this.saveTimeout) {
            window.clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = window.setTimeout(() => {
            this.saveTimeout = null;
            void this.writeNow();
        }, 600);
    }

    /**
     * Persist the current working set to the vault sidecar IMMEDIATELY,
     * cancelling any pending debounced save.
     *
     * The sidecar is the single source of truth for full session restore, so
     * durable moments — a completed run saving its brief, the view closing,
     * packaging a demo vault — call this to guarantee the hidden file matches
     * the in-memory set with no timing window. (The 600 ms debounce alone is
     * lost if Obsidian quits / the plugin reloads / the vault is copied before
     * it fires, which leaves a brief on disk with no rehydratable session.)
     */
    async flush(): Promise<void> {
        if (this.saveTimeout) {
            window.clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        this.plugin.settings.inquirySessionCache = this.cache;
        await this.writeNow();
    }

    /**
     * Stamp the active Book Profile's identity into the sidecar so the Welcome
     * screen can name a packaged demo vault from this one file — no manifest,
     * no data.json. Undefined when no book is active.
     */
    private resolveVaultIdentity(): InquiryVaultIdentity | undefined {
        const book = getActiveBook(this.plugin.settings);
        if (!book) return undefined;
        return { displayName: book.title, bookFolder: book.sourceFolder };
    }

    private async writeNow(): Promise<void> {
        // Never let an un-hydrated cache reach the sidecar. Until hydrate() has
        // loaded sessions.json, this cache may be empty (fresh load) and writing
        // it would wipe a good file — the exact load-order clobber the `hydrated`
        // guard exists to prevent.
        if (!this.hydrated) return;
        // Errors are logged, never swallowed silently — a failed sidecar write
        // is the difference between a vault that restores and one that does not.
        try {
            await writeInquirySessionsToVault(this.plugin.app, this.cache.sessions, this.resolveVaultIdentity());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(
                `[RadialTimeline] Failed to persist inquiry sessions to vault sidecar: ${message}`
            );
        }
    }
}
