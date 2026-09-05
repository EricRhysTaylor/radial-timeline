/* SVG mounting accepts one complete, well-formed SVG document. */

/** Returns null for invalid markup; never reconstructs a partial SVG. */
export function mountSvgMarkup(container: HTMLElement, svgMarkup: string): SVGSVGElement | null {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const root = doc.documentElement;
    if (doc.querySelector('parsererror') || root.localName !== 'svg'
        || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
        return null;
    }
    const imported = container.ownerDocument.importNode(root, true);
    container.appendChild(imported);
    return imported as unknown as SVGSVGElement;
}

/** Mount a timeline SVG with its fixed viewport contract. */
export function renderSvgFromString(svgContent: string, container: HTMLElement): SVGSVGElement | null {
    const svg = mountSvgMarkup(container, svgContent);
    if (!svg) return null;
    const values = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (!values || values.length !== 4 || !values.every(Number.isFinite)
        || values[2] <= 0 || values[3] <= 0) {
        svg.remove();
        return null;
    }
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'radial-timeline-svg');
    return svg;
}
