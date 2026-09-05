import type { InquirySession } from './sessionTypes';

/**
 * Versioned shape of the vault-resident inquiry session store.
 *
 * Inquiry briefs are persisted to a visible vault sidecar
 * (`Radial Timeline/Inquiry/Sessions/sessions.json`) rather than `data.json`. The vault
 * is the single source of truth for brief content: it ships with the vault,
 * survives a fresh plugin install, and rehydrates the Inquiry View with no
 * `data.json` present.
 *
 * Pure (de)serialization only — no Obsidian / filesystem access. The vault IO
 * lives in `InquiryArtifactStore.ts`.
 */
export const INQUIRY_ARTIFACT_SCHEMA_VERSION = 1 as const;

/**
 * Durable subset of an InquirySession that is persisted.
 *
 * Only `lastAccessed` is transient — it is recomputed in memory and re-seeded
 * from `createdAt` on hydration. The provider-cache fields (window expiry,
 * reuse state, provider cache status, reuse fingerprint, observed ratios) ARE
 * persisted so the armed/warm cache state survives an Obsidian restart.
 *
 * (Earlier these were stripped on the assumption that cache windows "expire
 * within minutes" — false for OpenAI's 24h retention, and nothing actually
 * rebuilt them on load, so every restart looked like a brand-new run.)
 * `cacheWindowExpiresAt` is an absolute timestamp and every reader already
 * discards it once it is in the past, so a stale window loaded after a long
 * downtime is harmless.
 */
export type PersistedInquirySession = Omit<InquirySession, 'lastAccessed'>;

/**
 * Identity of the book this vault ships, stamped into the sidecar on save from
 * the active Book Profile. This is what lets the Welcome screen name a demo
 * vault ("Pride & Prejudice") WITHOUT a separate manifest file or the plugin's
 * data.json — the Book Profile is the source of truth, and Save Session State
 * propagates it into the one file that travels with the vault.
 */
export interface InquiryVaultIdentity {
    displayName?: string;
    bookFolder?: string;
}

export interface InquirySessionArtifact {
    schemaVersion: typeof INQUIRY_ARTIFACT_SCHEMA_VERSION;
    savedAt: number;
    vault?: InquiryVaultIdentity;
    sessions: PersistedInquirySession[];
}

/** Drop blank fields; return undefined when nothing meaningful remains. */
export function cleanVaultIdentity(vault?: InquiryVaultIdentity): InquiryVaultIdentity | undefined {
    if (!vault) return undefined;
    const displayName = vault.displayName?.trim();
    const bookFolder = vault.bookFolder?.trim();
    if (!displayName && !bookFolder) return undefined;
    return {
        ...(displayName ? { displayName } : {}),
        ...(bookFolder ? { bookFolder } : {})
    };
}

function stripTransient(session: InquirySession): PersistedInquirySession {
    // Only `lastAccessed` is transient; the provider-cache fields are durable
    // so the armed/warm state is restored after a restart (stale windows are
    // filtered by the `> now` checks at every read site).
    const durable: PersistedInquirySession & { lastAccessed?: number } = { ...session };
    delete durable.lastAccessed;
    return durable;
}

export function serializeSessionsToArtifact(
    sessions: InquirySession[],
    savedAt: number,
    vault?: InquiryVaultIdentity
): InquirySessionArtifact {
    const cleaned = cleanVaultIdentity(vault);
    return {
        schemaVersion: INQUIRY_ARTIFACT_SCHEMA_VERSION,
        savedAt,
        ...(cleaned ? { vault: cleaned } : {}),
        sessions: sessions.map(stripTransient)
    };
}

/**
 * Extract just the stamped vault identity from a sidecar payload, for the
 * Welcome screen's demo-vault naming. Returns null for a missing/invalid
 * payload or one with no usable identity — naming then falls back to the
 * manifest or scene-folder inference.
 */
export function parseSessionArtifactVault(raw: string): InquiryVaultIdentity | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch { // SAFE: corrupt sidecar JSON — null means "no usable vault identity"; caller falls back to manifest/scene-folder inference
        return null;
    }
    if (!isArtifact(parsed)) return null;
    return cleanVaultIdentity((parsed).vault) ?? null;
}

/**
 * Parse a sidecar payload into runtime sessions.
 *
 * Returns `null` for a present-but-invalid payload (corrupt JSON or an
 * unknown schema version) so the caller can log loudly — we never fabricate
 * session data to paper over a bad file. A missing file is handled by the IO
 * layer, not here.
 */
export function parseSessionArtifact(raw: string): InquirySession[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch { // SAFE: corrupt sessions.json — null signals "invalid payload" so the caller logs loudly; we never fabricate session data
        return null;
    }
    if (!isArtifact(parsed)) return null;
    return parsed.sessions.map(rehydrate);
}

function isArtifact(value: unknown): value is InquirySessionArtifact {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === INQUIRY_ARTIFACT_SCHEMA_VERSION &&
        Array.isArray(record.sessions)
    );
}

function rehydrate(session: PersistedInquirySession): InquirySession {
    return {
        ...session,
        targetSceneIds: Array.isArray(session.targetSceneIds)
            ? session.targetSceneIds.map(value => String(value).trim()).filter(Boolean)
            : [],
        // Transient: re-seed access time from creation so recency sorting works
        // until the session is touched in this runtime.
        lastAccessed: session.createdAt
    };
}
