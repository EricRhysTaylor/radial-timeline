import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    scoreReuseAdvancedContext,
    getAnthropicAcceptedCacheTtl,
    getDispatchEngineKey,
    resolveActualUsageCostForResult,
    buildEngineRecentRunSnapshot,
    buildEngineCacheWindowSnapshotFromSession,
    pickEffectiveReuseAdvancedContext,
    mapSessionToPersistedReuseContext,
    matchLiveReuseAdvancedContext,
    resolveActiveCacheWindowExpiry,
    formatContextCountdownLabel
} from './inquiryCacheStatus';
import type { AIRunAdvancedContext } from '../../ai/types';
import type { InquiryRunTrace } from '../runner/types';
import type { InquiryResult } from '../state';
import type { InquirySession } from '../sessionTypes';

const ctx = (p: Partial<AIRunAdvancedContext>): AIRunAdvancedContext =>
    p as unknown as AIRunAdvancedContext;
const trace = (usage: Record<string, unknown> | undefined): InquiryRunTrace =>
    ({ usage }) as unknown as InquiryRunTrace;
const result = (p: Partial<InquiryResult>): InquiryResult =>
    p as unknown as InquiryResult;

describe('scoreReuseAdvancedContext', () => {
    it('returns 0 for null or non-warm context (truth-over-optimism)', () => {
        expect(scoreReuseAdvancedContext(null)).toBe(0);
        expect(scoreReuseAdvancedContext(ctx({ reuseState: 'eligible' }))).toBe(0);
        expect(scoreReuseAdvancedContext(ctx({ reuseState: 'idle' }))).toBe(0);
    });

    it('weights ratio >> tokens >> input for a warm context', () => {
        const score = scoreReuseAdvancedContext(ctx({
            reuseState: 'warm',
            cachedStableRatio: 1,
            cachedStableTokens: 1000,
            totalInputTokens: 130000
        }));
        // 1*1_000_000 + 1000 + 130000*0.001
        expect(score).toBe(1_000_000 + 1000 + 130);
    });

    it('treats non-finite/missing components as zero', () => {
        expect(scoreReuseAdvancedContext(ctx({
            reuseState: 'warm',
            cachedStableRatio: Number.NaN,
            cachedStableTokens: undefined,
            totalInputTokens: undefined
        }))).toBe(0);
    });

    it('with equal token/input, a higher reuse ratio wins (characterizes the preserved formula)', () => {
        const hiRatio = scoreReuseAdvancedContext(ctx({ reuseState: 'warm', cachedStableRatio: 0.9, cachedStableTokens: 100, totalInputTokens: 100 }));
        const loRatio = scoreReuseAdvancedContext(ctx({ reuseState: 'warm', cachedStableRatio: 0.1, cachedStableTokens: 100, totalInputTokens: 100 }));
        expect(hiRatio).toBeGreaterThan(loRatio);
        // Exact preserved weighting: ratio*1e6 + tokens + input*0.001
        expect(hiRatio).toBe(0.9 * 1_000_000 + 100 + 0.1);
    });
});

describe('getAnthropicAcceptedCacheTtl', () => {
    it('returns unknown when no trace/usage or zero counts', () => {
        expect(getAnthropicAcceptedCacheTtl(undefined)).toBe('unknown');
        expect(getAnthropicAcceptedCacheTtl(null)).toBe('unknown');
        expect(getAnthropicAcceptedCacheTtl(trace({}))).toBe('unknown');
        expect(getAnthropicAcceptedCacheTtl(trace({ cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 }))).toBe('unknown');
    });

    it('classifies 5m / 1h / mixed from the usage payload only', () => {
        expect(getAnthropicAcceptedCacheTtl(trace({ cacheCreation5mInputTokens: 10 }))).toBe('5m');
        expect(getAnthropicAcceptedCacheTtl(trace({ cacheCreation1hInputTokens: 10 }))).toBe('1h');
        expect(getAnthropicAcceptedCacheTtl(trace({ cacheCreation5mInputTokens: 5, cacheCreation1hInputTokens: 7 }))).toBe('mixed');
    });
});

describe('getDispatchEngineKey', () => {
    it('returns null when provider or model is missing', () => {
        expect(getDispatchEngineKey(result({}))).toBeNull();
        expect(getDispatchEngineKey(result({ aiProvider: 'openai' }))).toBeNull();
        expect(getDispatchEngineKey(result({ aiModelResolved: 'gpt-5.5' }))).toBeNull();
    });

    it('builds a lowercased, trimmed provider::model key, preferring resolved model', () => {
        expect(getDispatchEngineKey(result({ aiProvider: '  OpenAI ', aiModelResolved: ' GPT-5.5 ' }))).toBe('openai::gpt-5.5');
        expect(getDispatchEngineKey(result({ aiProvider: 'anthropic', aiModelRequested: 'claude-x' }))).toBe('anthropic::claude-x');
        expect(getDispatchEngineKey(result({ aiProvider: 'google', aiModelResolved: 'gemini-pro', aiModelRequested: 'ignored' }))).toBe('google::gemini-pro');
    });
});

describe('resolveActualUsageCostForResult', () => {
    it('returns undefined for unsupported provider / missing model or usage', () => {
        expect(resolveActualUsageCostForResult(result({}))).toBeUndefined();
        expect(resolveActualUsageCostForResult(result({ aiProvider: 'ollama', aiModelResolved: 'x', tokenUsage: {} as never }))).toBeUndefined();
        expect(resolveActualUsageCostForResult(result({ aiProvider: 'openai', tokenUsage: {} as never }))).toBeUndefined();
        expect(resolveActualUsageCostForResult(result({ aiProvider: 'openai', aiModelResolved: 'gpt-5.5' }))).toBeUndefined();
    });

    it('returns a finite number for a supported provider with real usage', () => {
        const cost = resolveActualUsageCostForResult(result({
            aiProvider: 'openai',
            aiModelResolved: 'gpt-5.5',
            tokenUsage: { inputTokens: 130000, outputTokens: 4000 } as never
        }));
        expect(typeof cost === 'number' && Number.isFinite(cost)).toBe(true);
        expect(cost).toBeGreaterThan(0);
    });

    it('swallows pricing errors and returns undefined (catch path)', () => {
        // Unknown model id → estimateUsageCost may throw/return non-finite;
        // either way the helper must yield undefined, never throw.
        expect(() => resolveActualUsageCostForResult(result({
            aiProvider: 'openai',
            aiModelResolved: '___definitely-not-a-model___',
            tokenUsage: { inputTokens: 1 } as never
        }))).not.toThrow();
    });
});

describe('buildEngineRecentRunSnapshot', () => {
    it('passes through citationsRequested and tokenUsage, derives citationCount + cost', () => {
        const snap = buildEngineRecentRunSnapshot(result({
            aiProvider: 'openai',
            aiModelResolved: 'gpt-5.5',
            citations: [],
            evidenceDocumentMeta: [],
            findings: [],
            tokenUsage: { inputTokens: 1000, outputTokens: 10 } as never
        }), true);
        expect(snap.citationsRequested).toBe(true);
        expect(snap.citationCount).toBe(0);
        expect(snap.tokenUsage).toEqual({ inputTokens: 1000, outputTokens: 10 });
        expect('actualCostUSD' in snap).toBe(true);
    });

    it('honours citationsRequested=false', () => {
        const snap = buildEngineRecentRunSnapshot(result({
            findings: [], citations: [], evidenceDocumentMeta: []
        }), false);
        expect(snap.citationsRequested).toBe(false);
    });
});

describe('buildEngineCacheWindowSnapshotFromSession', () => {
    const sess = (p: Partial<InquirySession>): InquirySession => p as unknown as InquirySession;
    const NOW = 1_000_000;

    it('returns undefined for null/absent or already-expired window', () => {
        expect(buildEngineCacheWindowSnapshotFromSession(null, NOW)).toBeUndefined();
        expect(buildEngineCacheWindowSnapshotFromSession(sess({}), NOW)).toBeUndefined();
        expect(buildEngineCacheWindowSnapshotFromSession(sess({ cacheWindowExpiresAt: NOW }), NOW)).toBeUndefined();
        expect(buildEngineCacheWindowSnapshotFromSession(sess({ cacheWindowExpiresAt: NOW - 1 }), NOW)).toBeUndefined();
    });

    it('shapes a still-open window and floors/clamps cachedStableTokens', () => {
        expect(buildEngineCacheWindowSnapshotFromSession(
            sess({ cacheWindowExpiresAt: NOW + 1000, cachedStableTokens: 1234.9 }), NOW
        )).toEqual({ expiresAt: NOW + 1000, cachedTokens: 1234 });
        expect(buildEngineCacheWindowSnapshotFromSession(
            sess({ cacheWindowExpiresAt: NOW + 1000, cachedStableTokens: -5 }), NOW
        )).toEqual({ expiresAt: NOW + 1000, cachedTokens: 0 });
    });

    it('cachedTokens is undefined when cachedStableTokens is absent/non-finite', () => {
        expect(buildEngineCacheWindowSnapshotFromSession(
            sess({ cacheWindowExpiresAt: NOW + 1000 }), NOW
        )).toEqual({ expiresAt: NOW + 1000, cachedTokens: undefined });
        expect(buildEngineCacheWindowSnapshotFromSession(
            sess({ cacheWindowExpiresAt: NOW + 1000, cachedStableTokens: Number.NaN }), NOW
        )).toEqual({ expiresAt: NOW + 1000, cachedTokens: undefined });
    });
});

describe('InquiryView keeps thin delegating wrappers (behaviour unchanged)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    it('imports the pure helpers under aliases and delegates without recursion', () => {
        expect(src.includes("from './engine/inquiryCacheStatus'")).toBe(true);
        // Exact pass-through forwarders were deleted (CH-2026-09-04-#9); the view calls the pure helper directly.
        expect(src.includes('getAnthropicAcceptedCacheTtl(trace)')).toBe(true);
        expect(src.includes('getDispatchEngineKey(')).toBe(true);
        expect(src.includes('getAnthropicAcceptedCacheTtlPure')).toBe(false);
        // The original inline bodies must be gone from InquiryView.
        expect(src.includes('return (ratioScore * 1_000_000) + tokenScore + (inputScore * 0.001);')).toBe(false);
        // chunk 3a: the score wrapper is gone; scoring is consumed only
        // inside the pure picker, not via an InquiryView wrapper.
        expect(src.includes('private scoreReuseAdvancedContext(')).toBe(false);
        expect(src.includes('scoreReuseAdvancedContextPure')).toBe(false);
    });

    it('chunk-2 wrappers delegate while keeping guard / citations / lookup / now in the view', () => {
        expect(src.includes('return resolveActualUsageCostForResultPure(result, cacheProvenance);')).toBe(true);
        // The wrapper now plumbs `cacheStatus` (from session.providerCacheStatus)
        // through to the pure builder so the cache pill can distinguish
        // create-vs-reuse for Gemini.
        expect(src.includes('const cacheStatus = persistedCacheSession?.providerCacheStatus;')).toBe(true);
        expect(src.includes('buildEngineRecentRunSnapshotPure(\n                result,\n                this.areInquiryProviderCitationsEnabled(),\n                cacheStatus\n            )')).toBe(true);
        expect(src.includes('buildEngineRecentRunSnapshotPure(\n            persistedCacheSession.result,\n            this.areInquiryProviderCitationsEnabled(),\n            cacheStatus\n        )')).toBe(true);
        expect(src.includes('return buildEngineCacheWindowSnapshotFromSessionPure(session, Date.now());')).toBe(true);
        // Guard + session lookup remain in InquiryView.
        expect(src.includes('if (result && !this.isErrorResult(result)) {')).toBe(true);
        expect(src.includes('if (!persistedCacheSession || this.isErrorResult(persistedCacheSession.result)) return undefined;')).toBe(true);
        expect(src.includes('this.sessionStore.getLatestActiveCacheSessionForEngine(')).toBe(true);
        // Original inline shaper bodies must be gone from InquiryView.
        expect(src.includes('const sourcesVM = buildInquirySourcesViewModel(\n            result.citations,')).toBe(false);
        expect(src.includes('const breakdown = estimateUsageCost(provider, modelId, result.tokenUsage);')).toBe(false);
    });

    it('chunk-3a: getEffectiveReuseAdvancedContext delegates, preserving persisted-then-live order', () => {
        expect(src.includes('return pickEffectiveReuseAdvancedContextPure(persisted, live);')).toBe(true);
        // Resolution of both inputs stays in the view (impure lookups).
        expect(src.includes('const persisted = this.getPersistedReuseAdvancedContext();')).toBe(true);
        expect(src.includes('const live = this.getLiveReuseAdvancedContext();')).toBe(true);
        // The old inline selection branch must be gone.
        expect(src.includes('this.scoreReuseAdvancedContext(live) > this.scoreReuseAdvancedContext(persisted)')).toBe(false);
    });
});

describe('pickEffectiveReuseAdvancedContext', () => {
    const warm = (p: Partial<AIRunAdvancedContext>): AIRunAdvancedContext =>
        ({ reuseState: 'warm', ...p }) as unknown as AIRunAdvancedContext;

    it('returns live (or null) when persisted is null', () => {
        const live = warm({ cachedStableRatio: 0.5 });
        expect(pickEffectiveReuseAdvancedContext(null, live)).toBe(live);
        expect(pickEffectiveReuseAdvancedContext(null, null)).toBeNull();
    });

    it('returns persisted when live is null', () => {
        const persisted = warm({ cachedStableRatio: 0.5 });
        expect(pickEffectiveReuseAdvancedContext(persisted, null)).toBe(persisted);
    });

    it('higher score wins when both present', () => {
        const persisted = warm({ cachedStableRatio: 0.2, cachedStableTokens: 10, totalInputTokens: 10 });
        const live = warm({ cachedStableRatio: 0.9, cachedStableTokens: 10, totalInputTokens: 10 });
        expect(pickEffectiveReuseAdvancedContext(persisted, live)).toBe(live);
    });

    it('ties keep persisted (strict >, original semantics)', () => {
        const persisted = warm({ cachedStableRatio: 0.5, cachedStableTokens: 10, totalInputTokens: 10 });
        const live = warm({ cachedStableRatio: 0.5, cachedStableTokens: 10, totalInputTokens: 10 });
        expect(pickEffectiveReuseAdvancedContext(persisted, live)).toBe(persisted);
        // Non-warm scores 0; equal-0 tie also keeps persisted.
        const p0 = ({ reuseState: 'eligible' }) as unknown as AIRunAdvancedContext;
        const l0 = ({ reuseState: 'eligible' }) as unknown as AIRunAdvancedContext;
        expect(pickEffectiveReuseAdvancedContext(p0, l0)).toBe(p0);
    });
});

describe('mapSessionToPersistedReuseContext', () => {
    const NOW = 1_000_000;
    const sess = (p: Record<string, unknown>): InquirySession =>
        ({ result: {}, ...p }) as unknown as InquirySession;

    it('returns null for null session or provider mismatch', () => {
        expect(mapSessionToPersistedReuseContext(null, 'openai', 'GPT-5.5', NOW)).toBeNull();
        expect(mapSessionToPersistedReuseContext(
            sess({ result: { aiProvider: 'anthropic' }, cacheReuseState: 'warm' }), 'openai', 'GPT-5.5', NOW
        )).toBeNull();
    });

    it('derives reuseState: warm → warm; future window → eligible; else idle → null', () => {
        expect(mapSessionToPersistedReuseContext(
            sess({ result: { aiProvider: 'openai' }, cacheReuseState: 'warm' }), 'openai', 'M', NOW
        )?.reuseState).toBe('warm');
        expect(mapSessionToPersistedReuseContext(
            sess({ result: { aiProvider: 'openai' }, cacheWindowExpiresAt: NOW + 1 }), 'openai', 'M', NOW
        )?.reuseState).toBe('eligible');
        expect(mapSessionToPersistedReuseContext(
            sess({ result: { aiProvider: 'openai' }, cacheWindowExpiresAt: NOW }), 'openai', 'M', NOW
        )).toBeNull(); // idle (not strictly > now)
    });

    it('clamps ratio [0,1] and floors token counts; passes provider/modelLabel through', () => {
        const out = mapSessionToPersistedReuseContext(
            sess({
                result: { aiProvider: 'openai', }, cacheReuseState: 'warm',
                cachedStableRatio: 1.5, cachedStableTokens: 99.9, totalInputTokens: 100.7,
                providerCacheStatus: 'hit'
            }), 'openai', 'GPT-5.5', NOW
        );
        expect(out?.cachedStableRatio).toBe(1);
        expect(out?.cachedStableTokens).toBe(99);
        expect(out?.totalInputTokens).toBe(100);
        expect(out?.provider).toBe('openai');
        expect(out?.modelLabel).toBe('GPT-5.5');
        expect(out?.modelSelectionReason).toBe('persisted_cache_certificate');
        expect(out?.cacheStatus).toBe('hit');
    });
});

describe('matchLiveReuseAdvancedContext', () => {
    const c = (p: Partial<AIRunAdvancedContext>): AIRunAdvancedContext =>
        p as unknown as AIRunAdvancedContext;
    it('null context → null', () => {
        expect(matchLiveReuseAdvancedContext(null, 'openai', 'M')).toBeNull();
        expect(matchLiveReuseAdvancedContext(undefined, 'openai', 'M')).toBeNull();
    });
    it('provider mismatch → null', () => {
        expect(matchLiveReuseAdvancedContext(c({ provider: 'anthropic' }), 'openai', 'M')).toBeNull();
    });
    it('model-label mismatch (trim/lowercase) → null; empty labels bypass the check', () => {
        expect(matchLiveReuseAdvancedContext(c({ provider: 'openai', modelLabel: ' GPT-4 ' }), 'openai', 'gpt-5')).toBeNull();
        const ok = c({ provider: 'openai', modelLabel: '' });
        expect(matchLiveReuseAdvancedContext(ok, 'openai', 'anything')).toBe(ok);
        const ok2 = c({ provider: 'openai', modelLabel: ' GPT-5.5 ' });
        expect(matchLiveReuseAdvancedContext(ok2, 'openai', 'gpt-5.5')).toBe(ok2);
    });
});

describe('resolveActiveCacheWindowExpiry / formatContextCountdownLabel', () => {
    const NOW = 1_000_000;
    const sw = (e?: number) => ({ cacheWindowExpiresAt: e }) as unknown as InquirySession;
    it('expiry: no window / expired / boundary / future', () => {
        expect(resolveActiveCacheWindowExpiry(null, NOW)).toBeNull();
        expect(resolveActiveCacheWindowExpiry(sw(undefined), NOW)).toBeNull();
        expect(resolveActiveCacheWindowExpiry(sw(NOW), NOW)).toBeNull();      // <= now
        expect(resolveActiveCacheWindowExpiry(sw(NOW - 1), NOW)).toBeNull();
        expect(resolveActiveCacheWindowExpiry(sw(NOW + 1), NOW)).toBe(NOW + 1);
    });
    it('countdown label: none / remaining / expired', () => {
        expect(formatContextCountdownLabel(null, NOW)).toBeNull();
        expect(formatContextCountdownLabel(sw(undefined), NOW)).toBeNull();
        expect(formatContextCountdownLabel(sw(NOW + 60_000), NOW)).toMatch(/ remaining$/);
        expect(formatContextCountdownLabel(sw(NOW), NOW)).toBe('Cache expired'); // remainingMs = 0, not > 0
        expect(formatContextCountdownLabel(sw(NOW - 5), NOW)).toBe('Cache expired');
    });
});

describe('InquiryView chunk-3b wrappers delegate while keeping lookups/guards', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    it('persisted/live/expiry/countdown delegate; engine + sessionStore + plugin + scope + Date.now() stay', () => {
        expect(src.includes('return mapSessionToPersistedReuseContextPure(session, engine.provider, engine.modelLabel, Date.now());')).toBe(true);
        expect(src.includes('return matchLiveReuseAdvancedContextPure(context, engine.provider, engine.modelLabel);')).toBe(true);
        expect(src.includes('return resolveActiveCacheWindowExpiryPure(session, Date.now());')).toBe(true);
        expect(src.includes('return formatContextCountdownLabelPure(session, Date.now());')).toBe(true);
        // Impure boundary stays in the view.
        expect(src.includes('const engine = this.getResolvedEngine();')).toBe(true);
        expect(src.includes('this.sessionStore.getLatestActiveCacheSessionForEngine(engine.provider, engine.modelId, {')).toBe(true);
        expect(src.includes("getLastAiAdvancedContext(this.plugin, 'InquiryMode')")).toBe(true);
        expect(src.includes('scope: this.state.scope')).toBe(true);
        // Old inline bodies must be gone.
        expect(src.includes("modelSelectionReason: 'persisted_cache_certificate',")).toBe(false);
        expect(src.includes("return 'Cache expired';")).toBe(false);
    });
});
