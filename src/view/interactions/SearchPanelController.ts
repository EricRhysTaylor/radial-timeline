/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The search options panel — the surface that makes search legible.
 *
 * Before this, the search box was a blind text field: the author could not see
 * what was being searched, and an empty result was indistinguishable from a
 * broken search. The panel names the scopes and reports what happened.
 *
 * Scopes not yet implemented render **disabled**, never inert-but-enabled. A
 * checkbox that accepts a click and changes nothing is a lie about the
 * product's capability, and the author has no way to tell it from a bug.
 */

import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { TimelineSearchOptions, TimelineSearchState } from '../../services/searchState';
import { hasSearchScope } from '../../services/searchState';

export interface SearchPanelHost {
    /** Live search state; the panel reads it, never mutates it. */
    getSearchState(): TimelineSearchState;
    /** Persist and apply an options change. */
    setSearchOptions(options: TimelineSearchOptions): void;
    registerDomEvent(el: HTMLElement | Document, event: string, handler: (ev: Event) => void): void;
    register(cleanup: () => void): void;
}

interface ScopeRow {
    key: 'timelineFields' | 'body';
    checkbox: HTMLInputElement;
}

/** Distinguishes panels when several timeline views are open, for aria-controls. */
let panelInstanceCounter = 0;

export class SearchPanelController {
    private readonly host: SearchPanelHost;
    private readonly shell: HTMLElement;
    private readonly input: HTMLInputElement;
    private readonly panel: HTMLElement;
    private readonly statusEl: HTMLElement;
    private readonly scopeRows: ScopeRow[] = [];
    private readonly assistCheckbox: HTMLInputElement;
    private expanded = false;

    constructor(host: SearchPanelHost, shell: HTMLElement, input: HTMLInputElement) {
        this.host = host;
        this.shell = shell;
        this.input = input;

        const doc = shell.ownerDocument;
        const panelId = `rt-search-panel-${++panelInstanceCounter}`;

        this.panel = doc.createElement('div');
        this.panel.className = 'ert-timeline-search-panel';
        this.panel.id = panelId;
        this.panel.setAttribute('role', 'group');
        this.panel.setAttribute('aria-label', t('timeline.search.panelLabel'));
        this.panel.hidden = true;

        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', panelId);

        // --- Scope group -----------------------------------------------------
        const fieldset = doc.createElement('fieldset');
        fieldset.className = 'ert-timeline-search-panel__scope';
        const legend = doc.createElement('legend');
        legend.className = 'ert-timeline-search-panel__legend';
        legend.textContent = t('timeline.search.scopeLegend');
        fieldset.appendChild(legend);

        this.scopeRows.push({
            key: 'timelineFields',
            checkbox: this.buildCheckRow(
                fieldset,
                t('timeline.search.scopeTimelineFields.label'),
                t('timeline.search.scopeTimelineFields.hint'),
                false
            )
        });
        this.scopeRows.push({
            key: 'body',
            checkbox: this.buildCheckRow(
                fieldset,
                t('timeline.search.scopeBody.label'),
                t('timeline.search.scopeBody.hint'),
                true
            )
        });
        this.panel.appendChild(fieldset);

        // --- Assist ----------------------------------------------------------
        const assistWrap = doc.createElement('div');
        assistWrap.className = 'ert-timeline-search-panel__assist';
        this.assistCheckbox = this.buildCheckRow(
            assistWrap,
            t('timeline.search.assistLabel'),
            t('timeline.search.assistUnavailable'),
            true
        );
        this.panel.appendChild(assistWrap);

        // --- Status ----------------------------------------------------------
        this.statusEl = doc.createElement('div');
        this.statusEl.className = 'ert-timeline-search-panel__status';
        this.statusEl.setAttribute('role', 'status');
        this.statusEl.setAttribute('aria-live', 'polite');
        this.panel.appendChild(this.statusEl);

        shell.appendChild(this.panel);

        this.bindEvents(doc);
        this.syncFromState();
    }

    /**
     * One labelled checkbox row, with its explanatory hint wired to the control
     * via aria-describedby — a disabled control must always say why.
     */
    private buildCheckRow(
        parent: HTMLElement,
        label: string,
        hint: string,
        disabled: boolean
    ): HTMLInputElement {
        const doc = parent.ownerDocument;
        const row = doc.createElement('label');
        row.className = 'ert-timeline-search-panel__row';
        if (disabled) row.classList.add('is-disabled');

        const checkbox = doc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ert-timeline-search-panel__checkbox';
        checkbox.disabled = disabled;

        const text = doc.createElement('span');
        text.className = 'ert-timeline-search-panel__row-label';
        text.textContent = label;

        const hintEl = doc.createElement('span');
        hintEl.className = 'ert-timeline-search-panel__row-hint';
        hintEl.textContent = hint;
        hintEl.id = `${this.panel.id}-hint-${parent.childElementCount}`;
        checkbox.setAttribute('aria-describedby', hintEl.id);

        row.appendChild(checkbox);
        row.appendChild(text);
        row.appendChild(hintEl);
        parent.appendChild(row);
        return checkbox;
    }

    private bindEvents(doc: Document): void {
        for (const row of this.scopeRows) {
            this.host.registerDomEvent(row.checkbox, 'change', () => this.commitOptions());
        }
        this.host.registerDomEvent(this.assistCheckbox, 'change', () => this.commitOptions());

        // Expanding must never steal focus from the input — the author is
        // typing, and the panel is a companion, not a modal.
        this.host.registerDomEvent(this.input, 'focus', () => this.expand());

        this.host.registerDomEvent(this.input, 'keydown', (ev: Event) => {
            const evt = ev as KeyboardEvent;
            if (evt.key !== 'Escape') return;
            // First Escape collapses and keeps the results; only a second one
            // (on an already-collapsed panel) is handled by the view as a clear.
            if (this.expanded) {
                evt.preventDefault();
                evt.stopPropagation();
                this.collapse();
                this.input.focus();
            }
        });

        this.host.registerDomEvent(this.panel, 'keydown', (ev: Event) => {
            const evt = ev as KeyboardEvent;
            if (evt.key !== 'Escape') return;
            evt.preventDefault();
            this.collapse();
            // Focus must land somewhere predictable, not on <body>.
            this.input.focus();
        });

        const onDocumentPointerDown = (ev: Event) => {
            const target = ev.target as Node | null;
            if (target && this.shell.contains(target)) return;
            this.collapse();
        };
        this.host.registerDomEvent(doc, 'pointerdown', onDocumentPointerDown);

        this.host.register(() => this.panel.remove());
    }

    private commitOptions(): void {
        const current = this.host.getSearchState().options;
        const next: TimelineSearchOptions = { ...current };
        for (const row of this.scopeRows) {
            if (!row.checkbox.disabled) next[row.key] = row.checkbox.checked;
        }
        if (!this.assistCheckbox.disabled) next.llmAssist = this.assistCheckbox.checked;
        this.host.setSearchOptions(next);
    }

    expand(): void {
        if (this.expanded) return;
        this.expanded = true;
        this.panel.hidden = false;
        this.shell.classList.add('is-expanded');
        this.input.setAttribute('aria-expanded', 'true');
        this.syncFromState();
        this.applyEdgeAnchor();
    }

    /**
     * Flip to right-edge anchoring when a left-anchored panel would overflow.
     *
     * The timeline lives in a pane that can be dragged narrow; the header must
     * never scroll sideways to reveal the panel.
     */
    private applyEdgeAnchor(): void {
        this.panel.classList.remove('is-right-anchored');
        const viewportWidth = this.panel.ownerDocument.documentElement.clientWidth;
        const rect = this.panel.getBoundingClientRect();
        if (rect.right > viewportWidth - 8) {
            this.panel.classList.add('is-right-anchored');
        }
    }

    collapse(): void {
        if (!this.expanded) return;
        this.expanded = false;
        this.panel.hidden = true;
        this.shell.classList.remove('is-expanded');
        this.input.setAttribute('aria-expanded', 'false');
    }

    isExpanded(): boolean {
        return this.expanded;
    }

    /** Mirror the live search state into the controls and the status line. */
    syncFromState(): void {
        const state = this.host.getSearchState();

        for (const row of this.scopeRows) {
            row.checkbox.checked = state.options[row.key];
        }
        this.assistCheckbox.checked = state.options.llmAssist;

        this.statusEl.textContent = this.describeStatus(state);
    }

    private describeStatus(state: TimelineSearchState): string {
        if (!hasSearchScope(state.options)) return t('timeline.search.statusNoScope');
        if (state.status === 'running') return t('timeline.search.statusRunning');
        if (state.status === 'error') {
            return t('timeline.search.statusError', { message: state.error ?? '' });
        }
        if (!state.active) return t('timeline.search.statusIdle');
        if (state.hits.size === 0) return t('timeline.search.statusNoMatches');
        return t('timeline.search.statusMatches', { count: String(state.hits.size) });
    }
}

/** Icon helper kept here so the shell's button styling stays in one place. */
export function setSearchButtonIcon(button: HTMLElement, mode: 'search' | 'clear'): void {
    button.empty();
    setIcon(button, mode === 'clear' ? 'search-x' : 'search');
}
