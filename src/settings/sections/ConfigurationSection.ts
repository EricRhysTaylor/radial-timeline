import { App, Setting as Settings } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { ReadabilityScale } from '../../types/settings';
import { clearFontMetricsCaches } from '../../renderer/utils/FontMetricsCache';
import { t } from '../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { addPathChip } from '../pathChip';
import { FolderLocationModal } from '../../modals/FolderLocationModal';
import { DEFAULT_SETTINGS } from '../defaults';
import { resolveExportOutputFolder, escapesVaultRoot } from '../../utils/aiOutput';
import { systemFolderPath } from '../../utils/systemFolder';
import { ERT_CLASSES } from '../../ui/classes';
import { IMPACT_FULL } from '../SettingImpact';
import { countContentLogFiles, resolveLogsRoot } from '../../ai/log';
import { renderMetadataSection } from './MetadataSection';
import {
    buildTimelineChapterResolverItems,
    collapseTimelineChapterMarkersByResolvedBoundary,
    resolveTimelineChapterMarkers
} from '../../utils/timelineChapters';

export function renderConfigurationSection(params: { app: App; plugin: RadialTimelinePlugin; containerEl: HTMLElement }): void {
    const { app, plugin, containerEl } = params;
    containerEl.classList.add(ERT_CLASSES.STACK);

    const configurationHeading = new Settings(containerEl)
        .setName(t('settings.configuration.heading'))
        .setHeading();
    addHeadingIcon(configurationHeading, 'pyramid');
    addWikiLink(configurationHeading, 'Settings-Advanced#configuration');
    applyErtHeaderLayout(configurationHeading);

    const configurationBody = containerEl.createDiv({ cls: [ERT_CLASSES.SECTION_BODY, ERT_CLASSES.STACK] });

    const createDenseRow = (
        parent: HTMLElement,
        options: {
            title: string;
            description: string;
            control: (setting: Settings) => void;
        }
    ): Settings => {
        const row = new Settings(parent)
            .setName(options.title)
            .setDesc(options.description);
        row.settingEl.addClass('ert-settingRow');
        options.control(row);
        return row;
    };

    const displayContainer = configurationBody.createDiv({ cls: 'ert-config-group' });
    displayContainer.createDiv({ cls: 'ert-config-group-title', text: 'Timeline Display' });

    const schemaContainer = configurationBody.createDiv({ cls: 'ert-config-group' });
    schemaContainer.createDiv({ cls: 'ert-config-group-title', text: 'Schema & Manuscript' });

    const logsContainer = configurationBody.createDiv({ cls: 'ert-config-group' });
    logsContainer.createDiv({ cls: 'ert-config-group-title', text: 'Logs' });

    const outputFolder = resolveLogsRoot();
    const exportFolderDefault = DEFAULT_SETTINGS.manuscriptOutputFolder || systemFolderPath('Export');

    // Logs
    const logsRow = createDenseRow(logsContainer, {
        title: t('settings.configuration.aiOutputFolder.name'),
        description: t('settings.configuration.aiOutputFolder.desc'),
        control: () => {}
    });
    addPathChip(logsRow, app, outputFolder);

    // Export folder is user-configurable. Manuscript, outline, and cue-card
    // exports land here. Writes go through the vault API, so the value must
    // stay inside the vault (validated on save). The row stays clean — just
    // the path chip, which opens a location modal with an autocomplete input.
    const exportRow = createDenseRow(logsContainer, {
        title: t('settings.configuration.manuscriptOutputFolder.name'),
        description: t('settings.configuration.manuscriptOutputFolder.desc'),
        control: () => {}
    });
    const openExportLocationModal = (): void => {
        new FolderLocationModal(app, {
            title: t('settings.configuration.manuscriptOutputFolder.name'),
            description: t('settings.configuration.manuscriptOutputFolder.desc'),
            value: plugin.settings.manuscriptOutputFolder || '',
            placeholder: exportFolderDefault,
            validate: (normalized) => escapesVaultRoot(normalized)
                ? 'Folder must stay inside your vault.'
                : null,
            onSave: async (normalized) => {
                const nextFolder = normalized || exportFolderDefault;
                plugin.settings.manuscriptOutputFolder = nextFolder;
                await plugin.saveSettings();
                refreshExportChip(resolveExportOutputFolder(plugin));
            }
        }).open();
    };
    const refreshExportChip = (folder: string): void => {
        const existing = exportRow.controlEl.querySelector<HTMLElement>(':scope > .ert-path-chips');
        if (existing) existing.remove();
        addPathChip(exportRow, app, folder, { onClick: openExportLocationModal });
    };
    refreshExportChip(resolveExportOutputFolder(plugin));

    const apiLoggingSetting = createDenseRow(logsContainer, {
        title: 'Enable AI content logs',
        description: 'When enabled, full prompts, materials, and API responses are written to feature content folders under Logs. Concise logs, archives, snapshots, and move history are always written regardless of this toggle.',
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.logApiInteractions)
                .onChange(async (value) => {
                    plugin.settings.logApiInteractions = value;
                    await plugin.saveSettings();
                }));
        }
    });
    const contentChip = addPathChip(apiLoggingSetting, app, outputFolder, { label: 'Content logs' });

    const scheduleLogCount = () => {
        const runCount = () => {
            const fileCount = countContentLogFiles(plugin);
            contentChip.setCount(fileCount);
        };
        const requestIdleCallback = (window as Window & {
            requestIdleCallback?: (cb: () => void) => void;
        }).requestIdleCallback;
        if (requestIdleCallback) {
            requestIdleCallback(runCount);
        } else {
            window.setTimeout(runCount, 0);
        }
    };
    scheduleLogCount();

    // Schema & Manuscript
    const remapContainer = schemaContainer.createDiv({ cls: ERT_CLASSES.STACK });
    renderMetadataSection({ app, plugin, containerEl: remapContainer });

    createDenseRow(schemaContainer, {
        title: t('settings.configuration.rippleRename.name'),
        description: t('settings.configuration.rippleRename.desc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.enableManuscriptRippleRename ?? false)
                .onChange(async (value) => {
                    plugin.settings.enableManuscriptRippleRename = value;
                    await plugin.saveSettings();
                }));
        }
    });

    // Timeline Display
    const buildChapterMarkerDescription = (status?: string): string => {
        const base = t('settings.configuration.chapterMarkers.desc');
        return status ? `${base} ${status}` : base;
    };

    createDenseRow(displayContainer, {
        title: t('settings.configuration.autoExpand.name'),
        description: t('settings.configuration.autoExpand.desc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.enableSceneTitleAutoExpand ?? true)
                .onChange(async (value) => {
                    plugin.settings.enableSceneTitleAutoExpand = value;
                    await plugin.saveSettings();
                }));
        }
    });

    const chapterMarkerSetting = createDenseRow(displayContainer, {
        title: t('settings.configuration.chapterMarkers.name'),
        description: buildChapterMarkerDescription(),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showChapterMarkers ?? false)
                .onChange(async (value) => {
                    plugin.settings.showChapterMarkers = value;
                    await plugin.saveSettings();
                    plugin.onSettingChanged(IMPACT_FULL);
                }));
        }
    });

    createDenseRow(displayContainer, {
        title: 'Recent drag move overlay in narrative mode',
        description: 'Shows the last committed scene and beat drag moves in narrative timeline.',
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showRecentMovesOverlay ?? true)
                .onChange(async (value) => {
                    plugin.settings.showRecentMovesOverlay = value;
                    await plugin.saveSettings();
                    plugin.onSettingChanged(IMPACT_FULL);
                }));
        }
    });

    createDenseRow(displayContainer, {
        title: t('settings.configuration.readability.name'),
        description: t('settings.configuration.readability.desc'),
        control: (setting) => {
            setting.addDropdown(drop => {
                drop.addOption('normal', t('settings.configuration.readability.normal'));
                drop.addOption('large', t('settings.configuration.readability.large'));
                drop.setValue(plugin.settings.readabilityScale ?? 'normal');
                drop.onChange(async (value) => {
                    plugin.settings.readabilityScale = value as ReadabilityScale;
                    await plugin.saveSettings();
                    clearFontMetricsCaches(); // Clear cached measurements for new scale
                    plugin.onSettingChanged(IMPACT_FULL); // Tier 3: font sizes/spacing change across entire timeline
                });
                drop.selectEl.addClass('ert-input', 'ert-input--sm', 'ert-setting-dropdown');
            });
        }
    });

    const refreshChapterMarkerStatus = async () => {
        try {
            const chapterResolverItems = buildTimelineChapterResolverItems(await plugin.getSceneData());
            const chapterCount = collapseTimelineChapterMarkersByResolvedBoundary(
                resolveTimelineChapterMarkers(chapterResolverItems)
            ).length;
            chapterMarkerSetting.setDesc(buildChapterMarkerDescription(
                chapterCount > 0
                    ? `${chapterCount} active chapter marker${chapterCount === 1 ? '' : 's'} in the current active book.`
                    : 'No active chapter markers.'
            ));
        } catch {
            chapterMarkerSetting.setDesc(buildChapterMarkerDescription('No active chapter markers.'));
        }
    };
    void refreshChapterMarkerStatus();

}
