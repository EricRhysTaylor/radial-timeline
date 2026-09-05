/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InquiryEstimateService } from './inquiryEstimateService';
import type { EstimateSnapshotParams, InquiryEstimateSnapshot } from './inquiryEstimateSnapshot';

// ── Mock the snapshot builder ─────────────────────────────────────────
// We mock buildInquiryEstimateSnapshot so the test controls what the
// async builder returns, without needing a real runner or vault.

vi.mock('./inquiryEstimateSnapshot', async () => {
    const actual = await vi.importActual<typeof import('./inquiryEstimateSnapshot')>('./inquiryEstimateSnapshot');
    return {
        ...actual,
        buildInquiryEstimateSnapshot: vi.fn()
    };
});

import { buildInquiryEstimateSnapshot } from './inquiryEstimateSnapshot';
const mockBuild = buildInquiryEstimateSnapshot as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<InquiryEstimateSnapshot>): InquiryEstimateSnapshot {
    return {
        version: 1,
        stateKey: 'test-key',
        computedAt: Date.now(),
        scope: 'book',
        activeBookId: 'book-1',
        citationsEnabled: true,
        resolvedEngine: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            modelLabel: 'Claude Sonnet',
            contextWindow: 200000
        },
        corpus: {
            scenes: ['scene1.md', 'scene2.md'],
            outlines: ['outline.md'],
            references: [],
            sceneCount: 2,
            outlineCount: 1,
            referenceCount: 0,
            evidenceChars: 20000,
            corpusFingerprint: 'fp-test',
            estimate: {
                sceneCount: 2,
                outlineCount: 1,
                referenceCount: 0,
                evidenceChars: 20000,
                estimatedTokens: 5000,
                method: 'rt_cleaned_corpus_exact',
                breakdown: {
                    scenesTokens: 4500,
                    outlineTokens: 500,
                    referenceTokens: 0
                }
            }
        },
        estimate: {
            estimatedInputTokens: 50000,
            effectiveInputCeiling: 180000,
            maxOutputTokens: 16384,
            expectedPassCount: 1,
            estimationMethod: 'heuristic_chars',
            uncertaintyTokens: 5000
        },
        ...overrides
    };
}

function makeParams(overrides?: Partial<{
    scope: string;
    fingerprint: string;
    provider: string;
    modelId: string;
    overrideClassCount: number;
    overrideItemCount: number;
    citationsEnabled: boolean;
}>): EstimateSnapshotParams {
    return {
        scope: (overrides?.scope ?? 'book') as 'book' | 'saga',
        activeBookId: 'book-1',
        targetSceneIds: [],
        scopeLabel: 'Book A',
        manifest: {
            entries: [],
            fingerprint: overrides?.fingerprint ?? 'fp-test',
            generatedAt: Date.now(),
            resolvedRoots: ['/'],
            allowedClasses: ['scene'],
            synopsisOnly: false,
            classCounts: { scene: 2 }
        },
        payloadStats: {
            sceneCount: 2,
            outlineCount: 1,
            referenceCount: 0,
            evidenceChars: 20000
        },
        vault: {} as any,
        metadataCache: {} as any,
        frontmatterMappings: undefined,
        runner: {} as any,
        engine: {
            provider: (overrides?.provider ?? 'anthropic') as any,
            modelId: overrides?.modelId ?? 'claude-sonnet-4-20250514',
            modelAlias: 'sonnet',
            modelLabel: 'Claude Sonnet',
            providerLabel: 'Anthropic',
            hasCredential: true,
            contextWindow: 200000,
            maxOutput: 16384,
            selectionReason: 'test',
            policySource: 'globalPolicy' as any
        },
        overrideSummary: {
            active: false,
            classCount: overrides?.overrideClassCount ?? 0,
            itemCount: overrides?.overrideItemCount ?? 0,
            total: 0
        },
        rules: {} as any,
        mode: 'flow',
        selectionMode: 'all',
        citationsEnabled: overrides?.citationsEnabled ?? true
    };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('InquiryEstimateService', () => {
    let service: InquiryEstimateService;

    beforeEach(() => {
        service = new InquiryEstimateService();
        mockBuild.mockReset();
    });

    it('starts with no snapshot and not pending', () => {
        expect(service.getSnapshot()).toBeNull();
        expect(service.isPending()).toBe(false);
    });

    it('returns snapshot after successful build', async () => {
        const expected = makeSnapshot();
        mockBuild.mockResolvedValue(expected);

        const result = await service.requestSnapshot(makeParams());

        expect(result).toBe(expected);
        expect(service.getSnapshot()).toBe(expected);
        expect(service.isPending()).toBe(false);
    });

    it('returns cached snapshot on cache hit (same state key)', async () => {
        const expected = makeSnapshot();
        mockBuild.mockResolvedValue(expected);

        await service.requestSnapshot(makeParams());
        expect(mockBuild).toHaveBeenCalledTimes(1);

        // Same params → same state key → cache hit
        const cached = await service.requestSnapshot(makeParams());
        expect(cached).toBe(expected);
        expect(mockBuild).toHaveBeenCalledTimes(1); // Not called again
    });

    it('rebuilds when citationsEnabled toggle changes (different state key)', async () => {
        const snapshotCitationsOn = makeSnapshot({ stateKey: 'key-cite-on' });
        const snapshotCitationsOff = makeSnapshot({
            stateKey: 'key-cite-off',
            estimate: {
                estimatedInputTokens: 30000,
                effectiveInputCeiling: 180000,
                maxOutputTokens: 16384,
                expectedPassCount: 1,
                estimationMethod: 'anthropic_count',
                uncertaintyTokens: 256
            }
        });
        mockBuild
            .mockResolvedValueOnce(snapshotCitationsOn)
            .mockResolvedValueOnce(snapshotCitationsOff);

        await service.requestSnapshot(makeParams({ citationsEnabled: true }));
        expect(service.getSnapshot()?.estimate.estimatedInputTokens).toBe(50000);

        await service.requestSnapshot(makeParams({ citationsEnabled: false }));
        expect(service.getSnapshot()?.estimate.estimatedInputTokens).toBe(30000);
        expect(mockBuild).toHaveBeenCalledTimes(2);
    });

    it('rebuilds when state key changes', async () => {
        const snapshot1 = makeSnapshot({ stateKey: 'key-1' });
        const snapshot2 = makeSnapshot({
            stateKey: 'key-2',
            estimate: {
                estimatedInputTokens: 80000,
                effectiveInputCeiling: 180000,
                maxOutputTokens: 16384,
                expectedPassCount: 1,
                estimationMethod: 'heuristic_chars',
                uncertaintyTokens: 5000
            }
        });
        mockBuild.mockResolvedValueOnce(snapshot1).mockResolvedValueOnce(snapshot2);

        await service.requestSnapshot(makeParams());
        expect(service.getSnapshot()?.estimate.estimatedInputTokens).toBe(50000);

        // Different fingerprint → different state key → rebuild
        await service.requestSnapshot(makeParams({ fingerprint: 'fp-changed' }));
        expect(service.getSnapshot()?.estimate.estimatedInputTokens).toBe(80000);
        expect(mockBuild).toHaveBeenCalledTimes(2);
    });

    it('returns null when build fails', async () => {
        mockBuild.mockRejectedValue(new Error('build failed'));

        const result = await service.requestSnapshot(makeParams());

        expect(result).toBeNull();
        expect(service.getSnapshot()).toBeNull();
        expect(service.isPending()).toBe(false);
    });

    it('shares in-flight promise for same state key', async () => {
        let resolve: (value: InquiryEstimateSnapshot) => void;
        const pending = new Promise<InquiryEstimateSnapshot>(r => { resolve = r; });
        mockBuild.mockReturnValue(pending);

        const params = makeParams();
        const p1 = service.requestSnapshot(params);
        const p2 = service.requestSnapshot(params);

        expect(service.isPending()).toBe(true);

        const expected = makeSnapshot();
        resolve!(expected);

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(expected);
        expect(r2).toBe(expected);
        expect(mockBuild).toHaveBeenCalledTimes(1); // Only one build
    });

    it('discards stale build when superseded by newer key', async () => {
        let resolveFirst: (value: InquiryEstimateSnapshot) => void;
        const firstBuild = new Promise<InquiryEstimateSnapshot>(r => { resolveFirst = r; });

        const secondSnapshot = makeSnapshot({
            stateKey: 'key-2',
            estimate: {
                estimatedInputTokens: 80000,
                effectiveInputCeiling: 180000,
                maxOutputTokens: 16384,
                expectedPassCount: 1,
                estimationMethod: 'heuristic_chars',
                uncertaintyTokens: 5000
            }
        });
        mockBuild
            .mockReturnValueOnce(firstBuild)
            .mockResolvedValueOnce(secondSnapshot);

        // Start first build
        const p1 = service.requestSnapshot(makeParams({ fingerprint: 'fp-1' }));

        // Before first completes, start second with different key
        const p2 = service.requestSnapshot(makeParams({ fingerprint: 'fp-2' }));

        // Now resolve the first build
        resolveFirst!(makeSnapshot({ stateKey: 'key-1' }));

        const r1 = await p1;
        const r2 = await p2;

        // First build was discarded because key changed
        expect(r1).toBeNull();
        // Second build completed with new snapshot
        expect(r2).toBe(secondSnapshot);
        expect(service.getSnapshot()).toBe(secondSnapshot);
    });

    it('invalidate clears snapshot and pending', async () => {
        const expected = makeSnapshot();
        mockBuild.mockResolvedValue(expected);

        await service.requestSnapshot(makeParams());
        expect(service.getSnapshot()).toBe(expected);

        service.invalidate();

        expect(service.getSnapshot()).toBeNull();
        expect(service.isPending()).toBe(false);
    });

    it('retries after build failure on same key', async () => {
        mockBuild
            .mockRejectedValueOnce(new Error('first failure'))
            .mockResolvedValueOnce(makeSnapshot());

        // First attempt fails
        const r1 = await service.requestSnapshot(makeParams());
        expect(r1).toBeNull();

        // Second attempt with same params retries the build
        const r2 = await service.requestSnapshot(makeParams());
        expect(r2).not.toBeNull();
        expect(r2?.estimate.estimatedInputTokens).toBe(50000);
        expect(mockBuild).toHaveBeenCalledTimes(2);
    });

    it('snapshot with all required estimate fields is returned intact', async () => {
        // Per RT Engineering Doctrine: snapshot estimate fields are authoritative.
        // No defaults, no fallbacks — every field must be present and real.
        const fullSnapshot = makeSnapshot({
            estimate: {
                estimatedInputTokens: 45000,
                effectiveInputCeiling: 180000,
                maxOutputTokens: 16384,
                expectedPassCount: 1,
                estimationMethod: 'anthropic_count',
                uncertaintyTokens: 256
            }
        });
        mockBuild.mockResolvedValue(fullSnapshot);

        const result = await service.requestSnapshot(makeParams());

        expect(result).not.toBeNull();
        expect(result!.estimate.estimatedInputTokens).toBe(45000);
        expect(result!.estimate.effectiveInputCeiling).toBe(180000);
        expect(result!.estimate.estimationMethod).toBe('anthropic_count');
        expect(result!.estimate.uncertaintyTokens).toBe(256);
        expect(service.getSnapshot()).toBe(result);
    });

    it('snapshot data produces meaningful pressure ratio', async () => {
        const snapshot = makeSnapshot({
            estimate: {
                estimatedInputTokens: 50000,
                effectiveInputCeiling: 180000,
                maxOutputTokens: 16384,
                expectedPassCount: 1,
                estimationMethod: 'heuristic_chars',
                uncertaintyTokens: 5000
            }
        });
        mockBuild.mockResolvedValue(snapshot);
        await service.requestSnapshot(makeParams());

        const cached = service.getSnapshot();
        expect(cached).not.toBeNull();
        // Verify the snapshot data can produce a valid pressure ratio
        const safeInputBudget = cached!.estimate.effectiveInputCeiling;
        const estimatedInputTokens = cached!.estimate.estimatedInputTokens;
        const pressureRatio = safeInputBudget > 0
            ? estimatedInputTokens / safeInputBudget
            : Infinity;
        expect(pressureRatio).toBeGreaterThan(0);
        expect(pressureRatio).toBeLessThan(1);
        expect(Number.isFinite(pressureRatio)).toBe(true);
    });
});
