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
 * pins it: a pinned panel stays until Esc, a click elsewhere, or a second
 * click on the button.
 */

import { setIcon, type Component } from 'obsidian';

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
    /** A time reference as drawn on the wheel, in this color: source square, connector, date square. */
    timeReference?: string;
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
        iconEl.addClass('ert-timeline-legend__icon--reference');
        iconEl.setCssProps({ '--ert-legend-reference': row.timeReference });
        iconEl.createSpan({ cls: 'ert-timeline-legend__reference-source' });
        iconEl.createSpan({ cls: 'ert-timeline-legend__reference-line' });
        iconEl.createSpan({ cls: 'ert-timeline-legend__reference-date' });
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

/**
 * Open and close a key panel from its button. `beforeShow` fills (and may
 * place) the panel each time it opens; a hidden button never opens it.
 *
 * A click always opens and pins. It never closes a panel the same pointer
 * just opened by hovering: only a click on an already pinned panel does.
 */
export function wireLegendTrigger(component: Component, trigger: HTMLElement, panel: HTMLElement, beforeShow: () => void): void {
    const doc = trigger.ownerDocument;
    let hideTimer: number | null = null;
    // Meaningful only while the panel is open: the view may close it itself
    // (a mode change does), and a panel that opens again starts unpinned.
    let pinned = false;
    const isOpen = () => panel.hasClass('is-visible');
    const isPinned = () => pinned && isOpen();
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
        panel.removeClass('is-visible');
        trigger.setAttribute('aria-expanded', 'false');
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

    component.register(cancelHide);
    component.registerDomEvent(trigger, 'mouseenter', show);
    component.registerDomEvent(trigger, 'focus', show);
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
        if (isOpen()) pinned = true;
    });
    component.registerDomEvent(panel, 'mouseenter', show);
    component.registerDomEvent(panel, 'mouseleave', scheduleHide);
    component.registerDomEvent(doc.body, 'click', (evt: MouseEvent) => {
        const target = evt.target instanceof Node ? evt.target : null;
        if (target && (panel.contains(target) || trigger.contains(target))) return;
        hide();
    });
    component.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
        if (evt.key === 'Escape') hide();
    });
}
