/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Subset of {@link DOMRect} that the anchor math needs. Accepting a plain
 * shape keeps the offset calculator pure and testable without jsdom.
 */
export type RectLike = {
    readonly left: number;
    readonly right: number;
};

/**
 * Inline style values needed to anchor a panel against a trigger. The
 * unused side is always cleared (set to '') so a previously-applied
 * opposite anchor cannot leak through.
 */
export type PanelAnchorStyle = {
    readonly left: string;
    readonly right: string;
};

/**
 * Compute the inline `left`/`right` offsets that anchor a panel's edge to
 * the matching edge of a trigger element, clamped to the container.
 *
 *   align='right' → panel's right edge aligns with the trigger's right edge.
 *   align='left'  → panel's left edge  aligns with the trigger's left edge.
 *
 * Negative offsets are clamped to 0 so the panel never escapes the
 * container.
 */
export function computePanelAnchorStyle(
    containerRect: RectLike,
    triggerRect: RectLike,
    align: 'left' | 'right'
): PanelAnchorStyle {
    if (align === 'right') {
        const rightOffset = containerRect.right - triggerRect.right;
        return { left: '', right: `${Math.max(0, rightOffset)}px` };
    }
    const leftOffset = triggerRect.left - containerRect.left;
    return { left: `${Math.max(0, leftOffset)}px`, right: '' };
}

/**
 * DOM-bound wrapper around {@link computePanelAnchorStyle}. Reads bounding
 * rects from the live elements and writes the computed offsets to the
 * panel's inline style.
 */
export function anchorPanelNearTrigger(
    panel: HTMLElement,
    trigger: SVGElement | HTMLElement,
    container: HTMLElement,
    align: 'left' | 'right'
): void {
    const containerRect = container.getBoundingClientRect();
    const triggerRect = (trigger as unknown as Element).getBoundingClientRect();
    const style = computePanelAnchorStyle(containerRect, triggerRect, align);
    panel.style.left = style.left;
    panel.style.right = style.right;
}
