import { describe, expect, it, vi } from 'vitest';
import { listenOnOwnerWindow } from './pressListeners';

/** An element of a popout window: Obsidian's `win` is that window, not the main one. */
function popoutElement() {
    const win = new EventTarget();
    return { win, el: { win } as unknown as Element };
}

describe('listenOnOwnerWindow', () => {
    it('hears the pointer on the window that holds the element, a popout included', () => {
        const { win, el } = popoutElement();
        const move = vi.fn();
        const up = vi.fn();
        listenOnOwnerWindow(el, { pointermove: move, pointerup: up });
        win.dispatchEvent(new Event('pointermove'));
        win.dispatchEvent(new Event('pointerup'));
        expect(move).toHaveBeenCalledOnce();
        expect(up).toHaveBeenCalledOnce();
    });

    it('stops listening when the press ends, and a second stop does nothing', () => {
        const { win, el } = popoutElement();
        const up = vi.fn();
        const key = vi.fn();
        const stop = listenOnOwnerWindow(el, { pointerup: up, keydown: key });
        stop();
        stop();
        win.dispatchEvent(new Event('pointerup'));
        win.dispatchEvent(new Event('keydown'));
        expect(up).not.toHaveBeenCalled();
        expect(key).not.toHaveBeenCalled();
    });

    it('reads the window when the press starts: a view moved to another window is followed there', () => {
        const first = new EventTarget();
        const second = new EventTarget();
        const el = { win: first } as { win: EventTarget };
        const up = vi.fn();
        listenOnOwnerWindow(el as unknown as Element, { pointerup: up })();
        el.win = second;
        listenOnOwnerWindow(el as unknown as Element, { pointerup: up });
        first.dispatchEvent(new Event('pointerup'));
        expect(up).not.toHaveBeenCalled();
        second.dispatchEvent(new Event('pointerup'));
        expect(up).toHaveBeenCalledOnce();
    });
});
