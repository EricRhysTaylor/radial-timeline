/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * Two-scene comparison on the wheel: the hover and locked highlights, the
 * number squares that light with them, and the comparison arc with its label.
 * Shared by Chronologue's Shift and Alt views (elapsed story time) and the
 * Narrative runtime view (runtime between two scenes).
 */

import type { TimelineItem } from '../../types';
import { normalizeAngleSigned, normalizeAngleUnsigned } from '../../renderer/utils/angles';
import { ELAPSED_ARC_RADIUS, ELAPSED_TICK_LENGTH } from '../../renderer/layout/LayoutConstants';

/** Number squares, their text, Chronologue's foreground title and subplot color slot, by scene id. */
export interface SceneNumberLookup {
    squares: Map<string, SVGElement>;
    texts: Map<string, SVGElement>;
    titles: Map<string, SVGElement>;
    subplotIndex: Map<string, number>;
}

/** The id of a scene group's path, which is also its scene id. */
export function sceneIdOfGroup(group: Element): string | null {
    return group.querySelector<SVGPathElement>('.rt-scene-path')?.id ?? null;
}

/** Index every scene's number square, text and subplot slot once per render. */
export function buildSceneNumberLookup(svg: SVGSVGElement): SceneNumberLookup {
    const lookup: SceneNumberLookup = { squares: new Map(), texts: new Map(), titles: new Map(), subplotIndex: new Map() };
    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]').forEach(group => {
        const sceneId = sceneIdOfGroup(group);
        if (!sceneId) return;
        const subplotIndexAttr = group.getAttribute('data-subplot-color-index') || group.getAttribute('data-subplot-index');
        if (subplotIndexAttr) {
            const subplotIndex = parseInt(subplotIndexAttr, 10);
            if (!isNaN(subplotIndex)) lookup.subplotIndex.set(sceneId, subplotIndex);
        }
        const square = svg.querySelector<SVGElement>(`.rt-number-square[data-scene-id="${sceneId}"]`);
        const text = svg.querySelector<SVGElement>(`.rt-number-text[data-scene-id="${sceneId}"]`);
        // Chronologue paints each title above the rings through a <use>, outside
        // the scene group, so the title lights with the scene's number square.
        const title = svg.querySelector<SVGElement>(`.rt-scene-title-use[data-scene-id="${sceneId}"]`);
        if (square) lookup.squares.set(sceneId, square);
        if (text) lookup.texts.set(sceneId, text);
        if (title) lookup.titles.set(sceneId, title);
    });
    return lookup;
}

/** Light (or clear) a scene's number square and text in its subplot color. */
export function setNumberSquareActive(sceneId: string | null | undefined, active: boolean, lookup: SceneNumberLookup): void {
    if (!sceneId) return;
    const square = lookup.squares.get(sceneId);
    const text = lookup.texts.get(sceneId);

    if (square) {
        square.classList.toggle('rt-shift-active', active);
        // Subplot slot as a data attribute for CSS to color from
        if (active) {
            const subplotIndex = lookup.subplotIndex.get(sceneId);
            if (subplotIndex !== undefined) {
                square.setAttribute('data-subplot-idx', (subplotIndex % 16).toString());
            }
        } else {
            square.removeAttribute('data-subplot-idx');
        }
    }

    if (text) text.classList.toggle('rt-shift-active', active);
    lookup.titles.get(sceneId)?.classList.toggle('rt-shift-active', active);
}

/** Clear hover and locked states so every scene starts unselected. */
export function resetComparisonStates(svg: SVGSVGElement): void {
    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]').forEach(group => {
        group.classList.remove('rt-shift-hover', 'rt-shift-locked');
        const path = group.querySelector('.rt-scene-path');
        if (path) {
            path.classList.remove('rt-shift-locked', 'rt-shift-selected');
        }
    });
}

/** Remove every comparison highlight, including lit number squares. */
export function removeSceneHighlights(svg: SVGSVGElement): void {
    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]').forEach(group => {
        const path = group.querySelector('.rt-scene-path');
        if (path) {
            path.classList.remove('rt-shift-selected', 'rt-shift-locked', 'rt-shift-non-select');
        }
        group.classList.remove('rt-shift-hover', 'rt-shift-locked');
    });
    svg.querySelectorAll('.rt-number-square.rt-shift-active').forEach(el => el.classList.remove('rt-shift-active'));
    svg.querySelectorAll('.rt-number-text.rt-shift-active').forEach(el => el.classList.remove('rt-shift-active'));
    svg.querySelectorAll('.rt-scene-title-use.rt-shift-active').forEach(el => el.classList.remove('rt-shift-active'));
}

/** Lock the selected scenes' highlights; every other scene returns to unselected. */
export function updateSceneSelection(svg: SVGSVGElement, selectedScenes: TimelineItem[], lookup: SceneNumberLookup): void {
    const selectedPaths = new Set(selectedScenes.map(s => s.path ? encodeURIComponent(s.path) : '').filter(p => p));

    svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"]').forEach(group => {
        group.classList.remove('rt-shift-locked');
        const path = group.querySelector('.rt-scene-path');
        if (path) {
            path.classList.remove('rt-shift-locked', 'rt-shift-selected');
        }
        const scenePathEncoded = group.getAttribute('data-path');
        if (scenePathEncoded && selectedPaths.has(scenePathEncoded)) {
            group.classList.remove('rt-shift-hover');
        }
        setNumberSquareActive(sceneIdOfGroup(group), false, lookup);
    });

    selectedScenes.forEach(scene => {
        // Scene.path is decoded; data-path is encoded
        const encodedPath = scene.path ? encodeURIComponent(scene.path) : '';
        if (!encodedPath) return;

        const sceneGroup = svg.querySelector(`.rt-scene-group[data-path="${encodedPath}"]`);
        if (!sceneGroup) return;
        const path = sceneGroup.querySelector('.rt-scene-path');
        if (path) {
            path.classList.add('rt-shift-locked');
            path.classList.add('rt-shift-selected'); // Legacy compatibility
            setNumberSquareActive((path as SVGElement).id, true, lookup);
        }
        // The group carries the locked flag as well so timeline.css can
        // style the whole scene without a :has() lookup into its children.
        sceneGroup.classList.add('rt-shift-locked');
        sceneGroup.classList.remove('rt-shift-hover');
    });
}

export interface ComparisonArc {
    /** Where the arc starts; it sweeps clockwise to endAngle. */
    startAngle: number;
    endAngle: number;
    /** Angles that get an endpoint marker. */
    markerAngles: [number, number];
    label: string;
    /** The layer the arc joins; it moves to the top so the arc draws above the wheel. */
    layer: Element | null;
}

/** Draw the comparison arc between two scenes with its label at the midpoint. */
export function drawComparisonArc(svg: SVGSVGElement, arc: ComparisonArc): void {
    removeComparisonArc(svg);

    let sweep = arc.endAngle - arc.startAngle;
    // Past 12 o'clock the end angle wraps; add a full turn for the clockwise sweep.
    if (sweep < 0) sweep += 2 * Math.PI;
    const largeArcFlag = sweep > Math.PI ? 1 : 0;
    const arcRadius = ELAPSED_ARC_RADIUS;

    const x1 = arcRadius * Math.cos(arc.startAngle);
    const y1 = arcRadius * Math.sin(arc.startAngle);
    const x2 = arcRadius * Math.cos(arc.endAngle);
    const y2 = arcRadius * Math.sin(arc.endAngle);

    const doc = svg.ownerDocument;
    const arcGroup = doc.win.createSvg('g');
    arcGroup.setAttribute('class', 'rt-elapsed-time-arc');
    const arcPathElement = doc.win.createSvg('path');
    arcPathElement.setAttribute('d', `M ${x1} ${y1} A ${arcRadius} ${arcRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}`);
    arcPathElement.setAttribute('class', 'rt-elapsed-arc-path');
    arcGroup.appendChild(arcPathElement);

    arc.markerAngles.forEach(angle => {
        const outerRadius = arcRadius + ELAPSED_TICK_LENGTH;
        const marker = doc.win.createSvg('line');
        marker.setAttribute('x1', `${arcRadius * Math.cos(angle)}`);
        marker.setAttribute('y1', `${arcRadius * Math.sin(angle)}`);
        marker.setAttribute('x2', `${outerRadius * Math.cos(angle)}`);
        marker.setAttribute('y2', `${outerRadius * Math.sin(angle)}`);
        marker.setAttribute('class', 'rt-elapsed-endpoint-marker');
        arcGroup.appendChild(marker);
    });

    hideOverlappingTicks(svg, arc.markerAngles[0], arc.markerAngles[1]);

    // Label 24px outside the arc, at its midpoint.
    const midpointAngle = normalizeAngleUnsigned(arc.startAngle + sweep / 2);
    const labelRadius = arcRadius + 24;
    const labelGroup = createComparisonLabel(labelRadius * Math.cos(midpointAngle), labelRadius * Math.sin(midpointAngle), arc.label, midpointAngle);

    if (arc.layer) {
        arc.layer.appendChild(arcGroup);
        arc.layer.appendChild(labelGroup);
        // Move the layer to the end of its parent so it renders on top.
        arc.layer.parentElement?.appendChild(arc.layer);
    } else {
        svg.appendChild(arcGroup);
        svg.appendChild(labelGroup);
    }
}

function createComparisonLabel(x: number, y: number, value: string, midpointAngle: number): SVGGElement {
    const labelGroup = activeWindow.createSvg('g');
    labelGroup.setAttribute('class', 'rt-elapsed-time-group');

    const labelText = activeWindow.createSvg('text');
    labelText.setAttribute('y', `${y}`);
    labelText.setAttribute('dominant-baseline', 'middle');
    labelText.setAttribute('fill', 'var(--interactive-accent)');
    labelText.setAttribute('class', 'rt-elapsed-time-label');
    labelText.textContent = value;

    // Anchor away from the left and right edges so the label never clips.
    // Angles: -π/2 = top, 0 = right, π/2 = bottom, ±π = left
    let textAnchor = 'middle';
    let adjustedX = x;
    const normalizedAngle = ((midpointAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (normalizedAngle > 5.5 || normalizedAngle < 0.8) {
        textAnchor = 'end';
        adjustedX = x - 10;
    } else if (normalizedAngle > 2.4 && normalizedAngle < 3.9) {
        textAnchor = 'start';
        adjustedX = x + 10;
    }

    labelText.setAttribute('x', `${adjustedX}`);
    labelText.setAttribute('text-anchor', textAnchor);
    labelGroup.appendChild(labelText);
    return labelGroup;
}

/** Remove the comparison arc and label, and bring back any ticks it hid. */
export function removeComparisonArc(svg: SVGSVGElement): void {
    svg.querySelector('.rt-elapsed-time-arc')?.remove();
    svg.querySelector('.rt-elapsed-time-group')?.remove();
    svg.querySelectorAll<SVGLineElement>('.rt-tick-hidden').forEach(tick => tick.classList.remove('rt-tick-hidden'));
}

/** Hide perimeter ticks that sit under the comparison arc's endpoint markers. */
function hideOverlappingTicks(svg: SVGSVGElement, angle1: number, angle2: number): void {
    const ANGLE_TOLERANCE = 0.01; // Radians (~0.6 degrees)
    const normalizedAngle1 = normalizeAngleSigned(angle1);
    const normalizedAngle2 = normalizeAngleSigned(angle2);

    svg.querySelectorAll<SVGLineElement>('.rt-chronological-tick').forEach(tick => {
        const x1Str = tick.getAttribute('x1');
        const y1Str = tick.getAttribute('y1');
        if (!x1Str || !y1Str) return;

        const tickAngle = normalizeAngleSigned(Math.atan2(parseFloat(y1Str), parseFloat(x1Str)));
        if (Math.abs(tickAngle - normalizedAngle1) < ANGLE_TOLERANCE || Math.abs(tickAngle - normalizedAngle2) < ANGLE_TOLERANCE) {
            tick.classList.add('rt-tick-hidden');
        }
    });
}
