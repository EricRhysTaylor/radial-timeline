import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HoverPopoverController } from './hoverPopoverController';

// Vitest runs in a node environment — provide just enough of a DOM surface
// for the controller's `panel.classList` and `window.setTimeout` calls.
function makePanel(): { el: HTMLElement; classList: Set<string> } {
    const classList = new Set<string>();
    const el = {
        classList: {
            add: (cls: string) => { classList.add(cls); },
            remove: (cls: string) => { classList.delete(cls); },
            contains: (cls: string) => classList.has(cls),
        }
    } as unknown as HTMLElement;
    return { el, classList };
}

describe('HoverPopoverController', () => {
    beforeEach(() => {
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

    it('show() removes ert-hidden, runs beforeShow + positionPanel hooks', () => {
        const { el, classList } = makePanel();
        classList.add('ert-hidden');
        const beforeShow = vi.fn();
        const positionPanel = vi.fn();
        const c = new HoverPopoverController({ beforeShow, positionPanel }, 500);
        c.attach(el);

        c.show();

        expect(classList.has('ert-hidden')).toBe(false);
        expect(beforeShow).toHaveBeenCalledTimes(1);
        expect(positionPanel).toHaveBeenCalledTimes(1);
    });

    it('hide() adds ert-hidden when not pinned', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.show();

        c.hide();

        expect(classList.has('ert-hidden')).toBe(true);
    });

    it('hide() without force is a no-op when pinned', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.toggle();
        expect(c.isPinned()).toBe(true);
        expect(classList.has('ert-hidden')).toBe(false);

        c.hide();

        expect(classList.has('ert-hidden')).toBe(false);
    });

    it('hide(force=true) overrides pinned and hides', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.toggle();

        c.hide(true);

        expect(classList.has('ert-hidden')).toBe(true);
        // pinned state is preserved on a forced hide (matches legacy behavior).
        expect(c.isPinned()).toBe(true);
    });

    it('toggle() pins-and-shows then unpins-and-hides', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);

        c.toggle();
        expect(c.isPinned()).toBe(true);
        expect(classList.has('ert-hidden')).toBe(false);

        c.toggle();
        expect(c.isPinned()).toBe(false);
        expect(classList.has('ert-hidden')).toBe(true);
    });

    it('scheduleHide() fires after the configured delay', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.show();

        c.scheduleHide();
        expect(classList.has('ert-hidden')).toBe(false);

        vi.advanceTimersByTime(499);
        expect(classList.has('ert-hidden')).toBe(false);

        vi.advanceTimersByTime(1);
        expect(classList.has('ert-hidden')).toBe(true);
    });

    it('scheduleHide() is a no-op while pinned', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.toggle();

        c.scheduleHide();
        vi.advanceTimersByTime(1000);

        expect(classList.has('ert-hidden')).toBe(false);
    });

    it('cancelHide() prevents the scheduled hide from firing', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.show();

        c.scheduleHide();
        c.cancelHide();
        vi.advanceTimersByTime(1000);

        expect(classList.has('ert-hidden')).toBe(false);
    });

    it('cleanup() cancels the pending timer and is idempotent', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.show();
        c.scheduleHide();

        c.cleanup();
        vi.advanceTimersByTime(1000);

        expect(classList.has('ert-hidden')).toBe(false);
        // Calling cleanup again must not throw.
        expect(() => c.cleanup()).not.toThrow();
    });

    it('cleanup() detaches the panel so later hide()/show() are no-ops', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.show();
        c.cleanup();

        c.hide(true);
        c.show();

        // Panel was detached, so classList stays in whatever state it was
        // left in by the pre-cleanup show().
        expect(classList.has('ert-hidden')).toBe(false);
    });

    it('show()/hide() are safe before attach()', () => {
        const c = new HoverPopoverController({}, 500);
        expect(() => c.show()).not.toThrow();
        expect(() => c.hide(true)).not.toThrow();
        expect(() => c.toggle()).not.toThrow();
    });

    it('unpin() clears pinned without changing visibility', () => {
        const { el, classList } = makePanel();
        const c = new HoverPopoverController({}, 500);
        c.attach(el);
        c.toggle();
        expect(c.isPinned()).toBe(true);

        c.unpin();

        expect(c.isPinned()).toBe(false);
        expect(classList.has('ert-hidden')).toBe(false);
    });
});
