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

    it('uses one structured probe with a cold-start allowance above the configured timeout', async () => {
        listModels.mockResolvedValue([{ id: 'local-model' }]);
        complete.mockResolvedValue({
            success: true,
            content: '{"status":"ok"}',
            responseData: {},
            requestPayload: {}
        });
        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const base = (await import('../settings/aiSettings')).buildDefaultAiSettings();
        base.localLlm = { ...base.localLlm, defaultModelId: 'local-model', timeoutMs: 45_000 };

        const report = await runLocalLlmDiagnostics(
            { app: {}, settings: { aiSettings: base } } as any,
            { timeoutMs: 10_000 }
        );

        expect(report.basicCompletion.ok).toBe(true);
        expect(report.structuredJson.ok).toBe(true);
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete.mock.calls[0][0]).toMatchObject({
            timeoutMs: 90_000,
            maxOutputTokens: 64
        });
    });

    it('preserves a configured timeout that is already above the cold-start floor', async () => {
        listModels.mockResolvedValue([{ id: 'local-model' }]);
        complete.mockResolvedValue({
            success: true,
            content: '{"status":"ok"}',
            responseData: {},
            requestPayload: {}
        });
        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const base = (await import('../settings/aiSettings')).buildDefaultAiSettings();
        base.localLlm = { ...base.localLlm, defaultModelId: 'local-model', timeoutMs: 120_000 };

        await runLocalLlmDiagnostics(
            { app: {}, settings: { aiSettings: base } } as any,
            { timeoutMs: 10_000 }
        );

        expect(complete.mock.calls[0][0]).toMatchObject({ timeoutMs: 120_000 });
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

    it('makes exactly one generation call per validation', async () => {
        complete.mockResolvedValue(ok('{"status":"ok"}'));

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        await runLocalLlmDiagnostics(await plugin());

        expect(complete).toHaveBeenCalledTimes(1);
    });

    it('can validate twice consecutively without carrying work between runs', async () => {
        complete.mockResolvedValue(ok('{"status":"ok"}'));
        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const target = await plugin();

        const first = await runLocalLlmDiagnostics(target);
        const second = await runLocalLlmDiagnostics(target);

        expect(first.structuredJson.ok).toBe(true);
        expect(second.structuredJson.ok).toBe(true);
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
