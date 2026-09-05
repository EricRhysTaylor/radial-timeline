import { describe, expect, it } from 'vitest';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { computeRecommendedPicks, getAvailabilityIconName } from './recommendations';
import type { MergedModelInfo } from './mergeModels';

function makeMergedModel(overrides: Partial<MergedModelInfo>): MergedModelInfo {
    return {
        provider: 'openai',
        id: 'model-default',
        alias: 'model-default',
        label: 'Model Default',
        tier: 'BALANCED',
        capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
        personality: { reasoning: 8, writing: 8, determinism: 8 },
        contextWindow: 128000,
        maxOutput: 8192,
        status: 'stable',
        availableToKey: true,
        availabilityStatus: 'visible',
        providerModelId: 'model-default',
        ...overrides
    };
}

describe('computeRecommendedPicks', () => {
    it('returns Inquiry, Gossamer Momentum, and General use rows when eligible models exist', () => {
        const aiSettings = buildDefaultAiSettings();
        aiSettings.provider = 'openai';
        const models: MergedModelInfo[] = [
            makeMergedModel({
                id: 'openai-fast',
                alias: 'openai-fast',
                label: 'OpenAI Fast',
                tier: 'FAST',
                capabilities: ['jsonStrict'],
                contextWindow: 32000,
                maxOutput: 2048,
                personality: { reasoning: 5, writing: 5, determinism: 9 }
            }),
            makeMergedModel({
                id: 'openai-deep',
                alias: 'openai-deep',
                label: 'OpenAI Deep',
                tier: 'DEEP',
                capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
                contextWindow: 200000,
                maxOutput: 16384,
                personality: { reasoning: 9, writing: 9, determinism: 8 }
            })
        ];

        const picks = computeRecommendedPicks({ models, aiSettings, includeLocalPrivate: false });
        expect(picks.map(pick => pick.title)).toEqual([
            'Inquiry',
            'Gossamer Momentum',
            'General use'
        ]);
    });

    it('selects the only model that satisfies the capability floor', () => {
        const aiSettings = buildDefaultAiSettings();
        aiSettings.provider = 'openai';
        const models: MergedModelInfo[] = [
            makeMergedModel({
                id: 'openai-fast',
                alias: 'openai-fast',
                tier: 'FAST',
                capabilities: ['jsonStrict'],
                contextWindow: 32000,
                maxOutput: 1024
            }),
            makeMergedModel({
                id: 'openai-structural',
                alias: 'openai-structural',
                tier: 'DEEP',
                capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
                contextWindow: 200000,
                maxOutput: 16384
            })
        ];

        const picks = computeRecommendedPicks({ models, aiSettings, includeLocalPrivate: false });
        const inquiry = picks.find(pick => pick.id === 'inquiry');
        expect(inquiry?.model?.alias).toBe('openai-structural');
    });

    it('keeps recommendation availability status for visible/not-visible/unknown states', () => {
        const aiSettings = buildDefaultAiSettings();
        aiSettings.provider = 'openai';
        const openAiModel = makeMergedModel({
            id: 'openai-not-visible',
            alias: 'openai-not-visible',
            availabilityStatus: 'not_visible',
            availableToKey: false
        });
        const localModel = makeMergedModel({
            provider: 'ollama',
            id: 'ollama-local',
            alias: 'ollama-local',
            label: 'Ollama Local',
            tier: 'LOCAL',
            availabilityStatus: 'unknown',
            availableToKey: false,
            providerModelId: 'ollama-local',
            capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap']
        });

        const picks = computeRecommendedPicks({
            models: [openAiModel, localModel],
            aiSettings,
            includeLocalPrivate: true
        });

        expect(picks.find(pick => pick.id === 'inquiry')?.availabilityStatus).toBe('not_visible');
        expect(picks.find(pick => pick.id === 'local')?.availabilityStatus).toBe('unknown');
        expect(getAvailabilityIconName('not_visible')).toBe('alert-triangle');
        expect(getAvailabilityIconName('unknown')).toBe('help-circle');
    });

    it('maps factual why text for each intent within the compact word bound', () => {
        const aiSettings = buildDefaultAiSettings();
        aiSettings.provider = 'openai';
        const openAiModel = makeMergedModel({
            id: 'openai-strong',
            alias: 'openai-strong',
            tier: 'DEEP',
            capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
            personality: { reasoning: 9, writing: 9, determinism: 9 }
        });
        const localModel = makeMergedModel({
            provider: 'ollama',
            id: 'ollama-local',
            alias: 'ollama-local',
            label: 'Ollama Local',
            tier: 'LOCAL',
            availabilityStatus: 'unknown',
            availableToKey: false,
            providerModelId: 'ollama-local',
            capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap']
        });

        const picks = computeRecommendedPicks({
            models: [openAiModel, localModel],
            aiSettings,
            includeLocalPrivate: true
        });

        expect(picks.map(pick => pick.id)).toEqual(['inquiry', 'gossamer', 'quick', 'local']);
        picks.forEach(pick => {
            const words = pick.shortReason.trim().split(/\s+/).filter(Boolean).length;
            expect(pick.shortReason.length).toBeGreaterThan(0);
            expect(words).toBeGreaterThanOrEqual(8);
            expect(words).toBeLessThanOrEqual(14);
        });
    });

    it('differentiates inquiry/gossamer/quick picks when provider offers deep, balanced, and fast options', () => {
        const aiSettings = buildDefaultAiSettings();
        aiSettings.provider = 'openai';
        const models: MergedModelInfo[] = [
            makeMergedModel({
                id: 'openai-deep',
                alias: 'openai-deep',
                label: 'OpenAI Deep',
                tier: 'DEEP',
                capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
                contextWindow: 400000,
                maxOutput: 16000,
                personality: { reasoning: 10, writing: 9, determinism: 9 }
            }),
            makeMergedModel({
                id: 'openai-balanced',
                alias: 'openai-balanced',
                label: 'OpenAI Balanced',
                tier: 'BALANCED',
                capabilities: ['jsonStrict', 'longContext', 'reasoningStrong', 'highOutputCap'],
                contextWindow: 200000,
                maxOutput: 8000,
                personality: { reasoning: 8, writing: 10, determinism: 9 }
            }),
            makeMergedModel({
                id: 'openai-fast',
                alias: 'openai-fast',
                label: 'OpenAI Fast',
                tier: 'FAST',
                capabilities: ['jsonStrict'],
                contextWindow: 32000,
                maxOutput: 2000,
                personality: { reasoning: 6, writing: 6, determinism: 10 }
            })
        ];

        const picks = computeRecommendedPicks({ models, aiSettings, includeLocalPrivate: false });
        expect(picks.find(pick => pick.id === 'inquiry')?.model?.alias).toBe('openai-deep');
        expect(picks.find(pick => pick.id === 'gossamer')?.model?.alias).toBe('openai-deep');
        expect(picks.find(pick => pick.id === 'quick')?.model?.alias).toBe('openai-deep');
    });
});
