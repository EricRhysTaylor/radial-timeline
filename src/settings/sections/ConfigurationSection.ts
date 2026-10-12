import { App, Setting as Settings } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { ReadabilityScale } from '../../types/settings';
import { clearFontMetricsCaches } from '../../renderer/utils/FontMetricsCache';
import { t, tCount } from '../../i18n';
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
    displayContainer.createDiv({ cls: 'ert-config-group-title', text: t('ui.configurationSection.timelineDisplayTitle') });

    const schemaContainer = configurationBody.createDiv({ cls: 'ert-config-group' });
    schemaContainer.createDiv({ cls: 'ert-config-group-title', text: t('ui.configurationSection.schemaManuscriptTitle') });

    const logsContainer = configurationBody.createDiv({ cls: 'ert-config-group' });
    logsContainer.createDiv({ cls: 'ert-config-group-title', text: t('settings.configuration.aiOutputFolder.name') });

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
                ? t('ui.configurationSection.folderInsideVaultError')
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
        title: t('ui.configurationSection.contentLogsName'),
        description: t('ui.configurationSection.contentLogsDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.logApiInteractions)
                .onChange(async (value) => {
                    plugin.settings.logApiInteractions = value;
                    await plugin.saveSettings();
                }));
        }
    });
    const contentChip = addPathChip(apiLoggingSetting, app, outputFolder, { label: t('ui.configurationSection.contentLogsChip') });

    const scheduleLogCount = () => {
        const runCount = () => {
            const fileCount = countContentLogFiles(plugin);
            contentChip.setCount(fileCount);
        };
        window.requestIdleCallback(runCount);
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
    createDenseRow(displayContainer, {
        title: t('ui.configurationSection.sceneTimeCueBarName'),
        description: t('ui.configurationSection.sceneTimeCueBarDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showSceneTimeCueBar !== false)
                .onChange(async (value) => {
                    plugin.settings.showSceneTimeCueBar = value;
                    await plugin.saveSettings();
                }));
        }
    });
    createDenseRow(displayContainer, {
        title: t('ui.configurationSection.communityMailboxName'),
        description: t('ui.configurationSection.communityMailboxDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showCommunityMailbox !== false)
                .onChange(async (value) => {
                    plugin.settings.showCommunityMailbox = value;
                    await plugin.saveSettings();
                }));
        }
    });
    createDenseRow(displayContainer, {
        title: t('ui.configurationSection.deskLampsName'),
        description: t('ui.configurationSection.deskLampsDesc'),
        control: (setting) => {
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.showDeskLamps !== false)
                .onChange(async (value) => {
                    plugin.settings.showDeskLamps = value;
                    await plugin.saveSettings();
                }));
        }
    });
    const buildChapterMarkerDescription = (status?: string): string => {
        const base = t('settings.configuration.chapterMarkers.desc');
        return status ? t('ui.configurationSection.chapterMarkersDescWithStatus', { desc: base, status }) : base;
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
        title: t('ui.configurationSection.recentMovesName'),
        description: t('ui.configurationSection.recentMovesDesc'),
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
                    ? t('ui.configurationSection.chapterMarkersActive', { markers: tCount('activeChapterMarker', chapterCount) })
                    : t('ui.configurationSection.chapterMarkersNone')
            ));
        } catch {
            chapterMarkerSetting.setDesc(buildChapterMarkerDescription(t('ui.configurationSection.chapterMarkersNone')));
        }
    };
    void refreshChapterMarkerStatus();

}
