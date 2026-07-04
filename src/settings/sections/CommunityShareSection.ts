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
    deleteCommunityShareReport,
    disconnectCommunityShare,
    pauseCommunitySharing,
    revokeCommunityShareReport,
    syncCommunityShareIfDue
} from '../../communityShare/communityShareClient';
import { buildCommunitySharePreview } from '../../communityShare/communitySharePreview';
import type { CommunityShareFieldKey, CommunityShareSettings } from '../../types/settings';
import { ERT_CLASSES } from '../../ui/classes';
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
    profile_books: 'Shows your public author profile and book projects so fellow authors can see what you are working on.',
    progress: 'Manage your public profile and book projects on the website. Plus shares progress summaries: writing days, words, minutes, streak.'
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
    const hasPublishedReport = settings.publishHistory.some(entry => (entry.action === 'publish' || entry.action === 'sync') && entry.status === 'success' && Boolean(entry.publishId));

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
        text: 'Show your author profile, show your books, and optionally share progress summaries. Review the complete preview, then begin sharing.'
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
                ? `Linked to your Community profile. Connected ${connectedAt}.`
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
        href: 'https://www.radialtimeline.com/community/me',
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
            dropdown.onChange(value => {
                const nextMode = value as CommunityShareMode;
                const update = buildCommunityShareModeUpdate(nextMode);
                // Scope changes re-arm the explicit consent step: sharing pauses
                // until the author begins sharing again at the new level.
                if (settings.scheduledPublishEnabled && nextMode !== mode) {
                    update.scheduledPublishEnabled = false;
                    new Notice('Sharing level changed. Review the preview, then begin sharing again.');
                }
                void save(update);
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

    previewFrame.createDiv({ cls: 'ert-communityPreview__title', text: activeBook?.publicLabel || activeBook?.title || 'No active project selected' });
    previewFrame.createDiv({ cls: 'ert-kicker', text: `Sharing: ${MODE_LABELS[mode]}` });

    if (mode === 'private') {
        addDivider();
        previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: MODE_NOTES.private });
    } else {
        addDivider();
        const propertyPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
        addChip(propertyPills, 'Stage', activeBook?.projectStage || 'Not set');
        addChip(propertyPills, 'Genre', activeBook?.genre || 'Not set');
        addChip(propertyPills, 'Description', activeBook?.publicDescription || 'Not set');

        addDivider();
        previewFrame.createDiv({ cls: 'ert-kicker', text: 'Included fields' });
        if (selectedFields.length) {
            const fieldPills = previewFrame.createDiv({ cls: 'ert-communityPreview__pills' });
            selectedFields.forEach(label => addChip(fieldPills, label));
        } else {
            previewFrame.createDiv({ cls: 'ert-communityPreview__note', text: 'Choose a sharing level above to include fields.' });
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
        .setDesc('Begin sharing to put your selected level on the community site and keep it current automatically. Pause, revoke, or disconnect anytime.');
    addHeadingIcon(actionHeading, 'shield-check');
    applyErtHeaderLayout(actionHeading);
    const sharingOn = settings.scheduledPublishEnabled;
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

    new Setting(actionCard)
        .setDesc(sharingOn
            ? `Sharing is on and kept current automatically.${lastSynced ? ` Last synced ${lastSynced}.` : ''}`
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
                        new Notice('Sharing paused. What you already shared stays visible until you revoke it.');
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

    new Setting(actionCard)
        .setName('Revoke sharing')
        .setDesc('Takes down what you have shared from the website. Your connection stays in place, so you can begin sharing again later.')
        .addButton(button => button
            .setButtonText('Revoke')
            .setDisabled(!isConnected || !hasPublishedReport)
            .onClick(async () => {
                button.setDisabled(true);
                button.setButtonText('Revoking...');
                try {
                    await revokeCommunityShareReport(plugin);
                    new Notice('Sharing revoked. Nothing is shared on the website now.');
                    containerEl.empty();
                    renderCommunityShareSection({ app: plugin.app, plugin, containerEl });
                } catch (error) {
                    const message = error instanceof CommunityShareError ? error.message : 'Could not revoke sharing.';
                    const current = normalizeCommunityShareSettings(plugin.settings.communityShare);
                    plugin.settings.communityShare = normalizeCommunityShareSettings({ ...current, lastError: message });
                    void plugin.saveSettings();
                    new Notice(message);
                    button.setButtonText('Revoke');
                    button.setDisabled(!isConnected || !hasPublishedReport);
                }
            }));

    new Setting(actionCard)
        .setName('Delete shared data')
        .setDesc('Deletes your shared data from the website. Audit metadata remains for your records.')
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
