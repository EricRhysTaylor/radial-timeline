import { beforeEach, describe, expect, it, vi } from 'vitest';

const listModels = vi.fn();
const getCredential = vi.fn();
const fetchOllamaModelDetails = vi.fn();
const resolveLocalLlmSelection = vi.fn();
const getCanonicalLocalLlmSettings = vi.fn();
const runLocalLlmDiagnostics = vi.fn();

vi.mock('./backends', () => ({
    getLocalLlmBackend: () => ({
        id: 'ollama',
        label: 'Ollama',
        listModels,
        complete: vi.fn()
    })
}));

vi.mock('../credentials/credentials', () => ({
    getCredential
}));

vi.mock('./transport', () => ({
    fetchOllamaModelDetails,
    type: undefined
}));

vi.mock('./settings', () => ({
    LOCAL_LLM_BACKEND_LABELS: {
        ollama: 'Ollama',
        lmStudio: 'LM Studio',
        openaiCompatible: 'OpenAI-Compatible'
    },
    buildLocalLlmModelIdentity: (backend: string, baseUrl: string, modelId: string) => `${backend}|${baseUrl}::${modelId}`,
    getCanonicalLocalLlmSettings,
    resolveLocalLlmSelection
}));

vi.mock('./diagnostics', () => ({
    runLocalLlmDiagnostics
}));

describe('LocalLlmClient diagnostic ownership', () => {
    beforeEach(() => {
        listModels.mockReset();
        getCredential.mockReset();
        fetchOllamaModelDetails.mockReset();
        resolveLocalLlmSelection.mockReset();
        getCanonicalLocalLlmSettings.mockReset();
        runLocalLlmDiagnostics.mockReset();

        getCredential.mockResolvedValue('');
        getCanonicalLocalLlmSettings.mockReturnValue({
            enabled: true,
            backend: 'ollama',
            baseUrl: 'http://localhost:11434/v1',
            defaultModelId: 'mistral-nemo',
            timeoutMs: 30000,
            maxRetries: 0,
            jsonMode: 'response_format'
        });
        resolveLocalLlmSelection.mockReturnValue({
            provider: 'ollama',
            model: {
                provider: 'ollama',
                id: 'mistral-nemo',
                alias: 'ollama-mistral-nemo',
                label: 'mistral-nemo',
                tier: 'LOCAL',
                capabilities: ['jsonStrict'],
                personality: { reasoning: 5, writing: 5, determinism: 4 },
                contextWindow: 32000,
                maxOutput: 4000,
                status: 'stable'
            },
            warnings: [],
            reason: 'Local LLM backend Ollama resolved from canonical localLlm settings.'
        });
    });

    it('reuses one in-flight diagnostics run across settings render instances', async () => {
        let finish!: (value: { ok: true }) => void;
        runLocalLlmDiagnostics.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const plugin = { settings: { aiSettings: {} } } as any;
        const { getLocalLlmClient } = await import('./client');
        const client = getLocalLlmClient(plugin);

        const first = client.runDiagnostics({ timeoutMs: 10_000 });
        const reopenedPanel = client.runDiagnostics({ timeoutMs: 4_000 });

        expect(first).toBe(reopenedPanel);
        await vi.waitFor(() => expect(runLocalLlmDiagnostics).toHaveBeenCalledTimes(1));
        finish({ ok: true });
        await expect(first).resolves.toEqual({ ok: true });
    });

    it('serializes diagnostics for different Local LLM configurations', async () => {
        let finishFirst!: (value: { id: string }) => void;
        runLocalLlmDiagnostics
            .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
            .mockResolvedValueOnce({ id: 'second' });
        const plugin = { settings: { aiSettings: {} } } as any;
        const { getLocalLlmClient } = await import('./client');
        const client = getLocalLlmClient(plugin);

        const first = client.runDiagnostics({ baseUrl: 'http://localhost:8080/v1' });
        await Promise.resolve();
        const second = client.runDiagnostics({ baseUrl: 'http://localhost:1234/v1' });
        await Promise.resolve();

        expect(runLocalLlmDiagnostics).toHaveBeenCalledTimes(1);
        finishFirst({ id: 'first' });
        await expect(first).resolves.toEqual({ id: 'first' });
        await expect(second).resolves.toEqual({ id: 'second' });
        expect(runLocalLlmDiagnostics).toHaveBeenCalledTimes(2);
    });
});
