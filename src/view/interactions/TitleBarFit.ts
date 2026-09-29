/**
 * Keeps the timeline title bar on one line with nothing overlapping.
 *
 * The bar is three clusters: the left controls, the mode nav in the middle,
 * and the right tools (search, book selector, action icons). CSS keeps each
 * side cluster at least as wide as its content, so when one side needs more
 * than half the spare room the mode nav slides toward the other side rather
 * than anything overlapping. When even that does not fit, the header steps
 * through tighter layouts in the order below and stops at the first one that
 * fits. Each step keeps the ones before it.
 */
export const TITLE_BAR_FIT_STEPS = [
    // ⌘ / printer / bug / gear fold into one menu button.
    'ert-timeline-header--menu',
    // The search field and book selector give up some width…
    'ert-timeline-header--narrow',
    // …and then take their smallest widths.
    'ert-timeline-header--narrower',
    // Mode buttons tighten and sub-mode chips drop to glyphs.
    'ert-timeline-header--glyphs',
    // Inactive modes show only their numeral.
    'ert-timeline-header--numerals',
] as const;

/**
 * Re-fit the header whenever it, or a content-sized piece inside it (session
 * clock, mode nav, book selector…), changes width. Refits are coalesced to one
 * per frame.
 */
export function setupTitleBarFit(
    header: HTMLElement,
    watched: HTMLElement[],
    register: (cleanup: () => void) => void
): void {
    const win = header.ownerDocument.defaultView;
    if (!win) return;
    let frame: number | null = null;
    const schedule = () => {
        if (frame !== null) return;
        frame = win.requestAnimationFrame(() => {
            frame = null;
            fitTitleBar(header);
        });
    };
    const observer = new win.ResizeObserver(schedule);
    observer.observe(header);
    watched.forEach(el => observer.observe(el));
    register(() => {
        observer.disconnect();
        if (frame !== null) win.cancelAnimationFrame(frame);
        frame = null;
    });
    schedule();
}

/**
 * Apply the first fit step at which the row fits. Always starts again from
 * the full layout, so a pane that widens gets its icons back with no separate
 * "does it fit now?" bookkeeping.
 */
export function fitTitleBar(header: HTMLElement): void {
    const { classList } = header;
    TITLE_BAR_FIT_STEPS.forEach(step => classList.remove(step));
    for (const step of TITLE_BAR_FIT_STEPS) {
        if (rowFits(header)) return;
        classList.add(step);
    }
}

/**
 * True when every in-flow child sits inside the header's content box. The
 * side clusters never shrink below their content, so a row that is too wide
 * pushes a child past the edge. Absolute and fixed children are popovers
 * hanging below the bar and say nothing about the row.
 */
function rowFits(header: HTMLElement): boolean {
    const win = header.ownerDocument.defaultView;
    const box = header.getBoundingClientRect();
    // A hidden tab has no width to fit; it re-fits when it is shown.
    if (!win || box.width === 0) return true;
    const style = win.getComputedStyle(header);
    // Half a pixel of slack absorbs sub-pixel rounding at the edges.
    const start = box.left + parseFloat(style.paddingLeft) - 0.5;
    const end = box.right - parseFloat(style.paddingRight) + 0.5;
    for (const child of Array.from(header.children)) {
        const position = win.getComputedStyle(child).position;
        if (position === 'absolute' || position === 'fixed') continue;
        const rect = child.getBoundingClientRect();
        if (rect.width === 0) continue;
        if (rect.left < start || rect.right > end) return false;
    }
    return true;
}
