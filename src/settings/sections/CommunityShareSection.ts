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
    confirmCommunityShareActivation,
    deleteCommunityShareReport,
    disconnectCommunityShare,
    publishCommunityShareReport,
    revokeCommunityShareReport
} from '../../communityShare/communityShareClient';
import { buildCommunitySharePreview } from '../../communityShare/communitySharePreview';
import type { CommunityShareFieldKey, CommunityShareSettings } from '../../types/settings';
import { ERT_CLASSES } from '../../ui/classes';

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
    'activity.scenes_completed_by_stage': 'Completed scenes by stage',
    'activity.stage_mix': 'Stage mix',
    'activity.completed_scene_count': 'Completed scene count',
    'activity.revised_scene_count': 'Revised scene count',
    'activity.streak': 'Streak',
    'structure.real_scene_titles': 'Real scene titles',
    'activity.exact_session_timestamps': 'Exact session timestamps'
};

const MODE_LABELS: Record<CommunityShareMode, string> = {
    private: 'Private',
    profile_books: 'Profile + books',
    progress: 'Profile, books + progress summaries'
};

const MODE_NOTES: Record<CommunityShareMode, string> = {
    private: 'Nothing is shared. Your connection stays in place for when you are ready.',
    profile_books: 'Shows your public author profile and book cards so fellow authors can see what you are working on.',
    progress: 'Also shares progress summaries: writing days, words, minutes, streak, and mode mix as rounded weekly aggregates. Raw sessions stay in this vault.'
};

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

function getSelectedFieldLabels(settings: CommunityShareSettings): string[] {
    return COMMUNITY_SHARE_FIELD_KEYS
        .filter(key => settings.fieldPolicy[key])
        .map(key => FIELD_LABELS[key]);
}

function formatConnectedAt(value?: string): string {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value;
    }
}

export function renderCommunityShareSection({ plugin, containerEl }: CommunityShareSectionProps): void {
    const settings = getCommunitySettings(plugin);
    const activeBook = getActiveBook(plugin);
    const isConnected = settings.connection.status === 'connected';
    const mode = deriveCommunityShareMode(settings);
    const selectedFields = getSelectedFieldLabels(settings);
    const hasPublishedReport = settings.publishHistory.some(entry => entry.action === 'publish' && entry.status === 'success' && Boolean(entry.publishId));

    const section = containerEl.createDiv({
        cls: `${ERT_CLASSES.ROOT} ${ERT_CLASSES.STACK}`
    });

    const save = async (next: Partial<CommunityShareSettings>) => {
        const invalidatesPreview = next.fieldPolicy !== undefined
            || next.audience !== undefined
            || next.tier !== undefined;
        plugin.settings.communityShare = normalizeCommunityShareSettings({
            ...settings,
            ...next,
            fieldPolicy: next.fieldPolicy ?? settings.fieldPolicy,
            connection: next.connection ?? settings.connection,
            preview: next.preview ?? (invalidatesPreview
                ? {
                    ...settings.preview,
                    status: settings.preview.status === 'not_generated' ? 'not_generated' : 'stale',
                    previewHash: undefined,
                    payloadHash: undefined
                }
                : settings.preview)
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
        text: 'Show your author profile, show your books, and optionally share progress summaries. Review the complete preview, then publish.'
    });

    const heroFeatures = hero.createDiv({
        cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
    });
    heroFeatures.createDiv({ text: 'Community highlights:', cls: 'ert-kicker' });
    const featuresList = heroFeatures.createEl('ul', { cls: ERT_CLASSES.STACK });
    [
        { icon: 'lock', text: 'Private by default. You choose exactly when and what to share.' },
        { icon: 'eye', text: 'The complete preview shows you the full report before you publish.' },
        { icon: 'file-check', text: 'Reports share aggregate progress only. Your manuscript, paths, and raw sessions stay in this vault.' }
    ].forEach(item => {
        const li = featuresList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        setIcon(li.createSpan({ cls: 'ert-feature-icon' }), item.icon);
        li.createSpan({ text: item.text });
    });

    const activationCard = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });
    activationCard.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: 'Connect Radial Timeline' });
    activationCard.createDiv({
        cls: ERT_CLASSES.SECTION_DESC,
        text: 'Paste the one-time connection code from the website to link this vault to your Community profile.'
    });

    const renderConnectionCodeSetting = (targetEl: HTMLElement): void => {
        let tokenValue = '';
        let connectButton: ButtonComponent | null = null;
        new Setting(targetEl)
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
        const desc = connectedAt
            ? `Linked to your Community profile. Connected ${connectedAt}.`
            : 'Linked to your Community profile.';
        const replacementContainer = activationCard.createDiv({ cls: 'ert-hidden' });

        new Setting(activationCard)
            .setName('Active connection')
            .setDesc(desc)
            .addButton(button => {
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
    } else {
        new Setting(activationCard)
            .setName('Connection status')
            .setDesc('Ready to connect. Paste your connection code below to link this vault.');
        renderConnectionCodeSetting(activationCard);
    }

    if (settings.lastError) {
        activationCard.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: settings.lastError });
    }

    const sharingCard = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });
    sharingCard.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: 'What You Share' });
    sharingCard.createDiv({
        cls: ERT_CLASSES.SECTION_DESC,
        text: 'Pick one sharing level. The complete preview always shows exactly what a level includes before anything publishes.'
    });

    const modeSetting = new Setting(sharingCard)
        .setName('What you share')
        .setDesc('Manage your public profile and book cards on the website. ')
        .addDropdown(dropdown => {
            dropdown.addOption('private', MODE_LABELS.private);
            dropdown.addOption('profile_books', MODE_LABELS.profile_books);
            dropdown.addOption('progress', MODE_LABELS.progress);
            dropdown.setValue(mode);
            dropdown.onChange(value => save(buildCommunityShareModeUpdate(value as CommunityShareMode)));
        });
    const profileLink = modeSetting.descEl.createEl('a', {
        href: 'https://www.radialtimeline.com/community/me',
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: {
            'aria-label': 'Open your community profile',
            'target': '_blank',
            'rel': 'noopener'
        }
    });
    setIcon(profileLink, 'external-link');
    sharingCard.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: MODE_NOTES[mode] });

    const previewCard = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });
    previewCard.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: 'Complete Preview' });
    previewCard.createDiv({
        cls: ERT_CLASSES.SECTION_DESC,
        text: 'The exact category checklist for the website report. Generate the preview below to create its signed hash.'
    });
    const previewFrame = previewCard.createDiv({ cls: `${ERT_CLASSES.PREVIEW_FRAME} ${ERT_CLASSES.STACK} ert-previewFrame--flush` });
    previewFrame.createDiv({ cls: 'ert-previewFrame__title', text: activeBook?.publicLabel || activeBook?.title || 'No active project selected' });
    previewFrame.createDiv({ text: `Sharing: ${MODE_LABELS[mode]}` });
    previewFrame.createDiv({ text: `Project stage: ${activeBook?.projectStage || 'Not set'}` });
    previewFrame.createDiv({ text: `Genre: ${activeBook?.genre || 'Not set'}` });
    previewFrame.createDiv({ text: `Public description: ${activeBook?.publicDescription || 'Not set'}` });
    previewFrame.createDiv({ text: selectedFields.length ? `Included fields: ${selectedFields.join(', ')}` : 'Included fields: choose a sharing level above to include them' });
    previewFrame.createDiv({ text: 'Stays in this vault: manuscript text, scene/note/vault paths, raw sessions, exact timestamps, secrets.' });
    previewFrame.createDiv({
        text: hasReadyPreview(settings)
            ? `Preview ready: ${settings.preview.generatedAt ?? 'time not recorded'}`
            : 'Generate the preview below when you are ready.'
    });
    if (settings.preview.summary) {
        previewFrame.createDiv({ text: settings.preview.summary });
    }
    if (settings.preview.previewHash) {
        previewFrame.createDiv({ text: `Preview hash: ${settings.preview.previewHash.slice(0, 12)}...` });
    }

    const canGeneratePreview = mode !== 'private'
        && isConnected
        && selectedFields.length > 0;
    new Setting(previewCard)
        .setName('Generate preview')
        .setDesc(canGeneratePreview ? 'Builds the hash-checked preview from your selected sharing level.' : 'Next steps: connect this vault and pick a sharing level above.')
        .addButton(button => button
            .setButtonText('Generate complete preview')
            .setDisabled(!canGeneratePreview)
            .onClick(async () => {
                button.setDisabled(true);
                button.setButtonText('Generating...');
                try {
                    const preview = await buildCommunitySharePreview(plugin);
                    await save({
                        preview: {
                            status: 'ready',
                            generatedAt: new Date().toISOString(),
                            previewHash: preview.previewHash,
                            payloadHash: preview.payloadHash,
                            reportPeriod: 'weekly',
                            summary: preview.summary
                        },
                        lastError: undefined
                    });
                    new Notice('Complete preview generated. Review it before publishing.');
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Could not generate the Complete Preview.';
                    await save({
                        preview: {
                            ...settings.preview,
                            status: 'blocked'
                        },
                        lastError: message
                    });
                    new Notice(message);
                }
            }));

    const actionCard = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });
    actionCard.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: 'Publish and Safety' });
    actionCard.createDiv({
        cls: ERT_CLASSES.SECTION_DESC,
        text: 'Connect this vault, choose what you share, and generate the Complete Preview to make publishing available.'
    });
    const canPublish = mode !== 'private'
        && isConnected
        && settings.audience === 'public'
        && settings.tier >= 1
        && settings.tier <= 4
        && hasReadyPreview(settings)
        && selectedFields.length > 0;

    new Setting(actionCard)
        .setName('Publish report')
        .setDesc(canPublish ? 'Ready to publish.' : 'Next steps: connect, pick a sharing level, and generate the Complete Preview.')
        .addButton(button => button
            .setButtonText('Publish report')
            .setCta()
            .setDisabled(!canPublish)
            .onClick(async () => {
                button.setDisabled(true);
                button.setButtonText('Publishing...');
                try {
                    const result = await publishCommunityShareReport(plugin);
                    new Notice(`Community report published: ${result.public_slug}`);
                    containerEl.empty();
                    renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                } catch (error) {
                    const message = error instanceof CommunityShareError
                        ? error.message
                        : 'Community publish failed. Review the Complete Preview and try again.';
                    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                    plugin.settings.communityShare = normalizeCommunityShareSettings({
                        ...current,
                        lastError: message
                    });
                    void plugin.saveSettings();
                    new Notice(message);
                    button.setButtonText('Publish report');
                    button.setDisabled(!canPublish);
                }
            }));

    new Setting(actionCard)
        .setName('Pause public report')
        .setDesc('Temporarily hides the public report. Your settings stay in place so you can resume anytime.')
        .addButton(button => button.setButtonText('Pause').setDisabled(true));

    new Setting(actionCard)
        .setName('Revoke public report')
        .setDesc('Takes down the current public report. Your connection stays active so you can publish again later.')
        .addButton(button => button
            .setButtonText('Revoke')
            .setDisabled(!isConnected || !hasPublishedReport)
            .onClick(async () => {
                button.setDisabled(true);
                button.setButtonText('Revoking...');
                try {
                    await revokeCommunityShareReport(plugin);
                    new Notice('Community report revoked.');
                    containerEl.empty();
                    renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                } catch (error) {
                    const message = error instanceof CommunityShareError ? error.message : 'Could not revoke the Community report.';
                    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                    plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                    void plugin.saveSettings();
                    new Notice(message);
                    button.setButtonText('Revoke');
                    button.setDisabled(!isConnected || !hasPublishedReport);
                }
            }));

    new Setting(actionCard)
        .setName('Delete shared report data')
        .setDesc('Deletes the report payload from the website. Audit metadata remains for your records.')
        .addButton(button => button
            .setButtonText('Delete shared data')
            .setDisabled(!isConnected || !hasPublishedReport)
            .onClick(async () => {
                if (!window.confirm('Delete the shared Community report payload from the website? Local writing data stays in this vault.')) return;
                button.setDisabled(true);
                button.setButtonText('Deleting...');
                try {
                    await deleteCommunityShareReport(plugin);
                    new Notice('Shared community report data deleted.');
                    containerEl.empty();
                    renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                } catch (error) {
                    const message = error instanceof CommunityShareError ? error.message : 'Could not delete shared Community report data.';
                    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                    plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                    void plugin.saveSettings();
                    new Notice(message);
                    button.setButtonText('Delete shared data');
                    button.setDisabled(!isConnected || !hasPublishedReport);
                }
            }));

    new Setting(actionCard)
        .setName('Disconnect plugin')
        .setDesc('Unlinks this vault from the website. Your writing data stays in this vault, and you can reconnect anytime.')
        .addButton(button => button
            .setButtonText('Disconnect')
            .setDisabled(!isConnected)
            .onClick(async () => {
                if (!window.confirm('Disconnect this vault from Community Share? Your writing data stays in this vault.')) return;
                button.setDisabled(true);
                button.setButtonText('Disconnecting...');
                try {
                    await disconnectCommunityShare(plugin);
                    new Notice('Community share disconnected.');
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
