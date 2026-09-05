import type RadialTimelinePlugin from '../../main';
import { buildDefaultAiSettings, type CredentialSecretField, type CredentialSecretProvider } from '../settings/aiSettings';
import { hasLegacyAiKeys } from '../settings/migrateAiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import type { AIProviderId, AiSettingsV1 } from '../types';
import { getSecret, isSecretStorageAvailable, setSecret } from './secretStorage';

export type CredentialProvider = AIProviderId;

function toCanonicalProvider(provider: CredentialProvider): CredentialSecretProvider | null {
    if (provider === 'openai' || provider === 'anthropic' || provider === 'google' || provider === 'ollama') return provider;
    return null;
}

function toSecretField(provider: CredentialSecretProvider): CredentialSecretField {
    if (provider === 'openai') return 'openaiSecretId';
    if (provider === 'anthropic') return 'anthropicSecretId';
    if (provider === 'google') return 'googleSecretId';
    return 'ollamaSecretId';
}

function toLegacySettingField(provider: CredentialSecretProvider): 'openaiApiKey' | 'anthropicApiKey' | 'geminiApiKey' | 'localApiKey' {
    if (provider === 'openai') return 'openaiApiKey';
    if (provider === 'anthropic') return 'anthropicApiKey';
    if (provider === 'google') return 'geminiApiKey';
    return 'localApiKey';
}

function getAiSettings(plugin: RadialTimelinePlugin): AiSettingsV1 {
    const validated = validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings());
    if (validated.warnings.length) {
        plugin.settings.aiSettings = validated.value;
    }
    return validated.value;
}

function getLegacyValue(plugin: RadialTimelinePlugin, provider: CredentialSecretProvider): string {
    const field = toLegacySettingField(provider);
    const value = (plugin.settings as unknown as Record<string, unknown>)[field];
    return typeof value === 'string' ? value.trim() : '';
}

export function getCredentialSecretId(
    aiSettings: AiSettingsV1,
    provider: CredentialProvider
): string {
    const canonical = toCanonicalProvider(provider);
    if (!canonical) return '';
    const field = toSecretField(canonical);
    const value = aiSettings.credentials?.[field];
    return typeof value === 'string' ? value.trim() : '';
}

export function setCredentialSecretId(
    aiSettings: AiSettingsV1,
    provider: CredentialProvider,
    secretId: string
): void {
    const canonical = toCanonicalProvider(provider);
    if (!canonical) return;
    const field = toSecretField(canonical);
    if (!aiSettings.credentials) aiSettings.credentials = {};
    aiSettings.credentials[field] = secretId.trim();
}

export async function getCredential(
    plugin: RadialTimelinePlugin,
    provider: CredentialProvider
): Promise<string> {
    const canonical = toCanonicalProvider(provider);
    if (!canonical) return '';

    const aiSettings = getAiSettings(plugin);
    const secretId = getCredentialSecretId(aiSettings, canonical);
    if (secretId && isSecretStorageAvailable(plugin.app)) {
        const secret = await getSecret(plugin.app, secretId);
        if (secret) return secret;
    }
    return '';
}

export interface KeyMigrationResult {
    migratedProviders: CredentialSecretProvider[];
    skippedProviders: CredentialSecretProvider[];
    warnings: string[];
}

export async function migrateLegacyKeysToSecretStorage(
    plugin: RadialTimelinePlugin
): Promise<KeyMigrationResult> {
    const result: KeyMigrationResult = {
        migratedProviders: [],
        skippedProviders: [],
        warnings: []
    };

    if (!isSecretStorageAvailable(plugin.app)) {
        result.warnings.push('Secure key saving is unavailable in this Obsidian version.');
        return result;
    }

    const aiSettings = getAiSettings(plugin);
    const providers: CredentialSecretProvider[] = ['openai', 'anthropic', 'google', 'ollama'];
    let changed = false;

    for (const provider of providers) {
        const legacy = getLegacyValue(plugin, provider);
        if (!legacy) {
            result.skippedProviders.push(provider);
            continue;
        }

        const field = toSecretField(provider);
        const secretId = (aiSettings.credentials?.[field] || '').trim();
        if (!secretId) {
            result.warnings.push(`${provider} saved key name is missing; skipping migration for this provider.`);
            result.skippedProviders.push(provider);
            continue;
        }

        const stored = await setSecret(plugin.app, secretId, legacy);
        if (!stored) {
            result.warnings.push(`${provider} key could not be saved privately.`);
            result.skippedProviders.push(provider);
            continue;
        }

        (plugin.settings as unknown as Record<string, unknown>)[toLegacySettingField(provider)] = '';
        changed = true;
        result.migratedProviders.push(provider);
    }

    // Remove any stale raw-key payload from canonical credentials object.
    aiSettings.credentials = {
        openaiSecretId: aiSettings.credentials?.openaiSecretId,
        anthropicSecretId: aiSettings.credentials?.anthropicSecretId,
        googleSecretId: aiSettings.credentials?.googleSecretId,
        ollamaSecretId: aiSettings.credentials?.ollamaSecretId
    };
    plugin.settings.aiSettings = aiSettings;
    changed = changed || result.migratedProviders.length > 0;

    if (changed) {
        await plugin.saveSettings();
    }

    return result;
}

export function needsLegacyKeyMigration(plugin: RadialTimelinePlugin): boolean {
    return hasLegacyAiKeys(plugin.settings);
}
