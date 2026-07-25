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
    confirmCommunityShareActivation,
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
import type { CommunityShareFieldKey, CommunityShareSettings } from '../../types/settings';
import { ERT_CLASSES } from '../../ui/classes';
import { confirmWithErtModal } from '../../modals/ErtConfirmModal';
import { addHeadingIcon, applyErtHeaderLayout } from '../wikiLink';
import { fitSelectToSelectedLabel } from '../selectSizing';

export interface CommunityShareSectionProps {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

// Labels for the Complete Preview field listing. The field manifest itself is
// wire-level machinery; authors choose a sharing mode, not individual fields.
const FIELD_LABELS: Record<CommunityShareFieldKey, string> = {
    'project.title': 'Project title',
    'project.alias': 'Project alias',
    'project.description': 'Project description',
    'project.status': 'Project status',
    'project.genre': 'Genre',
    'project.custom_genre_label': 'Custom genre note',
    'activity.report_period': 'Report period',
    'activity.writing_days': 'Writing days',
    'activity.minutes_total': 'Minutes this week',
    'activity.words_added': 'Words this week',
    'activity.session_count': 'Session count',
    'activity.mode_mix': 'Mode mix',
    'activity.scenes_completed_by_stage': 'Completed scenes by stage (this week)',
    'activity.stage_mix': 'Current stage mix (whole book)',
    'activity.completed_scene_count': 'Completed scene count',
    'activity.revised_scene_count': 'Revised scene count',
    'activity.streak': 'Streak',
    'structure.real_scene_titles': 'Real scene titles',
    'activity.exact_session_timestamps': 'Exact session timestamps'
};

const MODE_LABELS: Record<CommunityShareMode, string> = {
    private: 'Level 1 — Private',
    profile_books: 'Level 2 — Profile, books + APR',
    progress: 'Level 3 — Profile, books + writing activity'
};

const MODE_NOTES: Record<CommunityShareMode, string> = {
    private: 'Your writing-activity share is taken offline. Your profile, books, and posts on the website stay as they are — manage those on My Share. Your connection stays in place.',
    profile_books: 'Shows your profile and selected books. APR campaigns can add a controlled visual progress report without sharing writing activity.',
    progress: 'Includes your profile, books, and APR, plus rounded writing activity: writing days, words, minutes, streak, and mode mix.'
};

const MY_SHARE_URL = 'https://community.radialtimeline.com/me';

// Canonical website context for the Complete Preview. Profile and project
// shell fields (title, status, genre, description) are managed on the
// website; the preview must show those server-side values, never
// plugin-local stand-ins. The section rerenders on every save, so the
// fetch result lives module-side and refreshes at most once per TTL.
interface WebsiteContextCache {
    connectionId: string;
    fetchedAt: number;
    context?: CommunityShareContext;
    error?: string;
}
let websiteContextCache: WebsiteContextCache | null = null;
let websiteContextInflight = false;
const WEBSITE_CONTEXT_TTL_MS = 5 * 60 * 1000;

function getCachedWebsiteContext(settings: CommunityShareSettings): WebsiteContextCache | null {
    const connectionId = settings.connection.connectionId;
    if (!connectionId || !websiteContextCache || websiteContextCache.connectionId !== connectionId) return null;
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
    const sharedCount = context?.projects.filter(project => project.visibility === 'public').length ?? 0;
    return sharedCount > 1 ? `${baseTitle} & others (${sharedCount})` : baseTitle;
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
    drafting: 'Drafting',
    revising: 'Revising',
    querying: 'Querying',
    published: 'Published',
    hiatus: 'On hiatus'
};

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
    if (settings.connection.status === 'connected') return 'Connected';
    if (settings.connection.status === 'paused') return 'Paused';
    if (settings.connection.status === 'revoked') return 'Revoked';
    if (settings.connection.status === 'pending') return 'Pending';
    return 'Not connected';
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
        .map(key => FIELD_LABELS[key]);
}

function formatConnectedAt(value?: string): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

function formatGeneratedAt(value?: string): string {
    if (!value) return 'time not recorded';
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
    const communityAprCampaigns = (plugin.settings.authorProgress?.campaigns ?? [])
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
    badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: `Community share - ${formatStatus(settings)}` });
    const wikiLink = badge.createEl('a', {
        href: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Settings-Community',
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: {
            'aria-label': 'Read more in the wiki',
            'target': '_blank',
            'rel': 'noopener'
        }
    });
    setIcon(wikiLink, 'external-link');

    const titleRow = hero.createDiv({ cls: 'ert-hero-titleRow' });
    titleRow.createDiv({
        cls: `${ERT_CLASSES.SECTION_TITLE} ert-hero-title`,
        text: 'Community share'
    });
    hero.createEl('p', {
        cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle`,
        text: 'Show your profile and books, add a controlled APR progress graphic, or share rounded writing activity. Review the complete preview, then begin sharing.'
    });

    const heroFeatures = hero.createDiv({
        cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
    });
    heroFeatures.createDiv({ text: 'Community highlights:', cls: 'ert-kicker' });
    const featuresList = heroFeatures.createEl('ul', { cls: ERT_CLASSES.STACK });
    [
        { icon: 'lock', text: 'Private by default. You choose exactly when and what to share.' },
        { icon: 'eye', text: 'The complete preview shows you exactly what you share before you publish.' },
        { icon: 'file-check', text: 'You share aggregate progress only. Your manuscript, paths, and raw sessions stay in this vault.' }
    ].forEach(item => {
        const li = featuresList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        setIcon(li.createSpan({ cls: 'ert-feature-icon' }), item.icon);
        li.createSpan({ text: item.text });
    });

    const activationSection = section.createDiv({ cls: ERT_CLASSES.STACK });
    const connectionHeading = new Setting(activationSection)
        .setName('Connect Radial Timeline')
        .setHeading()
        .setDesc('Paste the one-time connection code from the website to link this vault to your community profile.');
    addHeadingIcon(connectionHeading, 'satellite-dish');
    applyErtHeaderLayout(connectionHeading);

    const renderConnectionCodeSetting = (targetEl: HTMLElement): Setting => {
        let tokenValue = '';
        let connectButton: ButtonComponent | null = null;
        return new Setting(targetEl)
            .setName('Connection code')
            .setDesc('Links this vault to your saved community profile so publishing is ready when you are.')
            .addText(text => {
                text.setPlaceholder('Connection code from radialtimeline.com');
                text.onChange(value => {
                    tokenValue = value.trim();
                    connectButton?.setDisabled(tokenValue.length < 16);
                });
            })
            .addButton(button => {
                connectButton = button;
                button
                    .setButtonText('Connect')
                    .setDisabled(true)
                    .onClick(async () => {
                        button.setDisabled(true);
                        button.setButtonText('Connecting...');
                        try {
                            const result = await confirmCommunityShareActivation(plugin, tokenValue);
                            new Notice(`Community Share connected to ${result.project_title || 'your website project'}.`);
                            containerEl.empty();
                            renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                        } catch (error) {
                            const message = error instanceof CommunityShareError
                                ? error.message
                                : 'Community connection failed. Generate a new code and try again.';
                            const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                            plugin.settings.communityShare = normalizeCommunityShareSettings({
                                ...current,
                                lastError: message
                            });
                            void plugin.saveSettings();
                            new Notice(message);
                            button.setButtonText('Connect');
                            button.setDisabled(tokenValue.length < 16);
                        }
                    });
            });
    };

    if (isConnected) {
        const connectedAt = formatConnectedAt(settings.connection.connectedAt);
        const statusRow = new Setting(activationSection)
            .setDesc(connectedAt
                ? `Linked to your Community profile since ${connectedAt}. Data syncs are shown under Sharing and safety below.`
                : 'Linked to your Community profile.');
        const replacementContainer = activationSection.createDiv({ cls: 'ert-hidden' });
        statusRow.addButton(button => {
            const renderState = (connected: boolean) => {
                button.buttonEl.empty();
                const iconEl = button.buttonEl.createSpan();
                setIcon(iconEl, connected ? 'satellite-dish' : 'x');
                button.buttonEl.createSpan({ text: connected ? 'Active connection' : 'Cancel replace' });
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
        .setName('What you share')
        .setHeading()
        .setDesc('Pick one sharing level. The complete preview always shows exactly what a level includes before anything publishes.');
    addHeadingIcon(sharingHeading, 'share-2');
    const profileLink = sharingHeading.nameEl.createEl('a', {
        href: MY_SHARE_URL,
        cls: 'ert-wiki-link',
        attr: {
            'aria-label': 'Open your community profile',
            'target': '_blank',
            'rel': 'noopener'
        }
    });
    setIcon(profileLink, 'external-link');
    applyErtHeaderLayout(sharingHeading);

    new Setting(sharingSection)
        .setDesc(MODE_NOTES[mode])
        .addDropdown(dropdown => {
            dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
            dropdown.addOption('private', MODE_LABELS.private);
            dropdown.addOption('profile_books', MODE_LABELS.profile_books);
            dropdown.addOption('progress', MODE_LABELS.progress);
            dropdown.setValue(mode);
            dropdown.onChange(async value => {
                const nextMode = value as CommunityShareMode;
                const update = buildCommunityShareModeUpdate(nextMode);
                if (nextMode === 'private' && hasLiveReport) {
                    const confirmed = await confirmWithErtModal(plugin.app, {
                        title: 'Make this vault private?',
                        message: 'Take its current shared data offline? Your website account, profile, books, posts, and sharing history stay in place.',
                        confirmText: 'Make private',
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
                        const message = error instanceof CommunityShareError ? error.message : 'Could not take the current shared data offline.';
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
                        ? 'This vault is private and its current shared data is offline.'
                        : 'Sharing level changed. Review the preview, then begin sharing again.');
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
        text: previewTitleBase ? formatPreviewTitle(previewTitleBase, websiteContext) : 'No active project selected'
    });
    previewFrame.createDiv({ cls: 'ert-kicker', text: `Sharing: ${MODE_LABELS[mode]}` });

    if (mode === 'private') {
        addDivider();
        previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: MODE_NOTES.private });
    } else {
        // One publish, two origins. Profile and project shell fields are
        // managed on the website and shown here with their canonical
        // server-side values; only activity summaries come from this vault.
        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: 'From your website profile' });
        if (!isConnected) {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: 'Connect this vault to load the public profile and project details your shared data attaches to.'
            });
        } else if (cachedWebsiteContext?.error) {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: `Could not load these from the website: ${cachedWebsiteContext.error}`
            });
        } else if (!websiteContext) {
            previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: 'Loading your public profile from the website...' });
        } else {
            const profile = websiteContext.profile;
            const websitePills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            const authorLabel = profile?.display_name && profile.handle
                ? `${profile.display_name} @${profile.handle}`
                : profile?.display_name || (profile?.handle ? `@${profile.handle}` : undefined);
            addChip(websitePills, 'Author', authorLabel || 'Not set');
            if (websiteProject) {
                addChip(websitePills, 'Title', websiteProject.title || 'Not set');
                addChip(websitePills, 'Status', websiteProject.status
                    ? PROJECT_STATUS_LABELS[websiteProject.status] ?? websiteProject.status
                    : 'Not set');
                addChip(websitePills, 'Genre', formatWebsiteGenre(websiteProject) || 'Not set');
                if (websiteProject.custom_genre_label) {
                    addChip(websitePills, 'Custom genre', websiteProject.custom_genre_label);
                }
                addChip(websitePills, 'Description', websiteProject.logline || 'Not set');
            } else {
                previewFrame.createDiv({
                    cls: 'ert-communityPreview__note',
                    text: 'Your connected project was not found on the website. Open My Share to check it.'
                });
            }
        }
        const editOnWebsiteNote = previewFrame.createDiv({ cls: 'ert-communityPreview__note' });
        editOnWebsiteNote.appendText('Edit these on the website — ');
        editOnWebsiteNote.createEl('a', {
            text: 'My Share',
            href: MY_SHARE_URL,
            attr: { target: '_blank', rel: 'noopener' }
        });

        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: 'From this vault' });
        // Publishing targets ride along with project sync (active book), but
        // stay hidden on the website until revealed in My Share.
        previewFrame.createDiv({
            cls: 'ert-communityPreview__note',
            text: 'Your target dates (Zero / Author / House / Press) and Zero-draft mode sync to your active book, but stay hidden until you reveal them in My Share.'
        });
        if (communityAprCampaigns.length > 0) {
            const aprPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            communityAprCampaigns.forEach(campaign => {
                const targetBook = campaign.targetBookId
                    ? plugin.settings.books.find(book => book.id === campaign.targetBookId)
                    : activeBook;
                const frequency = campaign.updateFrequency ?? 'manual';
                addChip(aprPills, 'APR', `${campaign.name} · ${targetBook?.title ?? 'No book'} · ${frequency}`);
            });
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: 'APR graphics land privately on My Share. Preview the exact graphic and teaser reveal in Social, then activate public display on the website.'
            });
        } else {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: 'No APR campaigns send to Community. Enable one in Social → Campaigns when you want a controlled visual progress report.'
            });
        }
        // The preview card speaks in general terms — the author wants the gist
        // of what leaves the vault, not the telemetry schema. The field-policy
        // controls elsewhere keep the precise FIELD_LABELS names.
        const PREVIEW_FIELD_LABELS: Partial<Record<CommunityShareFieldKey, string>> = {
            'activity.minutes_total': 'Session length',
            'activity.words_added': 'Words written',
            'activity.session_count': 'Sessions',
            'activity.scenes_completed_by_stage': 'Scenes by stage',
            'activity.stage_mix': 'Stage mix',
            'activity.completed_scene_count': 'Scenes completed',
            'activity.revised_scene_count': 'Scenes revised'
        };
        const activityFieldLabels = COMMUNITY_SHARE_FIELD_KEYS
            .filter(key => settings.fieldPolicy[key] && key.startsWith('activity.'))
            .map(key => PREVIEW_FIELD_LABELS[key] ?? FIELD_LABELS[key]);
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
                addChip(fieldPills, 'Per-day totals');
                addChip(fieldPills, 'Writing-time pattern');
                previewFrame.createDiv({
                    cls: 'ert-communityPreview__note',
                    text: 'Writing-time pattern: which hours of the day you tend to write, rounded and grouped by mode — never exact times or dates.'
                });
            }
        } else {
            previewFrame.createDiv({
                cls: 'ert-communityPreview__note',
                text: 'No writing activity is shared at this level — only the website profile and book details above.'
            });
        }

        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: 'Stays in this vault' });
        previewFrame.createDiv({
            cls: 'ert-communityPreview__note',
            text: 'Manuscript text, scene/note/vault paths, raw sessions, exact timestamps, secrets.'
        });

        addDivider();
        previewFrame.createDiv({
            cls: 'ert-communityPreview__status',
            text: hasReadyPreview(settings)
                ? `Preview ready — ${formatGeneratedAt(settings.preview.generatedAt)}`
                : settings.preview.status === 'blocked'
                    ? 'Preview unavailable.'
                    : 'Updating preview...'
        });
        if (settings.preview.summary) {
            previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: settings.preview.summary });
        }
        if (settings.preview.previewHash) {
            const hashPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            addChip(hashPills, 'Preview hash', `${settings.preview.previewHash.slice(0, 12)}...`);
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
    const contextFresh = websiteContextCache
        && websiteContextCache.connectionId === contextConnectionId
        && Date.now() - websiteContextCache.fetchedAt < WEBSITE_CONTEXT_TTL_MS;
    if (mode !== 'private' && isConnected && contextConnectionId && !contextFresh && !websiteContextInflight) {
        websiteContextInflight = true;
        void fetchCommunityShareContext(plugin)
            .then(context => {
                websiteContextCache = { connectionId: contextConnectionId, fetchedAt: Date.now(), context };
            })
            .catch(error => {
                websiteContextCache = {
                    connectionId: contextConnectionId,
                    fetchedAt: Date.now(),
                    error: error instanceof Error ? error.message : 'Could not load your public profile from the website.'
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
            const upToDate = current.preview.status === 'ready'
                && current.preview.previewHash === preview.previewHash
                && current.preview.payloadHash === preview.payloadHash;
            if (upToDate) return;
            plugin.settings.communityShare = normalizeCommunityShareSettings({
                ...current,
                preview: {
                    status: 'ready',
                    generatedAt: new Date().toISOString(),
                    previewHash: preview.previewHash,
                    payloadHash: preview.payloadHash,
                    reportPeriod: 'weekly',
                    summary: preview.summary
                },
                lastError: current.preview.status === 'blocked' ? undefined : current.lastError
            });
            await plugin.saveSettings();
            // Standing share: if sharing is on and the content changed, push
            // the refreshed payload before repainting so the card and the
            // website stay in step.
            if (current.scheduledPublishEnabled) {
                await syncCommunityShareIfDue(plugin);
            }
            rerender();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not build the complete preview.';
            if (current.preview.status === 'blocked' && current.lastError === message) return;
            plugin.settings.communityShare = normalizeCommunityShareSettings({
                ...current,
                preview: {
                    ...current.preview,
                    status: 'blocked',
                    previewHash: undefined,
                    payloadHash: undefined
                },
                lastError: message
            });
            await plugin.saveSettings();
            rerender();
        }
    })();

    const actionCard = section.createDiv({ cls: ERT_CLASSES.STACK });
    const actionHeading = new Setting(actionCard)
        .setName('Sharing and safety')
        .setHeading()
        .setDesc('These controls manage this vault\'s connection only. Everything already on your Community account stays where it is. You view, download, or delete Community content on the website.');
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
            .setDesc('Sharing is paused. Nothing leaves this vault until you resume.')
            .addButton(button => button
                .setButtonText('Resume sharing')
                .setCta()
                .onClick(async () => {
                    button.setDisabled(true);
                    button.setButtonText('Resuming...');
                    try {
                        await resumeCommunitySharing(plugin);
                        new Notice('Sharing resumed. This vault will keep your Community account current again.');
                        containerEl.empty();
                        renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                    } catch (error) {
                        const message = error instanceof CommunityShareError
                            ? error.message
                            : 'Could not resume sharing. Try again.';
                        const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                        plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                        void plugin.saveSettings();
                        new Notice(message);
                        button.setButtonText('Resume sharing');
                        button.setDisabled(false);
                    }
                }));
    } else {
        const shareRow = new Setting(actionCard)
            .setDesc(sharingOn
                ? `Sharing is on. This vault keeps your Community account current automatically.${lastSynced ? ` Last synced ${lastSynced}.` : ''}`
                : canBegin
                    ? 'Sharing is off. Nothing leaves this vault until you begin sharing.'
                    : 'Next steps: connect this vault and pick a sharing level above, then begin sharing.')
            .addButton(button => {
                if (sharingOn) {
                    button
                        .setButtonText('Pause sharing')
                        .onClick(async () => {
                            button.setDisabled(true);
                            await pauseCommunitySharing(plugin);
                            new Notice('Sharing paused. Nothing will leave this vault until you resume. Everything already shared stays visible.');
                            containerEl.empty();
                            renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                        });
                } else {
                    button
                        .setButtonText('Begin sharing')
                        .setCta()
                        .setDisabled(!canBegin)
                        .onClick(async () => {
                            button.setDisabled(true);
                            button.setButtonText('Starting...');
                            try {
                                await beginCommunitySharing(plugin);
                                new Notice('Community sharing is on. Your page stays current automatically.');
                                containerEl.empty();
                                renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                            } catch (error) {
                                const message = error instanceof CommunityShareError
                                    ? error.message
                                    : 'Community sharing failed. Review the complete preview and try again.';
                                const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                                plugin.settings.communityShare = normalizeCommunityShareSettings({
                                    ...current,
                                    lastError: message
                                });
                                void plugin.saveSettings();
                                new Notice(message);
                                button.setButtonText('Begin sharing');
                                button.setDisabled(!canBegin);
                            }
                        });
                }
            });
        if (sharingOn) {
            shareRow.descEl.createDiv({
                cls: ERT_CLASSES.FIELD_NOTE,
                text: 'Stops automatic updates. Everything already on your Community account stays visible. Resume anytime.'
            });
        }
    }

    new Setting(actionCard)
        .setName('Disconnect this vault')
        .setDesc('Stops updates and removes this vault\'s saved connection key. Your Community account isn\'t touched. To connect again, generate a new one-time linking key on the website.')
        .addButton(button => button
            .setButtonText('Disconnect')
            .setDisabled(!isConnected)
            .onClick(async () => {
                const confirmed = await confirmWithErtModal(plugin.app, {
                    title: 'Disconnect this vault?',
                    message: 'Updates will stop and the saved connection key will be removed. Everything on your Community account stays as it is. Reconnecting requires a new one-time linking key.',
                    confirmText: 'Disconnect',
                });
                if (!confirmed) return;
                button.setDisabled(true);
                button.setButtonText('Disconnecting...');
                try {
                    await disconnectCommunityShare(plugin);
                    new Notice('Vault disconnected. Your Community account is unchanged. Use a new one-time linking key to share again.');
                    containerEl.empty();
                    renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                } catch (error) {
                    const message = error instanceof CommunityShareError ? error.message : 'Could not disconnect Community Share.';
                    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                    plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                    void plugin.saveSettings();
                    new Notice(message);
                    button.setButtonText('Disconnect');
                    button.setDisabled(!isConnected);
                }
            }));
}
