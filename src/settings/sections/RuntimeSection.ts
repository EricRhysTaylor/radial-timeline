/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 * 
 * Runtime Estimation Settings Section
 */

import { App, Setting, TextComponent, DropdownComponent, setIcon, Modal, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { RuntimeContentType, RuntimeRateProfile } from '../../types';
import { addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { t } from '../../i18n';
import { hasProFeatureAccess } from '../featureGate';
import { ERT_CLASSES } from '../../ui/classes';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { runtimeRatesFromSettings } from '../../utils/runtimeEstimator';

interface SectionParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

export function renderRuntimeSection({ plugin, containerEl }: SectionParams): void {
    const hasProfessional = hasProFeatureAccess(plugin);
    const generateProfileId = () => `rtp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const buildProfileFromLegacy = () => ({
        id: 'default',
        label: 'Default',
        ...runtimeRatesFromSettings(plugin.settings),
        sessionPlanning: {
            draftingWpm: undefined,
            recordingWpm: undefined,
            editingWpm: undefined,
            dailyMinutes: undefined,
            dailyWords: undefined,
        },
    });

    const ensureProfiles = () => {
        if (!plugin.settings.runtimeRateProfiles || plugin.settings.runtimeRateProfiles.length === 0) {
            plugin.settings.runtimeRateProfiles = [buildProfileFromLegacy()];
        }
        if (!plugin.settings.defaultRuntimeProfileId) {
            plugin.settings.defaultRuntimeProfileId = plugin.settings.runtimeRateProfiles[0].id;
        }
    };

    const syncLegacyFromProfile = (profile: { contentType: RuntimeContentType; dialogueWpm?: number; actionWpm?: number; narrationWpm?: number; beatSeconds?: number; pauseSeconds?: number; longPauseSeconds?: number; momentSeconds?: number; silenceSeconds?: number; }) => {
        plugin.settings.runtimeContentType = profile.contentType;
        if (profile.dialogueWpm !== undefined) plugin.settings.runtimeDialogueWpm = profile.dialogueWpm;
        if (profile.actionWpm !== undefined) plugin.settings.runtimeActionWpm = profile.actionWpm;
        if (profile.narrationWpm !== undefined) plugin.settings.runtimeNarrationWpm = profile.narrationWpm;
        if (profile.beatSeconds !== undefined) plugin.settings.runtimeBeatSeconds = profile.beatSeconds;
        if (profile.pauseSeconds !== undefined) plugin.settings.runtimePauseSeconds = profile.pauseSeconds;
        if (profile.longPauseSeconds !== undefined) plugin.settings.runtimeLongPauseSeconds = profile.longPauseSeconds;
        if (profile.momentSeconds !== undefined) plugin.settings.runtimeMomentSeconds = profile.momentSeconds;
        if (profile.silenceSeconds !== undefined) plugin.settings.runtimeSilenceSeconds = profile.silenceSeconds;
    };

    ensureProfiles();
    let selectedProfileId = plugin.settings.defaultRuntimeProfileId || (plugin.settings.runtimeRateProfiles?.[0]?.id ?? '');

    const findScrollContainer = (): HTMLElement | null => {
        const modalContent = containerEl.closest('.modal')?.querySelector('.modal-content');
        if (modalContent instanceof HTMLElement) return modalContent;
        const tabContent = containerEl.closest('.vertical-tab-content');
        if (tabContent instanceof HTMLElement) return tabContent;
        const tabWrapper = containerEl.closest('.ert-settings-tab-content');
        if (tabWrapper instanceof HTMLElement) return tabWrapper;
        return null;
    };

    const captureScrollState = () => {
        const scrollContainer = findScrollContainer();
        return {
            scrollContainer,
            top: scrollContainer ? scrollContainer.scrollTop : null,
        };
    };

    const restoreScrollState = (state: { scrollContainer: HTMLElement | null; top: number | null; }) => {
        const { scrollContainer, top } = state;
        if (!scrollContainer || top === null) return;
        // Single async wait to let layout settle after re-render
        // Matches the previous double-RAF delay without extra animation frames
        window.setTimeout(() => {
            const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            const clampedTop = Math.min(top, maxTop);
            scrollContainer.scrollTop = clampedTop;
        }, 0);
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // Runtime estimation remains Pro-owned. Writing/session goals are rendered
    // separately in Core -> Sessions and may still be read by exports.
    // ─────────────────────────────────────────────────────────────────────────
    const proContainer = containerEl.createDiv({ cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK}` });
    if (!hasProfessional) {
        proContainer.addClass('ert-pro-locked');
    }

    const runtimeHeader = new Setting(proContainer)
        .setName(t('settings.runtime.header.name'))
        .setHeading()
        .setDesc(t('settings.runtime.header.desc'));
    addWikiLink(runtimeHeader, 'Settings-Core#runtime-estimation');
    const runtimeHeaderLayout = applyErtHeaderLayout(runtimeHeader);
    if (runtimeHeaderLayout) {
        runtimeHeaderLayout.header.removeClass(ERT_CLASSES.HEADER_NO_LEFT);
        const badgeEl = runtimeHeaderLayout.left.createSpan({
            cls: `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_PRO} ${ERT_CLASSES.BADGE_PILL_SM}`
        });
        const badgeIcon = badgeEl.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
        setIcon(badgeIcon, 'signature');
        badgeEl.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: t('settings.runtime.header.badgeText') });
    }

    // Content host within runtime card — all runtime rows re-render inside this element
    const runtimeBody = proContainer.createDiv({ cls: ERT_CLASSES.STACK });

    const addProRow = (setting: Setting) => setting;

    // Flash helper for input validation
    const flash = (input: HTMLInputElement, type: 'success' | 'error') => {
        const successClass = 'ert-input--success';
        const errorClass = 'ert-input--error';
        input.classList.remove(type === 'success' ? errorClass : successClass);
        input.classList.add(type === 'success' ? successClass : errorClass);
        window.setTimeout(() => input.classList.remove(type === 'success' ? successClass : errorClass), type === 'success' ? 900 : 1200);
    };

    const renderConditionalContent = () => {
        const scrollState = captureScrollState();
        runtimeBody.empty();

        ensureProfiles();
        const profiles = plugin.settings.runtimeRateProfiles || [];
        if (!selectedProfileId && profiles[0]) {
            selectedProfileId = profiles[0].id;
        }

        const headerContainer = runtimeBody.createDiv({ cls: ERT_CLASSES.STACK });
        const ratesRow = runtimeBody.createDiv({ cls: ERT_CLASSES.STACK });
        const patternsRow = runtimeBody.createDiv({ cls: ERT_CLASSES.STACK });

        const getSelectedProfile = (): RuntimeRateProfile | undefined => {
            const currentProfiles = plugin.settings.runtimeRateProfiles || [];
            const next = currentProfiles.find(p => p.id === selectedProfileId);
            return next || currentProfiles[0];
        };

        const updateProfile = async (mutate: (p: RuntimeRateProfile) => void) => {
            const list = plugin.settings.runtimeRateProfiles || [];
            const idx = list.findIndex(p => p.id === selectedProfileId);
            if (idx === -1) return;
            const updated = { ...list[idx] };
            mutate(updated);
            list[idx] = updated;
            plugin.settings.runtimeRateProfiles = list;
            if (plugin.settings.defaultRuntimeProfileId === updated.id) {
                syncLegacyFromProfile(updated);
            }
            await plugin.saveSettings();
        };

        const renderDetails = () => {
            const scrollState = captureScrollState();
            ratesRow.empty();
            patternsRow.empty();
            const selectedProfile = getSelectedProfile();
            if (!selectedProfile) {
                restoreScrollState(scrollState);
                return;
            }

            const contentType = selectedProfile.contentType || 'novel';

            // Content Type Selection
            addProRow(new Setting(ratesRow))
                .setName(t('settings.runtime.contentType.name'))
                .setDesc(t('settings.runtime.contentType.desc'))
                .addDropdown((dropdown: DropdownComponent) => {
                    dropdown
                        .addOption('novel', t('settings.runtime.contentType.optionNovel'))
                        .addOption('screenplay', t('settings.runtime.contentType.optionScreenplay'))
                        .setValue(contentType)
                        .onChange(async (value: string) => {
                            await updateProfile((p) => { p.contentType = value as RuntimeContentType; });
                            renderDetails();
                        });
                });

            // Word Rates (content-type specific)
            if (contentType === 'screenplay') {
                addProRow(new Setting(ratesRow))
                    .setName(t('settings.runtime.dialogueWpm.name'))
                    .setDesc(t('settings.runtime.dialogueWpm.desc'))
                    .addText((text: TextComponent) => {
                        text.inputEl.type = 'number';
                        text.inputEl.min = '50';
                        text.inputEl.max = '300';
                        text.inputEl.addClass('ert-input--xs');
                        text.setValue(String(selectedProfile.dialogueWpm ?? 160));
                        plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                            const num = parseInt(text.getValue());
                            if (!Number.isFinite(num) || num < 50 || num > 300) {
                                flash(text.inputEl, 'error');
                                return;
                            }
                            await updateProfile((p) => { p.dialogueWpm = num; });
                            flash(text.inputEl, 'success');
                        });
                    });

                addProRow(new Setting(ratesRow))
                    .setName(t('settings.runtime.actionWpm.name'))
                    .setDesc(t('settings.runtime.actionWpm.desc'))
                    .addText((text: TextComponent) => {
                        text.inputEl.type = 'number';
                        text.inputEl.min = '50';
                        text.inputEl.max = '300';
                        text.inputEl.addClass('ert-input--xs');
                        text.setValue(String(selectedProfile.actionWpm ?? 100));
                        plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                            const num = parseInt(text.getValue());
                            if (!Number.isFinite(num) || num < 50 || num > 300) {
                                flash(text.inputEl, 'error');
                                return;
                            }
                            await updateProfile((p) => { p.actionWpm = num; });
                            flash(text.inputEl, 'success');
                        });
                    });

                // Parenthetical Timing (screenplay only)
                const parentheticals: Array<{
                    key: keyof RuntimeRateProfile;
                    label: string;
                    desc: string;
                    defaultVal: number;
                }> = [
                    { key: 'beatSeconds', label: t('settings.runtime.parenthetical.beat.name'), desc: t('settings.runtime.parenthetical.beat.desc'), defaultVal: 2 },
                    { key: 'pauseSeconds', label: t('settings.runtime.parenthetical.pause.name'), desc: t('settings.runtime.parenthetical.pause.desc'), defaultVal: 3 },
                    { key: 'longPauseSeconds', label: t('settings.runtime.parenthetical.longPause.name'), desc: t('settings.runtime.parenthetical.longPause.desc'), defaultVal: 5 },
                    { key: 'momentSeconds', label: t('settings.runtime.parenthetical.moment.name'), desc: t('settings.runtime.parenthetical.moment.desc'), defaultVal: 4 },
                    { key: 'silenceSeconds', label: t('settings.runtime.parenthetical.silence.name'), desc: t('settings.runtime.parenthetical.silence.desc'), defaultVal: 5 },
                ];

                for (const p of parentheticals) {
                    addProRow(new Setting(ratesRow))
                        .setName(p.label)
                        .setDesc(p.desc)
                        .addText((text: TextComponent) => {
                            text.inputEl.type = 'number';
                            text.inputEl.min = '0';
                            text.inputEl.max = '60';
                            text.inputEl.addClass('ert-input--xs');
                            const currentValue = selectedProfile[p.key] as number | undefined;
                            text.setValue(String(currentValue ?? p.defaultVal));
                            plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                                const num = parseInt(text.getValue());
                                if (!Number.isFinite(num) || num < 0 || num > 60) {
                                    flash(text.inputEl, 'error');
                                    return;
                                }
                                await updateProfile((profile) => {
                                    (profile as unknown as Record<string, unknown>)[p.key] = num;
                                });
                                flash(text.inputEl, 'success');
                            });
                        })
                        .addExtraButton(btn => {
                            btn.setIcon('rotate-ccw');
                            btn.setTooltip(t('settings.runtime.parenthetical.resetTooltip'));
                            btn.onClick(async () => {
                                await updateProfile((profile) => {
                                    (profile as unknown as Record<string, unknown>)[p.key] = p.defaultVal;
                                });
                                renderDetails();
                            });
                        });
                }
            } else {
                // Novel / Audiobook mode
                addProRow(new Setting(ratesRow))
                    .setName(t('settings.runtime.narrationWpm.name'))
                    .setDesc(t('settings.runtime.narrationWpm.desc'))
                    .addText((text: TextComponent) => {
                        text.inputEl.type = 'number';
                        text.inputEl.min = '50';
                        text.inputEl.max = '300';
                        text.inputEl.addClass('ert-input--xs');
                        text.setValue(String(selectedProfile.narrationWpm ?? 150));
                        plugin.registerDomEvent(text.inputEl, 'blur', async () => {
                            const num = parseInt(text.getValue());
                            if (!Number.isFinite(num) || num < 50 || num > 300) {
                                flash(text.inputEl, 'error');
                                return;
                            }
                            await updateProfile((p) => { p.narrationWpm = num; });
                            flash(text.inputEl, 'success');
                        });
                    });
            }

            // Explicit Duration Patterns (always shown when enabled)
            const patternsInfo = patternsRow.createDiv({
                cls: `${ERT_CLASSES.STACK} ert-runtime-patterns`
            });
            patternsInfo.createEl('p', {
                cls: ERT_CLASSES.SECTION_DESC,
                text: t('settings.runtime.patterns.heading')
            });
            const patternsList = patternsInfo.createEl('ul');
            const patterns = [
                t('settings.runtime.patterns.seconds'),
                t('settings.runtime.patterns.minutes'),
                t('settings.runtime.patterns.runtime'),
                t('settings.runtime.patterns.allow'),
            ];
            for (const pat of patterns) {
                patternsList.createEl('li').createEl('code', { text: pat });
            }
            restoreScrollState(scrollState);
        };

        const renderHeader = () => {
            headerContainer.empty();
            const currentProfiles = plugin.settings.runtimeRateProfiles || [];
            const selectedProfile = currentProfiles.find(p => p.id === selectedProfileId) || currentProfiles[0];
            const currentDefault = currentProfiles.find(p => p.id === plugin.settings.defaultRuntimeProfileId);
            const isDefault = selectedProfile && selectedProfile.id === plugin.settings.defaultRuntimeProfileId;
            const headerSetting = addProRow(new Setting(headerContainer))
                .setName(t('settings.runtime.profile.name'))
                .setDesc(t('settings.runtime.profile.desc', { current: currentDefault?.label || t('settings.runtime.profile.noneFallback') }));

            headerSetting.addDropdown((dropdown: DropdownComponent) => {
                dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
                currentProfiles.forEach((p) => {
                    dropdown.addOption(p.id, p.label);
                });
                dropdown
                    .setValue(selectedProfile?.id || currentProfiles[0]?.id || '')
                    .onChange((value: string) => {
                        selectedProfileId = value;
                        renderHeader();
                        renderDetails();
                    });
                fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 120, maxPx: 320, extraPx: 18 });
            });

            headerSetting.addExtraButton(btn => {
                btn.setIcon('plus');
                btn.setTooltip(t('settings.runtime.profile.duplicateTooltip'));
                btn.onClick(async () => {
                    const base = selectedProfile || currentProfiles[0];
                    if (!base) return;
                    const copy: RuntimeRateProfile = {
                        ...base,
                        id: generateProfileId(),
                        label: `${base.label} copy`,
                    };
                    plugin.settings.runtimeRateProfiles = [...currentProfiles, copy];
                    selectedProfileId = copy.id;
                    await plugin.saveSettings();
                    renderHeader();
                    renderDetails();
                });
            });

            headerSetting.addExtraButton(btn => {
                btn.setIcon('pencil');
                btn.setTooltip(t('settings.runtime.profile.renameTooltip'));
                btn.setDisabled(!selectedProfile);
                btn.onClick(() => {
                    if (!selectedProfile) return;
                    const modal = new Modal(plugin.app);
                    const { modalEl, contentEl } = modal;
                    modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--sm');
                    modalEl.classList.add(ERT_CLASSES.ROOT, ERT_CLASSES.SKIN_PRO);
                    contentEl.addClass('ert-modal-container', 'ert-stack');

                    const header = contentEl.createDiv({ cls: 'ert-modal-header' });
                    header.createDiv({ cls: 'ert-modal-title', text: t('settings.runtime.profile.renameTitle') });

                    const inputContainer = contentEl.createDiv({ cls: 'ert-search-input-container' });
                    const inputEl = inputContainer.createEl('input', {
                        type: 'text',
                        value: selectedProfile.label || '',
                        cls: 'ert-input ert-input--full'
                    });

                    window.setTimeout(() => {
                        inputEl.focus();
                        inputEl.select();
                    }, 10);

                    const submit = async () => {
                        const trimmed = inputEl.value.trim();
                        if (!trimmed) return;
                        await updateProfile((p) => { p.label = trimmed; });
                        modal.close();
                        renderHeader();
                        renderDetails();
                    };

                    // SAFE: Modal classes don't have registerDomEvent; modal cleanup handles this
                    inputEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            void submit();
                        } else if (e.key === 'Escape') {
                            modal.close();
                        }
                    });

                    const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
                    new ButtonComponent(buttonRow)
                        .setButtonText(t('settings.runtime.profile.okButton'))
                        .setCta()
                        .onClick(() => submit());
                    new ButtonComponent(buttonRow)
                        .setButtonText(t('settings.runtime.profile.cancelButton'))
                        .onClick(() => modal.close());

                    modal.open();
                });
            });

            headerSetting.addExtraButton(btn => {
                btn.setIcon('trash');
                btn.setTooltip(t('settings.runtime.profile.deleteTooltip'));
                btn.setDisabled(currentProfiles.length <= 1);
                btn.onClick(async () => {
                    if (currentProfiles.length <= 1) return;
                    const remaining = currentProfiles.filter(p => p.id !== selectedProfileId);
                    plugin.settings.runtimeRateProfiles = remaining;
                    const fallback = remaining[0];
                    if (plugin.settings.defaultRuntimeProfileId === selectedProfileId && fallback) {
                        plugin.settings.defaultRuntimeProfileId = fallback.id;
                        syncLegacyFromProfile(fallback);
                    }
                    selectedProfileId = fallback?.id || '';
                    await plugin.saveSettings();
                    renderHeader();
                    renderDetails();
                });
            });

            headerSetting.addExtraButton(btn => {
                btn.setIcon('star');
                btn.setTooltip(isDefault ? t('settings.runtime.profile.alreadyDefaultTooltip') : t('settings.runtime.profile.setDefaultTooltip'));
                btn.setDisabled(!selectedProfile || isDefault);
                btn.onClick(async () => {
                    if (!selectedProfile) return;
                    plugin.settings.defaultRuntimeProfileId = selectedProfile.id;
                    syncLegacyFromProfile(selectedProfile);
                    await plugin.saveSettings();
                    renderHeader();
                });
            });
        };

        renderHeader();
        renderDetails();
        restoreScrollState(scrollState);
    };

    // Initial render
    renderConditionalContent();
}
