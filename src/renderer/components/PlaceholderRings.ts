/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { formatNumber } from '../../utils/svg';

/*
 * Placeholder rings: the empty rings that pad a timeline to three
 * (placeholderRingCount). Not voids: a void cell says "no scene of this thread
 * here", a placeholder "a thread could live here". Drawn like a drop target,
 * as on the Community wheel: a solid outline round the whole ring, unbroken at
 * the act spokes, and a quiet fill band inset inside it with no border. No
 * cells, numbers or interaction.
 *
 * Proportions are the engine's (timeline-tokens `dimensions`, same wheel units
 * as this renderer: hub 200, rim 766).
 */

/** How far the outline sits inside the ring's edges, so neighbouring placeholders read as two. */
export const PLACEHOLDER_OUTLINE_INSET = 8;
/** The fill band's inset from each ring edge, as a share of the ring's width. */
export const PLACEHOLDER_BAND_INSET_RATIO = 0.24;

export interface PlaceholderRingBand {
    innerR: number;
    outerR: number;
}

function circlePath(r: number): string {
    const rr = formatNumber(r);
    return `M ${rr} 0 A ${rr} ${rr} 0 1 1 -${rr} 0 A ${rr} ${rr} 0 1 1 ${rr} 0 Z`;
}

function annulusPath(innerR: number, outerR: number): string {
    return `${circlePath(outerR)} ${circlePath(innerR)}`;
}

/** The outline and band radii for one placeholder, clamped so a thin ring keeps its outline outside its band. */
export function placeholderRingGeometry({ innerR, outerR }: PlaceholderRingBand): {
    outlineInnerR: number;
    outlineOuterR: number;
    bandInnerR: number;
    bandOuterR: number;
} {
    const width = outerR - innerR;
    const outlineInset = Math.min(PLACEHOLDER_OUTLINE_INSET, width / 4);
    const bandInset = Math.max(outlineInset, Math.min(width * PLACEHOLDER_BAND_INSET_RATIO, width / 2 - 1));
    return {
        outlineInnerR: innerR + outlineInset,
        outlineOuterR: outerR - outlineInset,
        bandInnerR: innerR + bandInset,
        bandOuterR: outerR - bandInset
    };
}

export function renderPlaceholderRings(rings: PlaceholderRingBand[]): string {
    if (rings.length === 0) return '';
    const groups = rings.map(ring => {
        const g = placeholderRingGeometry(ring);
        // The backing covers what is drawn under the rings (the inner
        // calendar spokes), as a real ring's cells do.
        return `<g class="ert-placeholder-ring">`
            + `<path class="ert-placeholder-ring-backing" fill-rule="evenodd" d="${annulusPath(ring.innerR, ring.outerR)}"/>`
            + `<path class="ert-placeholder-ring-band" fill-rule="evenodd" d="${annulusPath(g.bandInnerR, g.bandOuterR)}"/>`
            + `<path class="ert-placeholder-ring-outline" d="${annulusPath(g.outlineInnerR, g.outlineOuterR)}"/>`
            + `</g>`;
    }).join('');
    return `<g class="ert-placeholder-rings" aria-hidden="true" pointer-events="none">${groups}</g>`;
}
