import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalLlmDiscovery } from './LocalLlmDiscovery';
import { buildDefaultAiSettings } from '../../ai/settings/aiSettings';
import { getLocalLlmSettings } from '../../ai/localLlm/settings';
import type { LocalLlmModelEntry } from '../../ai/localLlm/transport';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
    const config = { settings: getLocalLlmSettings(buildDefaultAiSettings()), provider: 'ollama' };
    const listModels = vi.fn(async () => [{ id: 'model' }]);
    const owner = createLocalLlmDiscovery({ settings: () => config.settings, provider: () => config.provider, listModels });
    return { config, listModels, owner };
}
afterEach(() => vi.useRealTimers());
describe('Local LLM discovery ownership', () => {
    it('shares discovery requests and clears its pending flag on completion', async () => {
        const p = setup(); const pending = deferred<LocalLlmModelEntry[]>(); p.listModels.mockReturnValue(pending.promise);
        const first = p.owner.detect(); const calls = p.listModels.mock.calls.length;
        expect(p.owner.detect()).toBe(first); expect(p.listModels).toHaveBeenCalledTimes(calls); expect(p.owner.discovering).toBe(true);
        pending.resolve([{ id: 'model' }]); expect(await first).not.toBeNull(); expect(p.owner.discovering).toBe(false);
    });
    it('discards an old model list after configuration changes without clearing a newer request', async () => {
        const p = setup(); const old = deferred<LocalLlmModelEntry[]>(); const current = deferred<LocalLlmModelEntry[]>();
        p.listModels.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        const first = p.owner.load(); p.config.settings = { ...p.config.settings, baseUrl: 'http://localhost:9999/v1' };
        const second = p.owner.load(); old.resolve([{ id: 'old' }]); expect(await first).toBeNull(); expect(p.owner.loading).toBe(true);
        current.resolve([{ id: 'new' }]); expect(await second).toEqual([{ id: 'new' }]); expect(p.owner.loading).toBe(false);
    });
    it.each(['invalidate', 'dispose', 'provider'] as const)('discards late results after %s', async change => {
        const p = setup(); const pending = deferred<LocalLlmModelEntry[]>(); p.listModels.mockReturnValue(pending.promise);
        const request = p.owner.load(); if (change === 'provider') p.config.provider = 'openai'; else p.owner[change]();
        pending.resolve([{ id: 'old' }]); expect(await request).toBeNull(); expect(p.owner.loading).toBe(false);
        if (change === 'dispose') { await p.owner.detect(); expect(p.listModels).toHaveBeenCalledOnce(); }
    });
    it('reports a current failure and allows the next request', async () => {
        const p = setup(); p.listModels.mockRejectedValueOnce(new Error('offline'));
        await expect(p.owner.load()).rejects.toThrow('offline'); expect(p.owner.loading).toBe(false);
        expect(await p.owner.load()).toEqual([{ id: 'model' }]);
    });
    it('bounds a stuck list request and releases the guard for retry', async () => {
        vi.useFakeTimers(); const p = setup(); p.listModels.mockReturnValueOnce(new Promise(() => {}));
        const request = p.owner.load(); const assertion = expect(request).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(60_001); await assertion; expect(p.owner.loading).toBe(false);
        expect(await p.owner.load()).toEqual([{ id: 'model' }]);
    });
});
