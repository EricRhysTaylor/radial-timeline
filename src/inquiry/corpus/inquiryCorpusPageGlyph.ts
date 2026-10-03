/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The corpus page glyph: Lucide's page drawn in parts so CSS can show each
 * state on it. Corpus cells and the corpus legend both build it, so the
 * legend always matches the cells. State classes (is-mode-*, is-tier-*,
 * is-status-*, is-low-substance, is-target) go on an `.ert-inquiry-cc-page`
 * ancestor; styles live in inquiry.css.
 */

import {
    LUCIDE_PAGE_BODY,
    LUCIDE_PAGE_BODY_X_CORNER,
    LUCIDE_PAGE_BOUNDS,
    LUCIDE_PAGE_FOLD,
    LUCIDE_PAGE_TEXT_LINES,
    LUCIDE_PAGE_X_MARK,
    lucidePageLinePath
} from '../components/lucidePage';
import { createSvgElement, createSvgGroup } from '../minimap/svgUtils';

// Shapes derived from the Lucide page rather than taken from it: the
// x-corner outline closed around its open corner (the full-mode fill), and
// the dog-ear's triangle (the target marker).
const PAGE_BODY_X_CORNER_FILL = 'M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6.5H13.5V22z';
const PAGE_FOLD_MARK = 'M14 2.4v4.6a1 1 0 0 0 1 1h4.6z';

// One class per file-text line, top to bottom; substance tiers reveal them in order.
const PAGE_LINE_CLASSES = [
    'ert-inquiry-cc-page-line--1',
    'ert-inquiry-cc-page-line--2',
    'ert-inquiry-cc-page-line--3'
] as const;

/** Page height per unit of page width — the Lucide page's 16:20 proportion. */
export const CORPUS_PAGE_ASPECT = LUCIDE_PAGE_BOUNDS.height / LUCIDE_PAGE_BOUNDS.width;

export type CorpusPageGlyph = {
    root: SVGGElement;
    fill: SVGPathElement;
    outline: SVGPathElement;
};

export function createCorpusPageGlyph(parent: SVGElement): CorpusPageGlyph {
    const root = createSvgGroup(parent, 'ert-inquiry-cc-page-glyph');
    const inner = createSvgGroup(root, 'ert-inquiry-cc-page-glyph-inner');
    const appendPath = (cls: string, d: string): SVGPathElement => {
        const path = createSvgElement('path');
        path.classList.add(cls);
        path.setAttribute('d', d);
        inner.appendChild(path);
        return path;
    };
    const fill = appendPath('ert-inquiry-cc-page-fill', LUCIDE_PAGE_BODY);
    appendPath('ert-inquiry-cc-page-fold-mark', PAGE_FOLD_MARK);
    const outline = appendPath('ert-inquiry-cc-page-outline', LUCIDE_PAGE_BODY);
    // Status dash patterns are measured in percent of the outline, so todo and
    // working read the same on the full page and the open x-corner page.
    outline.setAttribute('pathLength', '100');
    appendPath('ert-inquiry-cc-page-fold', LUCIDE_PAGE_FOLD);
    LUCIDE_PAGE_TEXT_LINES.forEach((line, index) => {
        appendPath('ert-inquiry-cc-page-line', lucidePageLinePath(line)).classList.add(PAGE_LINE_CLASSES[index]);
    });
    LUCIDE_PAGE_X_MARK.forEach(d => appendPath('ert-inquiry-cc-page-x', d));
    return { root, fill, outline };
}

/** Scale the 24-unit icon so the page body spans `pageWidth` from the parent's origin. */
export function sizeCorpusPageGlyph(glyph: CorpusPageGlyph, pageWidth: number): void {
    const scale = pageWidth / LUCIDE_PAGE_BOUNDS.width;
    glyph.root.setAttribute('transform', `scale(${scale}) translate(${-LUCIDE_PAGE_BOUNDS.x} ${-LUCIDE_PAGE_BOUNDS.y})`);
}

/** A low-substance page opens its bottom-right corner for the X (`file-x-corner`). */
export function setCorpusPageLowSubstance(glyph: CorpusPageGlyph, lowSubstance: boolean): void {
    glyph.outline.setAttribute('d', lowSubstance ? LUCIDE_PAGE_BODY_X_CORNER : LUCIDE_PAGE_BODY);
    glyph.fill.setAttribute('d', lowSubstance ? PAGE_BODY_X_CORNER_FILL : LUCIDE_PAGE_BODY);
}
