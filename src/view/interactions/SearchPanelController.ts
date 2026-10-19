import { setAccessibleLabel, setTooltip } from '../../utils/domTooltip';
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
    /** Probe metadata with a short timeout; never run a completion. */
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
    private readonly assistIndicator: HTMLElement;
    private readonly indexCheckbox: HTMLInputElement;
    private readonly indexHint: HTMLElement;
    private readonly indexIndicator: HTMLElement;
    private localStatus?: LocalModelStatus;
    private statusTimer?: number;
    private readonly statusText: HTMLElement;
    private readonly cancelButton: HTMLButtonElement;
    private cancelRequested = false;
    private cancelRunId?: number;
    private expanded = false;
    /** Generation token: a slow probe must not overwrite a newer answer. */
    private statusProbeId = 0;
    private hintCount = 0;

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
        setAccessibleLabel(this.panel, t('timeline.search.panelLabel'));
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
        this.assistIndicator = this.buildAvailabilityIndicator(assistRow.label);
        const indexRow = this.buildCheckRow(assistWrap,
            t('timeline.search.indexLabel'), t('timeline.search.indexHint'), false);
        this.indexCheckbox = indexRow.checkbox;
        this.indexHint = indexRow.hint;
        this.indexIndicator = this.buildAvailabilityIndicator(indexRow.label);
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
    ): { checkbox: HTMLInputElement; hint: HTMLElement; label: HTMLElement } {
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
        hintEl.id = `${this.panel.id}-hint-${++this.hintCount}`;
        checkbox.setAttribute('aria-describedby', hintEl.id);

        row.appendChild(checkbox);
        row.appendChild(text);
        row.appendChild(hintEl);
        parent.appendChild(row);
        return { checkbox, hint: hintEl, label: text };
    }

    private buildAvailabilityIndicator(label: HTMLElement): HTMLElement {
        const indicator = label.ownerDocument.win.createSpan();
        indicator.className = 'ert-timeline-search-panel__unavailable';
        indicator.textContent = '×';
        indicator.setAttribute('aria-hidden', 'true');
        indicator.hidden = true;
        label.appendChild(indicator);
        return indicator;
    }

    private bindEvents(doc: Document): void {
        for (const row of this.scopeRows) {
            this.host.registerDomEvent(row.checkbox, 'change', () => this.commitOptions());
        }
        this.host.registerDomEvent(this.assistCheckbox, 'change', () => this.commitOptions());
        this.host.registerDomEvent(this.indexCheckbox, 'change', () => this.commitOptions());

        this.host.registerDomEvent(this.cancelButton, 'click', () => {
            // The label changes rather than the button vanishing: a request that
            // cannot take effect until the current pass returns should say so,
            // not look ignored.
            this.cancelRequested = true;
            this.cancelRunId = this.host.getSearchState().runId;
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

        this.host.register(() => {
            this.collapse();
            this.statusProbeId += 1;
            this.panel.remove();
        });
    }

    private commitOptions(): void {
        const current = this.host.getSearchState().options;
        const next: TimelineSearchOptions = { ...current };
        for (const row of this.scopeRows) {
            if (!row.checkbox.disabled) next[row.key] = row.checkbox.checked;
        }
        if (!this.assistCheckbox.disabled) next.llmAssist = this.assistCheckbox.checked;
        if (!this.indexCheckbox.disabled) next.semanticIndex = this.indexCheckbox.checked;
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
        this.statusTimer = this.panel.ownerDocument.win.setInterval(() => { void this.refreshLocalModelStatus(); }, 5000);
    }

    /** Keep availability separate from saved search intent: probes never change modes or start searches. */
    private async refreshLocalModelStatus(): Promise<void> {
        const probeId = ++this.statusProbeId;
        let status: LocalModelStatus;
        try { status = await this.host.getLocalModelStatus(); }
        catch (error) { status = { available: false, reason: error instanceof Error ? error.message : String(error) }; }
        if (probeId !== this.statusProbeId) return;
        this.localStatus = status;
        this.syncAvailability();
    }

    private syncAvailability(): void {
        const options = this.host.getSearchState().options;
        const update = (checkbox: HTMLInputElement, hint: HTMLElement, indicator: HTMLElement,
            status: LocalModelStatus | undefined, selected: boolean, text: string, dependent = false) => {
            const unavailable = status?.available === false;
            // An unavailable selected option remains switchable OFF. Never silently fall back to another mode.
            checkbox.disabled = (!status?.available || dependent) && !selected;
            const message = unavailable && selected ? `${text} ${t('timeline.search.unavailableSelected')}` : text;
            hint.textContent = message;
            indicator.hidden = !unavailable;
            const row = checkbox.parentElement;
            if (row) {
                row.classList.toggle('is-disabled', checkbox.disabled || unavailable || dependent);
                setTooltip(row, message);
            }
        };
        const localText = !this.localStatus ? t('timeline.search.assistChecking') : this.localStatus.available
            ? t('timeline.search.assistConnected', { model: this.localStatus.modelId ?? '' })
            : this.localStatus.reason ?? t('ui.searchService.noLocalModel');
        const indexText = this.localStatus?.available === false ? localText
            : options.llmAssist ? t('timeline.search.indexHint') : t('timeline.search.indexRequiresAssist');
        update(this.assistCheckbox, this.assistHint, this.assistIndicator, this.localStatus, options.llmAssist, localText);
        update(this.indexCheckbox, this.indexHint, this.indexIndicator, this.localStatus, options.semanticIndex === true,
            indexText, !options.llmAssist);
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
        this.panel.ownerDocument.win.clearInterval(this.statusTimer);
        this.statusTimer = undefined;
        this.statusProbeId += 1;
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
        this.indexCheckbox.checked = state.options.semanticIndex === true;
        this.syncAvailability();
        setTooltip(this.statusText, state.unreadableNotes ? state.unreadableNotes.map(note => `${note.path}: ${note.reason}`).join('\n') : '');

        for (const row of this.scopeRows) {
            row.checkbox.checked = state.options[row.key];
        }
        this.assistCheckbox.checked = state.options.llmAssist;

        const running = state.status === 'running';
        // Only a concept run has passes to cancel; the literal sweep is over
        // before a button could be pressed.
        this.cancelButton.hidden = !(running && state.options.llmAssist);
        if (!running || this.cancelRunId !== state.runId) {
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
            if (state.indexProgress) return t('timeline.search.statusIndexing', {
                done: String(state.indexProgress.done), total: String(state.indexProgress.total)
            });
            if (state.progress) {
                const position = {
                    chunk: String(state.progress.chunk),
                    total: String(state.progress.chunkCount)
                };
                // Showing the running count is what turns a long sweep from a
                // blank wait into something the author can act on partway.
                const found = state.runningHitCount ?? 0; // SAFE: no published hit in this run yet
                return found > 0
                    ? t('timeline.search.statusChunkFound', { ...position, found: String(found) })
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
        if (state.retrieval) caveats.push(t('timeline.search.statusIndexed', {
            selected: String(state.retrieval.candidates), total: String(state.retrieval.total)
        }));
        if (state.droppedClaims && state.droppedClaims > 0) {
            caveats.push(t('timeline.search.statusDropped', { count: String(state.droppedClaims) }));
        }
        if (state.unreadableScenes && state.unreadableScenes > 0) {
            caveats.push(t('timeline.search.statusUnreadable', { count: String(state.unreadableScenes) }));
        }
        return caveats.length > 0 ? `${matched} · ${caveats.join(' · ')}` : matched;
    }
}

