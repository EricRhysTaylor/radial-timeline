/**
 * Design reference only.
 *
 * Canonical locked rendering for the PRO pill.
 * This file is preserved as a visual/spec reference and is not part of the
 * active runtime import graph.
 *
 * Live implementations may be inlined elsewhere in the UI.
 * Do not normalize, generalize, or convert into shared variant helpers
 * without explicit approval.
 */

import { setIcon } from 'obsidian';

/**
 * Renders the PRO pill exactly as designed.
 * Returns the pill element for placement.
 */
export function renderOptimizedProPill(parent: HTMLElement): HTMLElement {
    const pill = parent.createSpan({ cls: 'rt-optimized-pro-pill' });
    
    // Icon container
    const iconEl = pill.createSpan({ cls: 'rt-optimized-pro-pill__icon' });
    setIcon(iconEl, 'signature');
    
    // Text
    pill.createSpan({ cls: 'rt-optimized-pro-pill__text', text: 'PRO' });
    
    return pill;
}
