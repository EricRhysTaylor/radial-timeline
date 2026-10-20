/** The solid color of a rendered scene cell, including column coloring and status patterns. */
export function sceneCellColor(group: Element): string | null {
    const cell = group.querySelector('.rt-scene-path');
    const win = group.ownerDocument.defaultView;
    if (!cell || !win) return null;
    const fill = win.getComputedStyle(cell).fill;
    if (!fill.startsWith('url(')) return fill === 'none' ? null : fill;

    // Status patterns paint their base color with the first rect. A CSS row
    // wash needs that solid color, since SVG paint servers are not CSS colors.
    const id = fill.match(/#([^"')]+)["']?\)$/)?.[1];
    const base = id ? group.closest('svg')?.querySelector(`pattern[id="${CSS.escape(id)}"] > rect`) : null;
    return base ? win.getComputedStyle(base).fill : null;
}
