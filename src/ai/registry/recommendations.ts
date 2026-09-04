import { selectModel } from '../router/selectModel';
import type { AIProviderId, AiSettingsV1, Capability, ModelInfo, ModelPolicy } from '../types';
import type { AvailabilityStatus, MergedModelInfo } from './mergeModels';
import { formatRecommendationWhy } from './recommendationWhy';
import { resolveAccessTier } from '../runtime/runtimeSelection';

export interface RecommendationRow {
    id: 'inquiry' | 'gossamer' | 'quick' | 'local';
    title: string;
    provider: AIProviderId;
    model: MergedModelInfo | null;
    reason: string;
    shortReason: string;
    availabilityStatus: AvailabilityStatus;
}

interface RecommendationIntent {
    id: RecommendationRow['id'];
    title: string;
    provider: AIProviderId;
    policy: ModelPolicy;
    requiredCapabilities: Capability[];
    contextTokensNeeded?: number;
    outputTokensNeeded?: number;
}

function toShortReason(reason: string, maxWords = 14): string {
    const words = reason.trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return reason.trim();
    return `${words.slice(0, maxWords).join(' ')}...`;
}

function findMergedModel(models: MergedModelInfo[], selected: ModelInfo): MergedModelInfo | null {
    return models.find(model => model.provider === selected.provider && model.alias === selected.alias) ?? null;
}

function resolveIntentWithRouter(
    models: MergedModelInfo[],
    aiSettings: AiSettingsV1,
    intent: RecommendationIntent
): RecommendationRow {
    try {
        const selected = selectModel(models, {
            provider: intent.provider,
            policy: intent.policy,
            requiredCapabilities: intent.requiredCapabilities,
            accessTier: resolveAccessTier(aiSettings, intent.provider),
            contextTokensNeeded: intent.contextTokensNeeded ?? 4000,
            outputTokensNeeded: intent.outputTokensNeeded ?? 800
        });
        const model = findMergedModel(models, selected.model);
        const availabilityStatus = model?.availabilityStatus ?? 'unknown';
        const why = formatRecommendationWhy({
            intentId: intent.id,
            model,
            routerReason: selected.reason
        });
        return {
            id: intent.id,
            title: intent.title,
            provider: intent.provider,
            model,
            reason: selected.reason,
            shortReason: toShortReason(why),
            availabilityStatus
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            id: intent.id,
            title: intent.title,
            provider: intent.provider,
            model: null,
            reason: `No eligible model. ${message}`,
            shortReason: formatRecommendationWhy({ intentId: intent.id, model: null }),
            availabilityStatus: 'unknown'
        };
    }
}

function resolveIntent(
    models: MergedModelInfo[],
    aiSettings: AiSettingsV1,
    intent: RecommendationIntent,
    _usedAliases: Set<string>
): RecommendationRow {
    return resolveIntentWithRouter(models, aiSettings, intent);
}

export function getAvailabilityIconName(status: AvailabilityStatus): string {
    if (status === 'visible') return 'check-circle-2';
    if (status === 'not_visible') return 'alert-triangle';
    return 'help-circle';
}

export function computeRecommendedPicks(input: {
    models: MergedModelInfo[];
    aiSettings: AiSettingsV1;
    includeLocalPrivate: boolean;
}): RecommendationRow[] {
    const selectedProvider = input.aiSettings.provider === 'none' ? 'openai' : input.aiSettings.provider;
    const rows: RecommendationRow[] = [];
    const usedAliases = new Set<string>();

    const intents: RecommendationIntent[] = [
        {
            id: 'inquiry',
            title: 'Inquiry',
            provider: selectedProvider,
            policy: { type: 'latestStable' },
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
            contextTokensNeeded: 24000,
            outputTokensNeeded: 2000
        },
        {
            id: 'gossamer',
            title: 'Gossamer Momentum',
            provider: selectedProvider,
            policy: { type: 'latestStable' },
            requiredCapabilities: ['longContext', 'jsonStrict'],
            contextTokensNeeded: 4000,
            outputTokensNeeded: 1000
        },
        {
            id: 'quick',
            title: 'General use',
            provider: selectedProvider,
            policy: { type: 'latestStable' },
            requiredCapabilities: ['jsonStrict'],
            contextTokensNeeded: 2000,
            outputTokensNeeded: 600
        }
    ];

    intents.forEach(intent => {
        const row = resolveIntent(input.models, input.aiSettings, intent, usedAliases);
        rows.push(row);
        if (row.model?.alias) {
            usedAliases.add(row.model.alias);
        }
    });

    if (input.includeLocalPrivate) {
        const localIntent: RecommendationIntent = {
            id: 'local',
            title: 'Local/Private',
            provider: 'ollama',
            policy: { type: 'latestStable' },
            requiredCapabilities: ['jsonStrict'],
        };
        const localRow = resolveIntent(input.models, input.aiSettings, localIntent, usedAliases);
        if (localRow.model) {
            rows.push(localRow);
        }
    }

    return rows;
}
