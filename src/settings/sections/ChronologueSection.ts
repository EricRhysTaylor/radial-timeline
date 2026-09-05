import { App, Setting as Settings, Notice, DropdownComponent, TextComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { TimelineItem } from '../../types';
import type { ChronologueCalendarDefault } from '../../types/settings';
import { parseDurationDetail, formatDurationSelectionLabel, calculateAutoDiscontinuityThreshold } from '../../utils/date';
import { getActivePlanetaryProfile } from '../../utils/planetaryTime';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { IMPACT_FULL } from '../SettingImpact';
import { ERT_CLASSES } from '../../ui/classes';

interface DurationCapOption {
    key: string;
    label: string;
    count: number;
    ms: number;
}

async function collectDurationCapOptions(
    plugin: RadialTimelinePlugin,
    allowFetch: boolean
): Promise<DurationCapOption[] | null> {
    let scenes: TimelineItem[] | undefined;
    if (Array.isArray(plugin.lastSceneData)) {
        scenes = plugin.lastSceneData;
    } else if (allowFetch) {
        try {
            scenes = await plugin.getSceneData();
        } catch {
            return [];
        }
    } else {
        return null;
    }

    const dedupeKeys = new Set<string>();
    const optionsMap = new Map<string, { label: string; count: number; ms: number }>();

    (scenes ?? []).forEach(scene => {
        if (scene.itemType === 'Beat' || scene.itemType === 'Plot') return;
        const identifier = scene.path || `${scene.title ?? ''}|${scene.date}`;
        if (!identifier || dedupeKeys.has(identifier)) return;
        dedupeKeys.add(identifier);

        const detail = parseDurationDetail(scene.Duration);
        if (!detail) return;
        const key = `${detail.value}|${detail.unitKey}`;
        const unitLabel = detail.value === 1 ? detail.unitSingular : detail.unitPlural;
        const label = `${detail.valueText} ${unitLabel}`;
        const existing = optionsMap.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            optionsMap.set(key, { label, count: 1, ms: detail.ms });
        }
    });

    return Array.from(optionsMap.entries())
        .map(([key, data]) => ({
            key,
            label: data.label,
            count: data.count,
            ms: data.ms,
        }))
        .sort((a, b) => a.ms - b.ms);
}

export function renderChronologueSection(params: { app: App; plugin: RadialTimelinePlugin; containerEl: HTMLElement; }): void {
    const { plugin, containerEl } = params;
    containerEl.classList.add(ERT_CLASSES.STACK);
    const activePlanetaryLabel = getActivePlanetaryProfile(plugin.settings)?.label?.trim() || 'Planetary';

    const chronoHeading = new Settings(containerEl)
        .setName('Chronologue mode discontinuity & duration')
        .setHeading();
    addHeadingIcon(chronoHeading, 'clock-8');
    addWikiLink(chronoHeading, 'Settings-Core#chronologue-mode-settings');
    applyErtHeaderLayout(chronoHeading);

    const stackEl = containerEl.createDiv({ cls: ERT_CLASSES.STACK });

    new Settings(stackEl)
        .setName('Default calendar view')
        .setDesc('Choose what Chronologue shows first. Earth remains the source date; Planetary displays the active valid planetary profile immediately when Chronologue opens.')
        .addDropdown(dropdown => {
            dropdown.selectEl.addClass('ert-input', 'ert-input--md');
            dropdown
                .addOption('earth', 'Earth')
                .addOption('planetary', activePlanetaryLabel)
                .addOption('remember', 'Remember last')
                .setValue(plugin.settings.chronologueCalendarDefault ?? 'earth')
                .onChange(async (value) => {
                    plugin.settings.chronologueCalendarDefault = value as ChronologueCalendarDefault;
                    await plugin.saveSettings();
                    plugin.onSettingChanged(IMPACT_FULL);
                });
        });

    // 1. Chronologue duration arc cap
    const baseDurationDesc = 'Scenes with durations at or above the selected value fill the entire segment. All other durations below this are proportionally scaled.';

    const durationSetting = new Settings(stackEl)
        .setName('Chronologue duration arc cap')
        .setDesc(baseDurationDesc);

    const savedCapSelection = plugin.settings.chronologueDurationCapSelection ?? 'auto';
    let durationDropdown: DropdownComponent | undefined;
    let durationOptionsLoaded = false;

    const loadDurationOptions = async (allowFetch: boolean) => {
        if (durationOptionsLoaded) return;
        const options = await collectDurationCapOptions(plugin, allowFetch);
        const dropdown = durationDropdown;
        if (!dropdown) return;
        if (options === null) {
            if (!durationOptionsLoaded) {
                durationSetting.setDesc(`${baseDurationDesc} Open the timeline to load duration data.`);
            }
            return;
        }
        durationOptionsLoaded = true;
        if (options.length === 0) {
            durationSetting.setDesc(`${baseDurationDesc} No scene durations detected yet.`);
        } else {
            options.forEach(opt => {
                if (!dropdown.selectEl.querySelector(`option[value="${opt.key}"]`)) {
                    dropdown.addOption(opt.key, `${opt.label} (${opt.count})`);
                }
            });
        }

        if (savedCapSelection !== 'auto' && dropdown.selectEl.querySelector(`option[value="${savedCapSelection}"]`) === null) {
            const fallbackLabel = formatDurationSelectionLabel(savedCapSelection);
            if (fallbackLabel) {
                dropdown.addOption(savedCapSelection, `${fallbackLabel} (0)`);
            }
        }

        dropdown.setValue(savedCapSelection);
    };

    durationSetting.addDropdown(dropdown => {
        durationDropdown = dropdown;
        dropdown.addOption('auto', 'Longest observed duration (auto)');
        dropdown.setValue(savedCapSelection);
        dropdown.onChange(async (value) => {
            plugin.settings.chronologueDurationCapSelection = value;
            await plugin.saveSettings();
            plugin.onSettingChanged(IMPACT_FULL); // Tier 3: structural layout change (duration arcs)
        });
        dropdown.selectEl.addClass('ert-input', 'ert-input--lg');
        plugin.registerDomEvent(dropdown.selectEl, 'focus', () => { void loadDurationOptions(true); });
    });

    void loadDurationOptions(false);

    // 2. Discontinuity threshold customization

    // Calculate the actual auto threshold based on current scenes
    // Uses single source of truth helper to ensure this matches the renderer's calculation
    const getScenesForThreshold = async (allowFetch: boolean): Promise<TimelineItem[] | null> => {
        if (Array.isArray(plugin.lastSceneData)) {
            return plugin.lastSceneData;
        }
        if (!allowFetch) return null;
        try {
            const fetched = await plugin.getSceneData();
            if (Array.isArray(fetched)) {
                plugin.lastSceneData = fetched;
                return fetched;
            }
            return [];
        } catch (err) {
            console.error('[Settings] Failed to load scenes for discontinuity threshold:', err);
            return [];
        }
    };

    const calculateAutoThreshold = async (allowFetch: boolean): Promise<{ display: string; days: number | null; loaded: boolean }> => {
        try {
            const scenes = await getScenesForThreshold(allowFetch);
            if (!scenes) {
                return { display: 'Open timeline to calculate', days: null, loaded: false };
            }

            // Use single source of truth helper
            const thresholdMs = calculateAutoDiscontinuityThreshold(scenes);

            if (thresholdMs === null) {
                return { display: 'not yet calculated', days: null, loaded: true };
            }

            // Convert to appropriate time unit for display
            const minutes = thresholdMs / (60 * 1000);
            const hours = thresholdMs / (60 * 60 * 1000);
            const days = thresholdMs / (24 * 60 * 60 * 1000);

            let display: string;
            if (days >= 1) {
                display = `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
            } else if (hours >= 1) {
                display = `${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
            } else {
                display = `${Math.round(minutes)} ${Math.round(minutes) === 1 ? 'minute' : 'minutes'}`;
            }

            return { display, days: Math.round(days * 100) / 100, loaded: true };
        } catch (err) {
            console.error('[Settings] Error calculating threshold:', err);
            return { display: 'not yet calculated', days: null, loaded: false };
        }
    };

    const discontinuitySetting = new Settings(stackEl)
        .setName('Discontinuity gap threshold');
    discontinuitySetting.settingEl.addClass('ert-setting-two-row', 'ert-chronologue-discontinuity-setting');

    // Declare the text component reference first (before updateDescriptionAndPlaceholder uses it)
    let discontinuityText: TextComponent | undefined;

    // Calculate threshold dynamically when settings are displayed
    let autoThresholdLoaded = false;
    const updateDescriptionAndPlaceholder = async (allowFetch: boolean) => {
        const autoThreshold = await calculateAutoThreshold(allowFetch);
        if (autoThreshold.loaded) autoThresholdLoaded = true;
        discontinuitySetting.setDesc(`In shift mode, the ∞ symbol marks large time gaps between scenes. By default, this is auto-calculated as 3× the median gap between scenes. Current auto value: ${autoThreshold.display}. You can override this with a custom gap threshold (e.g., "4 days", "1 week", "30 minutes").`);
        if (discontinuityText) {
            const currentValue = plugin.settings.discontinuityThreshold || '';
            discontinuityText.setPlaceholder(`${autoThreshold.display} (auto)`);
            if (!currentValue) {
                discontinuityText.setValue('');
            }
        }
    };

    // Calculate immediately
    void updateDescriptionAndPlaceholder(false);

    discontinuitySetting.addText(text => {
        discontinuityText = text;
        const currentValue = plugin.settings.discontinuityThreshold || '';
        text.setPlaceholder('Calculating…')
            .setValue(currentValue);
        text.inputEl.addClass('ert-input--md');

        void calculateAutoThreshold(false).then(autoThreshold => {
            text.setPlaceholder(`${autoThreshold.display} (auto)`);
            if (!currentValue) {
                text.setValue('');
            }
        });

        const handleBlur = async () => {
            const trimmed = text.getValue().trim();

            // Clear validation state
            text.inputEl.removeClass('ert-setting-input-success');
            text.inputEl.removeClass('ert-setting-input-error');

            if (!trimmed) {
                // Empty = use auto calculation
                plugin.settings.discontinuityThreshold = undefined;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL); // Tier 3: structural layout change (shift mode gaps)
                return;
            }

            // Validate the input by trying to parse it
            const parsed = parseDurationDetail(trimmed);
            if (!parsed) {
                text.inputEl.addClass('ert-setting-input-error');
                new Notice('Invalid gap threshold format. Examples: "4 days", "1 week", "2 months"');
                return;
            }

            // Valid input
            plugin.settings.discontinuityThreshold = trimmed;
            text.inputEl.addClass('ert-setting-input-success');
            await plugin.saveSettings();
            plugin.onSettingChanged(IMPACT_FULL); // Tier 3: structural layout change (shift mode gaps)

            // Clear success state after a moment
            window.setTimeout(() => {
                text.inputEl.removeClass('ert-setting-input-success');
            }, 1000);
        };

        plugin.registerDomEvent(text.inputEl, 'blur', () => {
            void handleBlur();
        });
        plugin.registerDomEvent(text.inputEl, 'focus', () => {
            if (!autoThresholdLoaded) {
                void updateDescriptionAndPlaceholder(true);
            }
        });
    });

    // Add a reset button
    discontinuitySetting.addExtraButton(button => button
        .setIcon('reset')
        .setTooltip('Reset to auto-calculated threshold')
        .onClick(async () => {
            plugin.settings.discontinuityThreshold = undefined;
            await plugin.saveSettings();
            plugin.onSettingChanged(IMPACT_FULL); // Tier 3: structural layout change (shift mode gaps)
            if (discontinuityText) {
                discontinuityText.setValue('');
                discontinuityText.inputEl.removeClass('ert-setting-input-error');
                discontinuityText.inputEl.removeClass('ert-setting-input-success');
            }
            new Notice('Discontinuity threshold reset to auto-calculated value');
        }));

}
