import type RadialTimelinePlugin from '../../main';
import { selectModel } from '../router/selectModel';
import { BUILTIN_MODELS } from '../registry/builtinModels';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import type { AccessTier, AIProviderId, AiSettingsV1, Capability, ModelSelectionResult } from '../types';
import { resolveLocalLlmSelection } from '../localLlm/settings';

export const CANONICAL_PROVIDER_LABELS: Record<AIProviderId, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    ollama: 'Ollama',
    none: 'Disabled'
};

export function getCanonicalAiSettings(plugin: RadialTimelinePlugin): AiSettingsV1 {
    const validated = validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings());
    plugin.settings.aiSettings = validated.value;
    return validated.value;
}

export function resolveAccessTier(aiSettings: AiSettingsV1, provider: AIProviderId): AccessTier {
    if (provider === 'anthropic') return aiSettings.aiAccessProfile.anthropicTier ?? 1;
    if (provider === 'openai') return aiSettings.aiAccessProfile.openaiTier ?? 1;
    if (provider === 'google') return aiSettings.aiAccessProfile.googleTier ?? 1;
    return 1;
}

export function resolveConfiguredProvider(
    aiSettings: AiSettingsV1,
    feature?: string
): AIProviderId {
    const featureProvider = feature ? aiSettings.featureProfiles?.[feature]?.provider : undefined;
    if (featureProvider && featureProvider !== 'none') return featureProvider;
    return aiSettings.provider;
}

export function resolveConfiguredSelection(
    aiSettings: AiSettingsV1,
    options?: {
        feature?: string;
        requiredCapabilities?: Capability[];
    }
): ModelSelectionResult | null {
    const provider = resolveConfiguredProvider(aiSettings, options?.feature);
    if (provider === 'none') return null;
    if (provider === 'ollama') return resolveLocalLlmSelection(aiSettings);
    const featureProfile = options?.feature ? aiSettings.featureProfiles?.[options.feature] : undefined;
    return selectModel(BUILTIN_MODELS, {
        provider,
        policy: featureProfile?.modelPolicy ?? aiSettings.modelPolicy,
        requiredCapabilities: options?.requiredCapabilities ?? [],
        accessTier: resolveAccessTier(aiSettings, provider)
    });
}
