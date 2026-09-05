import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SceneDossierController } from './sceneDossierController';
import type { InquirySceneDossier } from '../types/inquiryViewTypes';

// Minimal stand-in for the dossier model. The controller only forwards it
// untouched through the onRender hook, so structure doesn't matter for these
// lifecycle/timer characterization tests.
const stubDossier = { id: 'd1' } as unknown as InquirySceneDossier;
const otherDossier = { id: 'd2' } as unknown as InquirySceneDossier;

describe('SceneDossierController', () => {
    let onRender: ReturnType<typeof vi.fn>;
    let onClear: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onRender = vi.fn();
        onClear = vi.fn();
        vi.stubGlobal('window', {
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function build(hoverDelay = 100, hideDelay = 200) {
        return new SceneDossierController(
            { onRender, onClear },
            { hoverDelayMs: hoverDelay, hideDelayMs: hideDelay }
        );
    }

    it('queue() debounces the first show by the configured hover delay', () => {
        const c = build();
        c.queue('k1', stubDossier);

        expect(onRender).not.toHaveBeenCalled();

        vi.advanceTimersByTime(99);
        expect(onRender).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onRender).toHaveBeenCalledWith(stubDossier, 'k1');
        expect(c.isVisible()).toBe(true);
    });

    it('queue() while visible renders the next dossier immediately (no debounce)', () => {
        const c = build();
        c.queue('k1', stubDossier);
        vi.advanceTimersByTime(100);
        onRender.mockClear();

        c.queue('k2', otherDossier);

        // No timer advance — render must be synchronous because visible was true.
        expect(onRender).toHaveBeenCalledWith(otherDossier, 'k2');
    });

    it('queue() with the same key while waiting resets the debounce (snap-show requires prior render)', () => {
        // activeKey is only set AFTER the timer fires, so a re-queue while still
        // waiting does NOT snap-show — it cancels the pending timer and arms
        // a fresh one. Matches the legacy semantics where sceneDossierActiveKey
        // was only assigned inside showSceneDossier.
        const c = build();
        c.queue('k1', stubDossier);
        c.queue('k1', stubDossier);

        expect(onRender).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(onRender).toHaveBeenCalledTimes(1);
    });

    it('queue() with the same key AFTER a prior render snap-shows', () => {
        // Once visible, the legacy snap-on-rehover behavior kicks in regardless
        // of which key is hovered next.
        const c = build();
        c.queue('k1', stubDossier);
        vi.advanceTimersByTime(100); // first render fires; activeKey='k1', visible
        onRender.mockClear();

        c.queue('k1', stubDossier);

        // visible was true → snap.
        expect(onRender).toHaveBeenCalledTimes(1);
    });

    it('hide(false) while visible schedules onClear after the hide delay', () => {
        const c = build();
        c.queue('k1', stubDossier);
        vi.advanceTimersByTime(100);
        onClear.mockClear();

        c.hide();
        expect(onClear).not.toHaveBeenCalled();

        vi.advanceTimersByTime(199);
        expect(onClear).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(c.isVisible()).toBe(false);
    });

    it('hide(true) calls onClear synchronously and resets state', () => {
        const c = build();
        c.queue('k1', stubDossier);
        vi.advanceTimersByTime(100);

        c.hide(true);

        expect(onClear).toHaveBeenCalledTimes(1);
        expect(c.isVisible()).toBe(false);
    });

    it('hide() when not visible still calls onClear (resets cross-cutting flags)', () => {
        // Matches the legacy "always reset minimapResultPreviewActive" path.
        const c = build();

        c.hide();

        expect(onClear).toHaveBeenCalledTimes(1);
        expect(c.isVisible()).toBe(false);
    });

    it('a pending show is cancelled by a subsequent hide(true)', () => {
        const c = build();
        c.queue('k1', stubDossier);

        c.hide(true);
        vi.advanceTimersByTime(500);

        expect(onRender).not.toHaveBeenCalled();
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('a pending hide is cancelled by a subsequent queue() on the same key', () => {
        const c = build();
        c.queue('k1', stubDossier);
        vi.advanceTimersByTime(100); // visible
        c.hide(); // hide timer armed
        onRender.mockClear();
        onClear.mockClear();

        c.queue('k1', stubDossier);

        // queue cancels hide and snap-renders.
        vi.advanceTimersByTime(500);
        expect(onClear).not.toHaveBeenCalled();
        expect(onRender).toHaveBeenCalledTimes(1);
    });

    it('cleanup() cancels both pending timers and is idempotent', () => {
        const c = build();
        c.queue('k1', stubDossier);
        // queue then hide arms both timers in sequence; cleanup should clear any.
        c.cleanup();
        vi.advanceTimersByTime(1000);

        expect(onRender).not.toHaveBeenCalled();
        expect(onClear).not.toHaveBeenCalled();
        expect(c.isVisible()).toBe(false);
        expect(() => c.cleanup()).not.toThrow();
    });

    it('cleanup() after a visible session resets internal state without firing hooks', () => {
        const c = build();
        c.queue('k1', stubDossier);
        vi.advanceTimersByTime(100);
        onRender.mockClear();
        onClear.mockClear();

        c.cleanup();

        // cleanup does NOT invoke onClear — host owns visual teardown directly
        // in onClose if it wants. Controller only releases timers and state.
        expect(onClear).not.toHaveBeenCalled();
        expect(c.isVisible()).toBe(false);
    });

    it('after cleanup, queue() arming new timers is dropped via cancelShow on subsequent hide', () => {
        // Defensive: even if the controller is reused after cleanup (it
        // shouldn't be — host should construct a new one on next onOpen),
        // hide() must still synchronously clear any new queued show.
        const c = build();
        c.cleanup();
        c.queue('k1', stubDossier);
        c.hide(true);
        vi.advanceTimersByTime(500);

        expect(onRender).not.toHaveBeenCalled();
    });
});
