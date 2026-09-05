export const PROVIDERS = ['openai', 'anthropic', 'google'];

export const TRACKED_LATEST_ALIASES = {
    openai: ['gpt-5.2-chat-latest', 'gpt-5.1-chat-latest', 'gpt-5-chat-latest'],
    gemini: ['gemini-pro-latest', 'gemini-flash-latest'],
};

const PROVIDER_ORDER = {
    openai: 0,
    anthropic: 1,
    google: 2,
};

function toIsoFromUnixSeconds(value) {
    if (!Number.isFinite(value)) return undefined;
    return new Date(value * 1000).toISOString();
}

function toFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

export function normalizeModelRecord(provider, model, fields = {}) {
    const record = {
        provider,
        id: String(fields.id || model?.id || '').trim(),
        raw: model,
    };

    if (!record.id) return null;
    if (typeof fields.label === 'string' && fields.label.trim()) record.label = fields.label.trim();
    if (typeof fields.createdAt === 'string' && fields.createdAt.trim()) record.createdAt = fields.createdAt.trim();
    if (Number.isFinite(fields.inputTokenLimit)) record.inputTokenLimit = fields.inputTokenLimit;
    if (Number.isFinite(fields.outputTokenLimit)) record.outputTokenLimit = fields.outputTokenLimit;

    return record;
}

export function normalizeOpenAiModels(items) {
    return (items || [])
        .map(model => normalizeModelRecord('openai', model, {
            id: model.id,
            label: model.name || model.display_name,
            createdAt: toIsoFromUnixSeconds(model.created),
        }))
        .filter(Boolean);
}

export function normalizeAnthropicModels(items) {
    return (items || [])
        .map(model => normalizeModelRecord('anthropic', model, {
            id: model.id,
            label: model.display_name,
            createdAt: model.created_at,
        }))
        .filter(Boolean);
}

export function normalizeGoogleModels(items) {
    return (items || [])
        .map(model => {
            const normalizedId = typeof model?.name === 'string' && model.name.startsWith('models/')
                ? model.name.slice(7)
                : model?.id || model?.name;

            return normalizeModelRecord('google', model, {
                id: normalizedId,
                label: model.displayName,
                inputTokenLimit: toFiniteNumber(model.inputTokenLimit),
                outputTokenLimit: toFiniteNumber(model.outputTokenLimit),
            });
        })
        .filter(Boolean);
}

export function sortCanonicalModels(models) {
    return [...models].sort((a, b) => {
        const pa = PROVIDER_ORDER[a.provider] ?? 99;
        const pb = PROVIDER_ORDER[b.provider] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.id.localeCompare(b.id);
    });
}

export function buildSummary(models) {
    return {
        openai: models.filter(model => model.provider === 'openai').length,
        anthropic: models.filter(model => model.provider === 'anthropic').length,
        google: models.filter(model => model.provider === 'google').length,
    };
}

export function groupByProvider(models) {
    const grouped = {
        openai: [],
        anthropic: [],
        google: [],
    };

    for (const model of models || []) {
        if (grouped[model.provider]) {
            grouped[model.provider].push(model);
        }
    }

    return grouped;
}

export function coerceExistingToCanonicalModels(existingData) {
    if (!existingData || typeof existingData !== 'object') return [];

    if (Array.isArray(existingData.models)) {
        return existingData.models
            .map(item => {
                if (!item || typeof item !== 'object') return null;
                const provider = item.provider === 'gemini' ? 'google' : item.provider;
                if (!PROVIDERS.includes(provider)) return null;

                return normalizeModelRecord(provider, item.raw || item, {
                    id: item.id,
                    label: item.label,
                    createdAt: item.createdAt,
                    inputTokenLimit: toFiniteNumber(item.inputTokenLimit),
                    outputTokenLimit: toFiniteNumber(item.outputTokenLimit),
                });
            })
            .filter(Boolean);
    }

    const openai = normalizeOpenAiModels(existingData.openai || []);
    const anthropic = normalizeAnthropicModels(existingData.anthropic || []);
    const google = normalizeGoogleModels(existingData.google || existingData.gemini || []);
    return [...openai, ...anthropic, ...google];
}

export function parseCanonicalSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const generatedAt = typeof payload.generatedAt === 'string' ? payload.generatedAt : null;
    const models = sortCanonicalModels(coerceExistingToCanonicalModels(payload));
    return {
        generatedAt,
        providerFetchedAt: parseProviderFetchedAt(payload.providerFetchedAt),
        summary: buildSummary(models),
        models,
    };
}

/**
 * When each provider's list was last fetched LIVE. `generatedAt` is stamped on
 * every run even when a provider fell back to its cached list (no API key on
 * this machine, network failure), so it cannot answer "is this list current?".
 * A provider with no recorded live fetch reports `null`.
 */
export function parseProviderFetchedAt(payload) {
    const result = {};
    for (const provider of PROVIDERS) {
        const value = payload && typeof payload === 'object' ? payload[provider] : null;
        result[provider] = typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
    }
    return result;
}

export const STALE_PROVIDER_LIST_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Providers whose list was never fetched live, or not within `maxAgeMs`.
 * The drift gate cannot see a release the provider shipped after that
 * fetch, so the report must say so instead of passing quietly.
 */
export function computeStaleProviders(snapshot, nowMs, maxAgeMs = STALE_PROVIDER_LIST_MS) {
    const fetchedAt = snapshot?.providerFetchedAt || parseProviderFetchedAt(null);
    const stale = [];
    for (const provider of PROVIDERS) {
        const value = fetchedAt[provider];
        if (!value) {
            stale.push({ provider, fetchedAt: null, ageDays: null });
            continue;
        }
        const ageMs = nowMs - Date.parse(value);
        if (ageMs > maxAgeMs) {
            stale.push({ provider, fetchedAt: value, ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)) });
        }
    }
    return stale;
}

const PROVIDER_KEY_ENV = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY',
};

export function describeStaleProvider(entry) {
    const keyVar = PROVIDER_KEY_ENV[entry.provider] || `${entry.provider.toUpperCase()}_API_KEY`;
    const age = entry.fetchedAt
        ? `last fetched live ${entry.fetchedAt.slice(0, 10)} (${entry.ageDays} days ago)`
        : 'never fetched live on this machine';
    return `${entry.provider} model list is stale — ${age}; releases since then are invisible to the drift gate. Set ${keyVar} and run npm run update-models.`;
}

function buildIdSetByProvider(models) {
    const grouped = groupByProvider(models);
    return {
        openai: new Set(grouped.openai.map(model => model.id)),
        anthropic: new Set(grouped.anthropic.map(model => model.id)),
        google: new Set(grouped.google.map(model => model.id)),
    };
}

export function computeDiff(previousModels, nextModels) {
    const previous = buildIdSetByProvider(previousModels);
    const next = buildIdSetByProvider(nextModels);
    const changes = {};

    for (const provider of PROVIDERS) {
        const added = [...next[provider]].filter(id => !previous[provider].has(id)).sort();
        const removed = [...previous[provider]].filter(id => !next[provider].has(id)).sort();
        changes[provider] = { added, removed };
    }

    return changes;
}

function compareCreatedAtDescending(left, right) {
    const leftTime = left?.createdAt ? Date.parse(left.createdAt) : Number.NEGATIVE_INFINITY;
    const rightTime = right?.createdAt ? Date.parse(right.createdAt) : Number.NEGATIVE_INFINITY;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(right?.id || '').localeCompare(String(left?.id || ''));
}

function isOpenAiGeneralChatCandidate(modelId) {
    return !['codex', 'mini', 'nano', 'pro', 'audio', 'realtime'].some(fragment => modelId.includes(fragment));
}

function deriveOpenAiAliasMapping(models) {
    const mappings = {};
    const openaiModels = models.filter(model => model.provider === 'openai');

    for (const alias of TRACKED_LATEST_ALIASES.openai) {
        const prefix = alias.replace('-latest', '').replace('-chat', '');
        const matches = openaiModels
            .filter(model => model.id.startsWith(prefix) && !model.id.includes('latest'))
            .filter(model => isOpenAiGeneralChatCandidate(model.id))
            .sort(compareCreatedAtDescending);
        if (!matches.length) continue;
        mappings[alias] = {
            likelyResolves: matches[0].id,
            createdAt: matches[0].createdAt ?? null,
        };
    }

    return mappings;
}

function deriveGeminiAliasMapping(models) {
    const mappings = {};
    const googleModels = models.filter(model => model.provider === 'google');

    for (const alias of TRACKED_LATEST_ALIASES.gemini) {
        const type = alias.includes('flash') ? 'flash' : 'pro';
        const matches = googleModels
            .filter(model => {
                const id = model.id.toLowerCase();
                if (!id.startsWith('gemini-')) return false;
                if (!id.includes(type) || id.includes('latest') || id.includes('lite')) return false;
                return !['image', 'audio', 'tts', 'live', 'native', 'customtools', 'computer-use'].some(fragment => id.includes(fragment));
            })
            .sort((a, b) => {
                const verA = parseFloat(a.id.match(/(\d+\.?\d*)/)?.[1] || '0');
                const verB = parseFloat(b.id.match(/(\d+\.?\d*)/)?.[1] || '0');
                if (verB !== verA) return verB - verA;
                return a.id.localeCompare(b.id);
            });
        if (!matches.length) continue;
        mappings[alias] = {
            likelyResolves: matches[0].id,
            displayName: matches[0].label || matches[0].id,
        };
    }

    return mappings;
}

function deriveAnthropicNewest(models) {
    const anthropicModels = models
        .filter(model => model.provider === 'anthropic')
        .filter(model => typeof model.createdAt === 'string' && Number.isFinite(Date.parse(model.createdAt)));

    if (!anthropicModels.length) {
        return {
            newestModel: null,
            unavailableReason: 'No dated Anthropic records in canonical snapshot.',
        };
    }

    const [newest] = [...anthropicModels].sort(compareCreatedAtDescending);
    return {
        newestModel: {
            id: newest.id,
            displayName: newest.label || newest.id,
            createdAt: newest.createdAt,
        },
    };
}

function extractTokenLimits(models) {
    const limits = {};
    const googleModels = models.filter(model => model.provider === 'google');

    for (const alias of TRACKED_LATEST_ALIASES.gemini) {
        const record = googleModels.find(model => model.id === alias);
        if (Number.isFinite(record?.outputTokenLimit)) {
            limits[alias] = record.outputTokenLimit;
        }
    }

    return limits;
}

export function createLatestAliasTracking(snapshot, checkedAt = new Date().toISOString()) {
    const models = snapshot?.models || [];
    return {
        checkedAt,
        snapshotGeneratedAt: snapshot?.generatedAt ?? null,
        tokenLimits: extractTokenLimits(models),
        openai: deriveOpenAiAliasMapping(models),
        gemini: deriveGeminiAliasMapping(models),
        anthropic: deriveAnthropicNewest(models),
    };
}

export function parseLatestAliasTracking(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return {
        checkedAt: typeof payload.checkedAt === 'string' ? payload.checkedAt : null,
        snapshotGeneratedAt: typeof payload.snapshotGeneratedAt === 'string' ? payload.snapshotGeneratedAt : null,
        tokenLimits: payload.tokenLimits && typeof payload.tokenLimits === 'object' ? payload.tokenLimits : {},
        openai: payload.openai && typeof payload.openai === 'object' ? payload.openai : {},
        gemini: payload.gemini && typeof payload.gemini === 'object' ? payload.gemini : {},
        anthropic: payload.anthropic && typeof payload.anthropic === 'object'
            ? payload.anthropic
            : { newestModel: null, unavailableReason: 'Tracking unavailable.' },
    };
}

export function computeAliasChanges(previousTracking, nextTracking) {
    const changes = [];

    for (const provider of ['openai', 'gemini']) {
        const previous = previousTracking?.[provider] || {};
        const next = nextTracking?.[provider] || {};
        for (const alias of Object.keys(next)) {
            const previousResolution = previous[alias]?.likelyResolves;
            const nextResolution = next[alias]?.likelyResolves;
            if (previousResolution && nextResolution && previousResolution !== nextResolution) {
                changes.push({
                    provider,
                    alias,
                    from: previousResolution,
                    to: nextResolution,
                });
            }
        }
    }

    return changes;
}

export function computeAnthropicNewestChange(previousTracking, nextTracking) {
    const previousNewest = previousTracking?.anthropic?.newestModel?.id;
    const nextNewest = nextTracking?.anthropic?.newestModel?.id;
    if (!previousNewest || !nextNewest || previousNewest === nextNewest) {
        return null;
    }

    return {
        from: {
            id: previousNewest,
            displayName: previousTracking?.anthropic?.newestModel?.displayName ?? previousNewest,
            createdAt: previousTracking?.anthropic?.newestModel?.createdAt ?? null,
        },
        to: {
            id: nextNewest,
            displayName: nextTracking?.anthropic?.newestModel?.displayName ?? nextNewest,
            createdAt: nextTracking?.anthropic?.newestModel?.createdAt ?? null,
        },
    };
}

export function computeTokenLimitChanges(previousTracking, nextTracking) {
    const changes = [];
    const previousLimits = previousTracking?.tokenLimits || {};
    const nextLimits = nextTracking?.tokenLimits || {};

    for (const modelId of Object.keys(nextLimits)) {
        const previousLimit = previousLimits[modelId];
        const nextLimit = nextLimits[modelId];
        if (Number.isFinite(previousLimit) && Number.isFinite(nextLimit) && previousLimit !== nextLimit) {
            changes.push({
                modelId,
                from: previousLimit,
                to: nextLimit,
            });
        }
    }

    return changes;
}

export function hasProviderDiff(changes) {
    return PROVIDERS.some(provider => (changes?.[provider]?.added?.length || 0) > 0 || (changes?.[provider]?.removed?.length || 0) > 0);
}

export function computeActionableDrift(input) {
    const curatedModelIds = input.curatedModelIds instanceof Set
        ? input.curatedModelIds
        : new Set(input.curatedModelIds || []);
    const actionableChanges = Object.fromEntries(PROVIDERS.map(provider => {
        const providerChanges = input.changes?.[provider] || { added: [], removed: [] };
        return [provider, {
            added: (providerChanges.added || []).filter(modelId => !curatedModelIds.has(modelId)),
            removed: [...(providerChanges.removed || [])],
        }];
    }));
    const actionableAnthropicNewestChanged = input.anthropicNewestChanged?.to?.id
        && !curatedModelIds.has(input.anthropicNewestChanged.to.id)
        ? input.anthropicNewestChanged
        : null;

    return {
        changes: actionableChanges,
        aliasChanges: input.aliasChanges || [],
        anthropicNewestChanged: actionableAnthropicNewestChanged,
        tokenLimitChanges: input.tokenLimitChanges || [],
        releaseAlerts: input.releaseAlerts || [],
    };
}

export function buildRecommendedFollowUps(input) {
    const followUps = [];
    const hasModelIdDrift = hasProviderDiff(input.changes);
    const hasAliasDrift = (input.aliasChanges?.length || 0) > 0 || Boolean(input.anthropicNewestChanged);
    const hasTokenDrift = (input.tokenLimitChanges?.length || 0) > 0;

    if (hasModelIdDrift || hasAliasDrift) {
        followUps.push('Review scripts/models/latest-models.json and scripts/models/model-drift-report.json for provider catalog drift.');
        followUps.push('If a new provider model should ship in RT, update scripts/models/registry.json and src/ai/registry/builtinModels.ts.');
        followUps.push('If RT surfaces cost or positioning for the model, update src/ai/cost/providerPricing.ts.');
    }

    if (hasTokenDrift) {
        followUps.push('If increased provider output limits matter for RT, review src/constants/tokenLimits.ts.');
    }

    return followUps;
}

export function buildModelDriftReport(input) {
    const actionable = input.actionable ?? {
        changes: input.changes,
        aliasChanges: input.aliasChanges,
        anthropicNewestChanged: input.anthropicNewestChanged,
        tokenLimitChanges: input.tokenLimitChanges,
        releaseAlerts: input.releaseAlerts || [],
    };
    const hasActionableChanges = hasProviderDiff(actionable.changes)
        || (actionable.aliasChanges?.length || 0) > 0
        || Boolean(actionable.anthropicNewestChanged)
        || (actionable.tokenLimitChanges?.length || 0) > 0
        || (actionable.releaseAlerts?.length || 0) > 0;

    return {
        checkedAt: input.checkedAt,
        mode: 'report',
        snapshotBefore: {
            generatedAt: input.beforeSnapshot?.generatedAt ?? null,
        },
        snapshotAfter: {
            generatedAt: input.afterSnapshot?.generatedAt ?? null,
            providerFetchedAt: input.afterSnapshot?.providerFetchedAt ?? parseProviderFetchedAt(null),
        },
        staleProviders: input.staleProviders || [],
        changes: input.changes,
        aliasChanges: input.aliasChanges,
        anthropicNewestChanged: input.anthropicNewestChanged,
        tokenLimitChanges: input.tokenLimitChanges,
        releaseAlerts: input.releaseAlerts || [],
        hasActionableChanges,
        recommendedFollowUps: buildRecommendedFollowUps({
            changes: actionable.changes,
            aliasChanges: actionable.aliasChanges,
            anthropicNewestChanged: actionable.anthropicNewestChanged,
            tokenLimitChanges: actionable.tokenLimitChanges,
        }),
    };
}

/**
 * Keys that record WHEN a snapshot ran rather than WHAT it found.
 *
 * Every generator stamps these fresh on each run, so writing unconditionally made
 * each build produce a diff in four tracked JSON files even when no model, alias,
 * price, or capability had changed. That turned the git history into noise and,
 * with the auto-backup build, generated a commit per build.
 */
export const SNAPSHOT_TIMESTAMP_KEYS = new Set([
    'generatedAt',
    'checkedAt',
    'snapshotGeneratedAt',
    'detectedAt',
]);

function stripTimestamps(value, keys) {
    if (Array.isArray(value)) return value.map(entry => stripTimestamps(entry, keys));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            if (keys.has(key)) continue;
            out[key] = stripTimestamps(entry, keys);
        }
        return out;
    }
    return value;
}

/**
 * True when `next` differs from the snapshot already on disk in any way that is
 * not purely a timestamp. Callers keep their own write and formatting:
 *
 *     if (snapshotContentChanged(file, payload)) await writeJson(file, payload);
 *
 * A missing or unreadable file counts as changed, so a first run always writes.
 */
export function snapshotContentChanged(previousRaw, next, keys = SNAPSHOT_TIMESTAMP_KEYS) {
    if (typeof previousRaw !== 'string' || !previousRaw.trim()) return true;
    let previous;
    try {
        previous = JSON.parse(previousRaw);
    } catch {
        return true;
    }
    return JSON.stringify(stripTimestamps(previous, keys))
        !== JSON.stringify(stripTimestamps(next, keys));
}
