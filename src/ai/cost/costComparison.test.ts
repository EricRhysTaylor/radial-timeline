import { describe, expect, it } from 'vitest';
import type { InquirySessionStore } from '../../inquiry/InquirySessionStore';
import {
    activeCacheReuseRatioForModel,
    billableOutputTokensFromUsage,
    buildCostComparisonRows,
    costComparisonRowKey,
    listCostComparisonModels,
    type CostComparisonDeps,
    type CostComparisonModel
} from './costComparison';

const anthropic: CostComparisonModel = { provider: 'anthropic', modelId: 'claude-sonnet-5', providerLabel: 'Anthropic', modelLabel: 'Claude Sonnet 5' };

function deps(overrides: Partial<CostComparisonDeps> = {}): CostComparisonDeps {
    return {
        session: null,
        estimateExecution: async () => ({ estimatedTokens: 120_000, method: 'anthropic_count', expectedPassCount: 1, maxOutputTokens: 8_000 }),
        predictExpectedOutput: () => 2_000,
        cacheWindowLabel: () => '1h',
        ...overrides
    };
}

function sessionStore(session: unknown): InquirySessionStore {
    return {
        getLatestSessionForEngineInScope: () => session,
        getLatestActiveCacheSessionForEngine: () => session
    } as unknown as InquirySessionStore; // SAFE: the two lookups the rows use, stubbed
}

describe('listCostComparisonModels', () => {
    it('lists only priced cloud models, never local or "-latest" aliases', () => {
        const models = listCostComparisonModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.every(model => model.provider !== 'ollama' && model.provider !== 'none')).toBe(true);
        expect(models.some(model => model.modelId.endsWith('-latest'))).toBe(false);
        expect(models.map(model => model.provider)).toEqual([...models.map(model => model.provider)].sort((a, b) => {
            const order = ['anthropic', 'openai', 'google'];
            return order.indexOf(a) - order.indexOf(b);
        }));
    });

    it('falls back to the builtin catalog when the registry is empty', () => {
        expect(listCostComparisonModels([])).toEqual(listCostComparisonModels());
    });
});

describe('billableOutputTokensFromUsage', () => {
    it('bills Gemini for thinking tokens hidden in the total', () => {
        expect(billableOutputTokensFromUsage('google', { outputTokens: 100, inputTokens: 1_000, totalTokens: 1_500 })).toBe(500);
        expect(billableOutputTokensFromUsage('anthropic', { outputTokens: 100, inputTokens: 1_000, totalTokens: 1_500 })).toBe(100);
    });

    it('returns null for missing or non-positive output', () => {
        expect(billableOutputTokensFromUsage('openai', undefined)).toBeNull();
        expect(billableOutputTokensFromUsage('openai', { outputTokens: 0 })).toBeNull();
    });
});

describe('activeCacheReuseRatioForModel', () => {
    it('needs a fingerprint, a live window, and a positive ratio', () => {
        const live = { cacheWindowExpiresAt: Date.now() + 60_000, cachedStableRatio: 1.4 };
        expect(activeCacheReuseRatioForModel({ sessionStore: sessionStore(live), scope: 'book', cacheReuseFingerprint: 'fp' }, anthropic)).toBe(1);
        expect(activeCacheReuseRatioForModel({ sessionStore: sessionStore(live), scope: 'book', cacheReuseFingerprint: null }, anthropic)).toBeNull();
        const expired = { cacheWindowExpiresAt: Date.now() - 1, cachedStableRatio: 0.5 };
        expect(activeCacheReuseRatioForModel({ sessionStore: sessionStore(expired), scope: 'book', cacheReuseFingerprint: 'fp' }, anthropic)).toBeNull();
    });
});

describe('buildCostComparisonRows', () => {
    it('refuses to price an unavailable input and says so instead of a fabricated figure', async () => {
        const [row] = await buildCostComparisonRows([anthropic], deps({
            estimateExecution: async () => ({ estimatedTokens: 0, method: 'unavailable', expectedPassCount: 1, maxOutputTokens: 8_000 })
        }));
        expect(row.freshText).toBe('Unavailable');
        expect(row.cachedText).toBe('Unavailable');
        expect(row.passesText).toBe('1 pass');
    });

    it('asks for an output sample when nothing has been learned or run', async () => {
        const [row] = await buildCostComparisonRows([anthropic], deps({ predictExpectedOutput: () => null }));
        expect(row.freshText).toBe('Output sample needed');
        expect(row.cachedText).toBe('Output sample needed');
    });

    it('prices a provider-counted run and reports no active cache without a session', async () => {
        const [row] = await buildCostComparisonRows([anthropic], deps());
        expect(row.freshText).toMatch(/^\$\d/);
        expect(row.freshText).toContain('(1h)');
        expect(row.freshText).not.toContain('(local input)');
        expect(row.cachedText).toBe('No active cache');
    });

    it('discloses a local chars/4 input and prices the cached run when a cache window is live', async () => {
        const live = { cacheWindowExpiresAt: Date.now() + 60_000, cachedStableRatio: 0.9, result: { tokenUsage: { outputTokens: 1_000 } } };
        const [row] = await buildCostComparisonRows([anthropic], deps({
            estimateExecution: async () => ({ estimatedTokens: 120_000, method: 'heuristic_chars', expectedPassCount: 2, maxOutputTokens: 8_000 }),
            session: { sessionStore: sessionStore(live), scope: 'book', cacheReuseFingerprint: 'fp' }
        }));
        expect(row.freshText).toContain('(local input)');
        expect(row.cachedText).toMatch(/^\$\d/);
        expect(row.cachedText).toContain('(1h)');
        expect(row.passesText).toBe('2 passes');
    });

    it('throws when the canonical execution estimate is missing', async () => {
        await expect(buildCostComparisonRows([anthropic], deps({ estimateExecution: async () => null }))).rejects.toThrow(/Canonical execution estimate unavailable/);
    });

    it('keys rows by provider and model', () => {
        expect(costComparisonRowKey('openai', 'gpt-5.6-sol')).toBe('openai::gpt-5.6-sol');
    });
});
