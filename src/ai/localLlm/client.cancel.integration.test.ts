import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../../main';
import { AIClient } from '../runtime/aiClient';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { callOpenAiCompatibleLocalCompletion, LOCAL_LLM_CANCELLED } from './transport';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); });

describe('Local LLM cancellation over a real loopback connection', () => {
    it.each(['abort', 'timeout'] as const)('closes a standalone local connection on %s without retrying', async trigger => {
        let response: ServerResponse | undefined;
        let closed = false;
        let requests = 0;
        let started!: () => void;
        const incoming = new Promise<void>(resolve => { started = resolve; });
        const server = createServer((req, res) => {
            requests++; response = res;
            res.once('close', () => { closed = true; });
            req.resume(); req.once('end', started);
        });
        await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture endpoint');
        const controller = new AbortController();
        const pending = callOpenAiCompatibleLocalCompletion({
            transport: { baseUrl: `http://127.0.0.1:${address.port}/v1`, timeoutMs: trigger === 'timeout' ? 50 : 5000, signal: controller.signal },
            modelId: 'fixture-model', userPrompt: 'Synthetic fixture only'
        });
        try {
            await incoming;
            if (trigger === 'abort') controller.abort();
            const result = await pending;
            expect(result.success).toBe(false);
            if (trigger === 'abort') expect(result.error).toBe(LOCAL_LLM_CANCELLED);
            else expect(result.error).toContain('timed out');
            await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1000, interval: 20 });
            expect(requests).toBe(1);
        } finally {
            response?.end(); server.closeAllConnections();
            await new Promise<void>(resolve => { server.close(() => resolve()); });
            await pending;
        }
    });

    it.each([
        ['permission', false], ['book', false], ['stop', false], ['unload', false],
        ['permission', true], ['book', true], ['stop', true], ['unload', true]
    ] as const)('disconnects on %s (CORS transport: %s) and never accepts the response', async (trigger, corsBlocked) => {
        if (corsBlocked) {
            vi.stubEnv('RT_USE_LIVE_OBSIDIAN_REQUEST', '1');
            globalThis.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => init?.signal
                ? Promise.reject(new TypeError('Fixture CORS rejection'))
                : originalFetch(url, init));
        }
        let response: ServerResponse | undefined;
        let closed = false;
        let requests = 0;
        let started!: () => void;
        const incoming = new Promise<void>(resolve => { started = resolve; });
        const server = createServer((req, res) => {
            requests++;
            response = res;
            res.once('close', () => { closed = true; });
            req.resume();
            req.once('end', started);
        });
        await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture endpoint');
        const aiSettings = buildDefaultAiSettings();
        aiSettings.provider = 'ollama';
        aiSettings.localLlm.baseUrl = `http://127.0.0.1:${address.port}/v1`;
        let stopped = false;
        const plugin = {
            settings: { ...DEFAULT_SETTINGS, aiSettings, activeBookId: 'fixture-book', enableAiSceneAnalysis: true },
            app: { vault: { adapter: { exists: async () => false } }, secretStorage: { getSecret: async () => '' } },
            saveSettings: async () => undefined
        } as unknown as RadialTimelinePlugin; // SAFE: the real AI path needs settings and offline registry/credential IO only
        const client = new AIClient(plugin);
        vi.spyOn(client, 'getProviderSnapshot').mockResolvedValue({ source: 'none', snapshot: null });
        const run = client.run({
            feature: 'AuditFixture', task: 'LoopbackCancellation', requiredCapabilities: [], returnType: 'text',
            userInput: 'Synthetic fixture prose only.', shouldAbort: () => stopped
        }).then(() => 'accepted', error => (error as Error).message);
        try {
            await Promise.race([incoming, new Promise<never>((_resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Fixture request did not start')), 1000);
                void incoming.finally(() => clearTimeout(timer));
            })]);
            if (trigger === 'permission') plugin.settings.enableAiSceneAnalysis = false;
            if (trigger === 'book') plugin.settings.activeBookId = 'different-fixture-book';
            if (trigger === 'stop') stopped = true;
            if (trigger === 'unload') client.dispose();
            await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1000, interval: 20 });
            expect(await run).toContain('AI request cancelled');
            expect(requests).toBe(1);
        } finally {
            response?.end(JSON.stringify({ choices: [{ message: { content: 'fixture cleanup' } }] }));
            server.closeAllConnections();
            await new Promise<void>(resolve => { server.close(() => resolve()); });
            await run;
        }
    });
});
