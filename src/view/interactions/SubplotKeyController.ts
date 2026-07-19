/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Subplot ring key — compact overlay that maps ring order + subplot color to
 * subplot name. Built for books with many subplot rings (10+), where the
 * curved ring labels become hard to read at a glance.
 *
 * Three ways in:
 * - Hover the layers trigger icon in the view title bar (right of the
 *   Discord chip; created once by TimeLineView, wired here per render).
 * - Click the trigger to pin the key open (survives re-renders).
 * - Hold Shift to show the key while held (not in Chronologue mode, which
 *   owns Shift for elapsed-time comparison).
 *
 * Hovering a key row spotlights that ring by dimming every other ring's
 * scenes, number squares, and titles with the existing rt-non-selected
 * treatment — the same visual grammar as scene hover.
 *
 * Ring data is read from the rendered SVG's subplot ring labels (stamped by
 * SubplotLabels.ts from Precompute's masterSubplotOrder/colorIndexBySubplot),
 * so the key can never drift from what the rings actually show.
 */

import { RadialTimelineView } from '../TimeLineView';

interface SubplotKeyEntry {
    ring: number;
    colorIndex: number;
    /** Text exactly as shown on the ring (outer ring says e.g. "ALL SCENES"). */
    ringLabel: string;
    /** Underlying subplot name (original casing). */
    subplotName: string;
}

// The trigger (title bar) and panel (timeline container) are spatially apart,
// so give the pointer a comfortable window to travel between them.
const HIDE_DELAY_MS = 260;

function collectEntries(svg: SVGSVGElement): SubplotKeyEntry[] {
    const labels = Array.from(svg.querySelectorAll('.rt-subplot-ring-label-text'));
    const entries: SubplotKeyEntry[] = [];
    labels.forEach(label => {
        // Stamped by SubplotLabels.ts in the same render; a label missing them
        // is stale markup and gets no key row rather than an invented color.
        const ringAttr = label.getAttribute('data-ring');
        const colorAttr = label.getAttribute('data-color-index');
        const subplotName = label.getAttribute('data-subplot-name');
        if (!ringAttr || !colorAttr || !subplotName) return;
        const ring = parseInt(ringAttr, 10);
        const colorIndex = parseInt(colorAttr, 10);
        if (isNaN(ring) || isNaN(colorIndex)) return;
        const text = label.textContent?.trim();
        entries.push({ ring, colorIndex, ringLabel: text ? text : subplotName, subplotName });
    });
    // Outer ring first (largest ring index renders outermost).
    entries.sort((a, b) => b.ring - a.ring);
    return entries;
}

export function setupSubplotKeyController(
    view: RadialTimelineView,
    svg: SVGSVGElement,
    container: HTMLElement
): void {
    // Tear down the previous render's instance (document-level listeners).
    if (view._subplotKeyCleanup) {
        view._subplotKeyCleanup();
        view._subplotKeyCleanup = undefined;
    }

    // The persistent title-bar trigger (created once in ensureBookSwitcher).
    const trigger = view.subplotKeyTriggerEl;
    if (!trigger) return;
    trigger.hidden = true;

    // Gossamer hides ring labels entirely; a single ring needs no key.
    if (view.currentMode === 'gossamer') return;
    const entries = collectEntries(svg);
    if (entries.length < 2) return;

    const doc = container.ownerDocument;
    // SAFE: the container is part of a live view; its document always has a window (popout-safe)
    const win = doc.defaultView!;

    trigger.hidden = false;
    trigger.setAttribute('aria-expanded', 'false');

    const panel = doc.createElement('div');
    panel.className = 'ert-timeline-subplot-key';

    const surface = doc.createElement('div');
    surface.className = 'ert-timeline-subplot-key__surface';
    panel.appendChild(surface);

    const header = doc.createElement('div');
    header.className = 'ert-timeline-subplot-key__header';
    header.textContent = 'Ring key';
    const headerHint = doc.createElement('span');
    headerHint.className = 'ert-timeline-subplot-key__hint';
    headerHint.textContent = 'Outer → inner';
    header.appendChild(headerHint);
    surface.appendChild(header);

    const rows = doc.createElement('div');
    rows.className = 'ert-timeline-subplot-key__rows';
    surface.appendChild(rows);

    // Ring-spotlight state: elements we dimmed (only ones that were not
    // already dimmed by search/hover states, so we never clear foreign state).
    let dimmed: Element[] = [];
    const dim = (el: Element) => {
        if (el.classList.contains('rt-non-selected')) return;
        el.classList.add('rt-non-selected');
        dimmed.push(el);
    };
    const clearSpotlight = () => {
        dimmed.forEach(el => el.classList.remove('rt-non-selected'));
        dimmed = [];
    };
    const spotlightRing = (ring: number) => {
        clearSpotlight();
        // Scene paths and titles live inside ring-stamped groups; number
        // squares/text live in their own layer keyed by data-scene-id, which
        // matches the group path's id — same lookup scene hover uses.
        const keepSceneIds = new Set<string>();
        svg.querySelectorAll('.rt-scene-group').forEach(group => {
            const path = group.querySelector('.rt-scene-path');
            if (group.getAttribute('data-ring') === String(ring)) {
                if (path?.id) keepSceneIds.add(path.id);
                return;
            }
            group.querySelectorAll('.rt-scene-path, .rt-scene-title').forEach(dim);
        });
        svg.querySelectorAll('.rt-number-square, .rt-number-text').forEach(el => {
            const sceneId = el.getAttribute('data-scene-id');
            if (sceneId && keepSceneIds.has(sceneId)) return;
            dim(el);
        });
    };

    entries.forEach((entry, i) => {
        const row = doc.createElement('button');
        row.className = 'ert-timeline-subplot-key__row';
        row.type = 'button';

        const num = doc.createElement('span');
        num.className = 'ert-timeline-subplot-key__num';
        num.textContent = String(i + 1);
        row.appendChild(num);

        const swatch = doc.createElement('span');
        swatch.className = 'ert-timeline-subplot-key__swatch';
        swatch.style.setProperty('--ert-subplot-key-swatch', `var(--rt-subplot-colors-${entry.colorIndex})`);
        row.appendChild(swatch);

        const name = doc.createElement('span');
        name.className = 'ert-timeline-subplot-key__name';
        // Outer ring keeps its on-ring label ("ALL SCENES" / "MAIN PLOT");
        // subplot rings show the author's subplot name in its original casing.
        const isOuterRow = i === 0;
        name.textContent = isOuterRow ? entry.ringLabel : entry.subplotName;
        if (isOuterRow) name.classList.add('ert-timeline-subplot-key__name--ring-label');
        row.appendChild(name);

        row.addEventListener('mouseenter', () => spotlightRing(entry.ring)); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
        row.addEventListener('mouseleave', clearSpotlight); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
        row.addEventListener('focus', () => spotlightRing(entry.ring)); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
        row.addEventListener('blur', clearSpotlight); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
        rows.appendChild(row);
    });

    let hideTimer: number | null = null;
    const cancelHide = () => {
        if (hideTimer !== null) {
            win.clearTimeout(hideTimer);
            hideTimer = null;
        }
    };
    const show = () => {
        cancelHide();
        panel.classList.add('is-visible');
        trigger.setAttribute('aria-expanded', 'true');
    };
    const hide = () => {
        cancelHide();
        if (view.subplotKeyPinned) return;
        panel.classList.remove('is-visible', 'is-key-held');
        trigger.setAttribute('aria-expanded', 'false');
        clearSpotlight();
    };
    const scheduleHide = () => {
        cancelHide();
        hideTimer = win.setTimeout(() => {
            hideTimer = null;
            if (panel.matches(':hover') || trigger.matches(':hover') || panel.classList.contains('is-key-held')) return;
            hide();
        }, HIDE_DELAY_MS);
    };

    // The trigger persists across renders, so its handlers must be named and
    // explicitly removed in cleanup — otherwise each render stacks another set.
    const handleTriggerClick = (evt: MouseEvent) => {
        evt.preventDefault();
        evt.stopPropagation();
        view.subplotKeyPinned = !view.subplotKeyPinned;
        trigger.classList.toggle('is-pinned', view.subplotKeyPinned);
        if (view.subplotKeyPinned) show(); else hide();
    };
    trigger.addEventListener('mouseenter', show); // SAFE: removed by _subplotKeyCleanup on re-render/close
    trigger.addEventListener('mouseleave', scheduleHide); // SAFE: removed by _subplotKeyCleanup on re-render/close
    trigger.addEventListener('click', handleTriggerClick); // SAFE: removed by _subplotKeyCleanup on re-render/close
    panel.addEventListener('mouseenter', show); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
    panel.addEventListener('mouseleave', scheduleHide); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close

    // Hold Shift to peek at the key. Chronologue owns Shift (elapsed-time
    // comparison), so the shortcut is disabled there.
    const shiftEligible = view.currentMode !== 'chronologue';
    const isTypingContext = (): boolean => {
        const active = doc.activeElement as HTMLElement | null;
        if (!active) return false;
        const tag = active.tagName.toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!shiftEligible || e.key !== 'Shift' || e.repeat) return;
        if (view.app.workspace.getActiveViewOfType(RadialTimelineView) !== view) return;
        if (isTypingContext()) return;
        show();
        panel.classList.add('is-key-held');
    };
    const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key !== 'Shift') return;
        if (!panel.classList.contains('is-key-held')) return;
        panel.classList.remove('is-key-held');
        if (!panel.matches(':hover') && !trigger.matches(':hover')) hide();
    };
    const handleWindowBlur = () => {
        if (!panel.classList.contains('is-key-held')) return;
        panel.classList.remove('is-key-held');
        hide();
    };
    // SAFE: document/window listeners removed via view._subplotKeyCleanup (called on
    // every re-render before re-setup, and on view close).
    doc.addEventListener('keydown', handleKeyDown); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
    doc.addEventListener('keyup', handleKeyUp); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close
    win.addEventListener('blur', handleWindowBlur); // SAFE: torn down with the element by _subplotKeyCleanup on re-render/close

    container.appendChild(panel);

    // Restore pinned state across re-renders.
    trigger.classList.toggle('is-pinned', view.subplotKeyPinned);
    if (view.subplotKeyPinned) {
        show();
    }

    view._subplotKeyCleanup = () => {
        cancelHide();
        clearSpotlight();
        doc.removeEventListener('keydown', handleKeyDown);
        doc.removeEventListener('keyup', handleKeyUp);
        win.removeEventListener('blur', handleWindowBlur);
        trigger.removeEventListener('mouseenter', show);
        trigger.removeEventListener('mouseleave', scheduleHide);
        trigger.removeEventListener('click', handleTriggerClick);
        trigger.hidden = true;
        panel.remove();
    };
}
