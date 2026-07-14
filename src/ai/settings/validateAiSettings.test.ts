import { describe, expect, it } from 'vitest';
import { validateAiSettings } from './validateAiSettings';
import type { AiSettingsV1 } from '../types';
import { ANTHROPIC_REQUESTED_CACHE_TTL } from './aiSettings';

describe('validateAiSettings', () => {
    it('falls back invalid provider and bad pinned alias', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'bad-provider' as any,
            modelPolicy: { type: 'pinned', pinnedAlias: 'missing' },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false }
        } as any);

        expect(result.value.provider).toBe('ollama');
        expect(result.value.modelPolicy.type).toBe('latestStable');
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('normalizes tiers and override bounds', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'openai',
            modelPolicy: { type: 'latestStable' },
            overrides: { temperature: 99, topP: 99, maxOutputMode: 'bad' as any },
            aiAccessProfile: { openaiTier: 99 as any },
            privacy: { allowTelemetry: false, allowProviderSnapshot: false }
        } as any);

        expect(result.value.overrides.temperature).toBe(2);
        expect(result.value.overrides.topP).toBe(1);
        expect(result.value.overrides.maxOutputMode).toBe('auto');
        expect(result.value.aiAccessProfile.openaiTier).toBe(1);
    });

    it('accepts tier 4 in access profile', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'openai',
            modelPolicy: { type: 'latestStable' },
            overrides: {},
            aiAccessProfile: { openaiTier: 4 },
            privacy: { allowTelemetry: false, allowProviderSnapshot: false }
        } as unknown as AiSettingsV1);

        expect(result.value.aiAccessProfile.openaiTier).toBe(4);
    });

    it('strips legacy raw credential fields and keeps secret-id credentials only', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'openai',
            modelPolicy: { type: 'latestStable' },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false },
            credentials: {
                openaiApiKey: 'raw-key-should-not-persist',
                openaiSecretId: 'rt.openai.api-key'
            } as any
        } as any);

        expect((result.value.credentials as any).openaiApiKey).toBeUndefined();
        expect(result.value.credentials?.openaiSecretId).toBe('rt.openai.api-key');
    });

    it('falls back invalid model policy type to latestStable', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'openai',
            modelPolicy: { type: 'manual' as unknown as AiSettingsV1['modelPolicy']['type'] },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false }
        } as unknown as AiSettingsV1);

        expect(result.value.modelPolicy.type).toBe('latestStable');
        expect(result.warnings.some(warning => warning.includes('Unknown model policy'))).toBe(true);
    });

    it('accepts latestPro model policy', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'openai',
            modelPolicy: { type: 'latestPro' },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false }
        } as unknown as AiSettingsV1);

        expect(result.value.modelPolicy.type).toBe('latestPro');
    });

    it('normalizes canonical localLlm settings', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'ollama',
            modelPolicy: { type: 'latestStable' },
            localLlm: {
                enabled: true,
                configurationMode: 'invalid-mode' as any,
                backend: 'unknown-backend' as any,
                baseUrl: '   ',
                defaultModelId: '',
                timeoutMs: 999999,
                maxRetries: -2,
                jsonMode: 'bad-mode' as any
            },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false }
        } as unknown as AiSettingsV1);

        expect(result.value.localLlm.backend).toBe('ollama');
        expect(result.value.localLlm.configurationMode).toBe('auto');
        expect(result.value.localLlm.baseUrl).toBe('http://localhost:11434/v1');
        expect(result.value.localLlm.defaultModelId).toBeTruthy();
        expect(result.value.localLlm.timeoutMs).toBeLessThanOrEqual(120000);
        expect(result.value.localLlm.maxRetries).toBe(0);
        expect(result.value.localLlm.jsonMode).toBe('response_format');
    });

    it('ignores persisted Anthropic cache ttl overrides and forces the canonical 1h request ttl', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'anthropic',
            modelPolicy: { type: 'latestStable' },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false },
            cacheWindows: {
                anthropicTtl: '5m',
                googleTtlSeconds: 900,
                openaiRetention: '24h',
                openaiInMemoryWindowMinutes: 60
            }
        } as unknown as AiSettingsV1);

        expect(result.value.cacheWindows?.anthropicTtl).toBe(ANTHROPIC_REQUESTED_CACHE_TTL);
        expect(result.warnings.some(warning => warning.includes('Anthropic cache TTL is fixed at'))).toBe(true);
    });

    it('upgrades persisted OpenAI in-memory retention to the canonical 24h window', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'openai',
            modelPolicy: { type: 'latestStable' },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false },
            cacheWindows: {
                anthropicTtl: '1h',
                googleTtlSeconds: 900,
                openaiRetention: 'in_memory',
                openaiInMemoryWindowMinutes: 10
            }
        } as unknown as AiSettingsV1);

        expect(result.value.cacheWindows?.openaiRetention).toBe('24h');
        expect(result.warnings.some(warning => warning.includes('OpenAI cache retention now defaults to 24h'))).toBe(true);
    });

    it('caps persisted Gemini explicit cache windows to the short session default', () => {
        const result = validateAiSettings({
            schemaVersion: 1,
            provider: 'google',
            modelPolicy: { type: 'latestStable' },
            overrides: {},
            aiAccessProfile: {},
            privacy: { allowTelemetry: false, allowProviderSnapshot: false },
            cacheWindows: {
                anthropicTtl: '1h',
                googleTtlSeconds: 86_400,
                openaiRetention: '24h',
                openaiInMemoryWindowMinutes: 60
            }
        } as unknown as AiSettingsV1);

        expect(result.value.cacheWindows?.googleTtlSeconds).toBe(900);
    });
});
