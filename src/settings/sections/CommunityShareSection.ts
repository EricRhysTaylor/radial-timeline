import { withAccessibleLabel } from '../../utils/domTooltip';
import { App, ButtonComponent, Notice, Setting, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import {
    COMMUNITY_SHARE_FIELD_KEYS,
    buildCommunityShareModeUpdate,
    canShareTimelineToCommunity,
    deriveCommunityShareMode,
    modeIncludesActivity,
    normalizeCommunityShareSettings,
    sendsDailyActivity,
    timelineShareFor,
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
    fetchVaultSharingState,
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
import { addHeadingIcon, addVideoLinkToElement, applyErtHeaderLayout } from '../wikiLink';
import { renderCommunityTimelineBlock } from './CommunityTimelineBlock';
import { accountPausedNote, formatCommunityDate, serverDisconnectNote } from '../../communityShare/sharingWords';
import type { VaultSharingState } from '../../communityShare/sharingState';
import { knownSceneTextCounts, renderCommunitySceneTextBlock } from './CommunitySceneTextBlock';
import { agreeToSceneTextTerms } from '../../modals/SceneReleaseConsentModal';
import { renderCommunityBookFromCommunityBlock } from './CommunityBookFromCommunityBlock';
import { renderCommunityDirection } from './communityDirectionRow';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { t, tCount } from '../../i18n';
import { docsUrl } from '../../utils/docsUrl';
import { getSecret } from '../../ai/credentials/secretStorage';

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
    progress: t('ui.communityShareSection.modeLabelProgress'),
    scene_text: t('ui.communityShareSection.modeLabelSceneText')
});

const getModeNotes = (): Record<CommunityShareMode, string> => ({
    private: t('ui.communityShareSection.modeNotePrivate'),
    profile_books: t('ui.communityShareSection.modeNoteProfileBooks'),
    progress: t('ui.communityShareSection.modeNoteProgress'),
    scene_text: t(modeIncludesActivity('scene_text') ? 'ui.communityShareSection.modeNoteSceneText' : 'ui.communityShareSection.modeNoteSceneTextBooks')
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
let sharingDetailsOpen = false;
const WEBSITE_CONTEXT_TTL_MS = 5 * 60 * 1000;

// Community's word on this vault's connection and the account's standing
// (community-share-context `history`), refreshed at most once per TTL like the
// website context. A failed read leaves the keychain's answer standing.
interface VaultStateCache {
    connectionId: string;
    fetchedAt: number;
    state?: VaultSharingState;
    error?: string;
}
let vaultStateCache: VaultStateCache | null = null;
let vaultStateInflight = false;

function knownVaultSharingState(connectionId: string): VaultStateCache | null {
    return vaultStateCache?.connectionId === connectionId && Date.now() - vaultStateCache.fetchedAt < WEBSITE_CONTEXT_TTL_MS
        ? vaultStateCache
        : null;
}

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
    if (settings.connection.serverDisconnect) return t('ui.communitySharing.statusDisconnected');
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

function formatGeneratedAt(value?: string): string {
    return value ? formatCommunityDate(value) : t('ui.communityShareSection.timeNotRecorded');
}

const getModeShortLabels = (): Record<CommunityShareMode, string> => ({
    private: t('ui.communityShareSection.modeShortPrivate'),
    profile_books: t('ui.communityShareSection.modeShortProfileBooks'),
    progress: t('ui.communityShareSection.modeShortProgress'),
    scene_text: t('ui.communityShareSection.modeShortSceneText')
});

/** The row under the level picker: what the website shows now, and the one action that changes it. */
export interface CommunitySharingState {
    /** What the website shows, or that the chosen level is not sent yet; null before the vault connects. */
    name: string | null;
    desc: string;
    action: 'begin' | 'pause' | 'resume';
    /** Begin sharing can be pressed. */
    canBegin: boolean;
}

/**
 * The website's sharing level changes only when the author begins sharing:
 * choosing a level in the picker sends nothing. So a chosen level that has not
 * been sent says so, and names what the website shows meanwhile.
 */
export function describeCommunitySharingState(settings: CommunityShareSettings): CommunitySharingState {
    const mode = deriveCommunityShareMode(settings);
    const level = getModeShortLabels()[mode];
    if (settings.sharingPaused) {
        const pausedAt = settings.sharingPausedAt;
        // Who paused and when; until Community has heard, the line says when it will.
        const desc = !pausedAt
            ? t('ui.communityShareSection.pausedDesc')
            : settings.sharingNoticeOwed?.action === 'pause'
                ? t('ui.communitySharing.pausedHereUntold', { date: formatCommunityDate(pausedAt) })
                : t('ui.communitySharing.pausedHere', { date: formatCommunityDate(pausedAt) });
        return { name: t('ui.communityShareSection.websiteLevelPausedName'), desc, action: 'resume', canBegin: false };
    }
    if (settings.scheduledPublishEnabled) {
        const lastSynced = settings.connection.lastSyncedAt;
        return {
            name: t('ui.communityShareSection.websiteLevelName', { level }),
            desc: lastSynced
                ? t('ui.communityShareSection.sharingOnSynced', { date: formatCommunityDate(lastSynced) })
                : t('ui.communityShareSection.sharingOn'),
            action: 'pause',
            canBegin: false
        };
    }
    if (settings.connection.status !== 'connected') {
        return { name: null, desc: t('ui.communityShareSection.nextSteps'), action: 'begin', canBegin: false };
    }
    if (mode === 'private') {
        return { name: t('ui.communityShareSection.websiteLevelName', { level }), desc: t('ui.communityShareSection.privateNextStep'), action: 'begin', canBegin: false };
    }
    const canBegin = settings.audience === 'public'
        && settings.tier >= 1
        && settings.tier <= 4
        && hasReadyPreview(settings)
        && getSelectedFieldLabels(settings).length > 0;
    return {
        name: t('ui.communityShareSection.notSentName', { level }),
        desc: t(latestReportState(settings) === 'live'
            ? 'ui.communityShareSection.notSentLiveDesc'
            : 'ui.communityShareSection.notSentPrivateDesc', { level }),
        action: 'begin',
        canBegin
    };
}

/** What is on Community now, counted; a count is left out until it is known. */
export interface CommunitySharedCounts {
    books?: number;
    timelines?: number;
    releasedScenes?: number;
    /** Scenes asked for on Community, waiting for Send or Decline here. */
    askedScenes?: number;
}

/**
 * The Vault → Community row's line while it is closed: the sharing level,
 * what is on Community now (only counts that are known and above zero), and
 * whether updates are going out.
 */
export function describeVaultToCommunity(settings: CommunityShareSettings, counts: CommunitySharedCounts): string {
    const shared = [
        counts.books ? tCount('sharedBook', counts.books) : null,
        counts.timelines ? tCount('sharedTimeline', counts.timelines) : null,
        counts.releasedScenes ? tCount('releasedScene', counts.releasedScenes) : null,
        counts.askedScenes ? tCount('sceneAsked', counts.askedScenes) : null,
    ].filter((part): part is string => part !== null);
    const lastSent = settings.connection.lastSyncedAt;
    const sync = settings.sharingPaused
        ? t('ui.communityShareSection.summaryPaused')
        : settings.scheduledPublishEnabled
            ? lastSent ? t('ui.communityShareSection.summaryLastSent', { date: formatCommunityDate(lastSent) }) : t('ui.communityShareSection.summarySending')
            : t('ui.communityShareSection.summaryNotStarted');
    return [
        getModeShortLabels()[deriveCommunityShareMode(settings)],
        ...(shared.length ? shared : [t('ui.communityShareSection.summaryNothingShared')]),
        sync,
    ].join(' · ');
}

/** What the website shows now, with Begin, Pause or Resume sharing. */
function renderSharingStateRow(plugin: RadialTimelinePlugin, containerEl: HTMLElement, parentEl: HTMLElement, settings: CommunityShareSettings): void {
    const state = describeCommunitySharingState(settings);
    const row = new Setting(parentEl).setDesc(state.desc);
    if (state.name) row.setName(state.name);
    renderSharingAction(plugin, containerEl, row, state, state.canBegin);
}

/** Begin, pause or resume sharing: the state row's one button. */
function renderSharingAction(plugin: RadialTimelinePlugin, containerEl: HTMLElement, row: Setting, state: CommunitySharingState, canBegin: boolean): void {
    if (state.action === 'resume') {
        row.addButton(button => button
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
        row.addButton(button => {
            if (state.action === 'pause') {
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
    }
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
    setIcon(badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON }), isConnected ? 'satellite-dish' : settings.connection.serverDisconnect ? 'unplug' : settings.enabled ? 'shield-check' : 'shield');
    const badgeText = badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: t('ui.communityShareSection.badgeLabel', { status: isConnected ? t('ui.communityShareSection.badgeChecking') : formatStatus(settings) }) });
    const wikiLink = withAccessibleLabel(badge.createEl('a', {
        href: docsUrl('Settings-Community'),
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: { 'target': '_blank', 'rel': 'noopener' }
    }), t('ui.communityShareSection.wikiAriaLabel'));
    setIcon(wikiLink, 'external-link');
    addVideoLinkToElement(badge, 'community-share', ERT_CLASSES.BADGE_PILL_WIKI);

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
        { icon: 'download', text: t('ui.communityShareSection.highlightReturn') }
    ].forEach(item => {
        const li = featuresList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        setIcon(li.createSpan({ cls: 'ert-feature-icon' }), item.icon);
        li.createSpan({ text: item.text });
    });

    hero.createEl('p', { cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.pricingPromise') });

    const activationSection = section.createDiv({ cls: ERT_CLASSES.STACK });
    if (!isConnected) {
        const connectionHeading = new Setting(activationSection)
            .setName(t('ui.communityShareSection.connectHeading'))
            .setHeading()
            .setDesc(t('ui.communityShareSection.connectDesc'));
        addHeadingIcon(connectionHeading, 'satellite-dish');
        applyErtHeaderLayout(connectionHeading);
    }

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
        const connectedAt = settings.connection.connectedAt ? formatCommunityDate(settings.connection.connectedAt) : '';
        // Connection: the link, Replace connection and Disconnect together.
        const statusRow = new Setting(activationSection)
            .setName(t('ui.communityShareSection.connectedHeading'))
            .setDesc(connectedAt
                ? t('ui.communityShareSection.linkedSince', { date: connectedAt })
                : t('ui.communityShareSection.linked'));
        statusRow.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: t('ui.communityShareSection.websiteContentNote') });
        const replacementContainer = activationSection.createDiv({ cls: 'ert-hidden' });
        statusRow.addButton(button => {
            let connectionHealthy = false;
            let checked = false;
            const renderState = (connected: boolean) => {
                button.buttonEl.empty();
                const iconEl = button.buttonEl.createSpan();
                setIcon(iconEl, connected && connectionHealthy ? 'satellite-dish' : 'x');
                button.buttonEl.createSpan({ text: !connected ? t('ui.communityShareSection.cancelReplace') : !checked ? t('ui.communityShareSection.connectionChecking') : connectionHealthy ? t('ui.communityShareSection.activeConnection') : t('ui.communityShareSection.reconnectButton') });
                button.buttonEl.toggleClass('ert-btn--connected', connected && connectionHealthy);
                button.setDisabled(!checked);
            };
            button.buttonEl.addClass('ert-btn--icon-left');
            renderState(true);
            const secretId = settings.connection.secretId;
            const connectionId = settings.connection.connectionId;
            void (secretId && connectionId ? getSecret(plugin.app, secretId) : Promise.resolve(null)).then(secret => {
                // This render may have been replaced while the keychain was being read.
                if (!section.isConnected) return;
                // A key in the keychain is not proof the connection stands: Community
                // says so, or answers who disconnected it and when (recorded by the
                // client, which turns this vault Disconnected).
                const known = secret && connectionId ? knownVaultSharingState(connectionId) : null;
                if (secret && connectionId && !known) {
                    if (!vaultStateInflight) {
                        vaultStateInflight = true;
                        void fetchVaultSharingState(plugin)
                            .then(state => { vaultStateCache = { connectionId, fetchedAt: Date.now(), state }; })
                            .catch((error: unknown) => {
                                vaultStateCache = { connectionId, fetchedAt: Date.now(), error: error instanceof Error ? error.message : String(error) };
                            })
                            .finally(() => {
                                vaultStateInflight = false;
                                if (!containerEl.isConnected) return;
                                containerEl.empty();
                                renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                            });
                    }
                    return;
                }
                const accountPaused = known?.state?.accountPaused;
                if (accountPaused) {
                    statusRow.descEl.createDiv({ cls: [ERT_CLASSES.FIELD_NOTE, 'ert-field-note--paragraph'], text: accountPausedNote(accountPaused) });
                }
                checked = true;
                connectionHealthy = Boolean(secret);
                badgeText.setText(t('ui.communityShareSection.badgeLabel', { status: t(connectionHealthy ? 'ui.communityShareSection.statusConnected' : 'ui.communityShareSection.badgeReconnect') }));
                renderState(replacementContainer.classList.contains('ert-hidden'));
                if (!connectionHealthy) {
                    const help = statusRow.descEl.createDiv({ cls: [ERT_CLASSES.FIELD_NOTE, 'ert-field-note--paragraph'], text: t('ui.communityShareSection.reconnectHelp') });
                    help.createEl('a', { text: t('ui.communityShareSection.reconnectWebsite'), href: COMMUNITY_MY_SHARE_URL, attr: { target: '_blank', rel: 'noopener' } });
                }
            });
            button.onClick(() => {
                const willShow = replacementContainer.classList.contains('ert-hidden');
                replacementContainer.classList.toggle('ert-hidden', !willShow);
                renderState(!willShow);
            });
        });
        statusRow.addButton(button => button
            .setButtonText(t('ui.communityShareSection.disconnectButton'))
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
                    button.setDisabled(false);
                }
            }));
        renderConnectionCodeSetting(replacementContainer);
        if (settings.lastError && settings.lastError !== t('ui.communityShareClient.secretMissing')) {
            statusRow.descEl.createDiv({ cls: [ERT_CLASSES.FIELD_NOTE, 'ert-field-note--paragraph'], text: settings.lastError });
        }
    } else {
        const codeRow = renderConnectionCodeSetting(activationSection);
        // Community said who disconnected this vault and when; the code row is the next step.
        if (settings.connection.serverDisconnect) {
            codeRow.descEl.createDiv({ cls: [ERT_CLASSES.FIELD_NOTE, 'ert-field-note--paragraph'], text: serverDisconnectNote(settings.connection.serverDisconnect) });
        }
        if (settings.lastError) {
            codeRow.descEl.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: settings.lastError });
        }
    }

    const cachedWebsiteContext = getCachedWebsiteContext(settings);
    const websiteContext = cachedWebsiteContext?.context;
    const websiteProject = getConnectedWebsiteProject(settings, websiteContext);

    // What is on Community now. Each count appears only once it is known: the
    // books from the website's answer, the timelines from this vault's
    // records, the released scenes from the Private scenes block's last answer.
    const counts: CommunitySharedCounts = {};
    if (isConnected && mode !== 'private') {
        if (websiteContext) counts.books = websiteContext.projects.filter(project => project.visibility === 'public').length;
        counts.timelines = plugin.settings.books.filter(book => timelineShareFor(settings, book.id)?.enabled).length;
        const sceneText = knownSceneTextCounts(settings, activeBook);
        counts.releasedScenes = sceneText.released;
        counts.askedScenes = sceneText.asked;
    }
    // Vault → Community opens by itself while sharing is not started or paused.
    const sharingSection = renderCommunityDirection(section, {
        view: containerEl,
        direction: 'send',
        name: t('ui.communityShareSection.sendTitle'),
        summary: describeVaultToCommunity(settings, counts),
        muted: false,
        // and when a scene asked for on Community waits for Send or Decline.
        needsAuthor: describeCommunitySharingState(settings).action !== 'pause' || Boolean(counts.askedScenes),
    });

    new Setting(sharingSection)
        .setName(t('ui.communityShareSection.sharingLevelName'))
        .setDesc(getModeNotes()[mode])
        .addDropdown(dropdown => {
            dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
            const modeLabels = getModeLabels();
            dropdown.addOption('private', modeLabels.private);
            dropdown.addOption('profile_books', modeLabels.profile_books);
            dropdown.addOption('progress', modeLabels.progress);
            dropdown.addOption('scene_text', modeLabels.scene_text);
            dropdown.setValue(mode);
            dropdown.onChange(async value => {
                const nextMode = value as CommunityShareMode;
                const update = buildCommunityShareModeUpdate(nextMode);
                // Level 4: the scene-sharing terms, once, before the level is saved. Choosing it sends nothing.
                if (nextMode === 'scene_text' && !await agreeToSceneTextTerms(plugin)) {
                    dropdown.setValue(mode);
                    fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 460, extraPx: 18 });
                    return;
                }
                if (nextMode === 'private' && hasLiveReport) {
                    const confirmed = await confirmWithErtModal(plugin.app, {
                        title: t('ui.communityShareSection.makePrivateTitle'),
                        message: t('ui.communityShareSection.makePrivateMessage'),
                        confirmText: t('ui.communityShareSection.makePrivateConfirm'),
                    });
                    if (!confirmed) {
                        dropdown.setValue(mode);
                        fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 460, extraPx: 18 });
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
                // until the author begins sharing again at the new level. Level 4
                // sends the report of the level it includes, so moving between
                // the two changes nothing the report sends.
                const reportChanges = update.tier !== settings.tier
                    || JSON.stringify(update.fieldPolicy) !== JSON.stringify(settings.fieldPolicy);
                if (settings.scheduledPublishEnabled && nextMode !== mode && reportChanges) {
                    update.scheduledPublishEnabled = false;
                    new Notice(nextMode === 'private'
                        ? t('ui.communityShareSection.privateOfflineNotice')
                        : t('ui.communityShareSection.levelChangedNotice'));
                }
                await save(update);
            });
            fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 460, extraPx: 18 });
        });

    const details = sharingSection.createEl('details', { cls: 'ert-communityPreviewDetails' });
    details.open = sharingDetailsOpen;
    details.addEventListener('toggle', () => { sharingDetailsOpen = details.open; });
    details.createEl('summary', { text: t('ui.communityShareSection.reviewSharingDetails') });
    const previewFrame = details.createDiv({ cls: `${ERT_CLASSES.PREVIEW_FRAME} ${ERT_CLASSES.STACK} ert-previewFrame--flush ert-communityPreview` });
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
            // At a level that shares writing activity (Level 3, and Level 4 when it
            // includes Level 3; public, tier 4) the daily sync also sends
            // the per-start-hour/mode rollup (hour_mode_mix) for the community
            // activity dial. It travels on the daily-sync endpoint, not in the
            // signed preview payload/hash — so it must be disclosed here in
            // words, or it would leave the vault without appearing on this card.
            // note: folding it into the preview payload+hash was considered and
            // rejected — it would break the payload/preview-hash separation from
            // the report publish and the daily-sync tests; disclosure only.
            if (sendsDailyActivity(settings)) {
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

    // Begin, Pause or Resume sharing sits under the level and its details.
    renderSharingStateRow(plugin, containerEl, sharingSection, settings);

    // The active book's block belongs to Vault → Community: its timeline, and at
    // Level 4 its scenes asked for and released. Before the vault connects, or
    // at Private, the state row says the next step and the block waits.
    if (isConnected && (settings.sharingPaused || canShareTimelineToCommunity(settings))) {
        renderCommunityTimelineBlock({ plugin, containerEl: sharingSection, book: activeBook, rerender });
        // A scene is released onto the book's shared timeline; without a source folder the Timeline block says what to do.
        if (activeBook?.sourceFolder?.trim()) {
            renderCommunitySceneTextBlock({ plugin, containerEl: sharingSection, book: activeBook, rerender });
        }
    }
    renderCommunityBookFromCommunityBlock({ plugin, viewEl: containerEl, containerEl: section, rerender });
}
