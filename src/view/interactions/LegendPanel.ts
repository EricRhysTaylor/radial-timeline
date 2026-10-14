/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Key panels
 * ----------
 * The keys behind the timeline's and the Timetable's ✱ button: titled
 * sections of rows, each an icon or a swatch with a label and a detail.
 * The panel opens on hover, focus or click and closes on Esc, a click
 * elsewhere, or when the pointer leaves both the button and the panel.
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

/** Fill a key panel: a header (title and an optional badge), then the sections. */
export function renderLegendSurface(panel: HTMLElement, content: { title: string; badge?: string; sections: LegendSection[] }): void {
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
        const detailIconEl = detailEl.createSpan({ cls: 'ert-timeline-legend__detail-icon', attr: { 'aria-label': label, title: label } });
        setIcon(detailIconEl, row.detailIcon);
    }
}

/**
 * Open and close a key panel from its button. `beforeShow` fills (and may
 * place) the panel each time it opens; a hidden button never opens it.
 */
export function wireLegendTrigger(component: Component, trigger: HTMLElement, panel: HTMLElement, beforeShow: () => void): void {
    const doc = trigger.ownerDocument;
    let hideTimer: number | null = null;
    const show = () => {
        if (hideTimer !== null) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
        }
        if (trigger.hidden) return;
        beforeShow();
        panel.addClass('is-visible');
        trigger.setAttribute('aria-expanded', 'true');
    };
    const hide = () => {
        panel.removeClass('is-visible');
        trigger.setAttribute('aria-expanded', 'false');
    };
    const scheduleHide = () => {
        if (hideTimer !== null) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            hideTimer = null;
            if (panel.matches(':hover') || trigger.matches(':hover') || panel.contains(doc.activeElement)) return;
            hide();
        }, 120);
    };

    component.register(() => {
        if (hideTimer !== null) window.clearTimeout(hideTimer);
    });
    component.registerDomEvent(trigger, 'mouseenter', show);
    component.registerDomEvent(trigger, 'focus', show);
    component.registerDomEvent(trigger, 'mouseleave', scheduleHide);
    component.registerDomEvent(trigger, 'blur', scheduleHide);
    component.registerDomEvent(trigger, 'click', (evt: MouseEvent) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (panel.hasClass('is-visible')) hide();
        else show();
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
