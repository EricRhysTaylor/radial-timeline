import { App, Setting as Settings, setIcon, type DropdownComponent } from 'obsidian';
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
    bookChapterContext,
    buildTimelineChapterResolverItems,
    chapterFolderLevels,
    collapseTimelineChapterMarkersByResolvedBoundary,
    parseChapterSourceOption,
    resolveChapters,
    resolveTimelineChapterMarkers
} from '../../utils/timelineChapters';
import { getActiveBook } from '../../utils/books';
import { openBookRenumber, planBookRenumber } from '../../services/BookRenumberService';
import { refreshWritingStudios } from '../../writingStudio/openWritingStudio';

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
            /** Lucide icon shown before the title. */
            icon?: string;
            control: (setting: Settings) => void;
        }
    ): Settings => {
        const row = new Settings(parent)
            .setName(options.title)
            .setDesc(options.description);
        row.settingEl.addClass('ert-settingRow');
        if (options.icon) {
            const iconEl = createSpan({ cls: 'ert-config-row-icon' });
            setIcon(iconEl, options.icon);
            row.nameEl.prepend(iconEl);
        }
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
                .setValue(plugin.settings.enableManuscriptRippleRename ?? DEFAULT_SETTINGS.enableManuscriptRippleRename ?? true) // SAFE: an unset setting shows its default
                .onChange(async (value) => {
                    plugin.settings.enableManuscriptRippleRename = value;
                    await plugin.saveSettings();
                }));
        }
    });

    // The same renumber a drag runs, on demand. The button says what is pending.
    createDenseRow(schemaContainer, {
        title: t('ui.bookRenumber.settingName'),
        description: t('ui.bookRenumber.settingDesc'),
        control: (setting) => {
            setting.addButton(button => {
                const recount = async (): Promise<void> => {
                    button.setButtonText(t('ui.bookRenumber.settingCounting')).setDisabled(true);
                    let pending: number;
                    try {
                        pending = (await planBookRenumber(plugin)).needRename;
                    } catch (error) {
                        // Leave the button usable: a click retries and reports the failure.
                        console.error('Renumber count failed:', error);
                        button.setButtonText(t('ui.bookRenumber.settingName')).setDisabled(false);
                        return;
                    }
                    if (pending === 0) {
                        button.setButtonText(t('ui.bookRenumber.settingInOrder'));
                        return;
                    }
                    button.setButtonText(t('ui.bookRenumber.settingButton', { notes: tCount('note', pending) })).setDisabled(false);
                };
                button.onClick(() => {
                    void openBookRenumber(plugin, { onDone: () => { void recount(); } });
                });
                void recount();
            });
        }
    });

    // Timeline Display
    createDenseRow(displayContainer, {
        title: t('ui.configurationSection.sceneTimeCueBarName'),
        description: t('ui.configurationSection.sceneTimeCueBarDesc'),
        icon: 'git-commit-vertical',
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
        icon: 'mail',
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
        icon: 'lamp-ceiling',
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
        icon: 'unfold-horizontal',
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
        icon: 'bookmark',
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

    // Chapter source (per book): the Chapter property, or a folder level under
    // the book's folder. Every chapter surface resolves chapters from it.
    let chapterSourceDropdown: DropdownComponent | null = null;
    const chapterSourceSetting = createDenseRow(displayContainer, {
        title: t('settings.configuration.chapterSource.name'),
        description: t('settings.configuration.chapterSource.desc'),
        icon: 'folder-tree',
        control: (setting) => {
            setting.addDropdown(drop => {
                chapterSourceDropdown = drop;
                drop.selectEl.addClass('ert-input', 'ert-input--sm', 'ert-setting-dropdown');
                drop.onChange(async (value) => {
                    const book = getActiveBook(plugin.settings);
                    if (!book) return;
                    book.chapterSource = parseChapterSourceOption(value);
                    await plugin.saveSettings();
                    plugin.onSettingChanged(IMPACT_FULL);
                    refreshWritingStudios(plugin.app);
                    void refreshChapterMarkerStatus();
                    void refreshChapterSource();
                });
            });
        }
    });

    /** Fill the Chapter source choices for the active book: the property, then each folder level with example names. */
    const refreshChapterSource = async () => {
        const drop = chapterSourceDropdown;
        if (!drop) return;
        const book = getActiveBook(plugin.settings);
        drop.selectEl.empty();
        if (!book || !book.sourceFolder) {
            drop.addOption('property', t('settings.configuration.chapterSource.property'));
            drop.setDisabled(true);
            chapterSourceSetting.setDesc(t('settings.configuration.chapterSource.noBook'));
            return;
        }
        drop.setDisabled(false);
        const scenes = buildTimelineChapterResolverItems(await plugin.getSceneData({ sourcePath: book.sourceFolder }))
            .filter((scene): scene is typeof scene & { path: string } => !!scene.path);
        const levels = chapterFolderLevels(scenes.map(scene => scene.path), book.sourceFolder);
        drop.addOption('property', t('settings.configuration.chapterSource.property'));
        levels.forEach((names, index) => {
            const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');
            drop.addOption(`folder:${index + 1}`, t('settings.configuration.chapterSource.folderLevel', { level: index + 1, examples: shown }));
        });
        const source = book.chapterSource ?? { kind: 'property' as const };
        const value = source.kind === 'property' ? 'property' : `folder:${source.depth}`;
        // A chosen level the book no longer has stays visible as chosen, so nothing changes silently.
        if (source.kind === 'folder' && source.depth > levels.length) {
            drop.addOption(value, t('settings.configuration.chapterSource.folderLevel', { level: source.depth, examples: t('settings.configuration.chapterSource.noFolders') }));
        }
        drop.setValue(value);
        const split = source.kind === 'folder'
            ? [...new Set(resolveChapters(scenes, bookChapterContext(book)).chapters.filter(chapter => chapter.split).map(chapter => chapter.title))]
            : [];
        chapterSourceSetting.setDesc(split.length > 0
            ? t('settings.configuration.chapterSource.splitWarning', { desc: t('settings.configuration.chapterSource.desc'), chapters: split.join(', ') })
            : t('settings.configuration.chapterSource.desc'));
    };
    void refreshChapterSource();

    createDenseRow(displayContainer, {
        title: t('ui.configurationSection.recentMovesName'),
        description: t('ui.configurationSection.recentMovesDesc'),
        icon: 'history',
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
        icon: 'a-large-small',
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
                resolveTimelineChapterMarkers(chapterResolverItems, bookChapterContext(getActiveBook(plugin.settings)))
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
