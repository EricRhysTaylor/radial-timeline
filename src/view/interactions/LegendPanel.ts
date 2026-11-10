import { withAccessibleLabel, withTooltip } from '../../utils/domTooltip';
/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Key panels
 * ----------
 * The keys behind the timeline's and the Timetable's ✱ button: titled
 * sections of rows, each an icon or a swatch with a label and a detail.
 * Hover or focus opens the panel for a look; it closes when the pointer
 * leaves both the button and the panel. A click on the button opens and
 * pins it: a pinned panel stays until Esc, a press anywhere else (another
 * key's button included), a second click on the button, or its pane losing
 * the focus. A layout change refills an open key, so it follows its view
 * (Reading and Editing) and its button's place.
 */

import { setIcon, type Component, type Workspace } from 'obsidian';

export interface LegendDetailSegment {
    text: string;
    color?: string;
}

export interface LegendSwatch {
    fill?: string;
    stroke?: string;
    text?: string;
    textColor?: string;
    /** A dashed outline (a sketch's number cell). */
    dashed?: boolean;
}

export interface LegendRow {
    icon?: string;
    swatch?: LegendSwatch;
    /** Ring squares in these colors; a null entry is an outlined (planned) square. */
    rings?: Array<string | null>;
    /**
     * Time reference marks as the timeline draws them: 'route' is the source circle, the line and an arrowhead;
     * 'direction' the back and forward arrowheads; 'beyond' the doubled ones; 'both' the diamond.
     */
    timeReference?: 'route' | 'direction' | 'beyond' | 'both';
    /** A filled dot in this color, like the Timetable's Due dot. */
    dot?: string;
    label: string;
    detail?: string;
    detailSegments?: LegendDetailSegment[];
    detailIcon?: string;
    detailIconLabel?: string;
}

export interface LegendSection {
    title: string;
    rows: LegendRow[];
}

/** Hang a key panel just below its button, inside the window. */
export function placeKeyPanel(button: HTMLElement, panel: HTMLElement): void {
    const box = button.getBoundingClientRect();
    const win = button.win;
    const width = Math.min(360, win.innerWidth - 32);
    const left = Math.max(8, Math.min(box.left, win.innerWidth - width - 8));
    const top = box.bottom + 6;
    panel.setCssProps({
        '--ert-key-top': `${top}px`,
        '--ert-key-left': `${left}px`,
        '--ert-key-max-height': `${Math.max(160, win.innerHeight - top - 12)}px`,
    });
}

/** Fill a key panel: a header (title and an optional badge), then the sections. */
export function renderLegendSurface(panel: HTMLElement, content: { title: string; badge?: string; sections: LegendSection[] }): HTMLElement {
    panel.empty();
    const surface = panel.createDiv({ cls: 'ert-timeline-legend__surface' });
    const header = surface.createDiv({ cls: 'ert-timeline-legend__header' });
    header.createDiv({ cls: 'ert-timeline-legend__title', text: content.title });
    if (content.badge) header.createDiv({ cls: 'ert-timeline-legend__mode', text: content.badge });

    for (const section of content.sections) {
        const sectionEl = surface.createEl('section', { cls: 'ert-timeline-legend__section' });
        sectionEl.createDiv({ cls: 'ert-timeline-legend__section-title', text: section.title });
        for (const row of section.rows) renderRow(sectionEl, row);
    }
    return surface;
}

/**
 * A time reference's marks in the key, in the proportions the timeline uses (chronologue/timeReferences/render.ts):
 * hollow arrowheads one and a half times as long as they are half wide, doubled past the timeline's ends.
 */
function renderReferenceGlyph(iconEl: HTMLElement, kind: NonNullable<LegendRow['timeReference']>): void {
    const win = iconEl.win;
    const svg = win.createSvg('svg');
    svg.setAttribute('class', 'ert-timeline-legend__reference');
    svg.setAttribute('viewBox', '0 0 28 12');
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag: 'circle' | 'line' | 'polygon', attrs: Record<string, number | string>) => {
        const el = win.createSvg(tag);
        for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
        svg.appendChild(el);
    };
    // An arrowhead centered at cx, pointing right (1) or left (-1).
    const arrow = (cx: number, dir: number) => add('polygon', { points: `${cx - dir * 2.25},2 ${cx + dir * 2.25},6 ${cx - dir * 2.25},10` });
    if (kind === 'route') {
        add('circle', { cx: 4, cy: 6, r: 3 });
        add('line', { x1: 7, y1: 6, x2: 20, y2: 6 });
        arrow(22.75, 1);
    } else if (kind === 'direction') {
        arrow(5, -1);
        arrow(23, 1);
    } else if (kind === 'beyond') {
        arrow(3.5, -1);
        arrow(7.1, -1);
        arrow(20.9, 1);
        arrow(24.5, 1);
    } else {
        add('polygon', { points: '16.25,6 14,2 11.75,6 14,10' });
    }
    iconEl.appendChild(svg);
}

function renderRow(sectionEl: HTMLElement, row: LegendRow): void {
    const rowEl = sectionEl.createDiv({ cls: 'ert-timeline-legend__row' });
    const iconEl = rowEl.createSpan({ cls: 'ert-timeline-legend__icon' });
    if (row.swatch) {
        iconEl.addClass('ert-timeline-legend__icon--swatch');
        const swatchEl = iconEl.createSpan({ cls: 'ert-timeline-legend__swatch', text: row.swatch.text ?? '' });
        swatchEl.toggleClass('is-dashed', row.swatch.dashed === true);
        const props: Record<string, string> = {};
        if (row.swatch.fill) props['--ert-legend-swatch-fill'] = row.swatch.fill;
        if (row.swatch.stroke) props['--ert-legend-swatch-stroke'] = row.swatch.stroke;
        if (row.swatch.textColor) props['--ert-legend-swatch-text'] = row.swatch.textColor;
        swatchEl.setCssProps(props);
    } else if (row.rings) {
        iconEl.addClass('ert-timeline-legend__icon--rings');
        for (const color of row.rings) {
            const square = iconEl.createSpan({ cls: 'ert-timeline-legend__ring' });
            if (color) square.setCssProps({ '--ert-legend-ring': color });
            else square.addClass('is-planned');
        }
    } else if (row.timeReference) {
        renderReferenceGlyph(iconEl, row.timeReference);
    } else if (row.dot) {
        iconEl.createSpan({ cls: 'ert-timeline-legend__dot' }).setCssProps({ '--ert-legend-dot': row.dot });
    } else if (row.icon) {
        setIcon(iconEl, row.icon);
    }

    const copyEl = rowEl.createSpan({ cls: 'ert-timeline-legend__copy' });
    copyEl.createSpan({ cls: 'ert-timeline-legend__label', text: row.label });
    if (!row.detail) return;
    const detailEl = copyEl.createSpan({ cls: 'ert-timeline-legend__detail' });
    if (row.detailSegments) {
        for (const segment of row.detailSegments) {
            const segmentEl = detailEl.createSpan({ text: segment.text });
            if (segment.color) {
                segmentEl.addClass('ert-timeline-legend__detail-segment');
                segmentEl.setCssProps({ '--ert-legend-segment-color': segment.color });
            }
        }
    } else {
        detailEl.appendText(row.detail);
    }
    if (row.detailIcon) {
        const label = row.detailIconLabel ?? row.detailIcon;
        const detailIconEl = withTooltip(withAccessibleLabel(detailEl.createSpan({ cls: 'ert-timeline-legend__detail-icon', attr: {  } }), label), label);
        setIcon(detailIconEl, row.detailIcon);
    }
}

/** The pinned key in each window, so a second key never stacks on it. */
const pinnedKeys = new WeakMap<Document, { panel: HTMLElement; hide: () => void }>();

/**
 * Open and close a key panel from its button. `beforeShow` fills (and may
 * place) the panel each time it opens; a hidden button never opens it.
 *
 * A click always opens and pins. It never closes a panel the same pointer
 * just opened by hovering: only a click on an already pinned panel does.
 *
 * Panels hang from the window, outside their pane, so the workspace closes
 * them: another pane taking the focus hides a key, and a layout change
 * hides one whose button is gone or hidden and refills one still showing.
 *
 * One key is pinned per window at a time. While one is pinned, hovering or
 * focusing another key's button opens nothing; clicking it moves the pin.
 */
export function wireLegendTrigger(component: Component, trigger: HTMLElement, panel: HTMLElement, beforeShow: () => void, workspace: Workspace): void {
    const doc = trigger.ownerDocument;
    let hideTimer: number | null = null;
    // Meaningful only while the panel is open: the view may close it itself
    // (a mode change does), and a panel that opens again starts unpinned.
    let pinned = false;
    const isOpen = () => panel.hasClass('is-visible');
    const isPinned = () => pinned && isOpen();
    const pinnedElsewhere = (): boolean => {
        const other = pinnedKeys.get(doc);
        return !!other && other.panel !== panel && other.panel.hasClass('is-visible');
    };
    const cancelHide = () => {
        if (hideTimer === null) return;
        window.clearTimeout(hideTimer);
        hideTimer = null;
    };
    const show = () => {
        cancelHide();
        if (trigger.hidden) return;
        if (isOpen()) return;
        pinned = false;
        beforeShow();
        panel.addClass('is-visible');
        trigger.setAttribute('aria-expanded', 'true');
    };
    const hide = () => {
        cancelHide();
        pinned = false;
        if (pinnedKeys.get(doc)?.panel === panel) pinnedKeys.delete(doc);
        panel.removeClass('is-visible');
        trigger.setAttribute('aria-expanded', 'false');
    };
    const pin = () => {
        // A keyboard click reaches no pointerdown, so the old pin goes here.
        const other = pinnedKeys.get(doc);
        if (other && other.panel !== panel) other.hide();
        pinned = true;
        pinnedKeys.set(doc, { panel, hide });
    };
    /** Hover and focus open a key for a look, unless another key is pinned. */
    const look = () => {
        if (pinnedElsewhere()) return;
        show();
    };
    /** Fill an open panel again, keeping it open (and pinned) unless its button went away. */
    const refill = () => {
        beforeShow();
        if (trigger.hidden) {
            hide();
            return;
        }
        panel.addClass('is-visible');
    };
    const scheduleHide = () => {
        if (isPinned()) return;
        cancelHide();
        hideTimer = window.setTimeout(() => {
            hideTimer = null;
            if (isPinned()) return;
            if (panel.matches(':hover') || trigger.matches(':hover') || panel.contains(doc.activeElement)) return;
            hide();
        }, 120);
    };

    // Unload closes the key and clears its pin: a pane closed with its key
    // pinned (Cmd+W) fires no event here, and a pin left behind would stop
    // every other key in the window from opening on hover.
    component.register(hide);
    component.registerDomEvent(trigger, 'mouseenter', look);
    component.registerDomEvent(trigger, 'focus', look);
    component.registerDomEvent(trigger, 'mouseleave', scheduleHide);
    component.registerDomEvent(trigger, 'blur', scheduleHide);
    component.registerDomEvent(trigger, 'click', (evt: MouseEvent) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (isPinned()) {
            hide();
            return;
        }
        show();
        if (isOpen()) pin();
    });
    component.registerDomEvent(panel, 'mouseenter', show);
    component.registerDomEvent(panel, 'mouseleave', scheduleHide);
    // Capture phase on the document: it runs before any button stops its
    // own click, so pressing another key's button closes this one.
    component.registerDomEvent(doc, 'pointerdown', (evt: PointerEvent) => {
        if (!isOpen()) return;
        const target = evt.target instanceof Node ? evt.target : null;
        if (target && (panel.contains(target) || trigger.contains(target))) return;
        hide();
    }, { capture: true });
    component.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
        if (evt.key === 'Escape') hide();
    });
    component.registerEvent(workspace.on('active-leaf-change', leaf => {
        if (!isOpen()) return;
        // The key's own pane taking the focus (a formatting row does) keeps it.
        if (leaf?.view.containerEl.contains(trigger)) return;
        hide();
    }));
    component.registerEvent(workspace.on('layout-change', () => {
        if (!isOpen()) return;
        if (!trigger.isConnected || !trigger.isShown()) {
            hide();
            return;
        }
        refill();
    }));
}
