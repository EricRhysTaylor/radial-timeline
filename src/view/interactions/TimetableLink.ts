/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Hovering a scene on the wheel lights up its row in any open Timetable, so
 * the two views read as one instrument. The Timetable does the reverse
 * through the plugin's scene highlighter.
 */

import { markTimetableRows } from '../../timetable/timetableRegistry';

type TimetableLinkView = {
    renderScope: {
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
};

function scenePathOf(target: EventTarget | null): string | null {
    const group = target instanceof Element ? target.closest('.rt-scene-group[data-path]') : null;
    const encoded = group?.getAttribute('data-path');
    if (!encoded) return null;
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded; // SAFE: an unencoded path is already the path
    }
}

export function linkSceneHoverToTimetable(view: TimetableLinkView, svg: SVGSVGElement): void {
    let current: string | null = null;
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (event: Event) => {
        const path = scenePathOf(event.target);
        if (!path || path === current) return;
        current = path;
        markTimetableRows(path);
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (event: Event) => {
        if (current === null) return;
        if (scenePathOf((event as PointerEvent).relatedTarget) === current) return;
        current = null;
        markTimetableRows(null);
    });
}
