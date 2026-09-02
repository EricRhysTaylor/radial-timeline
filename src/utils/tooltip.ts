/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Unified Tooltip Utility for Radial Timeline
 * 
 * Provides consistent bubble tooltips throughout the plugin.
 * 
 * STRATEGY:
 * 1. For HTML components (Settings, Modals): Uses Obsidian's native `setTooltip` or `component.setTooltip()`.
 * 2. For SVG elements (Timeline View): Uses a CUSTOM DOM implementation (.rt-tooltip)
 *    because Obsidian's API relies on getBoundingClientRect() which can be flaky with SVG transforms,
 *    and the previous hack of creating anchor elements caused modal focus issues.
 */

import { setTooltip, ButtonComponent, ExtraButtonComponent } from 'obsidian';
import { splitIntoBalancedLinesOptimal } from './text';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

const DEFAULT_TOOLTIP_BALANCE_WIDTH = 360;

const TOOLTIP_ATTR = 'data-tooltip';
const TOOLTIP_PLACEMENT_ATTR = 'data-tooltip-placement';
const TOOLTIP_ANCHOR_ATTR = 'data-tooltip-anchor';
const TOOLTIP_OFFSET_X_ATTR = 'data-tooltip-offset-x';
const TOOLTIP_OFFSET_Y_ATTR = 'data-tooltip-offset-y';
const RT_TOOLTIP_ATTR = 'data-rt-tip';
const RT_TOOLTIP_PLACEMENT_ATTR = 'data-rt-tip-placement';
const RT_TOOLTIP_ANCHOR_ATTR = 'data-rt-tip-anchor';
const RT_TOOLTIP_OFFSET_X_ATTR = 'data-rt-tip-offset-x';
const RT_TOOLTIP_OFFSET_Y_ATTR = 'data-rt-tip-offset-y';
const RT_TOOLTIP_TONE_ATTR = 'data-rt-tip-tone';
const TOOLTIP_ACTIVE_CLASS = 'rt-tooltip-active';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Set (or clear, with `null`) the accessible name of an SVG element via a
 * `<title>` child — the SVG-native accessible name, which also yields a
 * native hover tooltip.
 *
 * NEVER put `aria-label` (or call `setTooltip`) on an SVG element. Obsidian's
 * global tooltip handler shows a tooltip for any aria-labelled element and, on
 * its hover-delay timer, calls `HTMLElement.isShown()` — a method Obsidian
 * adds to `HTMLElement.prototype` (its `enhance.js`) that `SVGElement` does NOT
 * inherit. The result is the recurring `e.isShown is not a function` crash.
 * `<title>` involves no Obsidian code path, so it is crash-safe on SVG.
 */
export function setSvgAccessibleName(el: Element, name: string | null): void {
    const existing = Array.from(el.children).find(
        child => child.tagName.toLowerCase() === 'title'
    ) ?? null;
    if (name === null || name === '') {
        existing?.remove();
        return;
    }
    if (existing) {
        if (existing.textContent !== name) existing.textContent = name;
        return;
    }
    const title = el.ownerDocument.createElementNS(SVG_NS, 'title');
    title.textContent = name;
    el.insertBefore(title, el.firstChild);
}

// Singleton tooltip element
let customTooltipEl: HTMLElement | null = null;
let currentTarget: Element | null = null;
let hideTimeout: number | null = null;

function getTooltipKeyPeers(target: Element): Element[] {
    const key = target.getAttribute('data-tooltip-key');
    if (!key) return [];
    return Array.from(target.ownerDocument.querySelectorAll(`[data-tooltip-key="${key}"]`));
}

function clearActiveTooltipTarget(target: Element | null): void {
    if (!target) return;
    const peers = getTooltipKeyPeers(target);
    if (peers.length > 0) {
        peers.forEach((peer) => {
            peer.classList.remove(TOOLTIP_ACTIVE_CLASS);
            peer.closest('.rt-backdrop-micro-outer')?.classList.remove(TOOLTIP_ACTIVE_CLASS);
        });
        return;
    }
    target.classList.remove(TOOLTIP_ACTIVE_CLASS);
    target.closest('.rt-backdrop-micro-outer')?.classList.remove(TOOLTIP_ACTIVE_CLASS);
}

function setActiveTooltipTarget(target: Element | null): void {
    if (!target) return;
    const peers = getTooltipKeyPeers(target);
    if (peers.length > 0) {
        peers.forEach((peer) => {
            peer.classList.add(TOOLTIP_ACTIVE_CLASS);
            peer.closest('.rt-backdrop-micro-outer')?.classList.add(TOOLTIP_ACTIVE_CLASS);
        });
        return;
    }
    target.classList.add(TOOLTIP_ACTIVE_CLASS);
    target.closest('.rt-backdrop-micro-outer')?.classList.add(TOOLTIP_ACTIVE_CLASS);
}

function isSvgLikeElement(element: Element): element is SVGElement {
    if (element.instanceOf(SVGElement)) return true;
    return element.namespaceURI === 'http://www.w3.org/2000/svg';
}

function readAttr(target: Element, rtAttr: string, fallbackAttr: string): string {
    return target.getAttribute(rtAttr) || target.getAttribute(fallbackAttr) || '';
}

function readAttrWithMode(target: Element, rtAttr: string, fallbackAttr: string, rtOnly: boolean): string {
    if (rtOnly) return target.getAttribute(rtAttr) || '';
    return readAttr(target, rtAttr, fallbackAttr);
}

function getTooltipText(target: Element, rtOnly = false): string {
    if (rtOnly) return target.getAttribute(RT_TOOLTIP_ATTR) || '';
    return readAttr(target, RT_TOOLTIP_ATTR, TOOLTIP_ATTR);
}

function getTooltipPlacement(target: Element, rtOnly = false): TooltipPlacement {
    const raw = readAttrWithMode(target, RT_TOOLTIP_PLACEMENT_ATTR, TOOLTIP_PLACEMENT_ATTR, rtOnly);
    return (raw || 'bottom') as TooltipPlacement;
}

function getTooltipAnchor(target: Element, rtOnly = false): string {
    return readAttrWithMode(target, RT_TOOLTIP_ANCHOR_ATTR, TOOLTIP_ANCHOR_ATTR, rtOnly);
}

function getTooltipOffset(target: Element, rtOnly = false): { x: number; y: number } {
    const offsetX = parseFloat(readAttrWithMode(target, RT_TOOLTIP_OFFSET_X_ATTR, TOOLTIP_OFFSET_X_ATTR, rtOnly) || '0') || 0;
    const offsetY = parseFloat(readAttrWithMode(target, RT_TOOLTIP_OFFSET_Y_ATTR, TOOLTIP_OFFSET_Y_ATTR, rtOnly) || '0') || 0;
    return { x: offsetX, y: offsetY };
}

function resolveTooltipTarget(start: EventTarget | null, rtOnly = false): Element | null {
    if (!(start instanceof Element)) return null;
    const selector = rtOnly
        ? `[${RT_TOOLTIP_ATTR}]`
        : `[${RT_TOOLTIP_ATTR}], [${TOOLTIP_ATTR}], .rt-tooltip-target`;
    const target = start.closest(selector);
    if (!target) return null;
    return getTooltipText(target, rtOnly) ? target : null;
}

/**
 * Apply a tooltip to an element.
 * 
 * @param element - The target element (HTML or SVG)
 * @param text - Tooltip text to display
 * @param placement - Where to show the tooltip
 */
export function tooltip(
    element: HTMLElement | SVGElement,
    text: string,
    placement: TooltipPlacement = 'bottom',
    maxWidth?: number,
    options?: { custom?: boolean }
): void {
    const balancedText = maxWidth !== undefined
        ? balanceTooltipText(text, maxWidth)
        : balanceTooltipText(text);
    if (isSvgLikeElement(element) || options?.custom) {
        // Use data attributes for delegation (handled by setupTooltipsFromDataAttributes).
        // `custom: true` forces the rt-tooltip path for HTML elements that live
        // inside an SVG foreignObject — lets us render title/body splits that
        // Obsidian's native tooltip can't style.
        addTooltipData(element, balancedText, placement);
        return;
    }
    if (element.instanceOf(HTMLElement)) {
        // Use native Obsidian tooltip for standard HTML UI elements
        setTooltip(element, balancedText, { placement });
    }
}

/**
 * Apply tooltip to an Obsidian Component (Button, etc.)
 */
export function tooltipForComponent(
    component: ButtonComponent | ExtraButtonComponent,
    text: string,
    placement: TooltipPlacement = 'bottom'
): void {
    const balancedText = balanceTooltipText(text);
    // Access the underlying button element
    const buttonEl = (component as unknown as { buttonEl?: HTMLElement }).buttonEl;
    if (buttonEl) {
        setTooltip(buttonEl, balancedText, { placement });
    } else {
        component.setTooltip(balancedText);
    }
}

export function balanceTooltipText(text: string, maxWidth: number = DEFAULT_TOOLTIP_BALANCE_WIDTH): string {
    if (!text) return text;

    return text
        .split('\n\n')
        .map((section) => section
            .split('\n')
            .map((line) => balanceTooltipLine(line, maxWidth))
            .join('\n'))
        .join('\n\n');
}

function balanceTooltipLine(line: string, maxWidth: number): string {
    const leadingWhitespaceMatch = line.match(/^(\s*)(.*)$/);
    const leadingWhitespace = leadingWhitespaceMatch?.[1] ?? '';
    const trimmed = (leadingWhitespaceMatch?.[2] ?? '').trim();
    if (!trimmed) return '';

    const bulletMatch = trimmed.match(/^([-*]\s+)(.+)$/);
    if (bulletMatch) {
        const [, prefix, content] = bulletMatch;
        const balancedLines = splitIntoBalancedLinesOptimal(content, Math.max(200, maxWidth - 24), 1);
        return balancedLines
            .map((entry, index) => `${leadingWhitespace}${index === 0 ? prefix : ' '.repeat(prefix.length)}${entry}`)
            .join('\n');
    }

    const balancedLines = splitIntoBalancedLinesOptimal(trimmed, maxWidth, 1);
    return balancedLines
        .map((entry) => `${leadingWhitespace}${entry}`)
        .join('\n');
}

/**
 * Helper to add data attributes to an element for batch setup.
 */
export function addTooltipData(
    element: HTMLElement | SVGElement,
    text: string,
    placement: TooltipPlacement = 'bottom'
): void {
    if (isSvgLikeElement(element)) {
        // Avoid Obsidian native tooltip interception on SVG nodes.
        element.classList.remove('rt-tooltip-target');
        element.setAttribute(RT_TOOLTIP_ATTR, text);
        element.setAttribute(RT_TOOLTIP_PLACEMENT_ATTR, placement);
        element.removeAttribute(TOOLTIP_ATTR);
        element.removeAttribute(TOOLTIP_PLACEMENT_ATTR);
        element.removeAttribute(TOOLTIP_ANCHOR_ATTR);
        element.removeAttribute(TOOLTIP_OFFSET_X_ATTR);
        element.removeAttribute(TOOLTIP_OFFSET_Y_ATTR);
        return;
    }
    element.classList.add('rt-tooltip-target');
    element.setAttribute(TOOLTIP_ATTR, text);
    element.setAttribute(TOOLTIP_PLACEMENT_ATTR, placement);
}

/**
 * Setup delegated tooltip handling for SVG elements.
 * Uses a single custom .rt-tooltip DOM element for performance and compatibility.
 */
type DomEventRegistrar = (element: HTMLElement, event: string, handler: (ev: Event) => void) => void;
type TooltipSetupOptions = { rtOnly?: boolean };

export function setupTooltipsFromDataAttributes(
    container: HTMLElement | SVGElement,
    registerDomEvent: DomEventRegistrar,
    options?: TooltipSetupOptions
): void {
    const svgElement = isSvgLikeElement(container) ? container : container.querySelector('svg');
    if (!svgElement) return;
    const rtOnly = options?.rtOnly === true;
    const resolveTarget = (start: EventTarget | null): Element | null => resolveTooltipTarget(start, rtOnly);

    // Lazy initialization: singleton is created only when needed (in showCustomTooltip)

    const handleMouseOver = (e: Event) => {
        const target = resolveTarget(e.target);
        if (target) {
            // Cancel any pending hide immediately when entering a tooltip target
            if (hideTimeout) {
                window.clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            
            // Only update if it's a different target
            if (target !== currentTarget) {
                clearActiveTooltipTarget(currentTarget);
                currentTarget = target;
                const text = getTooltipText(target, rtOnly);
                const placement = getTooltipPlacement(target, rtOnly);
                const anchor = getTooltipAnchor(target, rtOnly);
                
                if (text) {
                    const mouseEvent = e as MouseEvent;
                    const anchorPoint = anchor === 'cursor'
                        ? { x: mouseEvent.clientX, y: mouseEvent.clientY }
                        : undefined;
                    showCustomTooltip(target, text, placement, anchorPoint, rtOnly);
                }
            }
        }
    };

    const handleMouseOut = (e: Event) => {
        if (!currentTarget) return;

        const target = resolveTarget(e.target);
        const relatedTarget = (e as MouseEvent).relatedTarget as Element | null;

        // Check if we moved to another tooltip target
        const newTarget = resolveTarget(relatedTarget);

        // If moving to another tooltip target, don't hide - mouseover will handle the switch
        if (newTarget) {
            return;
        }

        // Case 1: Normal case - we can identify the source tooltip target
        if (target && target === currentTarget) {
            // Delay hiding to allow moving to tooltip (if interactive) or reducing flicker
            hideTimeout = window.setTimeout(hideCustomTooltip, 100);
            return;
        }
        
        // Case 2: Target couldn't be resolved (e.g., events from foreignObject/HTML content)
        // Check if relatedTarget is still inside currentTarget
        if (!target && currentTarget) {
            const stillInsideCurrentTarget = relatedTarget && currentTarget.contains(relatedTarget);
            if (!stillInsideCurrentTarget) {
                hideTimeout = window.setTimeout(hideCustomTooltip, 100);
                return;
            }
        }
        
        // Case 3: relatedTarget is null (left SVG entirely)
        if (!relatedTarget) {
            hideTimeout = window.setTimeout(hideCustomTooltip, 100);
        }
    };
    
    // Additional mouseleave handler to catch edge cases with foreignObject/HTML content
    // mouseleave doesn't bubble, so it fires when truly leaving the SVG
    const handleMouseLeave = () => {
        if (currentTarget) {
            // Clear any existing timeout before setting new one
            if (hideTimeout) {
                window.clearTimeout(hideTimeout);
            }
            hideTimeout = window.setTimeout(hideCustomTooltip, 100);
        }
    };

    // Hide tooltip on click (button clicks should dismiss tooltip immediately)
    const handleClick = (e: Event) => {
        const target = resolveTarget(e.target);
        if (target) {
            // Immediately hide tooltip when clicking a tooltip target
            if (hideTimeout) {
                window.clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            hideCustomTooltip();
        }
    };

    const handleMouseMove = (e: Event) => {
        if (!currentTarget || !customTooltipEl) return;
        const anchor = getTooltipAnchor(currentTarget, rtOnly);
        if (anchor !== 'cursor') return;
        const placement = getTooltipPlacement(currentTarget, rtOnly);
        const mouseEvent = e as MouseEvent;
        updateTooltipPosition(currentTarget, placement, { x: mouseEvent.clientX, y: mouseEvent.clientY }, rtOnly);
    };

    // Use Obsidian lifecycle-backed registration for automatic cleanup
    registerDomEvent(svgElement as unknown as HTMLElement, 'mouseover', handleMouseOver);
    registerDomEvent(svgElement as unknown as HTMLElement, 'mouseout', handleMouseOut);
    registerDomEvent(svgElement as unknown as HTMLElement, 'mouseleave', handleMouseLeave);
    registerDomEvent(svgElement as unknown as HTMLElement, 'click', handleClick);
    registerDomEvent(svgElement as unknown as HTMLElement, 'mousemove', handleMouseMove);
}

/**
 * Clean up global tooltip element.
 * Called from Plugin.onunload()
 */
export function cleanupTooltipAnchors(): void {
    if (customTooltipEl) {
        customTooltipEl.remove();
        customTooltipEl = null;
    }
    currentTarget = null;
    if (hideTimeout) {
        window.clearTimeout(hideTimeout);
        hideTimeout = null;
    }
}

// --- Internal Implementation ---

function ensureCustomTooltip(doc: Document) {
    // One tooltip exists at a time, in the document of the current hover
    // target — recreate it when the user hovers in a different window.
    if (customTooltipEl?.ownerDocument === doc) return;

    customTooltipEl?.remove();
    customTooltipEl = doc.win.createDiv();
    customTooltipEl.classList.add('rt-tooltip');
    doc.body.appendChild(customTooltipEl);
}

function updateTooltipWidth(): void {
    if (!customTooltipEl) return;
    customTooltipEl.style.removeProperty('--rt-tooltip-width');
    const naturalWidth = customTooltipEl.getBoundingClientRect().width;
    const naturalHeight = customTooltipEl.getBoundingClientRect().height;

    if (naturalWidth <= 0) return;

    // Single line — just lock width as-is
    if (naturalHeight <= 20) {
        customTooltipEl.style.setProperty('--rt-tooltip-width', `${Math.ceil(naturalWidth)}px`);
        return;
    }

    // Multi-line: binary-search for the narrowest width that keeps the same line count.
    // This produces balanced-looking lines with a tight-fitting box.
    let lo = naturalWidth * 0.5;
    let hi = naturalWidth;

    while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        customTooltipEl.style.setProperty('--rt-tooltip-width', `${mid}px`);
        if (customTooltipEl.getBoundingClientRect().height > naturalHeight) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    customTooltipEl.style.setProperty('--rt-tooltip-width', `${Math.ceil(hi)}px`);
}

type TooltipAnchorPoint = { x: number; y: number };

function updateTooltipPosition(
    target: Element,
    placement: TooltipPlacement,
    anchorPoint?: TooltipAnchorPoint,
    rtOnly = false
) {
    if (!customTooltipEl) return;

    const tooltipRect = customTooltipEl.getBoundingClientRect();
    let top = 0;
    let left = 0;

    if (anchorPoint) {
        switch (placement) {
            case 'bottom':
                left = anchorPoint.x;
                top = anchorPoint.y;
                break;
            case 'top':
                left = anchorPoint.x;
                top = anchorPoint.y - tooltipRect.height;
                break;
            case 'left':
                left = anchorPoint.x - tooltipRect.width;
                top = anchorPoint.y;
                break;
            case 'right':
                left = anchorPoint.x;
                top = anchorPoint.y;
                break;
        }
    } else {
        const rect = target.getBoundingClientRect();
        switch (placement) {
            case 'bottom':
                left = rect.left + (rect.width / 2);
                top = rect.bottom;
                break;
            case 'top':
                left = rect.left + (rect.width / 2);
                top = rect.top - tooltipRect.height;
                break;
            case 'left':
                left = rect.left - tooltipRect.width;
                top = rect.top + (rect.height / 2);
                break;
            case 'right':
                left = rect.right;
                top = rect.top + (rect.height / 2);
                break;
        }
    }

    const offset = getTooltipOffset(target, rtOnly);

    customTooltipEl.style.top = `${top + offset.y}px`;
    customTooltipEl.style.left = `${left + offset.x}px`;
}

function showCustomTooltip(
    target: Element,
    text: string,
    placement: TooltipPlacement,
    anchorPoint?: TooltipAnchorPoint,
    rtOnly = false
) {
    ensureCustomTooltip(target.ownerDocument);
    if (!customTooltipEl) return;

    // Cancel pending hide
    if (hideTimeout) {
        window.clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    // Update content. Tooltips authored as "Title\n\nBody" render as two
    // elements so the title can be all-caps and the body justified. Plain
    // tooltips fall back to setText unchanged.
    const paragraphs = text.split(/\n{2,}/);
    if (paragraphs.length >= 2) {
        customTooltipEl.empty();
        const title = paragraphs[0].replace(/\n/g, ' ').trim();
        const body = paragraphs.slice(1).join(' ').replace(/\n/g, ' ').trim();
        customTooltipEl.createDiv({ cls: 'rt-tooltip__title', text: title });
        customTooltipEl.createDiv({ cls: 'rt-tooltip__body', text: body });
    } else {
        customTooltipEl.setText(text);
    }

    // Reset classes and position before measuring to avoid shrink-to-fit from the previous location.
    customTooltipEl.className = 'rt-tooltip'; // reset placement classes
    customTooltipEl.style.removeProperty('--rt-tooltip-tone-color');
    const tone = target.getAttribute(RT_TOOLTIP_TONE_ATTR);
    if (tone) {
        customTooltipEl.classList.add(`rt-tooltip-tone-${tone.replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`);
        const toneColor = window.getComputedStyle(target).getPropertyValue('--ert-inquiry-minimap-tick-color').trim();
        if (toneColor) {
            customTooltipEl.style.setProperty('--rt-tooltip-tone-color', toneColor);
        }
    }
    customTooltipEl.style.removeProperty('left');
    customTooltipEl.style.removeProperty('top');
    updateTooltipWidth();

    customTooltipEl.classList.add(`rt-placement-${placement}`);
    
    updateTooltipPosition(target, placement, anchorPoint, rtOnly);

    // Show
    setActiveTooltipTarget(target);
    customTooltipEl.classList.add('rt-visible');
}

function hideCustomTooltip() {
    clearActiveTooltipTarget(currentTarget);
    if (customTooltipEl) {
        customTooltipEl.classList.remove('rt-visible');
        currentTarget = null;
    }
}
