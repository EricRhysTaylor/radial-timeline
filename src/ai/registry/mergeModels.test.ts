import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from './builtinModels';
import { mergeCuratedWithSnapshot, formatAvailabilityLabel } from './mergeModels';
import { selectModel } from '../router/selectModel';
import type { ModelInfo, ProviderSnapshotPayload } from '../types';

describe('mergeCuratedWithSnapshot', () => {
    it('does not overwrite curated capabilities, tier, or personality', () => {
        const curated: ModelInfo[] = [{
            provider: 'openai',
            id: 'gpt-x',
            alias: 'gpt-x',
            label: 'GPT X',
            tier: 'DEEP',
            capabilities: ['jsonStrict', 'longContext'],
            personality: { reasoning: 9, writing: 8, determinism: 7 },
            contextWindow: 100000,
            maxOutput: 4000,
            status: 'stable'
        }];
        const snapshot: ProviderSnapshotPayload = {
            generatedAt: new Date().toISOString(),
            summary: { openai: 1, anthropic: 0, google: 0 },
            models: [{
                provider: 'openai',
                id: 'gpt-x',
                label: 'Renamed GPT X',
                createdAt: '2026-01-01T00:00:00.000Z',
                inputTokenLimit: 128000,
                outputTokenLimit: 8192,
                raw: { id: 'gpt-x' }
            }]
        };

        const merged = mergeCuratedWithSnapshot(curated, snapshot);
        expect(merged[0].capabilities).toEqual(['jsonStrict', 'longContext']);
        expect(merged[0].tier).toBe('DEEP');
        expect(merged[0].personality.reasoning).toBe(9);
    });

    it('computes availability by provider+id match', () => {
        // Build a 2-entry curated set spanning providers so we can assert
        // both the "visible" and "not_visible" branches in a single run,
        // independent of how many models any one provider currently has.
        const curated = [
            BUILTIN_MODELS.find(m => m.provider === 'openai')!,
            BUILTIN_MODELS.find(m => m.provider === 'anthropic')!,
        ];
        const snapshot: ProviderSnapshotPayload = {
            generatedAt: new Date().toISOString(),
            summary: { openai: 1, anthropic: 0, google: 0 },
            models: [{
                provider: 'openai',
                id: curated[0].id,
                raw: { id: curated[0].id }
            }]
        };
        const merged = mergeCuratedWithSnapshot(curated, snapshot);
        expect(merged[0].availableToKey).toBe(true);
        expect(merged[0].availabilityStatus).toBe('visible');
        expect(merged[1].availableToKey).toBe(false);
        expect(merged[1].availabilityStatus).toBe('not_visible');
    });

    it('computes capsMismatch for display only and does not change selection behavior', () => {
        const curated = BUILTIN_MODELS.filter(model => model.provider === 'openai');
        const snapshot: ProviderSnapshotPayload = {
            generatedAt: new Date().toISOString(),
            summary: { openai: curated.length, anthropic: 0, google: 0 },
            models: curated.map(model => ({
                provider: 'openai' as const,
                id: model.id,
                inputTokenLimit: model.contextWindow + 1,
                outputTokenLimit: model.maxOutput + 1,
                raw: { id: model.id }
            }))
        };
        const merged = mergeCuratedWithSnapshot(curated, snapshot);
        expect(merged.some(model => !!model.capsMismatch)).toBe(true);

        const request = {
            provider: 'openai' as const,
            policy: { type: 'latestStable' as const },
            requiredCapabilities: ['jsonStrict'] as const,
            accessTier: 1 as const,
            contextTokensNeeded: 1000,
            outputTokensNeeded: 100
        };
        const curatedSelected = selectModel(curated, request).model.alias;
        const mergedSelected = selectModel(merged, request).model.alias;
        expect(mergedSelected).toBe(curatedSelected);
    });

    it('returns Unknown availability label when snapshot is missing', () => {
        const merged = mergeCuratedWithSnapshot([BUILTIN_MODELS[0]], null);
        expect(merged[0].availabilityStatus).toBe('unknown');
        expect(formatAvailabilityLabel('unknown')).toContain('Unknown');
    });
});
