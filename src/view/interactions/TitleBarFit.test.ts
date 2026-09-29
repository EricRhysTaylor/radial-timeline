import { describe, expect, it } from 'vitest';
import { fitTitleBar, TITLE_BAR_FIT_STEPS } from './TitleBarFit';

const PADDING = 12;

/**
 * A header whose row is `widthAt(steps)` wide, laid out from the left
 * padding edge. Stands in for the browser: each applied step narrows the row,
 * exactly as the CSS classes do.
 */
function makeHeader(headerWidth: number, widthAt: (steps: number) => number, extraChildren: FakeChild[] = []) {
    const classes = new Set<string>();
    const stepsApplied = () => TITLE_BAR_FIT_STEPS.filter(step => classes.has(step)).length;
    const row: FakeChild = {
        position: 'static',
        rect: () => {
            const width = widthAt(stepsApplied());
            return { left: PADDING, right: PADDING + width, width };
        },
    };
    const state = { width: headerWidth };
    const header = {
        classList: {
            add: (c: string) => { classes.add(c); },
            remove: (c: string) => { classes.delete(c); },
        },
        children: [row, ...extraChildren].map(child => ({ child, getBoundingClientRect: child.rect })),
        getBoundingClientRect: () => ({ left: 0, right: state.width, width: state.width }),
        ownerDocument: {
            defaultView: {
                getComputedStyle: (el: { child?: FakeChild }) => ({
                    paddingLeft: `${PADDING}px`,
                    paddingRight: `${PADDING}px`,
                    position: el.child?.position ?? 'static',
                }),
            },
        },
    };
    return {
        header: header as unknown as HTMLElement,
        applied: () => TITLE_BAR_FIT_STEPS.filter(step => classes.has(step)),
        resize: (width: number) => { state.width = width; },
    };
}

interface FakeChild {
    position: string;
    rect: () => { left: number; right: number; width: number };
}

// Row widths: full, then after each of the five steps.
const ROW = [1100, 1030, 950, 900, 850, 700];
const rowAt = (steps: number) => ROW[steps];

describe('fitTitleBar', () => {
    it('keeps the full layout when the row fits', () => {
        const { header, applied } = makeHeader(1200, rowAt);
        fitTitleBar(header);
        expect(applied()).toEqual([]);
    });

    it('stops at the first step that fits, keeping the steps before it', () => {
        // 960 − 2×12 padding = 936 of room: 950 is too wide, 900 fits.
        const { header, applied } = makeHeader(960, rowAt);
        fitTitleBar(header);
        expect(applied()).toEqual(TITLE_BAR_FIT_STEPS.slice(0, 3));
    });

    it('gives the icons back when the pane widens again', () => {
        const { header, applied, resize } = makeHeader(800, rowAt);
        fitTitleBar(header);
        expect(applied()).toEqual([...TITLE_BAR_FIT_STEPS]);
        resize(1200);
        fitTitleBar(header);
        expect(applied()).toEqual([]);
    });

    it('applies every step when even the last one does not fit', () => {
        const { header, applied } = makeHeader(500, rowAt);
        fitTitleBar(header);
        expect(applied()).toEqual([...TITLE_BAR_FIT_STEPS]);
    });

    it('leaves a hidden header in the full layout', () => {
        const { header, applied } = makeHeader(0, rowAt);
        fitTitleBar(header);
        expect(applied()).toEqual([]);
    });

    it('ignores popovers hanging past the edge', () => {
        const popover: FakeChild = {
            position: 'absolute',
            rect: () => ({ left: 900, right: 1500, width: 600 }),
        };
        const { header, applied } = makeHeader(1200, rowAt, [popover]);
        fitTitleBar(header);
        expect(applied()).toEqual([]);
    });
});
