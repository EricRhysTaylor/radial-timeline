import { describe, expect, it } from 'vitest';
import { pickStackedPane } from './readingPane';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('pickStackedPane', () => {
    // The table fills the top of the right-hand column.
    const table = box(1000, 0, 2000, 600);

    it('finds the note pane below the table in its column', () => {
        expect(pickStackedPane(table, [box(1000, 604, 2000, 1200)])).toBe(0);
    });

    it('also finds one the author moved above the table', () => {
        expect(pickStackedPane(box(1000, 600, 2000, 1200), [box(1000, 0, 2000, 596)])).toBe(0);
    });

    it('ignores panes in another column, and hidden tabs', () => {
        expect(pickStackedPane(table, [box(0, 0, 996, 1200), box(0, 0, 0, 0)])).toBe(-1);
    });

    it('ignores a pane overlapping the table (a tab in the table’s own group)', () => {
        expect(pickStackedPane(table, [box(1000, 40, 2000, 600)])).toBe(-1);
    });

    it('takes the nearest when several are stacked', () => {
        expect(pickStackedPane(table, [box(1000, 900, 2000, 1200), box(1000, 604, 2000, 896)])).toBe(1);
    });

    it('counts a narrower pane that sits mostly under the table', () => {
        expect(pickStackedPane(table, [box(1200, 604, 1800, 1200)])).toBe(0);
    });
});
