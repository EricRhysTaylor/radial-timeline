/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Writing Studio: the compact wheel
 * ---------------------------------
 * The book's timeline at navigator size, beside the manuscript. Acts divide
 * the circle; the outer ring holds every scene in manuscript order, each in
 * its primary subplot's color, and one thinner ring per subplot sits inside
 * it, each scene at the same angle as on the outer ring (the timeline's
 * sequence layout). Wedges use the timeline's own arc path and subplot
 * colors, so the wheel reads as the timeline does.
 *
 * The wheel draws no text: the caption under it names the scene. It marks
 * the scene being read and reports a press on any wedge.
 */

import { sceneArcPath } from '../renderer/components/SceneArcs';
import { SVG_NS } from '../inquiry/minimap/svgUtils';
import { compareSubplotOrder } from '../renderer/utils/Precompute';
import type { StudioBook } from './studioModel';

const OUTER_R = 98;
const CENTER_R = 30;
const RING_GAP = 1.2;
/** The all-scenes ring's share of the band between the center and the rim. */
const OUTER_RING_SHARE = 0.42;
const START = -Math.PI / 2;
const TAU = Math.PI * 2;

export interface StudioWheelHandle {
    svg: SVGSVGElement;
    /** Mark the scene being read (by manuscript index), or none. */
    setCurrent(index: number | null): void;
}

/** Subplots in timeline ring order: the main plot outermost, then by scene count. */
export function wheelSubplotOrder(book: StudioBook): string[] {
    const counts = new Map<string, number>();
    for (const scene of book.scenes) for (const subplot of scene.subplots) counts.set(subplot, (counts.get(subplot) ?? 0) + 1);
    return [...counts].map(([subplot, count]) => ({ subplot, count })).sort(compareSubplotOrder).map(entry => entry.subplot);
}

/** Each scene's angular span, acts sharing the circle equally and scenes their act equally. */
export function wheelAngles(book: StudioBook): Array<{ start: number; end: number }> {
    const actCount = Math.max(1, book.acts.length);
    const actSpan = TAU / actCount;
    const spans: Array<{ start: number; end: number }> = new Array(book.scenes.length);
    book.acts.forEach((act, actIndex) => {
        const members = book.scenes.filter(scene => scene.act === act);
        const share = actSpan / Math.max(1, members.length);
        members.forEach((scene, position) => {
            const start = START + actIndex * actSpan + position * share;
            spans[scene.index] = { start, end: start + share };
        });
    });
    return spans;
}

export function buildStudioWheel(
    doc: Document,
    book: StudioBook,
    colorFor: (subplot: string) => string,
    onActivate: (index: number) => void,
): StudioWheelHandle {
    const make = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] => doc.createElementNS(SVG_NS, tag);
    const svg = make('svg');
    svg.setAttribute('viewBox', `-${OUTER_R + 2} -${OUTER_R + 2} ${(OUTER_R + 2) * 2} ${(OUTER_R + 2) * 2}`);
    svg.setAttribute('focusable', 'false');
    svg.classList.add('ert-studio-wheel-svg');

    const angles = wheelAngles(book);
    const subplots = wheelSubplotOrder(book);
    const band = OUTER_R - CENTER_R;
    const outerInner = OUTER_R - band * (subplots.length > 1 ? OUTER_RING_SHARE : 1);
    const wedgesByScene: SVGPathElement[][] = book.scenes.map(() => []);

    const addWedge = (parent: SVGGElement, index: number, inner: number, outer: number, fill: string): void => {
        const span = angles[index];
        if (!span) return;
        const path = make('path');
        path.setAttribute('d', sceneArcPath(inner, outer, span.start, span.end));
        path.setAttribute('fill', fill);
        path.classList.add('ert-studio-wedge');
        path.dataset.sceneIndex = String(index);
        parent.appendChild(path);
        wedgesByScene[index].push(path);
    };

    const outerRing = make('g');
    outerRing.classList.add('ert-studio-ring', 'ert-studio-ring--all');
    for (const scene of book.scenes) addWedge(outerRing, scene.index, outerInner, OUTER_R, colorFor(scene.subplots[0]));
    svg.appendChild(outerRing);

    if (subplots.length > 1) {
        const ringBand = (outerInner - RING_GAP - CENTER_R) / subplots.length;
        subplots.forEach((subplot, ringIndex) => {
            const outer = outerInner - RING_GAP - ringIndex * ringBand;
            const inner = outer - ringBand + RING_GAP / 2;
            const ring = make('g');
            ring.classList.add('ert-studio-ring');
            ring.dataset.subplot = subplot;
            const fill = colorFor(subplot);
            for (const scene of book.scenes) if (scene.subplots.includes(subplot)) addWedge(ring, scene.index, inner, outer, fill);
            svg.appendChild(ring);
        });
    }

    if (book.acts.length > 1) {
        const spokes = make('g');
        spokes.classList.add('ert-studio-spokes');
        book.acts.forEach((_act, actIndex) => {
            const angle = START + (actIndex * TAU) / book.acts.length;
            const line = make('line');
            line.setAttribute('x1', String(CENTER_R * Math.cos(angle)));
            line.setAttribute('y1', String(CENTER_R * Math.sin(angle)));
            line.setAttribute('x2', String((OUTER_R + 2) * Math.cos(angle)));
            line.setAttribute('y2', String((OUTER_R + 2) * Math.sin(angle)));
            spokes.appendChild(line);
        });
        svg.appendChild(spokes);
    }

    const centerText = make('text');
    centerText.classList.add('ert-studio-wheel-center');
    centerText.setAttribute('x', '0');
    centerText.setAttribute('y', '0');
    centerText.setAttribute('text-anchor', 'middle');
    centerText.setAttribute('dominant-baseline', 'central');
    svg.appendChild(centerText);

    svg.addEventListener('click', event => {
        const target = (event.target as Element).closest('[data-scene-index]');
        const index = target ? Number(target.getAttribute('data-scene-index')) : NaN;
        if (Number.isInteger(index)) onActivate(index);
    });

    let current: number | null = null;
    return {
        svg,
        setCurrent(index) {
            if (index === current) return;
            if (current !== null) for (const wedge of wedgesByScene[current] ?? []) wedge.classList.remove('is-current');
            current = index;
            svg.classList.toggle('has-current', index !== null);
            if (index !== null) {
                for (const wedge of wedgesByScene[index] ?? []) {
                    wedge.classList.add('is-current');
                    // Raise the lit wedge so its outline is not hidden by its neighbours.
                    wedge.parentNode?.appendChild(wedge);
                }
            }
            const scene = index !== null ? book.scenes[index] : undefined;
            centerText.textContent = scene ? (scene.prefix ?? String(scene.index + 1)) : '';
        },
    };
}
