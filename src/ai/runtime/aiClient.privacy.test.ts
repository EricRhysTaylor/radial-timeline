import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { AIProvider, AIProviderId, AIRunRequest } from '../types';
import { AIClient } from './aiClient';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { requestProvider } from '../../api/providerTransport';
import { buildCostComparisonRows } from '../cost/costComparison';
import { buildCanonicalExecutionEstimate } from '../forecast/estimateTokensFromVault';
import { BUILTIN_MODELS } from '../registry/builtinModels';

vi.mock('../../api/providerTransport', () => ({
    requestProvider: vi.fn(() => { throw new Error('Unexpected provider connection during local estimation'); })
}));

function makePlugin(provider: Exclude<AIProviderId, 'none'>, enabled = true) {
    const file = new TFile('Book/1 Fixture.md');
    const raw = '---\nClass: Scene\nSecret: PRIVATE_YAML_SENTINEL\n---\nPublic prose.\n<!-- PRIVATE_HTML_SENTINEL -->\n%% PRIVATE_OBSIDIAN_SENTINEL %%';
    const aiSettings = buildDefaultAiSettings();
    aiSettings.provider = provider;
    aiSettings.privacy.allowProviderSnapshot = true;
    const getSecret = vi.fn(async () => 'fixture-key');
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, enableAiSceneAnalysis: enabled, aiSettings },
        app: {
            vault: { getAbstractFileByPath: () => file, read: async () => raw, cachedRead: async () => raw },
            metadataCache: { getFileCache: () => ({ frontmatter: { Class: 'Scene', ID: 'scn_fixture_audit' } }) },
            secretStorage: { getSecret, setSecret: async () => undefined }
        },
        getActiveBookTitle: () => 'Fixture', saveSettings: async () => undefined
    } as unknown as RadialTimelinePlugin; // SAFE: fixture implements only the AI estimation/execution dependencies
    return { plugin, getSecret, file };
}

const request: AIRunRequest = {
    feature: 'AuditFixture', task: 'EstimateOnly', requiredCapabilities: [], returnType: 'text',
    userInput: 'Public prose. <!-- PRIVATE_HTML_SENTINEL --> %% PRIVATE_OBSIDIAN_SENTINEL %%'
};
beforeEach(() => { vi.mocked(requestProvider).mockClear(); });

describe('estimates send nothing', () => {
    it.each(['openai', 'anthropic', 'google', 'ollama'] as const)('prepares %s estimates offline with no credentials or metadata fetch', async provider => {
        const { plugin, getSecret } = makePlugin(provider, false);
        const client = new AIClient(plugin);
        const pricing = vi.spyOn(client, 'refreshPricing');
        const snapshot = vi.spyOn(client, 'getProviderSnapshot');
        const result = await client.prepareRunEstimate(request);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.estimate.tokenEstimateMethod).toBe('heuristic_chars');
        expect(result.estimate.userPrompt).toContain('Public prose.');
        expect(result.estimate.userPrompt).not.toContain('PRIVATE_');
        expect(getSecret).not.toHaveBeenCalled();
        expect(requestProvider).not.toHaveBeenCalled();
        expect(pricing).not.toHaveBeenCalled();
        expect(snapshot).not.toHaveBeenCalled();
    });

    it('compares cloud costs with Local LLM selected without uploading a corpus or validating cloud keys', async () => {
        const { plugin, getSecret, file } = makePlugin('ollama');
        const models = (['anthropic', 'google', 'openai'] as const).map(provider => {
            const model = BUILTIN_MODELS.find(m => m.provider === provider && m.capabilities.includes('highOutputCap') && !m.id.endsWith('-latest'))!;
            return { provider, modelId: model.id, providerLabel: provider, modelLabel: model.label };
        });
        const rows = await buildCostComparisonRows(models, {
            session: null,
            estimateExecution: (provider, modelId) => buildCanonicalExecutionEstimate({
                plugin, provider, modelId, questionText: 'Estimate only', scope: 'book', scopeLabel: 'Fixture', activeBookId: 'Book',
                manifestEntries: [{ class: 'scene', path: file.path, mode: 'full', sceneId: 'scn_fixture_audit' }],
                vault: plugin.app.vault, metadataCache: plugin.app.metadataCache
            }),
            predictExpectedOutput: () => 100, cacheWindowLabel: () => null
        });
        expect(rows).toHaveLength(3);
        expect(rows.every(row => row.freshText.includes('local input'))).toBe(true);
        expect(getSecret).not.toHaveBeenCalled();
        expect(requestProvider).not.toHaveBeenCalled();
        expect(plugin.settings.aiSettings?.provider).toBe('ollama');
    });
});

function mockProvider(client: AIClient) {
    const generateText = vi.fn(async () => ({
        success: true, content: 'Accepted fixture', responseData: {}, aiStatus: 'success' as const,
        aiProvider: 'openai' as const, aiModelRequested: 'gpt-6.1-sol', aiModelResolved: 'gpt-6.1-sol'
    }));
    const internal = client as unknown as { providers: Record<AIProviderId, AIProvider>; limiter: { waitForSlot: () => Promise<void> } }; // SAFE: inject a provider double to observe dispatch without network
    internal.providers.openai = { id: 'openai', supports: () => true, generateText, generateJson: generateText };
    vi.spyOn(client, 'getProviderSnapshot').mockResolvedValue({ source: 'none', snapshot: null });
    return { generateText, internal };
}

describe('live permission and cache identity', () => {
    it('does not dispatch after the author switches provider or book during the queue wait', async () => {
        const { plugin } = makePlugin('openai');
        const client = new AIClient(plugin);
        const { generateText, internal } = mockProvider(client);
        vi.spyOn(internal.limiter, 'waitForSlot').mockImplementation(async () => { plugin.settings.aiSettings!.provider = 'ollama'; });
        await expect(client.run(request)).rejects.toThrow('AI request cancelled');
        expect(generateText).not.toHaveBeenCalled();
    });
    it('does not dispatch after AI is disabled during a queue wait', async () => {
        const { plugin } = makePlugin('openai');
        const client = new AIClient(plugin);
        const { generateText, internal } = mockProvider(client);
        vi.spyOn(internal.limiter, 'waitForSlot').mockImplementation(async () => { plugin.settings.enableAiSceneAnalysis = false; });
        await expect(client.run(request)).rejects.toThrow('AI request cancelled');
        expect(generateText).not.toHaveBeenCalled();
    });

    it('does not dispatch an explicitly cancelled or disposed run', async () => {
        const { plugin } = makePlugin('openai');
        const client = new AIClient(plugin);
        const { generateText } = mockProvider(client);
        await expect(client.run({ ...request, shouldAbort: () => true })).rejects.toThrow('AI request cancelled');
        client.dispose();
        await expect(client.run(request)).rejects.toThrow('AI request cancelled');
        expect(generateText).not.toHaveBeenCalled();
    });

    it('invalidates output reuse when overrides or credentials change', async () => {
        const { plugin, getSecret } = makePlugin('openai');
        const client = new AIClient(plugin);
        const { generateText, internal } = mockProvider(client);
        vi.spyOn(internal.limiter, 'waitForSlot').mockResolvedValue();
        await client.run(request);
        expect((await client.run(request)).servedFromCache).toBe(true);
        await client.run({ ...request, overrides: { maxOutputMode: 'max' } });
        getSecret.mockResolvedValue('rotated-fixture-key');
        await client.run(request);
        expect(generateText).toHaveBeenCalledTimes(3);
    });
});
