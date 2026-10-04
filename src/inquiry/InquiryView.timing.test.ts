import { describe, expect, it, vi } from 'vitest';
import { InquiryView } from './InquiryView';
import type { InquiryResult } from './types';
import type { InquiryRunProgressEvent, InquiryRunTrace } from './runner/types';
import type { InquiryTimingHistory } from '../types/settings';
import { DisposableRegistry } from '../core/disposable';
import { FIRST_RUN_PASS_MS } from './services/inquiryTimingPrediction';
import { PROGRESS_AT_ESTIMATE, PROGRESS_CEILING } from '../utils/simulatedProgress';

type TimingView = {
    recordInquiryTimingSample(result: Partial<InquiryResult>, trace?: Partial<InquiryRunTrace>): Promise<void>;
    predictNextRunDuration(): { durationMs: number; source: string };
    getRunningBackboneProgressRatio(elapsedMs: number): number;
    currentRunProgress: InquiryRunProgressEvent | null;
};

function timingView(saveSettings = vi.fn().mockResolvedValue(undefined), expectedPassCount = 1) {
    const settings: { inquiryTimingHistory?: InquiryTimingHistory } = {};
    // SAFE: exercise real timing and progress methods without the Obsidian/SVG shell.
    const view = Object.assign(Object.create(InquiryView.prototype), {
        plugin: { settings, saveSettings },
        settingsAccessor: { getTimingHistory: () => settings.inquiryTimingHistory },
        buildReadinessUiState: () => ({ expectedPassCount }),
        currentRunEstimatedMaxMs: 100_000,
        currentRunProgress: null
    }) as TimingView;
    return { view, settings, saveSettings };
}

describe('Inquiry timing observation lifecycle', () => {
    it('replaces history on every answered question, regardless of provider or model', async () => {
        const { view, settings, saveSettings } = timingView();
        // SAFE: older vaults hold obsolete keyed, input-scaled entries.
        settings.inquiryTimingHistory = { 'anthropic::claude-sonnet-4-6::full': { lastDurationMs: 74_719 } } as unknown as InquiryTimingHistory;
        for (const [aiProvider, aiModel, roundTripMs] of [
            ['anthropic', 'first', 68_075], ['openai', 'second', 45_370]
        ] as const) {
            await view.recordInquiryTimingSample({ aiStatus: 'success', aiProvider, aiModel, roundTripMs }, {});
            expect(Object.keys(settings.inquiryTimingHistory!)).toEqual(['latest']);
            expect(settings.inquiryTimingHistory?.latest).toMatchObject({ schemaVersion: 2, passDurationMs: roundTripMs });
        }
        expect(saveSettings).toHaveBeenCalledTimes(2);
    });

    it('records the time of one pass for multi-pass questions', async () => {
        const { view, settings } = timingView();
        await view.recordInquiryTimingSample({ aiStatus: 'success', roundTripMs: 180_000 }, { executionPassCount: 3 });
        expect(settings.inquiryTimingHistory?.latest?.passDurationMs).toBe(60_000);
    });

    it('records recovered answers but keeps the observation through failed and simulated runs', async () => {
        const { view, settings, saveSettings } = timingView();
        await view.recordInquiryTimingSample({ aiStatus: 'degraded', roundTripMs: 84_930 }, {});
        const previous = settings.inquiryTimingHistory;
        await view.recordInquiryTimingSample({ aiStatus: 'rejected', roundTripMs: 500 }, {});
        await view.recordInquiryTimingSample({ aiStatus: 'timeout', roundTripMs: 500 }, {});
        await view.recordInquiryTimingSample({ aiStatus: 'success', aiReason: 'simulated', roundTripMs: 500 }, {});
        await view.recordInquiryTimingSample({ aiStatus: 'success', aiReason: 'stub', roundTripMs: 500 }, {});
        await view.recordInquiryTimingSample({ aiStatus: 'success' }, {});
        expect(settings.inquiryTimingHistory).toBe(previous);
        expect(previous?.latest?.passDurationMs).toBe(84_930);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('handles persistence failures without rejecting a completed answer', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const { view, settings } = timingView(vi.fn().mockRejectedValue(new Error('disk unavailable')));
            await expect(view.recordInquiryTimingSample({ aiStatus: 'success', roundTripMs: 160_000 }, {})).resolves.toBeUndefined();
            expect(settings.inquiryTimingHistory?.latest?.passDurationMs).toBe(160_000);
            expect(warning).toHaveBeenCalled();
        } finally {
            warning.mockRestore();
        }
    });

    it('times the next question from the last one and the passes the corpus needs', async () => {
        const { view } = timingView(undefined, 2);
        expect(view.predictNextRunDuration()).toEqual({ durationMs: FIRST_RUN_PASS_MS * 2, source: 'first_run_default' });
        await view.recordInquiryTimingSample({ aiStatus: 'success', roundTripMs: 45_370 }, {});
        expect(view.predictNextRunDuration()).toEqual({ durationMs: 90_740, source: 'latest_run' });
    });

    it('keeps the bar short of full until the response arrives', () => {
        const { view } = timingView();
        expect(view.getRunningBackboneProgressRatio(50_000)).toBeCloseTo(PROGRESS_AT_ESTIMATE / 2, 6);
        expect(view.getRunningBackboneProgressRatio(100_000)).toBeCloseTo(PROGRESS_AT_ESTIMATE, 6);
        expect(view.getRunningBackboneProgressRatio(300_000)).toBeLessThan(PROGRESS_CEILING);
        view.currentRunProgress = { phase: 'finalizing', currentPass: 1, totalPasses: 1 };
        expect(view.getRunningBackboneProgressRatio(50_000)).toBe(1);
    });

    it('jumps ahead to completed passes when a multi-pass run outpaces its budget', () => {
        const { view } = timingView();
        view.currentRunProgress = { phase: 'chunk', currentPass: 3, totalPasses: 4 };
        expect(view.getRunningBackboneProgressRatio(1_000)).toBe(0.5);
    });

    it('releases minimap animations when closing the view without cancelling the background run', async () => {
        const minimap = { stopRunningAnimations: vi.fn(), cancelFadeOut: vi.fn() };
        // SAFE: real close/cleanup registration; no workspace or rendered SVG required.
        const view = Object.assign(Object.create(InquiryView.prototype), {
            state: { isRunning: true },
            viewDisposables: new DisposableRegistry(),
            sessionStore: { flush: vi.fn().mockResolvedValue(undefined) },
            minimap,
            contentEl: { empty: vi.fn() }
        }) as { registerViewTimerCleanups(): void; onClose(): Promise<void>; state: { isRunning: boolean } };
        view.registerViewTimerCleanups();
        await view.onClose();
        expect(minimap.stopRunningAnimations).toHaveBeenCalledOnce();
        expect(minimap.cancelFadeOut).toHaveBeenCalledOnce();
        expect(view.state.isRunning).toBe(true);
    });
});
