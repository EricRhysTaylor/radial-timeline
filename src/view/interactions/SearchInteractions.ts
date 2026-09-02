import { escapeRegExp } from '../../utils/regex';
import { shouldHighlightMetadataTerm, type TimelineSearchState } from '../../services/searchState';

/**
 * CSS-escape a value for use in attribute selectors
 */
function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

interface SearchView {
    contentEl: HTMLElement;
    plugin: {
        searchState: TimelineSearchState;
        clearSearch: () => void;
    };
    registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
}

export function setupSearchControls(view: SearchView): void {
    const clearSearchBtn = view.contentEl.querySelector('.rt-clear-search-btn');
    if (clearSearchBtn) {
        view.registerDomEvent(clearSearchBtn as HTMLElement, 'click', () => {
            view.plugin.clearSearch();
        });
    }
}

export function clearSearchHighlightsInRoot(root: ParentNode): void {
    root.querySelectorAll('.rt-search-term').forEach(node => {
        const parent = node.parentNode;
        if (!parent) {
            node.remove();
            return;
        }
        const textNode = node.ownerDocument.createTextNode(node.textContent || '');
        parent.replaceChild(textNode, node);
    });
}

export function applySearchTermHighlightsInRoot(root: ParentNode, searchTerm: string): void {
    if (!searchTerm) return;
    const escapedPattern = escapeRegExp(searchTerm);
    /**
     * Pulse analysis is never term-highlighted.
     *
     * It is commentary about a scene rather than part of it, and not reliably
     * about that scene in particular — highlighting the search term inside a
     * critique would present editorial notes as if they were the match.
     */
    const isPulseElement = (element: Element): boolean =>
        !!element.closest('[data-pulse-section]');

    const highlightTspan = (tspan: Element, originalText: string, fillColor: string | null) => {
        const doc = tspan.ownerDocument;
        while (tspan.firstChild) tspan.removeChild(tspan.firstChild);
        
        const regex = new RegExp(`(${escapedPattern})`, 'gi');
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        
        while ((match = regex.exec(originalText)) !== null) {
            if (match.index > lastIndex) {
                tspan.appendChild(doc.createTextNode(originalText.substring(lastIndex, match.index)));
            }
            const highlightSpan = doc.win.createSvg('tspan');
            highlightSpan.setAttribute('class', 'rt-search-term');
            if (fillColor) highlightSpan.setAttribute('fill', fillColor);
            highlightSpan.textContent = match[0];
            tspan.appendChild(highlightSpan);
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < originalText.length) {
            tspan.appendChild(doc.createTextNode(originalText.substring(lastIndex)));
        }
    };

    // Subplot tspans
    root.querySelectorAll('tspan[data-item-type="subplot"]').forEach((tspan) => {
        const originalText = tspan.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = tspan.getAttribute('fill');
        highlightTspan(tspan, originalText, fillColor);
    });

    // Character tspans
    root.querySelectorAll('tspan[data-item-type="character"]').forEach((tspan) => {
        const originalText = tspan.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = tspan.getAttribute('fill');
        highlightTspan(tspan, originalText, fillColor);
    });

    // Title tspans
    root.querySelectorAll('tspan[data-item-type="title"]').forEach((tspan) => {
        const originalText = tspan.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = (tspan as SVGTSpanElement).style.getPropertyValue('--rt-dynamic-color') || null;
        highlightTspan(tspan, originalText, fillColor);
    });

    // Date tspans
    root.querySelectorAll('tspan[data-item-type="date"]').forEach((tspan) => {
        const originalText = tspan.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = tspan.getAttribute('fill');
        highlightTspan(tspan, originalText, fillColor);
    });

    // Duration tspans
    root.querySelectorAll('tspan[data-item-type="duration"]').forEach((tspan) => {
        const originalText = tspan.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = tspan.getAttribute('fill');
        highlightTspan(tspan, originalText, fillColor);
    });

    // Synopsis text elements (only those without tspan children)
    root.querySelectorAll('.rt-synopsis-text text').forEach((textEl) => {
        if (textEl.querySelector('tspan')) return;
        if (isPulseElement(textEl)) return;
        const originalText = textEl.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = (textEl as SVGTextElement).getAttribute('fill');
        
        const doc = textEl.ownerDocument;
        while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
        const regex = new RegExp(`(${escapedPattern})`, 'gi');
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        
        while ((match = regex.exec(originalText)) !== null) {
            if (match.index > lastIndex) {
                textEl.appendChild(doc.createTextNode(originalText.substring(lastIndex, match.index)));
            }
            const highlightSpan = doc.win.createSvg('tspan');
            highlightSpan.setAttribute('class', 'rt-search-term');
            if (fillColor) highlightSpan.setAttribute('fill', fillColor);
            highlightSpan.textContent = match[0];
            textEl.appendChild(highlightSpan);
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < originalText.length) {
            textEl.appendChild(doc.createTextNode(originalText.substring(lastIndex)));
        }
    });

    // Unhandled tspans under synopsis
    root.querySelectorAll('.rt-synopsis-text text tspan:not([data-item-type])').forEach((tspan) => {
        if (isPulseElement(tspan)) return;
        const originalText = tspan.textContent || '';
        if (!originalText || !originalText.match(new RegExp(escapedPattern, 'i'))) return;
        const fillColor = (tspan as SVGTSpanElement).getAttribute('fill');
        highlightTspan(tspan, originalText, fillColor);
    });
}

export function addHighlightRectangles(view: SearchView): void {
    const search = view.plugin.searchState;
    if (!search.active) return;

    const svg = view.contentEl.querySelector('.radial-timeline-svg');

    // Term highlighting is scoped: a body-only search must not paint the term
    // onto metadata it never looked at. The number squares below still light up
    // for every hit, whichever scope produced it.
    if (shouldHighlightMetadataTerm(search)) {
        applySearchTermHighlightsInRoot(view.contentEl, search.term);
    }

    // Mark search-result classes on scene groups with matched paths
    if (!svg) {
        return;
    }

    const allSceneGroups = svg.querySelectorAll('.rt-scene-group');
    allSceneGroups.forEach((group) => {
        const pathAttr = group.getAttribute('data-path');
        if (!pathAttr) return;
        if (!search.hits.has(decodeURIComponent(pathAttr))) return;

        const scenePath = group.querySelector('.rt-scene-path');
        const sceneId = scenePath?.id;
        if (!sceneId) return;

        const escapedSceneId = cssEscape(sceneId);
        const numberSquare = svg.querySelector(`.rt-number-square[data-scene-id="${escapedSceneId}"]`);
        const numberText = svg.querySelector(`.rt-number-text[data-scene-id="${escapedSceneId}"]`);
        if (numberSquare) numberSquare.classList.add('rt-search-result');
        if (numberText) numberText.classList.add('rt-search-result');
    });
}
