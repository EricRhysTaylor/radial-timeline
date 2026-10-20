import { afterEach, describe, expect, it, vi } from 'vitest';
import { sceneCellColor } from './sceneCellColor';

/** A rendered cell: computed fill already includes mode CSS and inline column coloring. */
function renderedGroup(fill: string, patternColor?: string) {
    const cell = {};
    const base = {};
    const svg = { querySelector: vi.fn(() => patternColor ? base : null) };
    const group = {
        querySelector: () => cell,
        closest: () => svg,
        ownerDocument: { defaultView: {
            getComputedStyle: (element: unknown) => ({ fill: element === cell ? fill : patternColor }),
        } },
    };
    return { group: group as unknown as Element, svg };
}

afterEach(() => vi.unstubAllGlobals());

describe('sceneCellColor', () => {
    it.each([
        ['Narrative subplot', 'rgb(10, 120, 210)'],
        ['Chronologue subplot', 'rgb(80, 160, 100)'],
        ['Progress completed stage', 'rgb(130, 90, 200)'],
        ['Progress overdue', 'rgb(200, 50, 40)'],
        ['column coloring', 'rgb(160, 140, 30)'],
    ])('uses the rendered %s color rather than the ring metadata', (_mode, fill) => {
        expect(sceneCellColor(renderedGroup(fill).group)).toBe(fill);
    });

    it.each(['url(#plaidWorkingAuthor)', 'url("app://obsidian.md/index.html#plaidWorkingAuthor")'])('takes the solid base of a status pattern: %s', fill => {
        vi.stubGlobal('CSS', { escape: (id: string) => id });
        const { group, svg } = renderedGroup(fill, 'rgb(170, 170, 170)');
        expect(sceneCellColor(group)).toBe('rgb(170, 170, 170)');
        expect(svg.querySelector).toHaveBeenCalledWith('pattern[id="plaidWorkingAuthor"] > rect');
    });

    it('does not pass a missing SVG paint server to the CSS row wash', () => {
        vi.stubGlobal('CSS', { escape: (id: string) => id });
        expect(sceneCellColor(renderedGroup('url(#missing)').group)).toBeNull();
        expect(sceneCellColor(renderedGroup('none').group)).toBeNull();
    });
});
