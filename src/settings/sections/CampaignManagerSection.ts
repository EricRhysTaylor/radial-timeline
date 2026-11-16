import { setAccessibleLabel, setTooltip, withAccessibleLabel } from '../../utils/domTooltip';
/**
 * Reports list for the Social tab.
 *
 * The Default report and the author's campaigns are the same kind of thing and
 * share one layout. One report is open at a time; the open report shows its
 * preview, its share file, its style (with the designer) and its settings, so
 * every control on screen belongs to the report being looked at.
 */

import { App, Setting, setIcon, ButtonComponent, Notice, DropdownComponent } from 'obsidian';
import { NamePromptModal } from '../../ui/NamePromptModal';
import type RadialTimelinePlugin from '../../main';
import type {
    AprExportFormat,
    AprExportQuality,
    AuthorProgressCampaign,
    AuthorProgressFrequency,
    TeaserPreset,
    TeaserRevealLevel
} from '../../types/settings';
import { AprProgressService } from '../../services/apr/AprProgressService';
import { AprStyleService } from '../../services/apr/AprStyleService';
import { hasProFeatureAccess } from '../featureGate';
import { getTeaserThresholds, getTeaserRevealLevel, teaserLevelToRevealOptions, TEASER_LEVEL_INFO } from '../../renderer/apr/AprConstants';
import { createAprSVG } from '../../renderer/apr/AprRenderer';
import { DEFAULT_REPORT_ID } from '../../utils/aprPaths';
import { resolveBookTitle, resolveProjectPath } from '../../renderer/apr/aprHelpers';
import { isSceneItem } from '../../utils/sceneHelpers';
import { DEFAULT_STYLE_ID, buildNewCampaign } from '../../authorProgress/authorProgressConfig';
import { aprReportLabel, aprStyleLabel } from '../../authorProgress/aprLabels';

import { ERT_CLASSES } from '../../ui/classes';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { mountSvgPreview } from '../../utils/svgDom';
import { getActiveBook } from '../../utils/books';
import { AuthorProgressService } from '../../services/AuthorProgressService';
import { canShareAprToCommunity, normalizeCommunityShareSettings } from '../../communityShare/communityShareSettings';
import { findCommunityBookConflict, moveCommunitySending, resolveCampaignBookId } from '../../authorProgress/campaignCommunityBinding';
import { confirmWithErtModal } from '../../modals/ErtConfirmModal';
import { renderAprShareFile } from '../../ui/aprShareFile';
import { renderAprStyleDesigner } from './authorProgress/AprStyleDesigner';
import { t } from '../../i18n';

export interface CampaignManagerProps {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

/** What a report row needs from the list it sits in. */
interface ReportListContext {
    app: App;
    plugin: RadialTimelinePlugin;
    service: AuthorProgressService;
    styleService: AprStyleService;
    /** Redraw the whole list after a change to a report's settings. */
    rerender: () => void;
}

/**
 * The report whose settings are open. Kept for the session so the tab reopens
 * where the author left it; a new session starts on Default.
 */
let openReportId: string | null = DEFAULT_REPORT_ID;

const CAMPAIGN_TEMPLATES = [
    { name: 'Kickstarter', icon: 'rocket', days: 7 },
    { name: 'Patreon', icon: 'heart', days: 14 },
    { name: 'Newsletter', icon: 'mail', days: 14 },
    { name: 'Website', icon: 'globe', days: 30 },
];

const VIEW_MODES: TeaserRevealLevel[] = ['full', 'colors', 'scenes', 'ring'];

function getDaysSince(date?: string): number | null {
    if (!date) return null;
    const time = new Date(date).getTime();
    if (!Number.isFinite(time)) return null;
    return Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24));
}

function getNextUpdateLabel(campaign: AuthorProgressCampaign): string {
    if (!campaign.isActive) return t('ui.campaignManagerSection.statusPaused');
    if (!campaign.lastPublishedDate?.trim()) return t('ui.campaignManagerSection.unpublished');

    const daysSince = getDaysSince(campaign.lastPublishedDate) ?? 0; // SAFE: an unreadable date counts as published today, so no reminder fires on bad data
    if (campaign.updateFrequency === 'manual') {
        if (campaign.refreshThresholdDays <= 0) return t('ui.campaignManagerSection.manualNoReminder');
        const remaining = Math.max(0, campaign.refreshThresholdDays - daysSince);
        return remaining === 0 ? t('ui.campaignManagerSection.reminderDue') : t('ui.campaignManagerSection.reminderIn', { days: remaining });
    }

    const intervalDays = campaign.updateFrequency === 'daily' ? 1 : campaign.updateFrequency === 'weekly' ? 7 : 30;
    const remaining = Math.max(0, intervalDays - daysSince);
    return remaining === 0 ? t('ui.campaignManagerSection.autoUpdateDue') : t('ui.campaignManagerSection.autoUpdateIn', { days: remaining });
}

/**
 * Render the reports list. Returns a function that redraws it, for settings
 * outside the list that change what every report shows.
 */
export function renderCampaignManagerSection({ app, plugin, containerEl }: CampaignManagerProps): () => void {
    const styleService = new AprStyleService(plugin);
    const authorProgress = styleService.ensureAuthorProgressSettings();
    const service = new AuthorProgressService(plugin, app);

    const card = containerEl.createDiv({ cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-campaign-card` });
    const headerRow = card.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
    const titleArea = headerRow.createDiv({ cls: ERT_CLASSES.CONTROL });
    const titleRow = titleArea.createEl('h4', { cls: `${ERT_CLASSES.SECTION_TITLE} ${ERT_CLASSES.INLINE} ert-campaign-title` });
    titleRow.createSpan({ text: t('ui.aprReports.title') });
    card.createEl('p', {
        text: t('ui.aprReports.desc'),
        cls: `${ERT_CLASSES.SECTION_DESC} ert-campaign-desc`
    });

    const listContainer = card.createDiv({ cls: `${ERT_CLASSES.STACK} ert-campaign-list` });
    const addSection = card.createDiv({ cls: 'ert-campaign-add-section' });
    const templatesSection = card.createDiv({ cls: 'ert-campaign-templates' });

    const addCampaign = async (name: string, reminderDays: number): Promise<void> => {
        const campaign = buildNewCampaign(name, reminderDays);
        authorProgress.campaigns.push(campaign);
        openReportId = campaign.id;
        await plugin.saveSettings();
        new Notice(t('ui.campaignManagerSection.createdNotice', { name }));
        rerender();
    };
    const nameTaken = (name: string): boolean =>
        authorProgress.campaigns.some(c => c.name.toLowerCase() === name.toLowerCase());

    const rerender = (): void => {
        listContainer.empty();
        const context: ReportListContext = { app, plugin, service, styleService, rerender };
        authorProgress.campaigns.forEach(report => renderReportRow(listContainer, report, context));

        templatesSection.empty();
        templatesSection.createEl('h5', { text: t('ui.campaignManagerSection.presetsKicker'), cls: 'ert-kicker' });
        const templateRow = templatesSection.createDiv({ cls: ERT_CLASSES.INLINE });
        CAMPAIGN_TEMPLATES.forEach(template => {
            const btn = templateRow.createEl('button', {
                cls: `${ERT_CLASSES.PILL_BTN} ${ERT_CLASSES.PILL_BTN_SOCIAL}`,
                attr: { type: 'button' }
            });
            setIcon(btn.createSpan({ cls: ERT_CLASSES.PILL_BTN_ICON }), template.icon);
            btn.createSpan({ cls: ERT_CLASSES.PILL_BTN_LABEL, text: template.name });
            if (nameTaken(template.name)) {
                btn.addClass(ERT_CLASSES.PILL_BTN_USED);
                btn.disabled = true;
                return;
            }
            btn.onclick = () => { void addCampaign(template.name, template.days); };
        });
    };

    new Setting(addSection.createDiv({ cls: 'ert-campaign-add-row' }))
        .setName(t('ui.campaignManagerSection.newCampaignTitle'))
        .setDesc(t('ui.campaignManagerSection.newCampaignDesc'))
        .addButton(button => {
            button.setButtonText(t('ui.campaignManagerSection.addCampaignButton'));
            button.onClick(() => {
                new NamePromptModal(app, {
                    badge: t('ui.campaignManagerSection.newBadge'),
                    placeholder: t('ui.campaignManagerSection.campaignNamePlaceholder'),
                    emptyNotice: t('ui.campaignManagerSection.emptyNameNotice'),
                    title: t('ui.campaignManagerSection.newCampaignTitle'),
                    subtitle: t('ui.campaignManagerSection.newCampaignSubtitle'),
                    initialValue: '',
                    actionLabel: t('ui.campaignManagerSection.createAction'),
                    onSubmit: async (name) => {
                        if (nameTaken(name)) {
                            new Notice(t('ui.campaignManagerSection.duplicateNameNotice'));
                            return false;
                        }
                        await addCampaign(name, 7);
                        return true;
                    }
                }).open();
            });
        });

    rerender();
    return rerender;
}

/**
 * Render one report: its row, and its settings when it is the open one.
 */
function renderReportRow(container: HTMLElement, campaign: AuthorProgressCampaign, context: ReportListContext): void {
    const { plugin, service, rerender } = context;
    const isDefault = campaign.id === DEFAULT_REPORT_ID;
    const isOpen = openReportId === campaign.id;
    const needsRefresh = service.campaignNeedsRefresh(campaign);
    const label = aprReportLabel(campaign);

    // Create a wrapper to contain both the row and expandable details
    const wrapper = container.createDiv({ cls: 'ert-campaign-wrapper' });

    const rowClasses: string[] = [ERT_CLASSES.OBJECT_ROW];
    if (needsRefresh) rowClasses.push('is-needs-refresh');
    if (!campaign.isActive) rowClasses.push('is-inactive');
    if (isOpen) rowClasses.push('is-expanded');

    const row = wrapper.createDiv({ cls: rowClasses.join(' ') });
    const rowLeft = row.createDiv({ cls: ERT_CLASSES.OBJECT_ROW_LEFT });

    // Status indicator
    const titleRow = rowLeft.createDiv({ cls: `${ERT_CLASSES.INLINE} ert-campaign-title-row` });
    const statusIndicator = titleRow.createDiv({ cls: 'ert-campaign-status' });
    if (needsRefresh) {
        setIcon(statusIndicator, 'alert-triangle');
        setTooltip(statusIndicator, t('ui.campaignManagerSection.refreshNeededTooltip'));
    } else if (campaign.isActive) {
        setIcon(statusIndicator, 'check-circle');
        setTooltip(statusIndicator, t('ui.campaignManagerSection.upToDateTooltip'));
    } else {
        setIcon(statusIndicator, 'pause-circle');
        setAccessibleLabel(statusIndicator, t('ui.campaignManagerSection.statusPaused'));
    }

    const nameEl = titleRow.createSpan({
        text: label,
        cls: `ert-campaign-name ${campaign.isActive ? 'is-active' : 'is-paused'}`
    });
    // The Default report keeps its name; campaigns rename on click.
    if (!isDefault) {
        nameEl.addClass('ert-campaign-name--clickable');
        setTooltip(nameEl, t('ui.campaignManagerSection.renameTooltip'));
        nameEl.setAttr('role', 'button');
        nameEl.setAttr('tabindex', '0');
        setAccessibleLabel(nameEl, t('ui.campaignManagerSection.renameAriaLabel', { name: campaign.name }));
        const openRenameModal = () => {
            new NamePromptModal(plugin.app, {
                badge: t('ui.campaignManagerSection.editBadge'),
                placeholder: t('ui.campaignManagerSection.campaignNamePlaceholder'),
                emptyNotice: t('ui.campaignManagerSection.emptyNameNotice'),
                title: t('ui.campaignManagerSection.renameTitle'),
                subtitle: t('ui.campaignManagerSection.renameSubtitle', { name: campaign.name }),
                initialValue: campaign.name,
                actionLabel: t('ui.campaignManagerSection.renameAction'),
                onSubmit: async (nextName) => {
                    const newName = nextName.trim();
                    if (newName.toLowerCase() === campaign.name.toLowerCase()) return true;
                    const taken = plugin.settings.authorProgress?.campaigns.some(c => c.name.toLowerCase() === newName.toLowerCase());
                    if (taken) {
                        new Notice(t('ui.campaignManagerSection.duplicateNameNotice'));
                        return false;
                    }
                    campaign.name = newName;
                    await plugin.saveSettings();
                    rerender();
                    return true;
                }
            }).open();
        };
        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        nameEl.addEventListener('click', openRenameModal);
        // SAFE: Settings sections are standalone functions without Component lifecycle
        nameEl.addEventListener('keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                openRenameModal();
            }
        });
    }

    titleRow.createSpan({
        text: resolveBookTitle(campaign, plugin.settings.books, plugin.getActiveBookTitle()),
        cls: 'ert-campaign-refresh-badge is-book'
    });

    // Last published info
    const lastPublished = campaign.lastPublishedDate
        ? t('ui.campaignManagerSection.updatedOn', { date: new Date(campaign.lastPublishedDate).toLocaleDateString() })
        : t('ui.campaignManagerSection.neverPublished');
    rowLeft.createSpan({ text: lastPublished, cls: `${ERT_CLASSES.OBJECT_ROW_META} ert-campaign-last-published` });
    const nextUpdateEl = rowLeft.createSpan({
        text: getNextUpdateLabel(campaign),
        cls: `${ERT_CLASSES.OBJECT_ROW_META} ert-campaign-next-update`
    });

    // Actions
    const actions = row.createDiv({ cls: ERT_CLASSES.OBJECT_ROW_ACTIONS });
    const actionGroup = actions.createDiv({ cls: ERT_CLASSES.ICON_BTN_GROUP });

    if (!isDefault) {
        const toggleBtn = actionGroup.createEl('button', { cls: ERT_CLASSES.ICON_BTN, attr: { type: 'button' } });
        setIcon(toggleBtn, campaign.isActive ? 'pause' : 'play');
        toggleBtn.addClass(campaign.isActive ? 'ert-iconBtn--active' : 'ert-iconBtn--paused');
        setAccessibleLabel(toggleBtn, campaign.isActive ? t('ui.campaignManagerSection.pauseTooltip') : t('ui.campaignManagerSection.resumeTooltip'));
        toggleBtn.onclick = async () => {
            campaign.isActive = !campaign.isActive;
            await plugin.saveSettings();
            rerender();
        };
    }

    // Open or close this report's settings. Opening one closes the other.
    const openBtn = actionGroup.createEl('button', { cls: ERT_CLASSES.ICON_BTN, attr: { type: 'button' } });
    setIcon(openBtn, isOpen ? 'chevron-down' : 'chevron-right');
    setAccessibleLabel(openBtn, isOpen ? t('ui.aprReports.closeLabel', { name: label }) : t('ui.aprReports.openLabel', { name: label }));
    openBtn.onclick = () => {
        openReportId = isOpen ? null : campaign.id;
        rerender();
    };

    if (!isDefault) {
        const deleteBtn = actionGroup.createEl('button', { cls: `${ERT_CLASSES.ICON_BTN} ert-iconBtn--danger`, attr: { type: 'button' } });
        setIcon(deleteBtn, 'trash-2');
        setAccessibleLabel(deleteBtn, t('ui.campaignManagerSection.deleteTooltip'));
        deleteBtn.onclick = async () => {
            const campaigns = plugin.settings.authorProgress?.campaigns;
            if (!campaigns) return;
            campaigns.splice(campaigns.indexOf(campaign), 1);
            if (isOpen) openReportId = null;
            await plugin.saveSettings();
            new Notice(t('ui.campaignManagerSection.deletedNotice', { name: campaign.name }));
            rerender();
        };
    }

    if (isOpen) {
        renderReportDetails(wrapper, campaign, context, nextUpdateEl);
    }
}

/**
 * The open report: preview and share file, style, then its settings.
 */
function renderReportDetails(
    parentRow: HTMLElement,
    campaign: AuthorProgressCampaign,
    context: ReportListContext,
    nextUpdateEl: HTMLElement
): void {
    const { app, plugin, service, styleService, rerender } = context;
    const details = parentRow.createDiv({ cls: `ert-campaign-details ${ERT_CLASSES.STACK}` });
    const label = aprReportLabel(campaign);
    const save = async (): Promise<void> => {
        await plugin.saveSettings();
        rerender();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // PREVIEW + SHARE FILE
    // The preview is the published drawing, scaled down to fit.
    // ─────────────────────────────────────────────────────────────────────────
    const previewCard = details.createDiv({ cls: 'ert-apr-previewCard' });
    const previewContainer = previewCard.createDiv({ cls: `ert-apr-preview-frame ert-apr-preview--actual ${ERT_CLASSES.PREVIEW_FRAME} ert-previewFrame--flush` });
    const previewSide = previewCard.createDiv({ cls: `${ERT_CLASSES.STACK} ert-apr-previewSide` });
    const statusLine = previewSide.createDiv({ cls: 'ert-apr-previewStatus' });
    statusLine.setText(t('settings.authorProgress.preview.lastUpdate', {
        date: campaign.lastPublishedDate
            ? new Date(campaign.lastPublishedDate).toLocaleDateString()
            : t('settings.authorProgress.preview.lastUpdateNever')
    }));
    statusLine.toggleClass('is-alert', service.campaignNeedsRefresh(campaign));
    renderAprShareFile(previewSide.createDiv({ cls: 'ert-apr-shareSlot' }), { app, vaultPath: service.getReportPath(campaign) });

    const refreshPreview = (): void => { void renderReportPreview(previewContainer, service, campaign.id); };
    refreshPreview();

    const previewControls = previewSide.createDiv({ cls: `${ERT_CLASSES.INLINE} ert-apr-previewControls` });
    const publishBtn = new ButtonComponent(previewControls)
        .setButtonText(t('ui.authorProgressModal.publishButton'))
        .setCta()
        .onClick(async () => {
            publishBtn.setDisabled(true);
            try {
                const path = await service.generateCampaignReport(campaign.id);
                if (!path) throw new Error(t('ui.campaignManagerSection.renderFailed'));
            } catch (error) {
                new Notice(t('ui.aprReports.publishFailedNotice', {
                    message: error instanceof Error ? error.message : String(error)
                }));
            }
            rerender();
        });
    publishBtn.buttonEl.addClass('ert-apr-publish-btn');
    setTooltip(publishBtn.buttonEl, t('ui.aprReports.publishTooltip', { name: label }));

    // Redrawn in place when the style changes, so the designer keeps its focus.
    const styleRefreshers: Array<() => void> = [refreshPreview];

    // ─────────────────────────────────────────────────────────────────────────
    // STYLE
    // Every report names a saved style. The designer edits that style directly.
    // ─────────────────────────────────────────────────────────────────────────
    const profile = styleService.getReportStyle(campaign);
    const otherUsers = styleService.getStyleUsers(profile.id).filter(report => report.id !== campaign.id);
    const styleBlock = details.createDiv({ cls: `${ERT_CLASSES.STACK} ert-campaign-style-block` });
    const styleSetting = new Setting(styleBlock)
        .setName(t('ui.aprReports.styleName'))
        .setDesc(otherUsers.length > 0
            ? t('ui.aprReports.styleSharedDesc', { names: otherUsers.map(aprReportLabel).join(', ') })
            : t('ui.aprReports.styleOwnDesc'));
    styleSetting.settingEl.addClass('ert-apr-styleRow');
    styleSetting.controlEl.addClass(ERT_CLASSES.INLINE);

    const styleDropdown = new DropdownComponent(styleSetting.controlEl);
    styleDropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected', 'ert-typography-select');
    styleService.getProfiles().forEach(entry => { styleDropdown.addOption(entry.id, aprStyleLabel(entry)); });
    styleDropdown.setValue(profile.id);
    fitSelectToSelectedLabel(styleDropdown.selectEl, { minPx: 120, extraPx: 18 });
    styleDropdown.onChange(async (val) => {
        campaign.styleProfileId = val;
        await save();
    });

    new ButtonComponent(styleSetting.controlEl)
        .setButtonText(t('ui.campaignManagerSection.saveAsNewButton'))
        .onClick(() => {
            new NamePromptModal(app, {
                badge: t('ui.campaignManagerSection.styleBadge'),
                placeholder: t('ui.campaignManagerSection.styleNamePlaceholder'),
                emptyNotice: t('ui.campaignManagerSection.emptyStyleNameNotice'),
                title: t('ui.aprReports.saveStyleTitle'),
                subtitle: t('ui.aprReports.saveStyleSubtitle', { name: aprStyleLabel(profile), report: label }),
                initialValue: '',
                actionLabel: t('common.save'),
                onSubmit: async (value) => {
                    const name = value.trim();
                    if (styleService.findProfileByName(name)) {
                        new Notice(t('ui.aprReports.duplicateStyleNotice'));
                        return false;
                    }
                    const copy = styleService.duplicateStyle(profile.id, name);
                    if (!copy) return false;
                    campaign.styleProfileId = copy.id;
                    new Notice(t('ui.campaignManagerSection.savedStyleNotice', { name: copy.name }));
                    await save();
                    return true;
                }
            }).open();
        });

    if (profile.id !== DEFAULT_STYLE_ID) {
        const deleteStyleBtn = withAccessibleLabel(styleSetting.controlEl.createEl('button', {
            cls: `${ERT_CLASSES.ICON_BTN} ert-iconBtn--danger`,
            attr: { type: 'button' }
        }), t('ui.aprReports.deleteStyleLabel', { name: profile.name }));
        setIcon(deleteStyleBtn, 'trash-2');
        deleteStyleBtn.onclick = async () => {
            const confirmed = await confirmWithErtModal(app, {
                title: t('ui.campaignManagerSection.deleteStyleTitle'),
                message: t('ui.aprReports.deleteStyleMessage', { name: profile.name }),
                confirmText: t('ui.campaignManagerSection.deleteButton'),
            });
            if (!confirmed || !styleService.deleteStyle(profile.id)) return;
            new Notice(t('ui.campaignManagerSection.deletedStyleNotice', { name: profile.name }));
            await save();
        };
    }

    const designerToggle = styleSetting.controlEl.createEl('button', { cls: ERT_CLASSES.ICON_BTN, attr: { type: 'button' } });
    const designerEl = styleBlock.createDiv({ cls: 'ert-apr-designer' });
    renderAprStyleDesigner(designerEl, {
        app,
        plugin,
        profileId: profile.id,
        onStyleChange: () => styleRefreshers.forEach(fn => fn())
    });
    const refreshDesignerToggle = (): void => {
        const expanded = plugin.settings.authorProgress?.defaults.aprStylingExpanded ?? false; // SAFE: the designer starts closed until the author opens it
        setIcon(designerToggle, expanded ? 'chevron-down' : 'chevron-right');
        setAccessibleLabel(designerToggle, expanded ? t('ui.authorProgressSection.hideStyling') : t('ui.authorProgressSection.showStyling'));
        designerEl.toggleClass('ert-settings-hidden', !expanded);
    };
    refreshDesignerToggle();
    designerToggle.onclick = async () => {
        const defaults = plugin.settings.authorProgress?.defaults;
        if (!defaults) return;
        defaults.aprStylingExpanded = !(defaults.aprStylingExpanded ?? false); // SAFE: the designer starts closed until the author opens it
        refreshDesignerToggle();
        await plugin.saveSettings();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // BOOK (a chosen book, or follow the active book)
    // ─────────────────────────────────────────────────────────────────────────
    const books = plugin.settings.books;
    const activeLabel = getActiveBook(plugin.settings)?.title?.trim() || t('ui.campaignManagerSection.untitled');

    if (books.length > 1) {
        const bookSetting = new Setting(details)
            .setName(t('ui.campaignManagerSection.bookName'))
            .setDesc(t('ui.campaignManagerSection.bookDesc'));

        const bookDropdown = new DropdownComponent(bookSetting.controlEl);
        bookDropdown.selectEl.addClass('ert-input', 'ert-input--lg');
        bookDropdown.addOption('', t('ui.campaignManagerSection.activeBookOption', { title: activeLabel }));
        for (const book of books) {
            bookDropdown.addOption(book.id, book.title?.trim() || t('ui.campaignManagerSection.untitled'));
        }
        bookDropdown.setValue(campaign.targetBookId ?? '');
        bookDropdown.onChange(async (val) => {
            if (campaign.sendToCommunity) {
                // "Active book" would let a book switch silently change what
                // publishes, and a book already claimed by another sharing
                // campaign would overwrite its APR on My Share.
                if (!val) {
                    new Notice(t('ui.campaignManagerSection.explicitBookNotice'));
                    bookDropdown.setValue(campaign.targetBookId ?? '');
                    return;
                }
                const conflict = findCommunityBookConflict(plugin.settings, { id: campaign.id, targetBookId: val });
                if (conflict) {
                    new Notice(t('ui.campaignManagerSection.bookConflictNotice', { name: conflict.name }));
                    bookDropdown.setValue(campaign.targetBookId ?? '');
                    return;
                }
            }
            campaign.targetBookId = val || undefined;
            await save();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FILE: format and export quality
    // ─────────────────────────────────────────────────────────────────────────
    new Setting(details)
        .setName(t('ui.aprReports.formatName'))
        .setDesc(t('ui.aprReports.formatDesc'))
        .addDropdown(drop => {
            drop.selectEl.addClass('ert-input', 'ert-input--md');
            drop.addOption('png', 'PNG');
            drop.addOption('svg', 'SVG');
            drop.setValue(campaign.exportFormat);
            drop.onChange(async (val) => {
                campaign.exportFormat = val as AprExportFormat; // SAFE: the dropdown offers only the two export formats
                await save();
            });
        });

    const exportQualitySetting = new Setting(details)
        .setName(t('ui.campaignManagerSection.exportQualityName'))
        .addDropdown(drop => {
            drop.selectEl.addClass('ert-input', 'ert-input--md');
            drop.addOption('standard', t('ui.campaignManagerSection.qualityStandard'));
            drop.addOption('ultra', t('ui.campaignManagerSection.qualityUltra'));
            drop.addOption('print', t('ui.campaignManagerSection.qualityPrint'));
            drop.setValue(campaign.aprExportQuality);
            drop.onChange(async (val) => {
                campaign.aprExportQuality = val as AprExportQuality; // SAFE: the dropdown offers only the three export qualities
                await save();
            });
        });
    exportQualitySetting.descEl.empty();
    [
        t('ui.campaignManagerSection.qualityStandardDesc'),
        t('ui.campaignManagerSection.qualityUltraDesc'),
        t('ui.campaignManagerSection.qualityPrintDesc')
    ].forEach(line => {
        exportQualitySetting.descEl.createDiv({ text: line });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SCHEDULE: posting mode, with the reminder for manual posting
    // ─────────────────────────────────────────────────────────────────────────
    new Setting(details)
        .setName(t('ui.campaignManagerSection.postingModeName'))
        .setDesc(t('ui.campaignManagerSection.postingModeDesc'))
        .addDropdown(drop => {
            drop.selectEl.addClass('ert-input', 'ert-input--md');
            drop
                .addOption('manual', t('ui.campaignManagerSection.frequencyManual'))
                .addOption('daily', t('settings.authorProgress.publishing.frequencyDaily'))
                .addOption('weekly', t('settings.authorProgress.publishing.frequencyWeekly'))
                .addOption('monthly', t('settings.authorProgress.publishing.frequencyMonthly'))
                .setValue(campaign.updateFrequency)
                .onChange(async (val) => {
                    campaign.updateFrequency = val as AuthorProgressFrequency; // SAFE: the dropdown offers only the four posting modes
                    await save();
                });
        });

    // The reminder only means something when the author posts by hand.
    if (campaign.updateFrequency === 'manual') {
        const refreshMin = 1;
        const refreshMax = 90;
        const clampRefreshValue = (value: number) => Math.min(refreshMax, Math.max(refreshMin, Math.round(value)));
        const reminderSetting = new Setting(details)
            .setName(t('ui.campaignManagerSection.reminderName'))
            .setDesc(t('ui.campaignManagerSection.reminderDesc'));
        const sliderEl = reminderSetting.controlEl.createEl('input', {
            type: 'range',
            attr: { min: String(refreshMin), max: String(refreshMax), step: '1', value: String(campaign.refreshThresholdDays) }
        });
        const refreshValueInput = withAccessibleLabel(reminderSetting.controlEl.createEl('input', {
            type: 'number',
            cls: 'ert-input ert-input--2digit',
            value: String(campaign.refreshThresholdDays),
            attr: { min: String(refreshMin), max: String(refreshMax), step: '1' }
        }), t('ui.campaignManagerSection.refreshThresholdAriaLabel'));

        // Saved without redrawing the list, so the slider keeps its grip.
        const commitRefreshValue = async (val: number) => {
            const nextValue = clampRefreshValue(val);
            campaign.refreshThresholdDays = nextValue;
            await plugin.saveSettings();
            refreshValueInput.value = String(nextValue);
            sliderEl.value = String(nextValue);
            nextUpdateEl.setText(getNextUpdateLabel(campaign));
        };

        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        sliderEl.addEventListener('input', () => {
            refreshValueInput.value = String(clampRefreshValue(Number(sliderEl.value)));
        });
        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        sliderEl.addEventListener('change', () => {
            void commitRefreshValue(Number(sliderEl.value));
        });
        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        refreshValueInput.addEventListener('blur', () => {
            const parsed = Number(refreshValueInput.value);
            void commitRefreshValue(Number.isFinite(parsed) ? parsed : campaign.refreshThresholdDays);
        });
        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        refreshValueInput.addEventListener('keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Enter') { evt.preventDefault(); refreshValueInput.blur(); }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMMUNITY: Level 2+ authors can send this report to My Share without
    // enabling writing-activity summaries.
    // ─────────────────────────────────────────────────────────────────────────
    const communitySettings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    const canSendToCommunity = canShareAprToCommunity(communitySettings);
    const communityStatus = campaign.lastCommunityUploadError
        ? t('ui.campaignManagerSection.lastSendFailed', { error: campaign.lastCommunityUploadError })
        : campaign.lastCommunityUploadedAt
            ? (campaign.lastCommunityUploadStatus === 'active'
                ? t('ui.campaignManagerSection.publicAprRefreshed', { date: new Date(campaign.lastCommunityUploadedAt).toLocaleString() })
                : t('ui.campaignManagerSection.privateAprSent', { date: new Date(campaign.lastCommunityUploadedAt).toLocaleString() }))
            : t('ui.campaignManagerSection.noAprSent');
    // Another campaign sending this book now: named up front, so the toggle's
    // offer to move sending here is no surprise.
    const holder = !campaign.sendToCommunity && canSendToCommunity
        ? findCommunityBookConflict(plugin.settings, campaign)
        : undefined;
    const sendDesc = canSendToCommunity
        ? t('ui.campaignManagerSection.sendToCommunityDesc', { status: communityStatus })
        : t('ui.campaignManagerSection.sendToCommunityLocked');
    new Setting(details)
        .setName(t('ui.campaignManagerSection.sendToCommunityName'))
        .setDesc(holder
            ? `${sendDesc} ${t('ui.campaignManagerSection.sendToCommunityHeldBy', { name: aprReportLabel(holder) })}`
            : sendDesc)
        .addToggle((toggle) => toggle
            .setValue(campaign.sendToCommunity ?? false) // SAFE: fail-closed privacy default — the toggle renders off until the author opts in
            // A lower sharing level blocks enabling this destination, but an
            // already-enabled campaign must remain switchable off.
            .setDisabled(!canSendToCommunity && !(campaign.sendToCommunity ?? false)) // SAFE: fail-closed privacy default — a campaign that never opted in counts as not sharing
            .onChange(async (value) => {
                if (value && !canSendToCommunity) return;
                if (value) {
                    const bookId = resolveCampaignBookId(plugin.settings, campaign);
                    if (!bookId) {
                        new Notice(t('ui.campaignManagerSection.chooseBookNotice'));
                        toggle.setValue(false);
                        return;
                    }
                    const conflict = findCommunityBookConflict(plugin.settings, campaign);
                    if (conflict) {
                        // My Share keeps one APR per book: offer to move sending
                        // here rather than refuse. Both flags flip in one save.
                        // Cancelling leaves both campaigns as they were.
                        const confirmed = await confirmWithErtModal(plugin.app, {
                            title: t('ui.campaignManagerSection.moveSendingTitle'),
                            message: t('ui.campaignManagerSection.moveSendingMessage', { to: label, from: aprReportLabel(conflict) }),
                            confirmText: t('ui.campaignManagerSection.moveSendingConfirm'),
                        });
                        if (!confirmed || !moveCommunitySending(plugin.settings, campaign.id, conflict.id)) {
                            toggle.setValue(false);
                            return;
                        }
                        await save();
                        return;
                    }
                    // Pin the resolved book. A campaign that publishes publicly
                    // must not silently retarget when the active book changes.
                    campaign.targetBookId = bookId;
                }
                campaign.sendToCommunity = value;
                await save();
            }))
        .addButton(button => button
            .setButtonText(t('ui.campaignManagerSection.sendNowButton'))
            .setDisabled(!canSendToCommunity || !(campaign.sendToCommunity ?? false)) // SAFE: fail-closed privacy default — a campaign that never opted in counts as not sharing
            .onClick(async () => {
                button.setDisabled(true);
                button.setButtonText(t('ui.campaignManagerSection.sendingButton'));
                try {
                    const status = await service.sendCampaignToCommunity(campaign.id);
                    if (!status) throw new Error(t('ui.campaignManagerSection.renderFailed'));
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : t('ui.campaignManagerSection.sendFailed'));
                }
                rerender();
            }));

    // ─────────────────────────────────────────────────────────────────────────
    // TEASER REVEAL (Progressive Reveal), or one fixed view when it is off
    // ─────────────────────────────────────────────────────────────────────────
    const teaserSection = details.createDiv({ cls: 'ert-campaign-teaser-section' });
    const teaserContentContainer = teaserSection.createDiv({ cls: `${ERT_CLASSES.STACK} ert-teaser` });
    const teaser = campaign.teaserReveal;

    const teaserToggleSetting = new Setting(teaserContentContainer)
        .setName(t('ui.campaignManagerSection.teaserRevealName'))
        .setDesc(t('ui.campaignManagerSection.teaserRevealDesc'))
        .addToggle(toggle => {
            toggle.setValue(teaser.enabled)
                .onChange(async (val) => {
                    teaser.enabled = val;
                    await save();
                });
        });
    const teaserIcon = teaserToggleSetting.nameEl.createSpan({ cls: 'ert-teaser__icon' });
    setIcon(teaserIcon, 'calendar-clock');
    teaserToggleSetting.nameEl.prepend(teaserIcon);

    if (!teaser.enabled) {
        new Setting(teaserContentContainer)
            .setName(t('ui.aprReports.viewName'))
            .setDesc(t('ui.aprReports.viewDesc'))
            .addDropdown(drop => {
                drop.selectEl.addClass('ert-input', 'ert-input--md');
                VIEW_MODES.forEach(mode => { drop.addOption(mode, TEASER_LEVEL_INFO[mode].label); });
                drop.setValue(campaign.viewMode);
                drop.onChange(async (val) => {
                    campaign.viewMode = val as TeaserRevealLevel; // SAFE: the dropdown offers only the four reveal levels
                    await save();
                });
            });
        return;
    }

    const scheduleContainer = teaserContentContainer.createDiv({
        cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-teaser__schedule`
    });

    // Row 1: Label + Dropdown (always shown)
    const scheduleRow = scheduleContainer.createDiv({ cls: `${ERT_CLASSES.INLINE} ert-teaser__scheduleRow` });
    scheduleRow.createSpan({ text: t('ui.campaignManagerSection.revealScheduleLabel'), cls: 'ert-teaser__scheduleLabel' });

    const presetSelect = scheduleRow.createEl('select', { cls: 'ert-teaser__preset ert-input ert-input--lg' });
    const presetOptions: Array<{ value: TeaserPreset; label: string }> = [
        { value: 'slow', label: t('ui.campaignManagerSection.presetSlow') },
        { value: 'standard', label: t('ui.campaignManagerSection.presetStandard') },
        { value: 'fast', label: t('ui.campaignManagerSection.presetFast') },
        { value: 'custom', label: t('ui.campaignManagerSection.presetCustom') },
    ];
    presetOptions.forEach(opt => {
        const optEl = presetSelect.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === teaser.preset) optEl.selected = true;
    });
    presetSelect.onchange = async () => {
        const next = presetSelect.value as TeaserPreset; // SAFE: the select offers only the four presets
        // Custom starts from the thresholds of the preset it replaces.
        if (next === 'custom' && !teaser.customThresholds) {
            teaser.customThresholds = { ...getTeaserThresholds(teaser.preset, undefined) };
        }
        teaser.preset = next;
        await save();
    };

    // Row 2: Custom inputs (4-column grid to align with 4 previews below)
    if (teaser.preset === 'custom') {
        const customThresholds = teaser.customThresholds ?? { scenes: 10, colors: 30, full: 60 }; // SAFE: the standard thresholds, shown until the author saves their own
        const customRow = scheduleContainer.createDiv({ cls: 'ert-teaser__customRow' });

        // Column 1: Save button (aligns with TEASER preview)
        const saveBtn = customRow.createDiv({ cls: 'ert-teaser__saveCell' }).createEl('button', {
            text: t('common.save'),
            attr: { type: 'button' }
        });

        // Columns 2-4: Input fields (align with SCENES, COLORS, FULL)
        const fields: { key: 'scenes' | 'colors' | 'full'; label: string }[] = [
            { key: 'scenes', label: t('settings.authorProgress.preview.teaserScenes') },
            { key: 'colors', label: t('ui.campaignManagerSection.fieldColors') },
            { key: 'full', label: t('ui.campaignManagerSection.fieldFull') },
        ];

        const inputs: Record<string, HTMLInputElement> = {};
        fields.forEach(({ key, label: fieldLabel }) => {
            const field = customRow.createDiv({ cls: 'ert-teaser__field' });
            field.createSpan({ text: fieldLabel, cls: 'ert-teaser__fieldLabel' });
            const input = field.createEl('input', {
                type: 'text',
                cls: 'ert-teaser__fieldInput',
                value: String(customThresholds[key])
            });
            input.maxLength = 2;
            input.onblur = () => {
                const val = parseInt(input.value) || 0;
                if (val < 1) input.value = '1';
                else if (val > 99) input.value = '99';
            };
            inputs[key] = input;
        });

        saveBtn.onclick = async () => {
            const vals = {
                scenes: parseInt(inputs.scenes.value) || 0,
                colors: parseInt(inputs.colors.value) || 0,
                full: parseInt(inputs.full.value) || 0,
            };
            for (const [k, v] of Object.entries(vals)) {
                if (v < 1 || v > 99) {
                    new Notice(t('ui.campaignManagerSection.thresholdRangeNotice', { field: k }));
                    return;
                }
            }
            if (vals.scenes >= vals.colors || vals.colors >= vals.full) {
                new Notice(t('ui.campaignManagerSection.thresholdOrderNotice'));
                return;
            }
            teaser.customThresholds = vals;
            new Notice(t('ui.campaignManagerSection.thresholdsSavedNotice'));
            await save();
        };
    }

    // Show SVG previews of each reveal stage
    const svgPreviewRow = teaserContentContainer.createDiv({ cls: 'ert-teaser__previewRow' });
    const refreshStages = (): void => {
        svgPreviewRow.empty();
        void renderTeaserStagesPreviews(svgPreviewRow, plugin, campaign, save);
    };
    refreshStages();
    styleRefreshers.push(refreshStages);
}

/**
 * Draw the open report at screen size, through the same path that publishes it.
 */
async function renderReportPreview(container: HTMLElement, service: AuthorProgressService, reportId: string): Promise<void> {
    if (!container.hasChildNodes()) {
        container.createDiv({ cls: `ert-apr-preview-loading ${ERT_CLASSES.PREVIEW_INNER}`, text: t('settings.authorProgress.preview.loading') });
    }
    try {
        const result = await service.buildReportPreview(reportId);
        container.empty();
        if (!result || result.sceneCount === 0) {
            container.createDiv({ cls: 'ert-apr-preview-empty', text: t('settings.authorProgress.preview.emptyState') });
            return;
        }
        mountSvgPreview(container.createDiv({ cls: 'ert-apr-svg-wrapper' }), result.svgString);
    } catch (e) {
        container.empty();
        container.createDiv({ cls: 'ert-apr-preview-error', text: t('settings.authorProgress.preview.renderError') });
        console.error('Social settings preview error:', e);
    }
}

/**
 * Render mini SVG previews for each teaser reveal stage (4 stages)
 * Clickable cards allow disabling middle stages
 */
async function renderTeaserStagesPreviews(
    container: HTMLElement,
    plugin: RadialTimelinePlugin,
    campaign: AuthorProgressCampaign,
    save: () => Promise<void>
): Promise<void> {
    const settings = plugin.settings.authorProgress?.defaults;
    if (!settings) return;
    const progressService = new AprProgressService(plugin);
    const styleService = new AprStyleService(plugin);

    // The scenes of the book this report tracks
    const projectPath = resolveProjectPath(campaign, plugin.settings.books, plugin.settings.sourcePath);
    const scenes = (await plugin.getSceneData({ sourcePath: projectPath })).filter(isSceneItem);
    if (scenes.length === 0) {
        container.createEl('p', {
            text: t('ui.campaignManagerSection.noScenesPreview'),
            cls: 'ert-teaser__empty'
        });
        return;
    }

    const resolvedStyle = styleService.resolveStyle(campaign);
    const showRtAttribution = hasProFeatureAccess(plugin)
        ? resolvedStyle.aprShowRtAttribution !== false
        : true;
    const teaser = campaign.teaserReveal;
    const thresholds = getTeaserThresholds(teaser.preset, teaser.customThresholds);
    const disabledStages = teaser.disabledStages ?? {}; // SAFE: a teaser that never skipped a stage has none disabled

    // Current progress drives which stage is "live" — highlight it in the publish-stage color.
    const currentProgress = progressService.resolveProgress(scenes, settings);
    const currentTeaserLevel = getTeaserRevealLevel(currentProgress.percent, thresholds, disabledStages);
    const currentStageColor = plugin.settings.publishStageColors[currentProgress.displayStage];

    // 4 stages with their properties (labels/icons from TEASER_LEVEL_INFO)
    // Note: Ring stage uses 5% for preview (shows ring) even though threshold is 0%
    const stages: {
        level: TeaserRevealLevel;
        progress: number;
        disableKey?: 'scenes' | 'colors';
    }[] = [
            { level: 'ring', progress: 5 },
            { level: 'scenes', progress: thresholds.scenes, disableKey: 'scenes' },
            { level: 'colors', progress: thresholds.colors, disableKey: 'colors' },
            { level: 'full', progress: thresholds.full },
        ];

    const bookTitle = resolveBookTitle(campaign, plugin.settings.books, plugin.getActiveBookTitle());

    stages.forEach(stage => {
        const info = TEASER_LEVEL_INFO[stage.level];
        const revealOptions = teaserLevelToRevealOptions(stage.level);
        const disableKey = stage.disableKey;
        const isDisabled = disableKey ? !!disabledStages[disableKey] : false;

        const cardClasses: string[] = [ERT_CLASSES.STAGE_CARD];
        if (isDisabled) cardClasses.push('is-disabled');
        if (disableKey) cardClasses.push('is-clickable');
        const isCurrent = stage.level === currentTeaserLevel && !isDisabled;
        if (isCurrent) cardClasses.push('is-current');

        const card = container.createDiv({ cls: cardClasses.join(' ') });
        if (isCurrent) card.style.setProperty('--ert-current-stage-color', currentStageColor);

        // Click to toggle for middle stages
        if (disableKey) {
            setTooltip(card, isDisabled ? t('ui.campaignManagerSection.enableStageTooltip') : t('ui.campaignManagerSection.skipStageTooltip'));
            card.onclick = async () => {
                teaser.disabledStages = { ...disabledStages, [disableKey]: !isDisabled };
                await save();
            };
        }

        // SVG preview container
        const svgContainer = card.createDiv({ cls: 'ert-stageCard__svg' });

        try {
            const isRingOnly = stage.level === 'ring';
            const { svgString } = createAprSVG(scenes, {
                size: 'small',
                progressPercent: stage.progress,
                bookTitle,
                authorName: settings.authorName || '',
                showScenes: isRingOnly ? false : revealOptions.showScenes,
                showSubplots: revealOptions.showSubplots,
                showActs: revealOptions.showActs,
                showStatusColors: revealOptions.showStatusColors,
                showStageColors: revealOptions.showStageColors,
                grayCompletedScenes: revealOptions.grayCompletedScenes,
                grayscaleScenes: revealOptions.grayscaleScenes,
                showProgressPercent: !isRingOnly,
                showBranding: !isRingOnly,
                centerMark: 'none',
                stageColors: plugin.settings.publishStageColors,
                workingPatternId: plugin.settings.workingPatternId,
                customWorkingPatterns: plugin.settings.customWorkingPatterns,
                actCount: plugin.settings.actCount,
                ...styleService.buildRenderStyle(resolvedStyle),
                publishStageLabel: progressService.getDisplayStageForPercent(stage.progress),
                showRtAttribution,
                portableSvg: true
            });

            if (!mountSvgPreview(svgContainer, svgString)) {
                svgContainer.createSpan({ text: '⚠', cls: 'ert-stageCard__error' });
            }
        } catch {
            svgContainer.createSpan({ text: '⚠', cls: 'ert-stageCard__error' });
        }

        // Disabled overlay
        if (isDisabled) {
            const overlay = card.createDiv({ cls: 'ert-stageCard__overlay' });
            overlay.setText(t('ui.campaignManagerSection.skippedOverlay'));
        }

        // Label row
        const labelRow = card.createDiv({ cls: 'ert-stageCard__labelRow' });
        const iconSpan = labelRow.createSpan({ cls: 'ert-stageCard__icon' });
        setIcon(iconSpan, info.icon);
        labelRow.createSpan({ text: `${stage.progress}%`, cls: 'ert-stageCard__percent' });

        card.createDiv({ cls: 'ert-stageCard__name', text: info.label });
    });
}
