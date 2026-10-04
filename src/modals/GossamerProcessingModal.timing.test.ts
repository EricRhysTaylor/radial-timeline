import { afterEach, describe, expect, it, vi } from 'vitest';
import { GossamerProcessingModal } from './GossamerProcessingModal';
import type { GossamerRunTiming } from '../gossamer/runTiming';

function timingModal(saveSettings = vi.fn().mockResolvedValue(undefined)) {
    const settings: { gossamerLastRunTiming?: GossamerRunTiming } = {};
    // SAFE: use real modal lifecycle methods with only display/storage seams supplied.
    const modal = Object.assign(Object.create(GossamerProcessingModal.prototype), {
        plugin: { settings, saveSettings },
        apiStatusEl: { empty: vi.fn(), setText: vi.fn() },
        progressSimulator: { start: vi.fn(), stop: vi.fn(), complete: vi.fn(), fail: vi.fn() },
        clearCacheTimerInterval: vi.fn()
    }) as {
        apiCallStarted(estimateMs: number): void;
        apiCallSuccess(): void;
        completeProcessing(success: boolean, message: string): void;
        onClose(): void;
        persistLastRunDuration(elapsedMs: number): Promise<void>;
        progressSimulator: { start: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };
    };
    return { modal, settings, saveSettings };
}

describe('Gossamer timing lifecycle', () => {
    afterEach(() => vi.useRealTimers());

    it('cleans up restarted and terminal timers even when the provider throws', () => {
        vi.useFakeTimers();
        const { modal } = timingModal();
        modal.apiCallStarted(20_000);
        modal.apiCallStarted(20_000);
        expect(vi.getTimerCount()).toBe(1);
        expect(modal.progressSimulator.start).toHaveBeenLastCalledWith(20_000);
        modal.completeProcessing(false, 'Processing failed');
        expect(vi.getTimerCount()).toBe(0);
        expect(modal.progressSimulator.fail).toHaveBeenCalledOnce();
    });

    it('records the response duration without marking results saved', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-04T02:00:00Z'));
        const { modal, settings, saveSettings } = timingModal();
        modal.apiCallStarted(20_000);
        vi.advanceTimersByTime(18_000);
        modal.apiCallSuccess();
        expect(settings.gossamerLastRunTiming).toEqual({ schemaVersion: 2, durationMs: 18_000 });
        expect(saveSettings).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(modal.progressSimulator.complete).not.toHaveBeenCalled();
        modal.completeProcessing(true, 'Saved');
        expect(modal.progressSimulator.complete).toHaveBeenCalledOnce();
    });

    it('stops the display timer on close and still learns the background request duration', () => {
        vi.useFakeTimers();
        const { modal, settings } = timingModal();
        modal.apiCallStarted(20_000);
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
            modal.apiCallStarted(20_000);
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

describe('Gossamer modal cache display', () => {
    afterEach(() => vi.useRealTimers());

    it('clears a nonmatching window instead of inheriting another book cache', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100);
        const element = { empty: vi.fn(), addClass: vi.fn(), removeClass: vi.fn(), setText: vi.fn() };
        const warm = { provider: 'anthropic' as const, modelLabel: 'Opus', armedAt: 100, expiresAt: 10_000 };
        // SAFE: exercise the real modal cache lifecycle with a minimal DOM seam.
        const modal = Object.assign(Object.create(GossamerProcessingModal.prototype), {
            plugin: { gossamerCacheWindows: new Map([['another-book', { window: warm }]]) },
            cacheTimerEl: element,
            cacheWindow: null
        }) as GossamerProcessingModal;
        modal.setCacheWindow(warm);
        expect(element.setText).toHaveBeenCalledWith(expect.stringContaining('unchanged input may reuse it'));
        expect(vi.getTimerCount()).toBe(1);
        modal.setCacheWindow(null);
        expect(element.addClass).toHaveBeenCalledWith('ert-hidden');
        expect(vi.getTimerCount()).toBe(0);
    });
});
