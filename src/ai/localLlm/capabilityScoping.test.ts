import { describe, expect, it } from 'vitest';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import { getLocalLlmSettings, withDeclaredCapabilitiesForActiveModel } from './settings';
import { buildLocalLlmModelIdentity } from './identity';
import { chunkBudgetFor } from '../../services/ConceptSearchService';
import type { AiSettingsV1 } from '../types';

/**
 * A capability declaration is a claim about ONE model on ONE server.
 * ConceptSearchService.chunkBudgetFor() doubles the per-chunk input budget when
 * `longContext` is declared, so a declaration that survives a model change makes
 * RT send prompts a smaller model cannot hold. These exercise the scoping that
 * prevents that, rather than asserting source strings.
 */

const settingsFor = (backend: 'ollama' | 'lmStudio' | 'openaiCompatible', baseUrl: string, modelId: string): AiSettingsV1 => {
    const base = buildDefaultAiSettings();
    base.localLlm = { ...base.localLlm, backend, baseUrl, defaultModelId: modelId };
    return base;
};

describe('local LLM capability scoping', () => {
    it('does not carry a declaration onto a different model', () => {
        let ai = settingsFor('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        ai.localLlm = withDeclaredCapabilitiesForActiveModel(getLocalLlmSettings(ai), ['longContext']);
        expect(getLocalLlmSettings(ai).declaredCapabilities).toEqual(['longContext']);

        // Same server, different model — the claim was never made about this one.
        ai = { ...ai, localLlm: { ...ai.localLlm, defaultModelId: 'small-3b' } };
        expect(getLocalLlmSettings(ai).declaredCapabilities).toEqual([]);
    });

    it('does not carry a declaration onto a different server', () => {
        const ai = settingsFor('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        ai.localLlm = withDeclaredCapabilitiesForActiveModel(getLocalLlmSettings(ai), ['longContext']);
        const moved = { ...ai, localLlm: { ...ai.localLlm, baseUrl: 'http://localhost:1234/v1' } };
        expect(getLocalLlmSettings(moved).declaredCapabilities).toEqual([]);
    });

    it('restores the original declaration when the author switches back', () => {
        const ai = settingsFor('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        ai.localLlm = withDeclaredCapabilitiesForActiveModel(getLocalLlmSettings(ai), ['longContext', 'reasoningStrong']);
        const away = { ...ai, localLlm: { ...ai.localLlm, defaultModelId: 'small-3b' } };
        expect(getLocalLlmSettings(away).declaredCapabilities).toEqual([]);
        const back = { ...away, localLlm: { ...away.localLlm, defaultModelId: 'big-80b' } };
        expect(getLocalLlmSettings(back).declaredCapabilities).toEqual(['reasoningStrong', 'longContext']);
    });

    it('keeps ConceptSearch on the small budget after a model change', () => {
        const ai = settingsFor('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        ai.localLlm = withDeclaredCapabilitiesForActiveModel(getLocalLlmSettings(ai), ['longContext']);
        const wide = chunkBudgetFor(getLocalLlmSettings(ai));

        const switched = { ...ai, localLlm: { ...ai.localLlm, defaultModelId: 'small-3b' } };
        const narrow = chunkBudgetFor(getLocalLlmSettings(switched));

        expect(wide).toBeGreaterThan(narrow);
    });

    it('migrates a pre-scoping vault onto the model that was selected', () => {
        // Saved before scoping existed: declarations present, no map. They were made
        // for whatever was selected then, so they are adopted for that identity.
        const legacy = buildDefaultAiSettings();
        legacy.localLlm = {
            ...legacy.localLlm,
            backend: 'openaiCompatible',
            baseUrl: 'http://localhost:8080/v1',
            defaultModelId: 'legacy-model',
            declaredCapabilities: ['longContext', 'reasoningStrong']
        };
        delete (legacy.localLlm as Partial<AiSettingsV1['localLlm']>).capabilitiesByModel;

        const validated = validateAiSettings(legacy).value;
        const identity = buildLocalLlmModelIdentity('openaiCompatible', 'http://localhost:8080/v1', 'legacy-model');
        expect(validated.localLlm.capabilitiesByModel[identity]).toEqual(['reasoningStrong', 'longContext']);
        expect(getLocalLlmSettings(validated).declaredCapabilities).toEqual(['reasoningStrong', 'longContext']);

        // ...and the migrated claim still does not leak to another model.
        const other = { ...validated, localLlm: { ...validated.localLlm, defaultModelId: 'other-model' } };
        expect(getLocalLlmSettings(other).declaredCapabilities).toEqual([]);
    });

    it('discards malformed map entries rather than trusting them', () => {
        const ai = settingsFor('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        const identity = buildLocalLlmModelIdentity('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        ai.localLlm = {
            ...ai.localLlm,
            capabilitiesByModel: {
                [identity]: ['longContext', 'notARealCapability'] as never,
                'bogus-identity': 'not-an-array' as never
            }
        };
        const validated = validateAiSettings(ai).value;
        expect(validated.localLlm.capabilitiesByModel[identity]).toEqual(['longContext']);
        expect(validated.localLlm.capabilitiesByModel['bogus-identity']).toBeUndefined();
    });
});
