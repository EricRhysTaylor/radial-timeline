/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Hovering a scene on the wheel lights up its row in any open Timetable, so
 * the two views read as one instrument. The Timetable does the reverse
 * through the plugin's scene highlighter.
 */

import { getIcon } from 'obsidian';
import { markTimetableRows, revealTimetableSegment, type TimelineColoring, type TimelineLens } from '../../timetable/timetableRegistry';
import { formatNumber } from '../../utils/svg';
import { sceneCellColor } from '../../utils/sceneCellColor';

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
    let currentColor: string | null = null;
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (event: Event) => {
        const path = scenePathOf(event.target);
        if (!path) return;
        // The same scene in another ring is another cell, with its own color.
        const group = event.target instanceof Element ? event.target.closest('.rt-scene-group[data-path]') : null;
        const color = group ? sceneCellColor(group) : null;
        if (path === current && color === currentColor) return;
        current = path;
        currentColor = color;
        markTimetableRows(path, color);
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (event: Event) => {
        if (current === null) return;
        if (scenePathOf((event as PointerEvent).relatedTarget) === current) return;
        current = null;
        currentColor = null;
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

const OVERLAY_ATTR = 'data-timetable-overlay';
const LIT = 'rt-overlay-lit';
const COLORED = 'rt-colored-by';

/** The scenes a lens and a coloring light, and the color slot of each colored one (undefined under a lens alone). */
export function litScenes(
    scenes: Array<{ path: string | null; itemType: string | null }>,
    lens: Pick<TimelineLens, 'paths'> | null,
    coloring: Pick<TimelineColoring, 'values' | 'legend'> | null
): Array<{ lit: boolean; slot?: number }> {
    const slotOf = new Map(coloring?.legend.map(entry => [entry.value, entry.colorIndex]) ?? []);
    return scenes.map(({ path, itemType }) => {
        if (!path || (lens && !lens.paths.has(path))) return { lit: false };
        if (!coloring) return { lit: true };
        // A coloring lights only scenes with a value; beats and backdrops have none.
        const value = itemType === 'Scene' ? coloring.values.get(path) : undefined;
        const slot = value !== undefined ? slotOf.get(value) : undefined;
        return slot === undefined ? { lit: false } : { lit: true, slot };
    });
}

/**
 * A Timetable's lens or coloring over the wheel. The scenes it lights (the
 * table's rows; under a coloring, the scenes with a value, in the value's
 * color) stand out, and everything else recedes as in Chronologue's Shift
 * mode: other scenes, beats and backdrops with their numbers and titles, void
 * cells, spokes and the subplot ring titles. The CSS keys on the wheel's
 * data-timetable-overlay attribute; lit elements carry rt-overlay-lit. A
 * coloring's fill is set inline, above the status and subplot fills, and
 * clearing it restores them.
 */
export function applyTimetableOverlayToSvg(svg: Element, lens: TimelineLens | null, coloring: TimelineColoring | null): void {
    svg.querySelectorAll(`.${LIT}`).forEach(element => element.classList.remove(LIT));
    svg.querySelectorAll<SVGElement>(`.${COLORED}`).forEach(element => {
        element.setCssProps({ fill: '' });
        element.classList.remove(COLORED);
    });
    if (!lens && !coloring) {
        svg.removeAttribute(OVERLAY_ATTR);
        return;
    }
    svg.setAttribute(OVERLAY_ATTR, coloring ? 'coloring' : 'lens');
    const groups = Array.from(svg.querySelectorAll('.rt-scene-group'));
    const lit = litScenes(groups.map(group => ({ path: scenePathOf(group), itemType: group.getAttribute('data-item-type') })), lens, coloring);
    const litIds = new Set<string>();
    groups.forEach((group, index) => {
        const { lit: isLit, slot } = lit[index];
        if (!isLit) return;
        group.classList.add(LIT);
        const cell = group.querySelector<SVGElement>('.rt-scene-path');
        if (!cell) return;
        if (cell.id) litIds.add(cell.id);
        if (slot === undefined) return;
        cell.setCssProps({ fill: `var(--rt-subplot-colors-${slot})` });
        cell.classList.add(COLORED);
    });
    // Numbers, and Chronologue's titles drawn above the rings, sit outside the scene groups.
    svg.querySelectorAll('.rt-number-square, .rt-number-text, .rt-scene-title-use').forEach(element => {
        if (litIds.has(element.getAttribute('data-scene-id') ?? '')) element.classList.add(LIT);
    });
}

const QUERY_MARK = 'rt-query-mark';

/** Cell-fit bounds in wheel units; the painted icon is scaled down after fitting. */
const QUERY_ICON_MAX = 28;
const QUERY_ICON_MIN = 14;
const QUERY_ICON_SCALE = 0.8;

/**
 * Open author queries (`%%query: …%%`) show at the center of each of a
 * scene's cells as the Timetable's question bubble, sized to fit the cell. A
 * cell too small for it (a compact All Scenes ring, a Sequence subring) gets
 * a dot. `queries` maps a scene path to its open questions; the Timetable
 * lists them. Chronologue paints marks in the scene foreground so subplot
 * headlines cannot cover them; other modes keep marks in the scene group.
 * Like the number squares, marks let the pointer through to the cell, so
 * clicks, drags and hover behave as on the cell.
 */
export function applyQueryMarks(svg: Element, queries: Map<string, string[]>): void {
    svg.querySelectorAll(`.${QUERY_MARK}`).forEach(element => element.remove());
    const doc = svg.ownerDocument;
    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"][data-path]').forEach(group => {
        const path = scenePathOf(group);
        const questions = path ? queries.get(path) : undefined;
        if (!questions || questions.length === 0) return;
        const cell = cellGeometry(group);
        if (!cell) return;
        // SAFE: Chronologue's renderer always creates this foreground layer.
        const paintParent = svg.getAttribute('data-mode') === 'chronologue'
            ? svg.querySelector('.ert-scene-foreground')!
            : group;
        const mark = queryMarkFor(cell.thickness, cell.arcLength);
        const icon = mark?.kind === 'icon' ? getIcon('message-circle-question') : null;
        if (mark?.kind === 'icon' && icon) {
            icon.setAttribute('class', `${QUERY_MARK} rt-query-icon`);
            icon.setAttribute('x', formatNumber(cell.x - mark.size / 2));
            icon.setAttribute('y', formatNumber(cell.y - mark.size / 2));
            icon.setAttribute('width', formatNumber(mark.size));
            icon.setAttribute('height', formatNumber(mark.size));
            icon.setAttribute('data-query-scene', group.id);
            paintParent.appendChild(icon);
            return;
        }
        if (mark?.kind !== 'dot') return;
        const dot = doc.win.createSvg('circle');
        dot.setAttribute('class', `${QUERY_MARK} rt-query-dot`);
        dot.setAttribute('cx', formatNumber(cell.x));
        dot.setAttribute('cy', formatNumber(cell.y));
        dot.setAttribute('r', formatNumber(mark.radius));
        dot.setAttribute('data-query-scene', group.id);
        paintParent.appendChild(dot);
    });
}

/**
 * What fits in a cell of this radial thickness and arc length (wheel units):
 * fit the icon between QUERY_ICON_MIN and QUERY_ICON_MAX, then scale its paint;
 * otherwise a small dot, or nothing in a sliver.
 */
export function queryMarkFor(thickness: number, arcLength: number): { kind: 'icon'; size: number } | { kind: 'dot'; radius: number } | null {
    const size = Math.min(QUERY_ICON_MAX, thickness * 0.45, arcLength * 0.6);
    if (size >= QUERY_ICON_MIN) return { kind: 'icon', size: size * QUERY_ICON_SCALE };
    const radius = Math.min(5, thickness * 0.3, arcLength * 0.3);
    return radius >= 1.5 ? { kind: 'dot', radius } : null;
}

/** The middle of a scene cell and the room it has, from the arc its group records (radians, centered on the wheel). */
function cellGeometry(group: Element): { x: number; y: number; thickness: number; arcLength: number } | null {
    const start = Number(group.getAttribute('data-start-angle-raw') ?? group.getAttribute('data-start-angle'));
    let end = Number(group.getAttribute('data-end-angle-raw') ?? group.getAttribute('data-end-angle'));
    const inner = Number(group.getAttribute('data-inner-r'));
    const outer = Number(group.getAttribute('data-outer-r'));
    if (![start, end, inner, outer].every(Number.isFinite)) return null;
    if (end < start) end += Math.PI * 2;
    const angle = (start + end) / 2;
    const radius = (inner + outer) / 2;
    return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        thickness: outer - inner,
        arcLength: radius * (end - start),
    };
}
