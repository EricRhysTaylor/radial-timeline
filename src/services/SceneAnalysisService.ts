/*
 * SceneAnalysisService
 * Handles registration and UI flow for AI scene analysis commands.
 */

import { App, Modal, Notice, ButtonComponent, DropdownComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { normalizeBooleanValue } from '../utils/sceneHelpers';
import { getCredential } from '../ai/credentials/credentials';
import { CANONICAL_PROVIDER_LABELS, getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { getLocalLlmSettings } from '../ai/localLlm/settings';
import { t } from '../i18n';

export class SceneAnalysisService {
    constructor(private plugin: RadialTimelinePlugin) { }

    registerCommands(): void {
        this.registerManuscriptCommand();
        this.registerSubplotCommand();
        this.registerSynopsisCommand();
    }

    private registerSynopsisCommand(): void {
        this.plugin.addCommand({
            id: 'refresh-scene-synopses-ai',
            name: t('sceneAnalysis.service.commands.summaryRefresh'),
            checkCallback: (checking) => {
                if (!this.plugin.settings.enableAiSceneAnalysis) return false;
                if (checking) return true;
                void (async () => {
                    if (!(await this.ensureApiKey())) return;
                    await this.processSynopsisAnalysis();
                })();
                return true;
            }
        });
    }

    private registerManuscriptCommand(): void {
        this.plugin.addCommand({
            id: 'update-beats-manuscript-order',
            name: t('sceneAnalysis.service.commands.scenePulseManuscript'),
            checkCallback: (checking) => {
                if (!this.plugin.settings.enableAiSceneAnalysis) return false;
                if (checking) return true;
                void (async () => {
                    if (!(await this.ensureApiKey())) return;
                    await this.processByManuscriptOrder();
                })();
                return true;
            }
        });
    }

    private registerSubplotCommand(): void {
        this.plugin.addCommand({
            id: 'update-beats-choose-subplot',
            name: t('sceneAnalysis.service.commands.scenePulseSubplot'),
            checkCallback: (checking) => {
                if (!this.plugin.settings.enableAiSceneAnalysis) return false;
                if (checking) return true;
                void (async () => {
                    if (!(await this.ensureApiKey())) return;
                    const options = await this.getSubplotOptions();
                    new SubplotPickerModal(this.plugin.app, this, options).open();
                })();
                return true;
            }
        });
    }

    async getSubplotOptions(): Promise<Array<{ name: string; stats: { flagged: number; processable: number; total: number } }>> {
        const { getDistinctSubplotNames } = await import('../SceneAnalysisCommands');
        const names = await getDistinctSubplotNames(this.plugin, this.plugin.app.vault);
        if (!Array.isArray(names) || names.length === 0) {
            throw new Error(t('sceneAnalysis.service.notices.noSubplots'));
        }
        const stats = await Promise.all(names.map(name => this.countProcessableScenes(name)));
        return names.map((name, index) => ({ name, stats: stats[index] }));
    }

    private async ensureApiKey(): Promise<boolean> {
        const aiSettings = getCanonicalAiSettings(this.plugin);
        const selection = resolveConfiguredSelection(aiSettings);
        const provider = selection?.provider ?? aiSettings.provider;
        if (provider === 'none') {
            new Notice(t('sceneAnalysis.service.notices.aiDisabled'));
            return false;
        }
        if (provider === 'ollama') {
            const localLlm = getLocalLlmSettings(aiSettings);
            const hasUrl = !!localLlm.baseUrl?.trim();
            const hasModel = !!localLlm.defaultModelId?.trim();
            if (!localLlm.enabled) {
                new Notice(t('sceneAnalysis.service.notices.localLlmDisabled'));
                return false;
            }
            if (!hasUrl || !hasModel) {
                new Notice(t('sceneAnalysis.service.notices.localLlmRequiresUrl'));
                return false;
            }
            return true;
        }
        const key = await getCredential(this.plugin, provider);
        if (!key) {
            const name = CANONICAL_PROVIDER_LABELS[provider];
            new Notice(t('sceneAnalysis.service.notices.providerKeyMissing', { provider: name }));
            return false;
        }
        return true;
    }

    async countProcessableScenes(subplotName?: string): Promise<{ flagged: number; processable: number; total: number }> {
        const allScenes = await this.plugin.getSceneData();
        if (subplotName) {
            const filtered = allScenes.filter(scene => {
                const subplots = scene.subplot
                    ? (Array.isArray(scene.subplot) ? scene.subplot : [scene.subplot])
                    : [];
                return subplots.includes(subplotName);
            });
            const validScenes = filtered.filter(scene => {
                const statusValue = Array.isArray(scene.status) ? scene.status[0] : scene.status;
                const pulseFlag = scene['Pulse Update'] ?? scene['Beats Update'];
                return (statusValue === 'Working' || statusValue === 'Complete') && normalizeBooleanValue(pulseFlag);
            });
            const processableScenes = filtered.filter(scene => {
                const statusValue = Array.isArray(scene.status) ? scene.status[0] : scene.status;
                return statusValue === 'Working' || statusValue === 'Complete';
            });
            return {
                flagged: validScenes.length,
                processable: processableScenes.length,
                total: filtered.length
            };
        }

        const processableScenes = allScenes.filter(scene => {
            const statusValue = Array.isArray(scene.status) ? scene.status[0] : scene.status;
            return statusValue === 'Working' || statusValue === 'Complete';
        });
        const flaggedCount = processableScenes.filter(scene => {
            const pulseFlag = scene['Pulse Update'] ?? scene['Beats Update'];
            return normalizeBooleanValue(pulseFlag);
        }).length;
        return {
            flagged: flaggedCount,
            processable: processableScenes.length,
            total: allScenes.length
        };
    }

    getActiveModelName(): string {
        const aiSettings = getCanonicalAiSettings(this.plugin);
        return resolveConfiguredSelection(aiSettings)?.model.id || t('sceneAnalysis.service.aiDisabledLabel');
    }

    isLocalLlmMode(): boolean {
        const aiSettings = getCanonicalAiSettings(this.plugin);
        return resolveConfiguredSelection(aiSettings)?.provider === 'ollama';
    }

    async processByManuscriptOrder(): Promise<void> {
        const { processByManuscriptOrder } = await import('../SceneAnalysisCommands');
        await processByManuscriptOrder(this.plugin, this.plugin.app.vault);
    }

    async processBySubplotName(subplotName: string): Promise<void> {
        const { processBySubplotNameWithModal } = await import('../SceneAnalysisCommands');
        await processBySubplotNameWithModal(this.plugin, this.plugin.app.vault, subplotName);
    }

    async processEntireSubplot(subplotName: string): Promise<void> {
        const { processEntireSubplotWithModal } = await import('../SceneAnalysisCommands');
        await processEntireSubplotWithModal(this.plugin, this.plugin.app.vault, subplotName);
    }

    async processSynopsisAnalysis(): Promise<void> {
        const { processSynopsisByManuscriptOrder } = await import('../sceneAnalysis/SynopsisCommands');
        await processSynopsisByManuscriptOrder(this.plugin, this.plugin.app.vault);
    }

    async purgeBeatsForSubplot(subplotName: string): Promise<void> {
        const { purgeBeatsBySubplotName } = await import('../SceneAnalysisCommands');
        await purgeBeatsBySubplotName(this.plugin, this.plugin.app.vault, subplotName);
    }
}

class SubplotPickerModal extends Modal {
    private selectedSubplot: string;
    private statsEl: HTMLElement | null = null;
    private dropdown: DropdownComponent | null = null;
    private infoTextEl: HTMLParagraphElement | null = null;
    private heroStats?: {
        flagged: HTMLElement;
        processable: HTMLElement;
        total: HTMLElement;
    };
    private readonly statsBySubplot: Map<string, { flagged: number; processable: number; total: number }>;

    constructor(
        app: App,
        private service: SceneAnalysisService,
        private readonly options: Array<{ name: string; stats: { flagged: number; processable: number; total: number } }>
    ) {
        super(app);
        if (!options.length) {
            throw new Error(t('sceneAnalysis.service.subplotPicker.noOptions'));
        }
        this.selectedSubplot = options[0].name;
        this.statsBySubplot = new Map(options.map(opt => [opt.name, opt.stats]));
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        titleEl.setText('');
        contentEl.empty();
        // Use generic modal base + subplot picker specific styling
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');
        contentEl.addClass('ert-subplot-picker-modal');

        const modelName = this.service.getActiveModelName();
        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        const badgeText = modelName
            ? t('sceneAnalysis.service.subplotPicker.badgeWith', { model: modelName })
            : t('sceneAnalysis.service.subplotPicker.badge');
        hero.createSpan({ text: badgeText, cls: 'ert-subplot-picker-badge' });
        hero.createDiv({ text: t('sceneAnalysis.service.subplotPicker.title'), cls: 'ert-modal-title' });
        hero.createDiv({ cls: 'ert-modal-subtitle', text: t('sceneAnalysis.service.subplotPicker.subtitle') });

        const heroStats = hero.createDiv({ cls: 'ert-subplot-picker-hero-stats' });
        this.heroStats = {
            flagged: this.createHeroStat(heroStats, t('sceneAnalysis.service.subplotPicker.flaggedScenes')),
            processable: this.createHeroStat(heroStats, t('sceneAnalysis.service.subplotPicker.processableScenes')),
            total: this.createHeroStat(heroStats, t('sceneAnalysis.service.subplotPicker.totalScenes'))
        };

        const formCard = contentEl.createDiv({ cls: 'ert-subplot-picker-card' });
        const selectContainer = formCard.createDiv({ cls: 'ert-subplot-picker-select' });
        selectContainer.createEl('label', { text: t('sceneAnalysis.service.subplotPicker.pickLabel'), cls: 'ert-subplot-picker-label' });
        this.dropdown = new DropdownComponent(selectContainer.createDiv({ cls: 'ert-subplot-picker-dropdown' }));
        this.options.forEach((option, index) => {
            // Show flagged count in parentheses if any scenes are flagged
            const flaggedSuffix = option.stats.flagged > 0 ? ` (${option.stats.flagged})` : '';
            this.dropdown?.addOption(option.name, `${index + 1}. ${option.name}${flaggedSuffix}`);
        });
        this.dropdown.setValue(this.selectedSubplot);
        this.dropdown.onChange(value => {
            this.selectedSubplot = value;
            this.updateStats(value);
        });

        this.statsEl = formCard.createDiv({ cls: 'ert-subplot-picker-stats' });
        this.updateStats(this.selectedSubplot);

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.service.subplotPicker.processFlagged'))
            .setCta()
            .onClick(async () => {
                this.close();
                await this.service.processBySubplotName(this.selectedSubplot);
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.service.subplotPicker.processEntire'))
            .setCta()
            .onClick(async () => {
                this.close();
                await this.service.processEntireSubplot(this.selectedSubplot);
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.service.subplotPicker.purgeAll'))
            .setDestructive()
            .onClick(async () => {
                try {
                    this.close();
                    await this.service.purgeBeatsForSubplot(this.selectedSubplot);
                } catch (error) {
                    new Notice(t('sceneAnalysis.service.errorPrefix', { error: error instanceof Error ? error.message : String(error) }));
                }
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.service.subplotPicker.cancel'))
            .onClick(() => this.close());
    }

    private createHeroStat(container: HTMLElement, label: string): HTMLElement {
        const stat = container.createDiv({ cls: 'ert-subplot-picker-hero-stat' });
        stat.createSpan({ cls: 'ert-subplot-picker-hero-label', text: label });
        return stat.createSpan({ cls: 'ert-subplot-picker-hero-value', text: '—' });
    }

    private updateStats(subplotName: string): void {
        if (!this.statsEl) return;
        const stats = this.statsBySubplot.get(subplotName);
        if (!stats) {
            throw new Error(t('sceneAnalysis.service.subplotPicker.unknownSelection', { name: subplotName }));
        }
        this.statsEl.empty();
        const summaryLine = t('sceneAnalysis.service.subplotPicker.stats', { flagged: stats.flagged, processable: stats.processable, total: stats.total });
        this.statsEl.createDiv({ cls: 'ert-subplot-picker-stats-line', text: summaryLine });

        const isLocalLlm = this.service.isLocalLlmMode();
        const infoText = isLocalLlm
            ? t('sceneAnalysis.service.subplotPicker.infoLocalLlm')
            : t('sceneAnalysis.service.subplotPicker.infoCloud');
        this.statsEl.createDiv({
            cls: 'ert-subplot-picker-summary',
            text: infoText
        });

        if (this.heroStats) {
            this.heroStats.flagged.setText(String(stats.flagged));
            this.heroStats.processable.setText(String(stats.processable));
            this.heroStats.total.setText(String(stats.total));
        }
    }

    private updateInfoText(modelName: string): void {
        if (!this.infoTextEl) return;
        this.infoTextEl.setText(t('sceneAnalysis.service.subplotPicker.infoLine', { model: modelName, name: this.selectedSubplot }));
    }
}
