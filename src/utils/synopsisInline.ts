const SVG_NS = 'http://www.w3.org/2000/svg';
const FORMATTING_ATTRIBUTES = new Set([
    'class', 'fill', 'font-family', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'baseline-shift', 'x', 'y', 'dx', 'dy', 'textlength', 'lengthadjust'
]);
const FORMATTING_STYLES = new Set([
    'fill', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
    'baseline-shift', '--rt-dynamic-color'
]);

/** Convert inline span formatting atomically; unsupported markup cannot leave a partial title. */
export function appendSynopsisInline(content: string, parent: SVGElement): void {
    const decoded = content.includes('&lt;tspan') && !content.includes('<tspan')
        ? content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        : content;
    const parsed = new DOMParser().parseFromString(`<body>${decoded}</body>`, 'text/html');
    const owner = parent.ownerDocument;
    const fragment = owner.win.createFragment();
    const clone = (source: Node): Node => {
        if (source.nodeType === 3) return owner.createTextNode(source.textContent ?? '');
        if (source.nodeType !== 1) throw new Error('Unsupported synopsis inline node.');
        const element = source as Element;
        if (!['span', 'tspan'].includes(element.localName.toLowerCase())) {
            throw new Error(`Unsupported synopsis inline element: ${element.localName}`);
        }
        const target = owner.createElementNS(SVG_NS, 'tspan');
        for (const attribute of Array.from(element.attributes)) {
            if (FORMATTING_ATTRIBUTES.has(attribute.name.toLowerCase()) && !/url\s*\(/i.test(attribute.value)) {
                const name = attribute.name.toLowerCase() === 'textlength' ? 'textLength'
                    : attribute.name.toLowerCase() === 'lengthadjust' ? 'lengthAdjust' : attribute.name;
                target.setAttribute(name, attribute.value);
            }
        }
        // Parse styles through the browser CSS declaration rather than forwarding arbitrary attributes.
        const styles = owner.createElementNS(SVG_NS, 'tspan').style;
        styles.cssText = element.getAttribute('style') ?? '';
        for (const property of Array.from(styles)) {
            const value = styles.getPropertyValue(property);
            if (FORMATTING_STYLES.has(property) && !/url\s*\(/i.test(value)) {
                target.style.setProperty(property, value);
            }
        }
        for (const child of Array.from(source.childNodes)) target.appendChild(clone(child));
        return target;
    };
    for (const node of Array.from(parsed.body.childNodes)) fragment.appendChild(clone(node));
    if (!fragment.hasChildNodes()) throw new Error('Synopsis content produced no inline nodes.');
    parent.appendChild(fragment);
}
