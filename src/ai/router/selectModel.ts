import type { Capability, ModelInfo, ModelSelectionRequest, ModelSelectionResult } from '../types';
import { compareNewestModels, selectLatestModelByReleaseChannel } from '../registry/releaseChannels';

function hasCapabilities(model: ModelInfo, required: Capability[]): boolean {
    return required.every(cap => model.capabilities.includes(cap));
}

function filterEligible(models: ModelInfo[], request: ModelSelectionRequest): ModelInfo[] {
    return models
        .filter(model => model.provider === request.provider)
        .filter(model => model.status !== 'deprecated')
        .filter(model => hasCapabilities(model, request.requiredCapabilities))
        .filter(model => request.contextTokensNeeded === undefined || request.contextTokensNeeded <= model.contextWindow)
        .filter(model => (request.outputTokensNeeded ?? 0) <= model.maxOutput);
}

function inferLine(model: ModelInfo): string {
    if (model.line) return model.line;
    return `${model.provider}:${model.alias}`;
}

function selectLatestStable(eligible: ModelInfo[], request: ModelSelectionRequest): ModelInfo {
    const stable = eligible.filter(model => model.status === 'stable');
    const pool = stable.length ? stable : eligible;

    const stableChannel = selectLatestModelByReleaseChannel(pool, request.provider, 'stable');
    if (stableChannel) return stableChannel;

    if (!pool.length) {
        throw new Error(`No latest-stable model available for provider ${request.provider}.`);
    }

    const newestPerLine = new Map<string, ModelInfo>();
    for (const model of pool) {
        const line = inferLine(model);
        const current = newestPerLine.get(line);
        if (!current || compareNewestModels(model, current) < 0) {
            newestPerLine.set(line, model);
        }
    }
    return Array.from(newestPerLine.values()).sort(compareNewestModels)[0];
}

function selectLatestPro(eligible: ModelInfo[], request: ModelSelectionRequest): ModelInfo | null {
    const stable = eligible.filter(model => model.status === 'stable');
    const pool = stable.length ? stable : eligible;
    return selectLatestModelByReleaseChannel(pool, request.provider, 'pro') ?? null;
}

function shouldAvoidOpenAiPro(request: ModelSelectionRequest): boolean {
    return request.provider === 'openai' && request.requiredCapabilities.includes('jsonStrict');
}

export function selectModel(models: ModelInfo[], request: ModelSelectionRequest): ModelSelectionResult {
    const warnings: string[] = [];
    const eligible = filterEligible(models, request);

    if (!eligible.length) {
        throw new Error(`No model satisfies capability floor for provider ${request.provider}.`);
    }

    const fallback = selectLatestStable(eligible, request);

    if (request.policy.type === 'pinned') {
        const pinnedAlias = request.policy.pinnedAlias;
        if (pinnedAlias) {
            const pinned = eligible.find(model => model.alias === pinnedAlias);
            if (pinned) {
                return {
                    provider: request.provider,
                    model: pinned,
                    warnings,
                    reason: `Pinned alias selected: ${pinned.alias}.`
                };
            }
            warnings.push(`Pinned alias "${pinnedAlias}" unavailable; fallback to ${fallback.label}.`);
        } else {
            warnings.push('Pinned policy had no alias; fallback to stable selection.');
        }
        return {
            provider: request.provider,
            model: fallback,
            warnings,
            reason: `Pinned alias unavailable; using latest stable model: ${fallback.label}.`
        };
    }

    if (request.policy.type === 'latestPro') {
        if (shouldAvoidOpenAiPro(request)) {
            warnings.push('OpenAI pro auto-selection is disabled for schema-required workflows; fallback to latest stable.');
        } else {
            const latestPro = selectLatestPro(eligible, request);
            if (latestPro) {
                return {
                    provider: request.provider,
                    model: latestPro,
                    warnings,
                    reason: `Auto selected latest pro model in line ${inferLine(latestPro)}: ${latestPro.alias}.`
                };
            }
            warnings.push(`No pro-lane model available for provider ${request.provider}; fallback to latest stable.`);
        }
    }

    const selected = selectLatestStable(eligible, request);
    return {
        provider: request.provider,
        model: selected,
        warnings,
        reason: `Auto selected latest stable model in line ${inferLine(selected)}: ${selected.alias}.`
    };
}
