import { afterEach, describe, expect, it, vi } from 'vitest';
import { GossamerProcessingModal } from './GossamerProcessingModal';
import type { GossamerRunTiming } from '../gossamer/runTiming';

function timingModal(saveSettings = vi.fn().mockResolvedValue(undefined)) {
    const settings: { gossamerLastRunTiming?: GossamerRunTiming } = {};
    // SAFE: use real modal lifecycle methods with only display/storage seams supplied.
    const modal = Object.assign(Object.create(GossamerProcessingModal.prototype), {
        plugin: { settings, saveSettings },
        manuscriptInfo: { totalWords: 100_000 },
        apiStatusEl: { empty: vi.fn(), setText: vi.fn() },
        progressSimulator: { start: vi.fn(), stop: vi.fn(), complete: vi.fn(), fail: vi.fn() },
        clearCacheTimerInterval: vi.fn()
    }) as {
        apiCallStarted(): void;
        apiCallSuccess(): void;
        completeProcessing(success: boolean, message: string): void;
        onClose(): void;
        persistLastRunDuration(elapsedMs: number): Promise<void>;
        manuscriptInfo: { totalWords: number };
        progressSimulator: { complete: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };
    };
    return { modal, settings, saveSettings };
}

describe('Gossamer timing lifecycle', () => {
    afterEach(() => vi.useRealTimers());

    it('cleans up restarted and terminal timers even when the provider throws', () => {
        vi.useFakeTimers();
        const { modal } = timingModal();
        modal.apiCallStarted();
        modal.apiCallStarted();
        expect(vi.getTimerCount()).toBe(1);
        modal.completeProcessing(false, 'Processing failed');
        expect(vi.getTimerCount()).toBe(0);
        expect(modal.progressSimulator.fail).toHaveBeenCalledOnce();
    });

    it('records the request size and response duration without marking results saved', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-04T02:00:00Z'));
        const { modal, settings, saveSettings } = timingModal();
        modal.apiCallStarted();
        modal.manuscriptInfo.totalWords = 200_000;
        vi.advanceTimersByTime(18_000);
        modal.apiCallSuccess();
        expect(settings.gossamerLastRunTiming).toEqual({ schemaVersion: 1, durationMs: 18_000, manuscriptWords: 100_000 });
        expect(saveSettings).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(modal.progressSimulator.complete).not.toHaveBeenCalled();
        modal.completeProcessing(true, 'Saved');
        expect(modal.progressSimulator.complete).toHaveBeenCalledOnce();
    });

    it('stops the display timer on close and still learns the background request duration', () => {
        vi.useFakeTimers();
        const { modal, settings } = timingModal();
        modal.apiCallStarted();
        vi.advanceTimersByTime(10_000);
        modal.onClose();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(10_000);
        modal.apiCallSuccess();
        expect(settings.gossamerLastRunTiming?.durationMs).toBe(20_000);
    });

    it('handles a timing-save failure and rejects invalid elapsed observations', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const { modal, settings, saveSettings } = timingModal(vi.fn().mockRejectedValue(new Error('disk unavailable')));
            modal.apiCallStarted();
            await expect(modal.persistLastRunDuration(20_000)).resolves.toBeUndefined();
            const previous = settings.gossamerLastRunTiming;
            for (const invalid of [0, -1, NaN, Infinity]) await modal.persistLastRunDuration(invalid);
            expect(settings.gossamerLastRunTiming).toBe(previous);
            expect(saveSettings).toHaveBeenCalledOnce();
            expect(warning).toHaveBeenCalled();
            modal.onClose();
        } finally {
            warning.mockRestore();
        }
    });
});
