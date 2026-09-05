import { describe, expect, it } from 'vitest';
import { computeCaps } from './computeCaps';
import { BUILTIN_MODELS } from '../registry/builtinModels';

describe('computeCaps', () => {
    it('increases output cap for higher access tiers', () => {
        const model = BUILTIN_MODELS.find(entry => entry.alias === 'claude-opus-4.8');
        expect(model).toBeDefined();
        const tier1 = computeCaps({
            provider: 'anthropic',
            model: model!,
            accessTier: 1,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'high' }
        });
        const tier3 = computeCaps({
            provider: 'anthropic',
            model: model!,
            accessTier: 3,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'high' }
        });
        const tier4 = computeCaps({
            provider: 'anthropic',
            model: model!,
            accessTier: 4,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'high' }
        });
        expect(tier3.maxOutputTokens).toBeGreaterThan(tier1.maxOutputTokens);
        expect(tier4.requestPerMinute).toBeGreaterThan(tier3.requestPerMinute);
        expect(tier4.safeChunkThreshold).toBeGreaterThanOrEqual(tier3.safeChunkThreshold);
        expect(tier1.maxInputTokens).toBe(700000);
        expect(tier4.maxInputTokens).toBe(900000);
    });

    it('forceMaxOutputCeiling lifts a tier-clamped output cap to the model ceiling', () => {
        const model = BUILTIN_MODELS.find(entry => entry.alias === 'claude-opus-4.8');
        expect(model).toBeDefined();
        // Tier 1 clamps Opus output to the tier cap (16000) — below the
        // 128k model/provider ceiling reachable via forceMaxOutputCeiling.
        const clamped = computeCaps({
            provider: 'anthropic',
            model: model!,
            accessTier: 1,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'max' }
        });
        // The ceiling override (truncation retry) ignores the tier clamp.
        const ceiling = computeCaps({
            provider: 'anthropic',
            model: model!,
            accessTier: 1,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'max', forceMaxOutputCeiling: true }
        });
        expect(clamped.maxOutputTokens).toBe(16000);
        expect(ceiling.maxOutputTokens).toBe(128000);
        expect(ceiling.maxOutputTokens).toBeGreaterThan(clamped.maxOutputTokens);
    });

    it('uses deeper reasoning defaults for inquiry when requested', () => {
        const model = BUILTIN_MODELS.find(entry => entry.alias === 'gpt-5.5');
        expect(model).toBeDefined();
        const standard = computeCaps({
            provider: 'openai',
            model: model!,
            accessTier: 2,
            feature: 'InquiryMode',
            overrides: { reasoningDepth: 'standard' }
        });
        const deep = computeCaps({
            provider: 'openai',
            model: model!,
            accessTier: 2,
            feature: 'InquiryMode',
            overrides: { reasoningDepth: 'deep' }
        });
        expect(deep.temperature).toBeLessThanOrEqual(standard.temperature);
    });

    it('uses expanded OpenAI GPT-5.4 output ceilings', () => {
        const model = BUILTIN_MODELS.find(entry => entry.alias === 'gpt-5.5');
        expect(model).toBeDefined();
        const tier1 = computeCaps({
            provider: 'openai',
            model: model!,
            accessTier: 1,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'max' }
        });
        const tier3 = computeCaps({
            provider: 'openai',
            model: model!,
            accessTier: 3,
            feature: 'InquiryMode',
            overrides: { maxOutputMode: 'max' }
        });
        expect(tier3.maxOutputTokens).toBeGreaterThan(tier1.maxOutputTokens);
        expect(tier3.maxOutputTokens).toBe(128000);
    });
});
