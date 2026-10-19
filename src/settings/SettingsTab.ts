import { setAccessibleLabel, withAccessibleLabel } from '../utils/domTooltip';
import { App, Component, Notice, PluginSettingTab, setIcon, TextComponent } from 'obsidian';
import { renderGeneralSection } from './sections/GeneralSection';
import { renderCompletionEstimatePreview, renderProgressSection } from './sections/ProgressSection';
import { renderChronologueSection } from './sections/ChronologueSection';
import { renderBackdropSection } from './sections/BackdropSection';
import { renderBeatPropertiesSection } from './sections/BeatPropertiesSection';
import { renderAuthorProgressSection } from './sections/AuthorProgressSection';
import { renderCommunityShareSection } from './sections/CommunityShareSection';
import { renderInquirySection } from './sections/InquirySection';
import { validateProviderKeyQuick } from '../ai/credentials/keyValidation';
import RadialTimelinePlugin from '../main';
import { renderColorsSection } from './sections/ColorsSection';
import { renderConfigurationSection } from './sections/ConfigurationSection';
import { renderAiSection, type AiSectionLifecycle } from './sections/AiSection';
import { renderReleaseNotesSection } from './sections/ReleaseNotesSection';
import { renderPovSection } from './sections/PovSection';
import { renderPlanetaryTimeSection } from './sections/PlanetaryTimeSection';

import { renderRuntimeSection } from './sections/RuntimeSection';
import { renderGoalsSessionsSection } from './sections/GoalsSessionsSection';
import { renderProEntitlementPanel } from './sections/ProEntitlementPanel';
import { renderBonusVaultsSection } from './sections/BonusVaultsSection';
import { getProEntitlement } from './proEntitlement';
import { renderPublishSection } from './sections/PublishSection';
import { FolderSuggest } from './FolderSuggest';
import { t, tCount } from '../i18n';
import { ERT_CLASSES, ERT_DATA } from '../ui/classes';
import {
    getActiveRefactorAlerts,
    getAllNotificationsForHistory,
    applyAlertMigrations,
    cleanupAdvancedTemplate,
    advancedTemplateNeedsCleanup,
    dismissAlert,
    TEMPLATE_HOTFIX_ALERT_ID,
    type RefactorAlert
} from './refactorAlerts';
import { acknowledgeHotfixHistory } from '../utils/pandocBundledLayouts';
import { DEFAULT_SETTINGS } from './defaults';
import { getCredential } from '../ai/credentials/credentials';
import type { AIProviderId } from '../ai/types';
import { getCanonicalAiSettings } from '../ai/runtime/runtimeSelection';
import { getLocalLlmBackend } from '../ai/localLlm/backends';
import { getLocalLlmSettings } from '../ai/localLlm/settings';
import { CORE_ALERTS_SECTION_KEY, type RadialTimelineSettingsTabId } from './settingsAnchors';

export class RadialTimelineSettingsTab extends PluginSettingTab {
    /** Owns the listeners of the panels that read the active book (Progress and status, Story beats system). */
    private _activeBookScope: Component | null = null;

    private disposeActiveBookSections(): void {
        this._activeBookScope?.unload();
        this._activeBookScope = null;
    }

    private resetActiveBookScope(): Component {
        this.disposeActiveBookSections();
        const scope = new Component();
        scope.load();
        this._activeBookScope = scope;
        return scope;
    }

    private releaseNotesComponent: Component | null = null;
    private _aiSectionLifecycle: AiSectionLifecycle | null = null;

    private disposeAiSection(): void {
        this._aiSectionLifecycle?.dispose();
        this._aiSectionLifecycle = null;
    }

    /** Stop settings-owned async work when the plugin itself is reloaded. */
    public disposeAsyncWork(): void {
        this.disposeActiveBookSections();
        this.disposeAiSection();
        this._aiTabActivationHandler = null;
    }

    hide(): void {
        this.disposeAsyncWork();
        this.releaseNotesComponent?.unload();
        this.releaseNotesComponent = null;
        super.hide();
    }

    plugin: RadialTimelinePlugin;
    private _providerSections: { anthropic?: HTMLElement; google?: HTMLElement; openai?: HTMLElement; ollama?: HTMLElement } = {};
    private _keyValidateTimers: Partial<Record<'anthropic' | 'google' | 'openai' | 'ollama', number>> = {};
    private _anthropicKeyInput?: HTMLInputElement;
    private _googleKeyInput?: HTMLInputElement;
    private _openaiKeyInput?: HTMLInputElement;
    private _ollamaBaseUrlInput?: HTMLInputElement;
    private _ollamaModelIdInput?: HTMLInputElement;
    private _aiRelatedElements: HTMLElement[] = [];
    private _aiTabActivationHandler: (() => void) | null = null;
    private _activeTab: RadialTimelineSettingsTabId = 'core';
    private _hasExplicitTabRequest = false;
    private _forceExpandCoreCompletionPreview = false;
    private _pendingSectionRevealTimer: number | null = null;
    private _tabEls: Partial<Record<RadialTimelineSettingsTabId, HTMLElement>> = {};
    private _tabContentEls: Partial<Record<RadialTimelineSettingsTabId, HTMLElement>> = {};
    private _progressStatusStack?: HTMLElement;
    private _beatsWrapper?: HTMLElement;
    private _backdropYamlTarget?: HTMLElement;

    /** Public method to set active tab before/after opening settings */
    public setActiveTab(tab: RadialTimelineSettingsTabId): void {
        this._activeTab = tab;
        this._hasExplicitTabRequest = true;
        this.updateRenderedTabState();
        if (tab === 'ai') this._aiTabActivationHandler?.();
    }

    /**
     * Re-render, in place, the Core panels that read the active book:
     * Progress and status (its title and stage target dates) and the Story
     * beats system (its source folder and adopted beat systems). The plugin
     * calls this whenever the active book changes or its settings are saved,
     * so these panels never show one book while their inputs write to
     * another. No-op when the Core panels aren't displayed.
     */
    public refreshActiveBookSections(): void {
        const progressStack = this._progressStatusStack;
        const beatsWrapper = this._beatsWrapper;
        if (!progressStack?.isConnected || !beatsWrapper?.isConnected) return;
        const scope = this.resetActiveBookScope();
        progressStack.empty();
        this.renderProgressStatus(progressStack, scope);
        beatsWrapper.empty();
        this.renderBeatProperties(beatsWrapper, scope);
    }

    private renderProgressStatus(containerEl: HTMLElement, scope: Component): void {
        this.renderGuarded(t('ui.settingsTab.guardProgress'), containerEl, () => {
            renderProgressSection({ scope, plugin: this.plugin, containerEl });
        });
    }

    private renderBeatProperties(containerEl: HTMLElement, scope: Component): void {
        this.renderGuarded(t('ui.settingsTab.guardStoryProperties'), containerEl, () => {
            renderBeatPropertiesSection({
                scope,
                app: this.app,
                plugin: this.plugin,
                containerEl,
                backdropYamlTargetEl: this._backdropYamlTarget,
            });
            // Story beats, acts and beat YAML read after the scene properties.
            for (const key of ['beats-story', 'beats-acts', 'beats-yaml']) {
                const section = containerEl.querySelector<HTMLElement>(`[${ERT_DATA.SECTION}="${key}"]`);
                if (section) containerEl.appendChild(section);
            }
        });
    }

    public revealSettingsSection(
        tab: RadialTimelineSettingsTabId,
        sectionKey: string,
        options: { force?: boolean } = {}
    ): void {
        this._activeTab = tab;
        this._hasExplicitTabRequest = true;
        this.updateRenderedTabState();
        if (tab === 'ai') this._aiTabActivationHandler?.();
        if (this._pendingSectionRevealTimer !== null) {
            window.clearTimeout(this._pendingSectionRevealTimer);
            this._pendingSectionRevealTimer = null;
        }

        window.requestAnimationFrame(() => {
            const visibleAfterInitialPass = this.scrollToSettingsSection(sectionKey, { force: options.force });
            if (visibleAfterInitialPass && !options.force) return;

            this._pendingSectionRevealTimer = window.setTimeout(() => {
                this._pendingSectionRevealTimer = null;
                this.scrollToSettingsSection(sectionKey, { force: true });
            }, options.force ? 260 : 180);
        });
    }

    public forceExpandCoreCompletionPreview(): void {
        this._forceExpandCoreCompletionPreview = true;
    }

    constructor(app: App, plugin: RadialTimelinePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private attachFolderSuggest(text: TextComponent) {
        const inputEl = text.inputEl;
        new FolderSuggest(this.app, inputEl, this.plugin, text);
    }

    private getSelectedAiProvider(): Exclude<AIProviderId, 'none'> {
        const provider = this.plugin.settings.aiSettings?.provider;
        if (provider === 'anthropic' || provider === 'google' || provider === 'openai' || provider === 'ollama') {
            return provider;
        }
        return 'openai';
    }

    private refreshProviderDimming() {
        const selected = this.getSelectedAiProvider();
        const map = this._providerSections;
        (['anthropic', 'google', 'openai', 'ollama'] as const).forEach(key => {
            const el = map[key];
            if (!el) return;
            const isSelected = key === selected;
            if (isSelected) {
                el.classList.remove('dimmed');
                el.classList.remove('ert-settings-hidden');
                el.classList.add('ert-settings-visible');
            } else {
                el.classList.add('dimmed');
                el.classList.remove('ert-settings-visible');
                el.classList.add('ert-settings-hidden');
            }
            const inputs = el.querySelectorAll('input, textarea, button, select');
            inputs.forEach(input => {
                if (isSelected) input.removeAttribute('disabled');
                else input.setAttribute('disabled', 'true');
            });
            const clickableIcons = el.querySelectorAll('.clickable-icon');
            clickableIcons.forEach(icon => {
                const htmlIcon = icon as HTMLElement;
                if (isSelected) {
                    htmlIcon.removeAttribute('aria-disabled');
                    htmlIcon.classList.remove('ert-pointer-events-none');
                } else {
                    htmlIcon.setAttribute('aria-disabled', 'true');
                    htmlIcon.classList.add('ert-pointer-events-none');
                }
            });
        });
    }

    private toggleAiSettingsVisibility(show: boolean) {
        this._aiRelatedElements.forEach(el => {
            if (show) {
                el.classList.remove('ert-settings-hidden');
                el.classList.add('ert-settings-visible');
            } else {
                el.classList.remove('ert-settings-visible');
                el.classList.add('ert-settings-hidden');
            }
        });
    }

    /**
     * Auto-migrate templates to latest structure.
     * - Updates base template to current defaults (field order/names)
     * - Cleans up advanced template by removing base fields
     * Shows notification for user to dismiss after reading.
     */
    private autoMigrateAdvancedTemplate(): void {
        const defaultBase = DEFAULT_SETTINGS.sceneYamlTemplates!.base;
        const currentBase = this.plugin.settings.sceneYamlTemplates?.base ?? '';
        const currentAdvanced = this.plugin.settings.sceneYamlTemplates?.advanced ?? '';
        
        let needsSave = false;
        
        // Update base template to current defaults (ensures field order/names are current)
        if (currentBase !== defaultBase) {
            if (!this.plugin.settings.sceneYamlTemplates) {
                this.plugin.settings.sceneYamlTemplates = { base: '', advanced: '' };
            }
            this.plugin.settings.sceneYamlTemplates.base = defaultBase;
            needsSave = true;
        }
        
        // Clean up advanced template if it has legacy base fields
        if (currentAdvanced && advancedTemplateNeedsCleanup(currentAdvanced)) {
            const cleaned = cleanupAdvancedTemplate(currentAdvanced);
            if (!this.plugin.settings.sceneYamlTemplates) {
                this.plugin.settings.sceneYamlTemplates = { base: defaultBase, advanced: '' };
            }
            this.plugin.settings.sceneYamlTemplates.advanced = cleaned;
            needsSave = true;
        }
        
        if (needsSave) {
            void this.plugin.saveSettings();
            // Notification appears in the alerts panel - user can dismiss after reading
        }
    }

    private updateRenderedTabState(): void {
        const tabEntries = Object.entries(this._tabEls) as Array<[RadialTimelineSettingsTabId, HTMLElement | undefined]>;
        const contentEntries = Object.entries(this._tabContentEls) as Array<[RadialTimelineSettingsTabId, HTMLElement | undefined]>;

        tabEntries.forEach(([tab, el]) => {
            el?.toggleClass('ert-settings-tab-active', this._activeTab === tab);
        });
        contentEntries.forEach(([tab, el]) => {
            el?.toggleClass('ert-hidden', this._activeTab !== tab);
        });
    }

    private async scheduleKeyValidation(provider: 'anthropic' | 'google' | 'openai' | 'ollama') {
        const prior = this._keyValidateTimers[provider];
        if (prior) window.clearTimeout(prior);

        if (provider === 'ollama') {
            const selectedProvider = this.getSelectedAiProvider();
            if (selectedProvider !== 'ollama') return;
            const baseInput = this._ollamaBaseUrlInput;
            const modelInput = this._ollamaModelIdInput;
            if (!baseInput || !modelInput) return;
            const baseUrl = baseInput.value?.trim();
            const modelId = modelInput.value?.trim();
            if (!baseUrl || !modelId) return;

            this._keyValidateTimers[provider] = window.setTimeout(() => { void (async () => {
                delete this._keyValidateTimers[provider];
                [baseInput, modelInput].forEach(el => {
                    el.removeClass('ert-setting-input-success');
                    el.removeClass('ert-setting-input-error');
                });
                const aiSettings = getCanonicalAiSettings(this.plugin);
                const localLlm = getLocalLlmSettings(aiSettings);
                const backend = getLocalLlmBackend(localLlm.backend);
                const apiKey = await getCredential(this.plugin, 'ollama');
                let reachable = false;
                let hasModel = false;
                try {
                    const models = await backend.listModels({
                        baseUrl,
                        timeoutMs: localLlm.timeoutMs,
                        apiKey
                    });
                    reachable = true;
                    hasModel = models.some(model => model.id === modelId);
                } catch {
                    reachable = false;
                }
                if (reachable && hasModel) {
                    [baseInput, modelInput].forEach(el => {
                        el.addClass('ert-setting-input-success');
                        window.setTimeout(() => el.removeClass('ert-setting-input-success'), 1200);
                    });
                } else {
                    [baseInput, modelInput].forEach(el => {
                        el.addClass('ert-setting-input-error');
                        window.setTimeout(() => el.removeClass('ert-setting-input-error'), 1400);
                    });
                }
            })(); }, 800);
            return;
        }

        const inputEl = provider === 'anthropic' ? this._anthropicKeyInput
            : provider === 'google' ? this._googleKeyInput
                : this._openaiKeyInput;
        if (!inputEl) return;

        const key = await getCredential(this.plugin, provider);
        if (!key || key.length < 8) return;

        this._keyValidateTimers[provider] = window.setTimeout(() => { void (async () => {
            delete this._keyValidateTimers[provider];
            inputEl.removeClass('ert-setting-input-success');
            inputEl.removeClass('ert-setting-input-error');

            const validation = await validateProviderKeyQuick(provider, key);
            if (validation.state === 'ready') {
                inputEl.addClass('ert-setting-input-success');
                window.setTimeout(() => inputEl.removeClass('ert-setting-input-success'), 1200);
            } else if (validation.state === 'rejected') {
                inputEl.addClass('ert-setting-input-error');
                window.setTimeout(() => inputEl.removeClass('ert-setting-input-error'), 1400);
            }
        })(); }, 800);
    }

    /**
     * Render refactor alerts at the top of Core settings.
     * Shows a persistent notification panel that can be collapsed/expanded.
     * Active alerts are shown with full interaction; dismissed alerts shown in history.
     */
    private renderRefactorAlerts(containerEl: HTMLElement): void {
        const activeAlerts = getActiveRefactorAlerts(this.plugin.settings);
        const historyAlerts = getAllNotificationsForHistory(this.plugin.settings);
        const hasActive = activeAlerts.length > 0;
        const hasHistory = historyAlerts.length > 0;

        // Don't render anything if no alerts exist at all
        if (!hasActive && !hasHistory) return;

        // Create the notification panel wrapper
        const panelEl = containerEl.createDiv({
            cls: ['ert-notification-panel', hasActive ? 'ert-notification-panel--active' : 'ert-notification-panel--muted']
        });

        if (hasActive) {
            // Sort active alerts by severity (critical first, then warning, then info)
            const sortedAlerts = [...activeAlerts].sort((a, b) => {
                const severityOrder = { critical: 0, warning: 1, info: 2 };
                return severityOrder[a.severity] - severityOrder[b.severity];
            });

            // Render each active alert
            for (const alert of sortedAlerts) {
                this.renderActiveAlert(panelEl, alert);
            }

            // If there's also history, add a separator and collapsed history section
            if (hasHistory) {
                this.renderHistorySection(panelEl, historyAlerts, false);
            }
        } else {
            // No active alerts - show collapsed stub with history
            this.renderHistorySection(panelEl, historyAlerts, true);
        }
    }

    /**
     * Render a single active (actionable) alert
     */
    private renderActiveAlert(containerEl: HTMLElement, alert: RefactorAlert): void {
        const alertEl = containerEl.createDiv({
            cls: ['ert-refactor-alert', `ert-refactor-alert--${alert.severity}`],
            attr: { 'data-alert-id': alert.id }
        });

        // Left side: Icon + Content
        const contentSide = alertEl.createDiv({ cls: 'ert-refactor-alert__content' });

        const heading = contentSide.createDiv({ cls: 'ert-refactor-alert__heading' });
        const iconWrapper = heading.createDiv({ cls: 'ert-refactor-alert__icon' });
        setIcon(iconWrapper, alert.icon);
        heading.createSpan({ text: alert.title, cls: 'ert-refactor-alert__title' });

        const description = contentSide.createDiv({ cls: 'ert-refactor-alert__description' });
        description.setText(alert.description);

        // Reassurance text inside alert - for migration and cleanup alerts
        if (alert.migrations?.length || alert.id === 'advanced-template-cleanup-v7') {
            const reassurance = contentSide.createDiv({ cls: 'ert-refactor-alert__reassurance' });
            reassurance.setText(t('ui.settingsTab.alertReassurance'));
        }

        // Right side: Action buttons (stacked vertically)
        const actionSide = alertEl.createDiv({ cls: 'ert-refactor-alert__actions' });

        // Dismiss button (X) - only for non-critical alerts
        if (alert.severity !== 'critical') {
            const dismissBtn = withAccessibleLabel(actionSide.createEl('button', {
                cls: 'ert-iconBtn ert-refactor-alert__btn--dismiss',
            }), t('ui.settingsTab.dismissAlert'));
            setIcon(dismissBtn, 'x');
            this.plugin.registerDomEvent(dismissBtn, 'click', async () => {
                if (alert.id === TEMPLATE_HOTFIX_ALERT_ID) {
                    // Synthetic alert is generated from templateHotfixHistory.
                    // Acknowledge entries instead of pushing to dismissedAlerts so
                    // the alert can re-appear after a future hotfix.
                    this.plugin.settings.templateHotfixHistory = acknowledgeHotfixHistory(
                        this.plugin.settings.templateHotfixHistory
                    );
                } else {
                    dismissAlert(alert.id, this.plugin.settings);
                }
                await this.plugin.saveSettings();

                // Re-render the entire alerts section
                const panelParent = alertEl.closest('.ert-notification-panel')?.parentElement;
                if (panelParent) {
                    panelParent.empty();
                    this.renderRefactorAlerts(panelParent);
                }
            });
        }

        // Auto Update button - for migration alerts
        if (alert.migrations?.length) {
            const autoUpdateBtn = withAccessibleLabel(actionSide.createEl('button', {
                cls: 'ert-iconBtn ert-refactor-alert__btn--update',
            }), t('ui.settingsTab.applyUpdate'));
            setIcon(autoUpdateBtn, 'check');
            this.plugin.registerDomEvent(autoUpdateBtn, 'click', async () => {
                const template = this.plugin.settings.sceneYamlTemplates?.advanced ?? '';
                const updated = applyAlertMigrations(alert, template);
                const migrationMap = new Map((alert.migrations ?? []).map(migration => [migration.oldKey, migration.newKey]));

                if (!this.plugin.settings.sceneYamlTemplates) {
                    this.plugin.settings.sceneYamlTemplates = { base: '', advanced: '' };
                }
                this.plugin.settings.sceneYamlTemplates.advanced = updated;
                if (migrationMap.size && Array.isArray(this.plugin.settings.hoverMetadataFields)) {
                    this.plugin.settings.hoverMetadataFields = this.plugin.settings.hoverMetadataFields.map(field => {
                        const nextKey = migrationMap.get(field.key);
                        if (!nextKey) return field;
                        return {
                            ...field,
                            key: nextKey,
                            label: field.label === field.key ? nextKey : field.label,
                        };
                    });
                }

                dismissAlert(alert.id, this.plugin.settings);
                await this.plugin.saveSettings();

                // Re-render the entire alerts section
                const panelParent = alertEl.closest('.ert-notification-panel')?.parentElement;
                if (panelParent) {
                    panelParent.empty();
                    this.renderRefactorAlerts(panelParent);
                }
                new Notice(t('ui.settingsTab.templateUpdatedNotice'));
            });

            // View YAML button (↓)
            {
                const viewBtn = withAccessibleLabel(actionSide.createEl('button', {
                    cls: 'ert-iconBtn ert-refactor-alert__btn--view',
                }), t('ui.settingsTab.viewInYamlEditor'));
                setIcon(viewBtn, 'chevron-down');
                this.plugin.registerDomEvent(viewBtn, 'click', async () => {
                    // Enable advanced YAML editor if not already
                    this.plugin.settings.enableAdvancedYamlEditor = true;
                    await this.plugin.saveSettings();

                    // Small delay to let the editor expand, then scroll to the migration row or advanced card
                    window.setTimeout(() => {
                        // Try to scroll to the specific migration row first
                        const migrationRow = viewBtn.ownerDocument.querySelector('.ert-yaml-row--needs-migration');
                        if (migrationRow) {
                            migrationRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }
                        // Fallback: scroll to the advanced template card
                        const advancedCard = viewBtn.ownerDocument.querySelector('.ert-advanced-template-card');
                        if (advancedCard) {
                            advancedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }, 100);
                });
            }
        }
    }

    /**
     * Render the notification history section (collapsed or expanded)
     */
    private renderHistorySection(containerEl: HTMLElement, alerts: RefactorAlert[], startCollapsed: boolean): void {
        const historyWrapper = containerEl.createDiv({
            cls: ['ert-notification-history', startCollapsed ? 'ert-notification-history--collapsed' : '']
        });

        // Header row (always visible) - clickable to toggle
        const headerRow = historyWrapper.createDiv({ cls: 'ert-notification-history__header' });

        const toggleBtn = withAccessibleLabel(headerRow.createEl('button', {
            cls: 'ert-iconBtn ert-notification-history__toggle',
        }), t('ui.settingsTab.toggleHistory'));
        setIcon(toggleBtn, startCollapsed ? 'chevron-right' : 'chevron-down');

        const headerText = headerRow.createSpan({
            cls: 'ert-notification-history__label',
            text: t('ui.settingsTab.notificationsProcessed', { notifications: tCount('notification', alerts.length) })
        });

        // Content area (collapsible)
        const contentArea = historyWrapper.createDiv({ cls: 'ert-notification-history__content' });

        // Render each history item
        for (const alert of alerts) {
            this.renderHistoryItem(contentArea, alert);
        }

        // Toggle behavior
        const toggle = () => {
            const isCollapsed = historyWrapper.hasClass('ert-notification-history--collapsed');
            historyWrapper.toggleClass('ert-notification-history--collapsed', !isCollapsed);
            setIcon(toggleBtn, isCollapsed ? 'chevron-down' : 'chevron-right');
        };

        this.plugin.registerDomEvent(toggleBtn, 'click', toggle);
        this.plugin.registerDomEvent(headerText, 'click', toggle);
    }

    /**
     * Render a single history item (dismissed notification with checkmark)
     */
    private renderHistoryItem(containerEl: HTMLElement, alert: RefactorAlert): void {
        const itemEl = containerEl.createDiv({
            cls: ['ert-notification-history__item', `ert-notification-history__item--${alert.severity}`]
        });

        // Checkmark icon
        const checkIcon = itemEl.createDiv({ cls: 'ert-notification-history__check' });
        setIcon(checkIcon, 'check-circle-2');

        // Alert info
        const infoEl = itemEl.createDiv({ cls: 'ert-notification-history__info' });
        infoEl.createSpan({ text: alert.title, cls: 'ert-notification-history__title' });
        infoEl.createSpan({ text: alert.description, cls: 'ert-notification-history__description' });
    }

    private applyElementBlockLayout(containerEl: HTMLElement): void {
        const settingItems = containerEl.querySelectorAll('.ert-settings-searchable-content .setting-item');
        settingItems.forEach(settingEl => {
            const el = settingEl as HTMLElement;
            // Settings headings must use native Obsidian setting-item-heading markup.
            // Do not convert headers at runtime.
            if (el.classList.contains('setting-item-heading')) return;
            if (el.closest('.ert-color-grid-controls')) return;
            if (el.classList.contains('mod-toggle')) {
                el.classList.remove(ERT_CLASSES.ELEMENT_BLOCK, 'ert-settingRow');
                return;
            }
            if (el.classList.contains(ERT_CLASSES.ELEMENT_BLOCK_SKIP)) return;
            if (el.classList.contains(ERT_CLASSES.ROW)) return;
        });
    }

    private renderSettingsHero(
        containerEl: HTMLElement,
        options: {
            badgeLabel: string;
            badgeIcon: string;
            badgeVariant?: string;
            wikiHref: string;
            title: string;
            subtitle: string;
            helperLine?: string;
            kicker?: string;
            features?: { icon: string; text: string; targetSection?: string }[];
        }
    ): void {
        const hero = containerEl.createDiv({
            cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.CARD_HERO} ${ERT_CLASSES.STACK}`
        });
        const badgeRow = hero.createDiv({ cls: ERT_CLASSES.INLINE });
        const badgeClasses = options.badgeVariant ?
            `${ERT_CLASSES.BADGE_PILL} ${options.badgeVariant}` :
            ERT_CLASSES.BADGE_PILL;
        const badge = badgeRow.createSpan({ cls: badgeClasses });
        const badgeIcon = badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(badgeIcon, options.badgeIcon);
        badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: options.badgeLabel });
        // Place wiki link inline with the badge label, not far right
        const wikiLink = withAccessibleLabel(badge.createEl('a', {
            href: options.wikiHref,
            cls: ERT_CLASSES.BADGE_PILL_WIKI,
            attr: { 'target': '_blank', 'rel': 'noopener' }
        }), t('ui.settingsTab.wikiAria'));
        setIcon(wikiLink, 'external-link');

        // Wrap hero title in a title row for inline/legacy layout
        const titleRow = hero.createDiv({ cls: 'ert-hero-titleRow' });
        titleRow.createDiv({
            cls: `${ERT_CLASSES.SECTION_TITLE} ert-hero-title`,
            text: options.title
        });
        hero.createEl('p', {
            cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle`,
            text: options.subtitle
        });
        if (options.helperLine) {
            hero.createEl('p', {
                cls: ERT_CLASSES.FIELD_NOTE,
                text: options.helperLine
            });
        }
        const features = options.features || [];
        if (features.length > 0 && options.kicker) {
            const featuresSection = hero.createDiv({
                cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
            });
            featuresSection.createDiv({ text: options.kicker, cls: 'ert-kicker' });
            const featuresList = featuresSection.createEl('ul', { cls: ERT_CLASSES.STACK });
            features.forEach(feature => {
                const li = featuresList.createEl('li', {
                    cls: `${ERT_CLASSES.INLINE} ert-feature-item${feature.targetSection ? ' ert-feature-item--link' : ''}`
                });
                const iconSpan = li.createSpan({ cls: 'ert-feature-icon' });
                setIcon(iconSpan, feature.icon);
                li.createSpan({ text: feature.text });
                if (feature.targetSection) {
                    li.setAttr('role', 'button');
                    li.setAttr('tabindex', '0');
                    setAccessibleLabel(li, t('ui.settingsTab.jumpToAria', { section: feature.text }));
                    this.plugin.registerDomEvent(li, 'click', () => this.scrollToSettingsSection(feature.targetSection!));
                    this.plugin.registerDomEvent(li, 'keydown', (evt: KeyboardEvent) => {
                        if (evt.key !== 'Enter' && evt.key !== ' ') return;
                        evt.preventDefault();
                        this.scrollToSettingsSection(feature.targetSection!);
                    });
                }
            });
        }
    }

    private findSettingsScrollHost(target: HTMLElement): HTMLElement | null {
        const host = target.closest<HTMLElement>('.vertical-tab-content, .ert-settings-tab-content');
        return host instanceof HTMLElement ? host : null;
    }

    private isSectionVisibleWithinHost(target: HTMLElement, host: HTMLElement): boolean {
        const hostRect = host.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        return targetRect.top >= hostRect.top + 8 && targetRect.bottom <= hostRect.bottom - 8;
    }

    private markSettingsSectionRevealed(target: HTMLElement): void {
        target.addClass('ert-settings-section--revealed');
        if (!target.hasAttribute('tabindex')) {
            target.setAttr('tabindex', '-1');
        }
        try {
            target.focus({ preventScroll: true });
        } catch {
            // Focus is a non-critical affordance; scrolling already completed.
        }
        window.setTimeout(() => {
            target.removeClass('ert-settings-section--revealed');
        }, 1600);
    }

    private scrollToSettingsSection(sectionKey: string, options: { force?: boolean } = {}): boolean {
        const target = this.containerEl.querySelector<HTMLElement>(`[${ERT_DATA.SECTION}="${sectionKey}"]`);
        if (!target) return false;
        const host = this.findSettingsScrollHost(target);
        if (!options.force && host && this.isSectionVisibleWithinHost(target, host)) {
            this.markSettingsSectionRevealed(target);
            return true;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.markSettingsSectionRevealed(target);
        return true;
    }

    private renderPublishingHero(containerEl: HTMLElement): void {
        this.renderSettingsHero(containerEl, {
            badgeLabel: t('ui.settingsTab.publishBadge'),
            badgeIcon: 'book-open-text',
            badgeVariant: ERT_CLASSES.BADGE_PILL_PRO,
            wikiHref: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Publishing',
            title: t('ui.settingsTab.publishTitle'),
            subtitle: t('ui.settingsTab.publishSubtitle'),
            helperLine: t('ui.settingsTab.publishHelper'),
            kicker: t('ui.settingsTab.publishKicker'),
            features: [
                { icon: 'layout-template', text: t('ui.settingsTab.publishFeatureStyle') },
                { icon: 'file-output', text: t('ui.settingsTab.publishFeatureExport') },
                { icon: 'file-text', text: t('ui.settingsTab.publishFeatureDetails') },
                { icon: 'book-open-text', text: t('ui.settingsTab.publishFeaturePages') }
            ]
        });
    }

    private renderAdvancedHero(containerEl: HTMLElement): void {
        this.renderSettingsHero(containerEl, {
            badgeLabel: t('ui.settingsTab.advancedBadge'),
            badgeIcon: 'pyramid',
            badgeVariant: ERT_CLASSES.BADGE_PILL_NEUTRAL,
            wikiHref: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Settings-Advanced#configuration',
            title: t('ui.settingsTab.advancedTitle'),
            subtitle: t('ui.settingsTab.advancedSubtitle'),
            kicker: t('ui.settingsTab.advancedKicker'),
            features: [
                { icon: 'monitor', text: t('ui.settingsTab.advancedFeatureDisplay') },
                { icon: 'folder-cog', text: t('ui.settingsTab.advancedFeatureLogs') },
                { icon: 'waypoints', text: t('ui.settingsTab.advancedFeatureMetadata') },
            ]
        });
    }

    private renderInquiryHero(containerEl: HTMLElement): void {
        this.renderSettingsHero(containerEl, {
            badgeLabel: t('ui.settingsTab.inquiryBadge'),
            badgeIcon: 'ri-logo',
            badgeVariant: ERT_CLASSES.BADGE_PILL_NEUTRAL,
            wikiHref: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Settings-Inquiry',
            title: t('ui.settingsTab.inquiryTitle'),
            subtitle: t('ui.settingsTab.inquirySubtitle'),
            helperLine: t('ui.settingsTab.inquiryHelper'),
            kicker: t('ui.settingsTab.inquiryKicker'),
            features: [
                { icon: 'search', text: t('ui.settingsTab.inquiryFeatureScans') },
                { icon: 'list', text: t('ui.settingsTab.inquiryFeaturePrompts') },
                { icon: 'layout-grid', text: t('ui.settingsTab.inquiryFeatureCorpus') },
            ]
        });
    }

    private renderCoreHero(containerEl: HTMLElement): void {
        this.renderSettingsHero(containerEl, {
            badgeLabel: t('ui.settingsTab.coreBadge'),
            badgeIcon: 'settings',
            badgeVariant: ERT_CLASSES.BADGE_PILL_NEUTRAL,
            wikiHref: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Settings-Core',
            title: t('ui.settingsTab.coreTitle'),
            subtitle: t('ui.settingsTab.coreSubtitle'),
            kicker: t('ui.settingsTab.coreKicker'),
            features: [
                { icon: 'layout-grid', text: t('ui.settingsTab.coreFeatureStructure') },
                { icon: 'orbit', text: t('ui.settingsTab.coreFeatureChronologue') },
                { icon: 'timer', text: t('ui.settingsTab.coreFeatureSessions') },
            ]
        });
    }

    private renderCoreQuickLinks(containerEl: HTMLElement, links: Array<{ label: string; section: string }>): void {
        // Links name sections by key, not element: the active-book panels re-render in place.
        const findSection = (key: string) => this.containerEl.querySelector<HTMLElement>(`[${ERT_DATA.SECTION}="${key}"]`);
        const valid = links.filter(link => findSection(link.section) !== null);
        if (!valid.length) return;

        const root = containerEl.createDiv({ cls: 'ert-coreQuickLinks' });

        root.createSpan({ cls: 'ert-coreQuickLinks__label', text: t('ui.settingsTab.quickLinksLabel') });
        valid.forEach(({ label: text, section }) => {
            const button = root.createEl('button', {
                cls: `${ERT_CLASSES.PILL_BTN} ${ERT_CLASSES.PILL_BTN_STANDARD} ert-coreQuickLinks__pill`,
                attr: { type: 'button' }
            });
            button.createSpan({ cls: ERT_CLASSES.PILL_BTN_LABEL, text });
            const iconEl = button.createSpan({ cls: ERT_CLASSES.PILL_BTN_ICON });
            setIcon(iconEl, 'corner-right-down');
            this.plugin.registerDomEvent(button, 'click', () => {
                findSection(section)?.scrollIntoView({ block: 'start' });
            });
        });
    }

    private renderGuarded(label: string, containerEl: HTMLElement, render: () => void): boolean {
        try {
            render();
            return true;
        } catch (error) {
            console.error(`[Settings] Failed to render ${label}:`, error);
            const fallback = containerEl.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });
            fallback.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: t('ui.settingsTab.sectionUnavailable', { label }) });
            fallback.createDiv({
                cls: ERT_CLASSES.SECTION_DESC,
                text: t('ui.settingsTab.sectionUnavailableDesc')
            });
            return false;
        }
    }

    display(): void {
        const { containerEl } = this;
        this.disposeAsyncWork();
        containerEl.empty();
        containerEl.addClass('ert-ui', 'ert-settings-root', 'ert-scope--settings');
        containerEl.closest('.vertical-tab-content')?.classList.add('ert-settings-scroll-host');
        this._aiRelatedElements = [];
        this._aiTabActivationHandler = null;

        // Restore the last tab the user had open only when the caller did not
        // request a specific destination such as Core alerts.
        const hasExplicitTabRequest = this._hasExplicitTabRequest;
        if (!hasExplicitTabRequest && this.plugin.settings.lastSettingsTab) {
            this._activeTab = this.plugin.settings.lastSettingsTab;
        }
        this._hasExplicitTabRequest = false;

        // Auto-migrate: Clean up legacy advanced template if needed
        this.autoMigrateAdvancedTemplate();

        const tabBar = containerEl.createDiv({ cls: 'ert-settings-tab-bar' });
        const coreTab = tabBar.createDiv({ cls: 'ert-settings-tab' });
        const coreIcon = coreTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(coreIcon, 'settings');
        coreTab.createSpan({ text: t('ui.settingsTab.tabCore'), cls: 'ert-settings-tab-label' });

        const socialTab = tabBar.createDiv({ cls: 'ert-settings-tab ert-settings-tab-social' });
        const socialIcon = socialTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(socialIcon, 'radio');
        socialTab.createSpan({ text: t('ui.settingsTab.tabSocial'), cls: 'ert-settings-tab-label' });
        const communityTab = tabBar.createDiv({ cls: 'ert-settings-tab ert-settings-tab-community' });
        const communityIcon = communityTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(communityIcon, 'users');
        communityTab.createSpan({ text: t('ui.settingsTab.tabCommunity'), cls: 'ert-settings-tab-label' });
        const inquiryTab = tabBar.createDiv({ cls: 'ert-settings-tab' });
        const inquiryIcon = inquiryTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(inquiryIcon, 'ri-logo');
        inquiryTab.createSpan({ text: t('ui.settingsTab.tabInquiry'), cls: 'ert-settings-tab-label' });
        const publishingTab = tabBar.createDiv({ cls: 'ert-settings-tab ert-settings-tab-publishing' });
        const publishingIcon = publishingTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(publishingIcon, 'book-open-text');
        publishingTab.createSpan({ text: t('ui.settingsTab.tabPublishing'), cls: 'ert-settings-tab-label' });
        const aiTab = tabBar.createDiv({ cls: 'ert-settings-tab' });
        const aiIcon = aiTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(aiIcon, 'cpu');
        aiTab.createSpan({ text: t('ui.settingsTab.tabAi'), cls: 'ert-settings-tab-label' });
        const advancedTab = tabBar.createDiv({ cls: 'ert-settings-tab' });
        const advancedIcon = advancedTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(advancedIcon, 'pyramid');
        advancedTab.createSpan({ text: t('ui.settingsTab.tabAdvanced'), cls: 'ert-settings-tab-label' });
        const proTab = tabBar.createDiv({ cls: 'ert-settings-tab ert-settings-tab-pro' });
        const proIcon = proTab.createSpan({ cls: 'ert-settings-tab-icon' });
        setIcon(proIcon, 'signature');
        proTab.createSpan({ text: t('ui.settingsTab.tabPro'), cls: 'ert-settings-tab-label' });

        const coreContent = containerEl.createDiv({ cls: 'ert-settings-tab-content ert-settings-core-content ert-scope--settings' });
        const socialContent = containerEl.createDiv({
            cls: 'ert-settings-tab-content ert-settings-social-content ert-ui ert-scope--settings ert-skin--social ert-density--compact'
        });
        const communityContent = containerEl.createDiv({
            cls: 'ert-settings-tab-content ert-settings-community-content ert-ui ert-scope--settings'
        });
        const inquiryContent = containerEl.createDiv({ cls: 'ert-settings-tab-content ert-settings-inquiry-content ert-scope--settings' });
        const publishingContent = containerEl.createDiv({
            cls: 'ert-settings-tab-content ert-settings-publishing-content ert-scope--settings'
        });
        const aiContent = containerEl.createDiv({ cls: 'ert-settings-tab-content ert-settings-ai-content ert-scope--settings' });
        const advancedContent = containerEl.createDiv({ cls: 'ert-settings-tab-content ert-settings-advanced-content ert-scope--settings' });
        const proContent = containerEl.createDiv({
            cls: `ert-settings-tab-content ert-settings-pro-content ert-scope--settings ${ERT_CLASSES.SKIN_PRO}`
        });

        this._tabEls = {
            core: coreTab,
            social: socialTab,
            community: communityTab,
            inquiry: inquiryTab,
            publishing: publishingTab,
            ai: aiTab,
            advanced: advancedTab,
            pro: proTab
        };
        this._tabContentEls = {
            core: coreContent,
            social: socialContent,
            community: communityContent,
            inquiry: inquiryContent,
            publishing: publishingContent,
            ai: aiContent,
            advanced: advancedContent,
            pro: proContent
        };

        // Persist tab selection so Settings reopens on the user's last tab.
        // Saving via void-promise — failure to persist is non-fatal; the in-memory
        // _activeTab still drives the current view.
        const persistTab = (tab: typeof this._activeTab) => {
            this._activeTab = tab;
            this.plugin.settings.lastSettingsTab = tab;
            void this.plugin.saveSettings();
            this.updateRenderedTabState();
            if (tab === 'ai') this._aiTabActivationHandler?.();
        };
        this.plugin.registerDomEvent(coreTab, 'click', () => persistTab('core'));
        this.plugin.registerDomEvent(socialTab, 'click', () => persistTab('social'));
        this.plugin.registerDomEvent(communityTab, 'click', () => persistTab('community'));
        this.plugin.registerDomEvent(inquiryTab, 'click', () => persistTab('inquiry'));
        this.plugin.registerDomEvent(publishingTab, 'click', () => persistTab('publishing'));
        this.plugin.registerDomEvent(aiTab, 'click', () => persistTab('ai'));
        this.plugin.registerDomEvent(advancedTab, 'click', () => persistTab('advanced'));
        this.plugin.registerDomEvent(proTab, 'click', () => persistTab('pro'));
        this.updateRenderedTabState();

        const proEntitlement = getProEntitlement(this.plugin);
        proTab.toggleClass('is-pro-active', proEntitlement.isProActive);
        proTab.toggleClass('is-pro-disabled', !proEntitlement.isProActive);
        const refreshProDependentSections = () => this.update();

        const coreStack = coreContent.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderCoreHero(coreStack);

        // Refactor alerts (shown at top when migrations are needed)
        const alertsRow = coreStack.createDiv({ attr: { [ERT_DATA.SECTION]: CORE_ALERTS_SECTION_KEY } });
        this.renderRefactorAlerts(alertsRow);

        const forceExpandCompletionPreview = this._forceExpandCoreCompletionPreview;
        this._forceExpandCoreCompletionPreview = false;

        let backdropSection: HTMLElement | null = null;
        let chronologueSection: HTMLElement | null = null;
        let generalSection: HTMLElement | null = null;
        let progressSection: HTMLElement | null = null;
        let goalsSessionsSection: HTMLElement | null = null;

        const quickLinksRow = coreStack.createDiv();

        const completionRow = coreStack.createDiv();
        this.renderGuarded(t('ui.settingsTab.guardCompletionEstimate'), completionRow, () => {
            renderCompletionEstimatePreview({
                app: this.app,
                plugin: this.plugin,
                containerEl: completionRow,
                frameClass: 'ert-previewFrame--flush',
                forceExpanded: forceExpandCompletionPreview
            });
        });

        const coreBody = coreStack.createDiv();
        const searchableContent = coreBody.createDiv({ cls: `ert-settings-searchable-content ${ERT_CLASSES.STACK}` });

        generalSection = searchableContent.createDiv({
            attr: { [ERT_DATA.SECTION]: 'general' }
        });
        const generalStack = generalSection.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderGuarded(t('ui.settingsTab.guardGeneral'), generalStack, () => {
            renderGeneralSection({
                app: this.app,
                plugin: this.plugin,
                attachFolderSuggest: (text) => this.attachFolderSuggest(text),
                containerEl: generalStack,
                addAiRelatedElement: (el) => this._aiRelatedElements.push(el)
            });
        });

        progressSection = searchableContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'progress' } });
        const progressStack = progressSection.createDiv({ cls: ERT_CLASSES.STACK });

        const progressStatusSection = progressStack.createDiv({ attr: { [ERT_DATA.SECTION]: 'progress-status' } });
        const progressStatusStack = progressStatusSection.createDiv({ cls: ERT_CLASSES.STACK });
        this._progressStatusStack = progressStatusStack;
        const activeBookScope = this.resetActiveBookScope();
        this.renderProgressStatus(progressStatusStack, activeBookScope);

        goalsSessionsSection = searchableContent.createDiv({
            attr: { [ERT_DATA.SECTION]: 'goals-sessions' }
        });
        const goalsSessionsTarget = goalsSessionsSection;
        this.renderGuarded(t('ui.settingsTab.guardGoalsSessions'), goalsSessionsTarget, () => {
            renderGoalsSessionsSection({ plugin: this.plugin, containerEl: goalsSessionsTarget });
        });

        const runtimeSection = searchableContent.createDiv({
            cls: `${ERT_CLASSES.ROOT} ${ERT_CLASSES.SKIN_PRO} ${ERT_CLASSES.STACK}`,
            attr: { [ERT_DATA.SECTION]: 'runtime' }
        });
        this.renderGuarded(t('ui.settingsTab.guardRuntime'), runtimeSection, () => {
            renderRuntimeSection({ app: this.app, plugin: this.plugin, containerEl: runtimeSection });
        });

        const beatsWrapper = searchableContent.createDiv();
        const backdropYamlTarget = createDiv();
        this._beatsWrapper = beatsWrapper;
        this._backdropYamlTarget = backdropYamlTarget;
        this.renderBeatProperties(beatsWrapper, activeBookScope);

        chronologueSection = searchableContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'chronologue' } });
        const chronologueTarget = chronologueSection;
        this.renderGuarded(t('ui.settingsTab.guardChronologue'), chronologueTarget, () => {
            renderChronologueSection({ app: this.app, plugin: this.plugin, containerEl: chronologueTarget });
        });

        const povSection = searchableContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'pov' } });
        this.renderGuarded(t('ui.settingsTab.guardPov'), povSection, () => {
            renderPovSection({ plugin: this.plugin, containerEl: povSection });
        });

        const planetarySection = searchableContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'planetary' } });
        this.renderGuarded(t('ui.settingsTab.guardPlanetary'), planetarySection, () => {
            renderPlanetaryTimeSection({ app: this.app, plugin: this.plugin, containerEl: planetarySection });
        });

        backdropSection = searchableContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'backdrop' } });
        const backdropTarget = backdropSection;
        this.renderGuarded(t('ui.settingsTab.guardBackdrop'), backdropTarget, () => {
            renderBackdropSection({ app: this.app, plugin: this.plugin, containerEl: backdropTarget });
            backdropTarget.appendChild(backdropYamlTarget);
        });

        const colorsWrapper = searchableContent.createDiv();
        this.renderGuarded(t('ui.settingsTab.guardColors'), colorsWrapper, () => {
            renderColorsSection(colorsWrapper, this.plugin);
        });

        const releaseNotesSection = searchableContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'release-notes' } });
        this.releaseNotesComponent?.unload();
        this.releaseNotesComponent = new Component();
        this.releaseNotesComponent.load();
        this.renderGuarded(t('ui.settingsTab.guardReleaseNotes'), releaseNotesSection, () => {
            void renderReleaseNotesSection({ plugin: this.plugin, containerEl: releaseNotesSection, component: this.releaseNotesComponent! });
        });

        // Order mirrors the on-page section order so the links read top-to-bottom.
        this.renderCoreQuickLinks(quickLinksRow, [
            { label: t('ui.settingsTab.quickLinkBooks'), section: 'general' },
            { label: t('ui.settingsTab.quickLinkSessions'), section: 'goals-sessions' },
            { label: t('ui.settingsTab.quickLinkBeats'), section: 'beats-story' },
            { label: t('ui.settingsTab.quickLinkProperties'), section: 'scene-properties' },
            { label: t('ui.settingsTab.quickLinkChronology'), section: 'chronologue' },
            { label: t('ui.settingsTab.quickLinkPov'), section: 'pov' },
            { label: t('ui.settingsTab.quickLinkPlanetary'), section: 'planetary' },
            { label: t('ui.settingsTab.quickLinkBackdrop'), section: 'backdrop' },
            { label: t('ui.settingsTab.quickLinkColors'), section: 'colors-working-pattern' },
            { label: t('ui.settingsTab.quickLinkReleaseNotes'), section: 'release-notes' }
        ]);

        this.renderGuarded(t('ui.settingsTab.guardSocial'), socialContent, () => {
            renderAuthorProgressSection({ app: this.app, plugin: this.plugin, containerEl: socialContent });
        });

        this.renderGuarded(t('ui.settingsTab.guardCommunity'), communityContent, () => {
            renderCommunityShareSection({ app: this.app, plugin: this.plugin, containerEl: communityContent });
        });

        const inquiryStack = inquiryContent.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderInquiryHero(inquiryStack);
        const inquiryBody = inquiryStack.createDiv({ cls: `ert-settings-searchable-content ${ERT_CLASSES.STACK}` });
        const inquirySection = inquiryBody.createDiv({
            cls: ERT_CLASSES.STACK,
            attr: { [ERT_DATA.SECTION]: 'inquiry' }
        });
        this.renderGuarded(t('ui.settingsTab.guardInquiry'), inquirySection, () => {
            renderInquirySection({
                app: this.app,
                plugin: this.plugin,
                containerEl: inquirySection,
                attachFolderSuggest: (text) => this.attachFolderSuggest(text)
            });
        });

        const publishingStack = publishingContent.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderPublishingHero(publishingStack);
        const publishingPanels = publishingStack.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderGuarded(t('ui.settingsTab.guardPublish'), publishingPanels, () => {
            renderPublishSection({
                app: this.app,
                plugin: this.plugin,
                containerEl: publishingPanels
            });
        });

        const aiSection = aiContent.createDiv({ attr: { [ERT_DATA.SECTION]: 'ai' } });
        try {
            this._aiSectionLifecycle = renderAiSection({
                app: this.app,
                plugin: this.plugin,
                containerEl: aiSection,
                addAiRelatedElement: (el: HTMLElement) => this._aiRelatedElements.push(el),
                toggleAiSettingsVisibility: (show: boolean) => this.toggleAiSettingsVisibility(show),
                refreshProviderDimming: () => this.refreshProviderDimming(),
                scheduleKeyValidation: (p: 'anthropic' | 'google' | 'openai' | 'ollama') => { void this.scheduleKeyValidation(p); },
                setProviderSections: (sections) => { this._providerSections = sections; },
                setKeyInputRef: (provider, input) => {
                    if (provider === 'anthropic') this._anthropicKeyInput = input;
                    if (provider === 'google') this._googleKeyInput = input;
                    if (provider === 'openai') this._openaiKeyInput = input;
                },
                setOllamaConnectionInputs: ({ baseInput, modelInput }) => {
                    if (baseInput) this._ollamaBaseUrlInput = baseInput;
                    if (modelInput) this._ollamaModelIdInput = modelInput;
                },
                isAiTabActive: () => this._activeTab === 'ai',
                setAiTabActivationHandler: (handler) => { this._aiTabActivationHandler = handler; },
            });
        } catch (error) {
            console.error('[Settings] Failed to render AI tab content:', error);
            const fallback = aiSection.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });
            fallback.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: t('ui.settingsTab.aiUnavailableTitle') });
            fallback.createDiv({
                cls: ERT_CLASSES.SECTION_DESC,
                text: t('ui.settingsTab.aiUnavailableDesc')
            });
        }

        const advancedStack = advancedContent.createDiv({ cls: ERT_CLASSES.STACK });
        const advancedIntro = advancedStack.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderAdvancedHero(advancedIntro);
        const advancedConfigurationSection = advancedStack.createDiv({ attr: { [ERT_DATA.SECTION]: 'configuration' } });
        this.renderGuarded(t('ui.settingsTab.guardAdvanced'), advancedConfigurationSection, () => {
            renderConfigurationSection({
                app: this.app,
                plugin: this.plugin,
                containerEl: advancedConfigurationSection
            });
        });

        const proStack = proContent.createDiv({ cls: ERT_CLASSES.STACK });
        this.renderGuarded(t('ui.settingsTab.guardPro'), proStack, () => {
            renderProEntitlementPanel({
                app: this.app,
                plugin: this.plugin,
                containerEl: proStack,
                onEntitlementChanged: refreshProDependentSections
            });
        });

        this.renderGuarded(t('ui.settingsTab.guardBonusVaults'), proStack, () => {
            renderBonusVaultsSection({
                app: this.app,
                plugin: this.plugin,
                containerEl: proStack
            });
        });

        this.applyElementBlockLayout(containerEl);
    }

}
