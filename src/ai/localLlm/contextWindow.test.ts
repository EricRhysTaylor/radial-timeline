import { describe, expect, it } from 'vitest';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import { computeCaps } from '../caps/computeCaps';
import { getLocalLlmSettings, resolveLocalLlmModelInfo, withContextWindowForActiveModel } from './settings';
import { buildLocalLlmModelIdentity } from './identity';
import type { AiSettingsV1 } from '../types';

/**
 * Local servers don't report the context window they run with, so the author
 * declares it per model. These check the declaration reaches request planning
 * and stays with the model it was made for.
 */

const settingsFor = (modelId: string): AiSettingsV1 => {
    const base = buildDefaultAiSettings();
    base.localLlm = { ...base.localLlm, backend: 'openaiCompatible', baseUrl: 'http://localhost:8080/v1', defaultModelId: modelId };
    return base;
};

describe('local LLM context window', () => {
    it('defaults to the registry 32k window', () => {
        expect(resolveLocalLlmModelInfo(settingsFor('big-80b')).contextWindow).toBe(32000);
    });

    it('uses the declared window for the active model, and planning follows it', () => {
        const ai = settingsFor('big-80b');
        ai.localLlm = withContextWindowForActiveModel(getLocalLlmSettings(ai), 200000);
        const model = resolveLocalLlmModelInfo(ai);
        expect(model.contextWindow).toBe(200000);

        const caps = computeCaps({ provider: 'ollama', model, accessTier: 4, feature: 'InquiryMode' } as Parameters<typeof computeCaps>[0]);
        expect(caps.maxInputTokens).toBeGreaterThan(100000);
    });

    it('does not carry a declared window onto a different model', () => {
        const ai = settingsFor('big-80b');
        ai.localLlm = withContextWindowForActiveModel(getLocalLlmSettings(ai), 200000);
        const other = { ...ai, localLlm: { ...ai.localLlm, defaultModelId: 'small-3b' } };
        expect(resolveLocalLlmModelInfo(other).contextWindow).toBe(32000);
    });

    it('clears back to the default', () => {
        const ai = settingsFor('big-80b');
        ai.localLlm = withContextWindowForActiveModel(getLocalLlmSettings(ai), 200000);
        ai.localLlm = withContextWindowForActiveModel(getLocalLlmSettings(ai), null);
        expect(resolveLocalLlmModelInfo(ai).contextWindow).toBe(32000);
    });

    it('drops invalid stored values on validation', () => {
        const ai = settingsFor('big-80b');
        const identity = buildLocalLlmModelIdentity('openaiCompatible', 'http://localhost:8080/v1', 'big-80b');
        ai.localLlm.contextWindowByModel = { [identity]: 512, other: 1.5, ok: 65536 } as Record<string, number>;
        const validated = validateAiSettings(ai).value.localLlm.contextWindowByModel;
        expect(validated).toEqual({ ok: 65536 });
    });

    it('gives vaults saved before this setting an empty map', () => {
        const ai = settingsFor('big-80b');
        delete (ai.localLlm as Partial<typeof ai.localLlm>).contextWindowByModel;
        expect(validateAiSettings(ai).value.localLlm.contextWindowByModel).toEqual({});
    });
});
