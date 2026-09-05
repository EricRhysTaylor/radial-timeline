import { describe, expect, it } from 'vitest';
import { selectModel } from './selectModel';
import { BUILTIN_MODELS } from '../registry/builtinModels';

describe('selectModel', () => {
    it('returns pinned alias when eligible', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'anthropic',
            policy: { type: 'pinned', pinnedAlias: 'claude-opus-4.8' },
            requiredCapabilities: ['longContext', 'jsonStrict']
        });
        expect(result.model.alias).toBe('claude-opus-4.8');
        expect(result.warnings.length).toBe(0);
    });

    it('falls back with warning when pinned alias is missing', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'pinned', pinnedAlias: 'missing-alias' },
            requiredCapabilities: ['jsonStrict']
        });
        expect(result.model.provider).toBe('openai');
        expect(result.warnings.some(w => w.includes('missing-alias'))).toBe(true);
    });

    it('auto policy chooses the latest stable Anthropic model', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'anthropic',
            policy: { type: 'latestStable' },
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong']
        });
        expect(result.model.alias).toBe('claude-opus-5');
    });

    it('does NOT auto-default to Claude Fable 5 (2× Opus cost — explicit choice only)', () => {
        // Fable 5 sits on the 'pro' rollout channel, so latest-stable
        // resolution (which reads channel === 'stable') must keep resolving
        // to Opus 5 for every capability-based feature
        // (Pulse/Gossamer/Inquiry). This is the cost guard: Fable costs 2× Opus.
        const fable = BUILTIN_MODELS.find(m => m.id === 'claude-fable-5-1');
        expect(fable, 'Claude Fable 5.1 must be in the registry').toBeTruthy();
        expect(fable?.rollout?.channel).not.toBe('stable');

        const deepCaps = ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'] as const;
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'anthropic',
            policy: { type: 'latestStable' },
            requiredCapabilities: [...deepCaps]
        });
        expect(result.model.alias).toBe('claude-opus-5');
        expect(result.model.id).not.toBe('claude-fable-5-1');
    });

    it('selects Claude Fable 5 only when explicitly pinned', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'anthropic',
            policy: { type: 'pinned', pinnedAlias: 'claude-fable-5-1' },
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap']
        });
        expect(result.model.id).toBe('claude-fable-5-1');
        expect(result.warnings.length).toBe(0);
    });

    it('resolves an OpenAI model for high-output Inquiry requirements', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'latestStable' },
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
            contextTokensNeeded: 24000,
            outputTokensNeeded: 2000
        });
        expect(result.model.provider).toBe('openai');
        expect(result.model.alias).toBe('gpt-5.6-sol');
        expect(result.model.capabilities.includes('highOutputCap')).toBe(true);
    });

    it('routes OpenAI latestPro JSON workflows to the stable lane (schema-required guard)', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'latestPro' },
            requiredCapabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap']
        });
        expect(result.model.alias).toBe('gpt-5.6-sol');
        expect(result.warnings).toContain('OpenAI pro auto-selection is disabled for schema-required workflows; fallback to latest stable.');
    });

    it('keeps OpenAI latestPro available for non-schema workflows', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'latestPro' },
            requiredCapabilities: ['longContext', 'reasoningStrong', 'highOutputCap']
        });
        expect(result.model.alias).toBe('gpt-5.6-sol');
    });

    it('keeps pinned GPT-5.6 Sol selection when explicitly requested', () => {
        const result = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'pinned', pinnedAlias: 'gpt-5.6-sol' },
            requiredCapabilities: ['jsonStrict']
        });
        expect(result.model.alias).toBe('gpt-5.6-sol');
    });

    it('ignores access tier for OpenAI latestStable resolution', () => {
        const tier1 = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'latestStable' },
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
            accessTier: 1
        });
        const tier4 = selectModel(BUILTIN_MODELS, {
            provider: 'openai',
            policy: { type: 'latestStable' },
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
            accessTier: 4
        });
        expect(tier1.model.alias).toBe('gpt-5.6-sol');
        expect(tier4.model.alias).toBe('gpt-5.6-sol');
    });
});
