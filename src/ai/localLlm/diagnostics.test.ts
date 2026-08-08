import { beforeEach, describe, expect, it, vi } from 'vitest';

const listModels = vi.fn();
const complete = vi.fn();
const getCredential = vi.fn();

vi.mock('./backends', () => ({
    getLocalLlmBackend: () => ({
        id: 'ollama',
        label: 'Ollama',
        listModels,
        complete
    })
}));

vi.mock('../credentials/credentials', () => ({
    getCredential
}));

describe('runLocalLlmDiagnostics', () => {
    beforeEach(() => {
        listModels.mockReset();
        complete.mockReset();
        getCredential.mockReset();
        getCredential.mockResolvedValue('');
    });

    it('reports backend unavailable explicitly', async () => {
        listModels.mockRejectedValue(new Error('connection refused'));
        const { runLocalLlmDiagnostics } = await import('./diagnostics');

        const report = await runLocalLlmDiagnostics({
            app: {},
            settings: {
                aiSettings: {
                    ...(await import('../settings/aiSettings')).buildDefaultAiSettings()
                }
            }
        } as any);

        expect(report.reachable.ok).toBe(false);
        expect(report.reachable.message).toContain('connection refused');
        expect(report.modelAvailable.ok).toBe(false);
    });

    it('reports missing model when backend is reachable', async () => {
        listModels.mockResolvedValue([{ id: 'other-model' }]);
        complete.mockResolvedValue({
            success: true,
            content: 'READY',
            responseData: {},
            requestPayload: {}
        });
        const { runLocalLlmDiagnostics } = await import('./diagnostics');

        const report = await runLocalLlmDiagnostics({
            app: {},
            settings: {
                aiSettings: {
                    ...(await import('../settings/aiSettings')).buildDefaultAiSettings(),
                    localLlm: {
                        ...(await import('../settings/aiSettings')).buildDefaultAiSettings().localLlm,
                        defaultModelId: 'missing-model'
                    }
                }
            }
        } as any);

        expect(report.reachable.ok).toBe(true);
        expect(report.modelAvailable.ok).toBe(false);
        expect(report.modelAvailable.message).toContain('missing-model');
    });
});

describe('structured JSON mode is measured, not assumed', () => {
    const plugin = async () => ({
        app: {},
        settings: { aiSettings: { ...(await import('../settings/aiSettings')).buildDefaultAiSettings() } }
    // SAFE: structural stub — diagnostics only reads the members above.
    } as never);

    beforeEach(() => {
        listModels.mockReset();
        complete.mockReset();
        getCredential.mockReset();
        getCredential.mockResolvedValue('');
        listModels.mockResolvedValue([{ id: 'llama3' }]);
    });

    const ok = (content: string) => ({ success: true, content, responseData: {}, error: undefined });

    it('makes exactly one structured call — never a second probe', async () => {
        // Probing the other mode too meant one guaranteed slow call per
        // validation, and withTimeout rejects locally without aborting the
        // request — so the server kept generating for an answer nobody would
        // collect. Those orphans accumulate and wedge it.
        complete.mockResolvedValue(ok('{"status":"ok"}'));

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        await runLocalLlmDiagnostics(await plugin());

        // One basic completion, one structured. Nothing speculative.
        expect(complete).toHaveBeenCalledTimes(2);
    });

    it('reports how long the configured mode took', async () => {
        complete.mockResolvedValue(ok('{"status":"ok"}'));

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const report = await runLocalLlmDiagnostics(await plugin());

        expect(report.structuredJson.ok).toBe(true);
        expect(report.structuredJson.message).toMatch(/succeeded in [0-9.]+s using /);
    });

    it('offers no suggestion when the configured mode is quick', async () => {
        // Nagging about a fast path trains people to ignore the panel.
        complete.mockResolvedValue(ok('{"status":"ok"}'));

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const report = await runLocalLlmDiagnostics(await plugin());

        expect(report.jsonModeTiming).toBeUndefined();
    });
});
