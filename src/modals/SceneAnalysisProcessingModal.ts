/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * AI Scene Analysis Processing Modal
 * This processes scenes for LLM analysis, not story beats (timeline slices)
 */
import { App, Modal, ButtonComponent, Notice, setIcon, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { resolvePulseContentLogsRoot } from '../ai/log';
import { getModelDisplayName } from '../utils/modelResolver';
import type { LlmTimingStats } from '../types/settings';
import { getSynopsisGenerationWordLimit, getSynopsisHoverLineLimit } from '../utils/synopsisLimits';
import type { AIRunAdvancedContext } from '../ai/types';
import { redactSensitiveValue } from '../ai/credentials/redactSensitive';
import { getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { getLocalLlmSettings, LOCAL_LLM_BACKEND_LABELS } from '../ai/localLlm/settings';
import { getActiveBookTitle } from '../utils/books';
import { t } from '../i18n';

export type ProcessingMode = 'open' | 'flagged' | 'unprocessed' | 'force-all' | 'synopsis-flagged' | 'synopsis-missing-weak' | 'synopsis-missing' | 'synopsis-all';

export type SceneQueueItem = {
    id: string;
    label: string;
    detail?: string;
};

/**
 * Simple confirmation modal that matches the generic modal system
 */
class ConfirmationModal extends Modal {
    private readonly message: string;
    private readonly onConfirm: () => void;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '520px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Header
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('sceneAnalysis.confirm.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('sceneAnalysis.confirm.title') });

        // Message card
        const card = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass' });
        card.createDiv({ text: this.message });

        // Actions
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.confirm.continueButton'))
            .setCta()
            .onClick(() => {
                this.close();
                this.onConfirm();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.confirm.cancelButton'))
            .onClick(() => this.close());
    }
}

/**
 * Modal for confirming and showing progress of scene analysis processing
 */
export class SceneAnalysisProcessingModal extends Modal {
    private readonly plugin: RadialTimelinePlugin;
    private readonly onConfirm: (mode: ProcessingMode, weakThreshold?: number, targetWords?: number) => Promise<void>;
    private readonly getSceneCount: (mode: ProcessingMode, weakThreshold?: number) => Promise<number>;
    private readonly resumeCommandId?: string; // Optional command ID to trigger on resume
    private readonly subplotName?: string; // Optional subplot name for resume (subplot processing only)
    private readonly isEntireSubplot?: boolean; // Track if this is "entire subplot" vs "flagged scenes"
    private readonly taskType: 'pulse' | 'synopsis';

    private processedResults: Map<string, string> = new Map(); // Staged Summary results for apply/discard flow.
    private processedSynopsisResults: Map<string, string> = new Map(); // Optional staged Synopsis writes (legacy key).
    private hasPendingSynopsisResults: boolean = false; // Whether staged results are available to apply.

    private selectedMode: ProcessingMode = 'flagged';
    public isProcessing: boolean = false;
    private abortController: AbortController | null = null;

    // Summary-refresh controls
    private synopsisTargetWords: number = 200;
    private synopsisWeakThreshold: number = 75;

    // Progress tracking
    private progressBarEl?: HTMLElement;
    private progressTextEl?: HTMLElement;
    private statusTextEl?: HTMLElement;
    private heroStatusEl?: HTMLElement;
    private errorListEl?: HTMLElement;
    private abortButtonEl?: ButtonComponent;
    private actionButtonContainer?: HTMLElement;
    private queueScrollEl?: HTMLElement;
    private queueTrackEl?: HTMLElement;
    private queueNoteEl?: HTMLElement;
    private queueItems: HTMLElement[] = [];
    private queueData: SceneQueueItem[] = [];
    private queueActiveId?: string;
    private queueStatus: Map<string, 'success' | 'error'> = new Map();
    private queueGrades: Map<string, 'A' | 'B' | 'C'> = new Map();
    private aiAdvancedContext: AIRunAdvancedContext | null = null;
    private aiAdvancedPreEl?: HTMLElement;
    private aiAdvancedDetailsEl?: HTMLElement;

    // Statistics
    private processedCount: number = 0;
    private totalCount: number = 0;
    private errorCount: number = 0;
    private warningCount: number = 0;
    private pendingRafId: number | null = null;
    private errorMessages: { message: string; hint?: string }[] = [];
    private warningMessages: string[] = [];
    private logAttempts: number = 0;
    private progressSnapshotText: string = '';
    private statusSnapshotText: string = '';

    // Animation state for progress bar estimation
    private animationIntervalId: number | null = null;
    private currentEstimatedSeconds: number = 0;

    constructor(
        app: App,
        plugin: RadialTimelinePlugin,
        getSceneCount: (mode: ProcessingMode, weakThreshold?: number) => Promise<number>,
        onConfirm: (mode: ProcessingMode, weakThreshold?: number, targetWords?: number) => Promise<void>,
        resumeCommandId?: string,
        subplotName?: string,
        isEntireSubplot?: boolean,
        taskType: 'pulse' | 'synopsis' = 'pulse'
    ) {
        super(app);
        this.plugin = plugin;
        this.getSceneCount = getSceneCount;
        this.onConfirm = onConfirm;
        this.resumeCommandId = resumeCommandId;
        this.subplotName = subplotName;
        this.isEntireSubplot = isEntireSubplot;
        this.taskType = taskType;

        // Summary-refresh settings are persisted on plugin settings (legacy key names retained for compatibility).
        this.synopsisTargetWords = plugin.settings.synopsisTargetWords ?? 200;
        this.synopsisWeakThreshold = plugin.settings.synopsisWeakThreshold ?? 75;
    }

    onOpen(): void {
        const { contentEl, titleEl, modalEl } = this;
        // Use generic modal base + scene analysis specific styling
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');
        contentEl.addClass('ert-scene-analysis-modal');
        titleEl.setText('');

        // If we're already processing (reopening), show progress view
        if (this.isProcessing) {
            this.showProgressView();
        } else {
            this.showConfirmationView();
        }
    }

    onClose(): void {
        if (this.pendingRafId !== null) {
            cancelAnimationFrame(this.pendingRafId);
            this.pendingRafId = null;
        }
        // Clean up animation interval
        this.stopSceneAnimation();
    }

    /**
     * Override close() to allow minimizing while processing continues
     */
    close(): void {
        if (this.isProcessing) {
            new Notice(t('sceneAnalysis.processingModal.backgroundProcessing'));
        }
        super.close();
    }

    private ensureModalShell(): void {
        if (this.modalEl && !this.modalEl.classList.contains('ert-modal-shell')) {
            this.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
        }
        this.contentEl.classList.add('ert-modal-container', 'ert-stack');
        this.contentEl.classList.add('ert-scene-analysis-modal');
    }

    private getProcessingTitle(): string {
        if (this.taskType === 'synopsis') {
            return t('sceneAnalysis.processingModal.titleSummaryRefresh');
        }
        if (this.subplotName) {
            return this.isEntireSubplot
                ? t('sceneAnalysis.processingModal.titleProcessingEntireSubplot', { name: this.subplotName })
                : t('sceneAnalysis.processingModal.titleProcessingSubplot', { name: this.subplotName });
        }
        return t('sceneAnalysis.processingModal.titleScenePulse');
    }

    private getModeLabel(mode: ProcessingMode): string {
        switch (mode) {
            case 'unprocessed': return t('sceneAnalysis.processingModal.modeUnprocessed');
            case 'force-all': return t('sceneAnalysis.processingModal.modeForceAll');
            case 'flagged': return t('sceneAnalysis.processingModal.modeFlagged');
            case 'synopsis-flagged': return t('sceneAnalysis.processingModal.modeSynopsisFlagged');
            case 'synopsis-missing-weak': return t('sceneAnalysis.processingModal.modeSynopsisMissingWeak');
            case 'synopsis-missing': return t('sceneAnalysis.processingModal.modeSynopsisMissing');
            case 'synopsis-all': return t('sceneAnalysis.processingModal.modeSynopsisAll');
            default: return mode;
        }
    }

    private getProcessingSubtitle(): string {
        if (this.taskType === 'synopsis') {
            return t('sceneAnalysis.processingModal.subtitleSynopsis');
        }
        if (this.subplotName) {
            return this.isEntireSubplot
                ? t('sceneAnalysis.processingModal.subtitleEntireSubplot', { name: this.subplotName })
                : t('sceneAnalysis.processingModal.subtitleFlaggedSubplot', { name: this.subplotName });
        }
        return this.getModeLabel(this.selectedMode);
    }

    private renderProcessingHero(
        parent: HTMLElement,
        options?: { trackStatus?: boolean; subtitle?: string; metaItems?: string[] }
    ): HTMLElement {
        // Use flat header style matching Book Designer (no border/background on header)
        const hero = parent.createDiv({ cls: 'ert-modal-header' });
        const modelLabel = this.getActiveModelDisplayName();
        const bookTitle = getActiveBookTitle(this.plugin.settings);
        const badgeLabel = this.taskType === 'synopsis'
            ? t('sceneAnalysis.processingModal.badgeAiSummary')
            : t('sceneAnalysis.processingModal.badgeAiPulseRun');
        const parts = [badgeLabel, bookTitle, modelLabel].filter(Boolean);
        const badgeText = parts.join(' · ');
        hero.createSpan({ text: badgeText, cls: 'ert-scene-analysis-badge' });
        hero.createDiv({ text: this.getProcessingTitle(), cls: 'ert-modal-title' });
        const subtitleText = options?.subtitle ?? this.getProcessingSubtitle();
        const subtitleEl = hero.createDiv({ cls: 'ert-modal-subtitle' });
        subtitleEl.setText(subtitleText);
        if (options?.trackStatus) {
            this.heroStatusEl = subtitleEl;
        } else {
            this.heroStatusEl = undefined;
        }
        // Add meta pills only if provided (e.g., during progress view)
        const metaItems = options?.metaItems ?? [];
        if (metaItems.length > 0) {
            const metaEl = hero.createDiv({ cls: 'ert-scene-analysis-meta' });
            for (const item of metaItems) {
                metaEl.createSpan({ text: item, cls: 'ert-scene-analysis-meta-item' });
            }
        }
        return hero;
    }

    public setProcessingQueue(queue: SceneQueueItem[]): void {
        this.queueData = queue.slice();
        this.queueStatus.clear();
        this.queueGrades.clear();
        this.queueActiveId = undefined;
        this.totalCount = queue.length;
        if (this.isProcessing && this.progressTextEl && queue.length > 0 && this.processedCount === 0) {
            this.progressSnapshotText = t('sceneAnalysis.processingModal.progress.sceneProgress', { current: 0, total: queue.length, percentage: 0 });
            this.progressTextEl.setText(this.progressSnapshotText);
        }
        this.renderQueueItems();
    }

    private renderQueueItems(): void {
        if (!this.queueTrackEl) return;
        this.queueTrackEl.empty();
        this.queueItems = [];

        if (this.queueData.length === 0) {
            this.queueTrackEl.createSpan({ cls: 'ert-pulse-ruler-empty', text: t('sceneAnalysis.processingModal.queue.empty') });
            return;
        }

        for (const item of this.queueData) {
            const entry = this.queueTrackEl.createDiv({ cls: 'ert-pulse-ruler-item' });
            entry.setAttr('data-queue-id', item.id);

            // Background icon container (for grade-based icons or synopsis icons)
            const iconBg = entry.createDiv({ cls: 'ert-pulse-card-icon-bg' });
            iconBg.setAttr('aria-hidden', 'true');

            // For synopsis mode, add "?" icon for unprocessed scenes
            if (this.taskType === 'synopsis') {
                setIcon(iconBg, 'help-circle');
                entry.addClass('ert-synopsis-pending');
            }

            // Content wrapper to sit above the background
            const content = entry.createDiv({ cls: 'ert-pulse-card-content' });

            const primaryLabel = item.label?.trim() || '—';
            content.createSpan({ cls: 'ert-pulse-ruler-value', text: primaryLabel });

            const secondary = item.detail?.trim();
            if (secondary && secondary !== primaryLabel) {
                content.createSpan({ cls: 'ert-pulse-ruler-label', text: secondary });
            }

            // Grade placeholder - always present to reserve space, prevents resize when grade arrives (pulse mode only)
            if (this.taskType !== 'synopsis') {
                const gradePlaceholder = content.createDiv({ cls: 'ert-pulse-grade ert-pulse-grade-placeholder' });
                gradePlaceholder.setAttr('aria-hidden', 'true');
            }

            const status = this.queueStatus.get(item.id);
            const grade = this.queueGrades.get(item.id);
            if (status) {
                this.applyQueueStatus(entry, status, grade);
            } else if (grade) {
                this.applyQueueStatus(entry, 'success', grade);
            }

            this.queueItems.push(entry);
        }

        this.updateQueueHighlight();
    }

    private updateQueueHighlight(activeId?: string): void {
        if (activeId) {
            this.queueActiveId = activeId;
        }
        if (!this.queueTrackEl || !this.queueScrollEl) return;

        const activeIndex = this.queueActiveId
            ? this.queueData.findIndex(item => item.id === this.queueActiveId)
            : -1;

        this.queueItems.forEach((itemEl, index) => {
            itemEl.toggleClass('ert-is-active', index === activeIndex);
            itemEl.toggleClass('ert-is-complete', activeIndex !== -1 && index < activeIndex);
        });

        if (activeIndex >= 0) {
            const activeEl = this.queueItems[activeIndex];
            const container = this.queueScrollEl;
            if (activeEl && container) {
                const target = Math.max(0, activeEl.offsetLeft - (container.clientWidth / 2 - activeEl.clientWidth / 2));
                container.scrollTo({ left: target, behavior: 'smooth' });
            }
        }
    }

    private updateQueueHighlightByIndex(index: number): void {
        if (this.queueData.length === 0) return;
        const safeIndex = Math.min(Math.max(index, 0), this.queueData.length - 1);
        const queueId = this.queueData[safeIndex]?.id;
        if (queueId) {
            this.updateQueueHighlight(queueId);
        }
    }

    public markQueueStatus(queueId: string, status: 'success' | 'error', grade?: 'A' | 'B' | 'C'): void {
        if (!queueId) return;
        this.queueStatus.set(queueId, status);
        if (grade) {
            this.queueGrades.set(queueId, grade);
        }
        const entry = this.queueItems.find(item => item.getAttribute('data-queue-id') === queueId);
        if (entry) {
            this.applyQueueStatus(entry, status, grade);
        }
    }

    private applyQueueStatus(entry: HTMLElement, status: 'success' | 'error', grade?: 'A' | 'B' | 'C'): void {
        // Remove old status classes
        entry.removeClass('ert-status-success', 'ert-status-error', 'ert-grade-a', 'ert-grade-b', 'ert-grade-c', 'ert-synopsis-pending', 'ert-synopsis-complete');

        // For errors only (API failures), apply error styling
        if (status === 'error') {
            entry.addClass('ert-status-error');
            const iconBg = entry.querySelector('.ert-pulse-card-icon-bg');
            if (iconBg) {
                iconBg.empty();
                setIcon(iconBg as HTMLElement, 'x-circle');
            }
            return;
        }

        // Summary-refresh mode uses completion state instead of Pulse grades.
        if (this.taskType === 'synopsis') {
            entry.addClass('ert-synopsis-complete');

            // Add checkmark icon in background
            const iconBg = entry.querySelector('.ert-pulse-card-icon-bg');
            if (iconBg) {
                iconBg.empty();
                setIcon(iconBg as HTMLElement, 'check');
            }
            return;
        }

        // Pulse mode: style by grade
        if (grade) {
            entry.addClass(`ert-grade-${grade.toLowerCase()}`);

            // Find existing grade placeholder and update it (don't create new element to prevent resize)
            const gradeEl = entry.querySelector('.ert-pulse-grade') as HTMLElement;
            if (gradeEl) {
                gradeEl.setText(grade);
                gradeEl.removeClass('ert-pulse-grade-placeholder');
                gradeEl.addClass(`ert-pulse-grade-${grade.toLowerCase()}`);
                gradeEl.removeAttribute('aria-hidden');
            }

            // Add background icon based on grade
            const iconBg = entry.querySelector('.ert-pulse-card-icon-bg');
            if (iconBg) {
                iconBg.empty();
                const iconName = grade === 'A' ? 'rainbow' : grade === 'B' ? 'mountain' : 'recycle';
                setIcon(iconBg as HTMLElement, iconName);
            }
        }
    }

    private setTripletNote(prevNum: string, currentNum: string, nextNum: string): void {
        if (!this.queueNoteEl) return;
        this.queueNoteEl.empty();

        const boundaryLabel = this.subplotName
            ? t('sceneAnalysis.processingModal.queue.boundarySubplot')
            : t('sceneAnalysis.processingModal.queue.boundaryManuscript');
        const chips = [
            { label: t('sceneAnalysis.processingModal.queue.previousLabel'), value: prevNum, fallback: t('sceneAnalysis.processingModal.queue.startOfBoundary', { boundary: boundaryLabel }) },
            { label: t('sceneAnalysis.processingModal.queue.currentLabel'), value: currentNum, fallback: t('sceneAnalysis.processingModal.queue.unnumberedScene') },
            { label: t('sceneAnalysis.processingModal.queue.nextLabel'), value: nextNum, fallback: t('sceneAnalysis.processingModal.queue.endOfBoundary', { boundary: boundaryLabel }) }
        ];

        for (const chip of chips) {
            const chipEl = this.queueNoteEl.createSpan({ cls: 'ert-pulse-ruler-chip' });
            chipEl.createSpan({ cls: 'ert-pulse-ruler-chip-label', text: chip.label });
            chipEl.createSpan({ cls: 'ert-pulse-ruler-chip-value', text: this.formatTripletValue(chip.value, chip.fallback) });
        }
    }

    private formatTripletValue(value: string, fallback: string): string {
        const normalized = value?.trim();
        if (!normalized || normalized === 'N/A') {
            return fallback;
        }
        return normalized.startsWith('#') ? normalized : `#${normalized}`;
    }

    private findQueueIdForScene(value: string): string | undefined {
        if (!value) return undefined;
        const cleaned = value.replace(/^#/, '').trim();
        const found = this.queueData.find(item => item.label.replace(/^#/, '').trim() === cleaned);
        return found?.id;
    }

    private showConfirmationView(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        this.ensureModalShell();
        titleEl.setText('');

        // Set modal width using Obsidian's approach
        if (modalEl) {
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }

        this.renderProcessingHero(contentEl);

        // Summary-refresh controls (plus optional legacy Synopsis update).
        if (this.taskType === 'synopsis') {
            const controlsCard = contentEl.createDiv({ cls: 'ert-glass-card ert-synopsis-controls' });

            // Target Summary Length - Two column layout
            const targetControl = controlsCard.createDiv({ cls: 'ert-synopsis-control ert-synopsis-control--row' });
            const targetInfo = targetControl.createDiv({ cls: 'ert-synopsis-control-info' });
            targetInfo.createEl('label', { text: t('sceneAnalysis.processingModal.controls.targetLengthLabel'), cls: 'ert-synopsis-control-label' });
            targetInfo.createDiv({
                text: t('sceneAnalysis.processingModal.controls.targetLengthHelp'),
                cls: 'ert-synopsis-control-help'
            });
            const targetInput = targetControl.createEl('input', {
                type: 'number',
                cls: 'ert-synopsis-control-input',
                attr: { min: '75', max: '500', step: '25' }
            });
            targetInput.value = String(this.synopsisTargetWords);

            const saveTargetValue = () => {
                const val = parseInt(targetInput.value, 10);
                if (!isNaN(val) && val >= 75 && val <= 500) {
                    this.synopsisTargetWords = val;
                    this.plugin.settings.synopsisTargetWords = val;
                    void this.plugin.saveSettings();
                    this.checkThresholdWarning(warningEl);
                }
            };

            targetInput.addEventListener('change', saveTargetValue);
            targetInput.addEventListener('blur', saveTargetValue);
            targetInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveTargetValue();
                    targetInput.blur();
                }
            });

            // Horizontal rule separator
            controlsCard.createEl('hr', { cls: 'ert-synopsis-control-divider' });

            // Weak Summary Threshold - Two column layout
            const thresholdControl = controlsCard.createDiv({ cls: 'ert-synopsis-control ert-synopsis-control--row' });
            const thresholdInfo = thresholdControl.createDiv({ cls: 'ert-synopsis-control-info' });
            thresholdInfo.createEl('label', { text: t('sceneAnalysis.processingModal.controls.weakThresholdLabel'), cls: 'ert-synopsis-control-label' });
            thresholdInfo.createDiv({
                text: t('sceneAnalysis.processingModal.controls.weakThresholdHelp'),
                cls: 'ert-synopsis-control-help'
            });
            const thresholdInput = thresholdControl.createEl('input', {
                type: 'number',
                cls: 'ert-synopsis-control-input',
                attr: { min: '10', max: '300', step: '5' }
            });
            thresholdInput.value = String(this.synopsisWeakThreshold);

            const saveThresholdValue = () => {
                const val = parseInt(thresholdInput.value, 10);
                if (!isNaN(val) && val >= 10 && val <= 300) {
                    this.synopsisWeakThreshold = val;
                    this.plugin.settings.synopsisWeakThreshold = val;
                    void this.plugin.saveSettings();
                    void updateCount(); // Re-calculate scene counts with new threshold
                    this.checkThresholdWarning(warningEl);
                }
            };

            thresholdInput.addEventListener('change', saveThresholdValue);
            thresholdInput.addEventListener('blur', saveThresholdValue);
            thresholdInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveThresholdValue();
                    thresholdInput.blur();
                }
            });

            // Warning for target < threshold
            const warningEl = controlsCard.createDiv({ cls: 'ert-synopsis-threshold-warning' });
            this.checkThresholdWarning(warningEl);

            // Horizontal rule separator
            controlsCard.createEl('hr', { cls: 'ert-synopsis-control-divider' });

            // Optional write-through to the legacy Synopsis key.
            const synopsisControl = controlsCard.createDiv({ cls: 'ert-synopsis-control ert-synopsis-control--row' });
            let synopsisWordLimit = getSynopsisGenerationWordLimit(this.plugin.settings);
            const synopsisCheckboxId = `ert-synopsis-update-toggle-${Date.now()}`;
            const synopsisInfo = synopsisControl.createDiv({ cls: 'ert-synopsis-control-info' });
            synopsisInfo.createEl('label', {
                text: t('sceneAnalysis.processingModal.controls.alsoUpdateSynopsis'),
                cls: 'ert-synopsis-control-label',
                attr: { for: synopsisCheckboxId }
            });
            const synopsisHelp = synopsisInfo.createDiv({ cls: 'ert-synopsis-control-help' });
            const renderSynopsisHelp = () => {
                synopsisHelp.setText(t('sceneAnalysis.processingModal.controls.alsoUpdateSynopsisHelp', { words: synopsisWordLimit }));
            };
            renderSynopsisHelp();

            const synopsisControls = synopsisControl.createDiv({ cls: 'ert-synopsis-control-right' });
            const synopsisCheckbox = synopsisControls.createEl('input', {
                type: 'checkbox',
                cls: 'ert-synopsis-control-checkbox',
                attr: { id: synopsisCheckboxId }
            });
            synopsisCheckbox.checked = this.plugin.settings.alsoUpdateSynopsis ?? false;
            const synopsisLengthInput = synopsisControls.createEl('input', {
                type: 'number',
                cls: 'ert-synopsis-control-input',
                attr: { min: '10', max: '300', step: '5' }
            });
            synopsisLengthInput.value = String(synopsisWordLimit);

            const saveSynopsisWordLimit = () => {
                const val = parseInt(synopsisLengthInput.value, 10);
                if (!Number.isFinite(val) || val < 10 || val > 300) {
                    new Notice(t('sceneAnalysis.processingModal.controls.synopsisLengthInvalid'));
                    synopsisLengthInput.value = String(getSynopsisGenerationWordLimit(this.plugin.settings));
                    return;
                }
                synopsisWordLimit = Math.round(val);
                this.plugin.settings.synopsisGenerationMaxWords = synopsisWordLimit;
                this.plugin.settings.synopsisHoverMaxLines = getSynopsisHoverLineLimit(this.plugin.settings);
                void this.plugin.saveSettings();
                renderSynopsisHelp();
            };

            synopsisLengthInput.addEventListener('change', saveSynopsisWordLimit);
            synopsisLengthInput.addEventListener('blur', saveSynopsisWordLimit);
            synopsisLengthInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveSynopsisWordLimit();
                    synopsisLengthInput.blur();
                }
            });

            synopsisCheckbox.addEventListener('change', () => {
                this.plugin.settings.alsoUpdateSynopsis = synopsisCheckbox.checked;
                void this.plugin.saveSettings();
            });
        }

        // Mode selection
        const modesSection = contentEl.createDiv({ cls: 'ert-pulse-modes' });

        if (this.taskType === 'synopsis') {
            this.createModeOption(
                modesSection,
                'synopsis-flagged',
                t('sceneAnalysis.processingModal.modeOptions.synopsisFlaggedTitle'),
                t('sceneAnalysis.processingModal.modeOptions.synopsisFlaggedDesc'),
                false
            );
            this.createModeOption(
                modesSection,
                'synopsis-missing',
                t('sceneAnalysis.processingModal.modeOptions.synopsisMissingTitle'),
                t('sceneAnalysis.processingModal.modeOptions.synopsisMissingDesc'),
                false
            );
            this.createModeOption(
                modesSection,
                'synopsis-missing-weak',
                t('sceneAnalysis.processingModal.modeOptions.synopsisMissingWeakTitle'),
                t('sceneAnalysis.processingModal.modeOptions.synopsisMissingWeakDesc', { threshold: this.synopsisWeakThreshold }),
                true
            );
            this.createModeOption(
                modesSection,
                'synopsis-all',
                t('sceneAnalysis.processingModal.modeOptions.synopsisAllTitle'),
                t('sceneAnalysis.processingModal.modeOptions.synopsisAllDesc'),
                false
            );
        } else {
            // Pulse Modes
            this.createModeOption(
                modesSection,
                'open',
                t('sceneAnalysis.processingModal.modeOptions.openTitle'),
                t('sceneAnalysis.processingModal.modeOptions.openDesc'),
                false
            );
            this.createModeOption(
                modesSection,
                'flagged',
                t('sceneAnalysis.processingModal.modeOptions.flaggedTitle'),
                t('sceneAnalysis.processingModal.modeOptions.flaggedDesc'),
                true
            );
            this.createModeOption(
                modesSection,
                'unprocessed',
                t('sceneAnalysis.processingModal.modeOptions.unprocessedTitle'),
                t('sceneAnalysis.processingModal.modeOptions.unprocessedDesc'),
                false
            );
            this.createModeOption(
                modesSection,
                'force-all',
                t('sceneAnalysis.processingModal.modeOptions.forceAllTitle'),
                t('sceneAnalysis.processingModal.modeOptions.forceAllDesc'),
                false
            );
        }

        // Scene count display
        const countSection = contentEl.createDiv({ cls: 'ert-pulse-count ert-glass-card' });
        const countEl = countSection.createDiv({ cls: 'ert-pulse-count-number' });

        // Show loading state initially
        countEl.setText(t('sceneAnalysis.processingModal.count.calculating'));

        const updateCount = async () => {
            countEl.empty();
            countEl.setText(t('sceneAnalysis.processingModal.count.calculating'));

            try {
                const count = await this.getSceneCount(
                    this.selectedMode,
                    this.taskType === 'synopsis' ? this.synopsisWeakThreshold : undefined
                );
                // ~6 seconds per scene (1.5s delay + 3-5s API call) = 0.1 minutes
                const estimatedMinutes = Math.ceil(count * 0.1);
                countEl.empty();

                const countText = countEl.createDiv({ cls: 'ert-pulse-count-text' });
                countText.createSpan({ text: t('sceneAnalysis.processingModal.count.scenesToProcessLabel'), cls: 'ert-pulse-label' });
                countText.createSpan({ text: `${count}`, cls: 'ert-pulse-number' });

                const timeText = countEl.createDiv({ cls: 'ert-pulse-time-text' });
                timeText.createSpan({ text: t('sceneAnalysis.processingModal.count.estimatedTimeLabel'), cls: 'ert-pulse-label' });
                timeText.createSpan({ text: t('sceneAnalysis.processingModal.count.estimatedTimeValue', { minutes: estimatedMinutes }), cls: 'ert-pulse-number' });

                if (count > 50) {
                    const warning = countEl.createDiv({ cls: 'ert-pulse-warning' });
                    warning.setText(t('sceneAnalysis.processingModal.count.largeBatchWarning'));
                }
            } catch (error) {
                countEl.empty();
                countEl.setText(t('sceneAnalysis.processingModal.count.errorCalculating', { error: error instanceof Error ? error.message : String(error) }));
            }
        };

        // Initial count (defer to next frame so modal paints immediately)
        const rafId = window.requestAnimationFrame(() => {
            void updateCount();
        });
        this.pendingRafId = rafId;

        // Update count when mode changes
        // Modal classes don't have registerDomEvent, use addEventListener
        modesSection.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => { void updateCount(); });
        });

        // Action buttons
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.processingModal.buttons.start'))
            .setCta()
            .onClick(async () => {
                try {
                    const count = await this.getSceneCount(
                        this.selectedMode,
                        this.taskType === 'synopsis' ? this.synopsisWeakThreshold : undefined
                    );
                    if (count === 0) {
                        new Notice(t('sceneAnalysis.processingModal.noScenesSelected'));
                        return;
                    }

                    // Extra confirmation for large batches or aggressive modes
                    if (count > 50 || this.selectedMode === 'force-all' || this.selectedMode === 'unprocessed') {
                        const confirmModal = new ConfirmationModal(
                            this.app,
                            t('sceneAnalysis.processingModal.confirmLargeBatch', { count, minutes: Math.ceil(count * 0.1) }),
                            () => {
                                void this.startProcessing();
                            }
                        );
                        confirmModal.open();
                        return;
                    }

                    await this.startProcessing();
                } catch (error) {
                    new Notice(t('sceneAnalysis.processingModal.errorPrefix', { error: error instanceof Error ? error.message : String(error) }));
                }
            });

        // Only show purge button for pulse mode (not synopsis)
        if (this.taskType !== 'synopsis') {
            new ButtonComponent(buttonRow)
                .setButtonText(t('sceneAnalysis.processingModal.buttons.purge'))
                .setDestructive()
                .onClick(async () => {
                    try {
                        // Dynamic import to avoid circular dependency
                        const { purgeBeatsByManuscriptOrder } = await import('../SceneAnalysisCommands');

                        // Close this modal before showing purge confirmation
                        this.close();

                        // Execute purge (it has its own confirmation dialog)
                        await purgeBeatsByManuscriptOrder(this.plugin, this.plugin.app.vault);
                    } catch (error) {
                        new Notice(t('sceneAnalysis.processingModal.errorPrefix', { error: error instanceof Error ? error.message : String(error) }));
                    }
                });
        }

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.processingModal.buttons.cancel'))
            .onClick(() => this.close());
    }

    /**
     * Check if target word count is less than weak threshold and show warning
     */
    private checkThresholdWarning(warningEl: HTMLElement): void {
        if (this.synopsisTargetWords < this.synopsisWeakThreshold) {
            warningEl.textContent = t('sceneAnalysis.processingModal.controls.thresholdWarning', { target: this.synopsisTargetWords, threshold: this.synopsisWeakThreshold });
            warningEl.classList.add('is-visible');
        } else {
            warningEl.classList.remove('is-visible');
        }
    }

    private createModeOption(
        container: HTMLElement,
        mode: ProcessingMode,
        title: string,
        description: string,
        isDefault: boolean
    ): HTMLInputElement {
        const optionEl = container.createDiv({ cls: 'ert-pulse-mode-option' });

        const radioEl = optionEl.createEl('input', {
            type: 'radio',
            attr: { name: 'processing-mode', value: mode }
        });
        radioEl.checked = isDefault;
        if (isDefault) this.selectedMode = mode;

        // Modal classes don't have registerDomEvent, use addEventListener
        radioEl.addEventListener('change', () => {
            if (radioEl.checked) {
                this.selectedMode = mode;
            }
        });

        const labelContainer = optionEl.createDiv({ cls: 'ert-pulse-mode-label' });
        const titleEl = labelContainer.createDiv({ cls: 'ert-pulse-mode-title' });
        titleEl.setText(title);

        const descEl = labelContainer.createDiv({ cls: 'ert-pulse-mode-desc' });
        descEl.setText(description);

        // Make the entire option clickable
        optionEl.addEventListener('click', () => {
            radioEl.checked = true;
            this.selectedMode = mode;
            // Trigger change event to update scene count
            radioEl.dispatchEvent(new Event('change'));
        });

        return radioEl;
    }

    private async startProcessing(): Promise<void> {
        this.isProcessing = true;
        this.abortController = new AbortController();
        this.processedCount = 0;
        this.errorCount = 0;
        this.warningCount = 0;
        this.errorMessages = [];
        this.warningMessages = [];
        this.processedResults = new Map();
        this.processedSynopsisResults = new Map();
        this.hasPendingSynopsisResults = false;
        this.logAttempts = 0;
        this.progressSnapshotText = t('sceneAnalysis.processingModal.progress.initializing');
        this.statusSnapshotText = t('sceneAnalysis.processingModal.progress.initializingPipeline');

        // Notify plugin that processing has started
        this.plugin.activeBeatsModal = this;
        this.plugin.showBeatsStatusBar(0, 0);

        // Switch to progress view
        this.showProgressView();

        try {
            await this.onConfirm(
                this.selectedMode,
                this.taskType === 'synopsis' ? this.synopsisWeakThreshold : undefined,
                this.taskType === 'synopsis' ? this.synopsisTargetWords : undefined
            );

            // Show appropriate summary even if the last/only scene finished after an abort request
            if (this.abortController && this.abortController.signal.aborted) {
                this.showCompletionSummary(t('sceneAnalysis.processingModal.completion.aborted'));
            } else {
                this.showCompletionSummary(this.resolveCompletionStatusMessage());
            }
        } catch (error) {
            if (!this.abortController.signal.aborted) {
                this.addError(t('sceneAnalysis.processingModal.completion.fatalError', { error: error instanceof Error ? error.message : String(error) }));
                this.showCompletionSummary(t('sceneAnalysis.processingModal.completion.stoppedDueToError'));
            } else {
                this.showCompletionSummary(t('sceneAnalysis.processingModal.completion.aborted'));
            }
        } finally {
            this.isProcessing = false;
            this.abortController = null;
            this.plugin.activeBeatsModal = null;
            this.plugin.hideBeatsStatusBar();
        }
    }

    private showProgressView(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        this.ensureModalShell();
        titleEl.setText('');
        this.renderProcessingHero(contentEl, {
            trackStatus: true
        });

        const bodyEl = contentEl.createDiv({ cls: 'ert-pulse-progress-body' });
        const progressCard = bodyEl.createDiv({ cls: 'ert-pulse-progress-card ert-glass-card' });

        const progressContainer = progressCard.createDiv({ cls: 'ert-pulse-progress-container' });
        const progressBg = progressContainer.createDiv({ cls: 'ert-pulse-progress-bg' });
        this.progressBarEl = progressBg.createDiv({ cls: 'ert-pulse-progress-bar' });
        // Start at 0% for smooth animation
        this.progressBarEl.setCssProps({ '--progress-width': '0%' });

        this.progressTextEl = progressCard.createDiv({ cls: 'ert-pulse-progress-text' });
        this.progressTextEl.setText(this.progressSnapshotText);

        this.statusTextEl = progressCard.createDiv({ cls: 'ert-pulse-status-text' });
        this.statusTextEl.setText(this.statusSnapshotText);

        const rulerBlock = progressCard.createDiv({ cls: 'ert-pulse-ruler-block' });
        rulerBlock.createDiv({ cls: 'ert-pulse-ruler-title', text: t('sceneAnalysis.processingModal.queue.title') });
        this.queueScrollEl = rulerBlock.createDiv({ cls: 'ert-pulse-ruler-scroll mod-styled-scrollbar' });
        this.queueTrackEl = this.queueScrollEl.createDiv({ cls: 'ert-pulse-ruler-track' });
        this.queueItems = [];
        this.renderQueueItems();
        this.queueNoteEl = rulerBlock.createDiv({ cls: 'ert-pulse-ruler-note' });
        if (this.taskType === 'synopsis') {
            this.queueNoteEl.setText(t('sceneAnalysis.processingModal.queue.noteSynopsis'));
        } else {
            this.queueNoteEl.setText(t('sceneAnalysis.processingModal.queue.notePulse'));
        }

        const advancedDetails = progressCard.createEl('details', { cls: 'ert-ai-advanced-details' });
        this.aiAdvancedDetailsEl = advancedDetails;
        advancedDetails.createEl('summary', { text: t('sceneAnalysis.processingModal.aiAdvanced.summary') });
        this.aiAdvancedPreEl = advancedDetails.createEl('pre', { cls: 'ert-ai-advanced-pre' });
        this.renderAiAdvancedContext();

        this.errorListEl = bodyEl.createDiv({ cls: 'ert-pulse-error-list ert-glass-card ert-hidden' });

        this.actionButtonContainer = contentEl.createDiv({ cls: 'ert-modal-actions' });
        this.abortButtonEl = new ButtonComponent(this.actionButtonContainer)
            .setButtonText(t('sceneAnalysis.processingModal.buttons.abort'))
            .setDestructive()
            .onClick(() => this.abortProcessing());
    }

    private abortProcessing(): void {
        if (!this.abortController) return;

        const confirmModal = new ConfirmationModal(
            this.app,
            t('sceneAnalysis.processingModal.abort.confirmMessage'),
            () => {
                this.abortController?.abort();
                this.statusSnapshotText = t('sceneAnalysis.processingModal.abort.aborting');
                this.statusTextEl?.setText(t('sceneAnalysis.processingModal.abort.aborting'));
                this.abortButtonEl?.setDisabled(true);
                new Notice(t('sceneAnalysis.processingModal.abort.noticeAbortedByUser'));
            }
        );
        confirmModal.open();
    }

    public setSynopsisPreview(oldSynopsis: string, newSynopsis: string): void {
        if (!this.heroStatusEl) return;

        // Use the hero status area for the preview - single line with inline label
        this.heroStatusEl.empty();
        const previewLine = this.heroStatusEl.createDiv({ cls: 'ert-synopsis-preview-line' });

        // "Previous Summary:" label inline
        previewLine.createSpan({ cls: 'ert-synopsis-preview-label', text: t('sceneAnalysis.processingModal.synopsisPreview.previousLabel') });

        // Old summary in italics (only show if there's a new summary, not during "Generating...")
        if (newSynopsis !== t('sceneAnalysis.processingModal.synopsisPreview.generating')) {
            const oldText = previewLine.createSpan({ cls: 'ert-synopsis-preview-old' });
            oldText.setText(oldSynopsis || t('sceneAnalysis.processingModal.synopsisPreview.noSummary'));
        }
    }

    /**
     * Store Summary (and optional legacy Synopsis) results for the apply phase.
     * Called from Summary refresh processing when generation completes.
     * The modal will show Apply/Discard in the completion summary.
     */
    public setSynopsisResults(summaryResults: Map<string, string>, synopsisResults?: Map<string, string>): void {
        this.processedResults = summaryResults;
        this.processedSynopsisResults = synopsisResults ?? new Map();
        this.hasPendingSynopsisResults = summaryResults.size > 0;
    }

    /**
     * @deprecated Use setSynopsisResults instead - this clears the scene queue which disrupts UX
     */
    public showApplyConfirmation(results: Map<string, string>): void {
        this.processedResults = results;
        const { contentEl, titleEl } = this;
        contentEl.empty();
        this.ensureModalShell();
        titleEl.setText('');

        this.renderProcessingHero(contentEl, {
            subtitle: t('sceneAnalysis.processingModal.apply.review')
        });

        const card = contentEl.createDiv({ cls: 'ert-glass-card ert-apply-card' });
        card.createDiv({
            cls: 'ert-apply-message',
            text: t('sceneAnalysis.processingModal.apply.messageSummary', { count: results.size })
        });

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.processingModal.buttons.applyChanges', { count: results.size }))
            .setCta()
            .onClick(async () => {
                await this.applyChanges();
                this.close();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.processingModal.buttons.discard'))
            .onClick(() => this.close());
    }

    private async applyChanges(): Promise<void> {
        const { processedResults, processedSynopsisResults } = this;
        if (processedResults.size === 0) return;

        const hasSynopsis = processedSynopsisResults.size > 0;
        const note = new Notice(
            hasSynopsis
                ? t('sceneAnalysis.processingModal.apply.applyingUpdatesSynopsis', { count: processedResults.size })
                : t('sceneAnalysis.processingModal.apply.applyingUpdates', { count: processedResults.size }),
            0
        );
        let updated = 0;

        try {
            // Get current model ID for timestamp
            const aiSettings = getCanonicalAiSettings(this.plugin);
            const modelId = resolveConfiguredSelection(aiSettings, {
                feature: this.taskType === 'synopsis' ? 'SummaryRefresh' : 'PulseAnalysis'
            })?.model.id || 'Unknown Model';

            const now = new Date();
            const isoNow = now.toISOString();
            const timestamp = now.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            } as Intl.DateTimeFormatOptions);

            // Ensure aiUpdateTimestamps map exists
            if (!this.plugin.settings.aiUpdateTimestamps) {
                this.plugin.settings.aiUpdateTimestamps = {};
            }

            for (const [path, newSummary] of processedResults.entries()) {
                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                if (file && file instanceof TFile) {
                    await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
                        // Write Summary (primary artifact)
                        fm['Summary'] = newSummary;

                        // Write legacy Synopsis only when the optional pass produced a value.
                        const newSynopsis = processedSynopsisResults.get(path);
                        if (newSynopsis) {
                            fm['Synopsis'] = newSynopsis;
                        }

                        // Normalize update markers onto Summary Update while preserving legacy-key compatibility.
                        const summaryUpdateKeys = ['Summary Update', 'SummaryUpdate', 'summaryupdate'];
                        const legacyKeys = ['Synopsis Update', 'SynopsisUpdate', 'synopsisupdate'];

                        let updatedFlag = false;

                        // Try Summary Update keys first
                        for (const key of summaryUpdateKeys) {
                            if (key in fm) {
                                fm[key] = `${timestamp} by ${modelId}`;
                                updatedFlag = true;
                                break;
                            }
                        }

                        // Fall back to legacy Synopsis Update markers, then migrate to Summary Update.
                        if (!updatedFlag) {
                            for (const key of legacyKeys) {
                                if (key in fm) {
                                    delete fm[key];
                                    fm['Summary Update'] = `${timestamp} by ${modelId}`;
                                    updatedFlag = true;
                                    break;
                                }
                            }
                        }

                        // Create new flag if none existed
                        if (!updatedFlag) {
                            fm['Summary Update'] = `${timestamp} by ${modelId}`;
                        }
                    });

                    // Track internal AI update timestamps
                    const sceneTimestamps = this.plugin.settings.aiUpdateTimestamps[path] ?? {};
                    sceneTimestamps.summaryUpdated = isoNow;
                    if (processedSynopsisResults.has(path)) {
                        sceneTimestamps.synopsisUpdated = isoNow;
                    }
                    this.plugin.settings.aiUpdateTimestamps[path] = sceneTimestamps;

                    updated++;
                }
            }
            new Notice(t('sceneAnalysis.processingModal.apply.successUpdated', { count: updated }));

            // Save settings (includes internal timestamps)
            await this.plugin.saveSettings();

        } catch (e) {
            console.error(e);
            new Notice(t('sceneAnalysis.processingModal.apply.applyError'));
        } finally {
            note.hide();
        }
    }

    public updateProgress(current: number, total: number, sceneName: string): void {
        if (!this.isProcessing) return;

        // Track statistics
        this.processedCount = current;
        this.totalCount = total;

        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

        // Update status bar
        this.plugin.showBeatsStatusBar(current, total);

        if (this.progressBarEl) {
            // Get current progress to avoid backward jumps
            const currentStyle = this.progressBarEl.style.getPropertyValue('--progress-width');
            const currentPercent = parseFloat(currentStyle || '0');

            // Only update if moving forward (prevents animation from jumping backward)
            if (percentage >= currentPercent) {
                // SAFE: inline style used for CSS custom property (--progress-width) to enable smooth progress animation
                this.progressBarEl.style.setProperty('--progress-width', `${percentage}%`);
            }
        }

        if (this.progressTextEl) {
            this.progressSnapshotText = t('sceneAnalysis.processingModal.progress.sceneProgress', { current, total, percentage });
            this.progressTextEl.setText(this.progressSnapshotText);
        }

        if (this.statusTextEl) {
            this.statusSnapshotText = t('sceneAnalysis.processingModal.progress.processingScene', { sceneName });
            this.statusTextEl.setText(this.statusSnapshotText);
        }

        if (this.heroStatusEl && this.taskType !== 'synopsis') {
            this.heroStatusEl.setText(t('sceneAnalysis.processingModal.progress.processingScene', { sceneName }));
        }

        if (!this.queueActiveId && this.queueData.length > 0) {
            this.updateQueueHighlightByIndex(Math.min(current, this.queueData.length - 1));
        }
    }

    /**
     * Estimate how long the LLM call will take based on historical calibration data.
     * Uses actual average call times, NOT content length (API time doesn't scale with scene runtime).
     * Default is 10 seconds - reasonable for most models. Calibrates from actual samples.
     */
    private estimateDuration(_tripletMetric: number): number {
        const stats = this.plugin.settings.pulseTimingStats;

        // Use average of recent actual call times if we have valid samples
        if (stats?.recentSamples && stats.recentSamples.length > 0) {
            const avgCallTime = stats.recentSamples.reduce((a, b) => a + b, 0) / stats.recentSamples.length;
            // Sanity check: if avg < 1 second, these are legacy ratio-based samples - ignore them
            // Real API calls take at least 2-3 seconds even for the fastest models
            if (avgCallTime >= 1) {
                // Cap at 85% to avoid overshooting (animation completes slightly before actual call)
                return avgCallTime * 0.85;
            }
        }

        // Default: 10 seconds per call (reasonable for most API providers)
        return 10 * 0.85;
    }

    /**
     * Start smooth animation of progress bar during API wait.
     * Animates from current position toward estimated completion for this scene.
     */
    public startSceneAnimation(tripletMetric: number, sceneIndex: number, total: number, sceneName: string): void {
        // Clear any existing animation
        this.stopSceneAnimation();

        this.updateQueueHighlightByIndex(sceneIndex);

        const estimatedSeconds = this.estimateDuration(tripletMetric);
        this.currentEstimatedSeconds = estimatedSeconds;

        // Get current progress bar position
        const currentStyle = this.progressBarEl?.style.getPropertyValue('--progress-width');
        const currentPercent = parseFloat(currentStyle || '0');

        // Calculate target: don't go past what this scene's completion would be
        const sceneEndPercent = total > 0 ? ((sceneIndex + 1) / total) * 100 : 100;
        const targetPercent = Math.min(sceneEndPercent * 0.85, 95); // Cap at 95% until actual completion

        // Only animate forward, never backward
        if (currentPercent >= targetPercent) {
            return;
        }

        // Animate in 200ms steps
        const steps = Math.max(1, Math.ceil(estimatedSeconds * 5));
        let step = 0;

        // Update status with estimate
        if (this.statusTextEl) {
            this.statusSnapshotText = t('sceneAnalysis.processingModal.progress.processingSceneEstimate', { sceneName, seconds: Math.ceil(estimatedSeconds) });
            this.statusTextEl.setText(this.statusSnapshotText);
        }

        this.animationIntervalId = this.plugin.registerInterval(window.setInterval(() => { // SAFE: setInterval wrapped with plugin.registerInterval for cleanup
            step++;
            const progress = step / steps;
            // Smooth easing: starts fast, slows down near the end
            const easedProgress = 1 - Math.pow(1 - progress, 2);
            const newPercent = currentPercent + (targetPercent - currentPercent) * easedProgress;

            if (this.progressBarEl) {
                this.progressBarEl.style.setProperty('--progress-width', `${newPercent}%`);
            }

            if (step >= steps) {
                this.stopSceneAnimation();
            }
        }, 200));
    }

    /**
     * Stop any running animation interval.
     */
    private stopSceneAnimation(): void {
        if (this.animationIntervalId !== null) {
            window.clearInterval(this.animationIntervalId);
            this.animationIntervalId = null;
        }
    }

    /**
     * Record actual processing time and update calibration data for future estimates.
     * Stores raw call times (not ratios) since API time doesn't correlate with content length.
     */
    public recordProcessingTime(_tripletMetric: number, actualSeconds: number): void {
        // Stop any running animation
        this.stopSceneAnimation();

        // Only calibrate if we have a meaningful time
        if (actualSeconds <= 0) return;

        // Update running average of actual call times (keep last 10 samples)
        const stats: LlmTimingStats = this.plugin.settings.pulseTimingStats ?? {
            averageTokenPerSec: 0,
            lastJobTokenCount: 0,
            lastJobDurationMs: 0,
            sampleSize: 0,
            recentSamples: [],
            sampleCount: 0
        };

        // Store actual call time directly (not a ratio)
        stats.recentSamples.push(actualSeconds);
        if (stats.recentSamples.length > 10) {
            stats.recentSamples.shift();
        }

        stats.sampleCount++;

        this.plugin.settings.pulseTimingStats = stats;
        // Save in background (don't await to avoid blocking)
        void this.plugin.saveSettings();
    }

    public addError(message: string): void {
        if (!this.errorListEl) return;

        // Track error count
        this.errorCount++;
        const normalizedMessage = message?.trim() || t('sceneAnalysis.processingModal.unknownError');
        const hint = this.deriveErrorHint(normalizedMessage);
        this.errorMessages.push({ message: normalizedMessage, hint: hint ?? undefined });

        // Show error list if it was hidden
        if (this.errorListEl.hasClass('ert-hidden')) {
            this.errorListEl.removeClass('ert-hidden');
            const header = this.errorListEl.createDiv({ cls: 'ert-pulse-error-header' });
            header.setText(this.isProcessing
                ? t('sceneAnalysis.processingModal.completion.issuesContinue')
                : t('sceneAnalysis.processingModal.completion.issuesAfter'));
        }

        const errorItem = this.errorListEl.createDiv({ cls: 'ert-pulse-error-item' });
        errorItem.setText(normalizedMessage);
        if (hint) {
            errorItem.createDiv({ cls: 'ert-pulse-error-hint', text: hint });
        }
    }

    public setTripletInfo(prevNum: string, currentNum: string, nextNum: string, queueId?: string, sceneLabel?: string): void {
        this.setTripletNote(prevNum, currentNum, nextNum);
        if (this.queueData.length > 0) {
            const targetId = queueId ?? this.findQueueIdForScene(currentNum);
            this.updateQueueHighlight(targetId);
        }
        if (sceneLabel) {
            if (this.heroStatusEl) {
                this.heroStatusEl.setText(t('sceneAnalysis.processingModal.progress.processingScene', { sceneName: sceneLabel }));
            }
            if (this.statusTextEl) {
                this.statusSnapshotText = t('sceneAnalysis.processingModal.progress.processingScene', { sceneName: sceneLabel });
                this.statusTextEl.setText(this.statusSnapshotText);
            }
        }
    }

    public setAiAdvancedContext(context: AIRunAdvancedContext | null): void {
        this.aiAdvancedContext = context;
        this.renderAiAdvancedContext();
    }

    private renderAiAdvancedContext(): void {
        if (!this.aiAdvancedPreEl) return;
        if (!this.aiAdvancedContext) {
            this.aiAdvancedPreEl.setText(t('sceneAnalysis.processingModal.aiAdvanced.waiting'));
            return;
        }
        const ctx = this.aiAdvancedContext;
        const availabilityStatus = ctx.availabilityStatus === 'visible'
            ? t('sceneAnalysis.processingModal.aiAdvanced.availabilityVisible')
            : ctx.availabilityStatus === 'not_visible'
                ? t('sceneAnalysis.processingModal.aiAdvanced.availabilityNotVisible')
                : t('sceneAnalysis.processingModal.aiAdvanced.availabilityUnknown');
        const lines = [
            t('sceneAnalysis.processingModal.aiAdvanced.roleTemplate', { name: ctx.roleTemplateName }),
            t('sceneAnalysis.processingModal.aiAdvanced.resolvedModel', { provider: ctx.provider, alias: ctx.modelAlias, label: ctx.modelLabel }),
            t('sceneAnalysis.processingModal.aiAdvanced.modelSelectionReason', { reason: redactSensitiveValue(ctx.modelSelectionReason) }),
            t('sceneAnalysis.processingModal.aiAdvanced.availabilityLabel', { status: availabilityStatus }),
            t('sceneAnalysis.processingModal.aiAdvanced.appliedCaps', { input: ctx.maxInputTokens, output: ctx.maxOutputTokens }),
            typeof ctx.totalInputTokens === 'number'
                ? t('sceneAnalysis.processingModal.aiAdvanced.estimatedInput', { tokens: Math.round(ctx.totalInputTokens).toLocaleString() })
                : '',
            t('sceneAnalysis.processingModal.aiAdvanced.packagingAuto'),
            '',
            t('sceneAnalysis.processingModal.aiAdvanced.finalPrompt'),
            redactSensitiveValue(ctx.finalPrompt || t('sceneAnalysis.processingModal.aiAdvanced.none'))
        ];
        if (typeof ctx.executionPassCount === 'number' && ctx.executionPassCount > 1) {
            lines.splice(6, 0, t('sceneAnalysis.processingModal.aiAdvanced.passCount', { count: ctx.executionPassCount }));
        }
        if (ctx.multiPassTriggerReason) {
            lines.splice(7, 0, t('sceneAnalysis.processingModal.aiAdvanced.multiPassTrigger', { reason: redactSensitiveValue(ctx.multiPassTriggerReason) }));
        }
        this.aiAdvancedPreEl.setText(lines.join('\n'));
    }

    public addWarning(message: string): void {
        if (!this.errorListEl) return;

        // Track warning count (doesn't affect success count)
        this.warningCount++;
        const normalizedMessage = message?.trim() || t('sceneAnalysis.processingModal.warningEncountered');
        this.warningMessages.push(normalizedMessage);

        // Show error list if it was hidden
        if (this.errorListEl.hasClass('ert-hidden')) {
            this.errorListEl.removeClass('ert-hidden');
            const header = this.errorListEl.createDiv({ cls: 'ert-pulse-error-header' });
            header.setText(this.isProcessing
                ? t('sceneAnalysis.processingModal.completion.issuesContinue')
                : t('sceneAnalysis.processingModal.completion.issuesAfter'));
        }

        const warningItem = this.errorListEl.createDiv({ cls: 'ert-pulse-error-item ert-pulse-warning-item' });
        warningItem.setText(message);
    }

    /**
     * The hero line for a run that reached its end without aborting or throwing.
     * "Completed successfully" is only true when nothing failed; a run where
     * every scene errored is a failure, and a mixed run is a partial — the
     * header must not contradict the "N failed" count directly beneath it.
     */
    private resolveCompletionStatusMessage(): string {
        if (this.errorCount === 0) {
            return t('sceneAnalysis.processingModal.completion.successMessage');
        }
        return this.processedCount > 0
            ? t('sceneAnalysis.processingModal.completion.partialMessage')
            : t('sceneAnalysis.processingModal.completion.failedMessage');
    }

    private showCompletionSummary(statusMessage: string): void {
        const { contentEl, titleEl } = this;
        titleEl.setText('');
        this.stopSceneAnimation();

        // Drop the meta pills (model / mode) on completion; that info is already in the header badge.
        contentEl.querySelectorAll('.ert-scene-analysis-meta').forEach(el => el.remove());

        if (this.progressBarEl) {
            this.progressBarEl.setCssProps({ '--progress-width': '100%' });
            this.progressBarEl.removeClass('ert-progress-complete', 'ert-progress-error');
            if (this.errorCount > 0) {
                this.progressBarEl.addClass('ert-progress-error');
            } else {
                this.progressBarEl.addClass('ert-progress-complete');
            }
        }

        const successCount = Math.max(0, this.processedCount);
        const hasErrors = this.errorCount > 0;
        const hasWarnings = this.warningCount > 0;
        const hasIssues = hasErrors || hasWarnings;
        const remainingScenes = Math.max(0, this.totalCount - this.processedCount);

        const progressSummary = this.totalCount > 0
            ? t('sceneAnalysis.processingModal.progress.progressSummary', { success: successCount, total: this.totalCount })
            : (successCount === 1
                ? t('sceneAnalysis.processingModal.progress.progressSummarySingle', { count: successCount })
                : t('sceneAnalysis.processingModal.progress.progressSummaryPlural', { count: successCount }));
        if (this.progressTextEl) {
            this.progressSnapshotText = progressSummary;
            this.progressTextEl.setText(this.progressSnapshotText);
        }

        const statusParts: string[] = [];
        if (hasErrors) statusParts.push(t('sceneAnalysis.processingModal.progress.failedCount', { count: this.errorCount }));
        if (hasWarnings) statusParts.push(t('sceneAnalysis.processingModal.progress.skippedCount', { count: this.warningCount }));

        if (this.statusTextEl) {
            const statusText = statusParts.join(' | ');
            this.statusSnapshotText = statusText;
            this.statusTextEl.setText(this.statusSnapshotText);
            this.statusTextEl.removeClass('ert-error-text', 'ert-warning-text', 'ert-success-text');
            if (statusText) {
                if (hasErrors && successCount === 0) {
                    this.statusTextEl.addClass('ert-error-text');
                } else {
                    this.statusTextEl.addClass('ert-warning-text');
                }
            }
        }

        if (this.heroStatusEl) {
            this.heroStatusEl.setText(statusMessage);
        }

        if (this.errorListEl) {
            this.errorListEl.addClass('ert-hidden');
            this.errorListEl.empty();
        }

        contentEl.querySelectorAll('.ert-pulse-summary').forEach(el => el.remove());
        if (hasIssues) {
            const summaryContainer = contentEl.createDiv({ cls: 'ert-pulse-summary ert-glass-card' });
            summaryContainer.createEl('h3', { text: t('sceneAnalysis.processingModal.completion.processingDetailsHeading'), cls: 'ert-pulse-summary-title' });
            const summaryStats = summaryContainer.createDiv({ cls: 'ert-pulse-summary-stats' });
            if (hasErrors) {
                summaryStats.createDiv({
                    cls: 'ert-pulse-summary-row ert-pulse-summary-error',
                    text: t('sceneAnalysis.processingModal.completion.errorsCount', { count: this.errorCount })
                });
            }
            if (hasWarnings) {
                summaryStats.createDiv({
                    cls: 'ert-pulse-summary-row ert-pulse-summary-warning',
                    text: t('sceneAnalysis.processingModal.completion.warningsCount', { count: this.warningCount })
                });
            }

            if (hasErrors && this.errorMessages.length > 0) {
                const errorDetails = summaryContainer.createDiv({ cls: 'ert-pulse-summary-list' });
                this.errorMessages.forEach(({ message, hint }) => {
                    const item = errorDetails.createDiv({ cls: 'ert-pulse-summary-item ert-pulse-summary-item-error' });
                    item.createSpan({ text: message });
                    if (hint) {
                        item.createDiv({ cls: 'ert-pulse-summary-hint', text: t('sceneAnalysis.processingModal.completion.possibleFix', { hint }) });
                    }
                });
            }

            if (hasWarnings && this.warningMessages.length > 0) {
                const warningDetails = summaryContainer.createDiv({ cls: 'ert-pulse-summary-list' });
                this.warningMessages.forEach((warning) => {
                    const item = warningDetails.createDiv({ cls: 'ert-pulse-summary-item ert-pulse-summary-item-warning' });
                    item.createSpan({ text: warning });
                });
            }
        }

        contentEl.querySelectorAll('.ert-pulse-summary-tip').forEach(el => el.remove());

        // Only Pulse analysis writes detailed interaction logs in this modal flow.
        if (this.plugin.settings.logApiInteractions && this.taskType !== 'synopsis') {
            const logNoteEl = createDiv({ cls: 'ert-pulse-summary-tip' });
            const noteText = this.logAttempts > 0
                ? t('sceneAnalysis.processingModal.completion.logsSaved', { path: resolvePulseContentLogsRoot() })
                : t('sceneAnalysis.processingModal.completion.logsNoRequest');
            logNoteEl.setText(noteText);
            // Place the note inside the progress card, between the queue and the AI Prompt expander.
            if (this.aiAdvancedDetailsEl?.parentElement) {
                this.aiAdvancedDetailsEl.parentElement.insertBefore(logNoteEl, this.aiAdvancedDetailsEl);
            } else {
                contentEl.appendChild(logNoteEl);
            }
        }

        if (this.actionButtonContainer) {
            this.actionButtonContainer.empty();

            // Summary-refresh mode with staged results: show Apply/Discard actions.
            if (this.taskType === 'synopsis' && this.hasPendingSynopsisResults && this.processedResults.size > 0) {
                // Render apply confirmation card above the action row.
                contentEl.querySelectorAll('.ert-synopsis-apply-card').forEach(el => el.remove());
                const applyCard = contentEl.createDiv({ cls: 'ert-glass-card ert-synopsis-apply-card' });
                const hasSynopsisToo = this.processedSynopsisResults.size > 0;
                applyCard.createDiv({
                    cls: 'ert-apply-message',
                    text: hasSynopsisToo
                        ? t('sceneAnalysis.processingModal.apply.messageSummaryAndSynopsis', { count: this.processedResults.size })
                        : t('sceneAnalysis.processingModal.apply.messageSummary', { count: this.processedResults.size })
                });

                // Insert the card before the action buttons
                this.actionButtonContainer.before(applyCard);

                // Update hero subtitle to indicate review phase
                if (this.heroStatusEl) {
                    this.heroStatusEl.setText(t('sceneAnalysis.processingModal.apply.review'));
                }

                new ButtonComponent(this.actionButtonContainer)
                    .setButtonText(t('sceneAnalysis.processingModal.buttons.applyChanges', { count: this.processedResults.size }))
                    .setCta()
                    .onClick(async () => {
                        await this.applyChanges();
                        this.close();
                    });

                new ButtonComponent(this.actionButtonContainer)
                    .setButtonText(t('sceneAnalysis.processingModal.buttons.discard'))
                    .onClick(() => this.close());
            } else {
                // Standard completion: Resume and/or Close buttons
                if (remainingScenes > 0 && (this.resumeCommandId || this.subplotName)) {
                    new ButtonComponent(this.actionButtonContainer)
                        .setButtonText(t('sceneAnalysis.processingModal.buttons.resume', { remaining: remainingScenes }))
                        .setCta()
                        .onClick(async () => {
                            this.close();

                            if (this.subplotName) {
                                const subplotName = this.subplotName;
                                const isEntireSubplot = this.isEntireSubplot;
                                window.setTimeout(() => { void (async () => {
                                    const { processBySubplotNameWithModal, processEntireSubplotWithModal } = await import('../SceneAnalysisCommands');
                                    if (isEntireSubplot) {
                                        await processEntireSubplotWithModal(this.plugin, this.plugin.app.vault, subplotName, true);
                                    } else {
                                        await processBySubplotNameWithModal(this.plugin, this.plugin.app.vault, subplotName);
                                    }
                                })(); }, 100);
                            } else if (this.resumeCommandId) {
                                this.plugin.settings._isResuming = true;
                                await this.plugin.saveSettings();
                                window.setTimeout(() => {
                                    // @ts-ignore - accessing app commands
                                    this.app.commands.executeCommandById(this.resumeCommandId);
                                }, 100);
                            }
                        });
                }

                new ButtonComponent(this.actionButtonContainer)
                    .setButtonText(t('sceneAnalysis.processingModal.buttons.close'))
                    .onClick(() => this.close());
            }
        }
    }

    public isAborted(): boolean {
        return this.abortController?.signal.aborted ?? false;
    }

    public getAbortSignal(): AbortSignal | null {
        return this.abortController?.signal ?? null;
    }

    public noteLogAttempt(): void {
        this.logAttempts++;
    }

    /**
     * Programmatically abort processing (e.g., due to rate limiting)
     * Unlike abortProcessing(), this doesn't show a confirmation dialog
     */
    public abort(): void {
        if (!this.abortController) return;

        this.abortController.abort();
        this.statusSnapshotText = t('sceneAnalysis.processingModal.abort.stoppedDueToError');
        this.statusTextEl?.setText(t('sceneAnalysis.processingModal.abort.stoppedDueToError'));
        this.abortButtonEl?.setDisabled(true);
    }

    private getActiveModelDisplayName(): string {
        const aiSettings = getCanonicalAiSettings(this.plugin);
        const modelId = resolveConfiguredSelection(aiSettings, {
            feature: this.taskType === 'synopsis' ? 'SummaryRefresh' : 'PulseAnalysis'
        })?.model.id || 'unknown-model';
        return getModelDisplayName(modelId);
    }

    private deriveErrorHint(message: string): string | null {
        const normalized = message.toLowerCase();

        if (normalized.includes('temperature') && normalized.includes('default (1)')) {
            return t('sceneAnalysis.processingModal.errorHints.temperatureDefault');
        }

        if (normalized.includes('model') && normalized.includes('not found')) {
            return t('sceneAnalysis.processingModal.errorHints.modelNotFound');
        }

        if (normalized.includes('ollama server not responding') || normalized.includes('could not find ollama')) {
            const backend = LOCAL_LLM_BACKEND_LABELS[getLocalLlmSettings(getCanonicalAiSettings(this.plugin)).backend];
            return t('sceneAnalysis.processingModal.errorHints.ollamaNotResponding', { backend });
        }

        if (normalized.includes('connection refused') || normalized.includes('timed out')) {
            return t('sceneAnalysis.processingModal.errorHints.connectionRefused');
        }

        if (normalized.includes('schema') && normalized.includes('json')) {
            return t('sceneAnalysis.processingModal.errorHints.schemaJson');
        }

        if (normalized.includes('context too long') || normalized.includes('context window') || normalized.includes('too many tokens')) {
            return t('sceneAnalysis.processingModal.errorHints.contextTooLong');
        }

        return null;
    }
}

export default SceneAnalysisProcessingModal;
