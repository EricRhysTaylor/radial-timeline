import { setAccessibleLabel, setTooltip, withAccessibleLabel } from '../../utils/domTooltip';
import { App, Setting as Settings, TextAreaComponent, TextComponent, setIcon} from 'obsidian';
import { NamePromptModal } from '../../ui/NamePromptModal';
import type RadialTimelinePlugin from '../../main';
import type { PlanetaryProfile } from '../../types';
import { convertFromEarth, parseCommaNames, validatePlanetaryProfile } from '../../utils/planetaryTime';
import { createMarsPlanetaryProfile, MARS_TEMPLATE_ID } from '../../utils/planetaryMars';
import { t } from '../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { ERT_CLASSES } from '../../ui/classes';
import { IMPACT_FULL } from '../SettingImpact';

interface SectionParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

const DEFAULT_PROFILE = (): PlanetaryProfile => ({
    id: `planet-${Math.random().toString(36).slice(2, 8)}`,
    label: 'New planet',
    hoursPerDay: 24,
    daysPerWeek: 7,
    daysPerYear: 365,
    epochOffsetDays: 0,
    epochLabel: '',
    monthNames: undefined,
    weekdayNames: undefined,
});

// Mars template - built-in for fun! Based on the Darian calendar.
const MARS_PROFILE = createMarsPlanetaryProfile;

export function renderPlanetaryTimeSection({ app, plugin, containerEl }: SectionParams): void {
    containerEl.classList.add(ERT_CLASSES.STACK);
    const profiles = plugin.settings.planetaryProfiles || [];
    if (!plugin.settings.planetaryProfiles) {
        plugin.settings.planetaryProfiles = profiles;
    }

    // Section header
    const planetaryHeading = new Settings(containerEl)
        .setName(t('planetary.heading'))
        .setHeading();
    addHeadingIcon(planetaryHeading, 'earth');
    addWikiLink(planetaryHeading, 'Settings-Core#planetary-time');
    applyErtHeaderLayout(planetaryHeading);

    let sectionExpanded = plugin.settings.planetarySectionExpanded ?? true;

    const visibilityTargets: HTMLElement[] = [];

    const visibilitySetting = new Settings(containerEl)
        .setName(t('planetary.enable.name'))
        .setDesc(t('ui.planetaryTimeSection.enableDesc'))
    visibilitySetting.settingEl.addClass('ert-settingRow');

    const visibilityToggle = withAccessibleLabel(visibilitySetting.controlEl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button', 'aria-expanded': sectionExpanded ? 'true' : 'false' }
    }), sectionExpanded ? t('ui.planetaryTimeSection.hideDetails') : t('ui.planetaryTimeSection.showDetails'));

    const refreshVisibilityButton = () => {
        setIcon(visibilityToggle, sectionExpanded ? 'chevron-down' : 'chevron-right');
        setAccessibleLabel(visibilityToggle, sectionExpanded ? t('ui.planetaryTimeSection.hideDetails') : t('ui.planetaryTimeSection.showDetails'));
        visibilityToggle.setAttribute('aria-expanded', sectionExpanded ? 'true' : 'false');
    };

    // Wrap all dependent controls so we can hide them together
    const bodyEl = containerEl.createDiv({ cls: ['ert-planetary-body', ERT_CLASSES.STACK] });
    visibilityTargets.push(bodyEl);
    refreshVisibilityButton();
    visibilityToggle.addEventListener('click', () => {
        sectionExpanded = !sectionExpanded;
        plugin.settings.planetarySectionExpanded = sectionExpanded;
        applyVisibility(sectionExpanded);
        refreshVisibilityButton();
        void plugin.saveSettings();
    });

    // Active profile selector + buttons
    let activeProfileId = plugin.settings.activePlanetaryProfileId ?? '';
    if (activeProfileId && !profiles.some(profile => profile.id === activeProfileId)) {
        activeProfileId = '';
        plugin.settings.activePlanetaryProfileId = '';
    }

    const selectorSetting = new Settings(bodyEl)
        .setName(t('planetary.active.name'))
        .setDesc(t('planetary.active.desc'));

    // Add active calendar icon (shows when a profile is selected)
    const activeIcon = bodyEl.createDiv({ cls: 'ert-planetary-validation-icon' });
    setIcon(activeIcon, 'orbit');

    const updateActiveIcon = () => {
        const profile = profiles.find(p => p.id === activeProfileId);
        // Hide icon when no profile is selected
        if (!profile || !activeProfileId) {
            activeIcon.classList.add('ert-settings-hidden');
            activeIcon.classList.remove('is-valid');
            return;
        }
        activeIcon.classList.remove('ert-settings-hidden');
        activeIcon.classList.add('is-valid'); // Always show as active/valid
        
        setTooltip(activeIcon, t('ui.planetaryTimeSection.calendarActiveTooltip', { planet: profile.label }), { placement: 'bottom' });
    };

    const renderSelector = () => {
        selectorSetting.clear();
        selectorSetting.setName(t('planetary.active.name'));
        selectorSetting.setDesc(t('planetary.active.desc'));
        selectorSetting.addDropdown(dropdown => {
            dropdown.addOption('', t('planetary.active.disabled'));
            // Add Mars template option
            const hasMars = profiles.some(p => p.id === MARS_TEMPLATE_ID);
            if (!hasMars) {
                dropdown.addOption(MARS_TEMPLATE_ID, t('ui.planetaryTimeSection.marsTemplateOption'));
            }
            // Add user profiles
            profiles.forEach(p => { dropdown.addOption(p.id, p.label || t('ui.planetaryTimeSection.unnamedProfile')); });
            dropdown.setValue(activeProfileId || '');
            dropdown.onChange(async (value) => {
                // Handle Mars template selection
                if (value === MARS_TEMPLATE_ID && !profiles.some(p => p.id === MARS_TEMPLATE_ID)) {
                    const marsProfile = MARS_PROFILE();
                    profiles.push(marsProfile);
                    activeProfileId = marsProfile.id;
                    plugin.settings.activePlanetaryProfileId = activeProfileId;
                    await plugin.saveSettings();
                    plugin.onSettingChanged(IMPACT_FULL);
                    renderSelector();
                    renderFields();
                    renderPreview();
                    return;
                }
                activeProfileId = value;
                plugin.settings.activePlanetaryProfileId = value;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL);
                renderFields();
                renderPreview();
                updateActiveIcon();
            });
        });
        selectorSetting.addExtraButton(btn => {
            btn.setIcon('plus');
            withAccessibleLabel(btn, t('planetary.actions.add'));
            btn.onClick(() => {
                new NamePromptModal(app, {
                    title: t('ui.planetaryTimeSection.createTitle'),
                    subtitle: t('ui.planetaryTimeSection.nameSubtitle'),
                    initialValue: '',
                    placeholder: t('ui.planetaryTimeSection.namePlaceholder'),
                    actionLabel: t('ui.planetaryTimeSection.createAction'),
                    emptyNotice: t('ui.planetaryTimeSection.emptyNameNotice'),
                    shell: { size: 'sm' },
                    onSubmit: async (value) => {
                        const profile = DEFAULT_PROFILE();
                        profile.label = value;
                        profiles.push(profile);
                        activeProfileId = profile.id;
                        plugin.settings.activePlanetaryProfileId = activeProfileId;
                        await plugin.saveSettings();
                        plugin.onSettingChanged(IMPACT_FULL);
                        renderSelector();
                        renderFields();
                        renderPreview();
                        updateActiveIcon();
                    }
                }).open();
            });
        });
        selectorSetting.addExtraButton(btn => {
            btn.setIcon('pencil');
            withAccessibleLabel(btn, t('ui.planetaryTimeSection.renameProfile'));
            btn.setDisabled(!activeProfileId);
            btn.onClick(() => {
                const profile = getActiveProfile();
                if (!profile) return;
                new NamePromptModal(app, {
                    title: t('ui.planetaryTimeSection.renameProfile'),
                    subtitle: t('ui.planetaryTimeSection.nameSubtitle'),
                    initialValue: profile.label || '',
                    placeholder: t('ui.planetaryTimeSection.namePlaceholder'),
                    actionLabel: t('ui.planetaryTimeSection.renameAction'),
                    emptyNotice: t('ui.planetaryTimeSection.emptyNameNotice'),
                    shell: { size: 'sm' },
                    onSubmit: async (value) => {
                        profile.label = value;
                        await saveProfile(profile);
                        renderSelector();
                        renderFields();
                        renderPreview();
                    }
                }).open();
            });
        });
        selectorSetting.addExtraButton(btn => {
            btn.setIcon('trash');
            const deleteDisabled = profiles.length === 0 || !activeProfileId;
            withAccessibleLabel(btn, t('planetary.actions.delete'));
            btn.setDisabled(deleteDisabled);
            btn.onClick(async () => {
                if (!activeProfileId) return;
                const index = profiles.findIndex(p => p.id === activeProfileId);
                if (index === -1) return;
                profiles.splice(index, 1);
                activeProfileId = profiles[0]?.id;
                plugin.settings.activePlanetaryProfileId = activeProfileId;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL);
                renderSelector();
                renderFields();
                renderPreview();
            });
        });
        // Append icon to the setting control
        selectorSetting.controlEl.prepend(activeIcon);
        updateActiveIcon();
    };

    renderSelector();

    // Profile fields
    const fieldsContainer = bodyEl.createDiv({ cls: ['ert-planetary-fields', ERT_CLASSES.STACK] });
    const previewContainer = bodyEl.createDiv({
        cls: [ERT_CLASSES.PREVIEW_FRAME, ERT_CLASSES.STACK, 'ert-previewFrame--flush'],
        attr: { 'data-preview': 'planetary' }
    });
    visibilityTargets.push(selectorSetting.settingEl, fieldsContainer, previewContainer);

    const flash = (input: HTMLInputElement | HTMLTextAreaElement, type: 'success' | 'error') => {
        const successClass = 'ert-setting-input-success';
        const errorClass = 'ert-setting-input-error';
        input.classList.remove(type === 'success' ? errorClass : successClass);
        input.classList.add(type === 'success' ? successClass : errorClass);
        window.setTimeout(() => input.classList.remove(type === 'success' ? successClass : errorClass), type === 'success' ? 900 : 1200);
    };

    const saveProfile = async (updated: PlanetaryProfile, input?: HTMLInputElement | HTMLTextAreaElement) => {
        const result = validatePlanetaryProfile(updated);
        if (!result.ok) {
            if (input) flash(input, 'error');
            return;
        }
        const idx = profiles.findIndex(p => p.id === updated.id);
        if (idx >= 0) profiles[idx] = { ...updated };
        else profiles.push(updated);
        plugin.settings.planetaryProfiles = profiles;
        if (!plugin.settings.activePlanetaryProfileId) {
            plugin.settings.activePlanetaryProfileId = updated.id;
            activeProfileId = updated.id;
        }
        await plugin.saveSettings();
        plugin.onSettingChanged(IMPACT_FULL);
        if (input) flash(input, 'success');
        renderPreview();
        updateActiveIcon();
    };

    const getActiveProfile = (): PlanetaryProfile | null => {
        return profiles.find(p => p.id === activeProfileId) || null;
    };

    // Keys of PlanetaryProfile whose values are (optional) numbers / strings
    type NumberFieldKey = { [K in keyof PlanetaryProfile]-?: NonNullable<PlanetaryProfile[K]> extends number ? K : never }[keyof PlanetaryProfile];
    type StringFieldKey = { [K in keyof PlanetaryProfile]-?: NonNullable<PlanetaryProfile[K]> extends string ? K : never }[keyof PlanetaryProfile];

    const renderFields = () => {
        fieldsContainer.empty();
        const profile = getActiveProfile();
        fieldsContainer.classList.toggle('ert-settings-hidden', !profile);
        if (!profile) return;

        const addNumberField = (label: string, key: NumberFieldKey, hint?: string) => {
            const setting = new Settings(fieldsContainer).setName(label);
            if (hint) setting.setDesc(hint);
            setting.addText((text: TextComponent) => {
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.addClass('ert-input--xs');
                const current = profile[key];
                const originalValue = current !== undefined ? String(current) : '';
                text.setValue(originalValue);
                // SAFE: addEventListener used in settings section; cleanup occurs when settings container is destroyed
                text.inputEl.addEventListener('blur', () => { void (async () => {
                    const value = text.getValue();
                    if (value === originalValue) return; // No change
                    const num = parseFloat(value);
                    if (!Number.isFinite(num)) {
                        flash(text.inputEl, 'error');
                        return;
                    }
                    profile[key] = num;
                    await saveProfile(profile, text.inputEl);
                })(); });
            });
        };

        const addTextField = (label: string, key: StringFieldKey, placeholder?: string, onSave?: () => void, sizeClass = 'ert-input--lg') => {
            const setting = new Settings(fieldsContainer).setName(label);
            if (placeholder) setting.setDesc(placeholder);
            setting.addText((text: TextComponent) => {
                const current = profile[key];
                const originalValue = current ?? '';
                text.setValue(originalValue);
                text.inputEl.addClass(sizeClass);
                // SAFE: addEventListener used in settings section; cleanup occurs when settings container is destroyed
                text.inputEl.addEventListener('blur', () => { void (async () => {
                    const value = text.getValue();
                    if (value === originalValue) return; // No change
                    profile[key] = value;
                    await saveProfile(profile, text.inputEl);
                    if (onSave) onSave();
                })(); });
            });
        };

        addNumberField(t('planetary.fields.hoursPerDay'), 'hoursPerDay', t('ui.planetaryTimeSection.hoursPerDayHint'));
        addNumberField(t('planetary.fields.daysPerWeek'), 'daysPerWeek', t('ui.planetaryTimeSection.daysPerWeekHint'));
        addNumberField(t('planetary.fields.daysPerYear'), 'daysPerYear', t('ui.planetaryTimeSection.daysPerYearHint'));
        addNumberField(
            t('planetary.fields.epochOffset'),
            'epochOffsetDays',
            t('ui.planetaryTimeSection.epochOffsetHint')
        );
        addTextField(t('planetary.fields.epochLabel'), 'epochLabel', t('ui.planetaryTimeSection.epochLabelHint'));

        new Settings(fieldsContainer)
            .setName(t('planetary.fields.monthNames'))
            .setDesc(t('ui.planetaryTimeSection.monthNamesDesc'))
            .addTextArea((text: TextAreaComponent) => {
                text.inputEl.addClass('ert-textarea', 'ert-textarea--wide');
                text.inputEl.rows = 6;
                const originalValue = (profile.monthNames || []).join('\n');
                text.setValue(originalValue);
                // SAFE: addEventListener used in settings section; cleanup occurs when settings container is destroyed
                text.inputEl.addEventListener('blur', () => { void (async () => {
                    const value = text.getValue();
                    if (value === originalValue) return;
                    profile.monthNames = parseCommaNames(value);
                    await saveProfile(profile, text.inputEl);
                })(); });
            });

        new Settings(fieldsContainer)
            .setName(t('planetary.fields.weekdayNames'))
            .setDesc(t('ui.planetaryTimeSection.weekdayNamesDesc'))
            .addTextArea((text: TextAreaComponent) => {
                text.inputEl.addClass('ert-textarea', 'ert-textarea--wide');
                text.inputEl.rows = 3;
                const originalValue = (profile.weekdayNames || []).join('\n');
                text.setValue(originalValue);
                // SAFE: addEventListener used in settings section; cleanup occurs when settings container is destroyed
                text.inputEl.addEventListener('blur', () => { void (async () => {
                    const value = text.getValue();
                    if (value === originalValue) return;
                    profile.weekdayNames = parseCommaNames(value);
                    await saveProfile(profile, text.inputEl);
                })(); });
            });
    };

    const renderPreview = () => {
        previewContainer.empty();
        const profile = getActiveProfile();
        const hasProfile = !!profile;
        fieldsContainer.classList.toggle('ert-settings-hidden', !hasProfile);
        const header = previewContainer.createDiv({ cls: ['ert-planetary-preview-heading', 'ert-previewFrame__title'] });
        const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body' });
        if (!hasProfile) {
            header.setText(t('planetary.preview.heading'));
            body.setText(t('planetary.preview.disabled'));
            return;
        }
        const result = convertFromEarth(new Date(), profile);
        header.setText(profile.label
            ? t('ui.planetaryTimeSection.previewHeadingNamed', { planet: profile.label })
            : t('planetary.preview.heading'));
        if (!result) {
            body.setText(t('planetary.preview.invalid'));
            return;
        }
        body.setText(result.formatted);
    };

    const applyVisibility = (enabled: boolean) => {
        visibilityTargets.forEach(el => {
            if (!el) return;
            el.classList.toggle('ert-settings-hidden', !enabled);
        });
    };

    renderFields();
    renderPreview();
    applyVisibility(sectionExpanded);
}
