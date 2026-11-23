/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * A press followed to its release. Pointer moves, releases and keys reach the
 * window the pressed element is in: a popout window has its own, and the main
 * window never hears them. A press therefore listens on its element's own
 * window, read when the press starts (a view moved to another window takes
 * its elements with it), and stops listening when the press ends.
 */

type PressEventMap = Pick<WindowEventMap, 'pointermove' | 'pointerup' | 'pointercancel' | 'keydown' | 'keyup'>;

export type PressHandlers = { [K in keyof PressEventMap]?: (evt: PressEventMap[K]) => void };

/** Listen on the window that holds `el` until the returned function is called (once is enough; later calls do nothing). */
export function listenOnOwnerWindow(el: Element, handlers: PressHandlers): () => void {
    const win = el.win;
    const entries = Object.entries(handlers) as Array<[keyof PressEventMap, (evt: Event) => void]>;
    // SAFE: a press's listeners live only until it ends; the returned stop removes them (callers also stop on unload), which registerDomEvent cannot do early.
    for (const [type, handler] of entries) win.addEventListener(type, handler);
    let listening = true;
    return () => {
        if (!listening) return;
        listening = false;
        for (const [type, handler] of entries) win.removeEventListener(type, handler);
    };
}
