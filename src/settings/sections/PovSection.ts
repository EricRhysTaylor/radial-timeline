import { Setting as ObsidianSetting, setIcon, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { GlobalPovMode } from '../../types/settings';
import { resolveScenePov } from '../../utils/pov';
import { t } from '../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { ERT_CLASSES } from '../../ui/classes';
import { IMPACT_FULL } from '../SettingImpact';
import { fitSelectToSelectedLabel } from '../selectSizing';

const POV_LABELS: Record<string, string> = {
    '0': '°',
    '1': '¹',
    '2': '²',
    '3': '³'
};

const POV_VALUE_KEYWORDS = [
    'first', 'second', 'third', 'omni', 'objective',
    'two', 'three', 'four', 'five', 'count', 'all', 'N'
];

function renderPovOverrideDesc(descEl: HTMLElement, raw: string): void {
    descEl.empty();
    const keywordRe = new RegExp(`\\b(${POV_VALUE_KEYWORDS.join('|')})\\b`, 'g');
    // Split on backtick-wrapped tokens; odd indices are inside backticks.
    raw.split(/`([^`]+)`/g).forEach((part, idx) => {
        if (idx % 2 === 1) {
            descEl.createSpan({ cls: 'ert-yaml-key', text: part });
            return;
        }
        let last = 0;
        let m: RegExpExecArray | null;
        keywordRe.lastIndex = 0;
        while ((m = keywordRe.exec(part)) !== null) {
            if (m.index > last) descEl.appendText(part.slice(last, m.index));
            descEl.createEl('strong', { cls: 'ert-yaml-value', text: m[0] });
            last = m.index + m[0].length;
        }
        if (last < part.length) descEl.appendText(part.slice(last));
    });
}

export function renderPovSection(params: {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}): void {
    const { plugin, containerEl } = params;
    containerEl.classList.add(ERT_CLASSES.STACK);

    const povHeading = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.heading'))
        .setHeading();
    addHeadingIcon(povHeading, 'eye');
    addWikiLink(povHeading, 'Settings-Core#point-of-view');
    applyErtHeaderLayout(povHeading);

    const povModeOptions: Record<GlobalPovMode, string> = {
        off: t('settings.pov.modes.off'),
        first: t('settings.pov.modes.first'),
        second: t('settings.pov.modes.second'),
        third: t('settings.pov.modes.third'),
        omni: t('settings.pov.modes.omni'),
        objective: t('settings.pov.modes.objective')
    };

    const storedMode = plugin.settings.globalPovMode;
    const currentMode: GlobalPovMode = storedMode && storedMode in povModeOptions ? storedMode : 'off';
    if (storedMode !== currentMode) {
        plugin.settings.globalPovMode = currentMode;
        void plugin.saveSettings();
    }
    const globalPovSetting = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.vaultDefault.name'))
        .setDesc(t('settings.pov.vaultDefault.desc'))
        .addDropdown(dropdown => {
            (Object.keys(povModeOptions) as GlobalPovMode[]).forEach((key) => {
                dropdown.addOption(key, povModeOptions[key]);
            });
            dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
            dropdown.setValue(currentMode);
            fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 104, maxPx: 220, extraPx: 18 });
            dropdown.onChange(async (value) => {
                const next = (value as GlobalPovMode) || 'off';
                fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 104, maxPx: 220, extraPx: 18 });
                plugin.settings.globalPovMode = next;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL); // Tier 3: POV superscripts baked into SVG synopsis
            });
        });
    globalPovSetting.settingEl.addClass('ert-settingRow');

    const yamlOverridesSetting = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.yamlOverrides.name'));
    renderPovOverrideDesc(yamlOverridesSetting.descEl, t('settings.pov.yamlOverrides.desc'));
    yamlOverridesSetting.settingEl.addClass(ERT_CLASSES.ELEMENT_BLOCK_SKIP, 'ert-settingRow');

    // Preview section
    const previewContainer = containerEl.createDiv({
        cls: 'ert-previewFrame ert-previewFrame--center ert-previewFrame--flush',
        attr: { 'data-preview': 'pov' }
    });
    const previewHeader = previewContainer.createDiv({ cls: 'ert-previewFrame__header' });
    previewHeader.createDiv({
        cls: 'ert-planetary-preview-heading ert-previewFrame__title',
        text: t('settings.pov.preview.heading')
    });
    const previewBody = previewContainer.createDiv({ cls: 'ert-pov-preview-body' });
    let previewExpanded = plugin.settings.povPreviewExpanded ?? true;
    const refreshPreviewToggle = () => {
        previewContainer.toggleClass('ert-settings-hidden', !previewExpanded);
    };

    const previewToggle = yamlOverridesSetting.controlEl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: {
            type: 'button',
            'aria-label': 'Hide POV preview'
        }
    });
    const refreshPreviewButton = () => {
        setIcon(previewToggle, previewExpanded ? 'chevron-down' : 'chevron-right');
        setTooltip(previewToggle, previewExpanded ? 'Hide POV preview' : 'Show POV preview');
        previewToggle.setAttribute('aria-label', previewExpanded ? 'Hide POV preview' : 'Show POV preview');
        previewToggle.setAttribute('aria-expanded', previewExpanded ? 'true' : 'false');
    };
    refreshPreviewToggle();
    refreshPreviewButton();
    // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
    previewToggle.addEventListener('click', () => {
        previewExpanded = !previewExpanded;
        plugin.settings.povPreviewExpanded = previewExpanded;
        refreshPreviewToggle();
        refreshPreviewButton();
        void plugin.saveSettings();
    });

    const buildPreviewEntries = (
        characters: string[],
        povValue: string,
        globalMode?: GlobalPovMode
    ) => {
        const povInfo = resolveScenePov(
            {
                Character: characters,
                pov: povValue
            },
            { globalMode }
        );

        const entries: Array<{ name: string; sup: string }> = [];
        povInfo.syntheticEntries.forEach(entry => {
            entries.push({ name: entry.text, sup: POV_LABELS[entry.label] || '' });
        });

        const markerMap = new Map<number, string>();
        povInfo.characterMarkers.forEach(marker => {
            markerMap.set(marker.index, POV_LABELS[marker.label] || '');
        });

        characters.forEach((name, index) => {
            entries.push({ name, sup: markerMap.get(index) ?? '' });
        });

        return entries;
    };

    const renderNamesWithSup = (parent: HTMLElement, entries: Array<{ name: string; sup: string }>) => {
        parent.empty();
        entries.forEach((entry, idx) => {
            parent.appendText(entry.name);
            const supEl = parent.createEl('sup');
            supEl.setText(entry.sup);
            if (idx < entries.length - 1) {
                parent.appendText(', ');
            }
        });
    };

    const renderPreview = () => {
        previewBody.empty();

        const renderExample = (
            label: string,
            characters: string[],
            povValue: string,
            globalMode?: GlobalPovMode
        ) => {
            const example = previewBody.createDiv({ cls: 'ert-pov-example' });
            example.createDiv({ cls: 'ert-pov-example-label', text: label });
            const content = example.createDiv({ cls: 'ert-pov-example-content' });
            renderNamesWithSup(content, buildPreviewEntries(characters, povValue, globalMode));
        };

        // Example 1: Single character with first-person
        renderExample(t('settings.pov.preview.examples.sceneFirst'), ['Alice'], 'first');

        // Example 2: Single character with third-person
        renderExample(t('settings.pov.preview.examples.sceneThird'), ['Bob'], 'third');

        // Example 3: Second-person
        renderExample(t('settings.pov.preview.examples.sceneSecond'), ['Alice', 'Bob'], 'second');

        // Example 4: Omni narrator
        renderExample(t('settings.pov.preview.examples.sceneOmni'), ['Alice', 'Bob'], 'omni');

        // Example 5: Objective narrator
        renderExample(t('settings.pov.preview.examples.sceneObjective'), ['Alice', 'Bob'], 'objective');

        // Example 6: Two characters with third-person
        renderExample(
            t('settings.pov.preview.examples.countTwoThird'),
            ['Alice', 'Bob'],
            'two',
            'third'
        );

        // Example 7: Three characters with third-person
        renderExample(
            t('settings.pov.preview.examples.countThreeThird'),
            ['Alice', 'Bob', 'Charlie'],
            'three',
            'third'
        );

        // Example 8: Four characters with third-person
        renderExample(
            t('settings.pov.preview.examples.countFourThird'),
            ['Alice', 'Bob', 'Charlie', 'Diana'],
            'four',
            'third'
        );

        // Example 9: Numeric count override with first-person
        renderExample(
            t('settings.pov.preview.examples.countTwoFirstNumeric'),
            ['Alice', 'Bob'],
            '2',
            'first'
        );

        // Example 10: All characters with first-person
        renderExample(
            t('settings.pov.preview.examples.countAllFirst'),
            ['Alice', 'Bob', 'Charlie'],
            'all',
            'first'
        );
    };

    renderPreview();
}
