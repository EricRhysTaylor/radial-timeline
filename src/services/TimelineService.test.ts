import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { TimelineService } from './TimelineService';

describe('Holding timeline refreshes while a batch of notes is written', () => {
    afterEach(() => vi.useRealTimers());

    function service() {
        const app = { workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null } } as unknown as App;
        const timeline = new TimelineService(app, {} as RadialTimelinePlugin);
        const scheduled = vi.spyOn(timeline, 'scheduleRender');
        return { timeline, scheduled };
    }

    it('lets refreshes through when nothing is held', () => {
        const { timeline } = service();
        expect(timeline.deferRefresh()).toBe(false);
    });

    it('defers every refresh asked for during the batch, then refreshes once', async () => {
        const { timeline, scheduled } = service();
        let finish!: () => void;
        const batch = timeline.holdRefreshes(() => new Promise<void>(resolve => { finish = resolve; }));
        // Obsidian reads the new notes one by one; each would redraw the open timeline.
        expect(timeline.deferRefresh()).toBe(true);
        expect(timeline.deferRefresh()).toBe(true);
        expect(scheduled).not.toHaveBeenCalled();
        finish();
        await batch;
        expect(scheduled).toHaveBeenCalledOnce();
        expect(timeline.deferRefresh()).toBe(false);
        timeline.cancelPendingRender();
    });

    it('refreshes once even when the batch fails, and not at all when nothing asked to', async () => {
        const { timeline, scheduled } = service();
        await expect(timeline.holdRefreshes(async () => { timeline.deferRefresh(); throw new Error('Disk full'); })).rejects.toThrow('Disk full');
        expect(scheduled).toHaveBeenCalledOnce();
        scheduled.mockClear();
        await timeline.holdRefreshes(async () => {});
        expect(scheduled).not.toHaveBeenCalled();
        timeline.cancelPendingRender();
    });
});
