import type RadialTimelinePlugin from '../../main';
import type { AiSettingsV1, Capability, DeclarableLocalCapability, LocalLlmBackendId, LocalLlmJsonMode, LocalLlmSettings, ModelInfo, ModelSelectionResult } from '../types';
import { buildDefaultAiSettings, cloneDefaultLocalLlmSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import { BUILTIN_MODELS } from '../registry/builtinModels';

export const LOCAL_LLM_BACKEND_LABELS: Record<LocalLlmBackendId, string> = {
    ollama: 'Ollama',
    lmStudio: 'LM Studio',
    openaiCompatible: 'OpenAI-Compatible'
};

// Keeps wire-mode literals out of the settings UI layer (AiSection guards
// against raw wire-protocol strings in its source).
export const LOCAL_LLM_JSON_MODE_LABEL_KEYS: Record<LocalLlmJsonMode, string> = {
    response_format: 'settings.ai.localLlmConfig.optionJsonModeResponseFormat',
    prompt_only: 'settings.ai.localLlmConfig.optionJsonModePromptOnly'
};

export const LOCAL_LLM_CAPABILITY_LABEL_KEYS: Record<
    DeclarableLocalCapability,
    { name: string; desc: string }
> = {
    reasoningStrong: {
        name: 'settings.ai.localLlmConfig.capabilityReasoningStrongName',
        desc: 'settings.ai.localLlmConfig.capabilityReasoningStrongDesc'
    },
    longContext: {
        name: 'settings.ai.localLlmConfig.capabilityLongContextName',
        desc: 'settings.ai.localLlmConfig.capabilityLongContextDesc'
    },
    highOutputCap: {
        name: 'settings.ai.localLlmConfig.capabilityHighOutputCapName',
        desc: 'settings.ai.localLlmConfig.capabilityHighOutputCapDesc'
    }
};

export function normalizeLocalLlmServerBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '');
}

export function buildLocalLlmServerKey(backend: LocalLlmBackendId, baseUrl: string): string {
    return `${backend}|${normalizeLocalLlmServerBaseUrl(baseUrl)}`;
}

export function buildLocalLlmModelIdentity(
    backend: LocalLlmBackendId,
    baseUrl: string,
    modelId: string
): string {
    return `${buildLocalLlmServerKey(backend, baseUrl)}::${modelId.trim()}`;
}

export function getCanonicalLocalLlmSettings(plugin: RadialTimelinePlugin): LocalLlmSettings {
    const validated = validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings());
    plugin.settings.aiSettings = validated.value;
    return validated.value.localLlm;
}

export function getLocalLlmSettings(aiSettings: AiSettingsV1): LocalLlmSettings {
    return validateAiSettings(aiSettings).value.localLlm;
}

function buildCustomLocalModelInfo(modelId: string): ModelInfo {
    const fallback = BUILTIN_MODELS.find(model => model.provider === 'ollama' && model.id === 'local-model')
        ?? BUILTIN_MODELS.find(model => model.provider === 'ollama')
        ?? {
            provider: 'ollama' as const,
            id: 'local-model',
            alias: 'ollama-local-model',
            label: 'Local Model',
            tier: 'LOCAL' as const,
            capabilities: ['jsonStrict'],
            personality: { reasoning: 5, writing: 5, determinism: 4 },
            contextWindow: 32000,
            maxOutput: 4000,
            status: 'legacy' as const
        };
    const normalizedId = modelId.trim() || cloneDefaultLocalLlmSettings().defaultModelId;
    return {
        ...fallback,
        id: normalizedId,
        alias: `ollama-${normalizedId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'local-model'}`,
        label: normalizedId
    };
}

/**
 * Local backends publish no capability manifest, so the registry entry only
 * carries the `jsonStrict` baseline. Everything above that baseline is an
 * operator assertion made in Settings → AI → Local LLM; merge it here so the
 * capability floor in `aiClient` has one authoritative model to check against.
 */
function applyDeclaredCapabilities(model: ModelInfo, declared: DeclarableLocalCapability[]): ModelInfo {
    if (declared.length === 0) return model;
    const merged = new Set<Capability>([...model.capabilities, ...declared]);
    return { ...model, capabilities: [...merged] };
}

export function resolveLocalLlmModelInfo(aiSettings: AiSettingsV1): ModelInfo {
    const localLlm = getLocalLlmSettings(aiSettings);
    const target = localLlm.defaultModelId.trim() || cloneDefaultLocalLlmSettings().defaultModelId;
    const matched = BUILTIN_MODELS.find(model =>
        model.provider === 'ollama' && (model.id === target || model.alias === target)
    );
    return applyDeclaredCapabilities(matched ?? buildCustomLocalModelInfo(target), localLlm.declaredCapabilities);
}

export function resolveLocalLlmSelection(aiSettings: AiSettingsV1): ModelSelectionResult {
    const localLlm = getLocalLlmSettings(aiSettings);
    const model = resolveLocalLlmModelInfo(aiSettings);
    return {
        provider: 'ollama',
        model,
        warnings: model.id === localLlm.defaultModelId.trim()
            ? []
            : [`Using canonical Local LLM model "${localLlm.defaultModelId.trim()}".`],
        reason: `Local LLM backend ${LOCAL_LLM_BACKEND_LABELS[localLlm.backend]} resolved from canonical localLlm settings.`
    };
}
