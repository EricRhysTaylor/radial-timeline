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

    it('recommends the other mode when it is much faster', async () => {
        // The author is choosing between enforcement and speed; a number from
        // their own machine beats advice that may not hold there.
        let call = 0;
        complete.mockImplementation(() => {
            call += 1;
            if (call === 1) return Promise.resolve(ok('READY'));            // basic completion
            if (call === 2) return new Promise(res => setTimeout(() => res(ok('{"status":"ok"}')), 60));
            return Promise.resolve(ok('{"status":"ok"}'));                   // the other mode, instant
        });

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const report = await runLocalLlmDiagnostics(await plugin());

        expect(report.structuredJson.ok).toBe(true);
        expect(report.structuredJson.message).toContain('Consider switching');
    });

    it('says to keep the current mode when the other one fails', async () => {
        let call = 0;
        complete.mockImplementation(() => {
            call += 1;
            if (call === 1) return Promise.resolve(ok('READY'));
            if (call === 2) return Promise.resolve(ok('{"status":"ok"}'));
            return Promise.resolve(ok('not json at all'));
        });

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const report = await runLocalLlmDiagnostics(await plugin());

        expect(report.structuredJson.ok).toBe(true);
        expect(report.structuredJson.message).toContain('keep the current mode');
    });

    it('points at the working mode when the configured one fails', async () => {
        let call = 0;
        complete.mockImplementation(() => {
            call += 1;
            if (call === 1) return Promise.resolve(ok('READY'));
            if (call === 2) return Promise.resolve(ok('nonsense'));
            return Promise.resolve(ok('{"status":"ok"}'));
        });

        const { runLocalLlmDiagnostics } = await import('./diagnostics');
        const report = await runLocalLlmDiagnostics(await plugin());

        expect(report.structuredJson.ok).toBe(false);
        expect(report.structuredJson.message).toContain('should fix this');
    });
});
