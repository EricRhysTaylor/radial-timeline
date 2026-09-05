import { describe, expect, it, afterEach } from 'vitest';
import {
    getProviderPricing,
    resolveProviderModelPricing,
    isPromoActive,
    mergeRemotePricing,
    resetPricingToBuiltin,
    getActivePricingMeta,
    getPricingFreshnessLabel,
} from './providerPricing';

describe('providerPricing', () => {
    afterEach(() => {
        resetPricingToBuiltin();
    });

    it('stores an explicit Claude Opus 4.8 pricing row', () => {
        const pricing = getProviderPricing('anthropic', 'claude-opus-4-8');

        expect(pricing.inputPer1M).toBe(5);
        expect(pricing.outputPer1M).toBe(25);
        expect(pricing.cacheWrite5mPer1M).toBe(6.25);
        expect(pricing.cacheWrite1hPer1M).toBe(10);
        expect(pricing.cacheReadPer1M).toBe(0.5);
    });

    it('stores GPT-5.5 standard pricing with cached input support', () => {
        const standard = getProviderPricing('openai', 'gpt-5.5');

        expect(standard.inputPer1M).toBe(5);
        expect(standard.outputPer1M).toBe(30);
        expect(standard.cacheReadPer1M).toBe(0.5);
        expect(standard.longContext?.thresholdInputTokens).toBe(272_000);
        expect(standard.longContext?.inputPer1M).toBe(10);
        expect(standard.longContext?.outputPer1M).toBe(45);
        expect(standard.longContext?.cacheReadPer1M).toBe(1);
    });

    it('does not include GPT-5.5 Pro in built-in pricing', () => {
        expect(() => getProviderPricing('openai', 'gpt-5.5-pro')).toThrowError(/Missing provider pricing/);
    });

    it('applies GPT-5.5 long-context pricing above 272k input tokens', () => {
        const standard = resolveProviderModelPricing('openai', 'gpt-5.5', 272_000);
        const longContext = resolveProviderModelPricing('openai', 'gpt-5.5', 272_001);

        expect(standard.pricingPhase).toBe('standard');
        expect(standard.inputPer1M).toBe(5);
        expect(standard.outputPer1M).toBe(30);
        expect(standard.cacheReadPer1M).toBe(0.5);
        expect(longContext.pricingPhase).toBe('longContext');
        expect(longContext.inputPer1M).toBe(10);
        expect(longContext.outputPer1M).toBe(45);
        expect(longContext.cacheReadPer1M).toBe(1);
    });

    it('stores Gemini Pro cache-read pricing and long-context thresholds', () => {
        const geminiStandard = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 200_000);
        const geminiLong = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 200_001);
        const geminiFlash = resolveProviderModelPricing('google', 'gemini-3.5-flash', 200_001);

        expect(geminiStandard.inputPer1M).toBe(2);
        expect(geminiStandard.outputPer1M).toBe(12);
        expect(geminiStandard.cacheReadPer1M).toBe(0.2);
        expect(geminiLong.inputPer1M).toBe(4);
        expect(geminiLong.outputPer1M).toBe(18);
        expect(geminiLong.cacheReadPer1M).toBe(0.4);
        expect(geminiFlash.inputPer1M).toBe(1.5);
        expect(geminiFlash.outputPer1M).toBe(9);
        expect(geminiFlash.cacheReadPer1M).toBe(0.15);
    });

    it('isPromoActive returns true for promo without expiresAt', () => {
        expect(isPromoActive({ label: 'Free preview' })).toBe(true);
    });

    it('isPromoActive returns false for expired promo', () => {
        expect(isPromoActive({ label: 'Expired', expiresAt: '2020-01-01T00:00:00Z' })).toBe(false);
    });

    it('isPromoActive returns true for future-dated promo', () => {
        const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        expect(isPromoActive({ label: 'Active', expiresAt: future })).toBe(true);
    });

    it('isPromoActive returns false for undefined', () => {
        expect(isPromoActive(undefined)).toBe(false);
    });

    it('mergeRemotePricing adds new models to active pricing', () => {
        mergeRemotePricing({
            google: {
                'gemini-4-flash-preview': {
                    inputPer1M: 0,
                    outputPer1M: 0,
                    promo: { label: 'Free preview' }
                }
            }
        }, 'remote');

        const pricing = getProviderPricing('google', 'gemini-4-flash-preview');
        expect(pricing.inputPer1M).toBe(0);
        expect(pricing.promo?.label).toBe('Free preview');
    });

    it('mergeRemotePricing overrides existing model pricing', () => {
        mergeRemotePricing({
            openai: {
                'gpt-5.5': {
                    inputPer1M: 2.0,
                    outputPer1M: 8.0
                }
            }
        }, 'remote');

        const pricing = getProviderPricing('openai', 'gpt-5.5');
        expect(pricing.inputPer1M).toBe(2.0);
        expect(pricing.outputPer1M).toBe(8.0);
        // Cache metadata is preserved from the builtin row.
        expect(pricing.cacheReadPer1M).toBe(0.5);
    });

    it('mergeRemotePricing preserves builtin cache metadata when remote rows are partial', () => {
        mergeRemotePricing({
            openai: {
                'gpt-5.5': {
                    inputPer1M: 2.0,
                    outputPer1M: 8.0
                }
            }
        }, 'remote');

        const pricing = getProviderPricing('openai', 'gpt-5.5');
        expect(pricing.cacheReadPer1M).toBe(0.5);
        expect(pricing.longContext?.thresholdInputTokens).toBe(272_000);
        expect(pricing.longContext?.cacheReadPer1M).toBe(1);
    });

    it('mergeRemotePricing preserves builtin models not in remote', () => {
        mergeRemotePricing({
            openai: {
                'gpt-5.5': { inputPer1M: 2.0, outputPer1M: 8.0 }
            }
        }, 'remote');

        const pricing = getProviderPricing('anthropic', 'claude-opus-4-8');
        expect(pricing.inputPer1M).toBe(5);
    });

    it('resetPricingToBuiltin restores original pricing', () => {
        mergeRemotePricing({
            openai: {
                'gpt-5.5': { inputPer1M: 0, outputPer1M: 0 }
            }
        }, 'remote');
        resetPricingToBuiltin();

        const pricing = getProviderPricing('openai', 'gpt-5.5');
        expect(pricing.inputPer1M).toBe(5);
    });

    it('resolveProviderModelPricing surfaces active promo', () => {
        mergeRemotePricing({
            google: {
                'gemini-3.1-pro-preview': {
                    inputPer1M: 0,
                    outputPer1M: 0,
                    promo: { label: 'Launch promo', expiresAt: new Date(Date.now() + 86400000).toISOString() }
                }
            }
        }, 'remote');

        const resolved = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 50_000);
        expect(resolved.inputPer1M).toBe(0);
        expect(resolved.promo?.label).toBe('Launch promo');
    });

    it('resolveProviderModelPricing omits expired promo', () => {
        mergeRemotePricing({
            google: {
                'gemini-3.1-pro-preview': {
                    inputPer1M: 0,
                    outputPer1M: 0,
                    promo: { label: 'Expired promo', expiresAt: '2020-01-01T00:00:00Z' }
                }
            }
        }, 'remote');

        const resolved = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 50_000);
        expect(resolved.promo).toBeUndefined();
    });

    it('expired promo falls back to standard prices', () => {
        mergeRemotePricing({
            google: {
                'gemini-3.1-pro-preview': {
                    inputPer1M: 0,
                    outputPer1M: 0,
                    promo: {
                        label: 'Expired promo',
                        expiresAt: '2020-01-01T00:00:00Z',
                        standardInputPer1M: 5.0,
                        standardOutputPer1M: 20.0
                    }
                }
            }
        }, 'remote');

        const resolved = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 50_000);
        expect(resolved.promo).toBeUndefined();
        expect(resolved.inputPer1M).toBe(5.0);
        expect(resolved.outputPer1M).toBe(20.0);
    });

    it('expired promo without standard prices keeps base prices', () => {
        mergeRemotePricing({
            google: {
                'gemini-3.1-pro-preview': {
                    inputPer1M: 2.5,
                    outputPer1M: 15.0,
                    promo: {
                        label: 'Expired promo',
                        expiresAt: '2020-01-01T00:00:00Z'
                    }
                }
            }
        }, 'remote');

        const resolved = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 50_000);
        expect(resolved.inputPer1M).toBe(2.5);
        expect(resolved.outputPer1M).toBe(15.0);
    });

    it('active promo uses promo prices (not standard)', () => {
        const future = new Date(Date.now() + 86400000).toISOString();
        mergeRemotePricing({
            google: {
                'gemini-3.1-pro-preview': {
                    inputPer1M: 0,
                    outputPer1M: 0,
                    promo: {
                        label: 'Free preview',
                        expiresAt: future,
                        standardInputPer1M: 5.0,
                        standardOutputPer1M: 20.0
                    }
                }
            }
        }, 'remote');

        const resolved = resolveProviderModelPricing('google', 'gemini-3.1-pro-preview', 50_000);
        expect(resolved.promo?.label).toBe('Free preview');
        expect(resolved.inputPer1M).toBe(0);
        expect(resolved.outputPer1M).toBe(0);
    });

    it('mergeRemotePricing sets source metadata to remote', () => {
        const fetchedAt = new Date().toISOString();
        mergeRemotePricing({
            openai: { 'gpt-5.5': { inputPer1M: 3, outputPer1M: 10 } }
        }, 'remote', fetchedAt);

        const meta = getActivePricingMeta();
        expect(meta.source).toBe('remote');
        expect(meta.fetchedAt).toBe(fetchedAt);
    });

    it('mergeRemotePricing sets source metadata to cache', () => {
        mergeRemotePricing({
            openai: { 'gpt-5.5': { inputPer1M: 3, outputPer1M: 10 } }
        }, 'cache', '2026-01-01T00:00:00Z');

        const meta = getActivePricingMeta();
        expect(meta.source).toBe('cache');
    });

    it('resetPricingToBuiltin resets meta to builtin', () => {
        mergeRemotePricing({}, 'remote', new Date().toISOString());
        resetPricingToBuiltin();

        const meta = getActivePricingMeta();
        expect(meta.source).toBe('builtin');
        expect(meta.fetchedAt).toBeUndefined();
    });

    it('resolveProviderModelPricing propagates meta', () => {
        const fetchedAt = new Date().toISOString();
        mergeRemotePricing({
            openai: { 'gpt-5.5': { inputPer1M: 3, outputPer1M: 10 } }
        }, 'remote', fetchedAt);

        const resolved = resolveProviderModelPricing('openai', 'gpt-5.5', 50_000);
        expect(resolved.meta.source).toBe('remote');
        expect(resolved.meta.fetchedAt).toBe(fetchedAt);
    });

    it('getPricingFreshnessLabel returns correct labels', () => {
        expect(getPricingFreshnessLabel({ source: 'builtin' })).toBe('Using fallback pricing');

        const now = new Date().toISOString();
        expect(getPricingFreshnessLabel({ source: 'remote', fetchedAt: now })).toMatch(/^Pricing checked /);

        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        expect(getPricingFreshnessLabel({ source: 'cache', fetchedAt: twoDaysAgo })).toMatch(/^Pricing checked /);

        const fourDaysAgo = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
        expect(getPricingFreshnessLabel({ source: 'cache', fetchedAt: fourDaysAgo })).toMatch(/^Using cached pricing from /);

        expect(getPricingFreshnessLabel({ source: 'cache' })).toBe('Using cached pricing');
    });
});
