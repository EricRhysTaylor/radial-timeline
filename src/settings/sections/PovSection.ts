import { setAccessibleLabel, setTooltip, withAccessibleLabel } from '../../utils/domTooltip';
import { Setting as ObsidianSetting, setIcon} from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { NarrationMode } from '../../types/settings';
import { resolveScenePov } from '../../utils/pov';
import { getActiveBook } from '../../utils/books';
import { t } from '../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { ERT_CLASSES } from '../../ui/classes';
import { IMPACT_FULL } from '../SettingImpact';
import { narrationModeLabel, openBookDetails } from './BookDetailsModal';

const POV_LABELS: Record<string, string> = {
    '0': '°',
    '1': '¹',
    '2': '²',
    '3': '³'
};

const NARRATION_VALUE_KEYWORDS = [
    'first', 'second', 'third', 'omni', 'objective',
    'two', 'three', 'four', 'five', 'count', 'all', 'N'
];

/** Backticked YAML keys become key chips; narration keywords are bolded only when asked. */
function renderNarrationDesc(descEl: HTMLElement, raw: string, boldKeywords = true): void {
    descEl.empty();
    const keywordRe = new RegExp(`\\b(${NARRATION_VALUE_KEYWORDS.join('|')})\\b`, 'g');
    // Split on backtick-wrapped tokens; odd indices are inside backticks.
    raw.split(/`([^`]+)`/g).forEach((part, idx) => {
        if (idx % 2 === 1) {
            descEl.createSpan({ cls: 'ert-yaml-key', text: part });
            return;
        }
        if (!boldKeywords) {
            descEl.appendText(part);
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

/**
 * Settings → Core → Narration. Each book's narration default is set in its
 * book details; this section points there, holds the character lanes toggle,
 * and shows how a scene's `Narration:` override marks the POV character (the
 * first name in `Character:`).
 */
export function renderPovSection(params: {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}): void {
    const { plugin, containerEl } = params;
    containerEl.classList.add(ERT_CLASSES.STACK);

    const narrationHeading = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.heading'))
        .setHeading();
    addHeadingIcon(narrationHeading, 'eye');
    addWikiLink(narrationHeading, 'Settings-Core#narration');
    applyErtHeaderLayout(narrationHeading);

    const bookNarrationSetting = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.bookDefault.name'));
    bookNarrationSetting.settingEl.addClass('ert-settingRow');
    const renderBookNarration = () => {
        const activeBook = getActiveBook(plugin.settings);
        bookNarrationSetting.controlEl.empty();
        if (!activeBook) {
            bookNarrationSetting.setDesc(t('settings.pov.bookDefault.descNoBook'));
            return;
        }
        bookNarrationSetting.setDesc(t('settings.pov.bookDefault.desc', {
            book: activeBook.title,
            mode: narrationModeLabel(activeBook.narrationMode ?? 'off')
        }));
        bookNarrationSetting.addButton(button => button
            .setButtonText(t('settings.pov.bookDefault.button'))
            .onClick(() => openBookDetails(plugin, activeBook, renderBookNarration)));
    };
    renderBookNarration();

    const characterLanesSetting = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.characterLanes.name'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showCharacterLanes === true)
            .onChange(async (value) => {
                plugin.settings.showCharacterLanes = value;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL); // Tier 3: the lanes take ring space
            }));
    renderNarrationDesc(characterLanesSetting.descEl, t('settings.pov.characterLanes.desc'), false);
    characterLanesSetting.settingEl.addClass('ert-settingRow');

    const yamlOverridesSetting = new ObsidianSetting(containerEl)
        .setName(t('settings.pov.yamlOverrides.name'));
    renderNarrationDesc(yamlOverridesSetting.descEl, t('settings.pov.yamlOverrides.desc'));
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

    const previewToggle = withAccessibleLabel(yamlOverridesSetting.controlEl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button' }
    }), t('settings.pov.preview.hide'));
    const refreshPreviewButton = () => {
        const label = previewExpanded ? t('settings.pov.preview.hide') : t('settings.pov.preview.show');
        setIcon(previewToggle, previewExpanded ? 'chevron-down' : 'chevron-right');
        setTooltip(previewToggle, label);
        setAccessibleLabel(previewToggle, label);
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
        narrationValue: string,
        narrationMode?: NarrationMode
    ) => {
        const povInfo = resolveScenePov(
            {
                Character: characters,
                pov: narrationValue
            },
            { narrationMode }
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
            narrationValue: string,
            narrationMode?: NarrationMode
        ) => {
            const example = previewBody.createDiv({ cls: 'ert-pov-example' });
            example.createDiv({ cls: 'ert-pov-example-label', text: label });
            const content = example.createDiv({ cls: 'ert-pov-example-content' });
            renderNamesWithSup(content, buildPreviewEntries(characters, narrationValue, narrationMode));
        };

        renderExample(t('settings.pov.preview.examples.sceneFirst'), ['Alice'], 'first');
        renderExample(t('settings.pov.preview.examples.sceneThird'), ['Bob'], 'third');
        renderExample(t('settings.pov.preview.examples.sceneSecond'), ['Alice', 'Bob'], 'second');
        renderExample(t('settings.pov.preview.examples.sceneOmni'), ['Alice', 'Bob'], 'omni');
        renderExample(t('settings.pov.preview.examples.sceneObjective'), ['Alice', 'Bob'], 'objective');
        // Count overrides take the book's narration marker.
        renderExample(t('settings.pov.preview.examples.countTwoThird'), ['Alice', 'Bob'], 'two', 'third');
        renderExample(t('settings.pov.preview.examples.countThreeThird'), ['Alice', 'Bob', 'Charlie'], 'three', 'third');
        renderExample(t('settings.pov.preview.examples.countFourThird'), ['Alice', 'Bob', 'Charlie', 'Diana'], 'four', 'third');
        renderExample(t('settings.pov.preview.examples.countTwoFirstNumeric'), ['Alice', 'Bob'], '2', 'first');
        renderExample(t('settings.pov.preview.examples.countAllFirst'), ['Alice', 'Bob', 'Charlie'], 'all', 'first');
    };

    renderPreview();
}
