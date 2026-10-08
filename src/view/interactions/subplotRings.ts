// Which timeline rings stand for a subplot membership.
//
// Subplot rings always do. The outer ring does only where it shows one
// subplot (Progress mode: Main Plot, or the book's first subplot when no
// scene is in Main Plot). In Narrative, Chronologue and Gossamer it lists
// every scene, so it is no membership and never a membership drag source or
// target. A ring's subplot is the name on its label.

import { TimelineMode } from '../../modes/ModeDefinition';
import { getModeDefinition } from '../../modes/ModeRegistry';
import { getOuterRingIndex } from './dragGeometry';

const VIRTUAL_RINGS = new Set(['Backdrop', 'MicroBackdrop']);

export function outerRingIsSubplotRing(mode: string | undefined): boolean {
    if (!mode) return false;
    return getModeDefinition(mode as TimelineMode)?.rendering.outerRingContent === 'subplot-only';
}

/** The subplot a ring stands for, from its label; null for unlabeled or backdrop rings. */
export function ringSubplotName(svg: Pick<SVGSVGElement, 'querySelector'>, ring: number): string | null {
    const name = svg.querySelector(`.rt-subplot-ring-label-text[data-ring="${ring}"]`)?.getAttribute('data-subplot-name');
    return name && !VIRTUAL_RINGS.has(name) ? name : null;
}

/** The subplot membership a ring stands for, or null when it is no membership ring. */
export function membershipOfRing(svg: SVGSVGElement, ring: number, mode: string | undefined): string | null {
    if (ring === getOuterRingIndex(svg) && !outerRingIsSubplotRing(mode)) return null;
    return ringSubplotName(svg, ring);
}
