import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';
import { buildDefaultAiSettings } from '../../ai/settings/aiSettings';
import { resolveInquiryEngine } from './inquiryModelResolver';

describe('resolveInquiryEngine', () => {
    it('resolves Anthropic latestStable to the current Opus', () => {
        const plugin = {
            settings: {
                aiSettings: {
                    ...buildDefaultAiSettings(),
                    provider: 'anthropic',
                    modelPolicy: { type: 'latestStable' },
                    credentials: {
                        ...buildDefaultAiSettings().credentials,
                        anthropicSecretId: 'rt.anthropic.test'
                    }
                }
            },
            credentialPresence: { anthropic: true }
        } as any;

        const resolved = resolveInquiryEngine(plugin, BUILTIN_MODELS);

        expect(resolved.provider).toBe('anthropic');
        expect(resolved.blocked).toBeUndefined();
        expect(resolved.modelId).toBe('claude-opus-5');
        expect(resolved.modelAlias).toBe('claude-opus-5');
    });

    it('resolves pinned Anthropic Opus 4.8 (continuity) when explicitly selected', () => {
        const plugin = {
            settings: {
                aiSettings: {
                    ...buildDefaultAiSettings(),
                    provider: 'anthropic',
                    modelPolicy: { type: 'pinned', pinnedAlias: 'claude-opus-4.8' },
                    credentials: {
                        ...buildDefaultAiSettings().credentials,
                        anthropicSecretId: 'rt.anthropic.test'
                    }
                }
            },
            credentialPresence: { anthropic: true }
        } as any;

        const resolved = resolveInquiryEngine(plugin, BUILTIN_MODELS);

        expect(resolved.provider).toBe('anthropic');
        expect(resolved.blocked).toBeUndefined();
        expect(resolved.modelId).toBe('claude-opus-4-8');
        expect(resolved.modelAlias).toBe('claude-opus-4.8');
    });

    it('does not fall back to legacy provider fields when canonical AI settings disable AI', () => {
        const plugin = {
            settings: {
                aiSettings: {
                    ...buildDefaultAiSettings(),
                    provider: 'none'
                },
                defaultAiProvider: 'openai',
                openaiModelId: 'gpt-5.5'
            }
        } as any;

        const resolved = resolveInquiryEngine(plugin, BUILTIN_MODELS);

        expect(resolved.provider).toBe('none');
        expect(resolved.blocked).toBe(true);
        expect(resolved.policySource).toBe('disabled');
        expect(resolved.modelId).toBe('');
    });

    it('fails closed when the canonical provider is not configured', () => {
        const plugin = {
            settings: {
                aiSettings: {
                    ...buildDefaultAiSettings(),
                    provider: 'ollama',
                    localLlm: {
                        ...buildDefaultAiSettings().localLlm,
                        enabled: false
                    }
                }
            }
        } as any;

        const resolved = resolveInquiryEngine(plugin, BUILTIN_MODELS);

        expect(resolved.provider).toBe('ollama');
        expect(resolved.hasCredential).toBe(false);
        expect(resolved.blocked).toBe(true);
        expect(resolved.blockReason).toContain('Local LLM');
    });

    it('fails closed when canonical AI settings contain an invalid provider id', () => {
        const plugin = {
            settings: {
                aiSettings: {
                    ...buildDefaultAiSettings(),
                    provider: 'legacy-openai'
                }
            }
        } as any;

        const resolved = resolveInquiryEngine(plugin, BUILTIN_MODELS);

        expect(resolved.provider).toBe('none');
        expect(resolved.hasCredential).toBe(false);
        expect(resolved.blocked).toBe(true);
        expect(resolved.blockReason).toContain('invalid provider');
    });
});
