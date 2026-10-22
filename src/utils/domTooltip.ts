import { setTooltip as obsidianSetTooltip, type ButtonComponent, type ExtraButtonComponent, type ToggleComponent, type TooltipOptions } from 'obsidian';

const labels = new WeakMap<Element, Element>();
const hoverText = new WeakMap<HTMLElement, string>();
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Name a control without Obsidian interpreting its name as hover help. */
export function setAccessibleLabel<T extends Element>(element: T, text: string): T {
    const svg = element.namespaceURI === SVG_NS;
    const parent = svg ? element : (element.parentElement ?? element);
    let label = labels.get(element);
    if (!label || label.parentElement !== parent) {
        label?.remove();
        label = svg
            ? element.ownerDocument.createElementNS(SVG_NS, 'desc')
            : element.ownerDocument.win.createSpan();
        label.id = `ert-label-${crypto.randomUUID()}`;
        if (!svg) label.setAttribute('hidden', '');
        parent.appendChild(label);
        labels.set(element, label);
    }
    label.textContent = text;
    element.setAttribute('aria-labelledby', label.id);
    element.removeAttribute('title');
    element.removeAttribute('aria-label');
    // Preserve separately authored hover help when a dynamic name changes.
    const tip = hoverText.get(element as unknown as HTMLElement);
    if (tip) element.setAttribute('aria-label', tip);
    return element;
}

type TooltipTarget = HTMLElement | ButtonComponent | ExtraButtonComponent | ToggleComponent;

function controlElement(target: TooltipTarget): HTMLElement {
    if ('buttonEl' in target) return target.buttonEl;
    if ('extraSettingsEl' in target) return target.extraSettingsEl;
    if ('toggleEl' in target) return target.toggleEl;
    return target;
}

export function withAccessibleLabel<T extends TooltipTarget>(target: T, text: string): T {
    setAccessibleLabel(controlElement(target), text);
    return target;
}

function normalize(text: string): string {
    return text.normalize('NFKC').replace(/[\s….,:;!?]+/gu, ' ').trim().toLocaleLowerCase();
}

function visibleText(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType === 1) {
        const element = node as Element;
        if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true'
            || element.namespaceURI === SVG_NS) return '';
    }
    return Array.from(node.childNodes).map(visibleText).join('');
}

/** Use one hover renderer; visible labels never need an identical tooltip. */
export function setTooltip(element: HTMLElement, text: string, options?: TooltipOptions): void {
    const visible = visibleText(element);
    const redundant = !!normalize(visible) && normalize(visible) === normalize(text);
    element.removeAttribute('title');
    element.removeAttribute('data-tooltip');
    element.removeAttribute('data-rt-tip');
    if (!text || redundant) {
        hoverText.delete(element);
        element.removeAttribute('aria-label');
        return;
    }
    hoverText.set(element, text);
    obsidianSetTooltip(element, text, options);
}

/** Retain component chaining while keeping all HTML hover help on one path. */
export function withTooltip<T extends TooltipTarget>(
    target: T, text: string, options?: TooltipOptions
): T {
    const element = controlElement(target);
    setTooltip(element, text, options);
    return target;
}
