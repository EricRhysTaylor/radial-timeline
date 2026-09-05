import { describe, expect, it } from 'vitest';
import {
    INQUIRY_ARTIFACT_SCHEMA_VERSION,
    cleanVaultIdentity,
    parseSessionArtifact,
    parseSessionArtifactVault,
    serializeSessionsToArtifact
} from './sessionArtifact';
import type { InquirySession } from './sessionTypes';

function makeSession(overrides: Partial<InquirySession> = {}): InquirySession {
    return {
        key: 'k1',
        baseKey: 'b1',
        result: { runId: 'r1' } as never,
        createdAt: 1000,
        lastAccessed: 5000,
        targetSceneIds: ['scn_a', ' scn_b ', ''],
        status: 'saved',
        briefPath: 'Radial Timeline/Inquiry/Briefing/Brief.md',
        // durable cache state — persisted so armed/warm survives a restart
        cacheWindowExpiresAt: 9999,
        cacheReuseFingerprint: 'fp',
        cacheReuseState: 'warm',
        providerCacheStatus: 'hit',
        cachedStableRatio: 0.5,
        cachedStableTokens: 10,
        totalInputTokens: 20,
        ...overrides
    };
}

describe('serializeSessionsToArtifact', () => {
    it('stamps the schema version and savedAt', () => {
        const artifact = serializeSessionsToArtifact([makeSession()], 1234);
        expect(artifact.schemaVersion).toBe(INQUIRY_ARTIFACT_SCHEMA_VERSION);
        expect(artifact.savedAt).toBe(1234);
        expect(artifact.sessions).toHaveLength(1);
    });

    it('strips only lastAccessed; persists cache state so armed/warm survives a restart', () => {
        const artifact = serializeSessionsToArtifact([makeSession()], 1);
        const persisted = artifact.sessions[0] as Record<string, unknown>;
        expect(persisted.key).toBe('k1');
        expect(persisted.briefPath).toBe('Radial Timeline/Inquiry/Briefing/Brief.md');
        // Only lastAccessed is transient (re-seeded on hydration).
        expect('lastAccessed' in persisted).toBe(false);
        // Provider-cache fields ARE durable now — restored after restart.
        expect(persisted.cacheWindowExpiresAt).toBe(9999);
        expect(persisted.cacheReuseFingerprint).toBe('fp');
        expect(persisted.cacheReuseState).toBe('warm');
        expect(persisted.providerCacheStatus).toBe('hit');
        expect(persisted.cachedStableRatio).toBe(0.5);
        expect(persisted.cachedStableTokens).toBe(10);
        expect(persisted.totalInputTokens).toBe(20);
    });
});

describe('parseSessionArtifact', () => {
    it('round-trips durable session data', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([makeSession()], 1));
        const sessions = parseSessionArtifact(raw);
        expect(sessions).not.toBeNull();
        expect(sessions).toHaveLength(1);
        expect(sessions![0].key).toBe('k1');
    });

    it('round-trips the provider-cache state (armed/warm survives a restart)', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([makeSession()], 1));
        const sessions = parseSessionArtifact(raw);
        const restored = sessions![0];
        expect(restored.cacheWindowExpiresAt).toBe(9999);
        expect(restored.cacheReuseFingerprint).toBe('fp');
        expect(restored.cacheReuseState).toBe('warm');
        expect(restored.providerCacheStatus).toBe('hit');
        expect(restored.cachedStableTokens).toBe(10);
    });

    it('re-seeds lastAccessed from createdAt on hydration', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([makeSession({ createdAt: 7777 })], 1));
        const sessions = parseSessionArtifact(raw);
        expect(sessions![0].lastAccessed).toBe(7777);
    });

    it('normalizes targetSceneIds (trims, drops empties)', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([makeSession()], 1));
        const sessions = parseSessionArtifact(raw);
        expect(sessions![0].targetSceneIds).toEqual(['scn_a', 'scn_b']);
    });

    it('returns null for corrupt JSON (caller logs; never fabricates)', () => {
        expect(parseSessionArtifact('{ not json')).toBeNull();
    });

    it('returns null for an unknown schema version', () => {
        const raw = JSON.stringify({ schemaVersion: 999, savedAt: 1, sessions: [] });
        expect(parseSessionArtifact(raw)).toBeNull();
    });

    it('returns an empty array for a valid empty artifact', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([], 1));
        expect(parseSessionArtifact(raw)).toEqual([]);
    });
});

describe('vault identity (Book-Profile name stamped into the sidecar)', () => {
    it('omits the vault field when no identity is given', () => {
        const artifact = serializeSessionsToArtifact([makeSession()], 1);
        expect('vault' in artifact).toBe(false);
    });

    it('stamps and round-trips the vault identity', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([makeSession()], 1, {
            displayName: 'Pride & Prejudice',
            bookFolder: 'Pride & Prejudice'
        }));
        expect(parseSessionArtifactVault(raw)).toEqual({
            displayName: 'Pride & Prejudice',
            bookFolder: 'Pride & Prejudice'
        });
        // Sessions still parse unaffected by the new header field.
        expect(parseSessionArtifact(raw)).toHaveLength(1);
    });

    it('cleanVaultIdentity drops blanks and collapses empty to undefined', () => {
        expect(cleanVaultIdentity({ displayName: '  P&P  ', bookFolder: '' })).toEqual({ displayName: 'P&P' });
        expect(cleanVaultIdentity({ displayName: '   ', bookFolder: '  ' })).toBeUndefined();
        expect(cleanVaultIdentity(undefined)).toBeUndefined();
    });

    it('parseSessionArtifactVault returns null when no identity was stamped', () => {
        const raw = JSON.stringify(serializeSessionsToArtifact([makeSession()], 1));
        expect(parseSessionArtifactVault(raw)).toBeNull();
    });
});
