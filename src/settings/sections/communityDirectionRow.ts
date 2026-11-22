/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Settings → Community: the two direction rows, Vault → Community and
 * Community → Vault. Each is a collapsible card in the plugin's own pattern
 * (the Writing stats card in Sessions): a summary row that says the state in
 * one line, and under it, when open, the direction's controls.
 *
 * A row opens by itself only when it needs the author. Once the author opens
 * or closes it, that choice holds while this Settings view stays open; a new
 * view starts from the rule again. Nothing is saved.
 */

import { setIcon } from 'obsidian';

export type CommunityDirection = 'send' | 'import';

export interface CommunityDirectionOptions {
    /** The Community tab's own element: new each time Settings opens. */
    view: HTMLElement;
    direction: CommunityDirection;
    name: string;
    /** The state in one line, shown while the row is closed. */
    summary: string;
    /** Nothing to do in this direction now: the row is dimmed. */
    muted: boolean;
    /** Open the row when the author has not opened or closed it in this view. */
    needsAuthor: boolean;
}

const chosen = new WeakMap<HTMLElement, Partial<Record<CommunityDirection, boolean>>>();

/** Draws the row and returns the element its controls go in. */
export function renderCommunityDirection(parentEl: HTMLElement, options: CommunityDirectionOptions): HTMLElement {
    const details = parentEl.createEl('details', { cls: `ert-community-direction ert-community-direction--${options.direction}` });
    details.toggleClass('is-muted', options.muted);
    details.open = chosen.get(options.view)?.[options.direction] ?? options.needsAuthor;

    const summary = details.createEl('summary', { cls: 'ert-community-direction__summary' });
    const chevron = summary.createSpan({ cls: 'ert-community-direction__chevron', attr: { 'aria-hidden': 'true' } });
    setIcon(chevron, details.open ? 'chevron-down' : 'chevron-right');
    const copy = summary.createSpan({ cls: 'ert-community-direction__copy' });
    copy.createSpan({ cls: 'ert-community-direction__name', text: options.name });
    copy.createSpan({ cls: 'ert-community-direction__line', text: options.summary });
    const arrow = summary.createSpan({ cls: 'ert-community-direction__arrow', attr: { 'aria-hidden': 'true' } });
    setIcon(arrow, options.direction === 'send' ? 'arrow-right' : 'arrow-left');

    // A click on the summary flips the row; remember the author's choice for this view.
    summary.addEventListener('click', () => {
        const willOpen = !details.open;
        chosen.set(options.view, { ...chosen.get(options.view), [options.direction]: willOpen });
        setIcon(chevron, willOpen ? 'chevron-down' : 'chevron-right');
    });

    return details.createDiv({ cls: 'ert-stack ert-community-direction__body' });
}
