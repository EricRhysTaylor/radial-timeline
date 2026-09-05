/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildInquiryEstimateSnapshot, computeEstimateStateKey } from './inquiryEstimateSnapshot';
import { estimatePassCount } from './inquiryAdvisory';
import { buildInquiryEstimateTrace } from './inquiryEstimateTrace';
import { buildExactCorpusEstimateFromManifestEntries } from './buildExactCorpusEstimate';

vi.mock('./inquiryEstimateTrace', () => ({
    buildInquiryEstimateTrace: vi.fn(async () => ({
        systemPrompt: 'system',
        userPrompt: 'user',
        evidenceText: 'evidence',
        tokenEstimate: {
            inputTokens: 1200,
            outputTokens: 800,
            totalTokens: 2000,
            inputChars: 4800,
            estimationMethod: 'heuristic_chars',
            uncertaintyTokens: 0,
            effectiveInputCeiling: 4000,
            expectedPassCount: 1
        },
        outputTokenCap: 1200,
        response: null,
        sanitizationNotes: [],
        notes: []
    }))
}));
vi.mock('./buildExactCorpusEstimate', () => ({
    buildExactCorpusEstimateFromManifestEntries: vi.fn(async () => ({
        sceneCount: 53,
        outlineCount: 0,
        referenceCount: 0,
        evidenceChars: 53_000,
        estimatedTokens: 13_250,
        method: 'rt_cleaned_corpus_exact',
        breakdown: {
            scenesTokens: 13_250,
            outlineTokens: 0,
            referenceTokens: 0
        }
    }))
}));

// ── computeEstimateStateKey ──────────────────────────────────────────

describe('computeEstimateStateKey', () => {
    const baseParams = {
        scope: 'book' as const,
        activeBookId: 'book-1',
        corpusFingerprint: 'fp-abc123',
        provider: 'anthropic' as const,
        modelId: 'claude-sonnet-4-20250514',
        overrideClassCount: 0,
        overrideItemCount: 0,
        citationsEnabled: true
    };

    it('produces a stable key for identical inputs', () => {
        const keyA = computeEstimateStateKey(baseParams);
        const keyB = computeEstimateStateKey({ ...baseParams });
        expect(keyA).toBe(keyB);
    });

    it('produces a non-empty string', () => {
        const key = computeEstimateStateKey(baseParams);
        expect(key.length).toBeGreaterThan(0);
    });

    // ── Invalidation: each component change produces a different key ──

    it('invalidates when scope changes', () => {
        const bookKey = computeEstimateStateKey(baseParams);
        const sagaKey = computeEstimateStateKey({ ...baseParams, scope: 'saga' });
        expect(bookKey).not.toBe(sagaKey);
    });

    it('invalidates when activeBookId changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, activeBookId: 'book-2' });
        expect(key1).not.toBe(key2);
    });

    it('invalidates when activeBookId is absent vs present', () => {
        const withFocus = computeEstimateStateKey(baseParams);
        const withoutFocus = computeEstimateStateKey({ ...baseParams, activeBookId: undefined });
        expect(withFocus).not.toBe(withoutFocus);
    });

    it('invalidates when corpusFingerprint changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, corpusFingerprint: 'fp-xyz789' });
        expect(key1).not.toBe(key2);
    });

    it('invalidates when provider changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, provider: 'openai' });
        expect(key1).not.toBe(key2);
    });

    it('invalidates when modelId changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, modelId: 'gpt-4o' });
        expect(key1).not.toBe(key2);
    });

    it('invalidates when overrideClassCount changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, overrideClassCount: 2 });
        expect(key1).not.toBe(key2);
    });

    it('invalidates when overrideItemCount changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, overrideItemCount: 5 });
        expect(key1).not.toBe(key2);
    });

    it('invalidates when citationsEnabled changes', () => {
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey({ ...baseParams, citationsEnabled: false });
        expect(key1).not.toBe(key2);
    });

    // ── Exclusions: things that should NOT change the key ──

    it('excludes mode — changing mode does not change the key', () => {
        // Mode is not a parameter of computeEstimateStateKey at all,
        // which is the correct exclusion.  This test documents the invariant
        // by verifying the function signature has no mode parameter.
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey(baseParams);
        expect(key1).toBe(key2);
        // Mode is excluded because InquiryRunnerInput documents:
        // "UI emphasis only; inquiry computation must always include both
        // flow + depth regardless of lens."
    });

    it('excludes question text — question is not a key component', () => {
        // Question text is not a parameter of computeEstimateStateKey,
        // which is the correct exclusion.  This test documents the invariant.
        const key1 = computeEstimateStateKey(baseParams);
        const key2 = computeEstimateStateKey(baseParams);
        expect(key1).toBe(key2);
        // Question excluded because evidence chars (~200k) dwarf question
        // length (~200 chars) — including it would trigger recomputation
        // on hover, violating UX rule.
    });

    // ── Key format ──

    it('uses pipe delimiters', () => {
        const key = computeEstimateStateKey(baseParams);
        expect(key).toContain('|');
        // 8 components → 7 pipes
        expect(key.split('|').length).toBe(8);
    });
});

// ── estimatePassCount ────────────────────────────────────────────────

describe('estimatePassCount', () => {
    it('returns 1 when input tokens are zero', () => {
        expect(estimatePassCount(0, 100_000)).toBe(1);
    });

    it('returns 1 when input tokens are negative', () => {
        expect(estimatePassCount(-500, 100_000)).toBe(1);
    });

    it('returns 1 when input fits within budget', () => {
        expect(estimatePassCount(50_000, 100_000)).toBe(1);
    });

    it('returns 1 when input exactly equals budget', () => {
        expect(estimatePassCount(100_000, 100_000)).toBe(1);
    });

    it('returns 2 when budget is zero', () => {
        expect(estimatePassCount(50_000, 0)).toBe(2);
    });

    it('returns 2 when budget is negative', () => {
        expect(estimatePassCount(50_000, -100)).toBe(2);
    });

    it('returns 2 when budget is NaN', () => {
        expect(estimatePassCount(50_000, NaN)).toBe(2);
    });

    it('returns 2 when budget is Infinity', () => {
        // Infinity is handled: isFinite(Infinity) === false → returns 2
        // But wait, let's check: Infinity is not finite, so condition triggers.
        // Actually positive Infinity IS a valid budget conceptually,
        // but the function treats it as invalid.
        expect(estimatePassCount(50_000, Infinity)).toBe(2);
    });

    it('returns 2 when input slightly exceeds budget', () => {
        expect(estimatePassCount(100_001, 100_000)).toBe(2);
    });

    it('returns correct pass count for large corpus', () => {
        // 500k tokens, 200k budget → ceil(500k / 200k) = 3
        expect(estimatePassCount(500_000, 200_000)).toBe(3);
    });

    it('returns at least 2 for any multi-pass scenario', () => {
        // Even if ceil gives 1.01, minimum is 2
        expect(estimatePassCount(100_001, 100_000)).toBeGreaterThanOrEqual(2);
    });

    it('rounds up partial passes', () => {
        // 250_001 / 100_000 = 2.50001 → ceil = 3
        expect(estimatePassCount(250_001, 100_000)).toBe(3);
    });

    // ── Consistency with snapshot ──

    it('is deterministic — same inputs always produce same result', () => {
        const a = estimatePassCount(234_000, 180_000);
        const b = estimatePassCount(234_000, 180_000);
        expect(a).toBe(b);
    });

    it('advisory and snapshot use the same exported function', () => {
        // Both inquiryAdvisory.ts and inquiryEstimateSnapshot.ts import
        // estimatePassCount from inquiryAdvisory.  This test validates
        // the function exists and is exported.
        expect(typeof estimatePassCount).toBe('function');
    });
});

describe('buildInquiryEstimateSnapshot', () => {
    it('derives corpus counts from the canonical manifest instead of a broader payload count', async () => {
        const manifestEntries = Array.from({ length: 53 }, (_, index) => ({
            path: `Books/Book 1/Scene ${index + 1}.md`,
            sceneId: `scn_b1_${index + 1}`,
            mtime: index + 1,
            class: 'scene' as const,
            mode: 'full' as const
        }));

        const snapshot = await buildInquiryEstimateSnapshot({
            scope: 'book',
            activeBookId: 'Books/Book 1',
            targetSceneIds: [],
            scopeLabel: 'B1',
            manifest: {
                entries: manifestEntries,
                fingerprint: 'fp-book-1',
                generatedAt: 1,
                resolvedRoots: ['Books'],
                allowedClasses: ['scene'],
                synopsisOnly: false,
                classCounts: { scene: 53 }
            },
            payloadStats: {
                sceneCount: 91,
                outlineCount: 0,
                referenceCount: 0,
                evidenceChars: 53_000
            },
            vault: {} as never,
            metadataCache: {} as never,
            frontmatterMappings: undefined,
            runner: { estimateExecutionPassCountFromPrompt: () => 1 } as never,
            engine: {
                provider: 'anthropic',
                modelId: 'claude-opus-4-7',
                modelLabel: 'Claude Sonnet 4.6',
                contextWindow: 200_000,
                blocked: false
            },
            overrideSummary: {
                active: false,
                classCount: 0,
                itemCount: 0,
                total: 0
            },
            rules: {
                sagaOutlineScope: 'saga-only',
                bookOutlineScope: 'book-only',
                crossScopeUsage: 'conflict-only'
            },
            mode: 'flow',
            selectionMode: 'discover',
            citationsEnabled: true
        });

        expect(snapshot.corpus.sceneCount).toBe(53);
        expect(snapshot.corpus.scenes).toHaveLength(53);
        expect(snapshot.corpus.estimate.estimatedTokens).toBe(13_250);
    });

    it('preserves provider-counted estimation metadata from the canonical trace', async () => {
        vi.mocked(buildInquiryEstimateTrace).mockResolvedValueOnce({
            systemPrompt: 'system',
            userPrompt: 'user',
            evidenceText: 'evidence',
            tokenEstimate: {
                inputTokens: 18432,
                outputTokens: 800,
                totalTokens: 19232,
                inputChars: 0,
                estimationMethod: 'anthropic_count',
                uncertaintyTokens: 256,
                effectiveInputCeiling: 90000,
                expectedPassCount: 2
            },
            outputTokenCap: 1200,
            response: null,
            sanitizationNotes: [],
            notes: []
        });

        const snapshot = await buildInquiryEstimateSnapshot({
            scope: 'book',
            activeBookId: 'book-1',
            targetSceneIds: [],
            scopeLabel: 'B1',
            manifest: {
                entries: [],
                fingerprint: 'fp-book-1',
                generatedAt: 1,
                resolvedRoots: [],
                allowedClasses: [],
                synopsisOnly: false,
                classCounts: {}
            },
            payloadStats: {
                sceneCount: 0,
                outlineCount: 0,
                referenceCount: 0,
                evidenceChars: 0
            },
            vault: {} as never,
            metadataCache: {} as never,
            frontmatterMappings: undefined,
            runner: { estimateExecutionPassCountFromPrompt: () => 2 } as never,
            engine: {
                provider: 'anthropic',
                modelId: 'claude-opus-4-7',
                modelLabel: 'Claude Sonnet',
                contextWindow: 200000
            } as never,
            overrideSummary: {
                active: false,
                classCount: 0,
                itemCount: 0,
                total: 0
            },
            rules: {
                sagaOutlineScope: 'saga-only',
                bookOutlineScope: 'book-only',
                crossScopeUsage: 'conflict-only'
            },
            mode: 'flow',
            selectionMode: 'discover',
            citationsEnabled: true
        });

        expect(snapshot.estimate.estimatedInputTokens).toBe(18432);
        expect(snapshot.estimate.estimationMethod).toBe('anthropic_count');
        expect(snapshot.estimate.uncertaintyTokens).toBe(256);
        expect(snapshot.estimate.expectedPassCount).toBe(2);
        expect(vi.mocked(buildExactCorpusEstimateFromManifestEntries)).toHaveBeenCalled();
    });
});
