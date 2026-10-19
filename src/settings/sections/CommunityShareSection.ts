import { withAccessibleLabel } from '../../utils/domTooltip';
import { App, ButtonComponent, Notice, Setting, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import {
    COMMUNITY_SHARE_FIELD_KEYS,
    buildCommunityShareModeUpdate,
    deriveCommunityShareMode,
    normalizeCommunityShareSettings,
    type CommunityShareMode
} from '../../communityShare/communityShareSettings';
import {
    CommunityShareError,
    beginCommunitySharing,
    commitCommunityShare,
    confirmCommunityShareActivation,
    syncCommunityProjectsIfConnected,
    disconnectCommunityShare,
    fetchCommunityShareContext,
    pauseCommunitySharing,
    resumeCommunitySharing,
    revokeCommunityShareReport,
    syncCommunityShareIfDue,
    type CommunityShareContext,
    type CommunityShareContextProject
} from '../../communityShare/communityShareClient';
import { buildCommunitySharePreview } from '../../communityShare/communitySharePreview';
import { COMMUNITY_MY_SHARE_URL } from '../../communityShare/communityMailbox';
import type { CommunityShareFieldKey, CommunityShareSettings } from '../../types/settings';
import { ERT_CLASSES } from '../../ui/classes';
import { confirmWithErtModal } from '../../modals/ErtConfirmModal';
import { addHeadingIcon, applyErtHeaderLayout } from '../wikiLink';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { t } from '../../i18n';

export interface CommunityShareSectionProps {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

// Labels for the Complete Preview field listing. The field manifest itself is
// wire-level machinery; authors choose a sharing mode, not individual fields.
const getFieldLabels = (): Record<CommunityShareFieldKey, string> => ({
    'project.title': t('ui.communityShareSection.fieldProjectTitle'),
    'project.alias': t('ui.communityShareSection.fieldProjectAlias'),
    'project.description': t('ui.communityShareSection.fieldProjectDescription'),
    'project.status': t('ui.communityShareSection.fieldProjectStatus'),
    'project.genre': t('ui.communityShareSection.fieldGenre'),
    'project.custom_genre_label': t('ui.communityShareSection.fieldCustomGenreNote'),
    'activity.report_period': t('ui.communityShareSection.fieldReportPeriod'),
    'activity.writing_days': t('ui.communityShareSection.fieldWritingDays'),
    'activity.minutes_total': t('ui.communityShareSection.fieldMinutesThisWeek'),
    'activity.words_added': t('ui.communityShareSection.fieldWordsThisWeek'),
    'activity.session_count': t('ui.communityShareSection.fieldSessionCount'),
    'activity.mode_mix': t('ui.communityShareSection.fieldModeMix'),
    'activity.scenes_completed_by_stage': t('ui.communityShareSection.fieldCompletedByStage'),
    'activity.stage_mix': t('ui.communityShareSection.fieldStageMix'),
    'activity.completed_scene_count': t('ui.communityShareSection.fieldCompletedSceneCount'),
    'activity.revised_scene_count': t('ui.communityShareSection.fieldRevisedSceneCount'),
    'activity.streak': t('ui.communityShareSection.fieldStreak'),
    'structure.real_scene_titles': t('ui.communityShareSection.fieldRealSceneTitles'),
    'activity.exact_session_timestamps': t('ui.communityShareSection.fieldExactTimestamps')
});

const getModeLabels = (): Record<CommunityShareMode, string> => ({
    private: t('ui.communityShareSection.modeLabelPrivate'),
    profile_books: t('ui.communityShareSection.modeLabelProfileBooks'),
    progress: t('ui.communityShareSection.modeLabelProgress')
});

const getModeNotes = (): Record<CommunityShareMode, string> => ({
    private: t('ui.communityShareSection.modeNotePrivate'),
    profile_books: t('ui.communityShareSection.modeNoteProfileBooks'),
    progress: t('ui.communityShareSection.modeNoteProgress')
});


// Canonical website context for the Complete Preview. Profile and project
// shell fields (title, status, genre, description) are managed on the
// website; the preview must show those server-side values, never
// plugin-local stand-ins. The section rerenders on every save, so the
// fetch result lives module-side and refreshes at most once per TTL.
interface WebsiteContextCache {
    connectionId: string;
    /** The cached book binding at fetch time; a website rebind (seen by project sync) changes it and forces a refetch. */
    projectId: string | null;
    fetchedAt: number;
    context?: CommunityShareContext;
    error?: string;
}
let websiteContextCache: WebsiteContextCache | null = null;
let websiteContextInflight = false;
const WEBSITE_CONTEXT_TTL_MS = 5 * 60 * 1000;

function getCachedWebsiteContext(settings: CommunityShareSettings): WebsiteContextCache | null {
    const connectionId = settings.connection.connectionId;
    if (!connectionId || !websiteContextCache || websiteContextCache.connectionId !== connectionId
        || websiteContextCache.projectId !== (settings.connection.projectId ?? null)) return null; // SAFE: an absent cached id and null both mean unbound
    return websiteContextCache;
}

function getConnectedWebsiteProject(settings: CommunityShareSettings, context?: CommunityShareContext): CommunityShareContextProject | null {
    if (!context) return null;
    const projectId = context.connected_project_id ?? settings.connection.projectId;
    return context.projects.find(project => project.id === projectId) ?? null;
}

// Preview card title: the active project's title, plus a "& others (N)"
// suffix when the website connection carries more than one shared project.
// Only `public` projects count — project sync creates an initially-private
// shell for every local book, and those must not inflate the tally.
function formatPreviewTitle(baseTitle: string, context?: CommunityShareContext): string {
    const sharedCount = context?.projects.filter(project => project.visibility === 'public').length ?? 0; // SAFE: no share context loaded yet, so nothing is known to be public
    return sharedCount > 1 ? t('ui.communityShareSection.previewTitleWithOthers', { title: baseTitle, count: sharedCount }) : baseTitle;
}

const getProjectStatusLabels = (): Record<string, string> => ({
    drafting: t('ui.communityShareSection.projectStatusDrafting'),
    revising: t('ui.communityShareSection.projectStatusRevising'),
    querying: t('ui.communityShareSection.projectStatusQuerying'),
    published: t('ui.communityShareSection.projectStatusPublished'),
    hiatus: t('ui.communityShareSection.projectStatusHiatus')
});

function formatWebsiteGenre(project: CommunityShareContextProject | null): string | undefined {
    if (!project) return undefined;
    const path = [project.genre_l1, project.genre_l2, project.genre_l3].filter(Boolean).join(' › ');
    return path || undefined;
}

function getCommunitySettings(plugin: RadialTimelinePlugin): CommunityShareSettings {
    const normalized = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (JSON.stringify(plugin.settings.communityShare ?? null) !== JSON.stringify(normalized)) {
        plugin.settings.communityShare = normalized;
        void plugin.saveSettings();
    }
    return normalized;
}

function getActiveBook(plugin: RadialTimelinePlugin) {
    return plugin.settings.books.find(book => book.id === plugin.settings.activeBookId) ?? plugin.settings.books[0];
}

function formatStatus(settings: CommunityShareSettings): string {
    if (settings.connection.status === 'connected') return t('ui.communityShareSection.statusConnected');
    if (settings.connection.status === 'paused') return t('ui.communityShareSection.statusPaused');
    if (settings.connection.status === 'revoked') return t('ui.communityShareSection.statusRevoked');
    if (settings.connection.status === 'pending') return t('ui.communityShareSection.statusPending');
    return t('ui.communityShareSection.statusNotConnected');
}

function hasReadyPreview(settings: CommunityShareSettings): boolean {
    return settings.preview.status === 'ready' && Boolean(settings.preview.previewHash && settings.preview.payloadHash);
}

function latestReportState(settings: CommunityShareSettings): 'live' | 'revoked' | 'deleted' | 'none' {
    for (let index = settings.publishHistory.length - 1; index >= 0; index -= 1) {
        const entry = settings.publishHistory[index];
        if (entry.status !== 'success') continue;
        if (entry.action === 'publish' || entry.action === 'sync') return 'live';
        if (entry.action === 'revoke') return 'revoked';
        if (entry.action === 'delete') return 'deleted';
    }
    return 'none';
}

function getSelectedFieldLabels(settings: CommunityShareSettings): string[] {
    return COMMUNITY_SHARE_FIELD_KEYS
        .filter(key => settings.fieldPolicy[key])
        .map(key => getFieldLabels()[key]);
}

function formatConnectedAt(value?: string): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

function formatGeneratedAt(value?: string): string {
    if (!value) return t('ui.communityShareSection.timeNotRecorded');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

export function renderCommunityShareSection({ plugin, containerEl }: CommunityShareSectionProps): void {
    const settings = getCommunitySettings(plugin);
    const activeBook = getActiveBook(plugin);
    const isConnected = settings.connection.status === 'connected';
    const mode = deriveCommunityShareMode(settings);
    const selectedFields = getSelectedFieldLabels(settings);
    const communityAprCampaigns = (plugin.settings.authorProgress?.campaigns ?? []) // SAFE: no campaigns configured means none of them are community-bound
        .filter(campaign => campaign.sendToCommunity);
    const reportState = latestReportState(settings);
    const hasLiveReport = reportState === 'live';

    const section = containerEl.createDiv({
        cls: `${ERT_CLASSES.ROOT} ${ERT_CLASSES.STACK}`
    });

    const save = async (next: Partial<CommunityShareSettings>) => {
        const currentSettings = normalizeCommunityShareSettings(plugin.settings.communityShare);
        const invalidatesPreview = next.fieldPolicy !== undefined
            || next.audience !== undefined
            || next.tier !== undefined;
        plugin.settings.communityShare = normalizeCommunityShareSettings({
            ...currentSettings,
            ...next,
            fieldPolicy: next.fieldPolicy ?? currentSettings.fieldPolicy,
            connection: next.connection ?? currentSettings.connection,
            preview: next.preview ?? (invalidatesPreview
                ? {
                    ...currentSettings.preview,
                    status: currentSettings.preview.status === 'not_generated' ? 'not_generated' : 'stale',
                    previewHash: undefined,
                    payloadHash: undefined
                }
                : currentSettings.preview)
        });
        await plugin.saveSettings();
        containerEl.empty();
        renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
    };

    const hero = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.CARD_HERO} ${ERT_CLASSES.STACK}` });
    const badgeRow = hero.createDiv({ cls: ERT_CLASSES.INLINE });
    const badge = badgeRow.createSpan({ cls: ERT_CLASSES.BADGE_PILL });
    setIcon(badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON }), isConnected ? 'satellite-dish' : settings.enabled ? 'shield-check' : 'shield');
    badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: t('ui.communityShareSection.badgeText', { status: formatStatus(settings) }) });
    const wikiLink = withAccessibleLabel(badge.createEl('a', {
        href: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Settings-Community',
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: { 'target': '_blank', 'rel': 'noopener' }
    }), t('ui.communityShareSection.wikiAriaLabel'));
    setIcon(wikiLink, 'external-link');

    const titleRow = hero.createDiv({ cls: 'ert-hero-titleRow' });
    titleRow.createDiv({
        cls: `${ERT_CLASSES.SECTION_TITLE} ert-hero-title`,
        // Not "Community share" — the status pill directly above already says
        // that, and the tab is named Community. The hero title carries the
        // invitation instead of echoing the surface name a third time.
        text: t('ui.communityShareSection.heroTitle')
    });
    hero.createEl('p', {
        cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle`,
        text: t('ui.communityShareSection.heroSubtitle')
    });

    const heroFeatures = hero.createDiv({
        cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
    });
    heroFeatures.createDiv({ text: t('ui.communityShareSection.highlightsKicker'), cls: 'ert-kicker' });
    const featuresList = heroFeatures.createEl('ul', { cls: ERT_CLASSES.STACK });
    [
        { icon: 'lock', text: t('ui.communityShareSection.highlightPrivate') },
        { icon: 'eye', text: t('ui.communityShareSection.highlightPreview') },
        { icon: 'file-check', text: t('ui.communityShareSection.highlightAggregate') }
    ].forEach(item => {
        const li = featuresList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        setIcon(li.createSpan({ cls: 'ert-feature-icon' }), item.icon);
        li.createSpan({ text: item.text });
    });

    const pricingPromise = hero.createEl('p', { cls: ERT_CLASSES.FIELD_NOTE });
    pricingPromise.setText(t('ui.communityShareSection.pricingPromise'));

    const activationSection = section.createDiv({ cls: ERT_CLASSES.STACK });
    const connectionHeading = new Setting(activationSection)
        .setName(t('ui.communityShareSection.connectHeading'))
        .setHeading()
        .setDesc(t('ui.communityShareSection.connectDesc'));
    addHeadingIcon(connectionHeading, 'satellite-dish');
    applyErtHeaderLayout(connectionHeading);

    const renderConnectionCodeSetting = (targetEl: HTMLElement): Setting => {
        let tokenValue = '';
        let connectButton: ButtonComponent | null = null;
        return new Setting(targetEl)
            .setName(t('ui.communityShareSection.connectionCodeName'))
            .setDesc(t('ui.communityShareSection.connectionCodeDesc'))
            .addText(text => {
                text.setPlaceholder(t('ui.communityShareSection.connectionCodePlaceholder'));
                text.onChange(value => {
                    tokenValue = value.trim();
                    connectButton?.setDisabled(tokenValue.length < 16);
                });
            })
            .addButton(button => {
                connectButton = button;
                button
                    .setButtonText(t('ui.communityShareSection.connectButton'))
                    .setDisabled(true)
                    .onClick(async () => {
                        button.setDisabled(true);
                        button.setButtonText(t('ui.communityShareSection.connectingButton'));
                        try {
                            const result = await confirmCommunityShareActivation(plugin, tokenValue);
                            new Notice(result.project_id === null
                                ? t('ui.communityShareSection.connectedProfileNotice')
                                : t('ui.communityShareSection.connectedProjectNotice', { project: result.project_title || t('ui.communityShareSection.yourWebsiteProject') })); // SAFE: UX label for a bound project whose title the server left blank
                            // Sync the vault's books right away so a connection
                            // activated without a book binds now, not on the next
                            // plugin load. Fire-and-forget: failures only log.
                            void syncCommunityProjectsIfConnected(plugin);
                            containerEl.empty();
                            renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                        } catch (error) {
                            const message = error instanceof CommunityShareError
                                ? error.message
                                : t('ui.communityShareSection.connectFailed');
                            const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                            plugin.settings.communityShare = normalizeCommunityShareSettings({
                                ...current,
                                lastError: message
                            });
                            void plugin.saveSettings();
                            new Notice(message);
                            button.setButtonText(t('ui.communityShareSection.connectButton'));
                            button.setDisabled(tokenValue.length < 16);
                        }
                    });
            });
    };

    if (isConnected) {
        const connectedAt = formatConnectedAt(settings.connection.connectedAt);
        const statusRow = new Setting(activationSection)
            .setDesc(connectedAt
                ? t('ui.communityShareSection.linkedSince', { date: connectedAt })
                : t('ui.communityShareSection.linked'));
        const replacementContainer = activationSection.createDiv({ cls: 'ert-hidden' });
        statusRow.addButton(button => {
            const renderState = (connected: boolean) => {
                button.buttonEl.empty();
                const iconEl = button.buttonEl.createSpan();
                setIcon(iconEl, connected ? 'satellite-dish' : 'x');
                button.buttonEl.createSpan({ text: connected ? t('ui.communityShareSection.activeConnection') : t('ui.communityShareSection.cancelReplace') });
                button.buttonEl.toggleClass('ert-btn--connected', connected);
            };
            button.buttonEl.addClass('ert-btn--icon-left');
            renderState(true);
            button.onClick(() => {
                const willShow = replacementContainer.classList.contains('ert-hidden');
                replacementContainer.classList.toggle('ert-hidden', !willShow);
                renderState(!willShow);
            });
        });
        renderConnectionCodeSetting(replacementContainer);
        if (settings.lastError) {
            statusRow.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: settings.lastError });
        }
    } else {
        const codeRow = renderConnectionCodeSetting(activationSection);
        if (settings.lastError) {
            codeRow.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: settings.lastError });
        }
    }

    const sharingSection = section.createDiv({ cls: ERT_CLASSES.STACK });
    const sharingHeading = new Setting(sharingSection)
        .setName(t('ui.communityShareSection.whatYouShareHeading'))
        .setHeading()
        .setDesc(t('ui.communityShareSection.whatYouShareDesc'));
    addHeadingIcon(sharingHeading, 'share-2');
    const profileLink = withAccessibleLabel(sharingHeading.nameEl.createEl('a', {
        href: COMMUNITY_MY_SHARE_URL,
        cls: 'ert-wiki-link',
        attr: { 'target': '_blank', 'rel': 'noopener' }
    }), t('ui.communityShareSection.openProfileAriaLabel'));
    setIcon(profileLink, 'external-link');
    applyErtHeaderLayout(sharingHeading);

    new Setting(sharingSection)
        .setDesc(getModeNotes()[mode])
        .addDropdown(dropdown => {
            dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
            const modeLabels = getModeLabels();
            dropdown.addOption('private', modeLabels.private);
            dropdown.addOption('profile_books', modeLabels.profile_books);
            dropdown.addOption('progress', modeLabels.progress);
            dropdown.setValue(mode);
            dropdown.onChange(async value => {
                const nextMode = value as CommunityShareMode;
                const update = buildCommunityShareModeUpdate(nextMode);
                if (nextMode === 'private' && hasLiveReport) {
                    const confirmed = await confirmWithErtModal(plugin.app, {
                        title: t('ui.communityShareSection.makePrivateTitle'),
                        message: t('ui.communityShareSection.makePrivateMessage'),
                        confirmText: t('ui.communityShareSection.makePrivateConfirm'),
                    });
                    if (!confirmed) {
                        dropdown.setValue(mode);
                        fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 360, extraPx: 18 });
                        return;
                    }
                    dropdown.setDisabled(true);
                    try {
                        await revokeCommunityShareReport(plugin);
                    } catch (error) {
                        const message = error instanceof CommunityShareError ? error.message : t('ui.communityShareSection.takeOfflineFailed');
                        new Notice(message);
                        dropdown.setValue(mode);
                        dropdown.setDisabled(false);
                        return;
                    }
                }
                // Scope changes re-arm the explicit consent step: sharing pauses
                // until the author begins sharing again at the new level.
                if (settings.scheduledPublishEnabled && nextMode !== mode) {
                    update.scheduledPublishEnabled = false;
                    new Notice(nextMode === 'private'
                        ? t('ui.communityShareSection.privateOfflineNotice')
                        : t('ui.communityShareSection.levelChangedNotice'));
                }
                await save(update);
            });
            fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 360, extraPx: 18 });
        });

    const previewFrame = sharingSection.createDiv({ cls: `${ERT_CLASSES.PREVIEW_FRAME} ${ERT_CLASSES.STACK} ert-previewFrame--flush ert-communityPreview` });
    const addDivider = () => previewFrame.createDiv({ cls: `${ERT_CLASSES.DIVIDER} ert-divider--previewFrame ert-communityPreview__divider` });
    const addChip = (parent: HTMLElement, label: string, value?: string) => {
        const chip = parent.createSpan({ cls: ERT_CLASSES.CHIP });
        if (value !== undefined) {
            chip.createSpan({ cls: 'ert-communityPreview__chipLabel', text: label });
            chip.createSpan({ text: value });
        } else {
            chip.setText(label);
        }
    };

    const cachedWebsiteContext = getCachedWebsiteContext(settings);
    const websiteContext = cachedWebsiteContext?.context;
    const websiteProject = getConnectedWebsiteProject(settings, websiteContext);

    const previewTitleBase = websiteProject?.title || activeBook?.publicLabel || activeBook?.title;
    previewFrame.createDiv({
        cls: 'ert-communityPreview__title',
        text: previewTitleBase ? formatPreviewTitle(previewTitleBase, websiteContext) : t('ui.communityShareSection.noActiveProject')
    });
    previewFrame.createDiv({ cls: 'ert-kicker', text: t('ui.communityShareSection.sharingKicker', { mode: getModeLabels()[mode] }) });

    if (mode === 'private') {
        addDivider();
        previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: getModeNotes().private });
    } else {
        // One publish, two origins. Profile and project shell fields are
        // managed on the website and shown here with their canonical
        // server-side values; only activity summaries come from this vault.
        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: t('ui.communityShareSection.fromWebsiteKicker') });
        if (!isConnected) {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: t('ui.communityShareSection.connectToLoadNote')
            });
        } else if (cachedWebsiteContext?.error) {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: t('ui.communityShareSection.websiteLoadError', { error: cachedWebsiteContext.error })
            });
        } else if (!websiteContext) {
            previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: t('ui.communityShareSection.loadingProfile') });
        } else {
            const profile = websiteContext.profile;
            const websitePills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            const authorLabel = profile?.display_name && profile.handle
                ? `${profile.display_name} @${profile.handle}`
                : profile?.display_name || (profile?.handle ? `@${profile.handle}` : undefined);
            addChip(websitePills, t('ui.communityShareSection.chipAuthor'), authorLabel || t('ui.communityShareSection.notSet')); // SAFE: chip label — tells the author the website author name is still empty
            if (websiteProject) {
                addChip(websitePills, t('ui.communityShareSection.chipTitle'), websiteProject.title || t('ui.communityShareSection.notSet')); // SAFE: chip label — tells the author the website project title is still empty
                addChip(websitePills, t('ui.communityShareSection.chipStatus'), websiteProject.status
                    ? getProjectStatusLabels()[websiteProject.status] ?? websiteProject.status
                    : t('ui.communityShareSection.notSet'));
                addChip(websitePills, t('ui.communityShareSection.chipGenre'), formatWebsiteGenre(websiteProject) || t('ui.communityShareSection.notSet')); // SAFE: chip label — tells the author no website genre has been chosen
                if (websiteProject.custom_genre_label) {
                    addChip(websitePills, t('ui.communityShareSection.chipCustomGenre'), websiteProject.custom_genre_label);
                }
                addChip(websitePills, t('ui.communityShareSection.chipDescription'), websiteProject.logline || t('ui.communityShareSection.notSet')); // SAFE: chip label — tells the author the website logline is still empty
            } else {
                previewFrame.createDiv({
                    cls: 'ert-communityPreview__note',
                    text: t('ui.communityShareSection.projectNotFound')
                });
            }
        }
        const editOnWebsiteNote = previewFrame.createDiv({ cls: 'ert-communityPreview__note' });
        editOnWebsiteNote.appendText(t('ui.communityShareSection.editOnWebsite'));
        editOnWebsiteNote.createEl('a', {
            text: t('ui.communityShareSection.myShareLink'),
            href: COMMUNITY_MY_SHARE_URL,
            attr: { target: '_blank', rel: 'noopener' }
        });

        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: t('ui.communityShareSection.fromVaultKicker') });
        // Publishing targets ride along with project sync (active book), but
        // stay hidden on the website until revealed in My Share.
        previewFrame.createDiv({
            cls: 'ert-communityPreview__note',
            text: t('ui.communityShareSection.targetDatesNote')
        });
        if (communityAprCampaigns.length > 0) {
            const aprPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            communityAprCampaigns.forEach(campaign => {
                const targetBook = campaign.targetBookId
                    ? plugin.settings.books.find(book => book.id === campaign.targetBookId)
                    : activeBook;
                const frequency = campaign.updateFrequency ?? 'manual'; // SAFE: mirrors the fail-closed cadence default in AuthorProgressCampaignService
                addChip(aprPills, t('ui.communityShareSection.chipApr'), `${campaign.name} · ${targetBook?.title ?? t('ui.communityShareSection.noBook')} · ${frequency}`); // SAFE: chip label — states plainly that the campaign has no book attached
            });
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: t('ui.communityShareSection.aprLandsNote')
            });
        } else {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: t('ui.communityShareSection.noAprNote')
            });
        }
        // The preview card speaks in general terms — the author wants the gist
        // of what leaves the vault, not the telemetry schema. The field-policy
        // controls elsewhere keep the precise getFieldLabels() names.
        const PREVIEW_FIELD_LABELS: Partial<Record<CommunityShareFieldKey, string>> = {
            'activity.minutes_total': t('ui.communityShareSection.previewSessionLength'),
            'activity.words_added': t('ui.communityShareSection.previewWordsWritten'),
            'activity.session_count': t('ui.communityShareSection.previewSessions'),
            'activity.scenes_completed_by_stage': t('ui.communityShareSection.previewScenesByStage'),
            'activity.stage_mix': t('ui.communityShareSection.previewStageMix'),
            'activity.completed_scene_count': t('ui.communityShareSection.previewScenesCompleted'),
            'activity.revised_scene_count': t('ui.communityShareSection.previewScenesRevised')
        };
        const activityFieldLabels = COMMUNITY_SHARE_FIELD_KEYS
            .filter(key => settings.fieldPolicy[key] && key.startsWith('activity.'))
            .map(key => PREVIEW_FIELD_LABELS[key] ?? getFieldLabels()[key]);
        if (activityFieldLabels.length) {
            const fieldPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            activityFieldLabels.forEach(label => addChip(fieldPills, label));
            // At the progress level (public, tier 4) the daily sync also sends
            // the per-start-hour/mode rollup (hour_mode_mix) for the community
            // activity dial. It travels on the daily-sync endpoint, not in the
            // signed preview payload/hash — so it must be disclosed here in
            // words, or it would leave the vault without appearing on this card.
            // note: folding it into the preview payload+hash was considered and
            // rejected — it would break the payload/preview-hash separation from
            // the report publish and the daily-sync tests; disclosure only.
            if (mode === 'progress' && settings.tier === 4) {
                addChip(fieldPills, t('ui.communityShareSection.chipPerDayTotals'));
                // Per-day words ride the same words field policy as "Words
                // written": both go, or neither. The daily rows carry words
                // from every mode, so say so before they leave the vault.
                if (settings.fieldPolicy['activity.words_added']) {
                    addChip(fieldPills, t('ui.communityShareSection.chipWordsPerDay'));
                    previewFrame.createDiv({
                        cls: 'ert-communityPreview__note',
                        text: t('ui.communityShareSection.wordsPerDayNote')
                    });
                }
                addChip(fieldPills, t('ui.communityShareSection.chipWritingTimePattern'));
                previewFrame.createDiv({
                    cls: 'ert-communityPreview__note',
                    text: t('ui.communityShareSection.writingTimePatternNote')
                });
            }
        } else {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: t('ui.communityShareSection.noActivityNote')
            });
        }

        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: t('ui.communityShareSection.staysKicker') });
        previewFrame.createDiv({
            cls: 'ert-communityPreview__note',
            text: t('ui.communityShareSection.staysNote')
        });

        addDivider();
        previewFrame.createDiv({
            cls: 'ert-communityPreview__status',
            text: hasReadyPreview(settings)
                ? t('ui.communityShareSection.previewReady', { date: formatGeneratedAt(settings.preview.generatedAt) })
                : settings.preview.status === 'blocked'
                    ? t('ui.communityShareSection.previewUnavailable')
                    : t('ui.communityShareSection.updatingPreview')
        });
        if (settings.preview.summary) {
            previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: settings.preview.summary });
        }
        if (settings.preview.previewHash) {
            const hashPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            addChip(hashPills, t('ui.communityShareSection.chipPreviewHash'), `${settings.preview.previewHash.slice(0, 12)}...`);
        }
    }

    // The signed preview regenerates whenever the section renders, so the card
    // and its hash always reflect the current selection. Publish still rebuilds
    // and compares the hash, so what is shown here is exactly what publishes.
    const rerender = () => {
        containerEl.empty();
        renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
    };

    // Refresh the canonical website context when it is missing or past its
    // TTL. Failures render as an explicit "could not load" note — the
    // preview never substitutes plugin-local values for website fields.
    const contextConnectionId = settings.connection.connectionId;
    const contextProjectId = settings.connection.projectId ?? null; // SAFE: an absent cached id and null both mean unbound
    const contextFresh = websiteContextCache
        && websiteContextCache.connectionId === contextConnectionId
        && websiteContextCache.projectId === contextProjectId
        && Date.now() - websiteContextCache.fetchedAt < WEBSITE_CONTEXT_TTL_MS;
    if (mode !== 'private' && isConnected && contextConnectionId && !contextFresh && !websiteContextInflight) {
        websiteContextInflight = true;
        void fetchCommunityShareContext(plugin)
            .then(context => {
                websiteContextCache = { connectionId: contextConnectionId, projectId: contextProjectId, fetchedAt: Date.now(), context };
            })
            .catch(error => {
                websiteContextCache = {
                    connectionId: contextConnectionId,
                    projectId: contextProjectId,
                    fetchedAt: Date.now(),
                    error: error instanceof Error ? error.message : t('ui.communityShareSection.profileLoadFailed')
                };
            })
            .finally(() => {
                websiteContextInflight = false;
                rerender();
            });
    }

    void (async () => {
        const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
        if (mode === 'private' || selectedFields.length === 0) {
            if (current.preview.status === 'not_generated' && !current.preview.previewHash && !current.preview.payloadHash) return;
            plugin.settings.communityShare = normalizeCommunityShareSettings({
                ...current,
                preview: {
                    status: 'not_generated',
                    generatedAt: undefined,
                    previewHash: undefined,
                    payloadHash: undefined,
                    reportPeriod: undefined,
                    summary: undefined
                }
            });
            await plugin.saveSettings();
            rerender();
            return;
        }
        try {
            const preview = await buildCommunitySharePreview(plugin);
            // Building the preview awaited; anything the author clicked
            // meanwhile (Pause, Disconnect) is in the live state, not `current`.
            const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
            const upToDate = live.preview.status === 'ready'
                && live.preview.previewHash === preview.previewHash
                && live.preview.payloadHash === preview.payloadHash;
            if (upToDate) return;
            const committed = commitCommunityShare(plugin, state => ({
                ...state,
                preview: {
                    status: 'ready',
                    generatedAt: new Date().toISOString(),
                    previewHash: preview.previewHash,
                    payloadHash: preview.payloadHash,
                    reportPeriod: 'weekly',
                    summary: preview.summary
                },
                lastError: state.preview.status === 'blocked' ? undefined : state.lastError
            }));
            await plugin.saveSettings();
            // Standing share: if sharing is on and the content changed, push
            // the refreshed payload before repainting so the card and the
            // website stay in step.
            if (committed.scheduledPublishEnabled) {
                await syncCommunityShareIfDue(plugin);
            }
            rerender();
        } catch (error) {
            const message = error instanceof Error ? error.message : t('ui.communityShareSection.previewBuildFailed');
            const live = normalizeCommunityShareSettings(plugin.settings.communityShare);
            if (live.preview.status === 'blocked' && live.lastError === message) return;
            commitCommunityShare(plugin, state => ({
                ...state,
                preview: {
                    ...state.preview,
                    status: 'blocked',
                    previewHash: undefined,
                    payloadHash: undefined
                },
                lastError: message
            }));
            await plugin.saveSettings();
            rerender();
        }
    })();

    const actionCard = section.createDiv({ cls: ERT_CLASSES.STACK });
    const actionHeading = new Setting(actionCard)
        .setName(t('ui.communityShareSection.safetyHeading'))
        .setHeading()
        .setDesc(t('ui.communityShareSection.safetyDesc'));
    addHeadingIcon(actionHeading, 'shield-check');
    applyErtHeaderLayout(actionHeading);
    const isPaused = settings.sharingPaused;
    const sharingOn = settings.scheduledPublishEnabled && !isPaused;
    const canBegin = mode !== 'private'
        && isConnected
        && settings.audience === 'public'
        && settings.tier >= 1
        && settings.tier <= 4
        && hasReadyPreview(settings)
        && selectedFields.length > 0;
    const lastSynced = settings.connection.lastSyncedAt
        ? formatGeneratedAt(settings.connection.lastSyncedAt)
        : null;

    if (isPaused) {
        new Setting(actionCard)
            .setDesc(t('ui.communityShareSection.pausedDesc'))
            .addButton(button => button
                .setButtonText(t('ui.communityShareSection.resumeButton'))
                .setCta()
                .onClick(async () => {
                    button.setDisabled(true);
                    button.setButtonText(t('ui.communityShareSection.resumingButton'));
                    try {
                        await resumeCommunitySharing(plugin);
                        new Notice(t('ui.communityShareSection.resumedNotice'));
                        containerEl.empty();
                        renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                    } catch (error) {
                        const message = error instanceof CommunityShareError
                            ? error.message
                            : t('ui.communityShareSection.resumeFailed');
                        const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                        plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                        void plugin.saveSettings();
                        new Notice(message);
                        button.setButtonText(t('ui.communityShareSection.resumeButton'));
                        button.setDisabled(false);
                    }
                }));
    } else {
        const shareRow = new Setting(actionCard)
            .setDesc(sharingOn
                ? (lastSynced
                    ? t('ui.communityShareSection.sharingOnSynced', { date: lastSynced })
                    : t('ui.communityShareSection.sharingOn'))
                : canBegin
                    ? t('ui.communityShareSection.sharingOff')
                    : t('ui.communityShareSection.nextSteps'))
            .addButton(button => {
                if (sharingOn) {
                    button
                        .setButtonText(t('ui.communityShareSection.pauseButton'))
                        .onClick(async () => {
                            button.setDisabled(true);
                            await pauseCommunitySharing(plugin);
                            new Notice(t('ui.communityShareSection.pausedNotice'));
                            containerEl.empty();
                            renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                        });
                } else {
                    button
                        .setButtonText(t('ui.communityShareSection.beginButton'))
                        .setCta()
                        .setDisabled(!canBegin)
                        .onClick(async () => {
                            button.setDisabled(true);
                            button.setButtonText(t('ui.communityShareSection.startingButton'));
                            try {
                                await beginCommunitySharing(plugin);
                                new Notice(t('ui.communityShareSection.sharingOnNotice'));
                                containerEl.empty();
                                renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                            } catch (error) {
                                const message = error instanceof CommunityShareError
                                    ? error.message
                                    : t('ui.communityShareSection.beginFailed');
                                const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                                plugin.settings.communityShare = normalizeCommunityShareSettings({
                                    ...current,
                                    lastError: message
                                });
                                void plugin.saveSettings();
                                new Notice(message);
                                button.setButtonText(t('ui.communityShareSection.beginButton'));
                                button.setDisabled(!canBegin);
                            }
                        });
                }
            });
        if (sharingOn) {
            shareRow.descEl.createDiv({
                cls: ERT_CLASSES.FIELD_NOTE,
                text: t('ui.communityShareSection.pauseNote')
            });
        }
    }

    new Setting(actionCard)
        .setName(t('ui.communityShareSection.disconnectName'))
        .setDesc(t('ui.communityShareSection.disconnectDesc'))
        .addButton(button => button
            .setButtonText(t('ui.communityShareSection.disconnectButton'))
            .setDisabled(!isConnected)
            .onClick(async () => {
                const confirmed = await confirmWithErtModal(plugin.app, {
                    title: t('ui.communityShareSection.disconnectTitle'),
                    message: t('ui.communityShareSection.disconnectMessage'),
                    confirmText: t('ui.communityShareSection.disconnectButton'),
                });
                if (!confirmed) return;
                button.setDisabled(true);
                button.setButtonText(t('ui.communityShareSection.disconnectingButton'));
                try {
                    await disconnectCommunityShare(plugin);
                    new Notice(t('ui.communityShareSection.disconnectedNotice'));
                    containerEl.empty();
                    renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                } catch (error) {
                    const message = error instanceof CommunityShareError ? error.message : t('ui.communityShareSection.disconnectFailed');
                    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                    plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                    void plugin.saveSettings();
                    new Notice(message);
                    button.setButtonText(t('ui.communityShareSection.disconnectButton'));
                    button.setDisabled(!isConnected);
                }
            }));
}
