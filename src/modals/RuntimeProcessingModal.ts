/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * Runtime Estimation Processing Modal
 */

import { App, ButtonComponent, DropdownComponent, Notice, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type RadialTimelinePlugin from '../main';
import { formatRuntimeValue, getRuntimeSettings } from '../utils/runtimeEstimator';
import { isNonSceneItem } from '../utils/sceneHelpers';
import { ERT_CLASSES } from '../ui/classes';
import type { AIRunAdvancedContext } from '../ai/types';
import { redactSensitiveValue } from '../ai/credentials/redactSensitive';
import { CANONICAL_PROVIDER_LABELS, getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { getLocalLlmSettings } from '../ai/localLlm/settings';
import { t } from '../i18n';

export type RuntimeScope = 'current' | 'subplot' | 'all';
export type RuntimeMode = 'local' | 'ai';

export interface RuntimeProcessResult {
    message?: string;
    localTotalSeconds?: number;
    aiResult?: {
        success: boolean;
        aiSeconds?: number;
        provider?: string;
        modelId?: string;
        rationale?: string;
        error?: string;
    };
}

export interface RuntimeStatusFilters {
    includeTodo: boolean;
    includeWorking: boolean;
    includeComplete: boolean;
}

export interface RuntimeQueueItem {
    path: string;
    title: string;
    subplot?: string;
}

/**
 * Modal for runtime estimation processing
 */
export class RuntimeProcessingModal extends ErtModal {
    private readonly plugin: RadialTimelinePlugin;
    private readonly onProcess: (scope: RuntimeScope, subplotFilter: string | undefined, overrideExisting: boolean, statusFilters: RuntimeStatusFilters, mode: RuntimeMode) => Promise<RuntimeProcessResult | void>;
    private readonly getSceneCount: (scope: RuntimeScope, subplotFilter: string | undefined, overrideExisting: boolean, statusFilters: RuntimeStatusFilters) => Promise<number>;

    private selectedScope: RuntimeScope = 'all';
    private selectedSubplot: string = '';
    private overrideExisting: boolean = false;
    private selectedMode: RuntimeMode = 'local';
    private statusFilters: RuntimeStatusFilters = {
        includeTodo: false,
        includeWorking: true,
        includeComplete: true
    };
    public isProcessing: boolean = false;

    // UI elements
    private scopeDropdown?: DropdownComponent;
    private subplotDropdown?: DropdownComponent;
    private subplotLabelContainer?: HTMLElement;
    private subplotDropdownContainer?: HTMLElement;
    private currentSceneContainer?: HTMLElement;
    private currentSceneNameEl?: HTMLElement;
    private modeDescEl?: HTMLElement;
    private settingsAccordion?: HTMLElement;
    private settingsContent?: HTMLElement;
    private settingsExpanded: boolean = false;
    private countEl?: HTMLElement;
    private progressBarEl?: HTMLElement;
    private progressTextEl?: HTMLElement;
    private statusTextEl?: HTMLElement;
    private runningTotalEl?: HTMLElement;
    private queueContainer?: HTMLElement;
    private actionButton?: ButtonComponent;
    private closeButton?: ButtonComponent;
    private aiAdvancedContext: AIRunAdvancedContext | null = null;
    private aiAdvancedPreEl?: HTMLElement;

    // Subplot data
    private orderedSubplots: { name: string; count: number }[] = [];

    // Processing state
    private processedCount: number = 0;
    private totalCount: number = 0;
    private runningTotalSeconds: number = 0;
    private abortController: AbortController | null = null;

    constructor(
        app: App,
        plugin: RadialTimelinePlugin,
        getSceneCount: (scope: RuntimeScope, subplotFilter: string | undefined, overrideExisting: boolean, statusFilters: RuntimeStatusFilters) => Promise<number>,
        onProcess: (scope: RuntimeScope, subplotFilter: string | undefined, overrideExisting: boolean, statusFilters: RuntimeStatusFilters, mode: RuntimeMode) => Promise<RuntimeProcessResult | void>
    ) {
        super(app);
        this.plugin = plugin;
        this.getSceneCount = getSceneCount;
        this.onProcess = onProcess;
    }

    async onOpen(): Promise<void> {
        const { titleEl } = this;
        titleEl.setText('');
        this.applyShell({
            shellClasses: ['ert-runtime-modal-shell', ERT_CLASSES.SKIN_PRO],
            containerClasses: ['ert-runtime-modal'],
        });

        // Load subplots first
        await this.loadSubplots();

        if (this.isProcessing) {
            this.showProgressView();
        } else {
            await this.showConfirmationView();
        }
    }

    onClose(): void {
        // Allow closing while processing - it continues in background
    }

    close(): void {
        if (this.isProcessing) {
            new Notice(t('sceneAnalysis.runtimeModal.notices.background'));
        }
        super.close();
    }

    private async showConfirmationView(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        // Header
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });

        const contentType = this.plugin.settings.runtimeContentType || 'novel';
        const modeLabel = contentType === 'screenplay'
            ? t('sceneAnalysis.runtimeModal.badgeScreenplay')
            : t('sceneAnalysis.runtimeModal.badgeAudiobook');
        const modeIconName = contentType === 'screenplay' ? 'projector' : 'mic-vocal';
        const badgeRow = header.createDiv({ cls: 'ert-modal-badge-row' });

        const pill = badgeRow.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_PRO}`,
        });
        const pillIcon = pill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(pillIcon, 'signature');
        pill.createSpan({
            cls: ERT_CLASSES.BADGE_PILL_TEXT,
            text: t('sceneAnalysis.runtimeModal.badgePro'),
        });

        const badge = badgeRow.createSpan({ cls: 'ert-modal-badge' });
        const modeIcon = badge.createSpan({ cls: 'ert-modal-badge-icon' });
        setIcon(modeIcon, modeIconName);
        const modeIconSvg = modeIcon.querySelector('svg');
        if (modeIconSvg instanceof SVGElement) {
            modeIconSvg.style.cssText = `
                width: 14px;
                height: 14px;
                stroke: var(--ert-modal-pro-accent, var(--ert-pro-accent-color));
                stroke-width: 2;
                fill: none;
            `;
        }
        badge.appendText(t('sceneAnalysis.runtimeModal.badgeRuntime', { mode: modeLabel }));
        header.createDiv({ cls: 'ert-modal-title', text: t('sceneAnalysis.runtimeModal.title') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('sceneAnalysis.runtimeModal.subtitle') });

        // ===== SCOPE SECTION =====
        const scopeCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });
        const scopeLayout = scopeCard.createDiv({ cls: 'ert-runtime-section-top' });
        const scopeInfo = scopeLayout.createDiv({ cls: 'ert-stack ert-stack-tight' });
        scopeInfo.createEl('h4', { text: t('sceneAnalysis.runtimeModal.sections.scope'), cls: 'ert-section-title' });
        scopeInfo.createDiv({ cls: 'ert-runtime-section-desc', text: t('sceneAnalysis.runtimeModal.sections.scopeDesc') });

        const scopeControls = scopeLayout.createDiv({ cls: 'ert-runtime-scope-controls' });

        // Subplot label row (shown only when subplot scope is selected)
        this.subplotLabelContainer = scopeControls.createDiv({ cls: 'ert-hidden' });
        this.subplotLabelContainer.createEl('label', { text: t('sceneAnalysis.runtimeModal.scope.subplotLabel'), cls: 'ert-runtime-label' });
        
        // Dropdowns row - both dropdowns aligned horizontally
        const scopeRow = scopeControls.createDiv({ cls: 'ert-runtime-scope-row' });
        
        // Scope dropdown
        const scopeDropdownContainer = scopeRow.createDiv({ cls: 'ert-runtime-dropdown-container' });
        this.scopeDropdown = new DropdownComponent(scopeDropdownContainer);
        this.scopeDropdown.selectEl.addClass('ert-input', 'ert-input--md');
        this.scopeDropdown
            .addOption('current', t('sceneAnalysis.runtimeModal.scope.current'))
            .addOption('subplot', t('sceneAnalysis.runtimeModal.scope.subplot'))
            .addOption('all', t('sceneAnalysis.runtimeModal.scope.all'))
            .setValue(this.selectedScope)
            .onChange((value) => {
                this.selectedScope = value as RuntimeScope;
                this.updateScopeVisibility();
                void this.updateCount();
            });

        // Subplot dropdown (disabled when not in subplot scope)
        this.subplotDropdownContainer = scopeRow.createDiv({ cls: 'ert-runtime-dropdown-container ert-runtime-dropdown-disabled' });
        this.subplotDropdown = new DropdownComponent(this.subplotDropdownContainer);
        this.subplotDropdown.selectEl.addClass('ert-input', 'ert-input--lg');
        this.subplotDropdown.setDisabled(true);
        
        // Populate subplot dropdown
        this.orderedSubplots.forEach(sub => {
            this.subplotDropdown?.addOption(sub.name, `${sub.name} (${sub.count})`);
        });
        
        if (this.orderedSubplots.length > 0) {
            this.selectedSubplot = this.orderedSubplots[0].name;
            this.subplotDropdown.setValue(this.selectedSubplot);
        }
        
        this.subplotDropdown.onChange((value) => {
            this.selectedSubplot = value;
            void this.updateCount();
        });

        // Current scene display (always visible, muted when not in current scope)
        this.currentSceneContainer = scopeCard.createDiv({ cls: 'ert-runtime-current-scene' });
        this.currentSceneContainer.createSpan({ text: t('sceneAnalysis.runtimeModal.scope.sceneLabel'), cls: 'ert-runtime-label' });
        this.currentSceneNameEl = this.currentSceneContainer.createSpan({ cls: 'ert-runtime-current-scene-name' });

        // ===== STATUS FILTERS SECTION =====
        const statusCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });
        statusCard.createEl('h4', { text: t('sceneAnalysis.runtimeModal.sections.statusFilter'), cls: 'ert-section-title' });
        statusCard.createDiv({ cls: 'ert-runtime-section-desc', text: t('sceneAnalysis.runtimeModal.sections.statusFilterDesc') });

        const statusRow = statusCard.createDiv({ cls: 'ert-runtime-status-row' });

        this.createStatusCheckbox(statusRow, t('sceneAnalysis.runtimeModal.statusFilter.todo'), 'includeTodo', this.statusFilters.includeTodo);
        this.createStatusCheckbox(statusRow, t('sceneAnalysis.runtimeModal.statusFilter.working'), 'includeWorking', this.statusFilters.includeWorking);
        this.createStatusCheckbox(statusRow, t('sceneAnalysis.runtimeModal.statusFilter.complete'), 'includeComplete', this.statusFilters.includeComplete);

        // ===== OVERRIDE SECTION =====
        const overrideCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });
        overrideCard.createEl('h4', { text: t('sceneAnalysis.runtimeModal.sections.override'), cls: 'ert-section-title' });
        overrideCard.createDiv({ cls: 'ert-runtime-section-desc', text: t('sceneAnalysis.runtimeModal.sections.overrideDesc') });

        const overrideRow = overrideCard.createDiv({ cls: 'ert-runtime-override-row' });

        const checkbox = overrideRow.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.overrideExisting;
        checkbox.addEventListener('change', () => {
            this.overrideExisting = checkbox.checked;
            void this.updateCount();
        });

        const labelContainer = overrideRow.createDiv({ cls: 'ert-runtime-override-label' });
        labelContainer.createSpan({ text: t('sceneAnalysis.runtimeModal.override.recalculate') });
        labelContainer.createDiv({ cls: 'ert-runtime-field-hint', text: t('sceneAnalysis.runtimeModal.override.recalculateHint') });

        // ===== SETTINGS ACCORDION =====
        const settingsCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });

        this.settingsAccordion = settingsCard.createDiv({ cls: 'ert-runtime-accordion-header' });
        const accordionIcon = this.settingsAccordion.createSpan({ cls: 'ert-runtime-accordion-icon' });
        setIcon(accordionIcon, 'chevron-right');
        this.settingsAccordion.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.accordionTitle'), cls: 'ert-runtime-accordion-title' });
        this.settingsAccordion.createSpan({ cls: 'ert-runtime-accordion-hint', text: t('sceneAnalysis.runtimeModal.settings.accordionHint', { mode: modeLabel }) });
        
        this.settingsContent = settingsCard.createDiv({ cls: 'ert-runtime-accordion-content ert-hidden' });
        this.renderSettingsContent();
        
        this.settingsAccordion.addEventListener('click', () => {
            this.settingsExpanded = !this.settingsExpanded;
            if (this.settingsExpanded) {
                this.settingsContent?.removeClass('ert-hidden');
                setIcon(accordionIcon, 'chevron-down');
            } else {
                this.settingsContent?.addClass('ert-hidden');
                setIcon(accordionIcon, 'chevron-right');
            }
        });

        // ===== MODE SELECTION =====
        const modeCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });
        modeCard.createEl('h4', { text: t('sceneAnalysis.runtimeModal.sections.mode'), cls: 'ert-section-title' });
        this.modeDescEl = modeCard.createDiv({ cls: 'ert-runtime-section-desc' });

        const modeRow = modeCard.createDiv({ cls: 'ert-runtime-mode-row' });
        const modeDropdownContainer = modeRow.createDiv({ cls: 'ert-runtime-dropdown-container' });
        const modeDropdown = new DropdownComponent(modeDropdownContainer);
        modeDropdown.selectEl.addClass('ert-input', 'ert-input--md');
        modeDropdown
            .addOption('local', t('sceneAnalysis.runtimeModal.modes.local'))
            .addOption('ai', t('sceneAnalysis.runtimeModal.modes.ai'))
            .setValue(this.selectedMode)
            .onChange((value) => {
                this.selectedMode = value as RuntimeMode;
                this.updateModeDescription();
            });
        
        this.updateModeDescription();

        // ===== SCENE COUNT SECTION =====
        const countCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });
        countCard.createEl('h4', { text: t('sceneAnalysis.runtimeModal.sections.summary'), cls: 'ert-section-title' });
        this.countEl = countCard.createDiv({ cls: 'ert-runtime-count' });
        this.countEl.setText(t('sceneAnalysis.runtimeModal.count.calculating'));

        // Action buttons
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        const settingsBtn = new ButtonComponent(buttonRow)
            .setIcon('settings')
            .setTooltip(t('sceneAnalysis.runtimeModal.buttons.settingsTooltip'))
            .onClick(() => {
                this.close();
                // Set active tab before display() so core tab renders
                this.plugin.settingsTab?.setActiveTab('core');
                // @ts-ignore - Obsidian API
                this.app.setting.open();
                // @ts-ignore - Obsidian API
                this.app.setting.openTabById('radial-timeline');
                // Scroll to runtime after DOM is built
                this.plugin.settingsTab?.revealSettingsSection('core', 'runtime');
            });
        settingsBtn.buttonEl.addClass('ert-modal-settings-btn');

        this.actionButton = new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.runtimeModal.buttons.estimate'))
            .setCta()
            .onClick(async () => {
                await this.startProcessing();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.runtimeModal.buttons.cancel'))
            .onClick(() => this.close());

        // Initial visibility and count
        this.updateScopeVisibility();
        await this.updateCount();
    }

    private createStatusCheckbox(container: HTMLElement, label: string, key: keyof RuntimeStatusFilters, checked: boolean): void {
        const wrapper = container.createDiv({ cls: 'ert-runtime-status-checkbox' });
        const checkbox = wrapper.createEl('input', { type: 'checkbox' });
        checkbox.checked = checked;
        checkbox.addEventListener('change', () => {
            this.statusFilters[key] = checkbox.checked;
            void this.updateCount();
        });
        wrapper.createEl('label', { text: label });
    }

    private renderSettingsContent(): void {
        if (!this.settingsContent) return;
        this.settingsContent.empty();

        const runtimeSettings = getRuntimeSettings(this.plugin.settings, this.plugin.settings.defaultRuntimeProfileId);
        const profiles = this.plugin.settings.runtimeRateProfiles || [];
        const profileLabel = profiles.find(p => p.id === this.plugin.settings.defaultRuntimeProfileId)?.label || 'Default';
        const contentType = runtimeSettings.contentType || 'novel';

        const profileRow = this.settingsContent.createDiv({ cls: 'ert-runtime-setting-row' });
        profileRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.profileLabel'), cls: 'ert-runtime-setting-label' });
        profileRow.createSpan({ text: profileLabel, cls: 'ert-runtime-setting-value' });

        if (contentType === 'screenplay') {
            // Screenplay settings
            const dialogueRow = this.settingsContent.createDiv({ cls: 'ert-runtime-setting-row' });
            dialogueRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.dialogueRateLabel'), cls: 'ert-runtime-setting-label' });
            dialogueRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.wpmValue', { value: runtimeSettings.dialogueWpm || 160 }), cls: 'ert-runtime-setting-value' });

            const actionRow = this.settingsContent.createDiv({ cls: 'ert-runtime-setting-row' });
            actionRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.actionRateLabel'), cls: 'ert-runtime-setting-label' });
            actionRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.wpmValue', { value: runtimeSettings.actionWpm || 100 }), cls: 'ert-runtime-setting-value' });
        } else {
            // Novel settings
            const narrationRow = this.settingsContent.createDiv({ cls: 'ert-runtime-setting-row' });
            narrationRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.narrationRateLabel'), cls: 'ert-runtime-setting-label' });
            narrationRow.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.wpmValue', { value: runtimeSettings.narrationWpm || 150 }), cls: 'ert-runtime-setting-value' });
        }

        // Parenthetical timings (shown for both modes)
        const parentheticalHeader = this.settingsContent.createDiv({ cls: 'ert-runtime-setting-subheader' });
        parentheticalHeader.setText(t('sceneAnalysis.runtimeModal.settings.parentheticalTimingsHeader'));

        const timings = [
            { label: t('sceneAnalysis.runtimeModal.settings.timingBeat'), value: runtimeSettings.beatSeconds || 2 },
            { label: t('sceneAnalysis.runtimeModal.settings.timingPause'), value: runtimeSettings.pauseSeconds || 3 },
            { label: t('sceneAnalysis.runtimeModal.settings.timingLongPause'), value: runtimeSettings.longPauseSeconds || 5 },
            { label: t('sceneAnalysis.runtimeModal.settings.timingMoment'), value: runtimeSettings.momentSeconds || 4 },
            { label: t('sceneAnalysis.runtimeModal.settings.timingSilence'), value: runtimeSettings.silenceSeconds || 5 },
        ];

        timings.forEach(timing => {
            const row = this.settingsContent!.createDiv({ cls: 'ert-runtime-setting-row' });
            row.createSpan({ text: timing.label, cls: 'ert-runtime-setting-label' });
            row.createSpan({ text: t('sceneAnalysis.runtimeModal.settings.secondsValue', { value: timing.value }), cls: 'ert-runtime-setting-value' });
        });

        const hint = this.settingsContent.createDiv({ cls: 'ert-runtime-settings-hint' });
        hint.setText(t('sceneAnalysis.runtimeModal.settings.configHint'));
    }

    private updateScopeVisibility(): void {
        const showSubplot = this.selectedScope === 'subplot';
        const showCurrentScene = this.selectedScope === 'current';
        
        // Show/hide subplot label
        if (this.subplotLabelContainer) {
            if (showSubplot) {
                this.subplotLabelContainer.removeClass('ert-hidden');
            } else {
                this.subplotLabelContainer.addClass('ert-hidden');
            }
        }
        
        // Enable/disable subplot dropdown (always visible, but muted when not applicable)
        if (this.subplotDropdownContainer && this.subplotDropdown) {
            if (showSubplot) {
                this.subplotDropdownContainer.removeClass('ert-runtime-dropdown-disabled');
                this.subplotDropdown.setDisabled(false);
            } else {
                this.subplotDropdownContainer.addClass('ert-runtime-dropdown-disabled');
                this.subplotDropdown.setDisabled(true);
            }
        }
        
        // Show/mute current scene display
        if (this.currentSceneContainer) {
            if (showCurrentScene) {
                this.currentSceneContainer.removeClass('ert-runtime-current-scene-muted');
                this.updateCurrentSceneDisplay();
            } else {
                this.currentSceneContainer.addClass('ert-runtime-current-scene-muted');
            }
        }
    }

    private updateCurrentSceneDisplay(): void {
        if (!this.currentSceneNameEl) return;
        
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile) {
            this.currentSceneNameEl.setText(activeFile.basename);
            this.currentSceneNameEl.removeClass('ert-runtime-no-scene');
        } else {
            this.currentSceneNameEl.setText(t('sceneAnalysis.runtimeModal.scope.noSceneOpen'));
            this.currentSceneNameEl.addClass('ert-runtime-no-scene');
        }
    }

    private updateModeDescription(): void {
        if (!this.modeDescEl) return;

        const providerLabel = this.getProviderLabel();
        
        let description: string;
        
        switch (this.selectedMode) {
            case 'local':
                description = t('sceneAnalysis.runtimeModal.modes.localDesc');
                break;
            case 'ai':
                description = t('sceneAnalysis.runtimeModal.modes.aiDesc', { provider: providerLabel });
                break;
            default:
                description = '';
        }
        
        this.modeDescEl.setText(description);
    }

    private getProviderLabel(): string {
        const aiSettings = getCanonicalAiSettings(this.plugin);
        const selection = resolveConfiguredSelection(aiSettings, { feature: 'RuntimeEstimate' });
        if (!selection) return t('sceneAnalysis.runtimeModal.provider.aiDisabled');
        if (selection.provider === 'ollama') {
            const baseUrl = getLocalLlmSettings(aiSettings).baseUrl || 'localhost';
            return t('sceneAnalysis.runtimeModal.provider.providerLabelLocal', { provider: CANONICAL_PROVIDER_LABELS.ollama, model: selection.model.id, baseUrl });
        }
        return t('sceneAnalysis.runtimeModal.provider.providerLabel', { provider: CANONICAL_PROVIDER_LABELS[selection.provider], model: selection.model.id });
    }

    private async loadSubplots(): Promise<void> {
        try {
            const scenes = await this.plugin.getSceneData();
            const subplotCounts = new Map<string, number>();

            scenes.forEach(scene => {
                if (isNonSceneItem(scene)) return;
                const sub = scene.subplot && scene.subplot.trim() ? scene.subplot : 'Main Plot';
                subplotCounts.set(sub, (subplotCounts.get(sub) || 0) + 1);
            });

            // Sort: Main Plot first, then by count descending, then alphabetically
            this.orderedSubplots = Array.from(subplotCounts.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => {
                    if (a.name === 'Main Plot') return -1;
                    if (b.name === 'Main Plot') return 1;
                    if (a.count !== b.count) return b.count - a.count;
                    return a.name.localeCompare(b.name);
                });

            if (this.orderedSubplots.length > 0 && !this.selectedSubplot) {
                this.selectedSubplot = this.orderedSubplots[0].name;
            }
        } catch (e) {
            console.error('Failed to load subplots', e);
        }
    }

    private async updateCount(): Promise<void> {
        if (!this.countEl) return;

        this.countEl.empty();
        this.countEl.setText(t('sceneAnalysis.runtimeModal.count.calculating'));

        try {
            const subplotFilter = this.selectedScope === 'subplot' ? this.selectedSubplot : undefined;
            const count = await this.getSceneCount(this.selectedScope, subplotFilter, this.overrideExisting, this.statusFilters);

            this.countEl.empty();
            const countText = this.countEl.createDiv({ cls: 'ert-runtime-count-text' });
            countText.createSpan({ text: t('sceneAnalysis.runtimeModal.count.scenesToProcessLabel'), cls: 'ert-runtime-label' });
            countText.createSpan({ text: String(count), cls: 'ert-runtime-number' });

            if (count === 0) {
                const hint = this.countEl.createDiv({ cls: 'ert-runtime-hint' });
                if (this.selectedScope === 'current') {
                    hint.setText(t('sceneAnalysis.runtimeModal.count.hintCurrent'));
                } else if (!this.statusFilters.includeTodo && !this.statusFilters.includeWorking && !this.statusFilters.includeComplete) {
                    hint.setText(t('sceneAnalysis.runtimeModal.count.hintNoStatus'));
                } else if (!this.overrideExisting) {
                    hint.setText(t('sceneAnalysis.runtimeModal.count.hintAlreadyRuntime'));
                }
            }
        } catch (error) {
            this.countEl.setText(t('sceneAnalysis.runtimeModal.count.errorPrefix', { error: error instanceof Error ? error.message : String(error) }));
        }
    }

    private async startProcessing(): Promise<void> {
        this.isProcessing = true;
        this.abortController = new AbortController();
        this.processedCount = 0;
        this.runningTotalSeconds = 0;
        this.aiAdvancedContext = null;

        this.showProgressView();

        try {
            const subplotFilter = this.selectedScope === 'subplot' ? this.selectedSubplot : undefined;
            const result = await this.onProcess(this.selectedScope, subplotFilter, this.overrideExisting, this.statusFilters, this.selectedMode);
            if (result && typeof result === 'object') {
                this.showCompletionSummary(result.message ?? t('sceneAnalysis.runtimeModal.completion.successMessage'), result.aiResult);
            } else {
                this.showCompletionSummary(t('sceneAnalysis.runtimeModal.completion.successMessage'));
            }
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                this.showCompletionSummary(t('sceneAnalysis.runtimeModal.completion.aborted'));
            } else {
                this.showCompletionSummary(t('sceneAnalysis.runtimeModal.completion.errorPrefix', { error: error instanceof Error ? error.message : String(error) }));
            }
        } finally {
            this.isProcessing = false;
            this.abortController = null;
        }
    }

    private showProgressView(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.aiAdvancedPreEl = undefined;

        // Header
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        
        const contentType = this.plugin.settings.runtimeContentType || 'novel';
        const modeLabel = contentType === 'screenplay'
            ? t('sceneAnalysis.runtimeModal.badgeScreenplay')
            : t('sceneAnalysis.runtimeModal.badgeAudiobook');

        header.createSpan({ cls: 'ert-modal-badge', text: t('sceneAnalysis.runtimeModal.badgeRuntimeEstimator', { mode: modeLabel }) });
        header.createDiv({ cls: 'ert-modal-title', text: t('sceneAnalysis.runtimeModal.titleProgress') });
        this.statusTextEl = header.createDiv({ cls: 'ert-modal-subtitle' });
        this.statusTextEl.setText(t('sceneAnalysis.runtimeModal.progress.initializing'));

        // Progress card
        const progressCard = contentEl.createDiv({ cls: 'ert-panel ert-runtime-section' });

        // Progress bar
        const progressContainer = progressCard.createDiv({ cls: 'ert-pulse-progress-container' });
        const progressBg = progressContainer.createDiv({ cls: 'ert-pulse-progress-bg' });
        this.progressBarEl = progressBg.createDiv({ cls: 'ert-pulse-progress-bar' });
        this.progressBarEl.setCssProps({ '--progress-width': '0%' });

        this.progressTextEl = progressCard.createDiv({ cls: 'ert-pulse-progress-text' });
        this.progressTextEl.setText(t('sceneAnalysis.runtimeModal.progress.sceneProgress', { current: 0, total: 0, percentage: 0 }));

        // Running total
        const totalSection = progressCard.createDiv({ cls: 'ert-runtime-running-total' });
        totalSection.createSpan({ text: t('sceneAnalysis.runtimeModal.progress.runningTotalLabel'), cls: 'ert-runtime-label' });
        this.runningTotalEl = totalSection.createSpan({ cls: 'ert-runtime-number' });
        this.runningTotalEl.setText(t('sceneAnalysis.runtimeModal.progress.runningTotalDefault'));

        // Queue container
        this.queueContainer = progressCard.createDiv({ cls: 'ert-runtime-queue' });

        if (this.selectedMode === 'ai') {
            const advancedDetails = progressCard.createEl('details', { cls: 'ert-ai-advanced-details' });
            advancedDetails.createEl('summary', { text: t('sceneAnalysis.runtimeModal.aiAdvanced.summary') });
            this.aiAdvancedPreEl = advancedDetails.createEl('pre', { cls: 'ert-ai-advanced-pre' });
            this.renderAiAdvancedContext();
        }

        // Action buttons
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.runtimeModal.buttons.abort'))
            .setDestructive()
            .onClick(() => {
                this.abortController?.abort();
                new Notice(t('sceneAnalysis.runtimeModal.notices.aborting'));
            });

        this.closeButton = new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.runtimeModal.buttons.close'))
            .setDisabled(true)
            .onClick(() => this.close());
    }

    public updateProgress(current: number, total: number, sceneName: string, sceneRuntimeSeconds: number): void {
        this.processedCount = current;
        this.totalCount = total;
        this.runningTotalSeconds += sceneRuntimeSeconds;

        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

        if (this.progressBarEl) {
            this.progressBarEl.style.setProperty('--progress-width', `${percentage}%`);
        }

        if (this.progressTextEl) {
            this.progressTextEl.setText(t('sceneAnalysis.runtimeModal.progress.sceneProgress', { current, total, percentage }));
        }

        if (this.statusTextEl) {
            this.statusTextEl.setText(t('sceneAnalysis.runtimeModal.progress.processingScene', { sceneName }));
        }

        if (this.runningTotalEl) {
            this.runningTotalEl.setText(formatRuntimeValue(this.runningTotalSeconds));
        }
    }

    public setTotalCount(total: number): void {
        this.totalCount = total;
        if (this.progressTextEl) {
            this.progressTextEl.setText(t('sceneAnalysis.runtimeModal.progress.initialProgress', { total }));
        }
    }

    public setStatusMessage(message: string): void {
        if (this.statusTextEl) {
            this.statusTextEl.setText(message);
        }
    }

    public setAiAdvancedContext(context: AIRunAdvancedContext | null): void {
        this.aiAdvancedContext = context;
        this.renderAiAdvancedContext();
    }

    private renderAiAdvancedContext(): void {
        if (!this.aiAdvancedPreEl) return;
        if (!this.aiAdvancedContext) {
            this.aiAdvancedPreEl.setText(t('sceneAnalysis.runtimeModal.aiAdvanced.waiting'));
            return;
        }
        const ctx = this.aiAdvancedContext;
        const availabilityStatus = ctx.availabilityStatus === 'visible'
            ? t('sceneAnalysis.runtimeModal.aiAdvanced.availabilityVisible')
            : ctx.availabilityStatus === 'not_visible'
                ? t('sceneAnalysis.runtimeModal.aiAdvanced.availabilityNotVisible')
                : t('sceneAnalysis.runtimeModal.aiAdvanced.availabilityUnknown');
        const lines = [
            t('sceneAnalysis.runtimeModal.aiAdvanced.roleTemplate', { name: ctx.roleTemplateName }),
            t('sceneAnalysis.runtimeModal.aiAdvanced.resolvedModel', { provider: ctx.provider, alias: ctx.modelAlias, label: ctx.modelLabel }),
            t('sceneAnalysis.runtimeModal.aiAdvanced.modelSelectionReason', { reason: redactSensitiveValue(ctx.modelSelectionReason) }),
            t('sceneAnalysis.runtimeModal.aiAdvanced.availabilityLabel', { status: availabilityStatus }),
            t('sceneAnalysis.runtimeModal.aiAdvanced.appliedCaps', { input: ctx.maxInputTokens, output: ctx.maxOutputTokens }),
            t('sceneAnalysis.runtimeModal.aiAdvanced.packagingAuto'),
            '',
            t('sceneAnalysis.runtimeModal.aiAdvanced.finalPrompt'),
            redactSensitiveValue(ctx.finalPrompt || t('sceneAnalysis.runtimeModal.aiAdvanced.none'))
        ];
        if (typeof ctx.executionPassCount === 'number' && ctx.executionPassCount > 1) {
            lines.splice(6, 0, t('sceneAnalysis.runtimeModal.aiAdvanced.passCount', { count: ctx.executionPassCount }));
        }
        if (ctx.multiPassTriggerReason) {
            lines.splice(7, 0, t('sceneAnalysis.runtimeModal.aiAdvanced.multiPassTrigger', { reason: redactSensitiveValue(ctx.multiPassTriggerReason) }));
        }
        this.aiAdvancedPreEl.setText(lines.join('\n'));
    }

    public isAborted(): boolean {
        return this.abortController?.signal.aborted ?? false;
    }

    private showCompletionSummary(message: string, aiResult?: RuntimeProcessResult['aiResult']): void {
        if (this.progressBarEl) {
            this.progressBarEl.setCssProps({ '--progress-width': '100%' });
            this.progressBarEl.addClass('ert-progress-complete');
        }

        if (this.statusTextEl) {
            this.statusTextEl.setText(message);
        }

        if (this.progressTextEl) {
            this.progressTextEl.setText(t('sceneAnalysis.runtimeModal.progress.scenesProcessed', { count: this.processedCount }));
        }

        if (this.runningTotalEl) {
            this.runningTotalEl.setText(formatRuntimeValue(this.runningTotalSeconds));
        }

        if (aiResult) {
            const aiSeconds = aiResult.aiSeconds;
            const aiLabel = aiResult.provider ? `${aiResult.provider}${aiResult.modelId ? `/${aiResult.modelId}` : ''}` : 'AI';
            const delta = typeof aiSeconds === 'number' ? aiSeconds - this.runningTotalSeconds : null;
            const deltaText = delta === null ? '' : ` · Δ ${delta >= 0 ? '+' : '-'}${formatRuntimeValue(Math.abs(delta))}`;

            if (this.progressTextEl) {
                const aiRuntime = typeof aiSeconds === 'number' ? formatRuntimeValue(aiSeconds) : '—';
                this.progressTextEl.setText(t('sceneAnalysis.runtimeModal.completion.localAiCompare', { local: formatRuntimeValue(this.runningTotalSeconds), aiLabel, aiRuntime, deltaText }));
            }

            if (this.statusTextEl) {
                if (aiResult.success) {
                    const rationale = aiResult.rationale ? aiResult.rationale.slice(0, 280) : t('sceneAnalysis.runtimeModal.completion.aiEstimateReady');
                    this.statusTextEl.setText(rationale);
                } else {
                    this.statusTextEl.setText(t('sceneAnalysis.runtimeModal.completion.aiErrorPrefix', { error: aiResult.error ?? t('sceneAnalysis.processingModal.unknownError') }));
                }
            }
        }

        if (this.closeButton) {
            this.closeButton.setDisabled(false);
            this.closeButton.setCta();
        }
    }
}

export default RuntimeProcessingModal;
