import {
    App,
    ButtonComponent,
    Modal,
    ToggleComponent,
    setTooltip
} from 'obsidian';
import type { AIRunAdvancedContext } from '../../ai/types';
import type { TokenUsage } from '../../ai/usage/providerUsage';
import { formatExactUsdCost } from '../../ai/cost/estimateCorpusCost';
import { type OmnibusCacheHealth, type OmnibusCostAccumulator } from '../runner/omnibusCacheHealth';
import { estimateOmnibusCostRange } from '../../ai/cost/estimateCorpusCost';
import { ANTHROPIC_REQUESTED_CACHE_TTL } from '../../ai/settings/aiSettings';
import { formatOmnibusResultAge, shouldSuggestOmnibusSkip } from '../runner/omnibusRecentResults';
import { redactSensitiveValue } from '../../ai/credentials/redactSensitive';
import { SIGMA_CHAR } from '../constants/inquiryUi';
import type {
    InquiryOmnibusModalOptions,
    InquiryOmnibusPlan,
    InquiryPurgePreviewItem
} from '../types/inquiryViewTypes';
import type { InquiryScope, InquiryZone } from '../state';

function formatCacheTokens(tokens: number): string {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
}

export class InquiryPurgeConfirmationModal extends Modal {
    constructor(
        app: App,
        private totalScenes: number,
        private affectedScenes: InquiryPurgePreviewItem[],
        private scopeLabel: string,
        private onConfirm: () => Promise<void>
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-inquiry-modal-shell--compact');
        }

        contentEl.addClass('ert-modal-container', 'ert-stack');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Inquiry' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Purge Action Items' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Removes Inquiry-generated action items from scene frontmatter.'
        });

        const panel = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack' });

        const affectedCount = this.affectedScenes.length;
        if (affectedCount === 0) {
            panel.createDiv({
                cls: 'ert-inquiry-purge-message',
                text: `No Inquiry action items found in ${this.totalScenes} scene${this.totalScenes !== 1 ? 's' : ''} in ${this.scopeLabel}.`
            });
        } else {
            panel.createDiv({
                cls: 'ert-inquiry-purge-message',
                text: `Found Inquiry action items in ${affectedCount} of ${this.totalScenes} scene${this.totalScenes !== 1 ? 's' : ''} in ${this.scopeLabel}:`
            });

            const listContainer = panel.createDiv({ cls: 'ert-inquiry-purge-list-container' });
            const listEl = listContainer.createEl('ul', { cls: 'ert-inquiry-purge-list' });
            this.affectedScenes.forEach(item => {
                const li = listEl.createEl('li', { cls: 'ert-inquiry-purge-list-item' });
                li.createSpan({ cls: 'ert-inquiry-purge-list-label', text: item.label });
                li.createSpan({
                    cls: 'ert-inquiry-purge-list-count',
                    text: `${item.lineCount} item${item.lineCount !== 1 ? 's' : ''}`
                });
            });

            panel.createDiv({
                cls: 'ert-inquiry-purge-details',
                text: 'User-written notes in Pending Edits are preserved.'
            });
            panel.createDiv({
                cls: 'ert-inquiry-purge-warning',
                text: 'This cannot be undone.'
            });
        }

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        if (affectedCount > 0) {
            new ButtonComponent(buttonRow)
                .setButtonText(`Purge ${affectedCount} scene${affectedCount !== 1 ? 's' : ''}`)
                .setDestructive()
                .onClick(async () => {
                    this.close();
                    await this.onConfirm();
                });
        }
        new ButtonComponent(buttonRow)
            .setButtonText(affectedCount > 0 ? 'Cancel' : 'Close')
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class InquiryCancelRunModal extends Modal {
    private didResolve = false;

    constructor(
        app: App,
        private estimateLabel: string,
        private onResolve: (confirmed: boolean) => void,
        private onClosed?: () => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-inquiry-modal-shell--compact');
        }

        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-inquiry-cancel-modal');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Inquiry' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Cancel Inquiry Run?' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Canceling discards this run after the current pass returns.'
        });

        if (this.estimateLabel.trim()) {
            contentEl.createDiv({
                cls: 'ert-inquiry-cancel-modal-estimate',
                text: `ETA: ${this.estimateLabel}.`
            });
        }
        contentEl.createDiv({
            cls: 'ert-inquiry-cancel-modal-copy',
            text: 'You can work in another note if this Inquiry tab stays open. Cancel means start over. No resume.'
        });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText('Keep running')
            .onClick(() => {
                this.resolveOnce(false);
                this.close();
            });
        new ButtonComponent(actions)
            .setButtonText('Cancel run')
            .setDestructive()
            .onClick(() => {
                this.resolveOnce(true);
                this.close();
            });
    }

    onClose(): void {
        this.contentEl.empty();
        this.onClosed?.();
        this.resolveOnce(false);
    }

    private resolveOnce(confirmed: boolean): void {
        if (this.didResolve) return;
        this.didResolve = true;
        this.onResolve(confirmed);
    }
}

export class InquiryOmnibusModal extends Modal {
    private didResolve = false;
    private selectedScope: InquiryScope;
    private createIndex = true;
    private runDisabledReason?: string | null;
    private badgeEl?: HTMLSpanElement;
    private isRunning = false;
    private abortRequested = false;
    private progressEl?: HTMLDivElement;
    private progressTextEl?: HTMLDivElement;
    private progressMicroEl?: HTMLDivElement;
    private configPanel?: HTMLDivElement;
    private actionsEl?: HTMLDivElement;
    private resultEl?: HTMLDivElement;
    private aiAdvancedPreEl?: HTMLPreElement;
    private aiAdvancedContext: AIRunAdvancedContext | null = null;
    private cachePillEl?: HTMLSpanElement;
    private cachePillDetailEl?: HTMLSpanElement;
    private costPillEl?: HTMLSpanElement;
    private costPillDetailEl?: HTMLSpanElement;
    private cacheReadCumulative = 0;
    private cacheCreatedCumulative = 0;
    private cacheMissCount = 0;
    /** Question ids the author has set to skip (seeded from recent-result suggestions). */
    private excludedIds = new Set<string>();
    /**
     * Recent-result suggestions were computed for `initialScope` only; the
     * moment the author flips scope in this modal they no longer apply.
     */
    private suggestionEligible = true;
    private questionsCountPillEl?: HTMLSpanElement;
    private volumeLineEl?: HTMLDivElement;
    private costLineEl?: HTMLDivElement;
    private suggestionNoteEl?: HTMLDivElement;
    private warmNoteEl?: HTMLDivElement;
    private howSectionEl?: HTMLDivElement;
    private skipControls = new Map<string, { btn: HTMLButtonElement; plain: HTMLSpanElement }>();
    /** Plain status pill for EVERY question row, for post-run outcome labels. */
    private statusPills = new Map<string, HTMLSpanElement>();
    private scopePillButtons: HTMLButtonElement[] = [];
    private indexToggle?: ToggleComponent;
    private runButton?: ButtonComponent;
    /** Questions persisted by the run in progress (drives the post-run list). */
    private completedRunIds = new Set<string>();
    /** True once the run ended and the list shows outcomes instead of a plan. */
    private reviewMode = false;
    /** True when the author launched this run via Resume (prior completions count as done). */
    private resumedFromPrior = false;

    constructor(
        app: App,
        private options: InquiryOmnibusModalOptions,
        private onResolve: (result: InquiryOmnibusPlan | null) => void
    ) {
        super(app);
        this.selectedScope = options.initialScope;
        this.runDisabledReason = options.runDisabledReason;
        this.seedSuggestedSkips();
    }

    /** Default every recently-answered question to Skip (author can re-include per row). */
    private seedSuggestedSkips(): void {
        const recent = this.options.recentResults;
        if (!recent) return;
        const now = Date.now();
        this.excludedIds.clear();
        for (const [questionId, info] of Object.entries(recent)) {
            if (shouldSuggestOmnibusSkip(info.completedAt, now)) {
                this.excludedIds.add(questionId);
            }
        }
    }

    private getEffectiveQuestionCount(): number {
        return this.options.questions.length - this.excludedIds.size;
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-inquiry-modal-shell--wide');
        }

        contentEl.addClass('ert-modal-container', 'ert-stack');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        this.badgeEl = header.createSpan({ cls: 'ert-modal-badge' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Run Omnibus Pass' });
        header.createDiv({ cls: 'ert-modal-subtitle', text: 'Runs all enabled Inquiry questions for the selected scope.' });

        this.configPanel = contentEl.createDiv({ cls: 'ert-omnibus-config-panel ert-stack' });
        this.renderConfigPanel();

        this.progressEl = contentEl.createDiv({ cls: 'ert-omnibus-progress-panel ert-stack is-hidden' });

        this.resultEl = contentEl.createDiv({ cls: 'ert-omnibus-result-panel is-hidden' });

        this.actionsEl = contentEl.createDiv({ cls: 'ert-modal-actions' });
        this.renderConfigActions();
    }

    private renderConfigPanel(): void {
        if (!this.configPanel) return;
        this.configPanel.empty();
        this.skipControls.clear();
        this.statusPills.clear();
        this.scopePillButtons = [];

        const howSection = this.configPanel.createDiv({ cls: 'ert-omnibus-how-section' });
        this.howSectionEl = howSection;
        howSection.createDiv({ cls: 'ert-omnibus-how-title', text: 'How this run works' });
        const howList = howSection.createEl('ul', { cls: 'ert-omnibus-how-list' });
        howList.createEl('li', { text: 'Load corpus once for the selected scope' });
        howList.createEl('li', { text: 'Run questions sequentially against that shared context' });
        howList.createEl('li', { text: 'Save results incrementally (Brief + Log per question)' });
        howList.createEl('li', { text: 'Safe to stop: abort at any time; completed results remain saved' });

        const prior = this.options.priorProgress;
        if (prior) {
            const resumeNote = this.configPanel.createDiv({ cls: 'ert-omnibus-resume-note' });
            resumeNote.setText(`Last run stopped after question ${prior.completedQuestionIds.length} of ${prior.totalQuestions}.`);
            if (this.options.resumeUnavailableReason) {
                const configNote = resumeNote.createDiv({ cls: 'ert-field-note' });
                configNote.setText(`Resume unavailable: ${this.options.resumeUnavailableReason}`);
            }
        }

        if (this.options.recentResults && Object.keys(this.options.recentResults).length > 0) {
            this.suggestionNoteEl = this.configPanel.createDiv({ cls: 'ert-omnibus-suggestion-note' });
        }

        const panel = this.configPanel.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack' });

        const summaryGrid = panel.createDiv({ cls: 'ert-apr-status-grid ert-omnibus-summary-grid' });
        const summaryHeaderRow = summaryGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--header' });
        ['Scope', 'Questions', 'Provider'].forEach(label => {
            summaryHeaderRow.createDiv({
                text: label,
                cls: 'ert-apr-status-cell ert-apr-status-cell--header'
            });
        });
        const indexHeader = summaryHeaderRow.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--header' });
        const indexHeaderInline = indexHeader.createDiv({ cls: 'ert-inline' });
        indexHeaderInline.createSpan({ text: 'Index' });
        const indexHelp = indexHeaderInline.createSpan({ cls: 'ert-help-dot', text: '?' });
        setTooltip(
            indexHelp,
            'Creates an omnibus index note so the full pass can be reopened and reviewed from one place.'
        );

        const summaryRow = summaryGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--data' });
        const scopeCell = summaryRow.createDiv({ cls: 'ert-apr-status-cell' });
        const scopePillRow = scopeCell.createDiv({ cls: 'ert-inline' });
        const bookPill = scopePillRow.createEl('button', {
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-pill ert-omnibus-table-pill',
            text: `Book (${this.options.bookLabel})`,
            type: 'button'
        });
        const sagaPill = scopePillRow.createEl('button', {
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-pill ert-omnibus-table-pill',
            text: `Saga (${SIGMA_CHAR})`,
            type: 'button'
        });

        const totalCell = summaryRow.createDiv({ cls: 'ert-apr-status-cell' });
        this.questionsCountPillEl = totalCell.createSpan({
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill ert-omnibus-flashable',
            text: `${this.options.questions.length} questions`
        });

        const providerCell = summaryRow.createDiv({ cls: 'ert-apr-status-cell' });
        const providerPill = providerCell.createSpan({
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill',
            text: this.options.providerLabel
        });
        setTooltip(providerPill, this.options.providerSummary);

        const indexCell = summaryRow.createDiv({ cls: 'ert-apr-status-cell' });
        const indexRow = indexCell.createDiv({ cls: 'ert-inline' });
        const indexToggle = new ToggleComponent(indexRow);
        this.indexToggle = indexToggle;
        indexToggle.setValue(this.createIndex);
        indexToggle.onChange(value => {
            this.createIndex = value;
        });
        indexRow.createSpan({ text: 'Index note' });
        this.scopePillButtons.push(bookPill, sagaPill);

        panel.createDiv({ cls: 'ert-divider' });

        const questionGrid = panel.createDiv({ cls: 'ert-apr-status-grid ert-omnibus-question-grid' });
        const questionHeaderRow = questionGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--header' });
        ['Zone', 'Question', 'Lens', 'Scope', 'Status'].forEach(label => {
            questionHeaderRow.createDiv({
                text: label,
                cls: 'ert-apr-status-cell ert-apr-status-cell--header'
            });
        });

        const scopePills: HTMLSpanElement[] = [];
        const getScopeLabel = (scope: InquiryScope): string =>
            scope === 'saga' ? `Saga (${SIGMA_CHAR})` : `Book (${this.options.bookLabel})`;
        const badgeBookName = this.options.bookTitle?.trim() || this.options.bookLabel;
        const getBadgeLabel = (scope: InquiryScope): string =>
            scope === 'saga' ? `Beta · Inquiry · Saga (${SIGMA_CHAR})` : `Beta · Inquiry · ${badgeBookName}`;

        const updateScopeSelection = (scope: InquiryScope): void => {
            this.selectedScope = scope;
            this.badgeEl?.setText(getBadgeLabel(scope));
            const scopeLabel = getScopeLabel(scope);
            scopePills.forEach(pill => pill.setText(scopeLabel));
            bookPill.classList.toggle('is-active', scope === 'book');
            sagaPill.classList.toggle('is-active', scope === 'saga');
            bookPill.setAttribute('aria-pressed', scope === 'book' ? 'true' : 'false');
            sagaPill.setAttribute('aria-pressed', scope === 'saga' ? 'true' : 'false');
            const wasEligible = this.suggestionEligible;
            this.suggestionEligible = scope === this.options.initialScope;
            if (this.suggestionEligible && !wasEligible) {
                // Returning to the scope the suggestions were computed for —
                // restore the suggested-skip defaults.
                this.seedSuggestedSkips();
            } else if (!this.suggestionEligible) {
                this.excludedIds.clear();
            }
            this.refreshSuggestionUI();
        };

        bookPill.addEventListener('click', () => updateScopeSelection('book'));
        sagaPill.addEventListener('click', () => updateScopeSelection('saga'));
        updateScopeSelection(this.selectedScope);

        const lensLabel = 'Flow + Depth';
        const zoneOrder: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        zoneOrder.forEach(zone => {
            const zoneQuestions = this.options.questions.filter(question => question.zone === zone);
            if (!zoneQuestions.length) return;
            const zoneLabel = zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff';
            const groupRow = questionGrid.createDiv({ cls: 'ert-apr-status-row' });
            groupRow.createDiv({ cls: 'ert-apr-status-cell ert-omnibus-group', text: zoneLabel });

            zoneQuestions.forEach((question, zoneIndex) => {
                const dataRow = questionGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--data' });

                const zoneCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
                zoneCell.createSpan({
                    cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill',
                    text: `${zoneLabel} ${zoneIndex + 1}`
                });

                const questionCell = dataRow.createDiv({ cls: 'ert-apr-status-cell ert-omnibus-question-cell' });
                const questionText = questionCell.createSpan({ cls: 'ert-omnibus-question', text: question.standardPrompt });
                setTooltip(questionText, question.standardPrompt);

                const lensCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
                lensCell.createSpan({ cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill', text: lensLabel });

                const scopeCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
                const scopePill = scopeCell.createSpan({
                    cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill',
                    text: getScopeLabel(this.selectedScope)
                });
                scopePills.push(scopePill);

                const statusCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
                const plainStatus = statusCell.createSpan({ cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill ert-omnibus-status-pill', text: 'Brief + Log' });
                this.statusPills.set(question.id, plainStatus);
                const recent = this.options.recentResults?.[question.id];
                if (recent) {
                    const skipBtn = statusCell.createEl('button', {
                        cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-pill ert-omnibus-table-pill ert-omnibus-skip-pill',
                        type: 'button'
                    });
                    setTooltip(
                        skipBtn,
                        `This engine already answered this question on the current corpus ${formatOmnibusResultAge(recent.completedAt, Date.now())}. Click to toggle between skipping it and rerunning it.`
                    );
                    skipBtn.addEventListener('click', () => {
                        if (!this.suggestionEligible || this.reviewMode) return;
                        if (this.excludedIds.has(question.id)) {
                            this.excludedIds.delete(question.id);
                        } else {
                            this.excludedIds.add(question.id);
                        }
                        this.refreshSuggestionUI({ flash: true });
                    });
                    this.skipControls.set(question.id, { btn: skipBtn, plain: plainStatus });
                }
            });
        });

        if (this.runDisabledReason) {
            const reason = this.configPanel.createDiv({ cls: 'ert-field-note' });
            reason.setText(`Run disabled: ${this.runDisabledReason}`);
        }

        if (this.options.warmCacheExpiresAt && this.options.warmCacheExpiresAt > Date.now()) {
            const remainingMin = Math.max(1, Math.round((this.options.warmCacheExpiresAt - Date.now()) / 60_000));
            const warmNote = this.configPanel.createDiv({ cls: 'ert-field-note ert-omnibus-warm-note' });
            this.warmNoteEl = warmNote;
            warmNote.setText(
                `Provider cache is still warm from a recent run (~${remainingMin}m left) — this pass piggybacks on it: `
                + `question 1 reads the cached corpus instead of re-priming it at write price.`
            );
        }

        this.volumeLineEl = this.configPanel.createDiv({ cls: 'ert-field-note ert-omnibus-flashable' });
        this.costLineEl = this.configPanel.createDiv({ cls: 'ert-field-note ert-omnibus-cost-estimate ert-omnibus-flashable' });
        this.refreshSuggestionUI();
    }

    /**
     * Re-derive every piece of the config panel that depends on the skip
     * selection: per-row pills, the suggestion note, the question count, the
     * volume line, the cost band, and the Run button's enabled state.
     */
    private refreshSuggestionUI(options?: { flash?: boolean }): void {
        if (this.reviewMode) return;
        const totalQuestions = this.options.questions.length;
        const effectiveQuestions = this.getEffectiveQuestionCount();
        const now = Date.now();

        this.skipControls.forEach(({ btn, plain }, questionId) => {
            const recent = this.options.recentResults?.[questionId];
            if (!recent || !this.suggestionEligible) {
                btn.classList.add('is-hidden');
                plain.classList.remove('is-hidden');
                return;
            }
            btn.classList.remove('is-hidden');
            plain.classList.add('is-hidden');
            const excluded = this.excludedIds.has(questionId);
            const age = formatOmnibusResultAge(recent.completedAt, now);
            btn.setText(excluded ? `Skip · answered ${age}` : `Rerun · answered ${age}`);
            btn.classList.toggle('is-skip', excluded);
            btn.setAttribute('aria-pressed', excluded ? 'true' : 'false');
        });

        if (this.suggestionNoteEl) {
            if (this.suggestionEligible) {
                this.suggestionNoteEl.classList.remove('is-hidden');
                const answeredCount = Object.keys(this.options.recentResults ?? {}).length; // SAFE: no prior results yet means zero questions answered
                const skipCount = this.excludedIds.size;
                const lead = skipCount > 0
                    ? `${skipCount} of ${answeredCount} already-answered question${answeredCount === 1 ? '' : 's'} ${skipCount === 1 ? 'is' : 'are'} set to skip`
                    : `${answeredCount} question${answeredCount === 1 ? ' was' : 's were'} already answered by this engine, but every row is set to rerun`;
                this.suggestionNoteEl.setText(
                    `${lead} — this engine already produced a brief for ${answeredCount === 1 ? 'it' : 'them'} on the current corpus. `
                    + `Click a status pill to toggle a row between Skip and Rerun.`
                );
            } else {
                this.suggestionNoteEl.classList.add('is-hidden');
            }
        }

        if (this.questionsCountPillEl) {
            this.questionsCountPillEl.setText(
                effectiveQuestions === totalQuestions
                    ? `${totalQuestions} questions`
                    : `${effectiveQuestions} of ${totalQuestions} questions`
            );
        }

        if (this.volumeLineEl) {
            const briefLabel = effectiveQuestions === 1 ? 'Brief' : 'Briefs';
            const logLabel = effectiveQuestions === 1 ? 'Log' : 'Logs';
            const logsDisabledNote = this.options.logsEnabled ? '' : ' Logs are disabled in settings.';
            const skippedNote = effectiveQuestions === totalQuestions
                ? ''
                : ` (${totalQuestions - effectiveQuestions} skipped as already answered.)`;
            this.volumeLineEl.setText(
                effectiveQuestions === 0
                    ? 'Every question is set to skip — nothing to run.'
                    : `This will generate ${effectiveQuestions} Inquiry ${briefLabel} and ${effectiveQuestions} ${logLabel}.${logsDisabledNote}${skippedNote}`
            );
        }

        this.renderCostLine(effectiveQuestions);
        this.runButton?.setDisabled(!!this.runDisabledReason || effectiveQuestions === 0);

        if (options?.flash) {
            // A skip toggle changes text far from the clicked pill — pulse the
            // count pill and the volume/cost lines so the reaction is visible.
            [this.questionsCountPillEl, this.volumeLineEl, this.costLineEl].forEach(el => {
                if (!el) return;
                el.classList.remove('is-updated');
                void el.offsetWidth; // restart the animation
                el.classList.add('is-updated');
            });
        }
    }

    private renderCostLine(effectiveQuestions: number): void {
        if (!this.costLineEl) return;
        const costRange = this.options.costRange;
        if (!costRange) {
            this.costLineEl.setText('Estimated cost: unavailable (no corpus token estimate or model pricing yet).');
            return;
        }
        if (effectiveQuestions === 0) {
            this.costLineEl.setText('Estimated cost: $0 — every question is set to skip.');
            return;
        }
        // Recompute the band for the effective question count through the same
        // estimator that produced the pre-run band (single computation path).
        const range = estimateOmnibusCostRange({
            provider: costRange.provider,
            modelId: costRange.modelId,
            corpusInputTokens: costRange.corpusInputTokens,
            expectedOutputTokensPerQuestion: costRange.expectedOutputTokensPerQuestion,
            questionCount: effectiveQuestions,
            cacheAlreadyWarm: costRange.cacheAlreadyWarm,
            cacheWriteTtl: ANTHROPIC_REQUESTED_CACHE_TTL
        });
        const corpusTokens = Math.max(0, Math.round(costRange.corpusInputTokens)).toLocaleString();
        const reuseLabel = costRange.cacheAlreadyWarm ? 'warm — piggybacking on your recent run' : 'healthy';
        if (typeof range.cachedUSD === 'number') {
            this.costLineEl.setText(
                `Estimated cost: ~${formatExactUsdCost(range.cachedUSD)} with cache reuse (${reuseLabel}) vs ~${formatExactUsdCost(range.uncachedUSD)} uncached, `
                + `over ${effectiveQuestions} question${effectiveQuestions === 1 ? '' : 's'} against ~${corpusTokens} corpus input tokens. `
                + `The run aborts automatically if the cache is not reused after question 1.`
            );
        } else {
            this.costLineEl.setText(
                `Estimated cost: ~${formatExactUsdCost(range.uncachedUSD)} (this model has no cache-read price to model reuse), `
                + `over ${effectiveQuestions} question${effectiveQuestions === 1 ? '' : 's'} against ~${corpusTokens} corpus input tokens.`
            );
        }
    }

    private renderConfigActions(): void {
        if (!this.actionsEl) return;
        this.actionsEl.empty();

        const prior = this.options.priorProgress;
        if (prior && this.options.resumeAvailable) {
            const resumeBtn = new ButtonComponent(this.actionsEl)
                .setButtonText('Resume Omnibus')
                .setCta();
            if (this.runDisabledReason) {
                resumeBtn.setDisabled(true);
            }
            resumeBtn.onClick(() => {
                if (this.runDisabledReason) return;
                this.resumedFromPrior = true;
                this.resolveOnce({
                    scope: this.selectedScope,
                    createIndex: this.createIndex,
                    resume: true,
                    excludedQuestionIds: [...this.excludedIds]
                });
                this.switchToRunning();
            });
            setTooltip(resumeBtn.buttonEl, 'Resends corpus and runs remaining questions.');
        }

        const runButton = new ButtonComponent(this.actionsEl)
            .setButtonText(prior && this.options.resumeAvailable ? 'Restart Omnibus' : 'Run Omnibus')
            .setCta();
        this.runButton = runButton;
        if (this.runDisabledReason || this.getEffectiveQuestionCount() === 0) {
            runButton.setDisabled(true);
        }
        runButton.onClick(() => {
            if (this.runDisabledReason || this.getEffectiveQuestionCount() === 0) return;
            this.resolveOnce({
                scope: this.selectedScope,
                createIndex: this.createIndex,
                excludedQuestionIds: [...this.excludedIds]
            });
            this.switchToRunning();
        });

        new ButtonComponent(this.actionsEl)
            .setButtonText('Cancel')
            .onClick(() => {
                this.resolveOnce(null);
                this.close();
            });
    }

    switchToRunning(): void {
        this.isRunning = true;
        this.setHidden(this.configPanel, true);
        if (this.progressEl) {
            this.setHidden(this.progressEl, false);
            this.progressEl.empty();
            this.progressEl.createDiv({ cls: 'ert-omnibus-progress-title', text: 'Running Omnibus Pass...' });

            const statusRow = this.progressEl.createDiv({ cls: 'ert-omnibus-status-row ert-inline' });
            statusRow.createSpan({
                cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill',
                text: this.options.providerLabel
            });
            this.cachePillEl = statusRow.createSpan({
                cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-cache-pill is-pending'
            });
            this.cachePillEl.createSpan({ cls: 'ert-omnibus-cache-pill-label', text: 'Cache' });
            this.cachePillDetailEl = this.cachePillEl.createSpan({ cls: 'ert-omnibus-cache-pill-detail', text: 'pending' });
            setTooltip(this.cachePillEl, 'Cache reuse is confirmed only when the provider reports cache_read tokens. Pass 1 primes the cache; pass 2+ should report a read.');

            this.costPillEl = statusRow.createSpan({
                cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-cost-pill is-pending'
            });
            this.costPillEl.createSpan({ cls: 'ert-omnibus-cost-pill-label', text: 'Cost' });
            this.costPillDetailEl = this.costPillEl.createSpan({ cls: 'ert-omnibus-cost-pill-detail', text: 'pending' });
            setTooltip(this.costPillEl, 'Running total billed so far, computed from each response’s actual token usage (input, output, cache-write, cache-read).');

            this.progressTextEl = this.progressEl.createDiv({ cls: 'ert-omnibus-progress-text' });
            this.progressTextEl.setText('Preparing...');
            this.progressMicroEl = this.progressEl.createDiv({ cls: 'ert-omnibus-progress-micro ert-field-note' });
            const advancedDetails = this.progressEl.createEl('details', { cls: 'ert-ai-advanced-details' });
            advancedDetails.createEl('summary', { text: 'AI prompt & context' });
            this.aiAdvancedPreEl = advancedDetails.createEl('pre', { cls: 'ert-ai-advanced-pre' });
            this.renderAiAdvancedContext();
        }
        if (this.actionsEl) {
            this.actionsEl.empty();
            new ButtonComponent(this.actionsEl)
                .setButtonText('Abort run')
                .onClick(() => {
                    this.abortRequested = true;
                    if (this.progressMicroEl) {
                        this.progressMicroEl.setText('Stopping after current question...');
                    }
                });
        }
    }

    updateProgress(current: number, total: number, zone: string, questionLabel: string, micro?: string): void {
        if (this.progressTextEl) {
            this.progressTextEl.setText(`Question ${current} of ${total}`);
        }
        if (this.progressMicroEl && !this.abortRequested) {
            this.progressMicroEl.setText(micro ?? `${zone} · ${questionLabel}`);
        }
    }

    setAiAdvancedContext(context: AIRunAdvancedContext | null): void {
        this.aiAdvancedContext = context;
        this.renderAiAdvancedContext();
    }

    /**
     * Update the cache pill for a completed pass. When `health` is provided
     * (sequential Omnibus) it is authoritative — it comes from the same pure
     * decision that drives the kill-switch, so the pill and the abort logic
     * can never disagree. Without `health` (the single-call combined path) the
     * pill falls back to deriving state from the usage payload alone.
     */
    notePassResult(
        passIndex: number,
        total: number,
        usage: TokenUsage | null | undefined,
        health?: OmnibusCacheHealth
    ): void {
        if (!this.cachePillEl || !this.cachePillDetailEl) return;

        const cacheRead = usage?.cacheReadInputTokens ?? 0;
        const cacheCreated = (usage?.cacheCreationInputTokens ?? 0)
            + (usage?.cacheCreation5mInputTokens ?? 0)
            + (usage?.cacheCreation1hInputTokens ?? 0);
        const hasAnyCacheField = !!usage && (
            typeof usage.cacheReadInputTokens === 'number'
            || typeof usage.cacheCreationInputTokens === 'number'
            || typeof usage.cacheCreation5mInputTokens === 'number'
            || typeof usage.cacheCreation1hInputTokens === 'number'
        );

        this.cacheReadCumulative += cacheRead;
        this.cacheCreatedCumulative += cacheCreated;

        const setState = (state: 'pending' | 'primed' | 'confirmed' | 'miss' | 'none', detail: string): void => {
            if (!this.cachePillEl || !this.cachePillDetailEl) return;
            this.cachePillEl.classList.remove('is-pending', 'is-primed', 'is-confirmed', 'is-miss', 'is-none');
            this.cachePillEl.classList.add(`is-${state}`);
            this.cachePillDetailEl.setText(detail);
        };

        if (health) {
            switch (health) {
                case 'reused':
                    setState('confirmed', `confirmed · read ${formatCacheTokens(this.cacheReadCumulative)} tok (pass ${passIndex}/${total})`);
                    return;
                case 'armed':
                    setState('primed', `primed · wrote ${formatCacheTokens(cacheCreated)} tok (pass ${passIndex})`);
                    return;
                case 'miss':
                    this.cacheMissCount += 1;
                    setState('miss', `miss on pass ${passIndex} · terminating run`);
                    return;
                case 'below_minimum':
                    setState('none', 'corpus below minimum cacheable size');
                    return;
                case 'unknown':
                    setState('none', 'cache status unknown (no provider signal)');
                    return;
            }
        }

        if (!usage) {
            setState('pending', `pass ${passIndex}/${total} · usage unknown`);
            return;
        }
        if (!hasAnyCacheField) {
            setState('none', 'not used by provider');
            return;
        }
        if (cacheRead > 0) {
            setState('confirmed', `confirmed · read ${formatCacheTokens(this.cacheReadCumulative)} tok (pass ${passIndex}/${total})`);
            return;
        }
        if (passIndex <= 1 && cacheCreated > 0) {
            setState('primed', `primed · wrote ${formatCacheTokens(cacheCreated)} tok (pass 1)`);
            return;
        }
        if (passIndex >= 2) {
            this.cacheMissCount += 1;
            setState('miss', `miss on pass ${passIndex} · ${this.cacheMissCount} miss${this.cacheMissCount === 1 ? '' : 'es'} so far`);
            return;
        }
        setState('pending', `pass ${passIndex}/${total} · no cache activity`);
    }

    noteRunningCost(acc: OmnibusCostAccumulator): void {
        if (!this.costPillEl || !this.costPillDetailEl) return;
        if (acc.pricedPasses === 0) {
            this.costPillDetailEl.setText(acc.unpricedPasses > 0 ? 'unpriced' : 'pending');
            return;
        }
        const unpricedNote = acc.unpricedPasses > 0
            ? ` (+${acc.unpricedPasses} unpriced)`
            : '';
        this.costPillEl.classList.remove('is-pending');
        this.costPillDetailEl.setText(`${formatExactUsdCost(acc.totalCostUSD)} so far${unpricedNote}`);
    }

    private renderAiAdvancedContext(): void {
        if (!this.aiAdvancedPreEl) return;
        if (!this.aiAdvancedContext) {
            this.aiAdvancedPreEl.setText('Waiting for first AI request...');
            return;
        }
        const ctx = this.aiAdvancedContext;
        const lines = [
            `Role template: ${ctx.roleTemplateName}`,
            `Resolved model: ${ctx.provider} -> ${ctx.modelAlias} (${ctx.modelLabel})`,
            `Model selection reason: ${redactSensitiveValue(ctx.modelSelectionReason)}`,
            `Availability: ${ctx.availabilityStatus === 'visible' ? 'Visible to your key ✅' : ctx.availabilityStatus === 'not_visible' ? 'Not visible ⚠️' : 'Unknown (snapshot unavailable)'}`,
            `Applied caps: input=${ctx.maxInputTokens}, output=${ctx.maxOutputTokens}`,
            `Packaging: Automatic`,
            '',
            'Final composed prompt:',
            redactSensitiveValue(ctx.finalPrompt || '(none)')
        ];
        if (typeof ctx.executionPassCount === 'number' && ctx.executionPassCount > 1) {
            lines.splice(6, 0, `Pass count: ${ctx.executionPassCount}`);
        }
        if (ctx.multiPassTriggerReason) {
            lines.splice(7, 0, `Multi-pass trigger: ${redactSensitiveValue(ctx.multiPassTriggerReason)}`);
        }
        this.aiAdvancedPreEl.setText(lines.join('\n'));
    }

    /** Record a question persisted by the running pass (drives the post-run list). */
    noteQuestionCompleted(questionId: string): void {
        this.completedRunIds.add(questionId);
    }

    /**
     * Swap the plan list into an outcome list: Done ✓ for questions this run
     * persisted, Done · earlier for prior-run completions on a resume,
     * Skipped for rows the author excluded, Not run for the rest. All plan
     * controls (scope, index toggle, skip pills) freeze; the stale
     * will-generate/cost lines hide.
     */
    private applyReviewState(): void {
        this.reviewMode = true;
        this.setHidden(this.howSectionEl, true);
        this.setHidden(this.suggestionNoteEl, true);
        this.setHidden(this.warmNoteEl, true);
        this.setHidden(this.volumeLineEl, true);
        this.setHidden(this.costLineEl, true);
        this.scopePillButtons.forEach(btn => { btn.disabled = true; });
        this.indexToggle?.setDisabled(true);

        const priorCompleted = new Set(
            this.resumedFromPrior ? this.options.priorProgress?.completedQuestionIds ?? [] : [] // SAFE: resuming a run that recorded no completions starts from an empty set
        );
        this.statusPills.forEach((pill, questionId) => {
            this.skipControls.get(questionId)?.btn.classList.add('is-hidden');
            pill.classList.remove('is-hidden');
            if (this.completedRunIds.has(questionId)) {
                pill.setText('Done ✓');
                pill.classList.add('is-done');
            } else if (priorCompleted.has(questionId)) {
                pill.setText('Done · earlier');
                pill.classList.add('is-done');
            } else if (this.suggestionEligible && this.excludedIds.has(questionId)) {
                pill.setText('Skipped');
                pill.classList.add('is-skipped');
            } else {
                pill.setText('Not run');
                pill.classList.add('is-skipped');
            }
        });
    }

    showResult(completed: number, total: number, aborted: boolean, cacheMissDetail?: string): void {
        this.isRunning = false;
        this.setHidden(this.progressEl, true);
        // Bring the question list back so the author sees exactly which
        // questions completed before an abort/termination and which remain.
        this.setHidden(this.configPanel, false);
        this.applyReviewState();
        if (this.resultEl) {
            this.setHidden(this.resultEl, false);
            this.resultEl.empty();
            const briefLabel = completed === 1 ? 'Brief' : 'Briefs';
            const logLabel = completed === 1 ? 'Log' : 'Logs';
            if (cacheMissDetail) {
                const errorBlock = this.resultEl.createDiv({ cls: 'ert-omnibus-result-error' });
                errorBlock.createDiv({
                    cls: 'ert-omnibus-result-error-title',
                    text: 'Run terminated to prevent uncached (full-price) billing'
                });
                errorBlock.createDiv({ cls: 'ert-omnibus-result-error-detail', text: cacheMissDetail });
                errorBlock.createDiv({
                    cls: 'ert-omnibus-result-text',
                    text: `${completed} of ${total} completed and saved before termination.`
                });
            } else if (aborted) {
                this.resultEl.createDiv({
                    cls: 'ert-omnibus-result-text',
                    text: `Omnibus pass stopped. ${completed} of ${total} completed.`
                });
            } else {
                this.resultEl.createDiv({
                    cls: 'ert-omnibus-result-text',
                    text: `Omnibus pass complete. ${completed} Inquiry ${briefLabel} and ${completed} ${logLabel} created.`
                });
            }
        }
        if (this.actionsEl) {
            this.actionsEl.empty();
            new ButtonComponent(this.actionsEl)
                .setButtonText('Close')
                .setCta()
                .onClick(() => this.close());
        }
    }

    isAbortRequested(): boolean {
        return this.abortRequested;
    }

    onClose(): void {
        this.resolveOnce(null);
    }

    private resolveOnce(result: InquiryOmnibusPlan | null): void {
        if (this.didResolve) return;
        this.didResolve = true;
        this.onResolve(result);
    }

    private setHidden(el: HTMLElement | undefined, hidden: boolean): void {
        if (!el) return;
        el.classList.toggle('is-hidden', hidden);
    }
}
