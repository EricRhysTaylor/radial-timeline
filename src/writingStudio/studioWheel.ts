/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Writing Studio: the compact wheel
 * ---------------------------------
 * The book's timeline at navigator size, beside the manuscript, ringed as
 * Narrative mode rings it: one ring per subplot, the outermost (the main
 * plot's) drawn as All Scenes, each scene in its primary subplot's color, and
 * every other subplot ring inside it with each scene at the same angle as on
 * the outer ring (the timeline's sequence layout). Acts divide the circle. A
 * subplot ring's empty stretches are the timeline's placeholder gray, one cell
 * per unbroken run within an act. Colors are the timeline's own (subplot
 * palette, chapter-marker color, scene edges), never the theme accent.
 *
 * Chapters run around the rim as a thin band, one arc per chapter over its
 * scenes, in the color of the timeline's chapter markers. The chapter being
 * read is lit; pressing an arc goes to the chapter's opening scene.
 *
 * The wheel draws no text: the caption under it names the scene. It marks
 * the scene being read and reports a press on any wedge or chapter arc.
 */

import { sceneArcPath } from '../renderer/components/SceneArcs';
import { SVG_NS } from '../inquiry/minimap/svgUtils';
import { compareSubplotOrder } from '../renderer/utils/Precompute';
import type { StudioBook } from './studioModel';

const VIEW_R = 100;
/** The chapter band, around the rim. */
const CHAPTER_OUTER_R = 99;
const CHAPTER_INNER_R = 95.5;
/** The scenes' outer edge: inside the chapter band when the book has chapters. */
const SCENES_R_WITH_CHAPTERS = 93.5;
const SCENES_R_WITHOUT_CHAPTERS = 98;
const CENTER_R = 30;
const RING_GAP = 1.2;
/** The space between two chapter arcs, in radians. */
const CHAPTER_GAP = 0.03;
const START = -Math.PI / 2;
const TAU = Math.PI * 2;

export interface StudioWheelHandle {
    svg: SVGSVGElement;
    /** Mark the scene being read (by manuscript index), and its chapter, or none. */
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

/**
 * The empty stretches of one subplot ring: unbroken runs of scenes not on
 * that subplot, split at act boundaries, as first and last scene index.
 */
export function wheelVoidRuns(book: StudioBook, subplot: string): Array<{ first: number; last: number }> {
    const runs: Array<{ first: number; last: number }> = [];
    let open: { first: number; last: number } | null = null;
    for (const scene of book.scenes) {
        const empty = !scene.subplots.includes(subplot);
        if (empty && open && book.scenes[open.last].act === scene.act) {
            open.last = scene.index;
        } else if (empty) {
            open = { first: scene.index, last: scene.index };
            runs.push(open);
        } else {
            open = null;
        }
    }
    return runs;
}

export function buildStudioWheel(
    doc: Document,
    book: StudioBook,
    colorFor: (subplot: string) => string,
    onActivate: (index: number) => void,
): StudioWheelHandle {
    const make = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] => doc.createElementNS(SVG_NS, tag);
    const svg = make('svg');
    svg.setAttribute('viewBox', `-${VIEW_R} -${VIEW_R} ${VIEW_R * 2} ${VIEW_R * 2}`);
    svg.setAttribute('focusable', 'false');
    svg.classList.add('ert-studio-wheel-svg');

    const angles = wheelAngles(book);
    const subplots = wheelSubplotOrder(book);
    const scenesR = book.chapters.length > 0 ? SCENES_R_WITH_CHAPTERS : SCENES_R_WITHOUT_CHAPTERS;
    // One ring per subplot, as on the timeline: the outermost is All Scenes.
    const ringCount = Math.max(1, subplots.length);
    const ringBand = (scenesR - CENTER_R) / ringCount;
    const outerInner = scenesR - ringBand + RING_GAP / 2;
    const wedgesByScene: SVGPathElement[][] = book.scenes.map(() => []);

    const arc = (parent: SVGGElement, inner: number, outer: number, start: number, end: number, cls: string): SVGPathElement => {
        const path = make('path');
        path.setAttribute('d', sceneArcPath(inner, outer, start, end));
        path.classList.add(cls);
        parent.appendChild(path);
        return path;
    };

    const addWedge = (parent: SVGGElement, index: number, inner: number, outer: number, fill: string): void => {
        const span = angles[index];
        if (!span) return;
        const path = arc(parent, inner, outer, span.start, span.end, 'ert-studio-wedge');
        path.setAttribute('fill', fill);
        path.dataset.sceneIndex = String(index);
        wedgesByScene[index].push(path);
    };

    const outerRing = make('g');
    outerRing.classList.add('ert-studio-ring', 'ert-studio-ring--all');
    for (const scene of book.scenes) addWedge(outerRing, scene.index, outerInner, scenesR, colorFor(scene.subplots[0]));
    svg.appendChild(outerRing);

    // The other subplots, inward, in ring order; the first subplot's ring is All Scenes.
    subplots.slice(1).forEach((subplot, position) => {
        const outer = scenesR - (position + 1) * ringBand - RING_GAP / 2;
        const inner = outer - ringBand + RING_GAP;
        const ring = make('g');
        ring.classList.add('ert-studio-ring');
        ring.dataset.subplot = subplot;
        // Voids first, so the scenes' edges sit on top of them.
        for (const run of wheelVoidRuns(book, subplot)) {
            arc(ring, inner, outer, angles[run.first].start, angles[run.last].end, 'ert-studio-void');
        }
        const fill = colorFor(subplot);
        for (const scene of book.scenes) if (scene.subplots.includes(subplot)) addWedge(ring, scene.index, inner, outer, fill);
        svg.appendChild(ring);
    });

    const chapterArcs: SVGPathElement[] = [];
    if (book.chapters.length > 0) {
        const chapters = make('g');
        chapters.classList.add('ert-studio-chapters');
        for (const chapter of book.chapters) {
            const start = angles[chapter.firstScene].start + CHAPTER_GAP / 2;
            const end = angles[chapter.lastScene].end - CHAPTER_GAP / 2;
            const path = arc(chapters, CHAPTER_INNER_R, CHAPTER_OUTER_R, start, Math.max(start, end), 'ert-studio-chapter');
            path.dataset.sceneIndex = String(chapter.firstScene);
            path.dataset.chapterIndex = String(chapter.index);
            chapterArcs.push(path);
        }
        svg.appendChild(chapters);
    }

    if (book.acts.length > 1) {
        const spokes = make('g');
        spokes.classList.add('ert-studio-spokes');
        book.acts.forEach((_act, actIndex) => {
            const angle = START + (actIndex * TAU) / book.acts.length;
            const line = make('line');
            line.setAttribute('x1', String(CENTER_R * Math.cos(angle)));
            line.setAttribute('y1', String(CENTER_R * Math.sin(angle)));
            line.setAttribute('x2', String((scenesR + 1) * Math.cos(angle)));
            line.setAttribute('y2', String((scenesR + 1) * Math.sin(angle)));
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
            if (index !== null) {
                for (const wedge of wedgesByScene[index] ?? []) {
                    wedge.classList.add('is-current');
                    // Raise the lit wedge so its outline is not hidden by its neighbours.
                    wedge.parentNode?.appendChild(wedge);
                }
            }
            const scene = index !== null ? book.scenes[index] : undefined;
            for (const chapterArc of chapterArcs) {
                chapterArc.classList.toggle('is-current', !!scene && scene.chapter === Number(chapterArc.dataset.chapterIndex));
            }
            centerText.textContent = scene ? (scene.prefix ?? String(scene.index + 1)) : '';
        },
    };
}
