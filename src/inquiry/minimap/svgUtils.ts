/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Pure SVG DOM utility functions for the Inquiry minimap.
 *
 * These functions create and manipulate SVG elements. They use only
 * the standard DOM API and have no dependency on plugin, view, or
 * class instance state.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function createSvgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return activeDocument.createElementNS(SVG_NS, tag);
}

export function createSvgGroup(parent: SVGElement, cls: string, x?: number, y?: number): SVGGElement {
    const group = createSvgElement('g');
    group.classList.add(...cls.split(' ').filter(Boolean));
    if (typeof x === 'number' || typeof y === 'number') {
        group.setAttribute('transform', `translate(${x ?? 0} ${y ?? 0})`);
    }
    parent.appendChild(group);
    return group;
}

export function createSvgText(parent: SVGElement, cls: string, text: string, x: number, y: number): SVGTextElement {
    const textEl = createSvgElement('text');
    textEl.classList.add(...cls.split(' ').filter(Boolean));
    textEl.setAttribute('x', String(x));
    textEl.setAttribute('y', String(y));
    textEl.textContent = text;
    parent.appendChild(textEl);
    return textEl;
}

export function clearSvgChildren(el: SVGElement): void {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}
