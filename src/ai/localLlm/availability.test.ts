import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LocalLlmSettings } from '../types';

const listModels = vi.fn();

vi.mock('./backends', () => ({
    getLocalLlmBackend: () => ({ id: 'ollama', label: 'Ollama', listModels, complete: vi.fn() })
}));
vi.mock('../credentials/credentials', () => ({
    getCredential: () => Promise.resolve(undefined)
}));

const { probeLocalLlmAvailability, probeLocalLlmServer, primeLocalLlmAvailability, getLocalLlmAvailability } =
    await import('./availability');

const settings = (overrides: Partial<LocalLlmSettings> = {}): LocalLlmSettings => ({
    enabled: true,
    configurationMode: 'manual',
    backend: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModelId: 'qwen3',
    timeoutMs: 1000,
    maxRetries: 1,
    jsonMode: 'response_format',
    declaredCapabilities: [],
    ...overrides
} as LocalLlmSettings);

// SAFE: structural stub — the probe only reads settings through the mocked modules.
const plugin = {} as never;

beforeEach(() => {
    listModels.mockReset();
});

describe('probeLocalLlmAvailability', () => {
    it('reports the off switch as its own reason', async () => {
        const result = await probeLocalLlmAvailability(plugin, settings({ enabled: false }), 1);
        expect(result.available).toBe(false);
        expect(result.reason).toContain('turned off');
        // Never probed the network to learn something settings already said.
        expect(listModels).not.toHaveBeenCalled();
    });

    it('names the server and the underlying error when unreachable', async () => {
        listModels.mockRejectedValue(new Error('connection refused'));
        const result = await probeLocalLlmAvailability(plugin, settings(), 1);
        expect(result.available).toBe(false);
        expect(result.reason).toContain('Ollama');
        expect(result.reason).toContain('http://localhost:11434/v1');
        expect(result.reason).toContain('connection refused');
    });

    it('names the missing model when the server is up without it', async () => {
        listModels.mockResolvedValue([{ id: 'llama3' }]);
        const result = await probeLocalLlmAvailability(plugin, settings(), 1);
        expect(result.available).toBe(false);
        expect(result.reason).toContain('qwen3');
        expect(result.reason).toContain('not loaded');
        // Distinguishes "server down" from "wrong model" by still listing what
        // the server does offer.
        expect(result.availableModelIds).toEqual(['llama3']);
    });

    it('is available when the configured model is present', async () => {
        listModels.mockResolvedValue([{ id: 'llama3' }, { id: 'qwen3' }]);
        const result = await probeLocalLlmAvailability(plugin, settings(), 1);
        expect(result.available).toBe(true);
        expect(result.modelId).toBe('qwen3');
        expect(result.reason).toBeUndefined();
    });

    it('never runs a completion — a UI affordance must resolve fast', async () => {
        listModels.mockResolvedValue([{ id: 'qwen3' }]);
        await probeLocalLlmAvailability(plugin, settings(), 1);
        expect(listModels).toHaveBeenCalledTimes(1);
    });
});

describe('probeLocalLlmServer', () => {
    it('ignores the enabled flag, so Settings can test a server regardless', async () => {
        listModels.mockResolvedValue([{ id: 'qwen3' }]);
        const result = await probeLocalLlmServer(plugin, settings({ enabled: false }), 1);
        expect(result.available).toBe(true);
    });
});

describe('availability cache', () => {
    it('reuses a primed answer for the same configuration', async () => {
        const config = settings();
        primeLocalLlmAvailability(config, { available: true, modelId: 'qwen3', checkedAt: Date.now() });

        // The stub carries aiSettings.localLlm, so the real
        // getCanonicalLocalLlmSettings resolves it back to `config` — the key
        // therefore matches what was primed.
        const cachedPlugin = { settings: { aiSettings: { localLlm: config } } } as never;

        const result = await getLocalLlmAvailability(cachedPlugin);
        expect(result.available).toBe(true);
        expect(listModels).not.toHaveBeenCalled();
    });

    it('does not reuse an answer keyed to a different model', async () => {
        primeLocalLlmAvailability(settings({ defaultModelId: 'other-model' }), {
            available: true, modelId: 'other-model', checkedAt: Date.now()
        });
        listModels.mockResolvedValue([{ id: 'qwen3' }]);

        const config = settings();
        const result = await getLocalLlmAvailability({ settings: { aiSettings: { localLlm: config } } } as never);

        // The stale entry was for a different configuration, so the probe ran.
        expect(result.available).toBe(true);
        expect(listModels).toHaveBeenCalled();
    });
});
