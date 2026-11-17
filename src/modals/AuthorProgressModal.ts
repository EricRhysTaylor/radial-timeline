import { setAccessibleLabel, setTooltip, withAccessibleLabel } from '../utils/domTooltip';
import { openSettingsTab } from '../utils/obsidianInternals';
import { App, Modal, ButtonComponent, Notice, setIcon } from 'obsidian';
import { renderAprShareFile } from '../ui/aprShareFile';
import type RadialTimelinePlugin from '../main';
import { AuthorProgressService } from '../services/AuthorProgressService';
import type { AuthorProgressCampaign } from '../types/settings';
import { getTeaserThresholds, TEASER_LEVEL_INFO } from '../renderer/apr/AprConstants';
import { ERT_CLASSES } from '../ui/classes';
import { DEFAULT_REPORT_ID, type AprExportQuality } from '../utils/aprPaths';
import { resolveBookTitle, resolveProjectPath } from '../renderer/apr/aprHelpers';
import { aprReportLabel } from '../authorProgress/aprLabels';
import { isSceneItem } from '../utils/sceneHelpers';
import { t, tCount } from '../i18n';

/**
 * Publish an Author Progress report from anywhere in the vault: pick a report,
 * publish it, and drag its image into a post. Each report's settings live in
 * the Social tab; this dialog only publishes and hands off the file.
 */
export class AuthorProgressModal extends Modal {
    private plugin: RadialTimelinePlugin;
    private service: AuthorProgressService;
    private selectedReportId: string = DEFAULT_REPORT_ID;

    private shareSlotEl: HTMLElement | null = null;
    private reportsSectionEl: HTMLElement | null = null;
    private publishButton: ButtonComponent | null = null;

    /** Progress percent of each book a report tracks, keyed by its source folder. */
    private readonly percentByProject = new Map<string, number>();

    constructor(app: App, plugin: RadialTimelinePlugin) {
        super(app);
        this.plugin = plugin;
        this.service = new AuthorProgressService(plugin, app);
    }

    private getReports(): AuthorProgressCampaign[] {
        return this.plugin.settings.authorProgress?.campaigns ?? []; // SAFE: no Social settings yet means there is no report to list
    }

    private getSelectedReport(): AuthorProgressCampaign | undefined {
        const reports = this.getReports();
        return reports.find(report => report.id === this.selectedReportId) ?? reports[0];
    }

    private getProjectPath(report: AuthorProgressCampaign): string {
        return resolveProjectPath(report, this.plugin.settings.books, this.plugin.settings.sourcePath);
    }

    async onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        // Apply shell styling and sizing
        if (modalEl) {
            modalEl.classList.add('ert-modal-shell', 'ert-ui', 'ert-scope--modal', 'ert-modal--social');
        }

        // Standard modal container with glassy styling
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Modal Header with Badge (following modal template pattern)
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });

        // Badge with Radio icon for social media theme
        const badge = header.createSpan({ cls: ERT_CLASSES.MODAL_BADGE });
        const badgeIcon = badge.createSpan({ cls: ERT_CLASSES.MODAL_BADGE_ICON });
        setIcon(badgeIcon, 'radio');
        badge.createSpan({ text: t('ui.authorProgressModal.badge') });

        header.createDiv({ text: t('ui.authorProgressModal.title'), cls: 'ert-modal-title' });
        header.createDiv({ text: t('ui.authorProgressModal.subtitle'), cls: 'ert-modal-subtitle' });

        // The file comes first: handing it off is what this dialog is for.
        this.shareSlotEl = contentEl.createDiv({ cls: 'ert-apr-shareSlot ert-apr-shareSlot--lead' });
        this.reportsSectionEl = contentEl.createDiv({
            cls: `${ERT_CLASSES.PANEL} ert-panel--glass ${ERT_CLASSES.STACK}`
        });

        // Footer actions
        const footer = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const settingsBtn = withAccessibleLabel(new ButtonComponent(footer)
            .setIcon('settings'), t('ui.authorProgressModal.settingsTooltip'))
            .onClick(() => {
                this.close();
                this.plugin.settingsTab?.setActiveTab('social');
                openSettingsTab(this.app);
            });
        settingsBtn.buttonEl.addClass('ert-modal-settings-btn');
        this.publishButton = new ButtonComponent(footer)
            .setButtonText(t('ui.authorProgressModal.publishButton'))
            .setCta()
            .onClick(() => this.publish());
        new ButtonComponent(footer)
            .setButtonText(t('ui.authorProgressModal.closeButton'))
            .onClick(() => this.close());

        await this.loadProgress();
        this.render();
    }

    /** Work out each tracked book's progress once, so every row shows its own stage. */
    private async loadProgress(): Promise<void> {
        for (const report of this.getReports()) {
            const projectPath = this.getProjectPath(report);
            if (this.percentByProject.has(projectPath)) continue;
            const scenes = (await this.plugin.getSceneData({ sourcePath: projectPath })).filter(isSceneItem);
            this.percentByProject.set(projectPath, this.service.resolveProgressState(scenes).percent);
        }
    }

    private render(): void {
        const selected = this.getSelectedReport();
        if (this.shareSlotEl) {
            renderAprShareFile(this.shareSlotEl, {
                app: this.app,
                vaultPath: selected ? this.service.getReportPath(selected) : null
            });
        }
        this.renderReports(selected);
    }

    private renderReports(selected: AuthorProgressCampaign | undefined): void {
        const container = this.reportsSectionEl;
        if (!container) return;
        container.empty();

        const header = container.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
        const headerRow = header.createDiv({ cls: ERT_CLASSES.CONTROL }).createDiv({ cls: ERT_CLASSES.INLINE });
        setIcon(headerRow.createSpan({ cls: ERT_CLASSES.SECTION_ICON }), 'layers');
        headerRow.createEl('h4', { text: t('ui.aprReports.title'), cls: ERT_CLASSES.SECTION_TITLE });

        if (selected && this.service.campaignNeedsRefresh(selected)) {
            const daysSince = this.getDaysSince(selected.lastPublishedDate);
            const alert = container.createDiv({ cls: ERT_CLASSES.INLINE });
            setIcon(alert.createSpan({ cls: ERT_CLASSES.ICON_BADGE }), 'alert-triangle');
            alert.createSpan({
                text: daysSince === null
                    ? t('ui.authorProgressModal.campaignStaleAlertUnknown', { name: aprReportLabel(selected) })
                    : t('ui.authorProgressModal.campaignStaleAlert', { name: aprReportLabel(selected), days: daysSince }),
                cls: 'ert-section-desc ert-section-desc--alert'
            });
        }

        const grid = container.createDiv({ cls: 'ert-apr-status-grid ert-apr-status-grid--with-format' });
        const headerCells = grid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--header' });
        [
            t('ui.authorProgressModal.columnApr'),
            t('ui.authorProgressModal.columnBookTitle'),
            t('ui.authorProgressModal.formatLabel'),
            t('ui.authorProgressModal.columnExport'),
            t('ui.authorProgressModal.columnStage'),
            t('ui.authorProgressModal.columnUpdateIn')
        ].forEach((label, index) => {
            const headerCell = headerCells.createDiv({ text: label, cls: 'ert-apr-status-cell ert-apr-status-cell--header' });
            if (index === 0) setTooltip(headerCell, t('ui.authorProgressModal.aprColumnTooltip'));
        });

        this.getReports().forEach(report => this.renderReportRow(grid, report, report === selected));
    }

    /** One report line. Choosing it makes it the report that Publish writes and the file shown above. */
    private renderReportRow(grid: HTMLElement, report: AuthorProgressCampaign, isSelected: boolean): void {
        const label = aprReportLabel(report);
        const row = grid.createDiv({ cls: 'ert-apr-status-row ert-apr-status-row--data ert-apr-status-row--choice' });
        row.toggleClass('is-selected', isSelected);
        row.setAttr('role', 'button');
        row.setAttr('tabindex', '0');
        row.setAttr('aria-pressed', String(isSelected));
        setAccessibleLabel(row, t('ui.aprReports.chooseReportLabel', { name: label }));
        const choose = () => {
            this.selectedReportId = report.id;
            this.render();
        };
        row.onclick = choose;
        row.onkeydown = (evt: KeyboardEvent) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                choose();
            }
        };

        const pill = (cell: HTMLElement, text: string, extraCls = ''): HTMLElement => {
            const el = cell.createSpan({ cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_SM} ${extraCls}`.trim() });
            el.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text });
            return el;
        };

        row.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--apr' })
            .createSpan({ text: label, cls: 'ert-apr-status-title' });

        const bookLabel = row.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--book' }).createSpan({
            text: resolveBookTitle(report, this.plugin.settings.books, this.plugin.getActiveBookTitle()),
            cls: `${ERT_CLASSES.FIELD_NOTE} ert-apr-status-book`
        });
        setTooltip(bookLabel, t('ui.authorProgressModal.projectTooltip', { path: this.getProjectPath(report) }));

        pill(row.createDiv({ cls: 'ert-apr-status-cell' }), report.exportFormat.toUpperCase(), 'ert-apr-format-pill');
        pill(row.createDiv({ cls: 'ert-apr-status-cell ert-apr-status-cell--export' }), this.getQualityLabel(report.aprExportQuality));

        const stage = this.getStageDisplay(report);
        const stagePill = pill(row.createDiv({ cls: 'ert-apr-status-cell' }), stage.label);
        setIcon(stagePill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON, prepend: true }), stage.icon);
        setTooltip(stagePill, stage.tooltip);

        pill(row.createDiv({ cls: 'ert-apr-status-cell' }), this.getUpdateLabel(report));
    }

    private getQualityLabel(quality: AprExportQuality): string {
        if (quality === 'print') return t('ui.authorProgressModal.qualityPrintShort');
        return quality === 'ultra' ? t('ui.authorProgressModal.qualityUltraShort') : t('ui.authorProgressModal.qualityStandardShort');
    }

    private getDaysSince(date?: string): number | null {
        if (!date) return null;
        const time = new Date(date).getTime();
        if (!Number.isFinite(time)) return null;
        return Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24));
    }

    private formatDays(value: number): string {
        return tCount('day', Math.max(0, Math.round(value)));
    }

    /** When the report next updates on its own, or its reminder for manual posting. */
    private getUpdateLabel(report: AuthorProgressCampaign): string {
        const daysSince = this.getDaysSince(report.lastPublishedDate);
        if (daysSince === null) return t('ui.authorProgressModal.updateUnpublished');
        if (!report.isActive) return t('ui.authorProgressModal.updatePaused');
        if (report.updateFrequency === 'manual') {
            const manual = t('ui.authorProgressModal.manualLabel');
            return report.refreshThresholdDays > 0
                ? `${manual} · ${this.formatDays(report.refreshThresholdDays - daysSince)}`
                : manual;
        }
        const intervalDays = report.updateFrequency === 'daily' ? 1 : report.updateFrequency === 'weekly' ? 7 : 30;
        return this.formatDays(intervalDays - daysSince);
    }

    /** How much of the timeline the report shows now and, with teaser reveal on, when it next opens up. */
    private getStageDisplay(report: AuthorProgressCampaign): { label: string; icon: string; tooltip: string } {
        const percent = this.percentByProject.get(this.getProjectPath(report)) ?? 0; // SAFE: a book added after the dialog opened shows 0% until it is reopened
        const progress = Math.max(0, Math.round(percent));
        const level = this.service.resolveRevealLevel(report, percent);
        const info = TEASER_LEVEL_INFO[level];
        const teaser = report.teaserReveal;
        if (!teaser.enabled) {
            return { label: info.label.toUpperCase(), icon: info.icon, tooltip: t('ui.authorProgressModal.stageTooltipProgress', { progress }) };
        }

        const thresholds = getTeaserThresholds(teaser.preset, teaser.customThresholds);
        const steps = [
            { level: 'scenes', threshold: thresholds.scenes, skipped: !!teaser.disabledStages?.scenes },
            { level: 'colors', threshold: thresholds.colors, skipped: !!teaser.disabledStages?.colors },
            { level: 'full', threshold: thresholds.full, skipped: false },
        ].filter(step => !step.skipped);
        const next = steps[steps.findIndex(step => step.level === level) + 1];
        return next
            ? {
                label: `${info.label.toUpperCase()} ${progress}/${Math.round(next.threshold)}`,
                icon: info.icon,
                tooltip: t('ui.authorProgressModal.stageTooltipNext', { progress, next: Math.round(next.threshold) })
            }
            : { label: info.label.toUpperCase(), icon: info.icon, tooltip: t('ui.authorProgressModal.stageTooltipProgress', { progress }) };
    }

    private async publish(): Promise<void> {
        const report = this.getSelectedReport();
        if (!report) return;
        this.publishButton?.setDisabled(true);
        try {
            const path = await this.service.generateCampaignReport(report.id);
            if (!path) throw new Error(t('ui.campaignManagerSection.renderFailed'));
        } catch (error) {
            new Notice(t('ui.aprReports.publishFailedNotice', {
                message: error instanceof Error ? error.message : String(error)
            }));
        }
        this.publishButton?.setDisabled(false);
        // Show the freshly written file in the share card.
        this.render();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
