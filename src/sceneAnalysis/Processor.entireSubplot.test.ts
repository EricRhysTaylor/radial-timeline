import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vault, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { SceneAnalysisProcessingModal } from '../modals/SceneAnalysisProcessingModal';
import type { SceneData } from './types';
import { processEntireSubplotWithModalInternal, processSubplotWithModal } from './Processor';

const { getAllSceneData, provider } = vi.hoisted(() => ({ getAllSceneData: vi.fn(), provider: vi.fn() }));
vi.mock('./aiProvider', () => ({ callAiProvider: provider }));
vi.mock('./FileUpdater', () => ({ updateSceneAnalysis: vi.fn(async () => true), setSceneAnalysisReviewWarning: vi.fn() }));
vi.mock('./data', () => ({
    getAllSceneData,
    compareScenesByOrder: (a: SceneData, b: SceneData) => a.sceneNumber! - b.sceneNumber!,
    getSubplotNamesFromFM: () => ['Romance'],
    hasBeenProcessedForBeats: () => false,
    hasProcessableContent: (fm: Record<string, unknown>) => fm.empty !== true,
    getPulseUpdateFlag: () => true
}));
vi.mock('../ai/runtime/runtimeSelection', () => ({
    getCanonicalAiSettings: () => ({ provider: 'anthropic' }),
    resolveConfiguredSelection: () => ({ provider: 'anthropic' })
}));

// Scene 2 has no content: it must never be a neighbor.
const scenes: SceneData[] = [1, 2, 3].map(n => ({
    file: { basename: `${n} Scene`, path: `${n}.md` } as TFile,
    sceneNumber: n,
    frontmatter: n === 2 ? { empty: true } : {},
    body: n === 2 ? '' : `Scene ${n} prose`
}));

function setup() {
    const modal = {
        recordPulseUsage: vi.fn(), isAborted: vi.fn(() => false), addError: vi.fn(), noteLogAttempt: vi.fn(),
        setProcessingQueue: vi.fn(), updateProgress: vi.fn(), setTripletInfo: vi.fn()
    };
    const plugin = { settings: {}, saveSettings: vi.fn(), refreshTimelineIfNeeded: vi.fn() } as unknown as RadialTimelinePlugin;
    return { modal, typedModal: modal as unknown as SceneAnalysisProcessingModal, plugin, vault: {} as Vault };
}

/** [prev, current, next] scene numbers as each Pulse call showed them. */
const tripletsShown = (modal: ReturnType<typeof setup>['modal']) =>
    modal.setTripletInfo.mock.calls.map(call => call.slice(0, 3));

beforeEach(() => {
    vi.clearAllMocks();
    getAllSceneData.mockResolvedValue(scenes.map(scene => ({ ...scene })));
    provider.mockResolvedValue({
        result: '{}',
        parsedAnalysis: { previousSceneAnalysis: '', currentSceneAnalysis: '1 A', nextSceneAnalysis: '' },
        attribution: 'Opus',
        providerUsed: 'anthropic'
    });
});

describe('entire-subplot Pulse neighbors', () => {
    it('analyzes and neighbors only scenes with content, like the flagged subplot run', async () => {
        const s = setup();
        await processEntireSubplotWithModalInternal(s.plugin, s.vault, 'Romance', s.typedModal);
        const entire = tripletsShown(s.modal);
        // The empty scene 2 is neither analyzed nor a neighbor, so 1 and 3
        // neighbor each other — matching the command's own scene count.
        expect(entire).toEqual([
            ['N/A', '1', '3'],
            ['1', '3', 'N/A']
        ]);
        expect(provider).toHaveBeenCalledTimes(2);

        const flagged = setup();
        await processSubplotWithModal(flagged.plugin, flagged.vault, 'Romance', flagged.typedModal);
        expect(tripletsShown(flagged.modal)).toEqual(entire);
    });
});
