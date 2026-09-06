import { buildBeatActColumns, stripActPrefix, type ActGridColumn } from './beats/actGrid';
import { App, ButtonComponent, Component, getIconIds, Menu, Modal, normalizePath, Notice, setIcon, Setting as Settings, setTooltip, TFile } from 'obsidian';
import { t } from '../../i18n';
import type RadialTimelinePlugin from '../../main';
import { CreateBeatSetModal } from '../../modals/CreateBeatsTemplatesModal';
import { orderBeatsByAct, parseBeatRow } from '../../storyBeats/beatRows';
import { clampBeatAct, getBeatSystemStructuralStatus, getPreviewIssueEntries, getPreviewIssueKind, getPreviewIssueSummaryLabel, normalizeBeatTitle } from '../../storyBeats/beatSystemStatus';
import { applyBeatNoteMerge, planBeatNoteMerge } from '../../storyBeats/mergeBeatNotes';
import type { BeatStructuralBeatStatus, BeatSystemStructuralStatus } from '../../storyBeats/types';
import type { TimelineItem } from '../../types';
import type { BeatDefinition, BeatLibraryItem, BeatSystemConfig, LoadedBeatTab } from '../../types/settings';
import { getPlotSystem } from '../../utils/beatsSystems';
import { buildBeatDecimalPrefixes, buildPlotSystemFromLoadedTab, createBeatNotesFromSet, getBeatConfigForSystem } from '../../utils/beatsTemplates';
import { waitForFileCaches, waitForMetadataResolved } from '../../utils/metadataCacheWait';
import { DEFAULT_SETTINGS } from '../defaults';
import { renderYamlAuditPanel } from './beats/YamlAuditPanel';

import { SystemEditModal } from '../../modals/SystemEditModal';
import { BLANK_LIBRARY_ITEM_ID, getBeatLibraryItems } from '../../storyBeats/libraryState';
import { activateLoadedBeatTab, ensureBeatWorkspaceState, ensureMaterializedBeatWorkspaceState, getActiveLoadedBeatTab, getActiveLoadedBeatTabId, getLoadedBeatTabs, getMaterializedBeatTabs, isBeatLibraryItemLoaded, loadBeatTabFromLibraryItem, materializeBeatTab, unloadBeatTab, updateLoadedBeatTab } from '../../storyBeats/workspaceState';
import type { HoverMetadataField, SavedBeatSystem } from '../../types/settings';
import { ERT_CLASSES, ERT_DATA } from '../../ui/classes';
import { clampActNumber, parseActLabels, resolveActLabel } from '../../utils/acts';
import { DEFAULT_CUSTOM_BEAT_SYSTEM_ID, getCustomBeatConfigKey, replaceSavedBeatSystem, resolveSelectedBeatModelFromSettings, } from '../../utils/beatSystemState';
import { generateBeatGuid, hasBeatReadableText, normalizeBeatFieldKeyInput, normalizeBeatFieldListValueInput, normalizeBeatFieldValueInput, normalizeBeatNameInput, normalizeBeatSetNameInput, } from '../../utils/beatsInputNormalize';
import { parseDescriptionParts } from '../../utils/descriptionParser';
import { scheduleFocusAfterPaint } from '../../utils/domFocus';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { comparePrefixTokens, extractPrefixToken } from '../../utils/prefixOrder';
import { getScenePrefixNumber } from '../../utils/text';
import { SHARED_CHAPTER_FIELD_KEY } from '../../utils/timelineChapters';
import { tooltipForComponent } from '../../utils/tooltip';
import { computeCanonicalOrder, getBaseKeys, getCustomKeys, getTemplateParts, RESERVED_OBSIDIAN_KEYS } from '../../utils/yamlTemplateNormalize';
import { IconSuggest } from '../IconSuggest';
import { IMPACT_FULL } from '../SettingImpact';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { BEAT_SYSTEM_COPY } from './beats/beatSystemCopy';
import { dirtyState, type InnerStage } from './beats/dirtyState';
import type { BeatNoteCustomContentSummary, BeatRow, FieldEntry } from './beats/types';
import { buildYamlFromEntries, extractKeysInOrder, safeParseYaml, } from './beats/yamlHelpers';
import { renderSceneNormalizerSection } from './scene/SceneNormalizerSection';
import { renderScenePropertiesSection } from './scene/ScenePropertiesSection';

const DEFAULT_HOVER_ICON = 'align-vertical-space-around';

function ensureSharedChapterFieldEntries(entries: FieldEntry[]): FieldEntry[] {
    if (entries.some((entry) => entry.key === SHARED_CHAPTER_FIELD_KEY)) {
        return entries;
    }
    return [{ key: SHARED_CHAPTER_FIELD_KEY, value: '', required: false }, ...entries];
}

function isMeaningfulFrontmatterValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.some((entry) => isMeaningfulFrontmatterValue(entry));
    return true;
}

// ── Module-level UI state (survives re-renders within the same plugin session) ──

let _currentInnerStage: InnerStage = 'preview';
const isBeatLibraryMode = (): boolean => _currentInnerStage === 'library';

export function renderBeatPropertiesSection(params: {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    backdropYamlTargetEl?: HTMLElement;
    scope: Component;
}): void {
    const { app, plugin, containerEl, backdropYamlTargetEl, scope } = params;
    let disposed = false;
    let _unsubTopBeatTabsDirty: (() => void) | null = null;
    let _unsubDesignDirty: (() => void) | null = null;
    let _disconnectBeatTabsResizeObserver: (() => void) | null = null;
    let customBeatsObserver: IntersectionObserver | null = null;
    scope.register(() => {
        disposed = true;
        _unsubTopBeatTabsDirty?.();
        _unsubDesignDirty?.();
        _disconnectBeatTabsResizeObserver?.();
        customBeatsObserver?.disconnect();
    });
    containerEl.empty();
    ensureBeatWorkspaceState(plugin.settings);
    ensureMaterializedBeatWorkspaceState(app, plugin.settings);
    const actsSection = containerEl.createDiv({ cls: ERT_CLASSES.STACK, attr: { [ERT_DATA.SECTION]: 'beats-acts' } });
    const actsStack = actsSection.createDiv({ cls: ERT_CLASSES.STACK });
    const beatsSection = containerEl.createDiv({ cls: ERT_CLASSES.STACK, attr: { [ERT_DATA.SECTION]: 'beats-story' } });
    const beatsStack = beatsSection.createDiv({ cls: ERT_CLASSES.STACK });
    const yamlSection = containerEl.createDiv({ cls: ERT_CLASSES.STACK, attr: { [ERT_DATA.SECTION]: 'beats-yaml' } });
    const yamlStack = yamlSection.createDiv({ cls: ERT_CLASSES.STACK });

    // Acts Section (above beats)
    const actsHeading = new Settings(actsStack)
        .setName(t('settings.beats.acts.name'))
        .setHeading();
    addHeadingIcon(actsHeading, 'chart-pie');
    addWikiLink(actsHeading, 'Settings-Core#acts');
    applyErtHeaderLayout(actsHeading);

    const getActCount = () => Math.max(3, plugin.settings.actCount ?? 3);

    const getActPreviewLabels = () => {
        const count = getActCount();
        const labels = parseActLabels(plugin.settings, count);
        return Array.from({ length: count }, (_, idx) => resolveActLabel(idx, labels));
    };

    const updateActPreview = () => {
        const previewLabels = getActPreviewLabels();
        actsPreviewHeading.setText(`Preview (${previewLabels.length} acts)`);
        actsPreviewBody.setText(previewLabels.join(' · '));
    };

    const getLoadedBeatWorkspaceTabs = () => getMaterializedBeatTabs(app, plugin.settings);
    const getActiveBeatWorkspaceTab = () => getActiveLoadedBeatTab(plugin.settings);
    const getActiveBeatWorkspaceTabId = () => getActiveLoadedBeatTabId(plugin.settings);
    const getActiveBeatWorkspaceName = (fallback = 'Custom') => getActiveBeatWorkspaceTab()?.name?.trim() || fallback;
    const getActiveBeatWorkspaceDescription = () => getActiveBeatWorkspaceTab()?.description ?? '';
    const getActiveBeatWorkspaceBeats = () => getActiveBeatWorkspaceTab()?.beats ?? [];
    const getActiveBeatWorkspaceKind = () => getActiveBeatWorkspaceTab()?.sourceKind ?? 'blank';
    const getActiveSavedSystemId = () => {
        const activeTab = getActiveBeatWorkspaceTab();
        if (!activeTab) return undefined;
        if (activeTab.linkedSavedSystemId) return activeTab.linkedSavedSystemId;
        if (activeTab.sourceKind === 'saved' && activeTab.sourceId) return activeTab.sourceId;
        return undefined;
    };
    const getActiveDirtyKey = () => getActiveBeatWorkspaceTabId() ?? DEFAULT_CUSTOM_BEAT_SYSTEM_ID;
    const isActiveWorkspaceBuiltin = () => getActiveBeatWorkspaceKind() === 'builtin';
    const isEditableActiveBeatWorkspace = () => !isActiveWorkspaceBuiltin();
    const getActiveCustomId = () => getActiveSavedSystemId() ?? getActiveDirtyKey();
    const getActiveCustomName = (fallback = 'Custom') => getActiveBeatWorkspaceName(fallback);
    const getActiveCustomDescription = () => getActiveBeatWorkspaceDescription();
    const getActiveCustomBeats = () => getActiveBeatWorkspaceBeats();
    const setActiveCustomBeats = (beats: BeatDefinition[]) => {
        const activeTabId = getActiveBeatWorkspaceTabId();
        if (!activeTabId) return;
        updateLoadedBeatTab(plugin.settings, activeTabId, (tab) => ({
            ...tab,
            beats,
        }));
    };

    const openCustomSystemDetailsModal = (
        systemId: string,
        options?: { refreshSets?: boolean }
    ) => {
        const targetSystem = (plugin.settings.savedBeatSystems ?? []).find((system) => system.id === systemId);
        if (!targetSystem) return;
        const activeTabId = getActiveBeatWorkspaceTabId();
        const isActiveSystem = getActiveSavedSystemId() === systemId && !!activeTabId;
        new SystemEditModal(app, targetSystem.name, targetSystem.description ?? '', async (newName, newDesc) => {
            const normalizedName = normalizeBeatSetNameInput(newName, '');
            if (!normalizedName || !hasBeatReadableText(normalizedName)) {
                new Notice(t('settings.beats.systemEditModal.nameLettersNotice'));
                return false;
            }

            replaceSavedBeatSystem(plugin.settings, {
                ...targetSystem,
                name: normalizedName,
                description: newDesc,
            });
            await plugin.saveSettings();

            if (isActiveSystem && activeTabId) {
                updateLoadedBeatTab(plugin.settings, activeTabId, (tab) => ({
                    ...tab,
                    name: normalizedName,
                    description: newDesc,
                }));
                invalidateBeatStructuralStatus();
                updateTemplateButton(templateSetting, getActiveBeatWorkspaceName('Custom'));
                renderCustomConfig();
                renderPreviewContent(getActiveBeatWorkspaceName('Custom'));
                renderBeatYamlEditor();
                updateBeatHoverPreview?.();
                renderBeatSystemTabs();
            }

            if (options?.refreshSets) {
                renderSavedBeatSystems();
            }
            return true;
        }).open();
    };

    type ActRange = { min: number; max: number; sceneNumbers: number[] };

    const formatRangeValue = (value: number): string => {
        if (Number.isInteger(value)) return String(value);
        return String(value);
    };

    const formatRangeLabel = (range: ActRange): string => {
        const min = formatRangeValue(range.min);
        const max = formatRangeValue(range.max);
        return min === max ? min : `${min}-${max}`;
    };

    const collectActRanges = async (allowFetch: boolean): Promise<Map<number, ActRange> | null> => {
        let scenes: TimelineItem[] | undefined;
        if (Array.isArray(plugin.lastSceneData)) {
            scenes = plugin.lastSceneData;
        } else if (allowFetch) {
            try {
                scenes = await plugin.getSceneData();
            } catch {
                return new Map();
            }
        } else {
            return null;
        }

        const actCount = getActCount();
        const ranges = new Map<number, ActRange>();

        (scenes ?? []).forEach(scene => {
            if (scene.itemType !== 'Scene') return;
            const numStr = getScenePrefixNumber(scene.title, scene.number);
            if (!numStr) return;
            const num = Number(numStr);
            if (!Number.isFinite(num)) return;
            const rawAct = Number(scene.actNumber ?? scene.act ?? 1);
            const act = clampActNumber(rawAct, actCount);
            const existing = ranges.get(act);
            if (!existing) {
                ranges.set(act, { min: num, max: num, sceneNumbers: [num] });
            } else {
                if (num < existing.min) existing.min = num;
                if (num > existing.max) existing.max = num;
                existing.sceneNumbers.push(num);
            }
        });

        // Sort and deduplicate scene numbers per act
        ranges.forEach(range => {
            range.sceneNumbers = [...new Set(range.sceneNumbers)].sort((a, b) => a - b);
        });

        return ranges;
    };

    const buildBeatDisplayPrefixes = (beats: BeatRow[], maxActs: number, ranges: Map<number, ActRange>): string[] => {
        const beatActs = beats.map((beatLine) => clampBeatAct(beatLine.act, maxActs));
        const actSceneNumbers = new Map<number, number[]>();
        ranges.forEach((range, actNumber) => {
            actSceneNumbers.set(actNumber, range.sceneNumbers);
        });
        return buildBeatDecimalPrefixes(beatActs, actSceneNumbers);
    };

    type BeatMissingDiagnostic = {
        name: string;
        reason: string;
    };

    type StructuralHealthState = {
        icon: string;
        statusClass: string;
        tooltip: string;
    };

    let beatStructuralStatus: BeatSystemStructuralStatus | null = null;
    let beatStructuralStatusKey = '';
    let refreshCustomBeatList: (() => void) | null = null;
    let refreshCustomBeats: ((allowFetch: boolean) => void) | null = null;
    let refreshHealthIcon: (() => void) | null = null;

    const getBeatSystemTabStatus = (tab: LoadedBeatTab): StructuralHealthState => {
        const isActiveTab = getActiveBeatWorkspaceTabId() === tab.tabId;
        const activeWorkspaceTab = isActiveTab ? getActiveBeatWorkspaceTab() : null;
        const statusTab = activeWorkspaceTab ?? tab;
        if ((isActiveTab && isSetDirty()) || (!isActiveTab && tab.dirty)) {
            return {
                icon: 'circle-alert',
                statusClass: 'ert-beat-health-icon--modified',
                tooltip: 'Loaded system has unsaved changes.'
            };
        }
        return getStructuralHealthState(statusTab.name, statusTab);
    };

    /** Produce a lightweight hash string from the current custom beat state. */
    const snapshotHash = (): string => {
        const activeTab = getActiveBeatWorkspaceTab();
        const beats = (activeTab?.beats ?? [])
            .map(b => `${b.name}|${b.act}|${(b as { purpose?: string }).purpose ?? ''}|${(b as { range?: string }).range ?? ''}`)
            .join(';');
        const cfg = activeTab?.config;
        const yaml = cfg?.beatYamlAdvanced ?? '';
        const hover = (cfg?.beatHoverMetadataFields ?? []).map(f => `${f.key}:${f.icon}:${f.enabled}`).join(';');
        return `${beats}##${yaml}##${hover}`;
    };

    /** Capture the current state as the set baseline via the reactive store. */
    const captureSetBaseline = (setId: string) => {
        dirtyState.setBaseline(setId, snapshotHash());
    };

    /** Convenience: true when the loaded set has been modified from its baseline. */
    const isSetDirty = (): boolean => {
        const activeId = getActiveDirtyKey();
        return dirtyState.isDirty(activeId, snapshotHash());
    };

    const getStructuralLookupKey = (selectedSystem: string, loadedTab?: LoadedBeatTab | null): string => {
        const sourcePath = normalizePath((plugin.settings.sourcePath || '').trim());
        const actCount = String(getActCount());
        if (loadedTab) {
            const fingerprint = loadedTab.beats
                .map((beat) => {
                    const row = parseBeatRow(beat);
                    return `${normalizeBeatTitle(row.name)}:${row.act}`;
                })
                .join(';');
            return `${loadedTab.tabId}|${loadedTab.name}|${fingerprint}|${sourcePath}|${actCount}`;
        }
        const activeTab = getActiveBeatWorkspaceTab();
        if (!activeTab || normalizeBeatSetNameInput(activeTab.name, '') !== normalizeBeatSetNameInput(selectedSystem, '')) {
            return `${selectedSystem}|${sourcePath}|${actCount}`;
        }
        const fingerprint = activeTab.beats
            .map((beat) => {
                const row = parseBeatRow(beat);
                return `${normalizeBeatTitle(row.name)}:${row.act}`;
            })
            .join(';');
        return `${activeTab.tabId}|${activeTab.name}|${fingerprint}|${sourcePath}|${actCount}`;
    };

    const invalidateBeatStructuralStatus = () => {
        beatStructuralStatus = null;
        beatStructuralStatusKey = '';
    };

    const computeBeatStructuralStatus = (selectedSystem: string, loadedTab?: LoadedBeatTab | null): BeatSystemStructuralStatus =>
        getBeatSystemStructuralStatus({
            app,
            settings: plugin.settings,
            selectedSystem,
            ...(loadedTab ? { loadedTab } : {}),
        });

    const getBeatStructuralStatus = (
        selectedSystem: string,
        options?: { refresh?: boolean; loadedTab?: LoadedBeatTab | null }
    ): BeatSystemStructuralStatus => {
        const nextKey = getStructuralLookupKey(selectedSystem, options?.loadedTab ?? null);
        if (!options?.refresh && beatStructuralStatus && beatStructuralStatusKey === nextKey) {
            return beatStructuralStatus;
        }
        beatStructuralStatus = computeBeatStructuralStatus(selectedSystem, options?.loadedTab ?? null);
        beatStructuralStatusKey = nextKey;
        return beatStructuralStatus;
    };

    const getBeatStatusByKey = (
        structuralStatus: BeatSystemStructuralStatus,
        beatKey: string
    ): BeatStructuralBeatStatus | null =>
        structuralStatus.beats.find((beat) => beat.expected.key === beatKey) ?? null;

    const buildMissingBeatDiagnostics = (
        structuralStatus: BeatSystemStructuralStatus
    ): BeatMissingDiagnostic[] =>
        structuralStatus.beats
            .filter((beat) => {
                const activeMatches = structuralStatus.matches.activeByBeatKey.get(beat.expected.key) ?? [];
                const hasMissingModel = beat.issues.some((issue) => issue.code === 'missing_model');
                return activeMatches.length === 0 && !hasMissingModel;
            })
            .map((beat) => {
                const reason = beat.issues.find((issue) => issue.code === 'wrong_model')?.message
                    ?? beat.issues.find((issue) => issue.code === 'non_beat_class')?.message
                    ?? 'No matching title note.';
                return {
                    name: beat.expected.name,
                    reason,
                };
            });

    const getStructuralHealthState = (selectedSystem: string, loadedTab?: LoadedBeatTab | null): StructuralHealthState => {
        const structuralStatus = getBeatStructuralStatus(selectedSystem, { loadedTab: loadedTab ?? null });
        const summary = structuralStatus.summary;
        const previewIssues = getPreviewIssueEntries(structuralStatus);
        if (summary.expectedCount === 0) {
            return {
                icon: 'circle-dashed',
                statusClass: '',
                tooltip: 'No beats defined for this system yet.'
            };
        }
        if (summary.matchedCount === 0) {
            const collisionTooltip = summary.wrongModelBeatCount > 0
                ? 'No beat notes are attributed to this system. Matching titles belong to other Beat Models.'
                : summary.missingModelNoteCount > 0
                    ? 'No beat notes are attributed to this system yet. Matching titles are missing Beat Model.'
                    : 'This system is not yet deployed in the manuscript.';
            return {
                icon: 'circle-dashed',
                statusClass: '',
                tooltip: collisionTooltip,
            };
        }
        if (summary.duplicateCount > 0) {
            return {
                icon: 'alert-circle',
                statusClass: 'ert-beat-health-icon--critical',
                tooltip: `${summary.duplicateCount} duplicate beat note${summary.duplicateCount !== 1 ? 's' : ''} found. Manually delete duplicate notes to resolve.`
            };
        }
        if (summary.missingModelBeatCount > 0) {
            return {
                icon: 'alert-triangle',
                statusClass: 'ert-beat-health-icon--warning',
                tooltip: `${summary.missingModelBeatCount} beat${summary.missingModelBeatCount !== 1 ? 's are' : ' is'} missing Beat Model.`
            };
        }
        if (summary.missingCreateableCount > 0) {
            return {
                icon: 'alert-triangle',
                statusClass: 'ert-beat-health-icon--warning',
                tooltip: `${summary.missingCreateableCount} beat note${summary.missingCreateableCount !== 1 ? 's' : ''} not yet created.`
            };
        }
        if (previewIssues.length === 0) {
            return {
                icon: 'check-circle',
                statusClass: 'ert-beat-health-icon--success',
                tooltip: 'System is active in the manuscript and structurally aligned.'
            };
        }
        return {
            icon: 'alert-triangle',
            statusClass: 'ert-beat-health-icon--warning',
            tooltip: `System is active in the manuscript but has ${previewIssues.length} structural issue${previewIssues.length !== 1 ? 's' : ''}.`
        };
    };

    type PreviewStatusTone = 'success' | 'warning' | 'muted';

    type ManuscriptAdvisoryState = {
        text: string;
        tone: PreviewStatusTone;
        icon: 'check' | 'circle-alert' | null;
    };

    const getPreviewPlacementActNumber = (
        status: BeatStructuralBeatStatus,
        maxActs: number
    ): number => {
        const actualAct = status.matchedNotes.find((note) => Number.isFinite(note.actNumber))?.actNumber;
        if (Number.isFinite(actualAct)) {
            return clampActNumber(Number(actualAct), maxActs);
        }
        return clampActNumber(status.expected.actNumber, maxActs);
    };

    const hasPreviewTemplateActMismatch = (status: BeatStructuralBeatStatus | null): boolean => {
        if (!status || !status.present) return false;
        const actualAct = status.matchedNotes.find((note) => Number.isFinite(note.actNumber))?.actNumber;
        if (!Number.isFinite(actualAct)) return false;
        return clampActNumber(Number(actualAct), getActCount()) !== status.expected.actNumber;
    };

    /**
     * Build a concise out-of-sequence notice for a beat. Identifies which
     * neighbouring beat the prefix has it swapped with.
     * Returns null when the beat is not out of sequence or has no active match.
     */
    const buildOutOfSequenceNotice = (
        beatKey: string,
        structuralStatus: BeatSystemStructuralStatus
    ): string | null => {
        const present = structuralStatus.beats
            .map((beat) => {
                const matches = structuralStatus.matches.activeByBeatKey.get(beat.expected.key) ?? [];
                if (matches.length === 0) return null;
                const rep = [...matches].sort((a, b) =>
                    comparePrefixTokens(extractPrefixToken(a.basename), extractPrefixToken(b.basename))
                )[0];
                return {
                    beatKey: beat.expected.key,
                    beatName: beat.expected.name,
                    templateOrdinal: beat.expected.ordinal,
                    prefix: extractPrefixToken(rep.basename),
                };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        if (present.length < 2) return null;

        const templateOrder = [...present].sort((a, b) => a.templateOrdinal - b.templateOrdinal);
        const manuscriptOrder = [...present].sort((a, b) => comparePrefixTokens(a.prefix, b.prefix));

        const templateIdx = templateOrder.findIndex((entry) => entry.beatKey === beatKey);
        if (templateIdx < 0) return null;
        const self = templateOrder[templateIdx];
        // The beat currently sitting at my expected manuscript slot.
        const usurper = manuscriptOrder[templateIdx];
        if (!usurper || usurper.beatKey === beatKey) return null;

        const selfComesAfter = comparePrefixTokens(self.prefix, usurper.prefix) > 0;
        const actual = selfComesAfter ? 'AFTER' : 'BEFORE';
        const expected = selfComesAfter ? 'BEFORE' : 'AFTER';
        return `Out of manuscript sequence. File prefix ${self.prefix} places it ${actual} ${usurper.beatName} (${usurper.prefix}), but the template puts it ${expected}.`;
    };

    const getManuscriptAdvisoryState = (system: string, loadedTab?: LoadedBeatTab | null): ManuscriptAdvisoryState | null => {
        const structuralStatus = getBeatStructuralStatus(system, { loadedTab: loadedTab ?? null });
        const summary = structuralStatus.summary;
        if (summary.expectedCount === 0) return null;
        if (summary.matchedCount === 0) {
            return {
                text: 'Inactive in manuscript',
                tone: 'muted',
                icon: null,
            };
        }
        const issueLabels: string[] = [];
        issueLabels.push(...getPreviewIssueSummaryLabel(getPreviewIssueEntries(structuralStatus)));
        if (issueLabels.length > 0) {
            return {
                text: `Active in manuscript — ${issueLabels.join(' • ')}`,
                tone: 'warning',
                icon: 'circle-alert',
            };
        }
        return {
            text: 'Active in manuscript — Structure aligned',
            tone: 'success',
            icon: 'check',
        };
    };

    const getSystemOverviewState = (system: string, loadedTab?: LoadedBeatTab | null): {
        title: string;
        description: string;
        examples: string;
        totalBeats: number;
        totalActs: number;
        hasAuthorDesc: boolean;
        sourceLink?: { label: string; href: string };
    } => {
        const activeTab = loadedTab ?? getActiveBeatWorkspaceTab();
        const isBuiltinSystem = !!getPlotSystem(system);
        const copy = getBeatSystemCopy(system);
        const customName = activeTab?.name?.trim() || getActiveCustomName('Custom');
        const customDesc = (activeTab?.description ?? getActiveCustomDescription()).trim();
        const hasAuthorDesc = !isBuiltinSystem && customDesc.length > 0;
        const overview = activeTab
            ? buildLoadedTabActColumns(activeTab)
            : isBuiltinSystem
                ? buildTemplateActColumns(system)
                : buildCustomActColumns();
        return {
            title: activeTab?.name || (isBuiltinSystem ? copy.title : customName || 'Custom'),
            description: hasAuthorDesc ? customDesc : copy.description,
            examples: copy.examples ?? '',
            totalBeats: overview.totalBeats,
            totalActs: overview.columns.length,
            hasAuthorDesc,
            sourceLink: hasAuthorDesc ? undefined : copy.sourceLink,
        };
    };

    /**
     * Renders a system description into a consistent structured layout:
     *  - Summary (top line, slightly stronger weight)
     *  - Body paragraphs ("Use it when…")
     *  - Label/value fields (Best for, Momentum profile)
     *  - Examples (visually muted)
     *  - Beat/act count meta line
     */
    const renderSystemDescription = (
        container: HTMLElement,
        overview: ReturnType<typeof getSystemOverviewState>
    ): void => {
        const parts = parseDescriptionParts(overview.description);
        const wrapper = container.createDiv({ cls: 'ert-desc-block' });

        // Summary
        if (parts.summary) {
            wrapper.createDiv({ cls: 'ert-desc-summary', text: parts.summary });
        }

        // Body paragraphs (e.g. "Use it when…")
        for (const paragraph of parts.body) {
            wrapper.createDiv({ cls: 'ert-desc-body', text: paragraph });
        }

        // Label/value fields
        if (parts.fields.length > 0) {
            const fieldsEl = wrapper.createDiv({ cls: 'ert-desc-fields' });
            for (const field of parts.fields) {
                const row = fieldsEl.createDiv({ cls: 'ert-desc-field' });
                if (field.label) {
                    row.createSpan({ cls: 'ert-desc-field-label', text: `${field.label}: ` });
                }
                row.createSpan({ cls: 'ert-desc-field-value', text: field.value });
            }
        }

        // Examples
        if (!overview.hasAuthorDesc && overview.examples) {
            wrapper.createDiv({ cls: 'ert-desc-examples', text: overview.examples });
        }

        // Meta (beat/act count)
        if (overview.totalBeats > 0) {
            wrapper.createDiv({
                cls: 'ert-desc-meta',
                text: `${overview.totalBeats} beats · ${overview.totalActs} acts`
            });
        }
    };

    new Settings(actsStack)
        .setName(t('settings.beats.actCount.name'))
        .setDesc(t('settings.beats.actCount.desc'))
        .addText(text => {
            text.setPlaceholder(t('settings.beats.actCount.placeholder'));
            text.setValue(String(getActCount()));
            text.inputEl.type = 'number';
            text.inputEl.min = '3';
            text.inputEl.addClass('ert-input--xs');
            text.onChange(async (value) => {
                const parsed = parseInt(value, 10);
                const next = Number.isFinite(parsed) ? Math.max(3, parsed) : 3;
                plugin.settings.actCount = next;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL); // Tier 3: act count affects timeline beat grouping
                updateActPreview();
                // Immediately refresh Custom beat editor so act columns update
                refreshCustomBeatList?.();
            });
        });

    new Settings(actsStack)
        .setName(t('settings.beats.actLabels.name'))
        .setDesc(t('settings.beats.actLabels.desc'))
        .addText(text => {
            text.setPlaceholder(t('settings.beats.actLabels.placeholder'));
            text.setValue(plugin.settings.actLabelsRaw ?? '');
            text.inputEl.addClass('ert-input--xl');
            text.onChange(async (value) => {
                plugin.settings.actLabelsRaw = value;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL); // Tier 3: act labels affect timeline display
                updateActPreview();
            });
        });

    // Preview (planet-style)
    const actsPreview = actsStack.createDiv({
        cls: ['ert-previewFrame', 'ert-previewFrame--center', 'ert-previewFrame--flush'],
        attr: { 'data-preview': 'acts' }
    });
    const actsPreviewHeading = actsPreview.createDiv({ cls: 'ert-planetary-preview-heading', text: 'Preview' });
    const actsPreviewBody = actsPreview.createDiv({ cls: 'ert-planetary-preview-body' });

    updateActPreview();

    const beatsHeading = new Settings(beatsStack)
        .setName(t('settings.beats.storyBeatsSystem.name'))
        .setHeading();
    addHeadingIcon(beatsHeading, 'activity');
    addWikiLink(beatsHeading, 'Settings-Core#story-beats-system');
    applyErtHeaderLayout(beatsHeading);

    // Wrapper keeps tabs + panel as a single stack item (no stack gap between them)
    const beatSystemWrapper = beatsStack.createDiv({ cls: 'ert-beat-system-wrapper' });

    const beatSystemTabs = beatSystemWrapper.createDiv({
        cls: 'ert-mini-tabs',
        attr: { role: 'tablist' }
    });

    const beatSystemCard = beatSystemWrapper.createDiv({
        cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-beat-system-card`,
        attr: { id: 'ert-beat-system-panel', role: 'tabpanel' }
    });
    // Tier banner (always visible; shows system type and manuscript state)
    const tierBannerEl = beatSystemCard.createDiv({ cls: 'ert-beat-tier-banner ert-stack--tight' });

    // ── Inner stage switcher (Preview | Design | Fields) ──────────────
    // Rendered directly under the system overview. Hidden while the Add system
    // library surface is active so loaded system tabs never expose Sets.
    const stageSwitcher = beatSystemCard.createDiv({
        cls: 'ert-stage-switcher',
        attr: { role: 'tablist' }
    });

    // ── Content panels (toggled by stage switcher) ───────────────────
    const templatePreviewContainer = beatSystemCard.createDiv({ cls: ['ert-beat-template-preview', ERT_CLASSES.STACK] });
    templatePreviewContainer.createDiv({ cls: 'ert-beat-template-title ert-settings-hidden' });
    templatePreviewContainer.createDiv({ cls: 'ert-beat-template-desc ert-settings-hidden' });
    templatePreviewContainer.createDiv({ cls: 'ert-beat-template-examples ert-settings-hidden' });
    templatePreviewContainer.createDiv({ cls: 'ert-beat-template-meta ert-settings-hidden' });
    const templatePreviewStatus = templatePreviewContainer.createDiv({ cls: 'ert-beat-template-meta' });
    const templatePreviewIssues = templatePreviewContainer.createDiv({ cls: 'ert-beat-template-issues ert-settings-hidden' });
    const templateActGrid = templatePreviewContainer.createDiv({ cls: 'ert-beat-act-grid' });

    // --- Custom System Configuration (Dynamic Visibility) ---
    const customConfigContainer = beatSystemCard.createDiv({ cls: ['ert-custom-beat-config', ERT_CLASSES.STACK] });

    const appendPreviewStatus = (
        parent: HTMLElement,
        state: { text: string; tone: PreviewStatusTone; icon: 'check' | 'circle-alert' | null },
        extraClass?: string
    ) => {
        const statusEl = parent.createSpan({
            cls: `ert-preview-status ert-preview-status--${state.tone}${extraClass ? ` ${extraClass}` : ''}`
        });
        if (state.icon) {
            const iconEl = statusEl.createSpan({ cls: 'ert-preview-status-icon' });
            setIcon(iconEl, state.icon);
        }
        if (state.text.length > 0) {
            statusEl.createSpan({ text: state.text });
        }
        return statusEl;
    };

    const renderCustomConfig = () => {
        if (disposed) return;
        // Unsubscribe previous Design dirty listener before clearing DOM
        _unsubDesignDirty?.();
        _unsubDesignDirty = null;
        customConfigContainer.empty();

        // ── Custom system header (mirrors built-in template preview header) ──
        const customSystemName = getActiveCustomName('Custom beats');
        const activeSourceKind = getActiveBeatWorkspaceKind();
        const starterActive = activeSourceKind === 'starter';
        const builtinActive = activeSourceKind === 'builtin';
        const activeId = getActiveCustomId();
        const savedSystems: SavedBeatSystem[] = plugin.settings.savedBeatSystems ?? [];
        const savedSetActive = activeSourceKind === 'saved' && savedSystems.some(s => s.id === activeId);
        const hasSetOrigin = starterActive || savedSetActive || builtinActive; // loaded from any set

        // Ensure baseline exists for whichever custom set is active (starter, saved, or default).
        if (!dirtyState.baselineId || dirtyState.baselineId !== getActiveDirtyKey()) {
            captureSetBaseline(getActiveDirtyKey());
        }

        const getCurrentDesignContext = () => {
            const activeTab = getActiveBeatWorkspaceTab();
            return {
                loadedTab: activeTab ?? null,
                systemName: activeTab?.name?.trim() || customSystemName,
            };
        };

        const headerRow = customConfigContainer.createDiv({ cls: ['ert-beat-template-preview', ERT_CLASSES.STACK] });
        const titleEl = headerRow.createDiv({ cls: 'ert-beat-template-title' });

        // Health status icon — mirrors Book card check pattern.
        // Starts neutral; updates after async beat-note lookup.
        const healthIcon = titleEl.createDiv({ cls: 'ert-beat-health-icon' });
        setIcon(healthIcon, 'circle-dashed');

        // Reference for dirty-state refresh
        let originTagEl: HTMLElement | null = null;

        if (starterActive || builtinActive) {
            titleEl.createSpan({ text: customSystemName, cls: 'ert-book-name' });
            originTagEl = titleEl.createSpan({
                text: builtinActive ? t('settings.beats.design.builtInTag') : t('settings.beats.design.starterTag'),
                cls: 'ert-set-origin-tag ert-set-origin-tag--starter'
            });
            setTooltip(originTagEl, builtinActive ? t('settings.beats.design.builtInTagTooltip') : t('settings.beats.design.starterTagTooltip'));
        } else {
            // User system: clickable to edit details
            const nameLink = titleEl.createSpan({
                text: customSystemName,
                cls: 'ert-book-name ert-book-name--clickable'
            });
            nameLink.setAttr('role', 'button');
            nameLink.setAttr('tabindex', '0');
            nameLink.setAttr('aria-label', `Edit "${customSystemName}"`);
            const openSystemEdit = () => openCustomSystemDetailsModal(activeId);
            nameLink.addEventListener('click', (e) => { e.stopPropagation(); openSystemEdit(); }); // SAFE: direct addEventListener; Settings lifecycle manages cleanup
            nameLink.addEventListener('keydown', (e: KeyboardEvent) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSystemEdit(); }
            });
            // Saved set: show origin tag (user-owned)
            if (savedSetActive) {
                originTagEl = titleEl.createSpan({ text: t('settings.beats.design.savedTag'), cls: 'ert-set-origin-tag ert-set-origin-tag--saved' });
                setTooltip(originTagEl, t('settings.beats.design.savedTagTooltip'));
            }
        }

        // ── Design guidance (keep concise; long boilerplate lives in Preview stage) ──
        headerRow.createDiv({
            cls: 'ert-beat-template-desc',
            text: t('settings.beats.design.guidance')
        });
        const actSet = new Set(getActiveCustomBeats().map(b => b.act));
        const beatCount = getActiveCustomBeats().length;
        const countSummary = beatCount > 0
            ? `${beatCount} beats · ${actSet.size} act${actSet.size !== 1 ? 's' : ''}`
            : '';
        const designContext = getCurrentDesignContext();
        const designManuscriptState = getManuscriptAdvisoryState(designContext.systemName, designContext.loadedTab);
        if (designManuscriptState) {
            const statusLine = headerRow.createDiv({
                cls: `ert-preview-status-line ert-preview-status-line--${designManuscriptState.tone} ert-beat-template-status`
            });
            appendPreviewStatus(statusLine, {
                ...designManuscriptState,
                text: countSummary.length > 0
                    ? `${countSummary} — ${designManuscriptState.text}`
                    : designManuscriptState.text,
            });
            const structuralStatus = getBeatStructuralStatus(designContext.systemName, { loadedTab: designContext.loadedTab });
            if (structuralStatus.summary.misalignedCount > 0) {
                const placementLine = headerRow.createDiv({
                    cls: 'ert-preview-status-line ert-preview-status-line--warning ert-beat-template-status'
                });
                appendPreviewStatus(placementLine, {
                    text: `${structuralStatus.summary.misalignedCount} beat${structuralStatus.summary.misalignedCount !== 1 ? 's are' : ' is'} placed in a different act in the manuscript.`,
                    tone: 'warning',
                    icon: 'circle-alert',
                });
            }
            if (structuralStatus.summary.outOfSequenceCount > 0) {
                const sequenceLine = headerRow.createDiv({
                    cls: 'ert-preview-status-line ert-preview-status-line--warning ert-beat-template-status'
                });
                appendPreviewStatus(sequenceLine, {
                    text: `${structuralStatus.summary.outOfSequenceCount} beat${structuralStatus.summary.outOfSequenceCount !== 1 ? 's are' : ' is'} out of manuscript sequence (filename prefix ordering does not match the template).`,
                    tone: 'warning',
                    icon: 'circle-alert',
                });
            }
        } else if (countSummary.length > 0) {
            headerRow.createDiv({
                cls: 'ert-beat-template-meta',
                text: countSummary,
            });
        }

        // Update health icon from current beat-note audit counters.
        // Called immediately and refreshed after structural mutations.
        const updateHealthIcon = () => {
            const { systemName, loadedTab } = getCurrentDesignContext();
            const state = getStructuralHealthState(systemName, loadedTab);
            healthIcon.className = `ert-beat-health-icon${state.statusClass ? ` ${state.statusClass}` : ''}`;
            setIcon(healthIcon, state.icon);
            setTooltip(healthIcon, state.tooltip);
        };
        updateHealthIcon();

        // Expose so updateTemplateButton can refresh the icon after async lookup
        refreshHealthIcon = updateHealthIcon;

        // ── Set dirty state subscription ─────────────────────────────
        // Subscribe to dirtyState so the Design header updates reactively.
        // The subscription is cleaned up at the top of renderCustomConfig()
        // before the container is emptied, preventing stale DOM references.
        if (hasSetOrigin) {
            // Tag DOM nodes so the subscriber can re-query them (defense against stale refs)
            healthIcon.dataset.dirtyTarget = 'health';
            if (originTagEl) originTagEl.dataset.dirtyTarget = 'origin';

            const updateDesignDirtyUI = () => {
                // Re-query from container to guarantee fresh DOM references
                const hIcon = customConfigContainer.querySelector<HTMLElement>('[data-dirty-target="health"]');
                const oTag = customConfigContainer.querySelector<HTMLElement>('[data-dirty-target="origin"]');
                if (!hIcon) return; // container was emptied — subscription will be cleaned up
                const dirty = isSetDirty();
                // Health icon: orange when dirty, restore audit-based state when clean
                if (dirty) {
                    hIcon.className = 'ert-beat-health-icon ert-beat-health-icon--modified';
                    setIcon(hIcon, 'circle-alert');
                    setTooltip(hIcon, 'Set has been modified since last save.');
                } else {
                    // Delegate to updateHealthIcon which handles all audit states
                    // (success/warning/critical/neutral) based on current counters.
                    updateHealthIcon();
                }
                // Origin tag: orange "Modified" when dirty, clean label when not
                if (oTag) {
                    const cleanLabel = builtinActive ? t('settings.beats.design.builtInTag') : (starterActive ? t('settings.beats.design.starterTag') : t('settings.beats.design.savedTag'));
                    const cleanTip = builtinActive
                        ? t('settings.beats.design.builtInTagTooltip')
                        : (starterActive ? t('settings.beats.design.starterTagTooltip') : t('settings.beats.design.savedTagTooltip'));
                    const dirtyTip = starterActive
                        ? t('settings.beats.design.starterDirtyTooltip')
                        : builtinActive
                            ? t('settings.beats.design.builtInDirtyTooltip')
                            : t('settings.beats.design.savedDirtyTooltip');
                    oTag.setText(dirty ? t('settings.beats.design.modifiedLabel') : cleanLabel);
                    oTag.classList.toggle('ert-set-origin-tag--modified', dirty);
                    oTag.classList.toggle('ert-set-origin-tag--starter', !dirty && starterActive);
                    oTag.classList.toggle('ert-set-origin-tag--saved', !dirty && !starterActive);
                    setTooltip(oTag, dirty ? dirtyTip : cleanTip);
                }
            };
            _unsubDesignDirty = dirtyState.subscribe(updateDesignDirtyUI);
            updateDesignDirtyUI(); // initial sync
        }

        // Beat List Editor (draggable rows with Name + Act)
        const beatWrapper = customConfigContainer.createDiv({ cls: 'ert-custom-beat-wrapper' });

        const listContainer = beatWrapper.createDiv({ cls: 'ert-custom-beat-list' });

        const saveBeats = async (beats: BeatRow[]) => {
            const maxActs = getActCount();
            const normalized = beats.map((beat) => ({
                ...beat,
                name: normalizeBeatNameInput(beat.name, ''),
                act: clampBeatAct(beat.act, maxActs),
            }));
            if (normalized.some(beat => !hasBeatReadableText(beat.name))) {
                new Notice(t('settings.beats.design.beatNamesNotice'));
                return;
            }
            setActiveCustomBeats(orderBeatsByAct(normalized, maxActs));
            invalidateBeatStructuralStatus();
            await plugin.saveSettings();
            updateTemplateButton(templateSetting, getActiveBeatWorkspaceName('Custom'));
            renderPreviewContent(getActiveBeatWorkspaceName('Custom'));
            // Re-render stage switcher after beat list changes
            renderStageSwitcher();
            dirtyState.notify();
        };

        const buildActLabels = (count: number, ranges?: Map<number, ActRange>): string[] => {
            const labels = parseActLabels(plugin.settings, count);
            return Array.from({ length: count }, (_, idx) => {
                const baseLabel = resolveActLabel(idx, labels);
                const range = ranges?.get(idx + 1);
                if (!range) return baseLabel;
                return `${baseLabel} (${formatRangeLabel(range)})`;
            });
        };

        let actRanges = new Map<number, ActRange>();
        let refreshBusy = false;
        let refreshQueued = false;

        const refreshCustomBeatsData = async (allowFetch: boolean) => {
            if (refreshBusy) {
                refreshQueued = true;
                return;
            }
            refreshBusy = true;
            const system = getActiveBeatWorkspaceName('Custom');
            const [ranges] = await Promise.all([
                collectActRanges(allowFetch)
            ]);
            if (ranges) {
                actRanges = ranges;
            }
            getBeatStructuralStatus(system, { refresh: allowFetch, loadedTab: getActiveBeatWorkspaceTab() ?? null });
            renderList();
            updateTemplateButton(templateSetting, getActiveBeatWorkspaceName(system));
            refreshBusy = false;
            if (refreshQueued) {
                refreshQueued = false;
                void refreshCustomBeatsData(allowFetch);
            }
        };

        const renderList = () => {
            listContainer.empty();
            const maxActs = getActCount();
            const actLabels = buildActLabels(maxActs, actRanges);
            const beats: BeatRow[] = getActiveCustomBeats()
                .map(parseBeatRow)
                .map(b => ({ ...b, act: clampBeatAct(b.act, maxActs) }));
            const designContext = getCurrentDesignContext();
            const structuralStatus = getBeatStructuralStatus(designContext.systemName, {
                loadedTab: designContext.loadedTab,
            });
            const isActiveInManuscript = structuralStatus.summary.matchedCount > 0;
            type DisplayBeatEntry = {
                beat: BeatRow;
                displayAct: number;
                status: BeatStructuralBeatStatus | null;
                displayOrdinal: number;
            };
            const beatsByAct: DisplayBeatEntry[][] = Array.from({ length: maxActs }, () => []);
            beats.forEach((beat, index) => {
                const key = normalizeBeatTitle(beat.name);
                const status = key ? getBeatStatusByKey(structuralStatus, key) : null;
                const displayAct = isActiveInManuscript && status
                    ? getPreviewPlacementActNumber(status, maxActs)
                    : clampBeatAct(beat.act, maxActs);
                beatsByAct[displayAct - 1].push({
                    beat,
                    displayAct,
                    status,
                    displayOrdinal: status?.expected.ordinal ?? (index + 1),
                });
            });
            beatsByAct.forEach((actBeatEntries) => {
                actBeatEntries.sort((a, b) => {
                    if (a.displayOrdinal !== b.displayOrdinal) return a.displayOrdinal - b.displayOrdinal;
                    if (a.beat.act !== b.beat.act) return a.beat.act - b.beat.act;
                    return a.beat.name.localeCompare(b.beat.name);
                });
            });
            const actStartIndex: number[] = [];
            let runningIndex = 0;
            beatsByAct.forEach((list, idx) => {
                actStartIndex[idx] = runningIndex;
                runningIndex += list.length;
            });
            const orderedEntries = beatsByAct.flat();
            const orderedBeats = orderedEntries.map((entry) => entry.beat);
            const beatNumbers = buildBeatDisplayPrefixes(orderedBeats, maxActs, actRanges);
            const titleMap = new Map<string, number[]>();
            orderedEntries.forEach((entry, idx) => {
                const key = normalizeBeatTitle(entry.beat.name);
                if (!key) return;
                const list = titleMap.get(key) ?? [];
                list.push(idx);
                titleMap.set(key, list);
            });
            const duplicateKeys = new Set(
                Array.from(titleMap.entries())
                    .filter(([, indices]) => indices.length > 1)
                    .map(([key]) => key)
            );

            let globalIndex = 0;
            for (let actIdx = 0; actIdx < maxActs; actIdx++) {
                const actNumber = actIdx + 1;
                const divider = listContainer.createDiv({ cls: 'ert-custom-beat-divider' });
                divider.createDiv({ cls: 'ert-custom-beat-divider-label', text: actLabels[actIdx] });

                const actBeats = beatsByAct[actIdx];
                if (actBeats.length === 0) {
                    const placeholder = listContainer.createDiv({ cls: ['ert-custom-beat-row', 'ert-custom-beat-placeholder'] });
                    placeholder.createDiv({ cls: ['ert-drag-handle', 'ert-drag-placeholder'] });
                    placeholder.createDiv({ cls: 'ert-beat-row-info ert-beat-row-info--empty' });
                    placeholder.createDiv({ cls: 'ert-beat-ordinal ert-beat-ordinal--empty', text: '' });
                    placeholder.createDiv({ cls: 'ert-beat-index ert-beat-add-index', text: '' });
                    placeholder.createDiv({ cls: 'ert-custom-beat-placeholder-text', text: `Drop beat into ${actLabels[actIdx]}` });

                    plugin.registerDomEvent(placeholder, 'dragover', (e) => {
                        e.preventDefault();
                        placeholder.addClass('is-dragover');
                    });
                    plugin.registerDomEvent(placeholder, 'dragleave', () => {
                        placeholder.removeClass('is-dragover');
                    });
                    plugin.registerDomEvent(placeholder, 'drop', (e: DragEvent) => {
                        e.preventDefault();
                        placeholder.removeClass('is-dragover');
                        const from = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
                        if (Number.isNaN(from) || from < 0 || from >= orderedBeats.length) return;
                        const updated = [...orderedBeats];
                        const [moved] = updated.splice(from, 1);
                        moved.act = actNumber;
                        const insertIndex = actStartIndex[actIdx] ?? updated.length;
                        updated.splice(insertIndex, 0, moved);
                        void saveBeats(updated);
                        renderList();
                    });
                    continue;
                }

                actBeats.forEach((entry) => {
                    const index = globalIndex;
                    globalIndex += 1;
                    const beatLine = entry.beat;
                    const dupKey = normalizeBeatTitle(beatLine.name);
                    const beatStatus = dupKey ? getBeatStatusByKey(structuralStatus, dupKey) : null;
                    const activeMatches = dupKey ? (structuralStatus.matches.activeByBeatKey.get(dupKey) ?? []) : [];
                    const matchedPrefix = activeMatches
                        .map((match) => extractPrefixToken(match.basename))
                        .find((token): token is string => !!token);
                    const row = listContainer.createDiv({ cls: 'ert-custom-beat-row' });
                    row.draggable = true;

                    // Drag handle
                    const handle = row.createDiv({ cls: 'ert-drag-handle' });
                    setIcon(handle, 'grip-vertical');
                    setTooltip(handle, t('settings.beats.design.dragTooltip'));

                    const rowInfo = row.createDiv({ cls: 'ert-beat-row-info' });

                    const expectedOrdinal = entry.status?.expected.ordinal ?? (index + 1);
                    row.createDiv({ text: `${expectedOrdinal}.`, cls: 'ert-beat-ordinal' });

                    // Index
                    const beatNumber = matchedPrefix
                        ?? beatNumbers[index]
                        ?? `0.${String(index + 1).padStart(2, '0')}`;
                    row.createDiv({ text: `${beatNumber}`, cls: 'ert-beat-index' });

                    // Parse "Name [Act]"
                    let name = beatLine.name;
                    let act = actNumber.toString();

                    // Name input
                    const nameInput = row.createEl('input', { type: 'text', cls: 'ert-beat-name-input ert-input' });
                    nameInput.value = name;
                    nameInput.placeholder = t('settings.beats.design.beatNamePlaceholder');
                    // Determine row state (mutually exclusive: new | synced | misaligned | out-of-sequence | duplicate)
                    let rowState: 'new' | 'synced' | 'misaligned' | 'out-of-sequence' | 'duplicate' = 'new';
                    const rowNotices: string[] = [];
                    const hasOutOfSequence = beatStatus?.issues.some((issue) => issue.code === 'out_of_sequence') ?? false;

                    // Duplicate title in settings list takes highest priority
                    if (dupKey && duplicateKeys.has(dupKey)) {
                        rowState = 'duplicate';
                        rowNotices.push('Duplicate beat title. Manually delete duplicate beat notes (or rename one title) to resolve.');
                    }

                    // Check for existing files
                    if (dupKey && activeMatches.length > 0) {
                        if (activeMatches.length > 1) {
                            rowState = 'duplicate';
                            rowNotices.push('Multiple beat notes match this title. Manually delete duplicate beat notes to resolve.');
                        } else if (rowState !== 'duplicate') {
                            const match = activeMatches[0];
                            const existingActRaw = typeof match.actNumber === 'number'
                                ? match.actNumber
                                : Number(act);
                            const existingAct = Number.isFinite(existingActRaw) ? existingActRaw : Number(act);
                            const expectedAct = beatStatus?.expected.actNumber
                                ? clampBeatAct(beatStatus.expected.actNumber, maxActs)
                                : clampBeatAct(beatLine.act, maxActs);
                            const actAligned = existingAct === expectedAct;

                            if (actAligned) {
                                rowState = 'synced';
                            } else {
                                rowState = 'misaligned';
                                rowNotices.push(`Placed in Act ${existingAct} in the manuscript. Template suggests ${actLabels[expectedAct - 1]}.`);
                            }
                        }
                    }
                    if (beatStatus && activeMatches.length === 0) {
                        const structuralNotice = beatStatus.issues
                            .filter((issue) => issue.code !== 'missing')
                            .map((issue) => issue.message)
                            .join(' • ');
                        if (structuralNotice) rowNotices.push(structuralNotice);
                    }

                    // Out-of-sequence layers on top of the base row state. Duplicate
                    // and misaligned keep higher priority for border color; plain
                    // 'synced' or 'new' rows are promoted so the warning band renders.
                    if (hasOutOfSequence && dupKey && activeMatches.length > 0) {
                        if (rowState === 'new' || rowState === 'synced') {
                            rowState = 'out-of-sequence';
                        }
                        const notice = buildOutOfSequenceNotice(dupKey, structuralStatus);
                        if (notice) rowNotices.push(notice);
                    }

                    if (rowState !== 'new') {
                        row.addClass(`ert-custom-beat-row--${rowState}`);
                    }
                    if (rowNotices.length > 0) {
                        setIcon(rowInfo, 'info');
                        rowInfo.addClass('ert-beat-row-info--notice');
                        setTooltip(rowInfo, rowNotices.join(' '));
                    } else {
                        rowInfo.addClass('ert-beat-row-info--empty');
                    }
                    plugin.registerDomEvent(nameInput, 'change', () => {
                        const newName = normalizeBeatNameInput(nameInput.value, '');
                        if (!newName || !hasBeatReadableText(newName)) {
                            new Notice(t('settings.beats.design.beatNameNotice'));
                            nameInput.value = name;
                            return;
                        }
                        nameInput.value = newName;
                        const updated = [...orderedBeats];
                        updated[index] = { ...orderedBeats[index], name: newName, act: parseInt(act, 10) || 1 };
                        void saveBeats(updated);
                        renderList();
                    });

                    // Range input
                    const rangeInput = row.createEl('input', { type: 'text', cls: 'ert-beat-range-input ert-input' });
                    rangeInput.value = beatLine.range ?? '';
                    rangeInput.placeholder = 'e.g. 10-20';
                    setTooltip(rangeInput, t('settings.beats.design.rangeTooltip'));
                    plugin.registerDomEvent(rangeInput, 'change', () => {
                        const rangeVal = rangeInput.value.trim();
                        const updated = [...orderedBeats];
                        updated[index] = { ...orderedBeats[index], range: rangeVal || undefined };
                        void saveBeats(updated);
                    });

                    // Act select
                    const actSelect = row.createEl('select', { cls: 'ert-beat-act-select ert-input' });
                    Array.from({ length: maxActs }, (_, i) => i + 1).forEach(n => {
                        const opt = actSelect.createEl('option', { value: n.toString(), text: actLabels[n - 1] });
                        if (act === n.toString()) opt.selected = true;
                    });
                    plugin.registerDomEvent(actSelect, 'change', () => {
                        act = actSelect.value;
                        const updated = [...orderedBeats];
                        const currentName = normalizeBeatNameInput(nameInput.value, name);
                        if (!hasBeatReadableText(currentName)) {
                            new Notice(t('settings.beats.design.beatNameNotice'));
                            return;
                        }
                        const actNum = clampBeatAct(parseInt(act, 10) || 1, maxActs);
                        updated[index] = { ...orderedBeats[index], name: currentName, act: actNum };
                        void saveBeats(updated);
                        renderList();
                    });

                    // Delete button
                    const delBtn = row.createEl('button', { cls: 'ert-iconBtn' });
                    setIcon(delBtn, 'trash');
                    delBtn.onclick = () => {
                        const updated = [...orderedBeats];
                        updated.splice(index, 1);
                        void saveBeats(updated);
                        renderList();
                    };

                    // Drag and drop reorder
                    plugin.registerDomEvent(row, 'dragstart', (e: DragEvent) => {
                        e.dataTransfer?.setData('text/plain', index.toString());
                        row.classList.add('is-dragging');
                    });
                    plugin.registerDomEvent(row, 'dragend', () => {
                        row.classList.remove('is-dragging');
                    });
                    plugin.registerDomEvent(row, 'dragover', (e) => {
                        e.preventDefault();
                    });
                    plugin.registerDomEvent(row, 'drop', (e: DragEvent) => {
                        e.preventDefault();
                        const from = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
                        if (Number.isNaN(from) || from === index || from < 0) return;
                        const updated = [...orderedBeats];
                        const [moved] = updated.splice(from, 1);
                        moved.act = actNumber;
                        updated.splice(index, 0, moved);
                        void saveBeats(updated);
                        renderList();
                    });

                });
            }

            // Add row at bottom (single line, matches advanced YAML add row)
            const defaultAct = orderedBeats.length > 0 ? clampBeatAct(orderedBeats[orderedBeats.length - 1].act, maxActs) : 1;
            const addRow = listContainer.createDiv({ cls: 'ert-custom-beat-row ert-custom-beat-add-row' });

            addRow.createDiv({ cls: ['ert-drag-handle', 'ert-drag-placeholder'] });
            addRow.createDiv({ cls: 'ert-beat-row-info ert-beat-row-info--empty' });
            addRow.createDiv({ cls: 'ert-beat-ordinal ert-beat-ordinal--empty', text: '' });
            addRow.createDiv({ cls: 'ert-beat-index ert-beat-add-index', text: '' });

            const addNameInput = addRow.createEl('input', { type: 'text', cls: 'ert-beat-name-input ert-input', placeholder: t('settings.beats.design.newBeatPlaceholder') });
            const addRangeInput = addRow.createEl('input', { type: 'text', cls: 'ert-beat-range-input ert-input', placeholder: 'e.g. 10-20' });
            setTooltip(addRangeInput, t('settings.beats.design.rangeTooltip'));
            const addActSelect = addRow.createEl('select', { cls: 'ert-beat-act-select ert-input' });
            Array.from({ length: maxActs }, (_, i) => i + 1).forEach(n => {
                const opt = addActSelect.createEl('option', { value: n.toString(), text: actLabels[n - 1] });
                if (defaultAct === n) opt.selected = true;
            });

            const addBtn = addRow.createEl('button', { cls: ['ert-iconBtn', 'ert-beat-add-btn'], attr: { 'aria-label': t('settings.beats.design.addBeatAriaLabel') } });
            setIcon(addBtn, 'plus');

            const commitAdd = () => {
                const name = normalizeBeatNameInput(addNameInput.value || 'New Beat', 'New Beat');
                if (!hasBeatReadableText(name)) {
                    new Notice(t('settings.beats.design.beatNameNotice'));
                    return;
                }
                const act = clampBeatAct(parseInt(addActSelect.value, 10) || defaultAct || 1, maxActs);
                const id = `custom:${getActiveDirtyKey()}:${generateBeatGuid()}`;
                const rangeVal = addRangeInput.value.trim() || undefined;
                const updated = [...orderedBeats, {
                    name,
                    act,
                    id,
                    range: rangeVal,
                }];
                void saveBeats(updated);
                renderList();
            };

            addBtn.onclick = commitAdd;
            plugin.registerDomEvent(addNameInput, 'keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitAdd();
                }
            });
        };

        refreshCustomBeatList = renderList;
        renderList();
        refreshCustomBeats = (allowFetch: boolean) => { void refreshCustomBeatsData(allowFetch); };
        void refreshCustomBeatsData(true);
    };
    renderCustomConfig();

    // IntersectionObserver for lazy-refresh of custom beats when visible
    if (typeof IntersectionObserver !== 'undefined') {
        customBeatsObserver = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                refreshCustomBeats?.(true);
            }
        }, { threshold: 0.05 });
        customBeatsObserver.observe(customConfigContainer);
    }
    // --------------------------------------------------------

    const getBeatSystemCopy = (system: string) => {
        return BEAT_SYSTEM_COPY[system] ?? {
            title: system,
            description: 'Select a beat system to configure set notes and story beat behavior.'
        };
    };

    const inferActForIndex = (index: number, total: number): number => {
        if (total <= 0) return 1;
        const position = index / total;
        if (position < 0.33) return 1;
        if (position < 0.67) return 2;
        return 3;
    };

    const buildTemplateActColumns = (system: string): { columns: ActGridColumn[]; totalBeats: number } => {
        const template = getPlotSystem(system);
        if (!template) return { columns: [], totalBeats: 0 };

        const beats = template.beats ?? [];
        const details = template.beatDetails ?? [];
        const grouped = new Map<string, ActGridColumn>();
        const other: string[] = [];
        const total = beats.length;

        beats.forEach((beatName, index) => {
            const detail = details[index] as { act?: unknown } | undefined;
            const rawAct = detail?.act;
            const cleanedBeat = stripActPrefix(beatName);

            if (typeof rawAct === 'number' && Number.isFinite(rawAct)) {
                const actNum = Math.max(1, Math.round(rawAct));
                const key = `act:${actNum}`;
                if (!grouped.has(key)) {
                    grouped.set(key, { label: `Act ${actNum}`, beats: [], rank: actNum, isNumericAct: true });
                }
                grouped.get(key)!.beats.push({ name: cleanedBeat, key: normalizeBeatTitle(beatName) });
                return;
            }

            if (typeof rawAct === 'string' && rawAct.trim()) {
                const trimmed = rawAct.trim();
                const parsedAct = Number(trimmed);
                if (Number.isFinite(parsedAct) && parsedAct > 0) {
                    const actNum = Math.round(parsedAct);
                    const key = `act:${actNum}`;
                    if (!grouped.has(key)) {
                        grouped.set(key, { label: `Act ${actNum}`, beats: [], rank: actNum, isNumericAct: true });
                    }
                    grouped.get(key)!.beats.push({ name: cleanedBeat, key: normalizeBeatTitle(beatName) });
                } else {
                    const key = `label:${trimmed.toLowerCase()}`;
                    if (!grouped.has(key)) {
                        grouped.set(key, { label: trimmed, beats: [], rank: Number.MAX_SAFE_INTEGER - 1, isNumericAct: false });
                    }
                    grouped.get(key)!.beats.push({ name: cleanedBeat, key: normalizeBeatTitle(beatName) });
                }
                return;
            }

            if (rawAct === undefined || rawAct === null || rawAct === '') {
                const inferred = inferActForIndex(index, total);
                const key = `act:${inferred}`;
                if (!grouped.has(key)) {
                    grouped.set(key, { label: `Act ${inferred}`, beats: [], rank: inferred, isNumericAct: true });
                }
                grouped.get(key)!.beats.push({ name: cleanedBeat, key: normalizeBeatTitle(beatName) });
                return;
            }

            other.push(cleanedBeat);
        });

        const columns = Array.from(grouped.values()).sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.label.localeCompare(b.label);
        });

        if (other.length > 0) {
            columns.push({
                label: 'Other',
                beats: other.map((beat) => ({ name: beat, key: normalizeBeatTitle(beat) })),
                rank: Number.MAX_SAFE_INTEGER,
                isNumericAct: false
            });
        }

        return { columns, totalBeats: total };
    };

    const buildCustomActColumns = () => buildBeatActColumns(getActiveCustomBeats(), getActCount());
    const buildLoadedTabActColumns = (loadedTab: LoadedBeatTab | null | undefined) =>
        buildBeatActColumns(loadedTab?.beats ?? getActiveCustomBeats(), getActCount());

    const getBeatPreviewState = (
        status: BeatStructuralBeatStatus | null
    ): { text: string; tone: PreviewStatusTone; icon: 'check' | 'circle-alert' | null } => {
        if (!status) {
            return { text: 'Checking…', tone: 'muted', icon: null };
        }
        const issueKind = getPreviewIssueKind(status);
        if (issueKind === 'missing') {
            return { text: 'Missing', tone: 'warning', icon: 'circle-alert' };
        }
        if (issueKind === 'incomplete') {
            return { text: 'Incomplete', tone: 'warning', icon: 'circle-alert' };
        }
        return { text: '', tone: 'success', icon: 'check' };
    };

    const renderPreviewContent = (system: string, _options?: { skipStatusRefresh?: boolean }, loadedTab?: LoadedBeatTab | null) => {
        const activeTab = loadedTab ?? getActiveBeatWorkspaceTab();
        const isBuiltinSystem = !!getPlotSystem(system);
        let columns: ActGridColumn[];
        let totalBeats: number;

        if (activeTab) {
            const result = buildLoadedTabActColumns(activeTab);
            columns = result.columns;
            totalBeats = result.totalBeats;
        } else if (isBuiltinSystem) {
            const result = buildTemplateActColumns(system);
            columns = result.columns;
            totalBeats = result.totalBeats;
        } else {
            const result = buildCustomActColumns();
            columns = result.columns;
            totalBeats = result.totalBeats;
        }

        const structuralStatus = totalBeats > 0 ? getBeatStructuralStatus(system, { loadedTab: activeTab ?? null }) : null;
        const beatStatusByKey = new Map<string, BeatStructuralBeatStatus>(
            (structuralStatus?.beats ?? []).map((beat) => [beat.expected.key, beat])
        );
        const isActiveInManuscript = !!structuralStatus && structuralStatus.summary.matchedCount > 0;
        if (isActiveInManuscript) {
            const maxActs = getActCount();
            const actLabels = parseActLabels(plugin.settings, maxActs);
            const grouped = new Map<number, ActGridColumn>();
            structuralStatus.beats.forEach((beat) => {
                const actNumber = getPreviewPlacementActNumber(beat, maxActs);
                if (!grouped.has(actNumber)) {
                    grouped.set(actNumber, {
                        label: resolveActLabel(actNumber - 1, actLabels),
                        beats: [],
                        rank: actNumber,
                        isNumericAct: true,
                    });
                }
                grouped.get(actNumber)!.beats.push({
                    name: stripActPrefix(beat.expected.name),
                    key: beat.expected.key,
                });
            });
            columns = Array.from(grouped.values())
                .sort((a, b) => a.rank - b.rank)
                .map((column) => ({
                    ...column,
                    beats: [...column.beats].sort((a, b) => {
                        const left = beatStatusByKey.get(a.key)?.expected.ordinal ?? 0;
                        const right = beatStatusByKey.get(b.key)?.expected.ordinal ?? 0;
                        return left - right;
                    }),
                }));
        }
        templatePreviewStatus.empty();
        templatePreviewStatus.className = 'ert-beat-template-meta ert-preview-status-line';
        templatePreviewIssues.empty();
        templatePreviewIssues.addClass('ert-settings-hidden');
        const manuscriptState = getManuscriptAdvisoryState(system, activeTab ?? null);
        if (manuscriptState) {
            templatePreviewStatus.addClass(`ert-preview-status-line--${manuscriptState.tone}`);
            appendPreviewStatus(templatePreviewStatus, manuscriptState);
        } else {
            templatePreviewStatus.removeClass(
                'ert-preview-status-line--success',
                'ert-preview-status-line--warning',
                'ert-preview-status-line--muted'
            );
        }
        templatePreviewStatus.toggleClass('ert-settings-hidden', !manuscriptState);

        templateActGrid.empty();
        if (columns.length === 0) {
            templateActGrid.createDiv({
                cls: 'ert-beat-act-empty',
                text: (activeTab?.sourceKind === 'builtin' || (!activeTab && isBuiltinSystem))
                    ? 'No beats found for this set.'
                    : 'No beats yet. Go to Design to add them.'
            });
            return;
        }

        let runningBeatIdx = 0;
        columns.forEach((column) => {
            const colEl = templateActGrid.createDiv({ cls: 'ert-beat-act-column' });
            const count = column.beats.length;
            const columnIssueCount = column.beats.reduce((totalIssues, beat) => {
                const status = beatStatusByKey.get(beat.key) ?? null;
                if (!status || !getPreviewIssueKind(status)) return totalIssues;
                return totalIssues + 1;
            }, 0);
            const header = colEl.createDiv({ cls: 'ert-beat-act-header' });
            if (!isActiveInManuscript) {
                header.createSpan({
                    text: column.isNumericAct
                        ? `${column.label} (${count})`
                        : `${column.label}${count > 0 ? ` (${count})` : ''}`
                });
            } else {
                header.createSpan({
                    text: column.isNumericAct
                        ? `${column.label} (${count}) — `
                        : `${column.label}${count > 0 ? ` (${count})` : ''} — `
                });
                appendPreviewStatus(
                    header,
                    columnIssueCount === 0
                        ? { text: 'Complete', tone: 'success', icon: 'check' }
                        : { text: `${columnIssueCount} issue${columnIssueCount !== 1 ? 's' : ''}`, tone: 'warning', icon: 'circle-alert' },
                    'ert-preview-status--compact'
                );
            }
            const listEl = colEl.createDiv({ cls: 'ert-beat-act-list' });
            column.beats.forEach((beat) => {
                const status = beatStatusByKey.get(beat.key) ?? null;
                const state = getBeatPreviewState(status);
                const rowTone = isActiveInManuscript ? state.tone : 'muted';
                const row = listEl.createDiv({ cls: `ert-beat-act-item ert-beat-act-item--${rowTone}` });
                const ordinal = status?.expected.ordinal ?? (++runningBeatIdx);
                // Beat rows show status as an icon (and optional text). An em-dash
                // before a lone icon reads as a dangling connector, so only a space
                // separates the name from the status here. Act headers still use
                // " — " because their status always includes a text label.
                row.createSpan({ text: isActiveInManuscript ? `${ordinal}. ${beat.name} ` : `${ordinal}. ${beat.name}` });
                if (isActiveInManuscript) {
                    appendPreviewStatus(row, state, 'ert-preview-status--compact');
                }
                if (isActiveInManuscript && hasPreviewTemplateActMismatch(status)) {
                    const hintEl = row.createSpan({ cls: 'ert-beat-act-template-hint' });
                    setIcon(hintEl, 'circle-alert');
                    setTooltip(hintEl, `Template suggests ${status?.expected.actLabel ?? `Act ${status?.expected.actNumber ?? 1}`}`);
                }
            });
        });
    };

    // Keep action controls in a stable container so stage toggles do not leak stale button state.
    const designActionsContainer = beatSystemCard.createDiv();
    let createTemplatesButton: ButtonComponent | undefined;
    let repairBeatNotesButton: ButtonComponent | undefined;
    let refreshBeatAuditPrimaryAction: (() => void) | null = null;
    let resetBeatAuditPanel: (() => void) | null = null;
    let primaryDesignAction: (() => Promise<void>) = async () => { await createBeatTemplates(); };
    const saveCurrentCustomSet = async (context: 'design' | 'fields' | 'generic' = 'generic'): Promise<void> => {
        const activeWorkspaceTab = getActiveBeatWorkspaceTab();
        if (!activeWorkspaceTab || activeWorkspaceTab.sourceKind === 'builtin') return;
        const activeId = getActiveCustomId();

        // Regular Save never prompts rename/save-as.
        // If active set is a saved set, update that set in place.
        const activeConfig = getBeatConfigForSystem(plugin.settings);
        const currentName = getActiveCustomName('Custom');
        const currentDescription = getActiveCustomDescription();
        const currentBeats = getActiveCustomBeats()
            .map(b => ({
                ...b,
                name: normalizeBeatNameInput(b.name, ''),
                purpose: typeof (b as { purpose?: unknown }).purpose === 'string'
                    ? String((b as { purpose?: unknown }).purpose).trim()
                    : undefined,
            }))
            .filter(b => hasBeatReadableText(b.name));

        const savedSystems = plugin.settings.savedBeatSystems ?? [];
        const existingIdx = activeId ? savedSystems.findIndex(s => s.id === activeId) : -1;
        if (existingIdx >= 0 && activeId) {
            savedSystems[existingIdx] = {
                ...savedSystems[existingIdx],
                name: currentName,
                description: currentDescription,
                beats: currentBeats,
            };
            plugin.settings.savedBeatSystems = savedSystems;
            if (!plugin.settings.beatSystemConfigs) plugin.settings.beatSystemConfigs = {};
            plugin.settings.beatSystemConfigs[getCustomBeatConfigKey(activeId)] = {
                beatYamlAdvanced: activeConfig.beatYamlAdvanced,
                beatHoverMetadataFields: activeConfig.beatHoverMetadataFields.map(f => ({ ...f })),
            };
        }

        await plugin.saveSettings();
        captureSetBaseline(getActiveDirtyKey());
        dirtyState.notify();
        renderBeatSystemTabs();
        renderPreviewContent(getActiveBeatWorkspaceName('Custom'));
        updateTemplateButton(templateSetting, getActiveBeatWorkspaceName('Custom'));
        refreshBeatAuditPrimaryAction?.();
        if (context === 'fields') {
            new Notice(t('settings.beats.design.setSavedNotice'));
        }
    };

    const templateSetting = new Settings(designActionsContainer)
        .setName(t('settings.beats.beatNotes.name'))
        .setDesc(t('settings.beats.beatNotes.desc'))
        .addButton(button => {
            createTemplatesButton = button;
            button
                .setButtonText(t('settings.beats.beatNotes.createText'))
                .setTooltip(t('settings.beats.beatNotes.createTooltip'))
                .onClick(() => { void primaryDesignAction(); });
        })
        .addButton(button => {
            repairBeatNotesButton = button;
            button
                .setButtonText(t('settings.beats.beatNotes.repairText'))
                .setTooltip(t('settings.beats.beatNotes.repairTooltip'))
                .onClick(async () => {
                    await mergeExistingBeatNotes();
                });
        })

    updateTemplateButton(templateSetting, getActiveBeatWorkspaceName('Custom'));

    // Stage 3: Fields (YAML editor, hover metadata, schema audit)
    const fieldsContainer = beatSystemCard.createDiv({ cls: ERT_CLASSES.STACK });
    // Library/Add system surface
    const setsContainer = beatSystemCard.createDiv({ cls: ERT_CLASSES.STACK });

    // ── Stage switcher rendering + visibility ───────────────────────────
    const renderStageSwitcher = () => {
        stageSwitcher.empty();
        const hasActiveTab = !!getActiveBeatWorkspaceTab();
        const libraryMode = isBeatLibraryMode();
        stageSwitcher.toggleClass('ert-settings-hidden', libraryMode);
        if (libraryMode) return;

        // Helper: create a numbered stage button
        const makeStageBtn = (
            id: InnerStage,
            stepNum: number,
            label: string,
            disabled = false
        ): HTMLButtonElement => {
            const btn = stageSwitcher.createEl('button', {
                cls: `ert-stage-btn${_currentInnerStage === id ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`,
                attr: {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': _currentInnerStage === id ? 'true' : 'false',
                    ...(disabled ? { disabled: 'true' } : {})
                }
            });
            btn.createSpan({ cls: 'ert-stage-btn-step', text: `${stepNum}.` });
            btn.appendText(` ${label}`);
            if (!disabled) {
                btn.addEventListener('click', () => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                    if (_currentInnerStage === id) return;
                    _currentInnerStage = id;
                    renderStageSwitcher();
                    updateStageVisibility();
                });
            }
            return btn;
        };

        // Stage 1: Preview (acts + beats overview)
        makeStageBtn('preview', 1, t('settings.beats.stages.preview'), !hasActiveTab);

        // Stage 2: Design (beat list editor + beat notes in vault)
        makeStageBtn('design', 2, t('settings.beats.stages.design'), !hasActiveTab);

        // Stage 3: Fields (YAML editor, hover metadata, schema audit)
        makeStageBtn('fields', 3, t('settings.beats.stages.fields'), !hasActiveTab);
    };

    /**
     * Shows/hides stage panels based on _currentInnerStage.
     * Preview/Design/Fields visible for all systems; Sets only for Custom.
     */
    const updateStageVisibility = () => {
        const hasActiveTab = !!getActiveBeatWorkspaceTab();
        const libraryMode = isBeatLibraryMode();

        tierBannerEl.toggleClass('ert-settings-hidden', libraryMode);
        stageSwitcher.toggleClass('ert-settings-hidden', libraryMode);

        // Preview: acts + beats overview (templatePreviewContainer for both; custom uses same structure)
        templatePreviewContainer.toggleClass('ert-settings-hidden', libraryMode || !hasActiveTab || _currentInnerStage !== 'preview');

        customConfigContainer.toggleClass('ert-settings-hidden', libraryMode || !hasActiveTab || _currentInnerStage !== 'design');
        designActionsContainer.toggleClass('ert-settings-hidden', libraryMode || !hasActiveTab || _currentInnerStage !== 'design');

        // Fields: YAML editor, hover metadata, schema audit
        fieldsContainer.toggleClass('ert-settings-hidden', libraryMode || !hasActiveTab || _currentInnerStage !== 'fields');

        setsContainer.toggleClass('ert-settings-hidden', !libraryMode);

        if (!libraryMode && hasActiveTab && _currentInnerStage === 'design') {
            refreshCustomBeats?.(true);
        }
    };

    function updateTierBanner(system: string): void {
        tierBannerEl.empty();
        const activeTab = getActiveBeatWorkspaceTab();
        const overview = getSystemOverviewState(system, activeTab ?? null);
        tierBannerEl.createDiv({ cls: 'ert-beat-template-title', text: overview.title });
        if (overview.sourceLink) {
            const sourceRow = tierBannerEl.createDiv({ cls: 'ert-beat-template-source' });
            const sourceLink = sourceRow.createEl('a', {
                cls: 'ert-beat-template-source-link',
                href: overview.sourceLink.href,
                attr: {
                    target: '_blank',
                    rel: 'noopener'
                }
            });
            sourceLink.createSpan({ text: overview.sourceLink.label });
            const sourceIcon = sourceLink.createSpan({ cls: 'ert-beat-template-source-link-icon' });
            setIcon(sourceIcon, 'external-link');
        }
        renderSystemDescription(tierBannerEl, overview);
    }

    const updateBeatSystemCard = (system: string, options?: { resetStage?: boolean }) => {
        const activeTab = getActiveBeatWorkspaceTab();
        beatSystemCard.toggleClass('ert-beat-system-card--custom', (activeTab?.sourceKind ?? 'blank') !== 'builtin');
        updateTierBanner(system);
        renderPreviewContent(system, undefined, activeTab ?? null);
        renderCustomConfig();
        renderBeatYamlEditor();
        updateBeatHoverPreview?.();
        if (options?.resetStage !== false) {
            _currentInnerStage = 'preview';
        }
        renderStageSwitcher();
        updateStageVisibility();
    };

    const closeBeatTab = async (targetTab: LoadedBeatTab): Promise<void> => {
        const nextActiveTabId = unloadBeatTab(plugin.settings, targetTab.tabId);
        if (!nextActiveTabId) {
            _currentInnerStage = 'library';
        }
        await plugin.saveSettings();
        invalidateBeatStructuralStatus();
        resetBeatAuditPanel?.();
        renderCustomConfig();
        const nextActiveTab = getActiveBeatWorkspaceTab();
        if (nextActiveTab) {
            renderPreviewContent(nextActiveTab.name);
            updateTemplateButton(templateSetting, nextActiveTab.name);
            updateBeatSystemCard(nextActiveTab.name, { resetStage: false });
        }
        renderBeatYamlEditor();
        updateBeatHoverPreview?.();
        renderSavedBeatSystems();
        renderBeatSystemTabs();
        renderStageSwitcher();
        updateStageVisibility();
        plugin.onSettingChanged(IMPACT_FULL);
    };

    /** Close a tab. If beat notes exist, confirms deletion first via modal. */
    const closeAndDeleteBeatTab = async (targetTab: LoadedBeatTab): Promise<void> => {
        if (!targetTab) {
            new Notice(t('settings.beats.design.noActiveSystemNotice'));
            return;
        }

        const noteFiles = getBeatNoteFilesForLoadedTab(targetTab);

        if (noteFiles.length > 0) {
            const confirmed = await openDeleteBeatNotesModal({
                title: targetTab.name,
                noteFiles,
                actionLabel: 'Delete beat notes',
                systemTag: targetTab.name,
            });
            if (!confirmed) return;

            const result = await trashBeatNoteFiles(noteFiles);
            if (result.failed > 0) {
                console.error('[Beat Sets] Failed to trash beat notes:', result.errors);
            }
            await closeBeatTab(targetTab);
            const parts: string[] = [];
            if (result.trashed > 0) parts.push(`Moved ${result.trashed} beat note${result.trashed !== 1 ? 's' : ''} to trash.`);
            if (result.failed > 0) parts.push(`${result.failed} failed.`);
            parts.push(`"${targetTab.name}" removed.`);
            new Notice(parts.join(' '));
        } else {
            await closeBeatTab(targetTab);
        }
    };

    function renderBeatSystemTabs(): void {
        if (disposed) return;
        _disconnectBeatTabsResizeObserver?.();
        _disconnectBeatTabsResizeObserver = null;
        beatSystemTabs.empty();
        const loadedTabs = getLoadedBeatWorkspaceTabs();
        const activeTabId = getActiveBeatWorkspaceTabId();
        const libraryMode = isBeatLibraryMode();
        const tabBtnByIndex: HTMLButtonElement[] = [];

        const activateBeatTab = async (tab: LoadedBeatTab) => {
            if (getLoadedBeatTabs(plugin.settings).some((loadedTab) => loadedTab.tabId === tab.tabId)) {
                activateLoadedBeatTab(plugin.settings, tab.tabId);
            } else {
                materializeBeatTab(plugin.settings, tab);
            }
            _currentInnerStage = 'preview';
            await plugin.saveSettings();
            plugin.onSettingChanged(IMPACT_FULL); // Tier 3: beat system change rebuilds timeline beats
            invalidateBeatStructuralStatus();
            resetBeatAuditPanel?.();
            updateTemplateButton(templateSetting, getActiveBeatWorkspaceName('Custom'));
            updateBeatSystemCard(tab.name);
            renderBeatSystemTabs();
        };

        loadedTabs.forEach((tab) => {
            const isActive = !libraryMode && tab.tabId === activeTabId;
            const status = getBeatSystemTabStatus(tab);
            const btn = beatSystemTabs.createEl('button', {
                cls: `ert-mini-tab${tab.sourceKind !== 'builtin' ? ' ert-mini-tab--custom' : ''}${isActive ? ` ${ERT_CLASSES.IS_ACTIVE}` : ''}`,
                attr: {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': isActive ? 'true' : 'false',
                    'aria-controls': 'ert-beat-system-panel'
                }
            });
            const iconClass = `ert-mini-tab-icon ert-beat-health-icon${status.statusClass ? ` ${status.statusClass}` : ''}`;
            const iconEl = btn.createSpan({ cls: iconClass });
            setIcon(iconEl, status.icon);
            setTooltip(iconEl, status.tooltip);
            btn.createSpan({ cls: 'ert-mini-tab-label', text: tab.name });
            tabBtnByIndex.push(btn);
            const closeEl = btn.createSpan({ cls: 'ert-mini-tab-close', attr: { role: 'button', 'aria-label': `Remove ${tab.name}` } });
            setIcon(closeEl, 'x');
            setTooltip(closeEl, `Remove "${tab.name}"`);
            closeEl.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                void closeAndDeleteBeatTab(tab);
            });

            btn.addEventListener('click', () => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
                if (isActive) return;
                void activateBeatTab(tab);
            });
        });

        // Overflow chip ("+N") — inserted between the loaded tabs and "+ Add system".
        // Opens a Menu listing tabs that didn't fit; updated by recomputeOverflow().
        const overflowBtn = beatSystemTabs.createEl('button', {
            cls: 'ert-mini-tab ert-mini-tab--custom ert-mini-tab--overflow',
            attr: { type: 'button', 'aria-label': 'More beat systems', 'aria-haspopup': 'menu' }
        });
        const overflowLabel = overflowBtn.createSpan({ cls: 'ert-mini-tab-label', text: '+0' });
        overflowBtn.classList.add('ert-settings-hidden');
        let hiddenTabs: LoadedBeatTab[] = [];
        overflowBtn.addEventListener('click', (event) => { // SAFE: direct addEventListener; Settings lifecycle manages cleanup
            const menu = new Menu();
            hiddenTabs.forEach((tab) => {
                menu.addItem((item) => {
                    item.setTitle(tab.name);
                    item.onClick(() => void activateBeatTab(tab));
                });
            });
            menu.showAtMouseEvent(event);
        });

        const addBtn = beatSystemTabs.createEl('button', {
            cls: `ert-mini-tab ert-mini-tab--custom${libraryMode ? ` ${ERT_CLASSES.IS_ACTIVE}` : ''}`,
            attr: {
                type: 'button',
                role: 'tab',
                'aria-selected': libraryMode ? 'true' : 'false',
                'aria-label': 'Add system'
            }
        });
        const addIcon = addBtn.createSpan({ cls: 'ert-mini-tab-icon ert-beat-health-icon' });
        setIcon(addIcon, 'plus');
        addBtn.appendText(t('settings.beats.library.addSystemLabel'));
        addBtn.addEventListener('click', () => {
            _currentInnerStage = 'library';
            renderBeatSystemTabs();
            renderStageSwitcher();
            updateStageVisibility();
        });

        const recomputeOverflow = () => {
            tabBtnByIndex.forEach((btn) => { btn.classList.remove('ert-settings-hidden'); });
            overflowBtn.classList.add('ert-settings-hidden');
            hiddenTabs = [];
            if (!beatSystemTabs.isConnected) return;
            const fits = () => beatSystemTabs.scrollWidth <= beatSystemTabs.clientWidth;
            if (fits()) return;
            overflowBtn.classList.remove('ert-settings-hidden');
            const hiddenIndices: number[] = [];
            for (let i = tabBtnByIndex.length - 1; i >= 0; i--) {
                const btn = tabBtnByIndex[i];
                if (btn.classList.contains(ERT_CLASSES.IS_ACTIVE)) continue;
                btn.classList.add('ert-settings-hidden');
                hiddenIndices.push(i);
                if (fits()) break;
            }
            // Preserve original tab order in the menu (we walked the row end-to-start).
            hiddenTabs = hiddenIndices.slice().reverse().map((i) => loadedTabs[i]).filter(Boolean);
            overflowLabel.setText(`+${hiddenTabs.length}`);
            setTooltip(overflowBtn, `${hiddenTabs.length} more ${hiddenTabs.length === 1 ? 'system' : 'systems'}`);
        };

        const frameId = window.requestAnimationFrame(() => recomputeOverflow());
        const ro = new ResizeObserver(() => recomputeOverflow());
        ro.observe(beatSystemTabs);
        _disconnectBeatTabsResizeObserver = () => {
            window.cancelAnimationFrame(frameId);
            ro.disconnect();
        };
    }

    // ─── BEAT YAML EDITOR — always visible in Fields stage ─────────────
    const beatYamlSection = fieldsContainer.createDiv({ cls: ERT_CLASSES.STACK });
    new Settings(beatYamlSection)
        .setName(t('settings.beats.beatFields.name'))
        .setDesc(t('settings.beats.beatFields.desc'));
    // Force editor enabled so Fields content is always visible
    plugin.settings.enableBeatYamlEditor = true;

    const beatYamlContainer = beatYamlSection.createDiv({ cls: ['ert-panel', 'ert-advanced-template-card'] });

    // ─── Beat-fields config helpers (all systems: built-in + custom) ────
    const getActiveSystemKey = (): string | undefined => getActiveBeatWorkspaceTab()?.name?.trim() || undefined;
    const getConfigForCurrentSystem = (): BeatSystemConfig =>
        getActiveBeatWorkspaceTab()?.config ?? getBeatConfigForSystem(plugin.settings, getActiveSystemKey());
    const updateConfigForCurrentSystem = (updater: (config: BeatSystemConfig) => void): BeatSystemConfig => {
        const activeTabId = getActiveBeatWorkspaceTabId();
        if (activeTabId) {
            let nextConfig = getConfigForCurrentSystem();
            updateLoadedBeatTab(plugin.settings, activeTabId, (tab) => {
                const workingConfig: BeatSystemConfig = {
                    beatYamlAdvanced: tab.config.beatYamlAdvanced,
                    beatHoverMetadataFields: tab.config.beatHoverMetadataFields.map((field) => ({ ...field })),
                };
                updater(workingConfig);
                nextConfig = workingConfig;
                return {
                    ...tab,
                    config: workingConfig,
                };
            });
            return nextConfig;
        }
        const fallbackConfig = getConfigForCurrentSystem();
        updater(fallbackConfig);
        return fallbackConfig;
    };

    // Beat hover metadata helpers (operate on active system's config slot)
    const refreshBeatHoverInViews = () => {
        const timelineViews = plugin.getTimelineViews();
        timelineViews.forEach(view => view.refreshTimeline());
    };

    const getBeatHoverMetadata = (key: string): HoverMetadataField | undefined => {
        return getConfigForCurrentSystem().beatHoverMetadataFields.find(f => f.key === key);
    };

    const setBeatHoverMetadata = (key: string, icon: string, enabled: boolean) => {
        updateConfigForCurrentSystem((config) => {
            const existing = config.beatHoverMetadataFields.find(f => f.key === key);
            if (existing) {
                existing.icon = icon;
                existing.enabled = enabled;
            } else {
                config.beatHoverMetadataFields.push({ key, label: key, icon, enabled });
            }
        });
        refreshBeatHoverInViews();
        void plugin.saveSettings();
        dirtyState.notify();
    };

    const removeBeatHoverMetadata = (key: string) => {
        updateConfigForCurrentSystem((config) => {
            config.beatHoverMetadataFields = config.beatHoverMetadataFields.filter(f => f.key !== key);
        });
        refreshBeatHoverInViews();
        void plugin.saveSettings();
        dirtyState.notify();
    };

    const renameBeatHoverMetadataKey = (oldKey: string, newKey: string) => {
        updateConfigForCurrentSystem((config) => {
            const existing = config.beatHoverMetadataFields.find(f => f.key === oldKey);
            if (existing) {
                existing.key = newKey;
            }
        });
        refreshBeatHoverInViews();
        void plugin.saveSettings();
    };

    let updateBeatHoverPreview: (() => void) | undefined;
    let refreshFillEmptyPlanAfterDefaultsChange: (() => void) | undefined;

    // Keys that are blocked from new beat writes (legacy or inapplicable).
    const beatDisallowedNewWriteKeys = new Set(['Description']);

    const renderBeatYamlEditor = () => {
        beatYamlContainer.empty();
        const activeBeatSystemKey = getActiveSystemKey();
        const beatCustomKeys = new Set(getCustomKeys('Beat', plugin.settings, activeBeatSystemKey));
        const beatBaseKeys = computeCanonicalOrder('Beat', plugin.settings, activeBeatSystemKey)
            .filter((key) => !beatCustomKeys.has(key));

        const currentBeatAdvanced = getConfigForCurrentSystem().beatYamlAdvanced;
        const beatAdvancedObj = safeParseYaml(currentBeatAdvanced);

        const beatOptionalOrder = extractKeysInOrder(currentBeatAdvanced).filter(
            k => !beatBaseKeys.includes(k)
        );
        const beatEntries = ensureSharedChapterFieldEntries(beatOptionalOrder.map(key => ({
            key,
            value: beatAdvancedObj[key] ?? '',
            required: false
        })));

        let beatWorkingEntries = beatEntries;
        let beatDragIndex: number | null = null;

        const saveBeatEntries = (nextEntries: FieldEntry[]) => {
            beatWorkingEntries = nextEntries;
            const yaml = buildYamlFromEntries(nextEntries);
            updateConfigForCurrentSystem((config) => {
                config.beatYamlAdvanced = yaml;
            });
            void plugin.saveSettings();
            dirtyState.notify();
            refreshFillEmptyPlanAfterDefaultsChange?.();
        };

        const rerenderBeatYaml = (next?: FieldEntry[]) => {
            const data = next ?? beatWorkingEntries;
            beatWorkingEntries = data;
            beatYamlContainer.empty();

            // Read-only base fields (collapsed summary)
            const baseCard = beatYamlContainer.createDiv({ cls: 'ert-template-base-summary' });
            baseCard.createDiv({ cls: 'ert-template-base-heading', text: t('settings.beats.beatFields.baseFieldsHeading') });
            const basePills = baseCard.createDiv({ cls: 'ert-template-base-pills' });
            beatBaseKeys.forEach(k => {
                basePills.createSpan({ cls: 'ert-template-base-pill', text: k });
            });

            // Editable advanced entries
            const listEl = beatYamlContainer.createDiv({ cls: ['ert-template-entries', 'ert-template-indent'] });

            if (data.length > 0) {
                listEl.createDiv({ cls: 'ert-template-section-label', text: t('settings.beats.beatFields.customFieldsHeading') });
            }

            const renderBeatEntryRow = (entry: FieldEntry, idx: number, list: FieldEntry[]) => {
                const row = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--hover-meta'] });

                const hoverMeta = getBeatHoverMetadata(entry.key);
                const currentIcon = hoverMeta?.icon ?? DEFAULT_HOVER_ICON;
                const currentEnabled = hoverMeta?.enabled ?? false;

                // Drag handle
                const dragHandle = row.createDiv({ cls: 'ert-drag-handle' });
                dragHandle.draggable = true;
                setIcon(dragHandle, 'grip-vertical');
                setTooltip(dragHandle, t('settings.beats.beatFields.dragTooltip'));

                row.createDiv({ cls: 'ert-grid-spacer' });

                // Icon input
                const iconWrapper = row.createDiv({ cls: 'ert-hover-icon-wrapper' });
                const iconPreview = iconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
                setIcon(iconPreview, currentIcon);
                const iconInput = iconWrapper.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md ert-icon-input',
                    attr: { placeholder: t('settings.beats.beatFields.iconPlaceholder') }
                });
                iconInput.value = currentIcon;
                setTooltip(iconInput, t('settings.beats.beatFields.iconTooltip'));

                // Hover checkbox
                const checkboxWrapper = row.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
                const checkbox = checkboxWrapper.createEl('input', {
                    type: 'checkbox',
                    cls: 'ert-hover-checkbox'
                });
                checkbox.checked = currentEnabled;
                setTooltip(checkbox, t('settings.beats.beatFields.hoverCheckboxTooltip'));

                new IconSuggest(app, iconInput, (selectedIcon) => {
                    iconInput.value = selectedIcon;
                    iconPreview.empty();
                    setIcon(iconPreview, selectedIcon);
                    setBeatHoverMetadata(entry.key, selectedIcon, checkbox.checked);
                    updateBeatHoverPreview?.();
                });

                iconInput.oninput = () => {
                    const iconName = iconInput.value.trim();
                    if (iconName && getIconIds().includes(iconName)) {
                        iconPreview.empty();
                        setIcon(iconPreview, iconName);
                        setBeatHoverMetadata(entry.key, iconName, checkbox.checked);
                        updateBeatHoverPreview?.();
                    }
                };

                checkbox.onchange = () => {
                    const iconName = iconInput.value.trim() || DEFAULT_HOVER_ICON;
                    setBeatHoverMetadata(entry.key, iconName, checkbox.checked);
                    updateBeatHoverPreview?.();
                };

                // Key input
                const keyInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                keyInput.value = entry.key;
                keyInput.placeholder = t('settings.beats.beatFields.keyPlaceholder');
                keyInput.onchange = () => {
                    const newKey = normalizeBeatFieldKeyInput(keyInput.value);
                    if (!newKey || !hasBeatReadableText(newKey)) {
                        keyInput.value = entry.key;
                        new Notice(t('settings.beats.beatFields.keyRequiredNotice'));
                        return;
                    }
                    keyInput.value = newKey;
                    if (beatBaseKeys.includes(newKey)) {
                        new Notice(`"${newKey}" ${t('settings.beats.beatFields.baseFieldNotice')}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    if (beatDisallowedNewWriteKeys.has(newKey)) {
                        new Notice(`"${newKey}" ${t('settings.beats.beatFields.legacyKeyNotice')}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    if (list.some((e, i) => i !== idx && e.key === newKey)) {
                        new Notice(`${t('settings.beats.beatFields.keyExistsNotice').replace('{{key}}', newKey)}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    renameBeatHoverMetadataKey(entry.key, newKey);
                    const nextList = [...list];
                    nextList[idx] = { ...entry, key: newKey };
                    saveBeatEntries(nextList);
                    rerenderBeatYaml(nextList);
                    updateBeatHoverPreview?.();
                };

                // Value input
                const value = entry.value;
                const valInput = row.createEl('input', { type: 'text', cls: 'ert-input ert-input--md' });
                if (Array.isArray(value)) {
                    valInput.value = value.join(', ');
                    valInput.placeholder = t('settings.beats.beatFields.commaSeparatedPlaceholder');
                    valInput.onchange = () => {
                        valInput.value = normalizeBeatFieldListValueInput(valInput.value).join(', ');
                        const nextList = [...list];
                        nextList[idx] = { ...entry, value: normalizeBeatFieldListValueInput(valInput.value) };
                        saveBeatEntries(nextList);
                        updateBeatHoverPreview?.();
                    };
                } else {
                    valInput.value = typeof value === 'string' ? value : '';
                    valInput.placeholder = t('settings.beats.beatFields.defaultValuePlaceholder');
                    valInput.onchange = () => {
                        valInput.value = normalizeBeatFieldValueInput(valInput.value);
                        const nextList = [...list];
                        nextList[idx] = { ...entry, value: normalizeBeatFieldValueInput(valInput.value) };
                        saveBeatEntries(nextList);
                        updateBeatHoverPreview?.();
                    };
                }

                // Delete button (matches scene: ert-iconBtn + trash icon)
                const delBtn = row.createEl('button', { cls: 'ert-iconBtn', attr: { type: 'button', 'aria-label': t('settings.beats.beatFields.removeFieldLabel') } });
                setIcon(delBtn, 'trash');
                setTooltip(delBtn, t('settings.beats.beatFields.removeFieldLabel'));
                delBtn.onclick = () => {
                    removeBeatHoverMetadata(entry.key);
                    const nextList = list.filter((_, i) => i !== idx);
                    saveBeatEntries(nextList);
                    rerenderBeatYaml(nextList);
                    updateBeatHoverPreview?.();
                };

                // Drag events (matches scene: is-dragging / ert-template-dragover + plugin.registerDomEvent)
                plugin.registerDomEvent(dragHandle, 'dragstart', (e: DragEvent) => {
                    beatDragIndex = idx;
                    row.addClass('is-dragging');
                    e.dataTransfer?.setData('text/plain', String(idx));
                });
                plugin.registerDomEvent(dragHandle, 'dragend', () => {
                    beatDragIndex = null;
                    row.removeClass('is-dragging');
                });
                plugin.registerDomEvent(row, 'dragover', (e) => { e.preventDefault(); row.addClass('ert-template-dragover'); });
                plugin.registerDomEvent(row, 'dragleave', () => { row.removeClass('ert-template-dragover'); });
                plugin.registerDomEvent(row, 'drop', (e) => {
                    e.preventDefault();
                    row.removeClass('ert-template-dragover');
                    if (beatDragIndex === null || beatDragIndex === idx) return;
                    const nextList = [...list];
                    const [moved] = nextList.splice(beatDragIndex, 1);
                    nextList.splice(idx, 0, moved);
                    saveBeatEntries(nextList);
                    rerenderBeatYaml(nextList);
                    updateBeatHoverPreview?.();
                });
            };

            data.forEach((entry, idx) => renderBeatEntryRow(entry, idx, data));

            const addRow = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--add', 'ert-yaml-row--add-beat'] });

            // 1. Icon input with preview for new entry
            const addIconWrapper = addRow.createDiv({ cls: 'ert-hover-icon-wrapper' });
            const addIconPreview = addIconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
            setIcon(addIconPreview, DEFAULT_HOVER_ICON);
            const addIconInput = addIconWrapper.createEl('input', {
                type: 'text',
                cls: 'ert-input ert-input--md ert-icon-input',
                attr: { placeholder: t('settings.beats.beatFields.iconPlaceholder') }
            });
            addIconInput.value = DEFAULT_HOVER_ICON;
            setTooltip(addIconInput, t('settings.beats.beatFields.iconTooltip'));

            new IconSuggest(app, addIconInput, (selectedIcon) => {
                addIconInput.value = selectedIcon;
                addIconPreview.empty();
                setIcon(addIconPreview, selectedIcon);
            });

            addIconInput.oninput = () => {
                const iconName = addIconInput.value.trim();
                if (iconName && getIconIds().includes(iconName)) {
                    addIconPreview.empty();
                    setIcon(addIconPreview, iconName);
                }
            };

            // 2. Checkbox for new entry (default unchecked)
            const addCheckboxWrapper = addRow.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
            const addCheckbox = addCheckboxWrapper.createEl('input', {
                type: 'checkbox',
                cls: 'ert-hover-checkbox'
            });
            addCheckbox.checked = false;
            setTooltip(addCheckbox, t('settings.beats.beatFields.hoverCheckboxTooltip'));

            // 3. Key input
            const addKeyInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: t('settings.beats.beatFields.newKeyPlaceholder') } });

            // 4. Value input
            const addValInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: t('settings.beats.beatFields.valuePlaceholder') } });

            // 5. Buttons wrapper (holds add + revert)
            const btnWrap = addRow.createDiv({ cls: ['ert-iconBtnGroup', 'ert-template-actions'] });

            const addBtn = btnWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-mod-cta'] });
            setIcon(addBtn, 'plus');
            setTooltip(addBtn, t('settings.beats.beatFields.addPropertyTooltip'));

            const doAddBeatField = () => {
                const newKey = normalizeBeatFieldKeyInput(addKeyInput.value);
                if (!newKey || !hasBeatReadableText(newKey)) {
                    new Notice(t('settings.beats.beatFields.keyRequiredNotice'));
                    return;
                }
                addKeyInput.value = newKey;
                if (beatBaseKeys.includes(newKey)) {
                    new Notice(`"${newKey}" ${t('settings.beats.beatFields.baseFieldNotice')}`);
                    return;
                }
                if (beatDisallowedNewWriteKeys.has(newKey)) {
                    new Notice(`"${newKey}" ${t('settings.beats.beatFields.legacyKeyNotice')}`);
                    return;
                }
                if (data.some(e => e.key === newKey)) {
                    new Notice(`${t('settings.beats.beatFields.keyExistsNotice').replace('{{key}}', newKey)}`);
                    return;
                }
                // Save hover metadata for new key
                const iconName = addIconInput.value.trim() || DEFAULT_HOVER_ICON;
                if (addCheckbox.checked || iconName !== DEFAULT_HOVER_ICON) {
                    setBeatHoverMetadata(newKey, iconName, addCheckbox.checked);
                }
                const normalizedValue = normalizeBeatFieldValueInput(addValInput.value || '');
                addValInput.value = normalizedValue;
                const nextList = [...data, { key: newKey, value: normalizedValue, required: false }];
                saveBeatEntries(nextList);
                rerenderBeatYaml(nextList);
                updateBeatHoverPreview?.();
            };
            addBtn.onclick = doAddBeatField;
            addKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddBeatField(); } });

            const revertBtn = btnWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-template-reset-btn'] });
            setIcon(revertBtn, 'rotate-ccw');
            setTooltip(revertBtn, t('settings.beats.beatFields.revertTooltip'));
            revertBtn.onclick = async () => {
                const confirmed = await new Promise<boolean>((resolve) => {
                    const modal = new Modal(app);
                    const { modalEl, contentEl } = modal;
                    modal.titleEl.setText('');
                    contentEl.empty();

                    modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
                    contentEl.addClass('ert-modal-container', 'ert-stack');

                    const header = contentEl.createDiv({ cls: 'ert-modal-header' });
                    header.createSpan({ text: t('settings.beats.resetModal.badge'), cls: 'ert-modal-badge' });
                    header.createDiv({ text: t('settings.beats.resetModal.title'), cls: 'ert-modal-title' });
                    header.createDiv({ text: t('settings.beats.resetModal.subtitle'), cls: 'ert-modal-subtitle' });

                    const body = contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
                    body.createDiv({ text: t('settings.beats.resetModal.confirmText'), cls: 'ert-purge-warning' });

                    const actionsRow = contentEl.createDiv({ cls: ['ert-modal-actions', 'ert-inline-actions'] });

                    new ButtonComponent(actionsRow)
                        .setButtonText(t('settings.beats.resetModal.resetText'))
                        .setDestructive()
                        .onClick(() => {
                            modal.close();
                            resolve(true);
                        });

                    new ButtonComponent(actionsRow)
                        .setButtonText(t('settings.beats.resetModal.cancelText'))
                        .onClick(() => {
                            modal.close();
                            resolve(false);
                        });

                    modal.open();
                });

                if (!confirmed) return;

                updateConfigForCurrentSystem((config) => {
                    config.beatYamlAdvanced = `${SHARED_CHAPTER_FIELD_KEY}:`;
                    config.beatHoverMetadataFields = [];
                });
                await plugin.saveSettings();
                rerenderBeatYaml(ensureSharedChapterFieldEntries([]));
                updateBeatHoverPreview?.();
                dirtyState.notify();
            };
        };

        rerenderBeatYaml(beatEntries);
    };

    renderBeatYamlEditor();

    // ─── BEAT HOVER METADATA PREVIEW ──────────────────────────────────
    const beatHoverPreviewContainer = beatYamlSection.createDiv({
        cls: ['ert-previewFrame', 'ert-previewFrame--center', 'ert-previewFrame--flush'],
        attr: { 'data-preview': 'beat-metadata' }
    });
    const beatHoverPreviewHeading = beatHoverPreviewContainer.createDiv({ cls: 'ert-planetary-preview-heading', text: t('settings.beats.hoverPreview.heading') });
    const beatHoverPreviewBody = beatHoverPreviewContainer.createDiv({ cls: ['ert-hover-preview-body', 'ert-stack'] });

    const renderBeatHoverPreview = () => {
        beatHoverPreviewBody.empty();
        const activeConfig = getConfigForCurrentSystem();
        const enabledFields = activeConfig.beatHoverMetadataFields.filter(f => f.enabled);
        const currentBeatAdv = activeConfig.beatYamlAdvanced;
        const templateObj = safeParseYaml(currentBeatAdv);

        if (enabledFields.length === 0) {
            beatHoverPreviewContainer.removeClass('ert-settings-hidden');
            beatHoverPreviewHeading.setText(t('settings.beats.hoverPreview.headingNoneEnabled'));
            beatHoverPreviewBody.createDiv({ text: t('settings.beats.hoverPreview.enableHint'), cls: 'ert-hover-preview-empty' });
            return;
        }
        beatHoverPreviewContainer.removeClass('ert-settings-hidden');
        beatHoverPreviewHeading.setText(`Beat Hover Metadata Preview (${enabledFields.length} field${enabledFields.length > 1 ? 's' : ''})`);

        enabledFields.forEach(field => {
            const lineEl = beatHoverPreviewBody.createDiv({ cls: 'ert-hover-preview-line' });
            const iconName = typeof field.icon === 'string' ? field.icon.trim() : '';
            if (iconName) {
                const iconEl = lineEl.createSpan({ cls: 'ert-hover-preview-icon' });
                setIcon(iconEl, iconName);
            }
            const value = templateObj[field.key];
            const valueStr = Array.isArray(value) ? value.join(', ') : (value ?? '');
            const displayText = valueStr ? `${field.key}: ${valueStr}` : field.key;
            lineEl.createSpan({ text: displayText, cls: 'ert-hover-preview-text' });
        });
    };

    updateBeatHoverPreview = renderBeatHoverPreview;
    renderBeatHoverPreview();

    // ─── SAVED BEAT SYSTEMS (Sets tab) ────
    const savedCard = setsContainer.createDiv({
        cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ert-saved-beat-systems`
    });

    const savedHeaderRow = savedCard.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
    const savedTitleArea = savedHeaderRow.createDiv({ cls: 'ert-control' });
    const savedTitleRow = savedTitleArea.createEl('h4', { cls: `${ERT_CLASSES.SECTION_TITLE} ${ERT_CLASSES.INLINE}` });
    savedTitleRow.createSpan({ text: t('settings.beats.library.heading') });

    savedCard.createEl('p', {
        cls: ERT_CLASSES.SECTION_DESC,
        text: t('settings.beats.library.desc')
    });

    const savedControlsContainer = savedCard.createDiv({ cls: ERT_CLASSES.STACK });
    let selectedLibraryEntryId: string | null = null;

    // hasUnsavedChanges() was removed — unified into isSetDirty() via dirtyState store.
    // Both dirty indicators (dropdown warning + dirty notice) now use the same baseline.

        /** Load a library item into the workspace and activate its tab. */
        const applyLoadedSystem = (entry: BeatLibraryItem) => {
            const loadedTab = loadBeatTabFromLibraryItem(plugin.settings, entry);
            captureSetBaseline(loadedTab.tabId);
            _currentInnerStage = 'preview';
            void plugin.saveSettings().then(() => {
                plugin.onSettingChanged(IMPACT_FULL);
            });
        new Notice(`Loaded "${loadedTab.name}".`);
        invalidateBeatStructuralStatus();
        renderCustomConfig();
        renderBeatYamlEditor();
        updateBeatHoverPreview?.();
        renderSavedBeatSystems();
        updateBeatSystemCard(loadedTab.name, { resetStage: false });
        renderBeatSystemTabs();
    };

    type LoadableEntry = BeatLibraryItem & {
        builtIn: boolean;
        isDefault?: boolean;
    };

    const trashBeatNoteFiles = async (files: TFile[]): Promise<{
        trashed: number;
        failed: number;
        errors: string[];
    }> => {
        let trashed = 0;
        let failed = 0;
        const errors: string[] = [];

        // app.fileManager.trashFile respects the user's Obsidian "Deleted files"
        // preference ('system' → OS trash, anything else → vault .trash/ folder).
        for (const file of files) {
            try {
                await app.fileManager.trashFile(file);
                trashed += 1;
            } catch (error) {
                failed += 1;
                errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return { trashed, failed, errors };
    };

    const getBeatNoteFilesForLoadedTab = (loadedTab: LoadedBeatTab | null | undefined): TFile[] => {
        if (!loadedTab) return [];
        const structuralStatus = getBeatSystemStructuralStatus({
            app,
            settings: plugin.settings,
            loadedTab,
        });
        const filesByPath = new Map<string, TFile>();

        for (const matches of structuralStatus.matches.activeByBeatKey.values()) {
            for (const match of matches) {
                if (match.file instanceof TFile) {
                    filesByPath.set(match.file.path, match.file);
                }
            }
        }

        return [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    };

    const getBeatNoteCustomContentSummary = (files: TFile[]): BeatNoteCustomContentSummary => {
        const mappings = getActiveFrontmatterMappings(plugin.settings);
        const baseKeys = new Set(getBaseKeys('Beat', plugin.settings));
        const templateCustomKeys = new Set(getCustomKeys('Beat', plugin.settings));
        const templateKeySamples = new Set<string>();
        const extraKeySamples = new Set<string>();
        let notesWithTemplateCustomContent = 0;
        let notesWithExtraCustomContent = 0;

        files.forEach((file) => {
            const cache = app.metadataCache.getFileCache(file);
            const raw = (cache?.frontmatter ?? {}) as Record<string, unknown>;
            const frontmatter = mappings ? normalizeFrontmatterKeys(raw, mappings) : raw;
            let noteHasTemplateCustomContent = false;
            let noteHasExtraCustomContent = false;

            Object.entries(frontmatter).forEach(([key, value]) => {
                if (RESERVED_OBSIDIAN_KEYS.has(key) || baseKeys.has(key) || !isMeaningfulFrontmatterValue(value)) {
                    return;
                }
                if (templateCustomKeys.has(key)) {
                    noteHasTemplateCustomContent = true;
                    if (templateKeySamples.size < 5) templateKeySamples.add(key);
                    return;
                }
                noteHasExtraCustomContent = true;
                if (extraKeySamples.size < 5) extraKeySamples.add(key);
            });

            if (noteHasTemplateCustomContent) notesWithTemplateCustomContent += 1;
            if (noteHasExtraCustomContent) notesWithExtraCustomContent += 1;
        });

        return {
            notesWithTemplateCustomContent,
            notesWithExtraCustomContent,
            templateCustomKeys: [...templateKeySamples],
            extraCustomKeys: [...extraKeySamples],
        };
    };

    const openDeleteBeatNotesModal = async (options: {
        title: string;
        noteFiles: TFile[];
        actionLabel: string;
        systemTag?: string;
    }): Promise<boolean> => {
        const { title, noteFiles, actionLabel, systemTag } = options;
        const customContent = getBeatNoteCustomContentSummary(noteFiles);

        return new Promise<boolean>((resolve) => {
            const modal = new Modal(app);
            modal.titleEl.setText('');
            modal.contentEl.empty();
            modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
            modal.contentEl.addClass('ert-modal-container', 'ert-stack');

            const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
            header.createSpan({ cls: 'ert-modal-badge', text: systemTag ?? title });
            header.createDiv({ cls: 'ert-modal-title', text: actionLabel });
            header.createDiv({
                cls: 'ert-modal-subtitle',
                text: t('settings.beats.deleteModal.subtitleWithNotes')
            });

            const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
            body.createDiv({
                cls: 'ert-modal-subtitle',
                text: `${t('settings.beats.deleteModal.scopePrefix')}${noteFiles.length} ${t('settings.beats.deleteModal.beatNote')}${noteFiles.length !== 1 ? 's' : ''}`
            });
            if (customContent.notesWithTemplateCustomContent > 0 || customContent.notesWithExtraCustomContent > 0) {
                const warnText = customContent.notesWithExtraCustomContent > 0
                    ? t('settings.beats.deleteModal.warningExtra')
                    : t('settings.beats.deleteModal.warningTemplate');
                body.createDiv({ cls: 'ert-delete-modal-caution', text: warnText });
            }

            const confirmEl = body.createDiv({ cls: 'ert-modal-confirm-type' });
            confirmEl.createDiv({ text: t('settings.beats.deleteModal.typeDeletePrompt'), cls: 'ert-modal-subtitle' });
            const confirmInput = confirmEl.createEl('input', { type: 'text', attr: { placeholder: 'DELETE' } });

            const footer = modal.contentEl.createDiv({ cls: 'ert-modal-actions' });
            const actionBtn = new ButtonComponent(footer)
                .setButtonText(actionLabel)
                .setDestructive()
                .setDisabled(true)
                .onClick(() => {
                    if (confirmInput.value.trim() !== 'DELETE') {
                        confirmInput.classList.add('ert-input-error');
                        confirmInput.focus();
                        return;
                    }
                    resolve(true);
                    modal.close();
                });
            confirmInput.addEventListener('input', () => {
                actionBtn.setDisabled(confirmInput.value.trim() !== 'DELETE');
                confirmInput.classList.remove('ert-input-error');
            });
            new ButtonComponent(footer).setButtonText(t('settings.beats.deleteModal.cancelText')).onClick(() => {
                resolve(false);
                modal.close();
            });
            modal.onClose = () => resolve(false);
            modal.open();
        });
    };

    const renderSavedBeatSystems = () => {
        savedControlsContainer.empty();


        // Build unified lookup of all loadable systems (starter + user-saved)
        const allLoadable = new Map<string, LoadableEntry>();
        getBeatLibraryItems(plugin.settings).forEach((item) => {
            allLoadable.set(item.id, {
                ...item,
                builtIn: item.kind === 'builtin' || item.kind === 'starter',
                isDefault: item.kind === 'blank',
            });
        });

        const getSelectedEntryDeploymentStatus = (entry: LoadableEntry | null): BeatSystemStructuralStatus | null => {
            if (!entry || entry.isDefault) return null;
            return getBeatSystemStructuralStatus({
                app,
                settings: plugin.settings,
                loadedTab: {
                    tabId: `preview:${entry.kind}:${entry.id}`,
                    sourceKind: entry.kind,
                    sourceId: entry.id,
                    name: entry.name,
                    description: entry.description,
                    beats: entry.beats,
                    config: entry.config,
                    linkedSavedSystemId: entry.linkedSavedSystemId,
                    dirty: false,
                },
            } as const);
        };

        const getSelectedEntryBeatNoteFiles = (entry: LoadableEntry | null): TFile[] => {
            const structuralStatus = getSelectedEntryDeploymentStatus(entry);
            if (!structuralStatus) return [];
            const filesByPath = new Map<string, TFile>();

            for (const matches of structuralStatus.matches.activeByBeatKey.values()) {
                for (const match of matches) {
                    if (match.file instanceof TFile) {
                        filesByPath.set(match.file.path, match.file);
                    }
                }
            }

            return [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
        };

        const openBuiltInResetModal = async (entry: LoadableEntry) => {
            const noteFiles = getSelectedEntryBeatNoteFiles(entry);
            if (noteFiles.length === 0) {
                new Notice(`No beat notes found for "${entry.name}".`);
                return;
            }
            const confirmed = await openDeleteBeatNotesModal({
                title: entry.name,
                noteFiles,
                actionLabel: 'Reset to default',
                systemTag: 'BEAT SET',
            });

            if (!confirmed) return;

            const result = await trashBeatNoteFiles(noteFiles);
            if (result.failed > 0) {
                console.error('[Beat Sets] Failed to trash beat notes:', result.errors);
            }
            invalidateBeatStructuralStatus();
            renderCustomConfig();
            renderPreviewContent(getActiveBeatWorkspaceName('Custom'));
            renderBeatYamlEditor();
            updateBeatHoverPreview?.();
            renderSavedBeatSystems();
            renderStageSwitcher();
            updateStageVisibility();
            const parts = [`Moved ${result.trashed} beat note${result.trashed !== 1 ? 's' : ''} to trash.`];
            if (result.failed > 0) parts.push(`${result.failed} failed`);
            new Notice(parts.join(' '));
        };

        const getEntryFromLoadedTab = (tab: LoadedBeatTab | null | undefined): LoadableEntry | null => {
            if (!tab) return null;
            if (tab.sourceKind === 'blank') {
                return allLoadable.get(BLANK_LIBRARY_ITEM_ID) ?? null;
            }
            if (tab.sourceId) {
                return allLoadable.get(tab.sourceId) ?? null;
            }
            return null;
        };

        const focusLoadedWorkspaceTab = async (tabId: string) => {
            activateLoadedBeatTab(plugin.settings, tabId);
            _currentInnerStage = 'preview';
            await plugin.saveSettings();
            plugin.onSettingChanged(IMPACT_FULL);
            invalidateBeatStructuralStatus();
            updateTemplateButton(templateSetting, getActiveBeatWorkspaceName('Custom'));
            updateBeatSystemCard(getActiveBeatWorkspaceName('Custom'));
            renderBeatSystemTabs();
        };

        const loadOrFocusEntry = async (entry: BeatLibraryItem) => {
            const existing = isBeatLibraryItemLoaded(plugin.settings, entry);
            if (existing) {
                await focusLoadedWorkspaceTab(existing.tabId);
                return;
            }
            applyLoadedSystem(entry);
        };

        const orderedEntries: LoadableEntry[] = [
            ...[...allLoadable.values()].filter((entry) => entry.kind === 'builtin'),
            ...[...allLoadable.values()].filter((entry) => entry.kind === 'starter'),
            ...[...allLoadable.values()].filter((entry) => entry.kind === 'saved'),
            ...[...allLoadable.values()].filter((entry) => entry.kind === 'blank'),
        ];

        const buildPreviewLoadedTab = (entry: LoadableEntry): LoadedBeatTab => ({
            tabId: `preview:${entry.kind}:${entry.id}`,
            sourceKind: entry.kind,
            sourceId: entry.id,
            name: entry.name,
            description: entry.description ?? '',
            beats: entry.beats.map((beat) => ({ ...beat })),
            config: entry.config,
            linkedSavedSystemId: entry.linkedSavedSystemId,
            dirty: false,
        });

        const getDefaultSelectedEntryId = (): string => {
            const activeEntry = getEntryFromLoadedTab(getActiveBeatWorkspaceTab());
            return activeEntry?.id ?? orderedEntries[0]?.id ?? BLANK_LIBRARY_ITEM_ID;
        };

        if (!selectedLibraryEntryId || !allLoadable.has(selectedLibraryEntryId)) {
            selectedLibraryEntryId = getDefaultSelectedEntryId();
        }

        const selectedEntry = allLoadable.get(selectedLibraryEntryId) ?? orderedEntries[0] ?? null;
        if (!selectedEntry) return;

        const selectorCard = savedControlsContainer.createDiv({ cls: 'ert-set-preview ert-set-selector-card' });
        const selectorRow = selectorCard.createDiv({ cls: 'ert-set-selector-row' });
        selectorRow.createSpan({ text: t('settings.beats.library.selectLabel'), cls: 'ert-set-preview-title' });
        const selectEl = selectorRow.createEl('select', {
            cls: 'ert-input ert-input--lg',
            attr: { 'aria-label': 'Select a beat system set' }
        });

        const appendOptionGroup = (label: string, items: LoadableEntry[]) => {
            if (items.length === 0) return;
            const group = selectEl.createEl('optgroup', { attr: { label } });
            items.forEach((entry) => {
                group.createEl('option', {
                    value: entry.id,
                    text: entry.name,
                });
            });
        };

        appendOptionGroup(t('settings.beats.library.narrativeGroup'), orderedEntries.filter((entry) => entry.category === 'narrative'));
        appendOptionGroup(t('settings.beats.library.engineGroup'), orderedEntries.filter((entry) => entry.category === 'engine'));
        appendOptionGroup(t('settings.beats.library.formatGroup'), orderedEntries.filter((entry) => entry.category === 'format'));
        appendOptionGroup(t('settings.beats.library.savedGroup'), orderedEntries.filter((entry) => entry.category === 'saved'));
        appendOptionGroup(t('settings.beats.library.blankGroup'), orderedEntries.filter((entry) => entry.category === 'blank'));
        selectEl.value = selectedEntry.id;
        selectEl.addEventListener('change', () => {
            selectedLibraryEntryId = selectEl.value;
            renderSavedBeatSystems();
        });

        const previewCard = savedControlsContainer.createDiv({ cls: 'ert-set-preview' });
        const previewTitleRow = previewCard.createDiv({ cls: 'ert-set-preview-header' });
        if (selectedEntry.icon) {
            const previewIconEl = previewTitleRow.createSpan({ cls: 'ert-set-preview-icon' });
            setIcon(previewIconEl, selectedEntry.icon);
        }
        previewTitleRow.createSpan({ text: selectedEntry.name, cls: 'ert-set-preview-title' });
        const isLibrarySystem = selectedEntry.kind === 'builtin' || selectedEntry.kind === 'starter';
        const previewTag = previewTitleRow.createSpan({
            text: selectedEntry.isDefault
                ? t('settings.beats.library.blankSystemTag')
                : isLibrarySystem
                    ? t('settings.beats.library.librarySystemTag')
                    : t('settings.beats.library.savedSystemTag'),
            cls: `ert-set-preview-tag ${isLibrarySystem ? 'ert-set-preview-tag--starter' : 'ert-set-preview-tag--saved'}`
        });
        if (selectedEntry.isDefault) {
            setIcon(previewTag, 'square-pen');
        } else if (isLibrarySystem) {
            setIcon(previewTag, 'star');
        }

        const overview = getSystemOverviewState(selectedEntry.name, buildPreviewLoadedTab(selectedEntry));
        if (overview.sourceLink) {
            const sourceRow = previewCard.createDiv({ cls: 'ert-beat-template-source' });
            const sourceLink = sourceRow.createEl('a', {
                cls: 'ert-beat-template-source-link',
                href: overview.sourceLink.href,
                attr: {
                    target: '_blank',
                    rel: 'noopener'
                }
            });
            sourceLink.createSpan({ text: overview.sourceLink.label });
            const sourceIcon = sourceLink.createSpan({ cls: 'ert-beat-template-source-link-icon' });
            setIcon(sourceIcon, 'external-link');
        }
        renderSystemDescription(previewCard, overview);

        const selectedLoadedTab = isBeatLibraryItemLoaded(plugin.settings, selectedEntry);
        const activeWorkspaceTab = getActiveBeatWorkspaceTab();
        const selectedIsActive = !!selectedLoadedTab && !!activeWorkspaceTab && selectedLoadedTab.tabId === activeWorkspaceTab.tabId;
        const statusHints: string[] = [];
        if (selectedLoadedTab) statusHints.push(t('settings.beats.library.loadedStatus'));
        if (selectedIsActive) statusHints.push(t('settings.beats.library.activeStatus'));
        if (statusHints.length > 0) {
            previewCard.createDiv({
                cls: 'ert-set-preview-status',
                text: statusHints.join(' · ')
            });
        }

        const actionsRow = savedControlsContainer.createDiv({ cls: 'ert-inline-actions ert-inline-actions--end ert-set-library-actions' });
        new ButtonComponent(actionsRow)
            .setButtonText(
                selectedEntry.isDefault
                    ? t('settings.beats.library.createBlankText')
                    : selectedLoadedTab
                        ? t('settings.beats.library.focusTabText')
                        : t('settings.beats.library.openTabText')
            )
            .setCta()
            .onClick(() => {
                void (selectedLoadedTab
                    ? focusLoadedWorkspaceTab(selectedLoadedTab.tabId)
                    : loadOrFocusEntry(selectedEntry));
            });

        const canSaveCopy = !!activeWorkspaceTab && activeWorkspaceTab.beats.length > 0;
        new ButtonComponent(actionsRow)
            .setButtonText(t('settings.beats.library.saveAsCopyText'))
            .setDisabled(!canSaveCopy)
            .onClick(() => { void saveSetModal({ isCopy: true }); });

        const activeEntry = getEntryFromLoadedTab(activeWorkspaceTab);
        const canResetCurrent = !!activeEntry && !!activeEntry.builtIn && !activeEntry.isDefault && getSelectedEntryBeatNoteFiles(activeEntry).length > 0;
        new ButtonComponent(actionsRow)
            .setButtonText(t('settings.beats.library.resetToDefaultText'))
            .setDisabled(!canResetCurrent)
            .onClick(() => {
                if (activeEntry) {
                    void openBuiltInResetModal(activeEntry);
                }
            });

        // ── Shared: save-as-copy modal + persistence ─────────────────
        const saveSetModal = async (opts: { isCopy: boolean }): Promise<void> => {
            const currentBeats = getActiveCustomBeats()
                .map(b => ({
                    ...b,
                    name: normalizeBeatNameInput(b.name, ''),
                }));
            if (currentBeats.some(b => !hasBeatReadableText(b.name))) {
                new Notice(t('settings.beats.saveModal.beatNamesNotice'));
                return;
            }
            if (currentBeats.length === 0) {
                new Notice(t('settings.beats.saveModal.noBeatsNotice'));
                return;
            }
            const activeConfig = getBeatConfigForSystem(plugin.settings);
            const currentName = getActiveCustomName('Custom');
            const defaultName = opts.isCopy ? `${currentName} (Copy)` : currentName;
            const modalTitle = opts.isCopy ? t('settings.beats.saveModal.copyTitle') : t('settings.beats.saveModal.saveTitle');
            const modalSubtitle = opts.isCopy
                ? t('settings.beats.saveModal.copySubtitle')
                : t('settings.beats.saveModal.saveSubtitle');

            const saveName = await new Promise<string | null>((resolve) => {
                const modal = new Modal(app);
                const { modalEl, contentEl } = modal;
                modal.titleEl.setText('');
                contentEl.empty();
                modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
                contentEl.addClass('ert-modal-container', 'ert-stack');
                const header = contentEl.createDiv({ cls: 'ert-modal-header' });
                header.createSpan({ cls: 'ert-modal-badge', text: t('settings.beats.saveModal.badge') });
                header.createDiv({ cls: 'ert-modal-title', text: modalTitle });
                header.createDiv({ cls: 'ert-modal-subtitle', text: modalSubtitle });
                const inputRow = contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
                const nameInput = inputRow.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--full',
                    attr: { placeholder: t('settings.beats.saveModal.namePlaceholder') }
                });
                nameInput.value = defaultName;
                const actionsDiv = contentEl.createDiv({ cls: ['ert-modal-actions', 'ert-inline-actions'] });
                new ButtonComponent(actionsDiv).setButtonText(t('settings.beats.saveModal.saveText')).setCta().onClick(() => {
                    const name = normalizeBeatSetNameInput(nameInput.value, '');
                    if (!name || !hasBeatReadableText(name)) {
                        new Notice(t('settings.beats.saveModal.nameRequiredNotice'));
                        return;
                    }
                    modal.close();
                    resolve(name);
                });
                new ButtonComponent(actionsDiv).setButtonText(t('settings.beats.saveModal.cancelText')).onClick(() => { modal.close(); resolve(null); });
                nameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const name = normalizeBeatSetNameInput(nameInput.value, '');
                        if (!name || !hasBeatReadableText(name)) {
                            new Notice(t('settings.beats.saveModal.nameRequiredNotice'));
                            return;
                        }
                        modal.close();
                        resolve(name);
                    }
                });
                modal.open();
                scheduleFocusAfterPaint(nameInput, { selectText: true });
            });

            if (!saveName) return;

            const existingSystems = plugin.settings.savedBeatSystems ?? [];
            // Copies never overwrite; regular save can update same-name entry
            const existingIdx = opts.isCopy ? -1 : existingSystems.findIndex(s => s.name === saveName);

            const newSystem: SavedBeatSystem = {
                id: existingIdx >= 0 ? existingSystems[existingIdx].id : `${Date.now()}`,
                name: saveName,
                description: getActiveCustomDescription(),
                beats: currentBeats,
                createdAt: new Date().toISOString()
            };

            if (!plugin.settings.beatSystemConfigs) plugin.settings.beatSystemConfigs = {};
            plugin.settings.beatSystemConfigs[getCustomBeatConfigKey(newSystem.id)] = {
                beatYamlAdvanced: activeConfig.beatYamlAdvanced,
                beatHoverMetadataFields: activeConfig.beatHoverMetadataFields.map(f => ({ ...f })),
            };

            if (existingIdx >= 0) {
                existingSystems[existingIdx] = newSystem;
            } else {
                existingSystems.unshift(newSystem);
            }
            plugin.settings.savedBeatSystems = existingSystems;
            const activeTabId = getActiveBeatWorkspaceTabId();
            if (activeTabId) {
                updateLoadedBeatTab(plugin.settings, activeTabId, (tab) => ({
                    ...tab,
                    sourceKind: 'saved',
                    sourceId: newSystem.id,
                    linkedSavedSystemId: newSystem.id,
                    name: newSystem.name,
                    description: newSystem.description ?? '',
                    beats: newSystem.beats.map((beat) => ({ ...beat })),
                    config: {
                        beatYamlAdvanced: activeConfig.beatYamlAdvanced,
                        beatHoverMetadataFields: activeConfig.beatHoverMetadataFields.map(f => ({ ...f })),
                    },
                    dirty: false,
                }));
            }
            await plugin.saveSettings();
            // Re-capture baseline so the saved state becomes the new "clean" reference
            captureSetBaseline(getActiveDirtyKey());
            const verb = opts.isCopy ? 'copied' : (existingIdx >= 0 ? 'updated' : 'saved');
            new Notice(`Set "${saveName}" ${verb}.`);
            // Targeted refresh — no full re-render needed
            if (opts.isCopy) {
                _currentInnerStage = 'design';
                renderCustomConfig();           // Design header shows new name/origin
                renderPreviewContent(getActiveBeatWorkspaceName('Custom')); // Preview reflects new set's beats/description
                renderBeatYamlEditor();         // Fields reflect new system's YAML
                updateBeatHoverPreview?.();     // Hover preview reflects new config
                renderSavedBeatSystems();       // Sets dropdown updated
                renderStageSwitcher();          // Stage buttons reflect Design active
                updateStageVisibility();        // Show Design stage
            } else {
                // Non-copy save: re-render Design header (clears dirty indicators)
                // + library panel
                renderCustomConfig();
                renderPreviewContent(getActiveBeatWorkspaceName('Custom')); // Preview reflects saved state
                renderSavedBeatSystems();
            }
        };
    };

    if (!getActiveBeatWorkspaceTab()) {
        _currentInnerStage = 'library';
    }
    renderSavedBeatSystems();
    const initialActiveBeatTab = getActiveBeatWorkspaceTab();
    if (initialActiveBeatTab) {
        updateBeatSystemCard(initialActiveBeatTab.name);
    } else {
        renderStageSwitcher();
        updateStageVisibility();
    }
    renderBeatSystemTabs();
    _unsubTopBeatTabsDirty = dirtyState.subscribe(() => {
        renderBeatSystemTabs();
    });

    renderScenePropertiesSection({
        app,
        plugin,
        parentEl: yamlStack,
    });
    renderSceneNormalizerSection({
        app,
        plugin,
        parentEl: yamlStack,
    });

    // ═══════════════════════════════════════════════════════════════════════
    // BACKDROP PROPERTIES EDITOR
    // ═══════════════════════════════════════════════════════════════════════

    const backdropYamlSection = (backdropYamlTargetEl ?? yamlStack).createDiv({ cls: ERT_CLASSES.STACK });

    const backdropYamlHeading = new Settings(backdropYamlSection)
        .setName(t('settings.beats.backdrop.name'))
        .setDesc(t('settings.beats.backdrop.desc'));
    const backdropYamlToggleBtn = backdropYamlHeading.controlEl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button', 'aria-label': t('settings.beats.backdrop.showLabel') }
    });
    const refreshBackdropYamlToggle = () => {
        const expanded = plugin.settings.enableBackdropYamlEditor ?? false;
        setIcon(backdropYamlToggleBtn, expanded ? 'chevron-down' : 'chevron-right');
        setTooltip(backdropYamlToggleBtn, expanded ? t('settings.beats.backdrop.hideLabel') : t('settings.beats.backdrop.showLabel'));
        backdropYamlToggleBtn.setAttribute('aria-label', expanded ? t('settings.beats.backdrop.hideLabel') : t('settings.beats.backdrop.showLabel'));
    };
    refreshBackdropYamlToggle();

    const backdropYamlContainer = backdropYamlSection.createDiv({ cls: ['ert-panel', 'ert-advanced-template-card'] });

    // ─── Backdrop hover metadata helpers ─────────────────────────────────
    const getBackdropHoverMetadata = (key: string): HoverMetadataField | undefined => {
        return (plugin.settings.backdropHoverMetadataFields ?? []).find(f => f.key === key);
    };

    const setBackdropHoverMetadata = (key: string, icon: string, enabled: boolean) => {
        if (!plugin.settings.backdropHoverMetadataFields) {
            plugin.settings.backdropHoverMetadataFields = [];
        }
        const existing = plugin.settings.backdropHoverMetadataFields.find(f => f.key === key);
        if (existing) {
            existing.icon = icon;
            existing.enabled = enabled;
        } else {
            plugin.settings.backdropHoverMetadataFields.push({ key, label: key, icon, enabled });
        }
        void plugin.saveSettings();
    };

    const removeBackdropHoverMetadata = (key: string) => {
        if (plugin.settings.backdropHoverMetadataFields) {
            plugin.settings.backdropHoverMetadataFields = plugin.settings.backdropHoverMetadataFields.filter(f => f.key !== key);
            void plugin.saveSettings();
        }
    };

    const renameBackdropHoverMetadataKey = (oldKey: string, newKey: string) => {
        const existing = plugin.settings.backdropHoverMetadataFields?.find(f => f.key === oldKey);
        if (existing) {
            existing.key = newKey;
            void plugin.saveSettings();
        }
    };

    let updateBackdropHoverPreview: (() => void) | undefined;

    const backdropBaseTemplate = plugin.settings.backdropYamlTemplates?.base
        ?? DEFAULT_SETTINGS.backdropYamlTemplates?.base
        ?? 'Class: Backdrop\nWhen:\nEnd:\nContext:';
    const backdropBaseKeys = extractKeysInOrder(backdropBaseTemplate);
    // `Synopsis` is legacy for Backdrop and should not be written by new templates.
    const backdropDisallowedNewWriteKeys = new Set(['Synopsis']);
    const backdropReservedSystemKeys = new Set(['id', 'class']);
    const normalizeBackdropFieldKey = (value: string): string => {
        return (value || '')
            .replace(/\p{Cc}+/gu, ' ')
            .replace(/:/g, ' - ')
            .replace(/\s+/g, ' ')
            .trim();
    };
    const backdropKeyMatch = (value: string): string => normalizeBackdropFieldKey(value).toLowerCase();
    const isBackdropBaseKey = (value: string): boolean => {
        const match = backdropKeyMatch(value);
        return backdropBaseKeys.some(baseKey => backdropKeyMatch(baseKey) === match);
    };
    const isBackdropLegacyKey = (value: string): boolean => {
        const match = backdropKeyMatch(value);
        return [...backdropDisallowedNewWriteKeys].some(legacyKey => backdropKeyMatch(legacyKey) === match);
    };
    const isBackdropReservedSystemKey = (value: string): boolean => {
        return backdropReservedSystemKeys.has(backdropKeyMatch(value));
    };
    const backdropHasCustomKey = (entries: FieldEntry[], value: string, skipIndex?: number): boolean => {
        const match = backdropKeyMatch(value);
        return entries.some((entry, index) => index !== skipIndex && backdropKeyMatch(entry.key) === match);
    };

    const renderBackdropYamlEditor = () => {
        backdropYamlContainer.empty();
        const isExpanded = plugin.settings.enableBackdropYamlEditor ?? false;
        backdropYamlContainer.toggleClass('ert-settings-hidden', !isExpanded);
        if (!isExpanded) return;

        const currentBackdropAdvanced = plugin.settings.backdropYamlTemplates?.advanced ?? '';
        const backdropAdvancedObj = safeParseYaml(currentBackdropAdvanced);

        const backdropOptionalOrder = extractKeysInOrder(currentBackdropAdvanced).filter(k => !isBackdropBaseKey(k));
        const backdropEntries = ensureSharedChapterFieldEntries(backdropOptionalOrder.map(key => ({
            key,
            value: backdropAdvancedObj[key] ?? '',
            required: false
        })));

        let backdropWorkingEntries = backdropEntries;
        let backdropDragIndex: number | null = null;

        const saveBackdropEntries = (nextEntries: FieldEntry[]) => {
            backdropWorkingEntries = nextEntries;
            const yaml = buildYamlFromEntries(nextEntries);
            if (!plugin.settings.backdropYamlTemplates) {
                plugin.settings.backdropYamlTemplates = {
                    base: backdropBaseTemplate,
                    advanced: '',
                };
            }
            plugin.settings.backdropYamlTemplates.advanced = yaml;
            void plugin.saveSettings();
        };

        const rerenderBackdropYaml = (next?: FieldEntry[]) => {
            const data = next ?? backdropWorkingEntries;
            backdropWorkingEntries = data;
            backdropYamlContainer.empty();
            const isExpanded = plugin.settings.enableBackdropYamlEditor ?? false;
            backdropYamlContainer.toggleClass('ert-settings-hidden', !isExpanded);
            if (!isExpanded) return;

            // Read-only base fields (collapsed summary)
            const baseCard = backdropYamlContainer.createDiv({ cls: 'ert-template-base-summary' });
            baseCard.createDiv({ cls: 'ert-template-base-heading', text: t('settings.beats.beatFields.baseFieldsHeading') });
            const basePills = baseCard.createDiv({ cls: 'ert-template-base-pills' });
            backdropBaseKeys.forEach(k => {
                basePills.createSpan({ cls: 'ert-template-base-pill', text: k });
            });

            // Editable advanced entries
            const listEl = backdropYamlContainer.createDiv({ cls: ['ert-template-entries', 'ert-template-indent'] });

            if (data.length > 0) {
                listEl.createDiv({ cls: 'ert-template-section-label', text: t('settings.beats.beatFields.customFieldsHeading') });
            }

            const renderBackdropEntryRow = (entry: FieldEntry, idx: number, list: FieldEntry[]) => {
                const row = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--hover-meta'] });

                const hoverMeta = getBackdropHoverMetadata(entry.key);
                const currentIcon = hoverMeta?.icon ?? DEFAULT_HOVER_ICON;
                const currentEnabled = hoverMeta?.enabled ?? false;

                // Drag handle
                const dragHandle = row.createDiv({ cls: 'ert-drag-handle' });
                dragHandle.draggable = true;
                setIcon(dragHandle, 'grip-vertical');
                setTooltip(dragHandle, t('settings.beats.beatFields.dragTooltip'));

                row.createDiv({ cls: 'ert-grid-spacer' });

                // Icon input
                const iconWrapper = row.createDiv({ cls: 'ert-hover-icon-wrapper' });
                const iconPreview = iconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
                setIcon(iconPreview, currentIcon);
                const iconInput = iconWrapper.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md ert-icon-input',
                    attr: { placeholder: t('settings.beats.beatFields.iconPlaceholder') }
                });
                iconInput.value = currentIcon;
                setTooltip(iconInput, t('settings.beats.backdrop.iconTooltip'));

                // Hover checkbox
                const checkboxWrapper = row.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
                const checkbox = checkboxWrapper.createEl('input', {
                    type: 'checkbox',
                    cls: 'ert-hover-checkbox'
                });
                checkbox.checked = currentEnabled;
                setTooltip(checkbox, t('settings.beats.backdrop.hoverCheckboxTooltip'));

                new IconSuggest(app, iconInput, (selectedIcon) => {
                    iconInput.value = selectedIcon;
                    setIcon(iconPreview, selectedIcon);
                    setBackdropHoverMetadata(entry.key, selectedIcon, checkbox.checked);
                    updateBackdropHoverPreview?.();
                });

                // SAFE: Settings sections are standalone functions without Component lifecycle
                iconInput.addEventListener('blur', () => {
                    const val = iconInput.value.trim() || DEFAULT_HOVER_ICON;
                    setIcon(iconPreview, val);
                    setBackdropHoverMetadata(entry.key, val, checkbox.checked);
                    updateBackdropHoverPreview?.();
                });

                checkbox.addEventListener('change', () => {
                    setBackdropHoverMetadata(entry.key, iconInput.value.trim() || DEFAULT_HOVER_ICON, checkbox.checked);
                    updateBackdropHoverPreview?.();
                });

                // Key input
                const keyInput = row.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md',
                    attr: { placeholder: 'Key' }
                });
                keyInput.value = entry.key;

                // Value input
                const valInput = row.createEl('input', {
                    type: 'text',
                    cls: 'ert-input ert-input--md',
                    attr: { placeholder: 'Value' }
                });
                valInput.value = Array.isArray(entry.value) ? entry.value.join(', ') : (entry.value ?? '');

                // Delete button
                const delBtn = row.createEl('button', { cls: ERT_CLASSES.ICON_BTN });
                setIcon(delBtn, 'trash');
                setTooltip(delBtn, t('settings.beats.beatFields.removeFieldLabel'));
                delBtn.addEventListener('click', () => {
                    removeBackdropHoverMetadata(entry.key);
                    const next = list.filter((_, i) => i !== idx);
                    saveBackdropEntries(next);
                    rerenderBackdropYaml(next);
                    updateBackdropHoverPreview?.();
                });

                // Key rename
                keyInput.addEventListener('blur', () => {
                    const newKey = normalizeBackdropFieldKey(keyInput.value);
                    if (!newKey || backdropKeyMatch(newKey) === backdropKeyMatch(entry.key)) {
                        keyInput.value = entry.key;
                        return;
                    }
                    if (!hasBeatReadableText(newKey)) {
                        new Notice(t('settings.beats.beatFields.keyRequiredNotice'));
                        keyInput.value = entry.key;
                        return;
                    }
                    if (isBackdropReservedSystemKey(newKey)) {
                        new Notice(`"${newKey}" ${t('settings.beats.backdrop.systemManagedNotice')}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    if (isBackdropBaseKey(newKey)) {
                        new Notice(`"${newKey}" ${t('settings.beats.backdrop.baseFieldNotice')}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    if (isBackdropLegacyKey(newKey)) {
                        new Notice(`"${newKey}" ${t('settings.beats.backdrop.legacyKeyNotice')}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    if (backdropHasCustomKey(list, newKey, idx)) {
                        new Notice(`${t('settings.beats.beatFields.keyExistsNotice').replace('{{key}}', newKey)}`);
                        keyInput.value = entry.key;
                        return;
                    }
                    keyInput.value = newKey;
                    renameBackdropHoverMetadataKey(entry.key, newKey);
                    const next = list.map((e, i) => i === idx ? { ...e, key: newKey } : e);
                    saveBackdropEntries(next);
                    rerenderBackdropYaml(next);
                });

                // Value change
                valInput.addEventListener('blur', () => {
                    const newVal = valInput.value;
                    const next = list.map((e, i) => i === idx ? { ...e, value: newVal } : e);
                    saveBackdropEntries(next);
                });

                // Drag events
                dragHandle.addEventListener('dragstart', (e) => {
                    backdropDragIndex = idx;
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                    row.classList.add('ert-drag-active');
                });
                row.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                });
                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (backdropDragIndex === null || backdropDragIndex === idx) return;
                    const next = [...list];
                    const [moved] = next.splice(backdropDragIndex, 1);
                    next.splice(idx, 0, moved);
                    backdropDragIndex = null;
                    saveBackdropEntries(next);
                    rerenderBackdropYaml(next);
                });
                dragHandle.addEventListener('dragend', () => {
                    backdropDragIndex = null;
                    row.classList.remove('ert-drag-active');
                });
            };

            data.forEach((entry, idx) => renderBackdropEntryRow(entry, idx, data));

            // Add new field row (matching scene YAML row layout)
            const addRow = listEl.createDiv({ cls: ['ert-yaml-row', 'ert-yaml-row--add', 'ert-yaml-row--hover-meta'] });

            // 1. Handle placeholder (direct child)
            addRow.createDiv({ cls: ['ert-drag-handle', 'ert-drag-placeholder'] });

            // 2. Spacer (direct child)
            addRow.createDiv({ cls: 'ert-grid-spacer' });

            // 3. Icon input with preview for new entry
            const addIconWrapper = addRow.createDiv({ cls: 'ert-hover-icon-wrapper' });
            const addIconPreview = addIconWrapper.createDiv({ cls: 'ert-hover-icon-preview' });
            setIcon(addIconPreview, DEFAULT_HOVER_ICON);
            const addIconInput = addIconWrapper.createEl('input', {
                type: 'text',
                cls: 'ert-input ert-input--md ert-icon-input',
                attr: { placeholder: t('settings.beats.beatFields.iconPlaceholder') }
            });
            addIconInput.value = DEFAULT_HOVER_ICON;
            setTooltip(addIconInput, t('settings.beats.backdrop.iconTooltip'));

            new IconSuggest(app, addIconInput, (selectedIcon) => {
                addIconInput.value = selectedIcon;
                addIconPreview.empty();
                setIcon(addIconPreview, selectedIcon);
            });

            addIconInput.oninput = () => {
                const iconName = addIconInput.value.trim();
                if (iconName && getIconIds().includes(iconName)) {
                    addIconPreview.empty();
                    setIcon(addIconPreview, iconName);
                }
            };

            // 4. Checkbox for new entry (default unchecked)
            const addCheckboxWrapper = addRow.createDiv({ cls: 'ert-hover-checkbox-wrapper' });
            const addCheckbox = addCheckboxWrapper.createEl('input', {
                type: 'checkbox',
                cls: 'ert-hover-checkbox'
            });
            addCheckbox.checked = false;
            setTooltip(addCheckbox, t('settings.beats.backdrop.hoverCheckboxTooltip'));

            // 5. Key input (direct child)
            const addKeyInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: t('settings.beats.beatFields.newKeyPlaceholder') } });

            // 6. Value input (direct child)
            const addValInput = addRow.createEl('input', { type: 'text', cls: 'ert-input ert-input--full', attr: { placeholder: t('settings.beats.beatFields.valuePlaceholder') } });

            // 7. Buttons wrapper (holds both + and reset)
            const btnWrap = addRow.createDiv({ cls: ['ert-iconBtnGroup', 'ert-template-actions'] });

            const addBtn = btnWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-mod-cta'] });
            setIcon(addBtn, 'plus');
            setTooltip(addBtn, t('settings.beats.backdrop.addFieldTooltip'));
            addBtn.addEventListener('click', () => {
                const k = normalizeBackdropFieldKey(addKeyInput.value || '');
                if (!k || !hasBeatReadableText(k)) {
                    new Notice(t('settings.beats.beatFields.keyRequiredNotice'));
                    return;
                }
                addKeyInput.value = k;
                if (isBackdropReservedSystemKey(k)) {
                    new Notice(`"${k}" ${t('settings.beats.backdrop.systemManagedNotice')}`);
                    return;
                }
                if (isBackdropBaseKey(k)) {
                    new Notice(`"${k}" ${t('settings.beats.backdrop.baseFieldNotice')}`);
                    return;
                }
                if (isBackdropLegacyKey(k)) {
                    new Notice(`"${k}" ${t('settings.beats.backdrop.legacyKeyNotice')}`);
                    return;
                }
                if (backdropHasCustomKey(data, k)) {
                    new Notice(`${t('settings.beats.beatFields.keyExistsNotice').replace('{{key}}', k)}`);
                    return;
                }
                const iconName = addIconInput.value.trim() || DEFAULT_HOVER_ICON;
                if (addCheckbox.checked || iconName !== DEFAULT_HOVER_ICON) {
                    setBackdropHoverMetadata(k, iconName, addCheckbox.checked);
                }
                const next = [...data, { key: k, value: addValInput.value || '', required: false }];
                saveBackdropEntries(next);
                rerenderBackdropYaml(next);
                updateBackdropHoverPreview?.();
            });

            const revertBtn = btnWrap.createEl('button', { cls: ['ert-iconBtn', 'ert-template-reset-btn'] });
            setIcon(revertBtn, 'rotate-ccw');
            setTooltip(revertBtn, t('settings.beats.backdrop.revertTooltip'));
            revertBtn.addEventListener('click', () => { void (async () => {
                if (!plugin.settings.backdropYamlTemplates) {
                    plugin.settings.backdropYamlTemplates = { base: backdropBaseTemplate, advanced: '' };
                }
                plugin.settings.backdropYamlTemplates.advanced = `${SHARED_CHAPTER_FIELD_KEY}:`;
                plugin.settings.backdropHoverMetadataFields = [];
                await plugin.saveSettings();
                rerenderBackdropYaml(ensureSharedChapterFieldEntries([]));
                updateBackdropHoverPreview?.();
            })(); });
        };

        rerenderBackdropYaml(backdropEntries);
    };

    // SAFE: Settings sections are standalone functions without Component lifecycle
    backdropYamlToggleBtn.addEventListener('click', () => { void (async () => {
        const next = !(plugin.settings.enableBackdropYamlEditor ?? false);
        plugin.settings.enableBackdropYamlEditor = next;
        refreshBackdropYamlToggle();
        await plugin.saveSettings();
        renderBackdropYamlEditor();
        renderBackdropHoverPreview();
    })(); });

    renderBackdropYamlEditor();

    // ─── BACKDROP HOVER METADATA PREVIEW ─────────────────────────────────
    const backdropHoverPreviewContainer = backdropYamlSection.createDiv({
        cls: ['ert-previewFrame', 'ert-previewFrame--center', 'ert-previewFrame--flush'],
        attr: { 'data-preview': 'backdrop-metadata' }
    });
    const backdropHoverPreviewHeading = backdropHoverPreviewContainer.createDiv({ cls: 'ert-planetary-preview-heading', text: t('settings.beats.backdrop.hoverPreviewHeading') });
    const backdropHoverPreviewBody = backdropHoverPreviewContainer.createDiv({ cls: ['ert-hover-preview-body', 'ert-stack'] });

    const renderBackdropHoverPreview = () => {
        backdropHoverPreviewBody.empty();
        const enabledFields = (plugin.settings.backdropHoverMetadataFields ?? []).filter(f => f.enabled);
        const currentBackdropAdv = plugin.settings.backdropYamlTemplates?.advanced ?? '';
        const templateObj = safeParseYaml(currentBackdropAdv);

        const backdropEditorVisible = plugin.settings.enableBackdropYamlEditor ?? false;
        if (!backdropEditorVisible || enabledFields.length === 0) {
            backdropHoverPreviewContainer.toggleClass('ert-settings-hidden', !backdropEditorVisible);
            backdropHoverPreviewHeading.setText(t('settings.beats.backdrop.hoverPreviewNoneEnabled'));
            backdropHoverPreviewBody.createDiv({ text: t('settings.beats.backdrop.hoverPreviewEnableHint'), cls: 'ert-hover-preview-empty' });
            return;
        }
        backdropHoverPreviewContainer.removeClass('ert-settings-hidden');
        backdropHoverPreviewHeading.setText(`Backdrop Hover Metadata Preview (${enabledFields.length} field${enabledFields.length > 1 ? 's' : ''})`);

        enabledFields.forEach(field => {
            const lineEl = backdropHoverPreviewBody.createDiv({ cls: 'ert-hover-preview-line' });
            const iconEl = lineEl.createSpan({ cls: 'ert-hover-preview-icon' });
            setIcon(iconEl, field.icon || DEFAULT_HOVER_ICON);
            const value = templateObj[field.key];
            const valueStr = Array.isArray(value) ? value.join(', ') : (value ?? '');
            const displayText = valueStr ? `${field.key}: ${valueStr}` : field.key;
            lineEl.createSpan({ text: displayText, cls: 'ert-hover-preview-text' });
        });
    };

    updateBackdropHoverPreview = renderBackdropHoverPreview;
    renderBackdropHoverPreview();

    // ═══════════════════════════════════════════════════════════════════════
    // YAML AUDIT + BACKFILL PANELS (Beat / Backdrop)
    // ═══════════════════════════════════════════════════════════════════════


    // ─── Place audit panels inside each editor section ───────────────────

    // Beat audit panel (inside beat YAML section, after hover preview)
    const beatAuditContainer = beatYamlSection.createDiv({ cls: ERT_CLASSES.STACK });
    const beatAudit = renderYamlAuditPanel(beatAuditContainer, {
        app, plugin, scope, noteType: 'Beat',
        workspace: {
            getActiveTab: () => getActiveBeatWorkspaceTab() ?? undefined,
            isEditable: isEditableActiveBeatWorkspace,
            isDirty: isSetDirty,
            save: () => saveCurrentCustomSet('fields'),
            getStructuralStatus: () => getBeatStructuralStatus(getActiveBeatWorkspaceName('Custom'), {
                refresh: true, loadedTab: getActiveBeatWorkspaceTab() ?? null
            })
        }
    });
    refreshBeatAuditPrimaryAction = beatAudit.refreshPrimaryAction;
    resetBeatAuditPanel = beatAudit.reset;
    refreshFillEmptyPlanAfterDefaultsChange = beatAudit.refreshDefaults;

    // Backdrop audit panel (inside backdrop YAML section, after hover preview)
    const backdropAuditContainer = backdropYamlSection.createDiv({ cls: ERT_CLASSES.STACK });
    const renderBackdropAuditVisibility = () => {
        const visible = plugin.settings.enableBackdropYamlEditor ?? false;
        backdropAuditContainer.toggleClass('ert-settings-hidden', !visible);
    };
    renderBackdropAuditVisibility();
    backdropYamlToggleBtn.addEventListener('click', () => { renderBackdropAuditVisibility(); });
    renderYamlAuditPanel(backdropAuditContainer, { app, plugin, scope, noteType: 'Backdrop' });

    function buildMissingBeatInlineSummary(structuralStatus: BeatSystemStructuralStatus): string {
        const missingDiagnostics = buildMissingBeatDiagnostics(structuralStatus);
        if (missingDiagnostics.length === 0) return '';
        const detail = missingDiagnostics
            .map((entry) => `${entry.name} (${entry.reason})`)
            .join(' · ');
        return `Missing details: ${detail}`;
    }

    function buildMissingBeatTooltip(structuralStatus: BeatSystemStructuralStatus): string | null {
        const missingDiagnostics = buildMissingBeatDiagnostics(structuralStatus);
        if (missingDiagnostics.length === 0) return null;
        const lines = missingDiagnostics.map((entry) => `- ${entry.name}\n  ${entry.reason}`);
        return `Why these beats are marked missing:\n${lines.join('\n')}`;
    }

    function updateTemplateButton(setting: Settings, selectedSystem: string): void {
        const activeTab = getActiveBeatWorkspaceTab();
        const isCustom = !!activeTab && activeTab.sourceKind !== 'builtin';
        const isTemplateMode = false;
        const isDirtyCustom = isCustom && isSetDirty();
        let displayName = activeTab?.name ?? selectedSystem;
        let baseDesc = '';
        let hasBeats = true;
        let primaryButtonDisabled = false;
        const setPrimaryDesignButton = (
            text: string,
            tooltip: string,
            disabled: boolean,
            action: () => Promise<void>
        ) => {
            primaryDesignAction = action;
            primaryButtonDisabled = disabled;
            if (!createTemplatesButton) return;
            createTemplatesButton.setButtonText(text);
            tooltipForComponent(createTemplatesButton, tooltip, 'bottom');
            createTemplatesButton.setDisabled(disabled);
            createTemplatesButton.buttonEl.classList.toggle(
                'ert-save-changes-btn--attention',
                text === 'Save changes' && !disabled
            );
        };
        const syncDesignRowMutedState = () => {
            const hasVisibleRepair = !!repairBeatNotesButton
                && !repairBeatNotesButton.buttonEl.hasClass('ert-hidden')
                && !repairBeatNotesButton.buttonEl.disabled;
            setting.settingEl.style.opacity = primaryButtonDisabled && !hasVisibleRepair ? '0.68' : '1';
        };

        if (isCustom) {
            displayName = activeTab?.name ?? getActiveCustomName('Custom');
            const beats = getActiveCustomBeats().map((b: unknown) => {
                if (typeof b === 'string') return normalizeBeatNameInput(b, '');
                if (typeof b === 'object' && b !== null && (b as { name?: unknown }).name) {
                    return normalizeBeatNameInput(String((b as { name: unknown }).name), '');
                }
                return '';
            });
            hasBeats = beats.some(b => b.length > 0);

            if (hasBeats) {
                setting.setName(`Beat notes in your vault for ${displayName}`);
                baseDesc = `Create ${beats.length} beat note files for your custom system.`;
                setting.setDesc(baseDesc);
            } else {
                setting.setName('Beat notes');
                baseDesc = 'Add at least one beat above to create beat notes.';
                setting.setDesc(baseDesc);
                setting.settingEl.addClass('ert-setting-dimmed');
            }
        } else {
            setting.setName(`Beat notes in your vault for ${selectedSystem}`);
            baseDesc = `Create ${selectedSystem} beat note files in your vault matching this system's structure.`;
            setting.setDesc(baseDesc);
        }

        updateTierBanner(selectedSystem);

        // Reset action affordances before async lookup to avoid stale "Repair" UI.
        if (isDirtyCustom) {
            setPrimaryDesignButton(
                'Save changes',
                'Save this set before creating or repairing beat notes',
                false,
                async () => { await saveCurrentCustomSet('design'); }
            );
        } else if (isTemplateMode) {
            setPrimaryDesignButton(
                'Create missing beat notes',
                'Create missing beat notes in the active book folder',
                !hasBeats,
                async () => { await createBeatTemplates(); }
            );
        } else {
            setPrimaryDesignButton(
                'Create beat notes',
                'Create beat note files in the active book folder',
                !hasBeats,
                async () => { await createBeatTemplates(); }
            );
        }
        if (repairBeatNotesButton) {
            repairBeatNotesButton.setDisabled(true);
            repairBeatNotesButton.buttonEl.addClass('ert-hidden');
        }
        syncDesignRowMutedState();
        if (isDirtyCustom) {
            setting.setDesc(`${baseDesc} Save changes before creating or repairing beat notes.`);
            return;
        }
        if (!hasBeats) return;

        void (async () => {
            const structuralStatus = getBeatStructuralStatus(selectedSystem, { refresh: true, loadedTab: activeTab ?? null });
            const activeSystem = getActiveBeatWorkspaceName('Custom');
            if (selectedSystem !== activeSystem) return;

            const summary = structuralStatus.summary;
            const newBeats = summary.missingCreateableCount;
            const hasNew = newBeats > 0;
            const missingInlineSummary = buildMissingBeatInlineSummary(structuralStatus);
            const missingTooltip = buildMissingBeatTooltip(structuralStatus);

            // ── Template mode (built-in systems): simplified status ──────
            // Built-in systems currently expose create/status on this path.
            // Repair remains focused on the active Custom system until
            // editable built-in beat definitions are migrated off static presets.
            if (isTemplateMode) {
                const foundCount = summary.matchedCount;
                const expectedCount = summary.expectedCount;

                if (foundCount === 0) {
                    // No beat notes found yet
                    setting.setDesc(baseDesc);
                    setPrimaryDesignButton(
                        'Create missing beat notes',
                        `Create ${expectedCount} beat notes for ${selectedSystem}`,
                        false,
                        async () => { await createBeatTemplates(); }
                    );
                } else if (hasNew) {
                    // Some exist, some missing
                    const statusDesc = `${foundCount} of ${expectedCount} beat notes found.`;
                    const details = missingInlineSummary ? ` ${missingInlineSummary}` : '';
                    setting.setDesc(`${baseDesc} ${statusDesc}${details}`);
                    setPrimaryDesignButton(
                        `Create ${newBeats} missing beat note${newBeats > 1 ? 's' : ''}`,
                        missingTooltip
                            ? `${missingTooltip}\n\nCreate the remaining ${newBeats} beat note${newBeats > 1 ? 's' : ''} for ${selectedSystem}`
                            : `Create the remaining ${newBeats} beat note${newBeats > 1 ? 's' : ''} for ${selectedSystem}`,
                        false,
                        async () => { await createBeatTemplates(); }
                    );
                } else {
                    // All beat notes exist
                    const statusDesc = `All ${expectedCount} beat notes created.`;
                    setting.setDesc(`${baseDesc} ${statusDesc}`);
                    setPrimaryDesignButton(
                        'Create missing beat notes',
                        'All beat notes already exist',
                        true,
                        async () => { await createBeatTemplates(); }
                    );
                }
                return;
            }

            // ── Custom mode: full health analysis ────────────────────────
            const synced = summary.syncedCount;
            const misaligned = summary.misalignedCount;
            const duplicates = summary.duplicateCount;
            const missingModel = summary.missingModelNoteCount;
            const allSynced = synced === summary.expectedCount && misaligned === 0 && duplicates === 0 && missingModel === 0;
            const hasMisaligned = misaligned > 0;
            const hasDuplicates = duplicates > 0;
            const hasMissingModel = missingModel > 0;

            if (summary.matchedCount === 0 && !hasMissingModel) {
                // Scenario A: Fresh — no existing files
                setting.setDesc(baseDesc);
                setPrimaryDesignButton(
                    'Create beat notes',
                    `Create ${summary.expectedCount} beat note files`,
                    false,
                    async () => { await createBeatTemplates(); }
                );
                syncDesignRowMutedState();
                return;
            }

            // Build concise status description from non-zero counts
            const parts: string[] = [];
            if (synced > 0) parts.push(`${synced} synced`);
            if (misaligned > 0) parts.push(`${misaligned} misaligned`);
            if (newBeats > 0) parts.push(`${newBeats} missing`);
            if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''}`);
            if (missingModel > 0) parts.push(`Missing Beat Model (${missingModel})`);
            let statusDesc = parts.join(', ') + '.';

            if (allSynced) {
                // Scenario B: All synced — nothing to do
                statusDesc = `All ${summary.expectedCount} beat notes are synced.`;
                if (createTemplatesButton) {
                    setPrimaryDesignButton(
                        createTemplatesButton.buttonEl.textContent || 'Create beat notes',
                        'All beats already have aligned files',
                        true,
                        async () => { await createBeatTemplates(); }
                    );
                }
            } else if (hasNew) {
                // Scenario D: Has new beats to create
                if (missingInlineSummary) {
                    statusDesc += ` ${missingInlineSummary}`;
                }
                if (createTemplatesButton) {
                    setPrimaryDesignButton(
                        `Create ${newBeats} missing beat note${newBeats > 1 ? 's' : ''}`,
                        missingTooltip
                            ? `${missingTooltip}\n\nCreate missing beat notes for ${newBeats} beat${newBeats > 1 ? 's' : ''} without files`
                            : `Create missing beat notes for ${newBeats} beat${newBeats > 1 ? 's' : ''} without files`,
                        false,
                        async () => { await createBeatTemplates(); }
                    );
                }
            } else {
                // Scenario C: All matched, some misaligned — no new beats
                if (createTemplatesButton) {
                    setPrimaryDesignButton(
                        createTemplatesButton.buttonEl.textContent || 'Create beat notes',
                        hasMissingModel
                            ? 'All beats have files. Use Repair to set missing Beat Model values.'
                            : 'All beats have files. Use Repair to fix Act and Beat Model.',
                        true,
                        async () => { await createBeatTemplates(); }
                    );
                }
            }

            // Show Repair only when the beat-note audit reports canonical mismatches.
            if (repairBeatNotesButton && isCustom && (hasMisaligned || hasMissingModel)) {
                repairBeatNotesButton.buttonEl.removeClass('ert-hidden');
                repairBeatNotesButton.setDisabled(false);
                const repairCount = misaligned + missingModel;
                repairBeatNotesButton.setButtonText(`Repair ${repairCount} beat note${repairCount > 1 ? 's' : ''}`);
                const repairBits: string[] = [];
                if (misaligned > 0) repairBits.push(`${misaligned} misaligned`);
                if (missingModel > 0) repairBits.push(`${missingModel} missing Beat Model`);
                repairBeatNotesButton.setTooltip(`Update Act and Beat Model for ${repairBits.join(' and ')} beat note${repairCount > 1 ? 's' : ''}. Prefix numbers are not changed.`);
            }


            if (hasDuplicates) {
                statusDesc += ` Resolve duplicate${duplicates > 1 ? 's' : ''} before merging. Manually delete duplicate beat notes.`;
            }

            setting.setDesc(`${baseDesc} ${statusDesc}`);
            syncDesignRowMutedState();

            // Refresh the health icon in the Design header
            refreshHealthIcon?.();
            // Keep top-level workspace tab status icon/label in sync.
            renderBeatSystemTabs();
        })();
    }

    async function mergeExistingBeatNotes(): Promise<void> {
        const activeTab = getActiveBeatWorkspaceTab();
        if (!activeTab || activeTab.sourceKind === 'builtin') {
            new Notice('Merge is available for custom beat systems only.');
            return;
        }
        const storyStructureName = activeTab.name;

        const maxActs = getActCount();
        const beats: BeatRow[] = orderBeatsByAct(
            getActiveCustomBeats()
                .map(parseBeatRow)
                .map(b => ({ ...b, act: clampBeatAct(b.act, maxActs) })),
            maxActs
        );
        if (beats.length === 0) {
            new Notice('No custom beats defined. Add beats in the list above.');
            return;
        }

        const structuralStatus = getBeatStructuralStatus(storyStructureName, { refresh: true, loadedTab: activeTab });
        if (structuralStatus.summary.matchedCount === 0 && structuralStatus.summary.missingModelNoteCount === 0) {
            new Notice('No existing beat notes found to merge.');
            return;
        }

        const { updates, duplicates } = planBeatNoteMerge(beats, structuralStatus);
        if (updates.length === 0) {
            const duplicateHint = duplicates.length > 0 ? ` Duplicates: ${duplicates.length}. Manually delete duplicate beat notes.` : '';
            new Notice(`No beat notes could be merged.${duplicateHint}`);
            return;
        }

        await applyBeatNoteMerge(app, updates, storyStructureName);
        invalidateBeatStructuralStatus();
        // Let the metadata cache re-index the stamped notes before the status refresh reads them.
        await waitForMetadataResolved(app, 1500);
        getBeatStructuralStatus(storyStructureName, { refresh: true });
        updateTemplateButton(templateSetting, storyStructureName);
        refreshCustomBeatList?.();
        renderPreviewContent(storyStructureName, { skipStatusRefresh: true });
        renderBeatSystemTabs();

        const updatedCount = updates.length;
        const modelFixedCount = updates.filter(update => update.needsBeatModelFix).length;
        const duplicateHint = duplicates.length > 0 ? ` ${duplicates.length} duplicate title${duplicates.length > 1 ? 's' : ''} skipped (manually delete duplicate beat notes).` : '';
        const modelHint = modelFixedCount > 0 ? ` Set Beat Model on ${modelFixedCount} note${modelFixedCount > 1 ? 's' : ''}.` : '';
        new Notice(`Repaired ${updatedCount} beat note${updatedCount > 1 ? 's' : ''} (Act, Beat Model).${modelHint}${duplicateHint}`);
    }

    async function createBeatTemplates(): Promise<void> {
        const activeTab = getActiveBeatWorkspaceTab();
        const storyStructureName = activeTab?.name ?? resolveSelectedBeatModelFromSettings(plugin.settings) ?? 'Custom';

        let storyStructure = getPlotSystem(storyStructureName);
        if (!storyStructure && activeTab) {
            storyStructure = buildPlotSystemFromLoadedTab(activeTab);
            if (!storyStructure) {
                new Notice('No custom beats defined. Add beats in the list above.');
                return;
            }
        }

        if (!storyStructure) {
            new Notice(`Unknown story structure: ${storyStructureName}`);
            return;
        }

        const actRanges = await collectActRanges(true);
        const actSceneNumbers = new Map<number, number[]>();
        actRanges?.forEach((range, act) => {
            actSceneNumbers.set(act, range.sceneNumbers);
        });
        
        const beatTemplate = getTemplateParts('Beat', plugin.settings).merged;
        const modal = new CreateBeatSetModal(
            app,
            plugin,
            storyStructureName,
            storyStructure.beatCount || storyStructure.beats.length,
            beatTemplate
        );
        modal.open();
        const result = await modal.waitForConfirmation();
        if (!result.confirmed) return;
        try {
            const sourcePath = plugin.settings.sourcePath || '';
            const { created, skipped, errors, createdPaths } = await createBeatNotesFromSet(
                app.vault,
                storyStructureName,
                sourcePath,
                getPlotSystem(storyStructureName) ? undefined : storyStructure,
                { actSceneNumbers: actSceneNumbers.size > 0 ? actSceneNumbers : undefined, beatTemplate }
            );
            if (errors.length > 0) {
                new Notice(`Created ${created} notes. ${skipped} skipped. ${errors.length} errors. Check console.`);
                console.error('[Beat Templates] Errors:', errors);
            } else if (created === 0 && skipped > 0) {
                new Notice(`All ${skipped} Beat notes already exist. No new notes created.`);
            } else {
                new Notice(`✓ Successfully created ${created} Beat set notes!`);
            }
            invalidateBeatStructuralStatus();
            // Every new beat file must be in the metadata cache before the row state is read,
            // or the list shows a partial set (e.g. 2 of 3 rows recognised).
            await waitForFileCaches(app, createdPaths);
            getBeatStructuralStatus(storyStructureName, { refresh: true });
            updateTemplateButton(templateSetting, storyStructureName);
            refreshCustomBeatList?.();
            renderPreviewContent(storyStructureName, { skipStatusRefresh: true });
            renderBeatSystemTabs();
        } catch (error) {
            console.error('[Beat Templates] Failed:', error);
            new Notice(`Failed to create story beat sets: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
