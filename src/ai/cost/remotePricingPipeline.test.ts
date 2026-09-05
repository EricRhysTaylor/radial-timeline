/**
 * Integration tests for the remote pricing + registry pipeline.
 *
 * Covers: remote happy path, fallback behavior, drift handling,
 * cache/freshness, and end-to-end data flow from fetch to cost table inputs.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { loadRemotePricing, type RemotePricingOptions } from './remotePricing';
import {
    mergeRemotePricing,
    resetPricingToBuiltin,
    getActivePricingTable,
    getActivePricingMeta,
    getProviderPricing,
    getPricingFreshnessLabel,
    BUILTIN_PRICING,
    type ProviderPricingTable
} from './providerPricing';
import { BUILTIN_MODELS } from '../registry/builtinModels';
import { ModelRegistry } from '../registry/modelRegistry';
import type { ModelInfo } from '../types';
import { selectModel } from '../router/selectModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ModelInfo for testing. */
function makeModel(overrides: Partial<ModelInfo> & { provider: ModelInfo['provider']; id: string; alias: string }): ModelInfo {
    return {
        label: overrides.alias,
        tier: 'BALANCED',
        capabilities: ['jsonStrict'],
        personality: { reasoning: 5, writing: 5, determinism: 5 },
        contextWindow: 100000,
        maxOutput: 4000,
        status: 'stable',
        ...overrides
    };
}

function freshCacheJson<T>(table: T): string {
    return JSON.stringify({ fetchedAt: new Date().toISOString(), ...table });
}

function staleCacheJson<T>(table: T): string {
    return JSON.stringify({ fetchedAt: '2000-01-01T00:00:00.000Z', ...table });
}

function mockFetch(payload: unknown, ok = true, status = 200) {
    return async () => ({ ok, status, json: async () => payload });
}

function failingFetch(status = 500) {
    return async () => ({ ok: false, status, json: async () => ({}) });
}

function throwingFetch() {
    return async (): Promise<never> => { throw new Error('network timeout'); };
}

const noopCache = { readCache: async () => null as string | null, writeCache: async () => undefined };

// ---------------------------------------------------------------------------
// 1. Remote pricing: happy path
// ---------------------------------------------------------------------------

describe('remote pricing pipeline — happy path', () => {
    afterEach(() => resetPricingToBuiltin());

    it('fetched remote pricing is merged and drives active pricing table', async () => {
        const remotePayload = {
            models: [
                { provider: 'anthropic', modelId: 'claude-opus-4-8', inputPer1M: 2.5, outputPer1M: 12.0 },
                { provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 2.8, outputPer1M: 9.0 }
            ]
        };
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch(remotePayload)
        });

        expect(result.source).toBe('remote');
        expect(result.table).not.toBeNull();

        mergeRemotePricing(result.table!, result.source, result.fetchedAt);

        expect(getProviderPricing('anthropic', 'claude-opus-4-8').inputPer1M).toBe(2.5);
        expect(getProviderPricing('openai', 'gpt-5.5').inputPer1M).toBe(2.8);
        expect(getActivePricingMeta().source).toBe('remote');
    });

    it('new remote-only model appears in active pricing after merge', async () => {
        const remotePayload = {
            models: [
                { provider: 'anthropic', modelId: 'claude-future-7', inputPer1M: 1.0, outputPer1M: 5.0 }
            ]
        };
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch(remotePayload)
        });

        mergeRemotePricing(result.table!, result.source, result.fetchedAt);

        // New model should be accessible
        expect(getProviderPricing('anthropic', 'claude-future-7').inputPer1M).toBe(1.0);
        // Existing builtin should still be there
        expect(getProviderPricing('anthropic', 'claude-opus-4-8').inputPer1M).toBe(5.0);
    });

    it('remote pricing overrides builtin pricing for same model', async () => {
        const original = getProviderPricing('openai', 'gpt-5.5');
        expect(original.inputPer1M).toBe(5.0);

        mergeRemotePricing({
            openai: { 'gpt-5.5': { inputPer1M: 1.5, outputPer1M: 7.0 } }
        }, 'remote', new Date().toISOString());

        expect(getProviderPricing('openai', 'gpt-5.5').inputPer1M).toBe(1.5);
        expect(getProviderPricing('openai', 'gpt-5.5').cacheReadPer1M).toBe(0.5);
    });

    it('cache is written on successful remote fetch', async () => {
        let writtenContent = '';
        await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async (content) => { writtenContent = content; },
            fetchImpl: mockFetch({
                models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
            })
        });

        expect(writtenContent).toBeTruthy();
        const parsed = JSON.parse(writtenContent);
        expect(parsed.fetchedAt).toBeDefined();
        expect(parsed.table.openai?.['gpt-5.5']).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// 2. Remote pricing: fallback behavior
// ---------------------------------------------------------------------------

describe('remote pricing pipeline — fallback behavior', () => {
    afterEach(() => resetPricingToBuiltin());

    it('uses stale cache when remote fetch returns non-ok', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => staleCacheJson({
                table: { anthropic: { 'claude-opus-4-8': { inputPer1M: 99, outputPer1M: 99 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: failingFetch(503)
        });

        expect(result.source).toBe('cache');
        expect(result.table?.anthropic?.['claude-opus-4-8']?.inputPer1M).toBe(99);
        expect(result.warning).toContain('503');
    });

    it('falls back to builtin when fetch fails and no cache exists', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: failingFetch(500)
        });

        expect(result.source).toBe('builtin');
        expect(result.table).toBeNull();
        expect(result.warning).toContain('500');
    });

    it('falls back to cache when fetch throws a network error', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => staleCacheJson({
                table: { openai: { 'gpt-5.5': { inputPer1M: 42, outputPer1M: 42 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: throwingFetch()
        });

        expect(result.source).toBe('cache');
        expect(result.warning).toContain('network timeout');
    });

    it('falls back to builtin when fetch throws and no cache exists', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: throwingFetch()
        });

        expect(result.source).toBe('builtin');
        expect(result.table).toBeNull();
        expect(result.warning).toContain('network timeout');
    });

    it('falls back to cache when remote returns malformed JSON payload', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => staleCacheJson({
                table: { google: { 'gemini-3.1-pro-preview': { inputPer1M: 2.5, outputPer1M: 15 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: mockFetch({ not_models: 'bad data' })
        });

        expect(result.source).toBe('cache');
        expect(result.warning).toContain('no usable entries');
    });

    it('falls back to builtin when remote returns malformed payload and no cache', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch('not-json-object')
        });

        expect(result.source).toBe('builtin');
        expect(result.table).toBeNull();
    });

    it('partial remote failure does not break pricing: builtin models remain after null merge', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: failingFetch()
        });

        // The caller checks `if (result.table)` before merging
        expect(result.table).toBeNull();

        // Active pricing should still be builtin
        const opus = getProviderPricing('anthropic', 'claude-opus-4-8');
        expect(opus.inputPer1M).toBe(5.0);
        expect(getActivePricingMeta().source).toBe('builtin');
    });
});

// ---------------------------------------------------------------------------
// 3. Remote pricing: cache freshness / TTL
// ---------------------------------------------------------------------------

describe('remote pricing pipeline — cache TTL', () => {
    afterEach(() => resetPricingToBuiltin());

    it('uses fresh cache without fetching (default 24h TTL)', async () => {
        let fetchCalled = false;
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => freshCacheJson({
                table: { openai: { 'gpt-5.5': { inputPer1M: 77, outputPer1M: 77 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: async () => { fetchCalled = true; return { ok: false, status: 500, json: async () => ({}) }; }
        });

        expect(result.source).toBe('cache');
        expect(result.table?.openai?.['gpt-5.5']?.inputPer1M).toBe(77);
        expect(fetchCalled).toBe(false);
    });

    it('fetches when cache is stale (beyond TTL)', async () => {
        let fetchCalled = false;
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => staleCacheJson({
                table: { openai: { 'gpt-5.5': { inputPer1M: 77, outputPer1M: 77 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: async () => {
                fetchCalled = true;
                return {
                    ok: true, status: 200,
                    json: async () => ({
                        models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
                    })
                };
            }
        });

        expect(fetchCalled).toBe(true);
        expect(result.source).toBe('remote');
    });

    it('forced refresh with ttlMs=0 bypasses stale cache', async () => {
        const oneSecondAgo = new Date(Date.now() - 1000).toISOString();
        let fetchCalled = false;
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ttlMs: 0,
            readCache: async () => JSON.stringify({
                fetchedAt: oneSecondAgo,
                table: { openai: { 'gpt-5.5': { inputPer1M: 77, outputPer1M: 77 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: async () => {
                fetchCalled = true;
                return {
                    ok: true, status: 200,
                    json: async () => ({
                        models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
                    })
                };
            }
        });

        expect(fetchCalled).toBe(true);
        expect(result.source).toBe('remote');
    });

    it('ttlMs=0 deterministically bypasses even a same-millisecond cache', async () => {
        // isCacheFresh returns false immediately for ttlMs <= 0, regardless of cache age.
        let fetchCalled = false;
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ttlMs: 0,
            readCache: async () => freshCacheJson({
                table: { openai: { 'gpt-5.5': { inputPer1M: 77, outputPer1M: 77 } } }
            }),
            writeCache: async () => undefined,
            fetchImpl: async () => {
                fetchCalled = true;
                return {
                    ok: true, status: 200,
                    json: async () => ({
                        models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
                    })
                };
            }
        });

        expect(fetchCalled).toBe(true);
        expect(result.source).toBe('remote');
    });
});

// ---------------------------------------------------------------------------
// 10. Pricing freshness labels
// ---------------------------------------------------------------------------

describe('pricing freshness labels', () => {
    it('builtin source shows fallback label', () => {
        expect(getPricingFreshnessLabel({ source: 'builtin' })).toBe('Using fallback pricing');
    });

    it('cache source without fetchedAt shows generic cached label', () => {
        expect(getPricingFreshnessLabel({ source: 'cache' })).toBe('Using cached pricing');
    });

    it('recent remote fetch shows checked label with date', () => {
        const now = new Date().toISOString();
        const label = getPricingFreshnessLabel({ source: 'remote', fetchedAt: now });
        expect(label).toMatch(/^Pricing checked /);
    });

    it('stale cache (>3 days) shows cached-from label', () => {
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
        const label = getPricingFreshnessLabel({ source: 'cache', fetchedAt: fiveDaysAgo });
        expect(label).toMatch(/^Using cached pricing from /);
    });

    it('invalid fetchedAt falls back to generic cached label', () => {
        expect(getPricingFreshnessLabel({ source: 'cache', fetchedAt: 'not-a-date' })).toBe('Using cached pricing');
    });
});

// ---------------------------------------------------------------------------
// 11. End-to-end: cost table model selection with registry models
// ---------------------------------------------------------------------------

describe('cost table model selection flow (getCostComparisonModels logic)', () => {
    afterEach(() => resetPricingToBuiltin());

    it('registry model with pricing appears in cost comparison (supportsCostComparisonModel)', () => {
        // Simulates the supportsCostComparisonModel check in AiSection
        const supports = (provider: string, modelId: string): boolean => {
            try {
                getProviderPricing(provider as any, modelId);
                return true;
            } catch {
                return false;
            }
        };

        // All builtin cloud models with pricing should be supported
        for (const [provider, models] of Object.entries(BUILTIN_PRICING)) {
            if (!models) continue;
            for (const modelId of Object.keys(models)) {
                expect(supports(provider, modelId)).toBe(true);
            }
        }
    });

    it('registry model without pricing is filtered out by supportsCostComparisonModel', () => {
        const supports = (provider: string, modelId: string): boolean => {
            try {
                getProviderPricing(provider as any, modelId);
                return true;
            } catch {
                return false;
            }
        };

        // Ollama models exist in BUILTIN_MODELS but have no pricing
        // entries — they're the canonical "registry without pricing"
        // example. supports() must return false for them.
        expect(supports('ollama', 'llama3')).toBe(false);
        expect(supports('ollama', 'local-model')).toBe(false);
        // Truly nonexistent IDs also resolve to false.
        expect(supports('openai', 'no-such-model')).toBe(false);
    });

    it('remote-only pricing model without registry model never reaches cost table', () => {
        // Add pricing for a model that does not exist in registry
        mergeRemotePricing({
            anthropic: { 'phantom-model': { inputPer1M: 1, outputPer1M: 1 } }
        }, 'remote');

        // The pricing is available...
        expect(getProviderPricing('anthropic', 'phantom-model').inputPer1M).toBe(1);

        // ...but the cost table iterates registry models, not pricing entries.
        // So 'phantom-model' would never appear in getCostComparisonModels
        // because it's not in any ModelInfo[].
        const builtinIds = BUILTIN_MODELS.map(m => m.id);
        expect(builtinIds).not.toContain('phantom-model');
    });

    it('after merging remote pricing, new remote-only pricing model is resolvable', () => {
        mergeRemotePricing({
            google: {
                'gemini-4-flash-preview': { inputPer1M: 0, outputPer1M: 0 }
            }
        }, 'remote', new Date().toISOString());

        const pricing = getProviderPricing('google', 'gemini-4-flash-preview');
        expect(pricing.inputPer1M).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 12. Cache corruption / edge cases
// ---------------------------------------------------------------------------

describe('cache corruption edge cases', () => {
    it('corrupted pricing cache JSON is ignored, fetch proceeds', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => 'not valid json {{{',
            writeCache: async () => undefined,
            fetchImpl: mockFetch({
                models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
            })
        });

        expect(result.source).toBe('remote');
    });

    it('pricing cache missing fetchedAt is treated as no cache', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => JSON.stringify({ table: { openai: {} } }),
            writeCache: async () => undefined,
            fetchImpl: mockFetch({
                models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
            })
        });

        // Should proceed to fetch since cache is invalid
        expect(result.source).toBe('remote');
    });

    it('writeCache failure during pricing fetch returns remote data safely', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            readCache: async () => null,
            writeCache: async () => { throw new Error('disk full'); },
            fetchImpl: mockFetch({
                models: [{ provider: 'openai', modelId: 'gpt-5.5', inputPer1M: 3, outputPer1M: 10 }]
            })
        });

        expect(result.source).toBe('remote');
        expect(result.table?.openai?.['gpt-5.5']?.inputPer1M).toBe(3);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('cache write failed: disk full')
        );
        warnSpy.mockRestore();
    });

});

// ---------------------------------------------------------------------------
// 13. Pricing validation edge cases
// ---------------------------------------------------------------------------

describe('pricing validation edge cases', () => {
    afterEach(() => resetPricingToBuiltin());

    it('zero pricing (free model) is valid', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch({
                models: [{ provider: 'google', modelId: 'gemini-free', inputPer1M: 0, outputPer1M: 0 }]
            })
        });

        expect(result.source).toBe('remote');
        expect(result.table?.google?.['gemini-free']?.inputPer1M).toBe(0);
    });

    it('longContext pricing is preserved when valid', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch({
                models: [{
                    provider: 'anthropic',
                    modelId: 'claude-test',
                    inputPer1M: 3,
                    outputPer1M: 15,
                    longContext: {
                        thresholdInputTokens: 200000,
                        inputPer1M: 6,
                        outputPer1M: 30
                    }
                }]
            })
        });

        const pricing = result.table?.anthropic?.['claude-test'];
        expect(pricing?.longContext?.thresholdInputTokens).toBe(200000);
        expect(pricing?.longContext?.inputPer1M).toBe(6);
    });

    it('invalid longContext is silently dropped', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch({
                models: [{
                    provider: 'anthropic',
                    modelId: 'claude-test',
                    inputPer1M: 3,
                    outputPer1M: 15,
                    longContext: { thresholdInputTokens: 'not a number' }
                }]
            })
        });

        const pricing = result.table?.anthropic?.['claude-test'];
        expect(pricing?.longContext).toBeUndefined();
        expect(pricing?.inputPer1M).toBe(3);
    });

    it('invalid promo is silently dropped', async () => {
        const result = await loadRemotePricing({
            enabled: true,
            url: 'https://example.com/pricing.json',
            ...noopCache,
            fetchImpl: mockFetch({
                models: [{
                    provider: 'openai',
                    modelId: 'gpt-test',
                    inputPer1M: 3,
                    outputPer1M: 10,
                    promo: { label: '' } // empty label is invalid
                }]
            })
        });

        const pricing = result.table?.openai?.['gpt-test'];
        expect(pricing?.promo).toBeUndefined();
        expect(pricing?.inputPer1M).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// 14. AiSection BUILTIN_MODELS fallback in cost table path
// ---------------------------------------------------------------------------

describe('AiSection cost table BUILTIN_MODELS fallback', () => {
    it('getCostComparisonModels fallback line exists: registryModels?.length ? registryModels : BUILTIN_MODELS', () => {
        // This is a structural assertion test — verifies the fallback logic pattern
        // exists in AiSection.ts (mirrors the existing source-reading test pattern).
        const { readFileSync } = require('node:fs');
        const { resolve } = require('node:path');
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        const costSource = readFileSync(resolve(process.cwd(), 'src/ai/cost/costComparison.ts'), 'utf8');

        // The fallback line (the model list now lives in ai/cost/costComparison.ts)
        expect(costSource).toContain("registryModels?.length ? registryModels : BUILTIN_MODELS");

        // The cost table refresh path fetches registry models from the AI client
        expect(source).toContain("aiClient.getRegistryModels()");
        expect(source).toContain("aiClient.refreshPricing()");

        // The cost table refresh passes registry models to computeCostComparisonRows
        expect(source).toContain("computeCostComparisonRows(registryModels)");
    });

    it('refreshCostComparisonTable calls both getRegistryModels and refreshPricing in parallel', () => {
        const { readFileSync } = require('node:fs');
        const { resolve } = require('node:path');
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');

        // Both calls are in a Promise.all
        expect(source).toMatch(/Promise\.all\(\[\s*aiClient\.getRegistryModels\(\),\s*aiClient\.refreshPricing\(\)/);
    });
});

// ---------------------------------------------------------------------------
// 15. URL correctness: main branch
// ---------------------------------------------------------------------------

describe('remote URLs use main branch', () => {

    it('aiClient uses main branch for pricing URL', () => {
        const { readFileSync } = require('node:fs');
        const { resolve } = require('node:path');
        const source = readFileSync(resolve(process.cwd(), 'src/ai/runtime/aiClient.ts'), 'utf8');

        expect(source).toContain("radial-timeline/main/scripts/models/pricing.json");
        expect(source).not.toContain("radial-timeline/master/scripts/models/pricing.json");
    });
});
