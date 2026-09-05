import { describe, expect, it } from 'vitest';
import { getSecret, hasSecret, isSecretStorageAvailable, setSecret } from './secretStorage';

describe('secretStorage compatibility', () => {
    it('supports modern Obsidian secret APIs and normalizes dotted key names', async () => {
        const store = new Map<string, string>();
        const app = {
            secretStorage: {
                getSecret: (id: string) => store.get(id) ?? null,
                setSecret: (id: string, value: string) => {
                    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
                        throw new Error(`Invalid secret id: ${id}`);
                    }
                    store.set(id, value);
                },
                listSecrets: () => Array.from(store.keys())
            }
        };

        expect(isSecretStorageAvailable(app as any)).toBe(true);
        expect(await setSecret(app as any, 'rt.anthropic.api-key', 'anthropic-secret')).toBe(true);
        expect(store.get('rt-anthropic-api-key')).toBe('anthropic-secret');
        expect(await getSecret(app as any, 'rt.anthropic.api-key')).toBe('anthropic-secret');
        expect(await hasSecret(app as any, 'rt.anthropic.api-key')).toBe(true);
    });

    it('supports legacy get/set/has methods', async () => {
        const store = new Map<string, string>();
        const app = {
            secretStorage: {
                get: async (id: string) => store.get(id) ?? null,
                has: async (id: string) => store.has(id),
                set: async (id: string, value: string) => {
                    store.set(id, value);
                }
            }
        };

        expect(isSecretStorageAvailable(app as any)).toBe(true);
        expect(await setSecret(app as any, 'rt.openai.api-key', 'openai-secret')).toBe(true);
        expect(store.get('rt.openai.api-key')).toBe('openai-secret');
        expect(await getSecret(app as any, 'rt.openai.api-key')).toBe('openai-secret');
        expect(await hasSecret(app as any, 'rt.openai.api-key')).toBe(true);
    });
});
