/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Hovering a scene on the wheel lights up its row in any open Timetable, so
 * the two views read as one instrument. The Timetable does the reverse
 * through the plugin's scene highlighter.
 */

import { markTimetableRows, revealTimetableSegment, type TimelineLens } from '../../timetable/timetableRegistry';

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

/** Clicking an act label (a book label in saga scope) shows that part of any open Timetable. */
export function linkActLabelsToTimetable(view: TimetableLinkView, svg: SVGSVGElement): void {
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', (event: Event) => {
        const label = event.target instanceof Element ? event.target.closest('.rt-act-label[data-act]') : null;
        const index = Number(label?.getAttribute('data-act'));
        if (!label || !Number.isInteger(index)) return;
        revealTimetableSegment(index);
    });
}

const LENS_DIMMED = 'rt-lens-out';

/**
 * A Timetable's lens: every scene, beat and backdrop that isn't among the
 * table's rows is dimmed, so the table's filter reads as a pattern on the
 * wheel. A separate class from hover's rt-non-selected, which hover clears.
 */
export function applyLensToSvg(svg: Element, lens: TimelineLens | null): void {
    svg.querySelectorAll(`.${LENS_DIMMED}`).forEach(element => element.classList.remove(LENS_DIMMED));
    if (!lens) return;
    const dimmedIds = new Set<string>();
    svg.querySelectorAll('.rt-scene-group').forEach(group => {
        const path = scenePathOf(group);
        if (path && lens.paths.has(path)) return;
        group.querySelectorAll('.rt-scene-path, .rt-scene-title').forEach(element => element.classList.add(LENS_DIMMED));
        const sceneId = group.querySelector('.rt-scene-path')?.id;
        if (sceneId) dimmedIds.add(sceneId);
    });
    svg.querySelectorAll('.rt-number-square, .rt-number-text').forEach(element => {
        if (dimmedIds.has(element.getAttribute('data-scene-id') ?? '')) element.classList.add(LENS_DIMMED);
    });
}
