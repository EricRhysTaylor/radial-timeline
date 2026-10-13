/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Hovering a scene on the wheel lights up its row in any open Timetable, so
 * the two views read as one instrument. The Timetable does the reverse
 * through the plugin's scene highlighter.
 */

import { markTimetableRows, revealTimetableSegment, type TimelineColoring, type TimelineLens } from '../../timetable/timetableRegistry';
import { formatNumber } from '../../utils/svg';

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

const COLORED = 'rt-colored-by';

/**
 * A Timetable column colors the scenes: each scene cell takes its value's
 * color, and a scene without a value is drawn neutral. The fill is set inline
 * so it sits above the status and subplot fills without replacing them; clearing
 * the coloring restores them.
 */
export function applyColoringToSvg(svg: Element, coloring: TimelineColoring | null): void {
    svg.querySelectorAll<SVGElement>(`.${COLORED}`).forEach(element => {
        element.setCssProps({ fill: '' });
        element.classList.remove(COLORED);
    });
    if (!coloring) return;
    const slotOf = new Map(coloring.legend.map(entry => [entry.value, entry.colorIndex]));
    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]').forEach(group => {
        const cell = group.querySelector<SVGElement>('.rt-scene-path');
        if (!cell) return;
        const path = scenePathOf(group);
        const value = path ? coloring.values.get(path) : undefined;
        const slot = value !== undefined ? slotOf.get(value) : undefined;
        cell.setCssProps({ fill: slot !== undefined ? `var(--rt-subplot-colors-${slot})` : 'var(--background-modifier-border-hover)' });
        cell.classList.add(COLORED);
    });
}

const QUERY_DOT = 'rt-query-dot';

/**
 * Open author queries (`%%query: …%%`) show as a dot at the center of each of
 * a scene's cells; the Timetable lists and counts them. `queries` maps a scene
 * path to its open questions. The dot sits inside the scene's group, so it
 * fades and recedes with the scene (Gossamer, the lens) and a click on it
 * opens the scene.
 */
export function applyQueryDots(svg: Element, queries: Map<string, string[]>, describe: (questions: string[]) => string): void {
    svg.querySelectorAll(`.${QUERY_DOT}`).forEach(element => element.remove());
    const doc = svg.ownerDocument;
    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"][data-path]').forEach(group => {
        const path = scenePathOf(group);
        const questions = path ? queries.get(path) : undefined;
        if (!questions || questions.length === 0) return;
        const center = cellCenter(group);
        if (!center) return;
        const dot = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('class', QUERY_DOT);
        dot.setAttribute('cx', formatNumber(center.x));
        dot.setAttribute('cy', formatNumber(center.y));
        dot.setAttribute('r', '9');
        const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = describe(questions);
        dot.appendChild(title);
        group.appendChild(dot);
    });
}

/** The middle of a scene cell, from the arc its group records (radians, centered on the wheel). */
function cellCenter(group: Element): { x: number; y: number } | null {
    const start = Number(group.getAttribute('data-start-angle-raw') ?? group.getAttribute('data-start-angle'));
    let end = Number(group.getAttribute('data-end-angle-raw') ?? group.getAttribute('data-end-angle'));
    const inner = Number(group.getAttribute('data-inner-r'));
    const outer = Number(group.getAttribute('data-outer-r'));
    if (![start, end, inner, outer].every(Number.isFinite)) return null;
    if (end < start) end += Math.PI * 2;
    const angle = (start + end) / 2;
    const radius = (inner + outer) / 2;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}
