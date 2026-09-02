/*
 * SVG mounting helpers for rendering serialized markup safely into the DOM.
 */

import { t } from '../i18n';

type CleanupRegistrar = (cleanup: () => void) => void;

/**
 * Parse a complete serialized `<svg>` document and append it to a container.
 * Returns the mounted element as-is (no attribute rewriting), or null when
 * the markup fails to parse.
 */
export function mountSvgMarkup(container: HTMLElement, svgMarkup: string): SVGSVGElement | null {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName.toLowerCase() !== 'svg') {
        return null;
    }
    const imported = container.ownerDocument.importNode(doc.documentElement, true);
    container.appendChild(imported);
    return imported as unknown as SVGSVGElement;
}

export function renderSvgFromString(
    svgContent: string,
    container: HTMLElement,
    registerCleanup: CleanupRegistrar = () => {}
): SVGSVGElement | null {
    try {
        const svgElement = container.ownerDocument.win.createSvg('svg');
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
        const parserError = svgDoc.querySelector('parsererror');

        if (parserError) {
            console.error('Error parsing SVG content:', parserError.textContent);
            const fallbackDoc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`, 'image/svg+xml');
            if (!fallbackDoc.querySelector('parsererror')) {
                const fallbackSvg = fallbackDoc.documentElement;
                while (fallbackSvg.firstChild) {
                    svgElement.appendChild(fallbackSvg.firstChild);
                }
                setCriticalAttributes(svgElement, fallbackSvg.getAttribute('viewBox'));
                container.appendChild(wrapInFragment(svgElement));
                return svgElement;
            }
            return null;
        }

        const sourceSvg = svgDoc.documentElement;
        copyAttributes(sourceSvg, svgElement);
        setCriticalAttributes(svgElement, sourceSvg.getAttribute('viewBox'));

        while (sourceSvg.firstChild) {
            svgElement.appendChild(sourceSvg.firstChild);
        }

        container.appendChild(wrapInFragment(svgElement));
        return svgElement;
    } catch (error) {
        console.error('Error creating SVG element:', error);
        return buildFallbackSvg(svgContent, container, registerCleanup);
    }
}

function wrapInFragment(node: SVGSVGElement): DocumentFragment {
    const fragment = node.ownerDocument.win.createFragment();
    fragment.appendChild(node);
    return fragment;
}

function copyAttributes(source: Element, target: SVGSVGElement): void {
    Array.from(source.attributes).forEach(attr => {
        if (attr.name !== 'xmlns' && attr.name !== 'class') {
            target.setAttribute(attr.name, attr.value);
        }
    });
    target.classList.add(...Array.from(source.classList));
}

function setCriticalAttributes(svgElement: SVGSVGElement, viewBox: string | null): void {
    svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    svgElement.setAttribute('viewBox', viewBox || '-800 -800 1600 1600');
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgElement.setAttribute('class', 'radial-timeline-svg');
}

function buildFallbackSvg(
    svgContent: string,
    container: HTMLElement,
    registerCleanup: CleanupRegistrar
): SVGSVGElement | null {
    try {
        const ownerDoc = container.ownerDocument;
        const fallbackSvg = ownerDoc.win.createSvg('svg');
        setCriticalAttributes(fallbackSvg, null);

        const svgBodyMatch = svgContent.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
        if (svgBodyMatch && svgBodyMatch[1]) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${svgBodyMatch[1]}</svg>`, 'image/svg+xml');
            if (!doc.querySelector('parsererror')) {
                const svgDoc = doc.documentElement;
                const elementNodes = Array.from(svgDoc.querySelectorAll('*'));

                let pendingTimeout: number | null = null;
                const processNodes = (nodes: Element[], startIdx: number, callback: () => void) => {
                    const CHUNK_SIZE = 100;
                    const endIdx = Math.min(startIdx + CHUNK_SIZE, nodes.length);
                    for (let i = startIdx; i < endIdx; i++) {
                        const element = nodes[i];
                        const newElement = ownerDoc.win.createSvg(element.tagName.toLowerCase() as keyof SVGElementTagNameMap); // SAFE: tag names come from parsed SVG markup; createSvg only needs the string
                        Array.from(element.attributes).forEach(attr => newElement.setAttribute(attr.name, attr.value));
                        newElement.textContent = element.textContent;
                        fallbackSvg.appendChild(newElement);
                    }
                    if (endIdx < nodes.length) {
                        const timeoutId = window.setTimeout(() => {
                            pendingTimeout = null;
                            processNodes(nodes, endIdx, callback);
                        }, 0);
                        pendingTimeout = timeoutId;
                        registerCleanup(() => window.clearTimeout(timeoutId));
                    } else {
                        callback();
                    }
                };

                if (elementNodes.length > 100) {
                    const loadingText = ownerDoc.win.createSvg('text');
                    loadingText.setAttribute('x', '0');
                    loadingText.setAttribute('y', '0');
                    loadingText.setAttribute('class', 'loading-message');
                    loadingText.setAttribute('font-size', '24');
                    loadingText.setAttribute('text-anchor', 'middle');
                    loadingText.textContent = t('timeline.loading');
                    fallbackSvg.appendChild(loadingText);

                    container.appendChild(wrapInFragment(fallbackSvg));

                    processNodes(elementNodes, 0, () => {
                        if (pendingTimeout !== null) {
                            window.clearTimeout(pendingTimeout);
                            pendingTimeout = null;
                        }
                        loadingText.remove();
                    });
                } else {
                    elementNodes.forEach(element => {
                        const newElement = ownerDoc.win.createSvg(element.tagName.toLowerCase() as keyof SVGElementTagNameMap); // SAFE: tag names come from parsed SVG markup; createSvg only needs the string
                        Array.from(element.attributes).forEach(attr => newElement.setAttribute(attr.name, attr.value));
                        newElement.textContent = element.textContent;
                        fallbackSvg.appendChild(newElement);
                    });
                    container.appendChild(wrapInFragment(fallbackSvg));
                }

                return fallbackSvg;
            }
        }

        container.appendChild(wrapInFragment(fallbackSvg));
        return fallbackSvg;
    } catch (innerError) {
        console.error('All SVG parsing approaches failed:', innerError);
        return null;
    }
}
