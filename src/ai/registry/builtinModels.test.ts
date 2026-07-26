import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from './builtinModels';

function byAlias(alias: string) {
    const model = BUILTIN_MODELS.find(entry => entry.alias === alias);
    expect(model).toBeDefined();
    return model!;
}

/*
 * Catalog-shape tests for the minimum-viable model catalog (2026-05-22).
 *
 * Each surviving model is pinned by:
 *  - identity (alias / id present in BUILTIN_MODELS)
 *  - context window + maxOutput (the values the runtime depends on)
 *  - declared status (stable / preview / legacy)
 *  - any provider-specific constraints (request profile, lane)
 *
 * Add a similar block for every new model promoted under the deliberate
 * quarterly process in docs/engineering/standards/model-promotion.md.
 */

describe('BUILTIN_MODELS — OpenAI GPT-5.5', () => {
    it('exposes a 1.05M context / 128k output window', () => {
        const model = byAlias('gpt-5.5');
        expect(model.id).toBe('gpt-5.5');
        expect(model.contextWindow).toBe(1050000);
        expect(model.maxOutput).toBe(128000);
        expect(model.status).toBe('stable');
    });

    it('captures GPT-5.5 request-shape constraints in the model contract', () => {
        const model = byAlias('gpt-5.5');
        expect(model.constraints).toMatchObject({
            supportsTemperature: false,
            supportsTopP: false,
            supportsReasoningEffort: true,
            preferredOpenAiEndpoint: 'responses'
        });
    });

    it('declares the structured-output capability', () => {
        expect(byAlias('gpt-5.5').capabilities).toContain('jsonStrict');
    });
});

describe('BUILTIN_MODELS — Anthropic Claude Opus 5', () => {
    it('exposes a 1M context / 128k output window on the stable channel', () => {
        const model = byAlias('claude-opus-5');
        expect(model.id).toBe('claude-opus-5');
        expect(model.line).toBe('claude-opus');
        expect(model.contextWindow).toBe(1000000);
        expect(model.maxOutput).toBe(128000);
        expect(model.status).toBe('stable');
        expect(model.tier).toBe('DEEP');
        expect(model.rollout?.channel).toBe('stable');
    });

    it('captures the Opus 5 request-shape constraints (managed sampling, adaptive-only, thinking on by default)', () => {
        const model = byAlias('claude-opus-5');
        expect(model.constraints).toMatchObject({
            supportsTemperature: false,
            supportsTopP: false,
            supportsAdaptiveThinking: true,
            thinkingDefaultsOn: true
        });
        // Opus 5 is configurable-thinking, NOT always-on: the forced-tool
        // structured path stays valid (with an explicit disabled shape).
        expect(model.constraints?.thinkingAlwaysOn).toBeUndefined();
    });
});

describe('BUILTIN_MODELS — Anthropic Claude Opus 4.8 (continuity)', () => {
    it('exposes a 1M context / 128k output window', () => {
        const model = byAlias('claude-opus-4.8');
        expect(model.id).toBe('claude-opus-4-8');
        expect(model.contextWindow).toBe(1000000);
        expect(model.maxOutput).toBe(128000);
        expect(model.status).toBe('stable');
        expect(model.tier).toBe('DEEP');
    });
});

describe('BUILTIN_MODELS — Anthropic Claude Fable 5', () => {
    it('exposes a 1M context / 128k output window on its own line', () => {
        const model = byAlias('claude-fable-5');
        expect(model.id).toBe('claude-fable-5');
        expect(model.line).toBe('claude-fable');
        expect(model.contextWindow).toBe(1000000);
        expect(model.maxOutput).toBe(128000);
        expect(model.status).toBe('stable');
        expect(model.tier).toBe('DEEP');
    });

    it('declares always-on thinking and sits off the stable channel (explicit-choice only)', () => {
        const model = byAlias('claude-fable-5');
        expect(model.constraints).toMatchObject({
            supportsTemperature: false,
            supportsTopP: false,
            supportsAdaptiveThinking: true,
            thinkingAlwaysOn: true
        });
        // Keeps latest-stable auto-selection resolving to Opus 4.8.
        expect(model.rollout?.channel).toBe('pro');
    });
});

describe('BUILTIN_MODELS — Google Gemini', () => {
    it('declares Gemini 3.1 Pro Preview as the depth lane', () => {
        const model = byAlias('gemini-3.1-pro-preview');
        expect(model.status).toBe('preview');
        expect(model.tier).toBe('DEEP');
        expect(model.contextWindow).toBe(1048576);
        expect(model.maxOutput).toBe(65536);
        expect(model.constraints?.cacheVsCitationsExclusive).toBe(true);
    });

    it('declares Gemini 3.5 Flash as the stable/speed lane', () => {
        const model = byAlias('gemini-3.5-flash');
        expect(model.status).toBe('stable');
        expect(model.tier).toBe('FAST');
        expect(model.contextWindow).toBe(1048576);
        expect(model.maxOutput).toBe(65536);
        expect(model.constraints?.cacheVsCitationsExclusive).toBe(true);
    });
});

describe('BUILTIN_MODELS — catalog policy invariants', () => {
    it('keeps the catalog small enough to be deliberately curated (one top model per provider, plus deliberate splits)', () => {
        const cloud = BUILTIN_MODELS.filter(m => m.provider !== 'none' && m.provider !== 'ollama');
        // Anthropic 3 (Opus 5 + 4.8 continuity + Fable 5 premium pro lane)
        // + OpenAI 2 (5.5 + 5.4 economy) + Google 2 (3.1 Pro depth / 3.5 Flash
        // speed) = 7 cloud models. Fable 5 was promoted under the deliberate
        // process in docs/engineering/standards/model-promotion.md as an
        // explicit-choice premium model (2× Opus cost), NOT an auto-default.
        // If this assertion fails because a model was added, confirm the
        // addition followed that promotion process before updating this
        // expectation.
        expect(cloud.length).toBeLessThanOrEqual(7);
    });

    it('does not curate experimental "*-pro" OpenAI lanes here (they would come via remote drift if needed)', () => {
        expect(BUILTIN_MODELS.some(entry => entry.alias === 'gpt-5.5-pro')).toBe(false);
    });

    it('every cloud model carries a contextWindow and maxOutput', () => {
        for (const model of BUILTIN_MODELS) {
            if (model.provider === 'none') continue;
            expect(typeof model.contextWindow, model.id).toBe('number');
            expect(model.contextWindow, model.id).toBeGreaterThan(0);
            expect(typeof model.maxOutput, model.id).toBe('number');
            expect(model.maxOutput, model.id).toBeGreaterThan(0);
        }
    });
});
