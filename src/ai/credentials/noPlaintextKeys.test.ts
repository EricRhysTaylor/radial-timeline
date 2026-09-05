import { describe, expect, it } from 'vitest';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { migrateLegacyKeysToSecretStorage } from './credentials';
import type RadialTimelinePlugin from '../../main';

const PLAINTEXT_PATTERNS: Array<{ label: string; regex: RegExp }> = [
    { label: 'OpenAI key signature', regex: /sk-[A-Za-z0-9_-]{10,}/ },
    { label: 'Anthropic key signature', regex: /sk-ant-[A-Za-z0-9_-]{10,}/ },
    { label: 'Google API key signature', regex: /AIza[0-9A-Za-z_-]{16,}/ },
    { label: 'Bearer header token', regex: /\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/i },
    { label: 'Header-like high-entropy secret', regex: /(authorization|x-api-key|apiKey|token|secret)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{40,}/i }
];

function assertNoPlaintextCredentials(serialized: string): void {
    for (const pattern of PLAINTEXT_PATTERNS) {
        if (pattern.regex.test(serialized)) {
            throw new Error(`Plaintext credential detected in settings serialization: ${pattern.label}`);
        }
    }
}

type MockPlugin = {
    app: {
        secretStorage?: {
            get: (key: string) => Promise<string | null>;
            has: (key: string) => Promise<boolean>;
            set?: (key: string, value: string) => Promise<void>;
            delete?: (key: string) => Promise<void>;
        };
    };
    settings: {
        aiSettings: ReturnType<typeof buildDefaultAiSettings>;
        openaiApiKey: string;
        anthropicApiKey: string;
        geminiApiKey: string;
        localApiKey: string;
    };
    saveSettings: () => Promise<void>;
};

function createPluginWithLegacyKeys() {
    const store = new Map<string, string>();
    const plugin: MockPlugin = {
        app: {
            secretStorage: {
                get: async (key: string) => store.get(key) ?? null,
                has: async (key: string) => store.has(key),
                set: async (key: string, value: string) => { store.set(key, value); },
                delete: async (key: string) => { store.delete(key); }
            }
        },
        settings: {
            aiSettings: buildDefaultAiSettings(),
            openaiApiKey: 'sk-test-openai-key-123456789',
            anthropicApiKey: 'sk-ant-test-key-123456789',
            geminiApiKey: 'AIzaSyD-EXAMPLE1234567890abcd',
            localApiKey: ''
        },
        saveSettings: async () => undefined
    };
    return plugin;
}

describe('no plaintext key material invariant', () => {
    it('settings serialization keeps saved key names without plaintext key values', () => {
        const aiSettings = buildDefaultAiSettings();
        aiSettings.credentials.openaiSecretId = 'openai-main';
        aiSettings.credentials.anthropicSecretId = 'anthropic-main';
        aiSettings.credentials.googleSecretId = 'google-main';
        aiSettings.credentials.ollamaSecretId = 'ollama-main';

        const settings = {
            aiSettings,
            openaiApiKey: '',
            anthropicApiKey: '',
            geminiApiKey: '',
            localApiKey: ''
        };

        const serialized = JSON.stringify(settings);
        assertNoPlaintextCredentials(serialized);
        expect(serialized.includes('openai-main')).toBe(true);
        expect(serialized.includes('anthropic-main')).toBe(true);
        expect(serialized.includes('google-main')).toBe(true);
    });

    it('migration clears legacy plaintext fields before settings serialization', async () => {
        const plugin = createPluginWithLegacyKeys();
        await migrateLegacyKeysToSecretStorage(plugin as unknown as RadialTimelinePlugin);

        const serialized = JSON.stringify(plugin.settings);
        assertNoPlaintextCredentials(serialized);
        expect(plugin.settings.openaiApiKey).toBe('');
        expect(plugin.settings.anthropicApiKey).toBe('');
        expect(plugin.settings.geminiApiKey).toBe('');
    });
});
