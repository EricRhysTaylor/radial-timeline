import type { AIProviderId, ModelInfo, ModelReleaseChannel } from '../types';

export const PROVIDER_DISPLAY_LABELS: Record<Exclude<AIProviderId, 'none'>, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    ollama: 'Local LLM'
};

const OPENAI_PICKER_CHANNEL_ORDER: ReadonlyArray<ModelReleaseChannel> = ['stable', 'pro', 'rollback'];
const ANTHROPIC_PICKER_CHANNEL_ORDER: ReadonlyArray<ModelReleaseChannel> = ['stable', 'pro'];

function isLatestCompatibilityAlias(model: ModelInfo): boolean {
    return model.id.includes('-latest') || model.alias.includes('-latest');
}

function releasedAtRank(model: ModelInfo): number {
    if (!model.releasedAt) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(model.releasedAt);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function canonicalRank(model: ModelInfo): number {
    if (model.rollout?.datedVariantOf) return 0;
    if (/\d{4}-\d{2}-\d{2}$/.test(model.id)) return 0;
    return 1;
}

export function compareNewestModels(left: ModelInfo, right: ModelInfo): number {
    const releasedAtDelta = releasedAtRank(right) - releasedAtRank(left);
    if (releasedAtDelta !== 0) return releasedAtDelta;
    const canonicalDelta = canonicalRank(right) - canonicalRank(left);
    if (canonicalDelta !== 0) return canonicalDelta;
    return right.alias.localeCompare(left.alias);
}

export function selectLatestModelByReleaseChannel(
    models: ModelInfo[],
    provider: AIProviderId,
    channel: ModelReleaseChannel
): ModelInfo | undefined {
    return models
        .filter(model => model.provider === provider)
        .filter(model => model.status !== 'deprecated')
        .filter(model => model.rollout?.channel === channel)
        .sort(compareNewestModels)[0];
}

export function getPickerModelsForProvider(models: ModelInfo[], provider: AIProviderId): ModelInfo[] {
    const providerModels = models
        .filter(model => model.provider === provider)
        .filter(model => model.status !== 'deprecated');

    if (provider === 'google') {
        return providerModels
            .filter(model => !isLatestCompatibilityAlias(model))
            .sort(compareNewestModels);
    }

    if (provider !== 'openai') {
        if (provider === 'anthropic') {
            const visible = providerModels.filter(model => model.rollout?.hiddenFromPicker !== true);
            const newestPerChannel = new Map<ModelReleaseChannel, ModelInfo>();

            visible.forEach(model => {
                const channel = model.rollout?.channel;
                if (!channel || !ANTHROPIC_PICKER_CHANNEL_ORDER.includes(channel)) return;
                const current = newestPerChannel.get(channel);
                if (!current || compareNewestModels(model, current) < 0) {
                    newestPerChannel.set(channel, model);
                }
            });

            const curated = ANTHROPIC_PICKER_CHANNEL_ORDER
                .map(channel => newestPerChannel.get(channel))
                .filter((model): model is ModelInfo => !!model);
            const curatedIds = new Set(curated.map(model => model.id));
            const remainder = visible
                .filter(model => !curatedIds.has(model.id))
                .sort(compareNewestModels);

            return [...curated, ...remainder];
        }
        return providerModels.sort(compareNewestModels);
    }

    const visible = providerModels
        .filter(model => model.rollout?.hiddenFromPicker !== true)
        .filter(model => {
            const channel = model.rollout?.channel;
            return channel === 'stable' || channel === 'pro' || channel === 'rollback';
        });

    const newestPerChannel = new Map<ModelReleaseChannel, ModelInfo>();
    visible.forEach(model => {
        const channel = model.rollout?.channel;
        if (!channel) return;
        const current = newestPerChannel.get(channel);
        if (!current || compareNewestModels(model, current) < 0) {
            newestPerChannel.set(channel, model);
        }
    });

    return OPENAI_PICKER_CHANNEL_ORDER
        .map(channel => newestPerChannel.get(channel))
        .filter((model): model is ModelInfo => !!model);
}
