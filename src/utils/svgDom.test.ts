import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSvgMarkup, renderSvgFromString } from './svgDom';

// The browser supplies parsing and importNode. These tests exercise our acceptance
// and viewport contract against their returned nodes, without emulating XML parsing.
function fixture(viewBox: string | null = '0 0 100 200', invalid = false) {
    const svg = {
        localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg',
        getAttribute: vi.fn(() => viewBox), setAttribute: vi.fn(), remove: vi.fn()
    };
    const parse = vi.fn(() => ({ documentElement: svg, querySelector: () => invalid ? {} : null }));
    vi.stubGlobal('DOMParser', class { parseFromString = parse; });
    const container = { ownerDocument: { importNode: vi.fn(() => svg) }, appendChild: vi.fn() };
    return { svg, parse, container, target: container as unknown as HTMLElement };
}
afterEach(() => vi.unstubAllGlobals());
describe('SVG mounting contract', () => {
    it('deep imports once, preserving nested SVG structure in the destination document', () => {
        const { svg, parse, container, target } = fixture();
        expect(mountSvgMarkup(target, '<svg/>')).toBe(svg);
        expect(parse).toHaveBeenCalledExactlyOnceWith('<svg/>', 'image/svg+xml');
        expect(container.ownerDocument.importNode).toHaveBeenCalledExactlyOnceWith(svg, true);
        expect(container.appendChild).toHaveBeenCalledExactlyOnceWith(svg);
    });
    it('rejects parser errors without reparsing or mounting partial output', () => {
        const { parse, container, target } = fixture(null, true);
        expect(mountSvgMarkup(target, 'bad markup')).toBeNull();
        expect(parse).toHaveBeenCalledTimes(1);
        expect(container.appendChild).not.toHaveBeenCalled();
    });
    it('rejects a non-SVG root or namespace', () => {
        const { svg, target, container } = fixture();
        svg.localName = 'div';
        expect(mountSvgMarkup(target, '<div/>')).toBeNull();
        svg.localName = 'svg';
        svg.namespaceURI = 'http://www.w3.org/1999/xhtml';
        expect(mountSvgMarkup(target, '<svg/>')).toBeNull();
        expect(container.appendChild).not.toHaveBeenCalled();
    });
    it.each([null, '', '0 0 0 100', '0 0 100 -1', '0 0 NaN 100', '0 0 1 2 3'])('removes invalid viewport %s', value => {
        const { svg, target } = fixture(value);
        expect(renderSvgFromString('markup', target)).toBeNull();
        expect(svg.remove).toHaveBeenCalledOnce();
    });
    it('accepts finite positive dimensions and applies the timeline viewport', () => {
        const { svg, target } = fixture('-10,-20,1e2,200');
        expect(renderSvgFromString('markup', target)).toBe(svg);
        expect(svg.setAttribute).toHaveBeenCalledWith('preserveAspectRatio', 'xMidYMid meet');
        expect(svg.setAttribute).toHaveBeenCalledWith('width', '100%');
        expect(svg.remove).not.toHaveBeenCalled();
    });
});
