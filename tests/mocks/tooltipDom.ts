/** Small DOM contract for host-UI doubles; production tooltip logic runs unchanged. */
export class TooltipElement extends EventTarget {
    nodeType = 1;
    namespaceURI = 'http://www.w3.org/1999/xhtml';
    parentElement: TooltipElement | null = null;
    id = '';
    textContent = '';
    children: TooltipElement[] = [];
    attributes = new Map<string, string>();
    ownerDocument = {
        createElement: () => new TooltipElement(),
        createElementNS: (ns: string) => { const e = new TooltipElement(); e.namespaceURI = ns; return e; }
    };
    get childNodes() { return this.children; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    hasAttribute(name: string) { return this.attributes.has(name); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    appendChild(child: TooltipElement) { child.parentElement = this; this.children.push(child); return child; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
