/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Event targets checked in any window. A popout window has its own Element and
 * Node classes, so `target instanceof Element` is false for its elements;
 * Obsidian's `instanceOf` knows them.
 */

/** The element an event target is, in any window. Null for no target, or one that is not a node (a window). */
export function elementOf(target: EventTarget | null): Element | null {
    const node = target as Node | null;
    return node?.instanceOf?.(Element) ? node : null;
}

/** Whether a mouseout, pointerout or dragleave leaves `el` itself, rather than moving onto one of its children. */
export function movesOutOf(el: Element, event: MouseEvent): boolean {
    const related = event.relatedTarget as Node | null;
    return !related?.instanceOf?.(Node) || !el.contains(related);
}
