import { describe, expect, it, vi } from 'vitest';
import { InquiryView } from './InquiryView';
import type { InquiryResult } from './types';
import type { InquiryRunTrace } from './runner/types';
import type { InquiryTimingHistoryEntry } from '../types/settings';
import { DisposableRegistry } from '../core/disposable';

function timingView(saveSettings = vi.fn().mockResolvedValue(undefined)) {
    const settings: { inquiryTimingHistory?: Record<string, InquiryTimingHistoryEntry> } = {};
    // SAFE: exercise real timing and progress methods without the Obsidian/SVG shell.
    const view = Object.assign(Object.create(InquiryView.prototype), {
        plugin: { settings, saveSettings },
        refreshEstimateDisplays: vi.fn(),
        currentRunEstimatedMaxMs: 100_000,
        currentRunProgress: null
    }) as {
        recordInquiryTimingSample(result: Partial<InquiryResult>, trace?: Partial<InquiryRunTrace>): Promise<void>;
        getRunningBackboneProgressRatio(elapsedMs: number): number;
    };
    return { view, settings, saveSettings };
}

describe('Inquiry timing observation lifecycle', () => {
    it('replaces history on every successful question, regardless of provider or model', async () => {
        const { view, settings, saveSettings } = timingView();
        for (const [aiProvider, aiModel, roundTripMs] of [
            ['anthropic', 'first', 160_000], ['openai', 'second', 120_000]
        ] as const) {
            await view.recordInquiryTimingSample({ aiStatus: 'success', aiProvider, aiModel, roundTripMs }, { usage: { inputTokens: 220_000 } });
            expect(Object.keys(settings.inquiryTimingHistory!)).toEqual(['latest']);
            expect(settings.inquiryTimingHistory?.latest).toMatchObject({ schemaVersion: 1, lastDurationMs: roundTripMs, lastInputTokens: 220_000 });
        }
        expect(saveSettings).toHaveBeenCalledTimes(2);
    });

    it('keeps the observation through failed, simulated, and usage-free runs', async () => {
        const { view, settings, saveSettings } = timingView();
        await view.recordInquiryTimingSample({ aiStatus: 'success', roundTripMs: 160_000 }, { usage: { inputTokens: 220_000 } });
        const previous = settings.inquiryTimingHistory;
        await view.recordInquiryTimingSample({ aiStatus: 'error', roundTripMs: 500 }, { usage: { inputTokens: 100 } });
        await view.recordInquiryTimingSample({ aiStatus: 'success', aiReason: 'simulated', roundTripMs: 500 }, { usage: { inputTokens: 100 } });
        await view.recordInquiryTimingSample({ aiStatus: 'success', aiReason: 'stub', roundTripMs: 500 }, { usage: { inputTokens: 100 } });
        await view.recordInquiryTimingSample({ aiStatus: 'success', roundTripMs: 500 });
        expect(settings.inquiryTimingHistory).toBe(previous);
        expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('handles persistence failures without rejecting a completed answer', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const { view, settings } = timingView(vi.fn().mockRejectedValue(new Error('disk unavailable')));
            await expect(view.recordInquiryTimingSample({ aiStatus: 'success', roundTripMs: 160_000 }, { usage: { inputTokens: 220_000 } })).resolves.toBeUndefined();
            expect(settings.inquiryTimingHistory?.latest.lastDurationMs).toBe(160_000);
            expect(warning).toHaveBeenCalled();
        } finally {
            warning.mockRestore();
        }
    });

    it('allows progress to reach 100% while the response is still running', () => {
        const { view } = timingView();
        expect(view.getRunningBackboneProgressRatio(50_000)).toBe(0.5);
        expect(view.getRunningBackboneProgressRatio(120_000)).toBe(1);
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
