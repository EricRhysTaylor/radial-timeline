import { setTooltip } from '../../utils/domTooltip';
import {
    App,
    ButtonComponent,
    Modal,
    ToggleComponent
} from 'obsidian';
import type { AIRunAdvancedContext } from '../../ai/types';
import { formatExactUsdCost } from '../../ai/cost/estimateCorpusCost';
import {
    estimateOmnibusRunCost,
    type OmnibusCacheHealth,
    type OmnibusCacheProbe,
    type OmnibusCostAccumulator
} from '../runner/omnibusCacheHealth';
import { formatOmnibusResultAge, shouldSuggestOmnibusSkip } from '../runner/omnibusRecentResults';
import { redactSensitiveValue } from '../../ai/credentials/redactSensitive';
import { SIGMA_CHAR } from '../constants/inquiryUi';
import type {
    InquiryOmnibusModalOptions,
    InquiryOmnibusPlan,
    InquiryPurgePreviewItem
} from '../types/inquiryViewTypes';
import type { InquiryScope, InquiryZone } from '../state';
import { t, tCount } from '../../i18n';

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
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.inquiryViewModals.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.inquiryViewModals.purgeTitle') });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.inquiryViewModals.purgeSubtitle')
        });

        const panel = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack' });

        const affectedCount = this.affectedScenes.length;
        if (affectedCount === 0) {
            panel.createDiv({
                cls: 'ert-inquiry-purge-message',
                text: t('ui.inquiryViewModals.purgeNoneFound', { scenes: tCount('scene', this.totalScenes), scope: this.scopeLabel })
            });
        } else {
            panel.createDiv({
                cls: 'ert-inquiry-purge-message',
                text: t('ui.inquiryViewModals.purgeFound', { affected: affectedCount, scenes: tCount('scene', this.totalScenes), scope: this.scopeLabel })
            });

            const listContainer = panel.createDiv({ cls: 'ert-inquiry-purge-list-container' });
            const listEl = listContainer.createEl('ul', { cls: 'ert-inquiry-purge-list' });
            this.affectedScenes.forEach(item => {
                const li = listEl.createEl('li', { cls: 'ert-inquiry-purge-list-item' });
                li.createSpan({ cls: 'ert-inquiry-purge-list-label', text: item.label });
                li.createSpan({
                    cls: 'ert-inquiry-purge-list-count',
                    text: tCount('item', item.lineCount)
                });
            });

            panel.createDiv({
                cls: 'ert-inquiry-purge-details',
                text: t('ui.inquiryViewModals.purgeNotesPreserved')
            });
            panel.createDiv({
                cls: 'ert-inquiry-purge-warning',
                text: t('ui.inquiryViewModals.purgeCannotUndo')
            });
        }

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        if (affectedCount > 0) {
            new ButtonComponent(buttonRow)
                .setButtonText(t('ui.inquiryViewModals.purgeButton', { scenes: tCount('scene', affectedCount) }))
                .setDestructive()
                .onClick(async () => {
                    this.close();
                    await this.onConfirm();
                });
        }
        new ButtonComponent(buttonRow)
            .setButtonText(affectedCount > 0 ? t('common.cancel') : t('ui.inquiryViewModals.close'))
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
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.inquiryViewModals.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.inquiryViewModals.cancelRunTitle') });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.inquiryViewModals.cancelRunSubtitle')
        });

        if (this.estimateLabel.trim()) {
            contentEl.createDiv({
                cls: 'ert-inquiry-cancel-modal-estimate',
                text: t('ui.inquiryViewModals.cancelRunEta', { estimate: this.estimateLabel })
            });
        }
        contentEl.createDiv({
            cls: 'ert-inquiry-cancel-modal-copy',
            text: t('ui.inquiryViewModals.cancelRunCopy')
        });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText(t('ui.inquiryViewModals.keepRunning'))
            .onClick(() => {
                this.resolveOnce(false);
                this.close();
            });
        new ButtonComponent(actions)
            .setButtonText(t('ui.inquiryViewModals.cancelRunButton'))
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
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.inquiryViewModals.omnibusTitle') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.inquiryViewModals.omnibusSubtitle') });

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
        howSection.createDiv({ cls: 'ert-omnibus-how-title', text: t('ui.inquiryViewModals.howTitle') });
        const howList = howSection.createEl('ul', { cls: 'ert-omnibus-how-list' });
        howList.createEl('li', { text: t('ui.inquiryViewModals.howLoadCorpus') });
        howList.createEl('li', { text: t('ui.inquiryViewModals.howSequential') });
        howList.createEl('li', { text: t('ui.inquiryViewModals.howSaveIncrementally') });
        howList.createEl('li', { text: t('ui.inquiryViewModals.howSafeToStop') });

        const prior = this.options.priorProgress;
        if (prior) {
            const resumeNote = this.configPanel.createDiv({ cls: 'ert-omnibus-resume-note' });
            resumeNote.setText(t('ui.inquiryViewModals.lastRunStopped', { completed: prior.completedQuestionIds.length, total: prior.totalQuestions }));
            if (this.options.resumeUnavailableReason) {
                const configNote = resumeNote.createDiv({ cls: 'ert-field-note' });
                configNote.setText(t('ui.inquiryViewModals.resumeUnavailable', { reason: this.options.resumeUnavailableReason }));
            }
        }

        if (this.options.recentResults && Object.keys(this.options.recentResults).length > 0) {
            this.suggestionNoteEl = this.configPanel.createDiv({ cls: 'ert-omnibus-suggestion-note' });
        }

        const panel = this.configPanel.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack' });

        const summaryGrid = panel.createDiv({ cls: 'ert-apr-status-grid ert-omnibus-summary-grid' });
        const summaryHeaderRow = summaryGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--header' });
        [t('ui.inquiryViewModals.headerScope'), t('ui.inquiryViewModals.headerQuestions'), t('ui.inquiryViewModals.headerProvider')].forEach(label => {
            summaryHeaderRow.createDiv({
                text: label,
                cls: 'ert-apr-status-cell ert-apr-status-cell--header'
            });
        });
        const indexHeader = summaryHeaderRow.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--header' });
        const indexHeaderInline = indexHeader.createDiv({ cls: 'ert-inline' });
        indexHeaderInline.createSpan({ text: t('ui.inquiryViewModals.headerIndex') });
        const indexHelp = indexHeaderInline.createSpan({ cls: 'ert-help-dot', text: '?' });
        setTooltip(
            indexHelp,
            t('ui.inquiryViewModals.indexHelpTooltip')
        );

        const summaryRow = summaryGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--data' });
        const scopeCell = summaryRow.createDiv({ cls: 'ert-apr-status-cell' });
        const scopePillRow = scopeCell.createDiv({ cls: 'ert-inline' });
        const bookPill = scopePillRow.createEl('button', {
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-pill ert-omnibus-table-pill',
            text: t('ui.inquiryViewModals.scopeBook', { book: this.options.bookLabel }),
            type: 'button'
        });
        const sagaPill = scopePillRow.createEl('button', {
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-pill ert-omnibus-table-pill',
            text: t('ui.inquiryViewModals.scopeSaga', { sigma: SIGMA_CHAR }),
            type: 'button'
        });

        const totalCell = summaryRow.createDiv({ cls: 'ert-apr-status-cell' });
        this.questionsCountPillEl = totalCell.createSpan({
            cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill ert-omnibus-flashable',
            text: tCount('question', this.options.questions.length)
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
        indexRow.createSpan({ text: t('ui.inquiryViewModals.indexNote') });
        this.scopePillButtons.push(bookPill, sagaPill);

        panel.createDiv({ cls: 'ert-divider' });

        const questionGrid = panel.createDiv({ cls: 'ert-apr-status-grid ert-omnibus-question-grid' });
        const questionHeaderRow = questionGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--header' });
        [
            t('ui.inquiryViewModals.headerZone'),
            t('ui.inquiryViewModals.headerQuestion'),
            t('ui.inquiryViewModals.headerLens'),
            t('ui.inquiryViewModals.headerScope'),
            t('ui.inquiryViewModals.headerStatus')
        ].forEach(label => {
            questionHeaderRow.createDiv({
                text: label,
                cls: 'ert-apr-status-cell ert-apr-status-cell--header'
            });
        });

        const scopePills: HTMLSpanElement[] = [];
        const getScopeLabel = (scope: InquiryScope): string =>
            scope === 'saga'
                ? t('ui.inquiryViewModals.scopeSaga', { sigma: SIGMA_CHAR })
                : t('ui.inquiryViewModals.scopeBook', { book: this.options.bookLabel });
        const badgeBookName = this.options.bookTitle?.trim() || this.options.bookLabel;
        const getBadgeLabel = (scope: InquiryScope): string =>
            scope === 'saga'
                ? t('ui.inquiryViewModals.badgeSaga', { sigma: SIGMA_CHAR })
                : t('ui.inquiryViewModals.badgeBook', { book: badgeBookName });

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

        const lensLabel = t('ui.inquiryViewModals.lensFlowDepth');
        const zoneOrder: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        zoneOrder.forEach(zone => {
            const zoneQuestions = this.options.questions.filter(question => question.zone === zone);
            if (!zoneQuestions.length) return;
            const zoneLabel = zone === 'setup'
                ? t('settings.inquiry.zone.setup')
                : zone === 'pressure' ? t('settings.inquiry.zone.pressure') : t('settings.inquiry.zone.payoff');
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
                const plainStatus = statusCell.createSpan({ cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill ert-omnibus-status-pill', text: t('ui.inquiryViewModals.statusBriefLog') });
                this.statusPills.set(question.id, plainStatus);
                const recent = this.options.recentResults?.[question.id];
                if (recent) {
                    const skipBtn = statusCell.createEl('button', {
                        cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-pill ert-omnibus-table-pill ert-omnibus-skip-pill',
                        type: 'button'
                    });
                    setTooltip(
                        skipBtn,
                        t('ui.inquiryViewModals.skipTooltip', { age: formatOmnibusResultAge(recent.completedAt, Date.now()) })
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
            reason.setText(t('ui.inquiryViewModals.runDisabled', { reason: this.runDisabledReason }));
        }

        if (this.options.warmCacheExpiresAt && this.options.warmCacheExpiresAt > Date.now()) {
            const remainingMin = Math.max(1, Math.round((this.options.warmCacheExpiresAt - Date.now()) / 60_000));
            const warmNote = this.configPanel.createDiv({ cls: 'ert-field-note ert-omnibus-warm-note' });
            this.warmNoteEl = warmNote;
            warmNote.setText(t('ui.inquiryViewModals.warmCacheNote', { minutes: remainingMin }));
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
            btn.setText(excluded
                ? t('ui.inquiryViewModals.skipAnswered', { age })
                : t('ui.inquiryViewModals.rerunAnswered', { age }));
            btn.classList.toggle('is-skip', excluded);
            btn.setAttribute('aria-pressed', excluded ? 'true' : 'false');
        });

        if (this.suggestionNoteEl) {
            if (this.suggestionEligible) {
                this.suggestionNoteEl.classList.remove('is-hidden');
                const answeredCount = Object.keys(this.options.recentResults ?? {}).length; // SAFE: no prior results yet means zero questions answered
                const skipCount = this.excludedIds.size;
                const skipCounts = { skipped: skipCount, answered: answeredCount };
                const rerunCounts = { answered: answeredCount };
                const note = skipCount > 0
                    ? (skipCount === 1
                        ? (answeredCount === 1
                            ? t('ui.inquiryViewModals.suggestionSkipOneOfOne', skipCounts)
                            : t('ui.inquiryViewModals.suggestionSkipOneOfMany', skipCounts))
                        : t('ui.inquiryViewModals.suggestionSkipManyOfMany', skipCounts))
                    : (answeredCount === 1
                        ? t('ui.inquiryViewModals.suggestionRerunOne', rerunCounts)
                        : t('ui.inquiryViewModals.suggestionRerunMany', rerunCounts));
                this.suggestionNoteEl.setText(note);
            } else {
                this.suggestionNoteEl.classList.add('is-hidden');
            }
        }

        if (this.questionsCountPillEl) {
            this.questionsCountPillEl.setText(
                effectiveQuestions === totalQuestions
                    ? tCount('question', totalQuestions)
                    : t('ui.inquiryViewModals.questionsOfTotal', { effective: effectiveQuestions, questions: tCount('question', totalQuestions) })
            );
        }

        if (this.volumeLineEl) {
            const logsDisabledNote = this.options.logsEnabled ? '' : ` ${t('ui.inquiryViewModals.logsDisabledNote')}`;
            const skippedNote = effectiveQuestions === totalQuestions
                ? ''
                : ` ${t('ui.inquiryViewModals.skippedAsAnswered', { count: totalQuestions - effectiveQuestions })}`;
            const volumeText = t('ui.inquiryViewModals.volumeGenerate', {
                briefs: tCount('inquiryBrief', effectiveQuestions),
                logs: tCount('inquiryLog', effectiveQuestions)
            });
            this.volumeLineEl.setText(
                effectiveQuestions === 0
                    ? t('ui.inquiryViewModals.volumeNothing')
                    : `${volumeText}${logsDisabledNote}${skippedNote}`
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
            this.costLineEl.setText(t('ui.inquiryViewModals.costUnavailable'));
            return;
        }
        if (effectiveQuestions === 0) {
            this.costLineEl.setText(t('ui.inquiryViewModals.costZero'));
            return;
        }
        // Recompute the band for the effective question count through the same
        // estimator that produced the pre-run band (single computation path).
        const range = estimateOmnibusRunCost({
            provider: costRange.provider,
            modelId: costRange.modelId,
            corpusInputTokens: costRange.corpusInputTokens,
            expectedOutputTokensPerQuestion: costRange.expectedOutputTokensPerQuestion,
            questionCount: effectiveQuestions,
            combined: costRange.combined,
            maxOutputTokensPerCall: costRange.maxOutputTokensPerCall,
            cacheAlreadyWarm: costRange.cacheAlreadyWarm
        });
        const corpusTokens = Math.max(0, Math.round(costRange.corpusInputTokens)).toLocaleString();
        const questionsLabel = tCount('question', effectiveQuestions);
        if (costRange.combined) {
            this.costLineEl.setText(t('ui.inquiryViewModals.costCombined', {
                cost: formatExactUsdCost(range.uncachedUSD),
                questions: questionsLabel,
                tokens: corpusTokens
            }));
            return;
        }
        const reuseLabel = costRange.cacheAlreadyWarm ? t('ui.inquiryViewModals.reuseWarm') : t('ui.inquiryViewModals.reuseHealthy');
        if (typeof range.cachedUSD === 'number') {
            this.costLineEl.setText(t('ui.inquiryViewModals.costCached', {
                cachedCost: formatExactUsdCost(range.cachedUSD),
                reuse: reuseLabel,
                uncachedCost: formatExactUsdCost(range.uncachedUSD),
                questions: questionsLabel,
                tokens: corpusTokens
            }));
        } else {
            this.costLineEl.setText(t('ui.inquiryViewModals.costNoCachePrice', {
                cost: formatExactUsdCost(range.uncachedUSD),
                questions: questionsLabel,
                tokens: corpusTokens
            }));
        }
    }

    private renderConfigActions(): void {
        if (!this.actionsEl) return;
        this.actionsEl.empty();

        const prior = this.options.priorProgress;
        if (prior && this.options.resumeAvailable) {
            const resumeBtn = new ButtonComponent(this.actionsEl)
                .setButtonText(t('ui.inquiryViewModals.resumeOmnibus'))
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
            setTooltip(resumeBtn.buttonEl, t('ui.inquiryViewModals.resumeTooltip'));
        }

        const runButton = new ButtonComponent(this.actionsEl)
            .setButtonText(prior && this.options.resumeAvailable ? t('ui.inquiryViewModals.restartOmnibus') : t('ui.inquiryViewModals.runOmnibus'))
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
            .setButtonText(t('common.cancel'))
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
            this.progressEl.createDiv({ cls: 'ert-omnibus-progress-title', text: t('ui.inquiryViewModals.runningTitle') });

            const statusRow = this.progressEl.createDiv({ cls: 'ert-omnibus-status-row ert-inline' });
            statusRow.createSpan({
                cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-table-pill',
                text: this.options.providerLabel
            });
            this.cachePillEl = statusRow.createSpan({
                cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-cache-pill is-pending'
            });
            this.cachePillEl.createSpan({ cls: 'ert-omnibus-cache-pill-label', text: t('ui.inquiryViewModals.cachePillLabel') });
            this.cachePillDetailEl = this.cachePillEl.createSpan({ cls: 'ert-omnibus-cache-pill-detail', text: t('ui.inquiryViewModals.pending') });
            setTooltip(this.cachePillEl, t('ui.inquiryViewModals.cachePillTooltip'));

            this.costPillEl = statusRow.createSpan({
                cls: 'ert-badgePill ert-badgePill--sm ert-omnibus-cost-pill is-pending'
            });
            this.costPillEl.createSpan({ cls: 'ert-omnibus-cost-pill-label', text: t('ui.inquiryViewModals.costPillLabel') });
            this.costPillDetailEl = this.costPillEl.createSpan({ cls: 'ert-omnibus-cost-pill-detail', text: t('ui.inquiryViewModals.pending') });
            setTooltip(this.costPillEl, t('ui.inquiryViewModals.costPillTooltip'));

            this.progressTextEl = this.progressEl.createDiv({ cls: 'ert-omnibus-progress-text' });
            this.progressTextEl.setText(t('ui.inquiryViewModals.preparing'));
            this.progressMicroEl = this.progressEl.createDiv({ cls: 'ert-omnibus-progress-micro ert-field-note' });
            const advancedDetails = this.progressEl.createEl('details', { cls: 'ert-ai-advanced-details' });
            advancedDetails.createEl('summary', { text: t('ui.inquiryViewModals.aiAdvancedSummary') });
            this.aiAdvancedPreEl = advancedDetails.createEl('pre', { cls: 'ert-ai-advanced-pre' });
            this.renderAiAdvancedContext();
        }
        if (this.actionsEl) {
            this.actionsEl.empty();
            new ButtonComponent(this.actionsEl)
                .setButtonText(t('ui.inquiryViewModals.abortRun'))
                .onClick(() => {
                    this.abortRequested = true;
                    if (this.progressMicroEl) {
                        this.progressMicroEl.setText(t('ui.inquiryViewModals.stoppingAfterCurrent'));
                    }
                });
        }
    }

    updateProgress(current: number, total: number, zone: string, questionLabel: string, micro?: string): void {
        if (this.progressTextEl) {
            this.progressTextEl.setText(t('ui.inquiryViewModals.progressQuestion', { current, total }));
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
     * Update the cache pill for a completed pass. `probe` and `health` come
     * from readOmnibusCacheProbe and evaluateOmnibusCachePass — the same pure
     * decision that drives the sequential kill-switch — so the pill, the
     * running cost and the abort logic can never disagree.
     */
    notePassResult(
        passIndex: number,
        total: number,
        probe: OmnibusCacheProbe,
        health: OmnibusCacheHealth
    ): void {
        if (!this.cachePillEl || !this.cachePillDetailEl) return;

        this.cacheReadCumulative += probe.cacheReadTokens;

        const setState = (state: 'pending' | 'primed' | 'confirmed' | 'miss' | 'none', detail: string): void => {
            if (!this.cachePillEl || !this.cachePillDetailEl) return;
            this.cachePillEl.classList.remove('is-pending', 'is-primed', 'is-confirmed', 'is-miss', 'is-none');
            this.cachePillEl.classList.add(`is-${state}`);
            this.cachePillDetailEl.setText(detail);
        };

        switch (health) {
            case 'reused':
                setState('confirmed', t('ui.inquiryViewModals.cacheConfirmed', { tokens: formatCacheTokens(this.cacheReadCumulative), pass: passIndex, total }));
                return;
            case 'armed':
                setState('primed', t('ui.inquiryViewModals.cachePrimed', { tokens: formatCacheTokens(probe.cacheCreatedTokens), pass: passIndex }));
                return;
            case 'miss':
                setState('miss', t('ui.inquiryViewModals.cacheMiss', { pass: passIndex }));
                return;
            case 'below_minimum':
                setState('none', t('ui.inquiryViewModals.cacheBelowMinimum'));
                return;
            case 'unknown':
                setState('none', t('ui.inquiryViewModals.cacheUnknown'));
                return;
        }
    }

    noteRunningCost(acc: OmnibusCostAccumulator): void {
        if (!this.costPillEl || !this.costPillDetailEl) return;
        if (acc.pricedPasses === 0) {
            this.costPillDetailEl.setText(acc.unpricedPasses > 0 ? t('ui.inquiryViewModals.costUnpriced') : t('ui.inquiryViewModals.pending'));
            return;
        }
        const costText = acc.unpricedPasses > 0
            ? t('ui.inquiryViewModals.costSoFarUnpriced', { cost: formatExactUsdCost(acc.totalCostUSD), count: acc.unpricedPasses })
            : t('ui.inquiryViewModals.costSoFar', { cost: formatExactUsdCost(acc.totalCostUSD) });
        this.costPillEl.classList.remove('is-pending');
        this.costPillDetailEl.setText(costText);
    }

    private renderAiAdvancedContext(): void {
        if (!this.aiAdvancedPreEl) return;
        if (!this.aiAdvancedContext) {
            this.aiAdvancedPreEl.setText(t('ui.inquiryViewModals.aiAdvancedWaiting'));
            return;
        }
        const ctx = this.aiAdvancedContext;
        const lines = [
            t('ui.inquiryViewModals.aiAdvancedRoleTemplate', { name: ctx.roleTemplateName }),
            t('ui.inquiryViewModals.aiAdvancedResolvedModel', { provider: ctx.provider, alias: ctx.modelAlias, label: ctx.modelLabel }),
            t('ui.inquiryViewModals.aiAdvancedModelSelectionReason', { reason: redactSensitiveValue(ctx.modelSelectionReason) }),
            t('ui.inquiryViewModals.aiAdvancedAvailability', {
                status: ctx.availabilityStatus === 'visible'
                    ? t('ui.inquiryViewModals.aiAdvancedAvailabilityVisible')
                    : ctx.availabilityStatus === 'not_visible'
                        ? t('ui.inquiryViewModals.aiAdvancedAvailabilityNotVisible')
                        : t('ui.inquiryViewModals.aiAdvancedAvailabilityUnknown')
            }),
            t('ui.inquiryViewModals.aiAdvancedAppliedCaps', { input: ctx.maxInputTokens, output: ctx.maxOutputTokens }),
            t('ui.inquiryViewModals.aiAdvancedPackaging'),
            '',
            t('ui.inquiryViewModals.aiAdvancedFinalPrompt'),
            redactSensitiveValue(ctx.finalPrompt || t('ui.inquiryViewModals.aiAdvancedNone'))
        ];
        if (typeof ctx.executionPassCount === 'number' && ctx.executionPassCount > 1) {
            lines.splice(6, 0, t('ui.inquiryViewModals.aiAdvancedPassCount', { count: ctx.executionPassCount }));
        }
        if (ctx.multiPassTriggerReason) {
            lines.splice(7, 0, t('ui.inquiryViewModals.aiAdvancedMultiPassTrigger', { reason: redactSensitiveValue(ctx.multiPassTriggerReason) }));
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
                pill.setText(t('ui.inquiryViewModals.statusDone'));
                pill.classList.add('is-done');
            } else if (priorCompleted.has(questionId)) {
                pill.setText(t('ui.inquiryViewModals.statusDoneEarlier'));
                pill.classList.add('is-done');
            } else if (this.suggestionEligible && this.excludedIds.has(questionId)) {
                pill.setText(t('ui.inquiryViewModals.statusSkipped'));
                pill.classList.add('is-skipped');
            } else {
                pill.setText(t('ui.inquiryViewModals.statusNotRun'));
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
            if (cacheMissDetail) {
                const errorBlock = this.resultEl.createDiv({ cls: 'ert-omnibus-result-error' });
                errorBlock.createDiv({
                    cls: 'ert-omnibus-result-error-title',
                    text: t('ui.inquiryViewModals.resultTerminatedTitle')
                });
                errorBlock.createDiv({ cls: 'ert-omnibus-result-error-detail', text: cacheMissDetail });
                errorBlock.createDiv({
                    cls: 'ert-omnibus-result-text',
                    text: t('ui.inquiryViewModals.resultTerminatedDetail', { completed, total })
                });
            } else if (aborted) {
                this.resultEl.createDiv({
                    cls: 'ert-omnibus-result-text',
                    text: t('ui.inquiryViewModals.resultStopped', { completed, total })
                });
            } else {
                this.resultEl.createDiv({
                    cls: 'ert-omnibus-result-text',
                    text: t('ui.inquiryViewModals.resultComplete', { briefs: tCount('inquiryBrief', completed), logs: tCount('inquiryLog', completed) })
                });
            }
        }
        if (this.actionsEl) {
            this.actionsEl.empty();
            new ButtonComponent(this.actionsEl)
                .setButtonText(t('ui.inquiryViewModals.close'))
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
