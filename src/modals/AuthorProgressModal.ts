import { App, Modal, ButtonComponent, FileSystemAdapter, Notice, setIcon, setTooltip, normalizePath } from 'obsidian';
import * as path from 'path'; // SAFE: Node path needed to build absolute paths for native Finder reveal
import type RadialTimelinePlugin from '../main';
import { TimelineItem } from '../types/timeline';
import { AuthorProgressService } from '../services/AuthorProgressService';
import type { AuthorProgressCampaign } from '../types/settings';
import { buildDefaultAuthorProgressSettings } from '../authorProgress/authorProgressConfig';
import { getTeaserThresholds, getTeaserRevealLevel, TEASER_LEVEL_INFO } from '../renderer/apr/AprConstants';
import { hasProFeatureAccess } from '../settings/featureGate';
import { ERT_CLASSES } from '../ui/classes';
import {
    buildCampaignEmbedPath,
    buildDefaultEmbedPath,
    normalizeAprExportFormat,
    type AprExportFormat,
    type AprExportQuality
} from '../utils/aprPaths';
import { resolveBookTitle, resolveProjectPath } from '../renderer/apr/aprHelpers';
import { isSceneItem } from '../utils/sceneHelpers';
import { systemFolderPath } from '../utils/systemFolder';

export class AuthorProgressModal extends Modal {
    private plugin: RadialTimelinePlugin;
    private service: AuthorProgressService;

    // Reveal options (derived from settings)
    private aprSize: 'small' | 'medium' | 'large';
    private lastFullSize: 'small' | 'medium' | 'large' = 'medium';
    private exportQuality: AprExportQuality = 'standard';
    private selectedTargetId: string = 'default';

    private statusSectionEl: HTMLElement | null = null;
    private campaignsSectionEl: HTMLElement | null = null;
    private actionsSectionEl: HTMLElement | null = null;
    private actionsBodyEl: HTMLElement | null = null;

    private cachedScenes: TimelineItem[] = [];
    private progressPercent: number = 0;
    private cachedProjectPath: string = '';

    constructor(app: App, plugin: RadialTimelinePlugin) {
        super(app);
        this.plugin = plugin;
        this.service = new AuthorProgressService(plugin, app);

        const settings = plugin.settings.authorProgress?.defaults ?? buildDefaultAuthorProgressSettings().defaults;

        // Initialize reveal options from settings
        // Initialize size from settings
        this.aprSize = settings.aprSize ?? 'medium';
        this.lastFullSize = this.aprSize;
        this.exportQuality = settings.aprExportQuality ?? 'standard';
    }

    private getSelectedCampaign(): AuthorProgressCampaign | undefined {
        if (this.selectedTargetId === 'default') return undefined;
        return this.plugin.settings.authorProgress?.campaigns?.find(c => c.id === this.selectedTargetId);
    }

    private isCampaignTarget(): boolean {
        return this.selectedTargetId !== 'default';
    }

    private getGlobalAprSize(): 'small' | 'medium' | 'large' {
        return this.plugin.settings.authorProgress?.defaults.aprSize ?? this.aprSize ?? 'medium';
    }

    private getEffectiveAprSize(campaign?: AuthorProgressCampaign): 'small' | 'medium' | 'large' {
        return campaign?.aprSize ?? this.getGlobalAprSize();
    }

    private getActiveAprSize(): 'small' | 'medium' | 'large' {
        return this.getEffectiveAprSize(this.getSelectedCampaign());
    }

    private getCampaignExportFormat(campaign?: AuthorProgressCampaign): AprExportFormat {
        if (!campaign) return 'png';
        if (typeof campaign.exportFormat === 'string' && campaign.exportFormat.trim()) {
            return normalizeAprExportFormat(campaign.exportFormat);
        }
        const path = campaign.exportPath?.toLowerCase() ?? '';
        return path.endsWith('.svg') ? 'svg' : 'png';
    }

    private getDefaultExportFormat(): AprExportFormat {
        const settings = this.plugin.settings.authorProgress?.defaults;
        if (typeof settings?.exportFormat === 'string' && settings.exportFormat.trim()) {
            return normalizeAprExportFormat(settings.exportFormat);
        }
        const path = settings?.exportPath?.toLowerCase() ?? '';
        return path.endsWith('.svg') ? 'svg' : 'png';
    }

    private getTargetExportFormat(campaign?: AuthorProgressCampaign): AprExportFormat {
        return campaign ? this.getCampaignExportFormat(campaign) : this.getDefaultExportFormat();
    }

    private swapPathExtension(path: string, format: AprExportFormat): string {
        const trimmed = path.trim();
        if (!trimmed) return trimmed;
        if (/\.[a-z0-9]+$/i.test(trimmed)) {
            return trimmed.replace(/\.[a-z0-9]+$/i, `.${format}`);
        }
        return `${trimmed}.${format}`;
    }

    private getFormatLabel(format: AprExportFormat): string {
        return format.toUpperCase();
    }

    async onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        // Apply shell styling and sizing
        if (modalEl) {
            modalEl.classList.add('ert-modal-shell', 'ert-ui', 'ert-scope--modal', 'ert-modal--social');
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }

        // Standard modal container with glassy styling
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Modal Header with Badge (following modal template pattern)
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });

        // Badge with Radio icon for social media theme
        const badge = header.createSpan({ cls: ERT_CLASSES.MODAL_BADGE });
        const badgeIcon = badge.createSpan({ cls: ERT_CLASSES.MODAL_BADGE_ICON });
        setIcon(badgeIcon, 'radio');
        badge.createSpan({ text: 'Share' });

        header.createDiv({ text: 'Author progress report', cls: 'ert-modal-title' });
        header.createDiv({ text: 'Public, spoiler-safe progress view for fans and backers', cls: 'ert-modal-subtitle' });

        // Target selection + dynamic sections
        const campaigns = this.plugin.settings.authorProgress?.campaigns || [];
        const isProActive = hasProFeatureAccess(this.plugin);

        // Ensure valid target selection
        if (isProActive && campaigns.length > 0) {
            const campaignIds = new Set(campaigns.map(c => c.id));
            if (this.selectedTargetId !== 'default' && !campaignIds.has(this.selectedTargetId)) {
                this.selectedTargetId = 'default';
            }
        } else {
            this.selectedTargetId = 'default';
        }

        // Status (always shown)
        this.statusSectionEl = contentEl.createDiv({
            cls: `${ERT_CLASSES.PANEL} ert-panel--glass ${ERT_CLASSES.STACK}`
        });

        if (isProActive || campaigns.length > 0) {
            const campaignsSkin = contentEl.createDiv({ cls: ERT_CLASSES.SKIN_PRO });
            this.campaignsSectionEl = campaignsSkin.createDiv({
                cls: `${ERT_CLASSES.PANEL} ert-panel--glass ${ERT_CLASSES.STACK}`
            });
            if (!isProActive) {
                this.campaignsSectionEl.addClass('ert-pro-locked');
            }
        }

        // Actions (context-sensitive)
        const actionsSection = contentEl.createDiv({
            cls: `${ERT_CLASSES.PANEL} ert-panel--glass ${ERT_CLASSES.STACK}`
        });
        actionsSection.addClass('ert-apr-actions');
        const actionsHeader = actionsSection.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
        const actionsHeaderMain = actionsHeader.createDiv({ cls: ERT_CLASSES.CONTROL });
        const actionsTitleRow = actionsHeaderMain.createDiv({ cls: ERT_CLASSES.INLINE });
        const actionsIcon = actionsTitleRow.createSpan({ cls: ERT_CLASSES.SECTION_ICON });
        setIcon(actionsIcon, 'share-2');
        actionsTitleRow.createEl('h4', { text: 'Actions', cls: ERT_CLASSES.SECTION_TITLE });
        this.actionsSectionEl = actionsSection;

        this.actionsBodyEl = actionsSection.createDiv({ cls: `${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}` });

        // Footer actions
        const footer = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const settingsBtn = new ButtonComponent(footer)
            .setIcon('settings')
            .setTooltip('Open APR settings')
            .onClick(() => {
                this.close();
                const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
                if (!setting) return;
                this.plugin.settingsTab?.setActiveTab('social');
                setting.open();
                setting.openTabById('radial-timeline');
            });
        settingsBtn.buttonEl.addClass('ert-modal-settings-btn');
        new ButtonComponent(footer)
            .setButtonText('Publish')
            .setCta()
            .onClick(() => this.publish('dynamic'));
        new ButtonComponent(footer)
            .setButtonText('Close')
            .onClick(() => this.close());

        await this.loadData();
        this.renderStatusSection();
        this.renderCampaignStatusSection();
        this.renderActions();
    }

    private async loadData() {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        if (!settings) {
            this.cachedScenes = [];
            this.progressPercent = 0;
            this.cachedProjectPath = '';
            return;
        }

        // Get resolved project path for the selected target
        const campaign = this.getSelectedCampaign();
        const projectPath = resolveProjectPath(campaign ?? null, this.plugin.settings.books, this.plugin.settings.sourcePath);

        // Only reload if project path changed (cache invalidation on projectPath change)
        if (this.cachedProjectPath === projectPath && this.cachedScenes.length > 0) {
            return; // Cache hit - skip reload
        }

        // Load scenes from the resolved project path
        const allScenes = await this.plugin.getSceneData({ sourcePath: projectPath });
        this.cachedScenes = allScenes.filter(isSceneItem);
        this.progressPercent = this.service.resolveProgressState(this.cachedScenes).percent;
        this.cachedProjectPath = projectPath;

        // Empty project feedback - show Notice when valid path has no scenes
        if (this.cachedScenes.length === 0) {
            const targetLabel = campaign ? `Campaign "${campaign.name}"` : 'Default Report';
            new Notice(`${targetLabel}: Project path "${projectPath}" contains no scenes.`);
        }
    }

    private renderStatusSection(): void {
        if (!this.statusSectionEl) return;
        this.statusSectionEl.empty();

        const settings = this.plugin.settings.authorProgress?.defaults;
        const isCampaign = this.isCampaignTarget();
        if (!isCampaign && settings?.aprSize) {
            this.aprSize = settings.aprSize;
        }

        const header = this.statusSectionEl.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
        const headerMain = header.createDiv({ cls: ERT_CLASSES.CONTROL });
        const headerRow = headerMain.createDiv({ cls: ERT_CLASSES.INLINE });
        const headerIcon = headerRow.createSpan({ cls: ERT_CLASSES.SECTION_ICON });
        setIcon(headerIcon, 'radio');
        headerRow.createEl('h4', { text: 'Status', cls: ERT_CLASSES.SECTION_TITLE });

        const headerActions = header.createDiv({ cls: ERT_CLASSES.SECTION_ACTIONS });
        const statusPill = headerActions.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ${ERT_CLASSES.BADGE_PILL_NEUTRAL}`
        });
        const statusIcon = statusPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(statusIcon, 'share-2');
        statusPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'Sharing output' });

        this.renderRefreshAlert(this.statusSectionEl);

        const statusTargets = this.getAprStatusTargets().filter(target => !target.campaign);
        this.renderStatusGrid(this.statusSectionEl, statusTargets, true);
    }

    private renderCampaignStatusSection(): void {
        if (!this.campaignsSectionEl) return;
        this.campaignsSectionEl.empty();

        const header = this.campaignsSectionEl.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
        const headerMain = header.createDiv({ cls: ERT_CLASSES.CONTROL });
        const headerRow = headerMain.createDiv({ cls: ERT_CLASSES.INLINE });
        const headerIcon = headerRow.createSpan({ cls: ERT_CLASSES.SECTION_ICON });
        setIcon(headerIcon, 'layers');
        headerRow.createEl('h4', { text: 'Campaign status', cls: ERT_CLASSES.SECTION_TITLE });

        const headerActions = header.createDiv({ cls: ERT_CLASSES.SECTION_ACTIONS });
        const proPill = headerActions.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ${ERT_CLASSES.BADGE_PILL_PRO}`
        });
        const proIcon = proPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(proIcon, 'signature');
        proPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: 'Pro' });

        const campaignTargets = this.getAprStatusTargets().filter(target => target.campaign);
        if (campaignTargets.length === 0) {
            this.campaignsSectionEl.createDiv({ text: 'No campaigns yet.', cls: ERT_CLASSES.FIELD_NOTE });
            return;
        }

        this.renderStatusGrid(this.campaignsSectionEl, campaignTargets, true);
    }

    private renderStatusGrid(container: HTMLElement, targets: Array<{
        id: string;
        label: string;
        bookTitle: string;
        projectPath: string;
        path: string;
        size: 'small' | 'medium' | 'large';
        exportQuality: AprExportQuality;
        campaign?: AuthorProgressCampaign;
    }>, includeFormatColumn = false): void {
        if (targets.length === 0) return;

        const settings = this.plugin.settings.authorProgress?.defaults;
        const statusGrid = container.createDiv({ cls: `ert-apr-status-grid${includeFormatColumn ? ' ert-apr-status-grid--with-format' : ''}` });
        const statusHeaderRow = statusGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--header' });
        const headerLabels = includeFormatColumn
            ? ['APR', 'Book Title', 'Format', 'Export', 'Stage', 'Update In']
            : ['APR', 'Book Title', 'Export', 'Stage', 'Update In'];
        headerLabels.forEach(label => {
            const headerCell = statusHeaderRow.createDiv({
                text: label,
                cls: 'ert-apr-status-cell ert-apr-status-cell--header'
            });
            if (label === 'APR') {
                setTooltip(headerCell, 'APR = Author Progress Report (the generated export output).');
            }
        });

        targets.forEach((target) => {
            const dataRow = statusGrid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--data' });

            const aprCell = dataRow.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--apr' });
            const aprLabel = aprCell.createSpan({
                text: target.label,
                cls: 'ert-apr-status-title'
            });
            aprLabel.setAttr('title', target.label);

            const bookCell = dataRow.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--book' });
            const bookLabel = bookCell.createSpan({
                text: target.bookTitle,
                cls: `${ERT_CLASSES.FIELD_NOTE} ert-apr-status-book`
            });
            if (target.projectPath) {
                bookLabel.setAttr('title', `Project: ${target.projectPath}`);
            }

            if (includeFormatColumn) {
                const formatCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
                const formatPill = formatCell.createSpan({
                    cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ert-apr-format-pill`
                });
                const format = this.getTargetExportFormat(target.campaign);
                formatPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: this.getFormatLabel(format) });
            }

            const exportCell = dataRow.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--export' });
            const exportPill = exportCell.createSpan({
                cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM}`
            });
            exportPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: this.getQualityLabel(target.exportQuality) });

            const stageCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
            const stagePill = stageCell.createSpan({
                cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM}`
            });
            const stageIcon = stagePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
            const stageMeta = target.campaign
                ? this.getCampaignStageDisplay(target.campaign)
                : this.getDefaultReportStageDisplay(target.size);
            setIcon(stageIcon, stageMeta.icon);
            stagePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: stageMeta.label });
            if (stageMeta.tooltip) {
                setTooltip(stagePill, stageMeta.tooltip);
            }

            const updateCell = dataRow.createDiv({ cls: 'ert-apr-status-cell' });
            const updatePill = updateCell.createSpan({
                cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM}`
            });
            const frequency = target.campaign ? target.campaign.updateFrequency : settings?.updateFrequency;
            const lastPublishedDate = target.campaign ? target.campaign.lastPublishedDate : settings?.lastPublishedDate;
            const isUnpublished = !lastPublishedDate?.trim();
            const isAuto = !!frequency && frequency !== 'manual';
            const updateInfo = isUnpublished
                ? { label: 'Unpublished', reminder: undefined }
                : target.campaign && !target.campaign.isActive
                    ? { label: 'Paused', reminder: undefined }
                    : (isAuto && !lastPublishedDate)
                        ? { label: 'Auto update due', reminder: undefined }
                        : this.getNextUpdateInfo({
                            frequency,
                            lastPublishedDate,
                            reminderDays: target.campaign ? target.campaign.refreshThresholdDays : settings?.stalenessThresholdDays,
                            remindersEnabled: target.campaign ? true : settings?.enableReminders
                        });
            const updateLabel = updateInfo.reminder
                ? `${updateInfo.label} · ${updateInfo.reminder}`
                : updateInfo.label;
            updatePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: updateLabel });
        });
    }

    private renderActions(): void {
        if (!this.actionsBodyEl) return;
        this.actionsBodyEl.empty();

        const campaigns = this.plugin.settings.authorProgress?.campaigns || [];
        const isProActive = hasProFeatureAccess(this.plugin);
        const showProActions = isProActive && this.selectedTargetId !== 'default';
        if (this.actionsSectionEl) {
            this.actionsSectionEl.classList.toggle(ERT_CLASSES.SKIN_PRO, showProActions);
        }
        if (showProActions) {
            this.renderProActions(this.actionsBodyEl, campaigns);
        } else {
            this.renderCoreActions(this.actionsBodyEl);
        }
    }

    private renderCoreActions(container: HTMLElement): void {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        if (!settings) return;

        this.aprSize = settings.aprSize ?? this.aprSize ?? 'medium';

        const campaigns = this.plugin.settings.authorProgress?.campaigns || [];
        const isProActive = hasProFeatureAccess(this.plugin);

        // === TARGET ROW (two-column: label left, dropdown right) ===
        if (isProActive && campaigns.length > 0) {
            const targetRow = container.createDiv({ cls: 'ert-apr-target-row' });
            targetRow.createSpan({ text: 'Target', cls: ERT_CLASSES.LABEL });
            const targetSelect = targetRow.createEl('select', { cls: 'dropdown ert-input' });
            targetSelect.createEl('option', { value: 'default', text: 'Default report' });
            campaigns.forEach(campaign => {
                targetSelect.createEl('option', { value: campaign.id, text: `Campaign: ${campaign.name}` });
            });
            targetSelect.value = this.selectedTargetId;
            targetSelect.onchange = async () => {
                this.selectedTargetId = targetSelect.value === 'default' ? 'default' : targetSelect.value;
                await this.loadData();
                this.renderStatusSection();
                this.renderCampaignStatusSection();
                this.renderActions();
            };
        }

        // === FORMAT ROW (two-column: label left, dropdown right) ===
        const formatRow = container.createDiv({ cls: 'ert-apr-target-row' });
        formatRow.createSpan({ text: 'Format', cls: ERT_CLASSES.LABEL });
        const formatSelect = formatRow.createEl('select', { cls: 'dropdown ert-input' });
        formatSelect.createEl('option', { value: 'png', text: 'PNG' });
        formatSelect.createEl('option', { value: 'svg', text: 'SVG' });
        formatSelect.value = this.getDefaultExportFormat();
        formatSelect.onchange = async () => {
            await this.saveDefaultExportFormat(normalizeAprExportFormat(formatSelect.value));
            this.renderStatusSection();
            this.renderActions();
        };

        // === EXPORT QUALITY ROW (two-column: label left, buttons right) ===
        const exportRow = container.createDiv({ cls: 'ert-apr-target-row' });
        exportRow.createSpan({ text: 'Export quality', cls: ERT_CLASSES.LABEL });

        const qualityOptions: Array<{ quality: AprExportQuality; label: string; detail: string }> = [
            { quality: 'standard', label: 'Standard', detail: '1200px · ~150 KB' },
            { quality: 'ultra', label: 'Ultra', detail: '2400px · ~400 KB' },
            { quality: 'print', label: 'Print', detail: '4800px · ~1.2 MB' }
        ];

        const qualityButtonRow = exportRow.createDiv({ cls: `ert-apr-size-buttons ${ERT_CLASSES.INLINE}` });
        qualityOptions.forEach(option => {
            const isActive = option.quality === this.exportQuality;
            const btn = qualityButtonRow.createEl('button', {
                cls: `${ERT_CLASSES.PILL_BTN} ${ERT_CLASSES.PILL_BTN_SOCIAL} ${isActive ? ERT_CLASSES.IS_ACTIVE : ''}`
            });
            const label = btn.createSpan({ cls: ERT_CLASSES.PILL_BTN_LABEL });
            label.append(label.ownerDocument.createTextNode(option.label));
            btn.setAttr('title', option.detail);
            if (isActive) {
                btn.setAttr('aria-pressed', 'true');
            }
            btn.onclick = async () => {
                this.exportQuality = option.quality;
                await this.saveQuality();
                this.renderStatusSection();
                this.renderActions();
            };
        });

        // === OUTPUT FILE ===
        const pathRow = container.createDiv({ cls: 'ert-apr-target-row' });
        pathRow.createSpan({ text: 'Output file', cls: ERT_CLASSES.LABEL });
        const defaultPath = buildDefaultEmbedPath({
            bookTitle: this.plugin.getActiveBookTitle(),
            updateFrequency: settings?.updateFrequency,
            aprExportQuality: settings?.aprExportQuality,
            exportFormat: this.getDefaultExportFormat()
        });
        // Auto-sync export path to canonical default
        if (settings) {
            settings.exportPath = defaultPath;
            void this.plugin.saveSettings();
        }
        const pathDisplay = pathRow.createEl('a', {
            cls: `${ERT_CLASSES.FIELD_NOTE} ert-apr-output-link`,
            attr: {
                href: '#',
                role: 'button',
                title: `${defaultPath} — click to reveal in system file manager`
            }
        });
        pathDisplay.setText(this.summarizePath(defaultPath));
        pathDisplay.addEventListener('click', (evt) => {
            evt.preventDefault();
            void this.revealOutputFileInOS(defaultPath);
        });

    }

    private renderProActions(container: HTMLElement, campaigns: AuthorProgressCampaign[]): void {
        const settings = this.plugin.settings.authorProgress?.defaults;
        if (!settings) return;

        // === TARGET ROW (two-column: label left, dropdown right) ===
        const targetRow = container.createDiv({ cls: 'ert-apr-target-row' });
        targetRow.createSpan({ text: 'Target', cls: ERT_CLASSES.LABEL });
        const targetSelect = targetRow.createEl('select', { cls: 'dropdown ert-input' });
        targetSelect.createEl('option', { value: 'default', text: 'Default report' });
        campaigns.forEach(campaign => {
            targetSelect.createEl('option', { value: campaign.id, text: `Campaign: ${campaign.name}` });
        });
        targetSelect.value = this.selectedTargetId;
        targetSelect.onchange = async () => {
            this.selectedTargetId = targetSelect.value === 'default' ? 'default' : targetSelect.value;
            await this.loadData();
            this.renderStatusSection();
            this.renderCampaignStatusSection();
            this.renderActions();
        };

        const campaign = this.getSelectedCampaign() ?? campaigns.find(c => c.id === this.selectedTargetId);
        if (!campaign) {
            container.createDiv({ text: 'Select a campaign to publish.', cls: ERT_CLASSES.FIELD_NOTE });
            return;
        }

        const campaignFormatRow = container.createDiv({ cls: 'ert-apr-target-row' });
        campaignFormatRow.createSpan({ text: 'Format', cls: ERT_CLASSES.LABEL });
        const campaignFormatSelect = campaignFormatRow.createEl('select', { cls: 'dropdown ert-input' });
        campaignFormatSelect.createEl('option', { value: 'png', text: 'PNG' });
        campaignFormatSelect.createEl('option', { value: 'svg', text: 'SVG' });
        campaignFormatSelect.value = this.getCampaignExportFormat(campaign);
        campaignFormatSelect.onchange = async () => {
            await this.saveCampaignExportFormat(campaign, normalizeAprExportFormat(campaignFormatSelect.value));
            this.renderStatusSection();
            this.renderCampaignStatusSection();
            this.renderActions();
        };

        // Auto-update legacy export paths
        if (settings) {
            const legacySlug = campaign.name.toLowerCase().replace(/\s+/g, '-');
            const legacyPath = `${systemFolderPath('Social')}/${legacySlug}-progress.svg`;
            if (campaign.exportPath === legacyPath) {
                const nextPath = buildCampaignEmbedPath({
                    bookTitle: this.plugin.getActiveBookTitle(),
                    campaignName: campaign.name,
                    updateFrequency: campaign.updateFrequency,
                    aprExportQuality: campaign.aprExportQuality ?? settings.aprExportQuality,
                    teaserEnabled: campaign.teaserReveal?.enabled ?? true,
                    exportFormat: this.getCampaignExportFormat(campaign)
                });
                campaign.exportPath = nextPath;
                void this.plugin.saveSettings();
            }
        }

        // === STATUS ROW (grid-style: Book, Format, Export, Schedule, Stage) ===
        const projectPath = resolveProjectPath(campaign, this.plugin.settings.books, this.plugin.settings.sourcePath);
        const bookTitle = resolveBookTitle(campaign, this.plugin.settings.books, this.plugin.getActiveBookTitle());
        const format = this.getCampaignExportFormat(campaign);
        const campaignQuality = campaign.aprExportQuality ?? this.plugin.settings.authorProgress?.defaults.aprExportQuality ?? 'standard';
        const scheduleLabel = this.getTeaserScheduleLabel(campaign);
        // Reuse the same logic as the upper Campaign Status row so the pill matches
        // (shows DEFAULT · RING / DEFAULT · SCENES etc. when teaser is OFF, or the teaser stage when ON).
        const stageInfo = this.getCampaignStageDisplay(campaign);

        const statusRow = container.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--data ert-apr-actions-status' });

        // Book cell
        const bookCell = statusRow.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--book' });
        const bookLabel = bookCell.createSpan({
            text: bookTitle,
            cls: `${ERT_CLASSES.FIELD_NOTE} ert-apr-status-book`
        });
        bookLabel.setAttr('title', `Project: ${projectPath}`);

        const formatCell = statusRow.createDiv({ cls: 'ert-apr-status-cell' });
        const formatPill = formatCell.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ert-apr-format-pill`
        });
        formatPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: this.getFormatLabel(format) });

        const exportCell = statusRow.createDiv({ cls: 'ert-apr-status-cell' });
        const exportPill = exportCell.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM}`
        });
        exportPill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: this.getQualityLabel(campaignQuality) });

        const scheduleCell = statusRow.createDiv({ cls: 'ert-apr-status-cell' });
        const schedulePill = scheduleCell.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM}`
        });
        schedulePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: scheduleLabel });

        // Stage cell
        const stageCell = statusRow.createDiv({ cls: 'ert-apr-status-cell' });
        const stagePill = stageCell.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM}`
        });
        const stageIcon = stagePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(stageIcon, stageInfo.icon);
        stagePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: stageInfo.label });
        if (stageInfo.tooltip) {
            setTooltip(stagePill, stageInfo.tooltip);
        }

        // === OUTPUT FILE ===
        const pathRow = container.createDiv({
            cls: `${ERT_CLASSES.ROW} ${ERT_CLASSES.ROW_COMPACT} ${ERT_CLASSES.ROW_MIDDLE_ALIGN}`
        });
        pathRow.createSpan({ text: 'Output file', cls: ERT_CLASSES.LABEL });
        const pathValue = pathRow.createDiv({ cls: ERT_CLASSES.INLINE });
        const pathText = pathValue.createEl('a', {
            cls: `${ERT_CLASSES.FIELD_NOTE} ert-mono ert-truncate ert-apr-output-link`,
            text: this.summarizePath(campaign.exportPath),
            attr: {
                href: '#',
                role: 'button',
                title: `${campaign.exportPath} — click to reveal in system file manager`
            }
        });
        pathText.addEventListener('click', (evt) => {
            evt.preventDefault();
            void this.revealOutputFileInOS(campaign.exportPath);
        });

    }

    private renderRefreshAlert(container: HTMLElement): void {
        if (this.isCampaignTarget()) {
            const campaign = this.getSelectedCampaign();
            if (!campaign) return;
            if (!this.service.campaignNeedsRefresh(campaign)) return;
            const daysSince = this.getDaysSince(campaign.lastPublishedDate);
            const ageLabel = daysSince === null ? 'many' : `${daysSince}`;
            const alert = container.createDiv({ cls: ERT_CLASSES.INLINE });
            const alertIcon = alert.createSpan({ cls: ERT_CLASSES.ICON_BADGE });
            setIcon(alertIcon, 'alert-triangle');
            alert.createSpan({
                text: `Campaign "${campaign.name}" is ${ageLabel} days old. Time to refresh!`,
                cls: 'ert-section-desc ert-section-desc--alert'
            });
            return;
        }

        if (!this.service.isStale()) return;
        const daysSince = this.getDaysSince(this.plugin.settings.authorProgress?.defaults.lastPublishedDate);
        const ageLabel = daysSince === null ? 'many' : `${daysSince}`;
        const alert = container.createDiv({ cls: ERT_CLASSES.INLINE });
        const alertIcon = alert.createSpan({ cls: ERT_CLASSES.ICON_BADGE });
        setIcon(alertIcon, 'alert-triangle');
        alert.createSpan({
            text: `Your report is ${ageLabel} days old. Time to refresh!`,
            cls: 'ert-section-desc ert-section-desc--alert'
        });
    }

    private resolveTeaserStatus(campaign?: AuthorProgressCampaign): { enabled: boolean; info?: { label: string; icon: string } } {
        if (!campaign) return { enabled: false };
        const teaserSettings = campaign.teaserReveal ?? { enabled: true, preset: 'standard' as const };
        if (!teaserSettings.enabled) return { enabled: false };
        const thresholds = getTeaserThresholds(teaserSettings.preset ?? 'standard', teaserSettings.customThresholds);
        const level = getTeaserRevealLevel(this.progressPercent, thresholds, teaserSettings.disabledStages);
        return { enabled: true, info: TEASER_LEVEL_INFO[level] };
    }

    private getTeaserScheduleLabel(campaign?: AuthorProgressCampaign): string {
        if (!campaign) return '—';
        const teaserSettings = campaign.teaserReveal ?? { enabled: true, preset: 'standard' as const };
        if (!teaserSettings.enabled) return 'OFF';
        const thresholds = getTeaserThresholds(teaserSettings.preset ?? 'standard', teaserSettings.customThresholds);
        return `${Math.round(thresholds.scenes)}/${Math.round(thresholds.colors)}/${Math.round(thresholds.full)}%`;
    }

    private getFileName(path: string): string {
        if (!path) return '—';
        const normalized = path.split('\\').pop() ?? path;
        return normalized.split('/').pop() ?? normalized;
    }

    private getAprStatusTargets(): Array<{
        id: string;
        label: string;
        bookTitle: string;
        projectPath: string;
        path: string;
        size: 'small' | 'medium' | 'large';
        exportQuality: AprExportQuality;
        campaign?: AuthorProgressCampaign;
    }> {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        const targets: Array<{
            id: string;
            label: string;
            bookTitle: string;
            projectPath: string;
            path: string;
            size: 'small' | 'medium' | 'large';
            exportQuality: AprExportQuality;
            campaign?: AuthorProgressCampaign;
        }> = [];

        if (!authorProgress || !settings) return targets;

        // Default Report (Core Social)
        const defaultProjectPath = resolveProjectPath(null, this.plugin.settings.books, this.plugin.settings.sourcePath);
        const defaultBookTitle = resolveBookTitle(null, this.plugin.settings.books, this.plugin.getActiveBookTitle());
        const defaultPath = buildDefaultEmbedPath({
            bookTitle: this.plugin.getActiveBookTitle(),
            updateFrequency: settings.updateFrequency,
            aprExportQuality: settings.aprExportQuality,
            exportFormat: this.getDefaultExportFormat()
        });
        const defaultSize = this.getGlobalAprSize();
        const defaultQuality = settings.aprExportQuality ?? 'standard';
        targets.push({
            id: 'default',
            label: 'Default Report',
            bookTitle: defaultBookTitle,
            projectPath: defaultProjectPath,
            path: settings.exportPath || defaultPath,
            size: defaultSize,
            exportQuality: defaultQuality
        });

        // Campaigns (Pro overrides)
        const campaigns = authorProgress.campaigns || [];
        campaigns.forEach(campaign => {
            const campaignProjectPath = resolveProjectPath(campaign, this.plugin.settings.books, this.plugin.settings.sourcePath);
            const campaignBookTitle = resolveBookTitle(campaign, this.plugin.settings.books, this.plugin.getActiveBookTitle());
            targets.push({
                id: campaign.id,
                label: campaign.name,
                bookTitle: campaignBookTitle,
                projectPath: campaignProjectPath,
                path: campaign.exportPath,
                size: this.getEffectiveAprSize(campaign),
                exportQuality: campaign.aprExportQuality ?? settings.aprExportQuality ?? 'standard',
                campaign
            });
        });

        return targets;
    }

    private getEffectiveTargetPath(): string {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        const campaign = this.getSelectedCampaign();
        if (campaign?.exportPath) return campaign.exportPath;
        return settings?.exportPath || buildDefaultEmbedPath({
            bookTitle: this.plugin.getActiveBookTitle(),
            updateFrequency: settings?.updateFrequency,
            aprExportQuality: settings?.aprExportQuality,
            exportFormat: this.getDefaultExportFormat()
        });
    }

    private getQualityLabel(quality: AprExportQuality): string {
        if (quality === 'print') return '4800px Prt';
        return quality === 'ultra' ? '2400px Ult' : '1200px Std';
    }

    private summarizePath(filePath: string, maxLength = 42): string {
        if (!filePath) return '—';
        if (filePath.length <= maxLength) return filePath;
        const parts = filePath.split('/');
        if (parts.length <= 2) return `…${filePath.slice(-maxLength + 1)}`;
        return `…/${parts.slice(-2).join('/')}`;
    }

    /**
     * Resolve a vault-relative path to an absolute filesystem path. Returns null
     * on platforms without filesystem access (mobile).
     */
    private resolveAbsolutePath(vaultPath: string): string | null {
        const adapter = this.app.vault.adapter; // SAFE: adapter required to compute absolute path for native Finder reveal
        if (adapter instanceof FileSystemAdapter) {
            return path.join(adapter.getBasePath(), normalizePath(vaultPath));
        }
        return null;
    }

    /**
     * Reveal the output file in the OS file manager (Finder on macOS, Explorer on Windows,
     * default file manager on Linux). Shows a Notice if the file isn't generated yet or the
     * platform doesn't support native reveal (mobile).
     */
    private revealOutputFileInOS(vaultPath: string): void {
        if (!vaultPath) {
            new Notice('No output file to reveal yet.');
            return;
        }
        const absolute = this.resolveAbsolutePath(vaultPath);
        if (!absolute) {
            new Notice('Revealing files is not supported on this platform.');
            return;
        }
        const existing = this.app.vault.getAbstractFileByPath(normalizePath(vaultPath));
        if (!existing) {
            new Notice('Output file not generated yet. Click Publish to create it.');
            return;
        }
        try {
            const electron = (window as unknown as { require?: (name: string) => { shell?: { showItemInFolder: (p: string) => void } } }).require?.('electron');
            const shell = electron?.shell;
            if (!shell) {
                new Notice('Cannot reveal file: system shell unavailable.');
                return;
            }
            shell.showItemInFolder(absolute);
        } catch {
            new Notice('Could not reveal file in system file manager.');
        }
    }

    private formatFrequencyLabel(frequency?: 'manual' | 'daily' | 'weekly' | 'monthly'): string {
        if (!frequency || frequency === 'manual') return 'Manual';
        const label = frequency.charAt(0).toUpperCase() + frequency.slice(1);
        return `Auto · ${label}`;
    }

    private getDaysSince(date?: string): number | null {
        if (!date) return null;
        const time = new Date(date).getTime();
        if (!Number.isFinite(time)) return null;
        return Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24));
    }

    private formatDays(value: number): string {
        const safe = Math.max(0, Math.round(value));
        return safe === 1 ? '1 day' : `${safe} days`;
    }

    private getNextUpdateInfo(opts: {
        frequency?: 'manual' | 'daily' | 'weekly' | 'monthly';
        lastPublishedDate?: string;
        reminderDays?: number;
        remindersEnabled?: boolean;
    }): { label: string; reminder?: string } {
        const frequency = opts.frequency ?? 'manual';
        if (frequency === 'manual') {
            const reminderDays = opts.reminderDays ?? 0;
            const daysSince = this.getDaysSince(opts.lastPublishedDate) ?? 0;
            const reminder = (opts.remindersEnabled && reminderDays > 0)
                ? this.formatDays(Math.max(0, reminderDays - daysSince))
                : undefined;
            return { label: 'Manual', reminder };
        }

        const intervalDays = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 30;
        const daysSince = this.getDaysSince(opts.lastPublishedDate);
        const remaining = daysSince === null ? 0 : Math.max(0, intervalDays - daysSince);
        return { label: this.formatDays(remaining) };
    }

    private getDefaultReportStageDisplay(_size: 'small' | 'medium' | 'large'): { label: string; icon: string; tooltip?: string } {
        // Honor the persisted view mode (set via the social settings teaser preview dropdown).
        const defaultViewMode = this.plugin.settings.authorProgress?.defaults.aprDefaultViewMode;
        const level = (defaultViewMode && defaultViewMode !== 'auto') ? defaultViewMode : 'full';
        const info = TEASER_LEVEL_INFO[level];
        return { label: info.label.toUpperCase(), icon: info.icon };
    }

    private getCampaignStageDisplay(campaign: AuthorProgressCampaign): { label: string; icon: string; tooltip?: string } {
        const teaserSettings = campaign.teaserReveal ?? { enabled: true, preset: 'standard' as const };
        if (!teaserSettings.enabled) {
            // Mirror the Default Report's current view mode (set via social settings preview).
            const defaultViewMode = this.plugin.settings.authorProgress?.defaults.aprDefaultViewMode;
            const inheritedLevel = (defaultViewMode && defaultViewMode !== 'auto') ? defaultViewMode : 'full';
            const info = TEASER_LEVEL_INFO[inheritedLevel];
            return {
                label: `DEFAULT · ${info.label.toUpperCase()}`,
                icon: info.icon,
                tooltip: 'Teaser off — this campaign publishes the current Default Report view (set in social settings preview).'
            };
        }

        const thresholds = getTeaserThresholds(teaserSettings.preset ?? 'standard', teaserSettings.customThresholds);
        const level = getTeaserRevealLevel(this.progressPercent, thresholds, teaserSettings.disabledStages);
        const info = TEASER_LEVEL_INFO[level];
        const progress = Math.max(0, Math.round(this.progressPercent));

        const steps: Array<{ level: 'scenes' | 'colors' | 'full'; threshold: number }> = [
            { level: 'scenes', threshold: thresholds.scenes },
            { level: 'colors', threshold: thresholds.colors },
            { level: 'full', threshold: thresholds.full },
        ];
        const disabled = teaserSettings.disabledStages ?? {};
        const filtered = steps.filter(step => !(step.level === 'scenes' && disabled.scenes) && !(step.level === 'colors' && disabled.colors));
        const currentIndex = filtered.findIndex(step => step.level === level);
        const nextThreshold = level === 'ring'
            ? filtered[0]?.threshold
            : (currentIndex >= 0 && currentIndex < filtered.length - 1
                ? filtered[currentIndex + 1].threshold
                : undefined);

        const label = nextThreshold
            ? `${info.label.toUpperCase()} ${progress}/${Math.round(nextThreshold)}`
            : info.label.toUpperCase();
        const tooltip = nextThreshold
            ? `${progress}% complete. Next stage at ${Math.round(nextThreshold)}%. Adjust ranges in the Campaign Manager.`
            : `${progress}% complete.`;

        return { label, icon: info.icon, tooltip };
    }

    private async saveDefaultExportFormat(format: AprExportFormat): Promise<void> {
        const settings = this.plugin.settings.authorProgress?.defaults;
        if (!settings) return;

        const nextFormat = normalizeAprExportFormat(format);
        settings.exportFormat = nextFormat;
        // Always recompute canonical default path when format changes
        settings.exportPath = buildDefaultEmbedPath({
            bookTitle: this.plugin.getActiveBookTitle(),
            updateFrequency: settings.updateFrequency,
            aprExportQuality: settings.aprExportQuality,
            exportFormat: nextFormat
        });

        await this.plugin.saveSettings();
    }

    private async saveCampaignExportFormat(campaign: AuthorProgressCampaign, format: AprExportFormat): Promise<void> {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        if (!authorProgress?.campaigns || !settings) return;

        const index = authorProgress.campaigns.findIndex(c => c.id === campaign.id);
        if (index < 0) return;
        const target = authorProgress.campaigns[index];
        const nextFormat = normalizeAprExportFormat(format);
        const currentFormat = this.getCampaignExportFormat(target);
        const resolvedBookTitle = resolveBookTitle(
            target,
            this.plugin.settings.books,
            this.plugin.getActiveBookTitle()
        );
        const oldDefaultPath = buildCampaignEmbedPath({
            bookTitle: resolvedBookTitle,
            campaignName: target.name,
            updateFrequency: target.updateFrequency,
            aprExportQuality: target.aprExportQuality ?? settings.aprExportQuality,
            teaserEnabled: target.teaserReveal?.enabled ?? true,
            exportFormat: currentFormat
        });
        const newDefaultPath = buildCampaignEmbedPath({
            bookTitle: resolvedBookTitle,
            campaignName: target.name,
            updateFrequency: target.updateFrequency,
            aprExportQuality: target.aprExportQuality ?? settings.aprExportQuality,
            teaserEnabled: target.teaserReveal?.enabled ?? true,
            exportFormat: nextFormat
        });
        const currentPath = target.exportPath?.trim() ?? '';

        target.exportFormat = nextFormat;
        if (!currentPath || currentPath === oldDefaultPath) {
            target.exportPath = newDefaultPath;
        } else {
            target.exportPath = normalizePath(this.swapPathExtension(currentPath, nextFormat));
        }

        await this.plugin.saveSettings();
    }

    private createStatusRow(container: HTMLElement, label: string): { rowEl: HTMLElement; valueEl: HTMLElement } {
        const row = container.createDiv({
            cls: `${ERT_CLASSES.ROW} ${ERT_CLASSES.ROW_COMPACT} ${ERT_CLASSES.ROW_MIDDLE_ALIGN}`
        });
        row.createSpan({ text: label, cls: ERT_CLASSES.LABEL });
        const valueEl = row.createDiv({ cls: ERT_CLASSES.INLINE });
        return { rowEl: row, valueEl };
    }

    private async saveSize() {
        if (this.isCampaignTarget()) return;
        if (!this.plugin.settings.authorProgress) {
            this.plugin.settings.authorProgress = buildDefaultAuthorProgressSettings();
        }
        const settings = this.plugin.settings.authorProgress?.defaults;
        settings.aprSize = this.aprSize;
        await this.plugin.saveSettings();
    }

    private async saveQuality() {
        if (!this.plugin.settings.authorProgress) {
            this.plugin.settings.authorProgress = buildDefaultAuthorProgressSettings();
        }
        const settings = this.plugin.settings.authorProgress?.defaults;
        settings.aprExportQuality = this.exportQuality;
        // Always recompute canonical default path when quality changes
        settings.exportPath = buildDefaultEmbedPath({
            bookTitle: this.plugin.getActiveBookTitle(),
            updateFrequency: settings.updateFrequency,
            aprExportQuality: settings.aprExportQuality,
            exportFormat: this.getDefaultExportFormat()
        });
        await this.plugin.saveSettings();
    }

    private async publish(mode: 'static' | 'dynamic') {
        if (this.isCampaignTarget()) {
            const campaign = this.getSelectedCampaign();
            if (!campaign) {
                new Notice('Campaign not found.');
                return;
            }
            if (mode === 'dynamic') {
                const result = await this.service.generateCampaignReport(campaign.id);
                if (result) {
                    new Notice(`Campaign "${campaign.name}" updated!`);
                } else {
                    new Notice('Failed to publish campaign.');
                }
                return;
            }
            const result = await this.service.generateCampaignSnapshot(campaign.id);
            if (result) {
                new Notice(`Snapshot saved to ${result}`);
            } else {
                new Notice('Failed to create campaign snapshot.');
            }
            return;
        }

        const result = await this.service.generateReport(mode);
        if (result) {
            new Notice(mode === 'dynamic' ? 'Live file updated!' : `Snapshot saved to ${result}`);
        } else {
            new Notice('Failed to generate report.');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
