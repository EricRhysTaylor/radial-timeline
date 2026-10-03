import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vault, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { SceneAnalysisProcessingModal, ProcessingMode } from '../modals/SceneAnalysisProcessingModal';
import type { SceneData } from './types';
import type { PulseUsageReport } from './usage';
import { summarizePulseUsage } from './usage';
import { processWithModal, processSubplotWithModal, processEntireSubplotWithModalInternal } from './Processor';

const { getAllSceneData, provider, update } = vi.hoisted(() => ({
    getAllSceneData: vi.fn(), provider: vi.fn(), update: vi.fn()
}));
vi.mock('./aiProvider', () => ({ callAiProvider: provider }));
vi.mock('./FileUpdater', () => ({ updateSceneAnalysis: update, setSceneAnalysisReviewWarning: vi.fn() }));
vi.mock('./data', () => ({
    getAllSceneData,
    compareScenesByOrder: (a: SceneData, b: SceneData) => a.sceneNumber! - b.sceneNumber!,
    getSubplotNamesFromFM: () => ['Romance'],
    hasBeenProcessedForBeats: (fm: Record<string, unknown>) => fm.done === true,
    hasProcessableContent: () => true,
    getPulseUpdateFlag: () => true
}));
vi.mock('../ai/runtime/runtimeSelection', () => ({
    getCanonicalAiSettings: () => ({ provider: 'anthropic' }),
    resolveConfiguredSelection: () => ({ provider: 'anthropic' })
}));

const report: PulseUsageReport = { provider: 'anthropic', model: 'claude-opus-5-5', costUSD: 0.05, partial: false, cache: 'hit', cacheDetail: 'HIT' };
const scenes: SceneData[] = [1, 2].map(n => ({
    file: { basename: `${n} Scene`, path: `${n}.md` } as TFile,
    sceneNumber: n, frontmatter: {}, body: 'Scene prose'
}));
function setup() {
    const reports: PulseUsageReport[] = [];
    const modal = {
        recordPulseUsage: vi.fn((_scene: string, value: PulseUsageReport) => reports.push(value)),
        isAborted: vi.fn(() => false), addError: vi.fn(), noteLogAttempt: vi.fn(),
        setProcessingQueue: vi.fn(), updateProgress: vi.fn()
    };
    const plugin = {
        settings: {}, openScenePaths: new Set(['1.md', '2.md']),
        saveSettings: vi.fn(), refreshTimelineIfNeeded: vi.fn()
    } as unknown as RadialTimelinePlugin;
    return { reports, modal, typedModal: modal as unknown as SceneAnalysisProcessingModal, plugin, vault: {} as Vault };
}
beforeEach(() => {
    vi.clearAllMocks();
    getAllSceneData.mockResolvedValue(scenes.map(scene => ({ ...scene, frontmatter: {} })));
    update.mockResolvedValue(true);
    provider.mockImplementation(async (...args: unknown[]) => {
        const observer = args[7] as (report: PulseUsageReport) => void;
        observer(report);
        return { result: '{}', parsedAnalysis: { previousSceneAnalysis: '', currentSceneAnalysis: '1 A', nextSceneAnalysis: '' }, attribution: 'Opus', providerUsed: 'anthropic' };
    });
});

const paths = [
    ...(['flagged', 'open', 'force-all', 'unprocessed'] as ProcessingMode[]).map(mode => ({
        name: `manuscript ${mode}`,
        run: (s: ReturnType<typeof setup>) => processWithModal(s.plugin, s.vault, mode, s.typedModal)
    })),
    { name: 'flagged subplot', run: (s: ReturnType<typeof setup>) => processSubplotWithModal(s.plugin, s.vault, 'Romance', s.typedModal) },
    { name: 'entire subplot', run: (s: ReturnType<typeof setup>) => processEntireSubplotWithModalInternal(s.plugin, s.vault, 'Romance', s.typedModal) }
];
describe.each(paths)('$name completion usage wiring', ({ run }) => {
    it('reports each billed response and retains costs when scene writes fail', async () => {
        const s = setup();
        update.mockResolvedValueOnce(false);
        await run(s);
        expect(s.modal.recordPulseUsage).toHaveBeenCalledTimes(2);
        expect(s.modal.addError).toHaveBeenCalledTimes(1);
        expect(summarizePulseUsage(s.reports).costUSD).toBe(0.1);
    });
    it('retains a failed request report and keeps unstarted calls out after cancellation', async () => {
        const s = setup();
        provider.mockImplementationOnce(async (...args: unknown[]) => {
            (args[7] as (r: PulseUsageReport) => void)({ ...report, partial: true });
            s.modal.isAborted.mockReturnValue(true);
            throw new Error('Response invalid');
        });
        await expect(run(s)).rejects.toThrow();
        expect(summarizePulseUsage(s.reports)).toMatchObject({ count: 1, costUSD: 0.05, partial: true });
        expect(provider).toHaveBeenCalledTimes(1);
    });
});
describe('resumed Pulse batch', () => {
    it('counts only newly executed calls, without importing a previous modal total', async () => {
        const s = setup();
        s.plugin.settings._isResuming = true;
        getAllSceneData.mockResolvedValue([{ ...scenes[0], frontmatter: { done: true } }, scenes[1]]);
        await processWithModal(s.plugin, s.vault, 'force-all', s.typedModal);
        expect(summarizePulseUsage(s.reports)).toMatchObject({ count: 1, costUSD: 0.05 });
    });
});
