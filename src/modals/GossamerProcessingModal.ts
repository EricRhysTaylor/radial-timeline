/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * Gossamer AI Processing Modal
 * Tracks progress of Gemini momentum analysis with manuscript details and status updates
 */
import { App, ButtonComponent, Notice, TFile, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { DEFAULT_GOSSAMER_SIGNAL, GOSSAMER_SIGNAL_METADATA } from '../types/gossamerSignals';
import { getCredential } from '../ai/credentials/credentials';
import { getModelDisplayName } from '../utils/modelResolver';
import { SimulatedProgress } from '../utils/simulatedProgress';
import type { AIRunAdvancedContext } from '../ai/types';
import {
    type GossamerCacheWindow,
    formatGossamerCacheClock,
    formatGossamerCacheCostHint,
    isGossamerCacheWindowOpen
} from '../gossamer/cacheWindow';
import { GOSSAMER_SIGNAL_TYPES } from '../types/gossamerSignals';
import { describeTokenEstimateMethod } from '../ai/tokens/inputTokenEstimate';
import { redactSensitiveValue } from '../ai/credentials/redactSensitive';
import { CANONICAL_PROVIDER_LABELS, getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { getActiveBookTitle } from '../utils/books';
import { formatTokenShorthand, type TokenEstimate } from '../ai/estimates';

export interface ManuscriptInfo {
    totalScenes: number;
    totalWords: number;
    estimatedTokens: TokenEstimate;
    beatCount: number;
    beatSystem: string; // Beat system name (e.g., "Save The Cat", "Custom")
    evidenceMode?: string;
    hasIterativeContext?: boolean; // Always false - previous scores not sent to avoid anchoring bias
}

export interface AnalysisOptions {
    requestScores: boolean;
}

/**
 * Modal for confirming and showing progress of Gossamer AI momentum analysis
 */
export class GossamerProcessingModal extends ErtModal {
    private readonly plugin: RadialTimelinePlugin;
    private readonly onConfirm: (options: AnalysisOptions) => Promise<void>;

    public isProcessing: boolean = false;
    public analysisOptions: AnalysisOptions = {
        requestScores: true
    };

    // UI elements
    private confirmationView?: HTMLElement;
    private processingView?: HTMLElement;
    private subtitleEl?: HTMLElement;
    private manuscriptInfoEl?: HTMLElement;
    private statusTextEl?: HTMLElement;
    private apiStatusEl?: HTMLElement;
    private progressBarEl?: HTMLElement;
    private errorListEl?: HTMLElement;
    private closeButtonEl?: ButtonComponent;
    private aiAdvancedPreEl?: HTMLElement;
    private aiAdvancedContext: AIRunAdvancedContext | null = null;
    private errorMessageEl?: HTMLElement;
    private errorMessages: string[] = [];

    // Processing state
    private manuscriptInfo?: ManuscriptInfo;
    private currentStatus: string = t('gossamer.processingModal.statusInitializing');
    private apiCallStartTime?: number;
    private lastElapsedSeconds?: string;
    private timerInterval?: number;
    private progressSimulator?: SimulatedProgress;
    private estimatedProcessingMs: number = 60000;

    // Provider-cache window (armed after a successful run)
    private cacheWindow: GossamerCacheWindow | null = null;
    private cacheTimerEl?: HTMLElement;
    private cacheTimerInterval?: number;

    constructor(
        app: App,
        plugin: RadialTimelinePlugin,
        onConfirm: (options: AnalysisOptions) => Promise<void>
    ) {
        super(app);
        this.plugin = plugin;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { titleEl } = this;
        titleEl.setText('');
        this.applyShell({ width: '800px', containerClasses: ['ert-gossamer-processing-modal'] });
        if (this.modalEl) {
            this.modalEl.setCssStyles({ maxWidth: '90vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }

        // Show confirmation view first
        this.showConfirmationView();
    }

    private renderProcessingHero(parent: HTMLElement, subtitle: string, modelName?: string): void {
        const hero = parent.createDiv({ cls: 'ert-modal-header' });

        // Build badge text with active book title and active signal
        const signal = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
        const signalMeta = GOSSAMER_SIGNAL_METADATA[signal];
        const signalLabelLower = signalMeta.label.toLowerCase();
        const bookTitle = getActiveBookTitle(this.plugin.settings);
        const parts = [t('gossamer.processingModal.badge', { signal: signalLabelLower }), bookTitle, modelName].filter(Boolean);
        const badgeText = parts.join(' · ');

        hero.createSpan({ text: badgeText, cls: 'ert-modal-badge' });
        hero.createDiv({ text: t('gossamer.processingModal.title', { signal: signalLabelLower }), cls: 'ert-modal-title' });
        this.subtitleEl = hero.createDiv({ text: subtitle, cls: 'ert-modal-subtitle' });
    }

    onClose(): void {
        // Clear timer if active
        if (this.timerInterval) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = undefined;
        }
        this.clearCacheTimerInterval();
        if (this.progressSimulator) {
            this.progressSimulator.stop();
        }
        // Allow closing while processing - it continues in background
    }

    /**
     * Override close() to allow minimizing while processing continues
     */
    close(): void {
        if (this.isProcessing) {
            new Notice(t('gossamer.processingModal.backgroundContinues'));
        }
        super.close();
    }

    private getActiveModelDisplayName(): string {
        const aiSettings = getCanonicalAiSettings(this.plugin);
        const selection = resolveConfiguredSelection(aiSettings, { feature: 'Gossamer' });
        return selection ? getModelDisplayName(selection.model.id) : t('gossamer.processingModal.modelDisabled');
    }

    private showConfirmationView(): void {
        const { contentEl } = this;
        contentEl.empty();

        const modelName = this.getActiveModelDisplayName();
        const signal = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
        const signalLabelLower = GOSSAMER_SIGNAL_METADATA[signal].label.toLowerCase();
        this.renderProcessingHero(contentEl, t('gossamer.processingModal.confirmSubtitle', { signal: signalLabelLower }), modelName);

        this.confirmationView = contentEl;

        const card = contentEl.createDiv({ cls: 'ert-glass-card' });

        // Info section (no extra spacing class)
        const infoEl = card.createDiv();

        // Beat system info (will be updated when manuscript info is set)
        const beatSystemEl = infoEl.createDiv({ cls: 'ert-gossamer-proc-beat-system-info' });
        beatSystemEl.setText(t('gossamer.processingModal.gatheringDetails'));

        // Manuscript info section (will be populated by caller)
        const infoSection = card.createDiv({ cls: 'ert-gossamer-proc-info-section' });
        infoSection.createEl('h3', { text: t('gossamer.processingModal.manuscriptInfoHeading'), cls: 'ert-section-title' });
        this.manuscriptInfoEl = infoSection.createDiv({ cls: 'ert-gossamer-proc-manuscript-info' });
        this.manuscriptInfoEl.setText(t('gossamer.processingModal.gatheringDetails'));

        // Cache-window alert: persists across modal close/reopen and signal
        // switches as long as the prior run's window is still open.
        this.mountCacheTimer(card);

        // Check if API key is configured for the active provider
        const aiSettings = getCanonicalAiSettings(this.plugin);
        const selection = resolveConfiguredSelection(aiSettings, { feature: 'Gossamer' });
        const activeProvider = selection?.provider ?? aiSettings.provider;
        if (activeProvider !== 'none' && activeProvider !== 'ollama') {
            void getCredential(this.plugin, activeProvider).then(key => {
                if (!key) {
                    const name = CANONICAL_PROVIDER_LABELS[activeProvider];
                    const warningEl = card.createDiv({ cls: 'ert-pulse-warning' });
                    warningEl.setText(t('gossamer.processingModal.keyMissing', { provider: name }));
                }
            });
        }

        // Action buttons
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText(t('gossamer.processingModal.beginButton'))
            .setCta()
            .onClick(async () => {
                await this.startProcessing();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('gossamer.processingModal.cancelButton'))
            .onClick(() => this.close());
    }

    private async startProcessing(): Promise<void> {
        this.isProcessing = true;
        this.showProcessingView();

        try {
            await this.onConfirm(this.analysisOptions);
        } catch (error) {
            console.error('[Gossamer AI] Processing error:', error);
        }
    }

    private showProcessingView(): void {
        const { contentEl } = this;
        contentEl.empty();

        const modelName = this.getActiveModelDisplayName();
        // Keep the same stable description used in the confirmation view.
        // Swapping to "Analyzing manuscript..." was redundant with the
        // status row below ("Sending manuscript to AI for ... analysis"),
        // and the description is the right place for what-the-feature-does,
        // not for the current step.
        const signal = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
        const signalLabelLower = GOSSAMER_SIGNAL_METADATA[signal].label.toLowerCase();
        this.renderProcessingHero(
            contentEl,
            t('gossamer.processingModal.confirmSubtitle', { signal: signalLabelLower }),
            modelName
        );

        const bodyEl = contentEl.createDiv({ cls: 'ert-pulse-progress-body' });
        const progressCard = bodyEl.createDiv({ cls: 'ert-pulse-progress-card ert-glass-card' });

        // Manuscript info section (reusing existing styles but inside the card)
        const infoSection = progressCard.createDiv({ cls: 'ert-gossamer-proc-info-section' });
        infoSection.createEl('h3', { text: t('gossamer.processingModal.manuscriptInfoHeading'), cls: 'ert-section-title' });
        this.manuscriptInfoEl = infoSection.createDiv({ cls: 'ert-gossamer-proc-manuscript-info' });
        this.manuscriptInfoEl.setText(t('gossamer.processingModal.assemblingManuscript'));

        // Progress bar container
        const progressContainer = progressCard.createDiv({ cls: 'ert-pulse-progress-container' });
        const progressBg = progressContainer.createDiv({ cls: 'ert-pulse-progress-bg' });
        this.progressBarEl = progressBg.createDiv({ cls: 'ert-pulse-progress-bar' });
        this.progressBarEl.setCssProps({ '--progress-width': '0%' });

        // Status section
        const statusSection = progressCard.createDiv({ cls: 'ert-gossamer-proc-status-section' });
        statusSection.createEl('h3', { text: t('gossamer.processingModal.statusHeading'), cls: 'ert-section-title' });
        this.statusTextEl = statusSection.createDiv({ cls: 'ert-gossamer-proc-status-text' });
        this.statusTextEl.setText(this.currentStatus);

        this.apiStatusEl = statusSection.createDiv({ cls: 'ert-gossamer-proc-api-status' });
        this.apiStatusEl.setText(t('gossamer.processingModal.waitingToSend'));

        // Cache-window row: shows a live countdown whenever a window is open
        // (this run's, or a still-warm one from a prior run).
        this.mountCacheTimer(statusSection);

        const advancedDetails = progressCard.createEl('details', { cls: 'ert-ai-advanced-details' });
        advancedDetails.createEl('summary', { text: t('gossamer.processingModal.advancedHeading') });
        this.aiAdvancedPreEl = advancedDetails.createEl('pre', { cls: 'ert-ai-advanced-pre' });
        this.renderAiAdvancedContext();

        // Error section
        this.errorListEl = bodyEl.createDiv({ cls: 'ert-pulse-error-list ert-glass-card ert-hidden' });

        // Close button (disabled while processing)
        const buttonContainer = contentEl.createDiv({ cls: 'ert-modal-actions' });
        this.closeButtonEl = new ButtonComponent(buttonContainer)
            .setButtonText(t('gossamer.processingModal.closeButton'))
            .setDisabled(true)
            .onClick(() => this.close());
    }

    public setAiAdvancedContext(context: AIRunAdvancedContext | null): void {
        this.aiAdvancedContext = context;
        this.renderAiAdvancedContext();
    }

    private renderAiAdvancedContext(): void {
        if (!this.aiAdvancedPreEl) return;
        if (!this.aiAdvancedContext) {
            this.aiAdvancedPreEl.setText(t('gossamer.processingModal.waitingFirstRequest'));
            return;
        }
        const ctx = this.aiAdvancedContext;
        const availabilityValue = ctx.availabilityStatus === 'visible'
            ? t('gossamer.processingModal.advAvailabilityVisible')
            : ctx.availabilityStatus === 'not_visible'
                ? t('gossamer.processingModal.advAvailabilityNotVisible')
                : t('gossamer.processingModal.advAvailabilityUnknown');
        const tokenLine = typeof ctx.totalInputTokens === 'number' && Number.isFinite(ctx.totalInputTokens)
            ? t('gossamer.processingModal.advTokenEstimate', {
                count: Math.max(0, Math.floor(ctx.totalInputTokens)).toLocaleString(),
                method: describeTokenEstimateMethod(ctx.tokenEstimateMethod ?? 'heuristic_chars')
            })
            : t('gossamer.processingModal.advTokenEstimateUnavailable');
        const lines = [
            t('gossamer.processingModal.advRoleTemplate', { value: ctx.roleTemplateName }),
            t('gossamer.processingModal.advResolvedModel', { provider: ctx.provider, alias: ctx.modelAlias, label: ctx.modelLabel }),
            t('gossamer.processingModal.advModelSelectionReason', { value: redactSensitiveValue(ctx.modelSelectionReason) }),
            t('gossamer.processingModal.advAvailability', { value: availabilityValue }),
            t('gossamer.processingModal.advAppliedCaps', { input: ctx.maxInputTokens, output: ctx.maxOutputTokens }),
            tokenLine,
            t('gossamer.processingModal.advPackaging'),
            t('gossamer.processingModal.advEvidence', { value: this.manuscriptInfo?.evidenceMode || t('gossamer.processingModal.evidenceDefault') }),
            '',
            t('gossamer.processingModal.advFinalPromptLabel'),
            redactSensitiveValue(ctx.finalPrompt || t('gossamer.processingModal.advFinalPromptNone'))
        ];
        if (typeof ctx.executionPassCount === 'number' && ctx.executionPassCount > 1) {
            lines.splice(6, 0, t('gossamer.processingModal.advPassCount', { value: ctx.executionPassCount }));
        }
        if (ctx.multiPassTriggerReason) {
            lines.splice(7, 0, t('gossamer.processingModal.advMultiPassTrigger', { value: redactSensitiveValue(ctx.multiPassTriggerReason) }));
        }
        this.aiAdvancedPreEl.setText(lines.join('\n'));
    }

    /**
     * Update manuscript assembly information
     */
    public setManuscriptInfo(info: ManuscriptInfo): void {
        this.manuscriptInfo = info;

        if (this.manuscriptInfoEl) {
            this.manuscriptInfoEl.empty();

            // Stats Grid
            const stats = this.manuscriptInfoEl.createDiv({ cls: 'ert-gossamer-proc-stats' });

            const createStat = (label: string, value: string) => {
                const item = stats.createDiv({ cls: 'ert-gossamer-proc-stat-item' });
                item.createDiv({ cls: 'ert-gossamer-proc-stat-label', text: label });
                item.createDiv({ cls: 'ert-gossamer-proc-stat-value', text: value });
            };

            createStat(t('gossamer.processingModal.statScenes'), info.totalScenes.toLocaleString());
            createStat(t('gossamer.processingModal.statWords'), info.totalWords.toLocaleString());
            createStat(t('gossamer.processingModal.statCorpusTokens'), formatTokenShorthand(info.estimatedTokens));
            createStat(t('gossamer.processingModal.statBeats'), info.beatCount.toString());
            createStat(t('gossamer.processingModal.statEvidence'), info.evidenceMode || t('gossamer.processingModal.evidenceDefault'));

            // Note: Previous scores are not sent to AI to avoid anchoring bias.
            // Each analysis is fresh based on manuscript content only.
        }

        // Seed the API phase from the last observed normal runtime when
        // available; otherwise use the one-minute default baseline.
        this.estimatedProcessingMs = this.estimateProcessingMs(info);

        // Update the beat system info in confirmation view if it exists
        const beatSystemInfoEl = this.confirmationView?.querySelector('.ert-gossamer-proc-beat-system-info');
        if (beatSystemInfoEl) {
            beatSystemInfoEl.setText(t('gossamer.processingModal.beatSystemLine', { name: info.beatSystem }));
        }
        this.renderAiAdvancedContext();
    }

    /**
     * Update current status message
     */
    public setStatus(status: string): void {
        this.currentStatus = status;

        if (this.statusTextEl) {
            this.statusTextEl.setText(status);
        }
    }

    /**
     * Mark API call as started
     */
    public apiCallStarted(): void {
        this.apiCallStartTime = Date.now();

        if (this.apiStatusEl) {
            this.apiStatusEl.empty();
            this.updateTimer();

            // SAFE: Modal doesn't have registerInterval; manually cleaned up in onClose()
            this.timerInterval = window.setInterval(() => {
                this.updateTimer();
            }, 1000);
        }

        // Animate progress bar to indicate activity.
        if (this.progressBarEl) {
            this.progressBarEl.addClass('ert-gossamer-progress-active');
        }

        this.startSimulatedProgress();
    }

    /**
     * Update elapsed time display
     */
    private updateTimer(): void {
        if (!this.apiStatusEl || !this.apiCallStartTime) return;

        const elapsed = Math.floor((Date.now() - this.apiCallStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timeStr = minutes > 0
            ? `${minutes}:${seconds.toString().padStart(2, '0')}`
            : `${seconds}s`;

        // Show elapsed time only. The previous "running longer than
        // expected (est. ~Ns)" framing read as anxious/lame UX — the
        // progress bar already conveys "still working." Skip the
        // estimate-comparison commentary entirely.
        const message = t('gossamer.processingModal.timerElapsed', { time: timeStr });
        this.apiStatusEl.setText(message);
    }

    /**
     * Mark API call as successful
     */
    public apiCallSuccess(): void {
        // Clear timer
        if (this.timerInterval) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = undefined;
        }

        const elapsedMs = this.apiCallStartTime ? Date.now() - this.apiCallStartTime : undefined;
        this.lastElapsedSeconds = elapsedMs !== undefined ? (elapsedMs / 1000).toFixed(1) : undefined;

        // Persist elapsed per-signal so the next run can use the observed
        // normal runtime as its progress baseline.
        if (elapsedMs !== undefined && elapsedMs > 0) {
            void this.persistLastRunDuration(elapsedMs);
        }

        // Elapsed is now rolled into the combined success line in completeProcessing;
        // clear the separate "Response received" row so there's only one end-state line.
        if (this.apiStatusEl) {
            this.apiStatusEl.empty();
        }

        // Complete the progress bar and pause animation
        if (this.progressSimulator) {
            this.progressSimulator.complete();
        }
        if (this.progressBarEl) {
            this.progressBarEl.removeClass('ert-gossamer-progress-active');
            this.progressBarEl.addClass('ert-progress-complete');
            // SAFE: inline style used for CSS custom property (--progress-width) to enable smooth progress animation
            this.progressBarEl.setCssProps({ '--progress-width': '100%' });
        }
    }

    private async persistLastRunDuration(elapsedMs: number): Promise<void> {
        const signal = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
        const bucket = this.plugin.settings.gossamerLastRunMsBySignal ?? {};
        bucket[signal] = elapsedMs;
        this.plugin.settings.gossamerLastRunMsBySignal = bucket;
        await this.plugin.saveSettings();
    }

    /**
     * Surface the provider-cache window armed by this run so the author knows
     * how long they have to score the remaining signals on the cached
     * manuscript. Drives a live MM:SS countdown that self-hides on expiry.
     */
    public setCacheWindow(next: GossamerCacheWindow | null): void {
        this.cacheWindow = next;
        this.renderCacheTimer();
        this.ensureCacheTimerTick();
    }

    /**
     * Effective window for display: the one armed by this modal's own run if
     * present, otherwise the plugin's live window from a prior run. The latter
     * is why the alert survives closing + reopening the modal (or switching
     * signals) while the cache is still warm.
     */
    private resolveCacheWindow(): GossamerCacheWindow | null {
        return this.cacheWindow ?? this.plugin.gossamerCacheWindow;
    }

    /**
     * Create (or re-bind) the cache-timer element under `parent` and paint it
     * from the current window. Called by both the confirmation and processing
     * views so the alert is present whenever a window is open.
     */
    private mountCacheTimer(parent: HTMLElement): void {
        this.cacheTimerEl = parent.createDiv({ cls: 'ert-gossamer-proc-cache-timer ert-hidden' });
        this.renderCacheTimer();
        this.ensureCacheTimerTick();
    }

    private ensureCacheTimerTick(): void {
        if (this.cacheTimerInterval) return;
        if (!isGossamerCacheWindowOpen(this.resolveCacheWindow(), Date.now())) return;
        // SAFE: Modal has no registerInterval; cleared in onClose() and on expiry.
        this.cacheTimerInterval = window.setInterval(() => this.renderCacheTimer(), 1000);
    }

    private clearCacheTimerInterval(): void {
        if (this.cacheTimerInterval) {
            window.clearInterval(this.cacheTimerInterval);
            this.cacheTimerInterval = undefined;
        }
    }

    private renderCacheTimer(): void {
        const el = this.cacheTimerEl;
        if (!el) return;
        const window_ = this.resolveCacheWindow();
        const clock = formatGossamerCacheClock(window_, Date.now());
        if (!clock) {
            el.empty();
            el.addClass('ert-hidden');
            this.clearCacheTimerInterval();
            return;
        }
        const remaining = GOSSAMER_SIGNAL_TYPES.length - 1;
        const costHint = formatGossamerCacheCostHint(window_);
        const base = `Manuscript cached · ${clock} — score the other ${remaining} signals now to reuse it`;
        el.removeClass('ert-hidden');
        el.setText(costHint ? `${base} (${costHint})` : base);
    }

    /**
     * Mark API call as failed with error
     */
    public apiCallError(error: string): void {
        // Clear timer
        if (this.timerInterval) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = undefined;
        }

        if (this.apiStatusEl) {
            this.apiStatusEl.empty();
            this.apiStatusEl.setText(t('gossamer.processingModal.apiFailed'));
        }

        // Reset progress bar
        if (this.progressSimulator) {
            this.progressSimulator.fail();
        }
        if (this.progressBarEl) {
            this.progressBarEl.removeClass('ert-gossamer-progress-active');
            this.progressBarEl.addClass('ert-progress-complete');
            // SAFE: inline style used for CSS custom property (--progress-width) to enable smooth progress animation
            this.progressBarEl.setCssProps({ '--progress-width': '0%' });
        }

        this.addError(error);
    }

    /**
     * Add error message to error section (using Scene Analysis styling)
     */
    public addError(message: string): void {
        if (!this.errorListEl) return;

        this.ensureErrorSummary();
        this.errorMessages.push(message.trim());
        this.renderErrorParagraph();
    }

    /**
     * Append a clickable link to the run's log file inside the error zone so
     * the user can open it with one click, copy the full payload, and send it
     * along with a bug report. Only shown when an error has already been
     * reported (the section is otherwise hidden).
     */
    public addErrorLogLink(file: TFile): void {
        if (!this.errorListEl) return;

        this.ensureErrorSummary();

        const linkRow = this.errorListEl.createDiv({ cls: 'ert-gossamer-proc-error-log-link' });
        linkRow.createSpan({ text: t('gossamer.processingModal.errorLogLinkLabel') });
        const link = linkRow.createEl('a', {
            cls: 'ert-gossamer-proc-error-log-link-target',
            text: file.path,
            href: '#'
        });
        link.addEventListener('click', (evt) => {
            evt.preventDefault();
            void this.plugin.app.workspace.openLinkText(file.path, '', 'tab');
        });
    }

    private ensureErrorSummary(): void {
        if (!this.errorListEl) return;
        if (this.errorListEl.hasClass('ert-hidden')) {
            this.errorListEl.removeClass('ert-hidden');
        }
        if (this.errorMessageEl) return;

        const summary = this.errorListEl.createDiv({ cls: 'ert-gossamer-proc-error-summary' });
        const icon = summary.createDiv({ cls: 'ert-gossamer-proc-error-icon' });
        setIcon(icon, 'alert-triangle');
        this.errorMessageEl = summary.createEl('p', { cls: 'ert-gossamer-proc-error-copy' });
        this.renderErrorParagraph();
    }

    private renderErrorParagraph(): void {
        if (!this.errorMessageEl) return;
        const text = this.errorMessages
            .map((message) => message.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' ');
        this.errorMessageEl.setText(text || t('gossamer.processingModal.errorsHeader'));
    }

    /**
     * Mark processing as complete
     */
    public completeProcessing(success: boolean, message: string): void {
        this.isProcessing = false;

        if (this.statusTextEl) {
            const elapsedSuffix = success && this.lastElapsedSeconds ? ` (${this.lastElapsedSeconds}s)` : '';
            this.statusTextEl.setText(`${message}${elapsedSuffix}`);
        }

        // Modal subtitle stays as the original setup description for the
        // whole run — the run status is surfaced by statusTextEl below.
        // Mirroring it on the subtitle was redundant.

        // Complete the progress bar and pause animation
        if (this.progressSimulator) {
            if (success) {
                this.progressSimulator.complete();
            } else {
                this.progressSimulator.fail();
            }
        }
        if (this.progressBarEl) {
            this.progressBarEl.removeClass('ert-gossamer-progress-active');
            this.progressBarEl.addClass('ert-progress-complete');
            if (success) {
                // SAFE: inline style used for CSS custom property (--progress-width) to enable smooth progress animation
                this.progressBarEl.setCssProps({ '--progress-width': '100%' });
            }
        }

        if (this.closeButtonEl) {
            this.closeButtonEl.setDisabled(false);
            if (success) {
                this.closeButtonEl.setCta();
            }
        }
    }

    /**
     * Show rate limit notification
     */
    public showRateLimitWarning(retryAfter?: number): void {
        const message = retryAfter
            ? t('gossamer.processingModal.rateLimitWithRetry', { seconds: retryAfter })
            : t('gossamer.processingModal.rateLimit');

        this.addError(message);

        if (this.apiStatusEl) {
            this.apiStatusEl.setText(t('gossamer.processingModal.rateLimited'));
        }
    }

    /**
     * Start a simulated progress animation using manuscript-derived estimate.
     */
    private startSimulatedProgress(): void {
        const durationMs = this.estimateProcessingMs(this.manuscriptInfo);
        this.estimatedProcessingMs = durationMs;

        const simulator = this.getProgressSimulator();
        simulator.start({
            durationMs,
            startPercent: 0,
            maxPercent: 100,
            jitter: 0,
            completeOnDuration: true
        });
    }

    /**
     * Ensure we have a simulator instance and wire it to the bar element.
     */
    private getProgressSimulator(): SimulatedProgress {
        if (!this.progressSimulator) {
            this.progressSimulator = new SimulatedProgress((percent: number) => {
                this.updateProgressWidth(percent);
            });
        }
        return this.progressSimulator;
    }

    private updateProgressWidth(percent: number): void {
        if (this.progressBarEl) {
            // SAFE: inline style used for CSS custom property (--progress-width) to enable smooth progress animation
            this.progressBarEl.style.setProperty('--progress-width', `${percent}%`);
        }
    }

    /**
     * Gossamer AI requests use the last successful runtime for the active
     * signal as the next progress baseline. The one-minute value is only the
     * cold-start default when no observed runtime exists yet.
     */
    private estimateProcessingMs(_info?: ManuscriptInfo): number {
        const signal = this.plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL;
        const observed = this.plugin.settings.gossamerLastRunMsBySignal?.[signal];
        if (typeof observed === 'number' && Number.isFinite(observed) && observed > 0) {
            return Math.min(300000, Math.max(5000, observed));
        }

        return 60000;
    }
}

export default GossamerProcessingModal;
