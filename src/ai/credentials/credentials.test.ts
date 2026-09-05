import { describe, expect, it } from 'vitest';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { getCredential, migrateLegacyKeysToSecretStorage } from './credentials';

type MockPlugin = {
    app: {
        secretStorage?: {
            get: (key: string) => Promise<string | null>;
            has: (key: string) => Promise<boolean>;
            set?: (key: string, value: string) => Promise<void>;
            delete?: (key: string) => Promise<void>;
        };
    };
    settings: Record<string, unknown>;
    saveSettings: () => Promise<void>;
};

function createPlugin(options?: {
    openaiKey?: string;
    anthropicKey?: string;
    geminiKey?: string;
    withSecretStorage?: boolean;
}) {
    const store = new Map<string, string>();
    const withSecretStorage = options?.withSecretStorage ?? true;
    const plugin: MockPlugin = {
        app: {
            secretStorage: withSecretStorage
                ? {
                    get: async (key: string) => store.get(key) ?? null,
                    has: async (key: string) => store.has(key),
                    set: async (key: string, value: string) => { store.set(key, value); },
                    delete: async (key: string) => { store.delete(key); }
                }
                : undefined
        },
        settings: {
            aiSettings: buildDefaultAiSettings(),
            openaiApiKey: options?.openaiKey ?? '',
            anthropicApiKey: options?.anthropicKey ?? '',
            geminiApiKey: options?.geminiKey ?? '',
            localApiKey: ''
        },
        saveSettings: async () => undefined
    };
    return { plugin, store };
}

describe('AI credentials', () => {
    it('migration moves legacy key values into Secret Storage and clears legacy fields', async () => {
        const { plugin, store } = createPlugin({
            openaiKey: 'legacy-openai',
            anthropicKey: 'legacy-anthropic',
            geminiKey: 'legacy-google'
        });

        const result = await migrateLegacyKeysToSecretStorage(plugin as any);
        expect(result.migratedProviders).toEqual(['openai', 'anthropic', 'google']);
        expect(plugin.settings.openaiApiKey).toBe('');
        expect(plugin.settings.anthropicApiKey).toBe('');
        expect(plugin.settings.geminiApiKey).toBe('');
        expect(store.get(plugin.settings.aiSettings.credentials.openaiSecretId)).toBe('legacy-openai');
        expect(store.get(plugin.settings.aiSettings.credentials.anthropicSecretId)).toBe('legacy-anthropic');
        expect(store.get(plugin.settings.aiSettings.credentials.googleSecretId)).toBe('legacy-google');
    });

    it('credential resolution prefers Secret Storage over legacy settings values', async () => {
        const { plugin, store } = createPlugin({
            openaiKey: 'legacy-openai'
        });
        const secretId = plugin.settings.aiSettings.credentials.openaiSecretId;
        store.set(secretId, 'secure-openai');

        const credential = await getCredential(plugin as any, 'openai');
        expect(credential).toBe('secure-openai');
    });

    it('credential resolution does not fall back to legacy plaintext settings after cleanup', async () => {
        const { plugin } = createPlugin({
            openaiKey: 'legacy-openai'
        });

        const credential = await getCredential(plugin as any, 'openai');
        expect(credential).toBe('');
    });

    it('settings serialization contains no raw key material after migration', async () => {
        const { plugin } = createPlugin({
            openaiKey: 'secret-one',
            anthropicKey: 'secret-two',
            geminiKey: 'secret-three'
        });
        await migrateLegacyKeysToSecretStorage(plugin as any);

        const serialized = JSON.stringify(plugin.settings);
        expect(serialized.includes('secret-one')).toBe(false);
        expect(serialized.includes('secret-two')).toBe(false);
        expect(serialized.includes('secret-three')).toBe(false);
        expect(serialized.includes('openaiSecretId')).toBe(true);
        expect(serialized.includes('anthropicSecretId')).toBe(true);
        expect(serialized.includes('googleSecretId')).toBe(true);
    });
});
