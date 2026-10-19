import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipElement } from '../../tests/mocks/tooltipDom';
import { addTooltipData, setupTooltipsFromDataAttributes } from './tooltip';
import { setAccessibleLabel, setTooltip } from './domTooltip';

vi.mock('obsidian', () => ({ setTooltip: (el: HTMLElement, text: string) => el.setAttribute('aria-label', text) }));
function target(svg = false) {
    const element = Object.assign(new TooltipElement(), {
        classList: { remove: vi.fn() }, querySelectorAll: vi.fn(() => []),
        closest: vi.fn((_selector: string): TooltipElement | null => null)
    });
    if (svg) element.namespaceURI = 'http://www.w3.org/2000/svg';
    return element;
}
afterEach(() => vi.unstubAllGlobals());
describe('custom tooltip ownership', () => {
    it('clears native HTML hover ownership before assigning a custom tooltip', () => {
        const node = target(); const element = node as unknown as HTMLElement;
        setTooltip(element, 'Old native help'); element.setAttribute('title', 'Old browser help');
        addTooltipData(element, 'Custom explanation');
        setAccessibleLabel(element, 'New name');
        expect(node.getAttribute('data-rt-tip')).toBe('Custom explanation');
        expect(node.hasAttribute('aria-label')).toBe(false); expect(node.hasAttribute('title')).toBe(false);
        expect(node.hasAttribute('data-tooltip')).toBe(false);
    });
    it('names SVG targets without native hover and preserves legacy positioning metadata', () => {
        const node = target(true); const element = node as unknown as SVGElement;
        node.setAttribute('data-tooltip-anchor', 'cursor'); node.setAttribute('data-tooltip-offset-x', '12');
        addTooltipData(element, 'Scene explanation', 'right');
        expect(node.getAttribute('aria-labelledby')).toBeTruthy(); expect(node.hasAttribute('aria-label')).toBe(false);
        expect(node.getAttribute('data-rt-tip-anchor')).toBe('cursor'); expect(node.getAttribute('data-rt-tip-offset-x')).toBe('12');
        expect(node.hasAttribute('data-tooltip-anchor')).toBe(false);
    });
    it('does not show the parent SVG tooltip over HTML help inside foreignObject', () => {
        const root = target(true); const html = target(); html.setAttribute('aria-label', 'HTML help');
        html.closest.mockImplementation(selector => selector === '[aria-label]' ? html : root);
        root.setAttribute('data-rt-tip', 'Parent SVG help');
        vi.stubGlobal('Element', TooltipElement);
        const handlers = new Map<string, (event: Event) => void>();
        setupTooltipsFromDataAttributes(root as unknown as SVGElement, (_el, event, handler) => handlers.set(event, handler));
        // A conflicting parent hover would try to construct a tooltip in this document.
        const create = vi.spyOn(root.ownerDocument, 'createElement');
        handlers.get('mouseover')!({ target: html } as unknown as Event);
        expect(create).not.toHaveBeenCalled();
    });
});
