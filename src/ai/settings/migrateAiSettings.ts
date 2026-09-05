import type { RadialTimelineSettings } from '../../types';
import type { AIProviderId, AiSettingsV1, AIRoleTemplate,
    AIFeatureProfile
} from '../types';
import {
    buildDefaultAiSettings,
    cloneBuiltInRoleTemplates,
    DEFAULT_CANONICAL_PROVIDER
} from './aiSettings';
import { findBuiltinByAlias, findBuiltinByProviderModel } from '../registry/builtinModels';
import { validateAiSettings } from './validateAiSettings';

type LegacyProviderName = 'openai' | 'anthropic' | 'gemini' | 'local';

type LegacyAiSettingsInput = Partial<{
    openaiApiKey: string;
    anthropicApiKey: string;
    anthropicModelId: string;
    geminiApiKey: string;
    geminiModelId: string;
    defaultAiProvider: LegacyProviderName;
    localBaseUrl: string;
    localModelId: string;
    localApiKey: string;
    localLlmInstructions: string;
    openaiModelId: string;
    aiContextTemplates: AIRoleTemplate[];
    activeAiContextTemplateId: string;
    aiCanonicalResetCompleted: boolean;
}>;

export interface MigrationResult {
    aiSettings: AiSettingsV1;
    changed: boolean;
    warnings: string[];
}

export const LEGACY_AI_SETTING_FIELDS = [
    'openaiApiKey',
    'anthropicApiKey',
    'anthropicModelId',
    'geminiApiKey',
    'geminiModelId',
    'defaultAiProvider',
    'localBaseUrl',
    'localModelId',
    'localApiKey',
    'localLlmInstructions',
    'openaiModelId',
    'aiContextTemplates',
    'activeAiContextTemplateId',
    'aiCanonicalResetCompleted'
] as const;

function cloneDefault(): AiSettingsV1 {
    return JSON.parse(JSON.stringify(buildDefaultAiSettings())) as AiSettingsV1;
}

function readLegacy(settings: RadialTimelineSettings): LegacyAiSettingsInput {
    return settings as unknown as LegacyAiSettingsInput;
}

function mapLegacyProviderName(provider?: string): AIProviderId | null {
    if (provider === 'openai') return 'openai';
    if (provider === 'anthropic') return 'anthropic';
    if (provider === 'gemini') return 'google';
    if (provider === 'local') return 'ollama';
    return null;
}

function getLegacyModelId(legacy: LegacyAiSettingsInput, provider: AIProviderId): string {
    const raw = provider === 'anthropic'
        ? legacy.anthropicModelId
        : provider === 'google'
            ? legacy.geminiModelId
            : provider === 'ollama'
                ? legacy.localModelId
                : legacy.openaiModelId;
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/^models\//, '');
}

function resolveLegacyPinnedModel(provider: AIProviderId, legacyModelId: string) {
    if (!legacyModelId) return undefined;
    return findBuiltinByProviderModel(provider, legacyModelId)
        ?? findBuiltinByAlias(legacyModelId);
}

function normalizeRoleTemplates(rawTemplates: unknown): AIRoleTemplate[] {
    if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
        return cloneBuiltInRoleTemplates();
    }
    const normalized = rawTemplates
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => {
            const template = entry as Record<string, unknown>;
            const id = typeof template.id === 'string' ? template.id.trim() : '';
            const prompt = typeof template.prompt === 'string' ? template.prompt.trim() : '';
            const name = typeof template.name === 'string' ? template.name.trim() : '';
            if (!id || !prompt) return null;
            return {
                id,
                name: name || id,
                prompt,
                isBuiltIn: !!template.isBuiltIn
            } satisfies AIRoleTemplate;
        })
        .filter((entry): entry is AIRoleTemplate => !!entry);
    return normalized.length ? normalized : cloneBuiltInRoleTemplates();
}

export function stripLegacyAiSettings(settings: RadialTimelineSettings): void {
    const target = settings as unknown as Record<string, unknown>;
    LEGACY_AI_SETTING_FIELDS.forEach(field => {
        if (field in target) {
            delete target[field];
        }
    });
}

export function hasLegacyAiKeys(settings: RadialTimelineSettings): boolean {
    const legacy = readLegacy(settings);
    return [
        legacy.openaiApiKey,
        legacy.anthropicApiKey,
        legacy.geminiApiKey,
        legacy.localApiKey
    ].some(value => typeof value === 'string' && value.trim().length > 0);
}

/**
 * One-time removal of the onboarding model pin that shipped briefly on
 * 2026-08-21.
 *
 * Why it must be removed: `AIFeatureProfile.modelPolicy` REPLACES the author's
 * global policy, and a Claude alias cannot resolve under OpenAI or Google —
 * `selectModel` silently substitutes that provider's latest stable model. An
 * author who had deliberately pinned GPT-5.4 would have been moved off it by a
 * default meant for Anthropic users.
 *
 * Why it lives here and not in validation: validation runs on every load and
 * must never delete an author's data. A migration runs once and is recorded.
 *
 * **The honest limit.** Shape does not carry intent. A profile the author chose
 * that happens to match what we seeded is indistinguishable from the seeded
 * one, and this migration will remove it — once. Recording the migration id is
 * what bounds the damage: re-create it and it survives from then on. Without a
 * provenance marker written at seeding time (which never existed, because the
 * default shipped and was withdrawn the same day) no predicate can do better,
 * and claiming otherwise would be false.
 */
export const WITHDRAWN_ONBOARDING_PIN_MIGRATION = 'withdraw-onboarding-haiku-pin-2026-08-21';

const SEEDED_ONBOARDING_PROFILE = {
    modelPolicy: { type: 'pinned', pinnedAlias: 'claude-haiku-4-5' }
};

/**
 * Deep structural equality against the seeded object.
 *
 * An earlier version counted the OUTER keys only, so a profile carrying extra
 * keys INSIDE `modelPolicy` was deleted despite plainly being author-edited.
 * Serialising with sorted keys compares the whole shape, not its first level.
 */
function isExactSeededProfile(profile: AIFeatureProfile | undefined): boolean {
    if (!profile) return false;
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.keys(val).sort().reduce<Record<string, unknown>>((acc, key) => {
                acc[key] = (val as Record<string, unknown>)[key];
                return acc;
            }, {});
        }
        return val;
    });
    return canonical(profile) === canonical(SEEDED_ONBOARDING_PROFILE);
}

/**
 * Returns the settings with the withdrawn pin removed, plus whether anything
 * changed. Idempotent: once the migration id is recorded it never fires again.
 */
export function applyWithdrawnOnboardingPinMigration(
    aiSettings: AiSettingsV1
): { aiSettings: AiSettingsV1; changed: boolean } {
    const applied = aiSettings.appliedMigrations ?? [];
    if (applied.includes(WITHDRAWN_ONBOARDING_PIN_MIGRATION)) {
        return { aiSettings, changed: false };
    }

    const profiles = aiSettings.featureProfiles ?? {};
    const shouldRemove = isExactSeededProfile(profiles.Onboarding);

    // The id is recorded whether or not anything was removed — the migration
    // has been considered for this vault, and it must not reconsider later and
    // delete a profile the author creates in the meantime.
    const next: AiSettingsV1 = {
        ...aiSettings,
        appliedMigrations: [...applied, WITHDRAWN_ONBOARDING_PIN_MIGRATION]
    };
    if (shouldRemove) {
        const { Onboarding: _removed, ...rest } = profiles;
        next.featureProfiles = rest;
    }
    return { aiSettings: next, changed: true };
}

export function migrateAiSettings(settings: RadialTimelineSettings): MigrationResult {
    const legacy = readLegacy(settings);
    const existing = settings.aiSettings;
    if (existing && typeof existing === 'object' && existing.schemaVersion === 1) {
        const validated = validateAiSettings(existing);
        const migrated = applyWithdrawnOnboardingPinMigration(validated.value);
        return {
            aiSettings: migrated.aiSettings,
            // Deep comparison against the ORIGINAL input, so any normalisation
            // or migration that altered the settings drives the startup save.
            // main.ts persists on `changed`, so a migration that does not
            // report one would be applied in memory and lost on every load.
            changed: JSON.stringify(migrated.aiSettings) !== JSON.stringify(existing),
            warnings: validated.warnings
        };
    }

    const aiSettings = cloneDefault();
    const warnings: string[] = [];

    const roleTemplates = normalizeRoleTemplates(legacy.aiContextTemplates);
    aiSettings.roleTemplates = roleTemplates;

    const preferredTemplateId = typeof legacy.activeAiContextTemplateId === 'string'
        ? legacy.activeAiContextTemplateId.trim()
        : '';
    aiSettings.roleTemplateId = roleTemplates.some(template => template.id === preferredTemplateId)
        ? preferredTemplateId
        : roleTemplates[0]?.id ?? aiSettings.roleTemplateId;

    const legacyProvider = mapLegacyProviderName(legacy.defaultAiProvider);
    const legacyModelId = legacyProvider ? getLegacyModelId(legacy, legacyProvider) : '';
    const mappedModel = legacyProvider && legacyModelId
        ? resolveLegacyPinnedModel(legacyProvider, legacyModelId)
        : undefined;

    if (legacyProvider && mappedModel && mappedModel.provider === legacyProvider) {
        aiSettings.provider = legacyProvider;
        aiSettings.modelPolicy = {
            type: 'pinned',
            pinnedAlias: mappedModel.alias
        };
    } else {
        aiSettings.provider = DEFAULT_CANONICAL_PROVIDER;
        aiSettings.modelPolicy = { ...aiSettings.modelPolicy };
        if (legacy.defaultAiProvider || legacyModelId) {
            const legacyDescriptor = [legacy.defaultAiProvider, legacyModelId].filter(Boolean).join(' / ') || 'legacy AI settings';
            warnings.push(`Legacy AI configuration "${legacyDescriptor}" was not recognized; using canonical default AI strategy.`);
        }
    }

    if (typeof legacy.localBaseUrl === 'string' && legacy.localBaseUrl.trim()) {
        aiSettings.localLlm.baseUrl = legacy.localBaseUrl.trim();
    }

    if (typeof legacy.localModelId === 'string' && legacy.localModelId.trim()) {
        aiSettings.localLlm.defaultModelId = legacy.localModelId.trim();
    }

    aiSettings.migrationWarnings = warnings;
    aiSettings.upgradedBannerPending = warnings.length > 0;

    const validated = validateAiSettings(aiSettings);
    const combinedWarnings = [...warnings, ...validated.warnings];
    if (combinedWarnings.length) {
        validated.value.migrationWarnings = [...new Set([...(validated.value.migrationWarnings || []), ...combinedWarnings])];
        validated.value.upgradedBannerPending = true;
    }

    return {
        aiSettings: validated.value,
        changed: true,
        warnings: combinedWarnings
    };
}
