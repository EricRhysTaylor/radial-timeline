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

/** What the panel needs to know about the local model, and nothing more. */
export interface LocalModelStatus {
    available: boolean;
    reason?: string;
    modelId?: string;
}

export interface SearchPanelHost {
    /** Live search state; the panel reads it, never mutates it. */
    getSearchState(): TimelineSearchState;
    /** Persist and apply an options change. */
    setSearchOptions(options: TimelineSearchOptions): void;
    /** Probe the configured local model. Cheap and cached; safe to call per expand. */
    getLocalModelStatus(): Promise<LocalModelStatus>;
    /** Stop an in-flight concept run at the next chunk boundary. */
    cancelSearch(): void;
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
    private readonly assistHint: HTMLElement;
    private readonly statusText: HTMLElement;
    private readonly cancelButton: HTMLButtonElement;
    private cancelRequested = false;
    private expanded = false;
    /** Generation token: a slow probe must not overwrite a newer answer. */
    private statusProbeId = 0;

    constructor(host: SearchPanelHost, shell: HTMLElement, input: HTMLInputElement) {
        this.host = host;
        this.shell = shell;
        this.input = input;

        const doc = shell.ownerDocument;
        const panelId = `rt-search-panel-${++panelInstanceCounter}`;

        this.panel = doc.win.createDiv();
        this.panel.className = 'ert-timeline-search-panel';
        this.panel.id = panelId;
        this.panel.setAttribute('role', 'group');
        this.panel.setAttribute('aria-label', t('timeline.search.panelLabel'));
        this.panel.hidden = true;

        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', panelId);

        // --- Scope group -----------------------------------------------------
        const fieldset = doc.win.createEl('fieldset');
        fieldset.className = 'ert-timeline-search-panel__scope';
        const legend = doc.win.createEl('legend');
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
            ).checkbox
        });
        this.scopeRows.push({
            key: 'body',
            checkbox: this.buildCheckRow(
                fieldset,
                t('timeline.search.scopeBody.label'),
                t('timeline.search.scopeBody.hint'),
                false
            ).checkbox
        });
        this.panel.appendChild(fieldset);

        // --- Assist ----------------------------------------------------------
        const assistWrap = doc.win.createDiv();
        assistWrap.className = 'ert-timeline-search-panel__assist';
        const assistRow = this.buildCheckRow(
            assistWrap,
            t('timeline.search.assistLabel'),
            t('timeline.search.assistChecking'),
            true
        );
        this.assistCheckbox = assistRow.checkbox;
        this.assistHint = assistRow.hint;
        this.panel.appendChild(assistWrap);

        // --- Status ----------------------------------------------------------
        this.statusEl = doc.win.createDiv();
        this.statusEl.className = 'ert-timeline-search-panel__status';
        this.statusEl.setAttribute('role', 'status');
        this.statusEl.setAttribute('aria-live', 'polite');

        this.statusText = doc.win.createSpan();
        this.statusText.className = 'ert-timeline-search-panel__status-text';
        this.statusEl.appendChild(this.statusText);

        this.cancelButton = doc.win.createEl('button');
        this.cancelButton.type = 'button';
        this.cancelButton.className = 'ert-timeline-search-panel__cancel';
        this.cancelButton.textContent = t('timeline.search.cancelAction');
        this.cancelButton.hidden = true;
        this.statusEl.appendChild(this.cancelButton);

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
    ): { checkbox: HTMLInputElement; hint: HTMLElement } {
        const doc = parent.ownerDocument;
        const row = doc.win.createEl('label');
        row.className = 'ert-timeline-search-panel__row';
        if (disabled) row.classList.add('is-disabled');

        const checkbox = doc.win.createEl('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ert-timeline-search-panel__checkbox';
        checkbox.disabled = disabled;

        const text = doc.win.createSpan();
        text.className = 'ert-timeline-search-panel__row-label';
        text.textContent = label;

        const hintEl = doc.win.createSpan();
        hintEl.className = 'ert-timeline-search-panel__row-hint';
        hintEl.textContent = hint;
        hintEl.id = `${this.panel.id}-hint-${parent.childElementCount}`;
        checkbox.setAttribute('aria-describedby', hintEl.id);

        row.appendChild(checkbox);
        row.appendChild(text);
        row.appendChild(hintEl);
        parent.appendChild(row);
        return { checkbox, hint: hintEl };
    }

    private bindEvents(doc: Document): void {
        for (const row of this.scopeRows) {
            this.host.registerDomEvent(row.checkbox, 'change', () => this.commitOptions());
        }
        this.host.registerDomEvent(this.assistCheckbox, 'change', () => this.commitOptions());

        this.host.registerDomEvent(this.cancelButton, 'click', () => {
            // The label changes rather than the button vanishing: a request that
            // cannot take effect until the current pass returns should say so,
            // not look ignored.
            this.cancelRequested = true;
            this.cancelButton.disabled = true;
            this.statusText.textContent = t('timeline.search.cancelPending');
            this.host.cancelSearch();
        });

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
        void this.refreshLocalModelStatus();
    }

    /**
     * Ask whether a local model is usable, enable the control accordingly, and
     * say plainly what was found.
     *
     * When no model is available the checkbox is disabled *and* the option is
     * forced off — an assist flag left set against a server that has gone away
     * would fail at commit for reasons the panel had stopped showing.
     */
    private async refreshLocalModelStatus(): Promise<void> {
        const probeId = ++this.statusProbeId;
        this.assistHint.textContent = t('timeline.search.assistChecking');

        let status: LocalModelStatus;
        try {
            status = await this.host.getLocalModelStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            status = { available: false, reason: message };
        }

        // A newer expand already asked; its answer wins.
        if (probeId !== this.statusProbeId) return;

        this.assistHint.textContent = status.available
            ? t('timeline.search.assistConnected', { model: status.modelId ?? '' })
            : (status.reason ?? t('timeline.search.assistChecking'));

        this.assistCheckbox.disabled = !status.available;
        this.assistCheckbox.parentElement?.classList.toggle('is-disabled', !status.available);

        // A model that has gone away must not leave the option silently on.
        if (!status.available && this.host.getSearchState().options.llmAssist) {
            this.commitOptions();
        }
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

        const running = state.status === 'running';
        // Only a concept run has passes to cancel; the literal sweep is over
        // before a button could be pressed.
        this.cancelButton.hidden = !(running && state.options.llmAssist);
        if (!running) {
            this.cancelRequested = false;
            this.cancelButton.disabled = false;
        }

        if (this.cancelRequested && running) {
            this.statusText.textContent = t('timeline.search.cancelPending');
            return;
        }
        this.statusText.textContent = this.describeStatus(state);
    }

    private describeStatus(state: TimelineSearchState): string {
        if (!hasSearchScope(state.options)) return t('timeline.search.statusNoScope');
        if (state.status === 'running') {
            if (state.progress) {
                const position = {
                    chunk: String(state.progress.chunk),
                    total: String(state.progress.chunkCount)
                };
                // Showing the running count is what turns a long sweep from a
                // blank wait into something the author can act on partway.
                return state.hits.size > 0
                    ? t('timeline.search.statusChunkFound', { ...position, found: String(state.hits.size) })
                    : t('timeline.search.statusChunk', position);
            }
            return t('timeline.search.statusRunning');
        }
        if (state.status === 'error') {
            return t('timeline.search.statusError', { message: state.error ?? '' });
        }
        if (!state.active) return t('timeline.search.statusIdle');
        const matched = state.hits.size === 0
            ? t('timeline.search.statusNoMatches')
            : state.hits.size === 1
                ? t('timeline.search.statusMatchOne')
                : t('timeline.search.statusMatches', { count: String(state.hits.size) });

        // A stopped run covered only part of the manuscript; saying "31 matched"
        // would imply the whole book was read.
        if (state.stoppedEarly) {
            return t('timeline.search.statusStopped', { count: String(state.hits.size) });
        }

        // Silence here would present a thin sweep as a complete one.
        const caveats: string[] = [];
        if (state.droppedClaims && state.droppedClaims > 0) {
            caveats.push(t('timeline.search.statusDropped', { count: String(state.droppedClaims) }));
        }
        if (state.unreadableScenes && state.unreadableScenes > 0) {
            caveats.push(t('timeline.search.statusUnreadable', { count: String(state.unreadableScenes) }));
        }
        return caveats.length > 0 ? `${matched} · ${caveats.join(' · ')}` : matched;
    }
}

/** Icon helper kept here so the shell's button styling stays in one place. */
export function setSearchButtonIcon(button: HTMLElement, mode: 'search' | 'clear'): void {
    button.empty();
    setIcon(button, mode === 'clear' ? 'search-x' : 'search');
}
