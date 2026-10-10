import { beforeEach, describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { Vault } from 'obsidian';
import type { AIRunResult } from '../ai/types';
import { buildPulseRunRequest, callAiProvider } from './aiProvider';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../ai/runtime/aiClient', () => ({ getAIClient: () => ({ run }) }));
vi.mock('../ai/runtime/runtimeSelection', () => ({
    getCanonicalAiSettings: () => ({ provider: 'anthropic' }),
    resolveConfiguredSelection: () => ({ provider: 'anthropic' })
}));
vi.mock('../ai/log', async importOriginal => ({
    ...await importOriginal<typeof import('../ai/log')>(),
    ensurePulseLogsRoot: vi.fn(async () => ({})),
    resolveAvailableLogPath: () => 'test-log.md'
}));

const result = (patch: Partial<AIRunResult> = {}): AIRunResult => ({
    provider: 'anthropic', modelRequested: 'claude-opus-5-5', modelResolved: 'claude-opus-5-5',
    content: JSON.stringify({ currentSceneAnalysis: [{ scene: '1', ref_id: 'scn_12345678', grade: 'A', comment: 'Clear stakes.' }] }),
    responseData: { usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0 } },
    aiStatus: 'success', reason: 'test', warnings: [], ...patch
});

const plugin = { settings: { logApiInteractions: false }, lastAnalysisError: '' } as unknown as RadialTimelinePlugin;
const vault = { create: vi.fn() } as unknown as Vault;

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    plugin.lastAnalysisError = '';
});

describe('Pulse provider usage observation', () => {
    it('does not persist manuscript content on failures when content logging is off', async () => {
        run.mockResolvedValue(result({ aiStatus: 'rejected', content: null, error: 'Synthetic failure' }));
        await expect(callAiProvider(plugin, vault, 'PRIVATE_FIXTURE_MANUSCRIPT', null, 'fixture')).rejects.toThrow();
        const creates = vi.mocked(vault.create).mock.calls;
        expect(creates.length).toBeGreaterThan(0);
        expect(creates.every(([, content]) => !content.includes('PRIVATE_FIXTURE_MANUSCRIPT'))).toBe(true);
    });
    it('emits exactly once on a valid response, with logging disabled', async () => {
        run.mockResolvedValue(result());
        const observer = vi.fn();
        await callAiProvider(plugin, vault, 'prompt', null, 'manuscript', '1', undefined, observer);
        expect(observer).toHaveBeenCalledTimes(1);
        expect(observer.mock.calls[0][0]).toMatchObject({ costUSD: 0.006, partial: false, cache: 'none' });
    });
    it.each(['invalid-json', 'provider-error'])('retains billed usage when %s fails', async failure => {
        run.mockResolvedValue(result(failure === 'invalid-json'
            ? { content: 'invalid' } : { aiStatus: 'error', error: 'Failed validation' }));
        const observer = vi.fn();
        await expect(callAiProvider(plugin, vault, 'prompt', 'subplot', 'subplot', '1', undefined, observer)).rejects.toThrow();
        expect(observer).toHaveBeenCalledTimes(1);
        expect(observer.mock.calls[0][0].costUSD).toBe(0.006);
    });
    it('emits unavailable instead of zero when the runtime throws before returning usage', async () => {
        run.mockRejectedValue(new Error('network failed'));
        const observer = vi.fn();
        await expect(callAiProvider(plugin, vault, 'prompt', null, 'manuscript', '1', undefined, observer)).rejects.toThrow('network failed');
        expect(observer).toHaveBeenCalledTimes(1);
        expect(observer.mock.calls[0][0]).toMatchObject({ costUSD: null, partial: true });
    });
});

describe('Pulse run request', () => {
    it('regenerates on every run: skips the in-memory answer cache, not the provider cache', () => {
        const request = buildPulseRunRequest('Triplet prompt');
        expect(request.bypassInMemoryCache).toBe(true);
        expect(request.bypassProviderReuse).toBeUndefined();
    });
});
