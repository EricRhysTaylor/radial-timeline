import { buildPresetClassConfig } from './inquiry/sourcePresets';
import { openSettingsTab } from '../../utils/obsidianInternals';
import { App, ButtonComponent, DropdownComponent, Modal, Setting as Settings, TextComponent, TextAreaComponent, normalizePath, Notice, setIcon, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { DEFAULT_SETTINGS } from '../defaults';
import type {
    InquiryClassConfig,
    InquiryCorpusThresholds,
    InquiryPromptConfig,
    InquiryPromptSlot,
    SceneInclusion,
    InquirySourcesPreset
} from '../../types/settings';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { t } from '../../i18n';
import { ERT_CLASSES } from '../../ui/classes';
import { badgePill } from '../../ui/ui';
import { hasProFeatureAccess } from '../featureGate';
import {
    buildDefaultInquiryPromptConfig,
    createCanonicalPromptSlotById,
    getCanonicalQuestionForSlot,
    getInquiryPromptSlotState,
    getInquiryZoneDescription,
    isCanonicalPromptSlot,
    normalizeInquiryPromptConfig,
    replaceCanonicalPromptSlots,
    syncCanonicalPromptSlot
} from '../../inquiry/prompts';
import type { InquiryZone } from '../../inquiry/state';
import {
    ALL_CANONICAL_QUESTIONS,
    CORE_CANONICAL_QUESTIONS,
    groupCanonicalQuestionsByZone,
    type InquiryCanonicalQuestionDefinition
} from '../../inquiry/questions/canonicalQuestions';
import {
    MAX_RESOLVED_SCAN_ROOTS,
    normalizeScanRootPatterns,
    parseScanRootInput,
    resolveScanRoots,
    toDisplayRoot
} from '../../inquiry/utils/scanRoots';
import {
    findInquiryBookForPath,
    resolveBookManagerInquiryBooks,
    type InquiryBookResolution,
    type InquiryResolvedBook
} from '../../inquiry/services/bookResolution';
import {
    getDefaultMaterialMode,
    isSynopsisCapableClass,
    normalizeClassContribution,
    normalizeContributionMode,
    normalizeInquirySources,
    normalizeMaterialMode
} from '../../inquiry/services/InquiryCorpusService';
import { resolveInquirySourceRoots } from '../../inquiry/utils/sourceRoots';
import { replayTransientClass } from '../../utils/domClassEffects';

interface SectionParams {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    attachFolderSuggest?: (text: TextComponent) => void;
}

const listToText = (values?: string[]): string =>
    (values || []).join('\n');

// Core book-project classes — the only classes that exist without discovery.
const CORE_CLASSES = ['scene', 'outline'];
const PRESET_MATCH_ORDER: InquirySourcesPreset[] = ['default', 'light', 'deep'];

const getContributionLabel = (mode: SceneInclusion): string => {
    switch (mode) {
        case 'excluded': return t('settings.inquiry.contribution.excluded');
        case 'summary': return t('settings.inquiry.contribution.summary');
        case 'full': return t('settings.inquiry.contribution.full');
        default: return mode;
    }
};

const defaultModeForClass = (className: string): SceneInclusion => {
    return getDefaultMaterialMode(className);
};

const getContributionModesForClass = (className: string): SceneInclusion[] =>
    isSynopsisCapableClass(className) ? ['excluded', 'summary', 'full'] : ['excluded', 'full'];

const defaultClassConfig = (className: string): InquiryClassConfig => {
    const normalized = className.toLowerCase();
    const isScene = normalized === 'scene';
    const isOutline = normalized === 'outline';
    const isReference = !isSynopsisCapableClass(normalized);
    return {
        className: normalized,
        enabled: false,
        bookScope: isReference ? 'excluded' : (isScene ? 'summary' : (isOutline ? 'full' : defaultModeForClass(normalized))),
        sagaScope: isReference ? 'excluded' : (isOutline ? 'full' : 'excluded'),
        referenceScope: isReference ? 'full' : 'excluded'
    };
};

const mergeClassConfigs = (existing: InquiryClassConfig[], discovered: string[]): InquiryClassConfig[] => {
    const byName = new Map(existing.map(config => [config.className, config]));
    // Start from discovered classes only — stale names not in discovered are pruned.
    const names = new Set<string>(discovered);
    const sorted = Array.from(names).sort((a, b) => {
        const aIdx = CORE_CLASSES.indexOf(a);
        const bIdx = CORE_CLASSES.indexOf(b);
        if (aIdx !== -1 || bIdx !== -1) {
            return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        }
        return a.localeCompare(b);
    });
    return sorted.map(name => byName.get(name) ?? defaultClassConfig(name));
};

const normalizeCorpusThresholds = (raw?: InquiryCorpusThresholds): InquiryCorpusThresholds => {
    const fallback = DEFAULT_SETTINGS.inquiryCorpusThresholds || {
        emptyMax: 10,
        sketchyMin: 100,
        mediumMin: 300,
        substantiveMin: 1000
    };
    return {
        emptyMax: Number.isFinite(raw?.emptyMax ?? fallback.emptyMax) ? Number(raw?.emptyMax ?? fallback.emptyMax) : fallback.emptyMax,
        sketchyMin: Number.isFinite(raw?.sketchyMin ?? fallback.sketchyMin) ? Number(raw?.sketchyMin ?? fallback.sketchyMin) : fallback.sketchyMin,
        mediumMin: Number.isFinite(raw?.mediumMin ?? fallback.mediumMin) ? Number(raw?.mediumMin ?? fallback.mediumMin) : fallback.mediumMin,
        substantiveMin: Number.isFinite(raw?.substantiveMin ?? fallback.substantiveMin)
            ? Number(raw?.substantiveMin ?? fallback.substantiveMin)
            : fallback.substantiveMin
    };
};

const validateCorpusThresholds = (next: InquiryCorpusThresholds): string | null => {
    if (!Number.isFinite(next.emptyMax) || next.emptyMax < 0) return t('settings.inquiry.corpus.errorEmptyMax');
    if (!Number.isFinite(next.sketchyMin) || next.sketchyMin <= next.emptyMax) return t('settings.inquiry.corpus.errorSketchyMin');
    if (!Number.isFinite(next.mediumMin) || next.mediumMin <= next.sketchyMin) return t('settings.inquiry.corpus.errorMediumMin');
    if (!Number.isFinite(next.substantiveMin) || next.substantiveMin <= next.mediumMin) {
        return t('settings.inquiry.corpus.errorSubstantiveMin');
    }
    return null;
};

export function renderInquirySection(params: SectionParams): void {
    const { app, plugin, containerEl } = params;
    containerEl.addClass('ert-settings-inquiry-root');

    const createSection = (
        parent: HTMLElement,
        options: { title: string; desc?: string; icon: string; wiki?: string; headingClass?: string; role?: string }
    ) => {
        const header = new Settings(parent).setName(options.title);
        if (options.desc) {
            header.setDesc(options.desc);
        }
        header.setHeading();
        if (options.headingClass) {
            header.settingEl.addClass(options.headingClass);
        }
        if (options.role) {
            header.settingEl.setAttribute('data-ert-role', options.role);
        }
        addHeadingIcon(header, options.icon);
        if (options.wiki) {
            addWikiLink(header, options.wiki);
        }
        applyErtHeaderLayout(header);

        return parent.createDiv({ cls: [ERT_CLASSES.SECTION_BODY, ERT_CLASSES.STACK] });
    };

    let inquirySources = normalizeInquirySources(plugin.settings.inquirySources);
    plugin.settings.inquirySources = inquirySources;

    const promptsBody = createSection(containerEl, {
        title: t('settings.inquiry.prompts.name'),
        icon: 'list',
        wiki: 'Settings-Inquiry#prompts'
    });
    renderPromptConfiguration(promptsBody);

    const sourcesBody = createSection(containerEl, {
        title: t('settings.inquiry.sources.name'),
        icon: 'search',
        wiki: 'Settings-Inquiry#sources',
        role: 'inquiry-setting:sources-heading'
    });

    let scanRootsInput: TextAreaComponent | null = null;
    const scanRootActionSyncers: Array<() => void> = [];
    const autoResizeTextAreaRows = (inputEl: HTMLTextAreaElement, minRows: number) => {
        const style = window.getComputedStyle(inputEl);
        const lineHeight = Number.parseFloat(style.lineHeight) || 20;
        const padTop = Number.parseFloat(style.paddingTop) || 0;
        const padBottom = Number.parseFloat(style.paddingBottom) || 0;
        const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
        const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
        const minHeight = (lineHeight * minRows) + padTop + padBottom + borderTop + borderBottom;
        inputEl.rows = minRows;
        if (inputEl.scrollHeight <= minHeight) return;
        const extraHeight = inputEl.scrollHeight - minHeight;
        const extraRows = Math.ceil(extraHeight / lineHeight);
        inputEl.rows = minRows + extraRows;
    };
    const registerDeferredAutoResize = (inputEl: HTMLTextAreaElement, minRows: number): (() => void) => {
        const runResize = () => autoResizeTextAreaRows(inputEl, minRows);

        const rafId = window.requestAnimationFrame(() => {
            runResize();
        });
        plugin.register(() => {
            window.cancelAnimationFrame(rafId);
        });

        const timeoutId = window.setTimeout(() => {
            runResize();
        }, 0);
        plugin.register(() => {
            window.clearTimeout(timeoutId);
        });

        if (typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(() => {
                runResize();
            });
            resizeObserver.observe(inputEl);
            plugin.register(() => {
                resizeObserver.disconnect();
            });
        }

        return runResize;
    };

    const openBookManager = () => {
        if (plugin.settingsTab) {
            plugin.settingsTab.setActiveTab('core');
        }
        openSettingsTab(app);
    };

    const booksForInquiryPreview = sourcesBody.createDiv({
        cls: [ERT_CLASSES.PREVIEW_FRAME, ERT_CLASSES.STACK, 'ert-previewFrame--flush'],
        attr: { 'data-preview': 'inquiry-books-for-inquiry' }
    });
    const booksForInquiryHeader = booksForInquiryPreview.createDiv({
        cls: ['ert-previewFrame__header', ERT_CLASSES.INLINE]
    });
    const booksForInquiryTitleWrap = booksForInquiryHeader.createDiv({ cls: ERT_CLASSES.STACK });
    booksForInquiryTitleWrap.createDiv({
        cls: ['ert-planetary-preview-heading', 'ert-previewFrame__title'],
        text: t('settings.inquiry.booksForInquiry.name')
    });
    booksForInquiryTitleWrap.createDiv({
        cls: 'setting-item-description',
        text: t('settings.inquiry.booksForInquiry.desc')
    });
    const manageBooksBtn = booksForInquiryHeader.createEl('button', {
        text: t('settings.inquiry.booksForInquiry.buttonText'),
        attr: { type: 'button', 'aria-label': t('settings.inquiry.booksForInquiry.ariaLabel') }
    });
    plugin.registerDomEvent(manageBooksBtn, 'click', (evt) => {
        evt.preventDefault();
        openBookManager();
    });
    const booksForInquiryList = booksForInquiryPreview.createDiv({
        cls: ['ert-controlGroup', 'ert-controlGroup--inquiry-books']
    });

    const materialRulesHeader = new Settings(sourcesBody)
        .setName(t('settings.inquiry.materialRules.name'))
        .setDesc(t('settings.inquiry.materialRules.desc'));
    materialRulesHeader.setHeading();
    applyErtHeaderLayout(materialRulesHeader);

    const scanRootsSetting = new Settings(sourcesBody)
        .setName(t('settings.inquiry.scanRoots.name'))
        .setDesc(t('settings.inquiry.scanRoots.desc'));
    scanRootsSetting.settingEl.setAttribute('data-ert-role', 'inquiry-setting:scan-roots');
    scanRootsSetting.settingEl.classList.add(ERT_CLASSES.ROW, 'ert-row--stack');

    const scanRootsText = new TextAreaComponent(scanRootsSetting.controlEl);
    scanRootsText.setValue(listToText(inquirySources.scanRoots));
    scanRootsText.setPlaceholder(t('settings.inquiry.scanRoots.placeholder'));
    scanRootsText.inputEl.rows = 3;
    scanRootsText.inputEl.addClass('ert-textarea--wide');
    scanRootsText.inputEl.addClass('mod-styled-scrollbar');
    scanRootsInput = scanRootsText;
    const autoResizeScanRootsInput = registerDeferredAutoResize(scanRootsText.inputEl, 3);
    autoResizeScanRootsInput();

    plugin.registerDomEvent(scanRootsText.inputEl, 'input', () => {
        autoResizeScanRootsInput();
    });

    plugin.registerDomEvent(scanRootsText.inputEl, 'blur', () => {
        const nextRoots = parseScanRootInput(scanRootsText.getValue());
        applyScanRoots(nextRoots);
    });

    const scanRootActions = scanRootsSetting.controlEl.createDiv({
        cls: [ERT_CLASSES.INLINE, 'ert-actions', 'ert-preset-controls']
    });
    const MAX_SCAN_PRESET_CHECK_ROOTS = 5000;
    const isScanPresetCovered = (presetRoots: string[], selectedRoots: string[]): boolean => {
        const normalizedPreset = normalizeScanRootPatterns(presetRoots);
        const normalizedSelected = normalizeScanRootPatterns(selectedRoots);
        if (!normalizedPreset.length || !normalizedSelected.length) return false;
        const selectedSet = new Set(normalizedSelected);
        if (normalizedPreset.every(root => selectedSet.has(root))) return true;

        const presetResolved = resolveScanRoots(normalizedPreset, plugin.app.vault, MAX_SCAN_PRESET_CHECK_ROOTS).resolvedRoots;
        if (!presetResolved.length) return false;
        const selectedResolved = resolveScanRoots(normalizedSelected, plugin.app.vault, MAX_SCAN_PRESET_CHECK_ROOTS).resolvedRoots;
        if (!selectedResolved.length) return false;
        const selectedResolvedSet = new Set(selectedResolved);
        return presetResolved.every(root => selectedResolvedSet.has(root));
    };

    const addScanRootToggle = (
        label: string,
        resolveRoots: () => string[],
        emptyNotice?: string
    ) => {
        const btn = scanRootActions.createEl('button', {
            text: label,
            attr: { type: 'button' }
        });
        const syncButtonState = () => {
            const roots = normalizeScanRootPatterns(resolveRoots());
            const hasRoots = roots.length > 0;
            const selectedRoots = normalizeScanRootPatterns(inquirySources.scanRoots || []);
            const rootSet = new Set(selectedRoots);
            const explicitlyActive = hasRoots && roots.every(root => rootSet.has(root));
            const isActive = explicitlyActive || (hasRoots && isScanPresetCovered(roots, selectedRoots));
            btn.classList.toggle('mod-cta', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            btn.disabled = !hasRoots;
        };
        plugin.registerDomEvent(btn, 'click', (evt) => {
            evt.preventDefault();
            const roots = normalizeScanRootPatterns(resolveRoots());
            if (!roots.length) {
                if (emptyNotice) new Notice(emptyNotice);
                return;
            }
            const rootSet = new Set(normalizeScanRootPatterns(inquirySources.scanRoots || []));
            const explicitlyActive = roots.every(root => rootSet.has(root));
            if (explicitlyActive) {
                roots.forEach(root => rootSet.delete(root));
            } else {
                roots.forEach(root => rootSet.add(root));
            }
            applyScanRoots(Array.from(rootSet));
        });
        scanRootActionSyncers.push(syncButtonState);
        syncButtonState();
    };

    addScanRootToggle(t('settings.inquiry.scanRoots.characterFolder'), () => ['/Character/']);
    addScanRootToggle(t('settings.inquiry.scanRoots.placeFolder'), () => ['/Place/']);
    addScanRootToggle(t('settings.inquiry.scanRoots.commonSupportFolders'), () => ['/Character/', '/Place/', '/Lore/', '/Research/']);

    let resolvedRootCache: { signature: string; resolvedRoots: string[] } | null = null;
    let resolvedBookCache: InquiryBookResolution | null = null;

    const presetSetting = new Settings(sourcesBody)
        .setName(t('settings.inquiry.presets.name'))
        .setDesc(t('settings.inquiry.presets.desc'));
    presetSetting.settingEl.setAttribute('data-ert-role', 'inquiry-setting:class-presets');
    presetSetting.settingEl.addClass(ERT_CLASSES.ROW, ERT_CLASSES.ROW_TIGHT);
    const presetControls = presetSetting.controlEl.createDiv({ cls: [ERT_CLASSES.INLINE, 'ert-preset-controls'] });
    const presetButtons = new Map<InquirySourcesPreset, HTMLButtonElement>();

    const inferPresetFromClasses = (classes: InquiryClassConfig[] | undefined): InquirySourcesPreset | null => {
        if (!classes || !classes.length) return null;
        const byName = new Map<string, InquiryClassConfig>();
        classes.forEach(config => {
            const className = config.className.toLowerCase();
            byName.set(className, normalizeClassContribution({
                className,
                enabled: !!config.enabled,
                bookScope: normalizeMaterialMode(config.bookScope, className),
                sagaScope: normalizeMaterialMode(config.sagaScope, className),
                referenceScope: normalizeMaterialMode(config.referenceScope, className)
            }));
        });

        const matchesPreset = (preset: InquirySourcesPreset): boolean => {
            return Array.from(byName.keys()).every(className => {
                const current = byName.get(className) ?? defaultClassConfig(className);
                const expected = buildPresetClassConfig(current, preset);
                return current.enabled === expected.enabled
                    && current.bookScope === expected.bookScope
                    && current.sagaScope === expected.sagaScope
                    && current.referenceScope === expected.referenceScope;
            });
        };

        for (const preset of PRESET_MATCH_ORDER) {
            if (matchesPreset(preset)) return preset;
        }
        return null;
    };

    const getEffectivePresetSelection = (): InquirySourcesPreset | null => {
        if (inquirySources.preset) return inquirySources.preset;
        return inferPresetFromClasses(inquirySources.classes);
    };

    const syncPresetButtons = () => {
        const activePreset = getEffectivePresetSelection();
        presetButtons.forEach((button, key) => {
            const isActive = activePreset === key;
            button.classList.toggle('mod-cta', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    const addPresetButton = (preset: InquirySourcesPreset, label: string) => {
        const btn = presetControls.createEl('button', {
            text: label,
            attr: { type: 'button' }
        });
        plugin.registerDomEvent(btn, 'click', (evt) => {
            evt.preventDefault();
            applyPreset(preset);
        });
        presetButtons.set(preset, btn);
    };

    addPresetButton('default', t('settings.inquiry.presets.default'));
    addPresetButton('light', t('settings.inquiry.presets.light'));
    addPresetButton('deep', t('settings.inquiry.presets.deep'));

    const tableCard = sourcesBody.createDiv({ cls: ERT_CLASSES.PANEL });
    const classTableWrap = tableCard.createDiv({
        cls: ['ert-controlGroup', 'ert-controlGroup--class-scope', 'ert-controlGroup--inquiry-material-rules']
    });

    const scanInquiryClasses = async (
        roots: string[],
        includePath?: (path: string) => boolean,
        containerCandidates: InquiryResolvedBook[] = []
    ): Promise<{
        discoveredCounts: Record<string, number>;
        discoveredClasses: string[];
        containerClassCounts: Record<string, Record<string, number>>;
        classSources: Record<string, Set<string>>;
    }> => {
        if (!roots.length) {
            return { discoveredCounts: {}, discoveredClasses: [], containerClassCounts: {}, classSources: {} };
        }
        const discoveredCounts: Record<string, number> = {};
        const classSources: Record<string, Set<string>> = {};
        const containerClassCounts: Record<string, Record<string, number>> = {};
        containerCandidates.forEach(candidate => {
            containerClassCounts[candidate.rootPath] = {};
        });
        const files = plugin.app.vault.getMarkdownFiles();
        const resolvedVaultRoots = roots;

        const inRoots = (path: string) => {
            return resolvedVaultRoots.some(root => !root || path === root || path.startsWith(`${root}/`));
        };

        const matchingRoot = (path: string): string | undefined => {
            return resolvedVaultRoots.find(root => root && path.startsWith(`${root}/`));
        };

        files.forEach(file => {
            if (!inRoots(file.path)) return;
            const cache = plugin.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;
            if (!frontmatter) return;
            const normalized = normalizeFrontmatterKeys(frontmatter, getActiveFrontmatterMappings(plugin.settings));
            const rawClass = normalized['Class'];
            if (!rawClass) return;
            const values = Array.isArray(rawClass) ? rawClass : [rawClass];
            const ownerContainer = containerCandidates.length
                ? findInquiryBookForPath(file.path, containerCandidates)
                : undefined;
            const includeInDiscoveredCounts = !includePath || includePath(file.path);
            const root = matchingRoot(file.path);
            values.forEach(value => {
                const name = typeof value === 'string' ? value.trim() : String(value).trim();
                if (!name) return;
                const key = name.toLowerCase();
                if (includeInDiscoveredCounts) {
                    discoveredCounts[key] = (discoveredCounts[key] || 0) + 1;
                    if (root) {
                        (classSources[key] ||= new Set()).add(toDisplayRoot(root));
                    }
                }
                if (ownerContainer?.rootPath) {
                    const bucket = containerClassCounts[ownerContainer.rootPath] || {};
                    bucket[key] = (bucket[key] || 0) + 1;
                    containerClassCounts[ownerContainer.rootPath] = bucket;
                }
            });
        });

        return {
            discoveredCounts,
            discoveredClasses: Object.keys(discoveredCounts).sort(),
            containerClassCounts,
            classSources
        };
    };

    const renderClassTable = (configs: InquiryClassConfig[], counts: Record<string, number>, classSources?: Record<string, Set<string>>) => {
        // Build into a temporary container then replace in one go to avoid empty-then-rebuild flicker.
        const container = classTableWrap.ownerDocument.win.createDiv();
        container.className = classTableWrap.className;
        const buildRow = (extraClasses: string[] = []) =>
            container.createDiv({ cls: ['ert-controlGroup__row', ...extraClasses] });

        const header = buildRow(['ert-controlGroup__row--header']);
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.classTable.enabled') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.classTable.class') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.classTable.book') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.classTable.saga') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.classTable.reference') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.classTable.matches') });

        configs.forEach(config => {
            const row = buildRow(['ert-controlGroup__row--card']);
            const rowDisabled = !config.enabled;
            row.toggleClass('is-disabled', rowDisabled);
            const enabledCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
            const enabledToggle = enabledCell.createEl('input', { type: 'checkbox' });
            enabledToggle.checked = config.enabled;
            plugin.registerDomEvent(enabledToggle, 'change', () => {
                inquirySources = {
                    ...inquirySources,
                    classes: (inquirySources.classes || []).map(entry =>
                        entry.className === config.className ? { ...entry, enabled: enabledToggle.checked } : entry
                    )
                };
                void refreshClassScan();
            });

            const nameCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
            nameCell.createEl('strong', { text: config.className });
            const sources = classSources?.[config.className];
            if (sources?.size) {
                const sourceLabel = Array.from(sources).sort().join(', ');
                nameCell.createSpan({
                    cls: 'ert-controlGroup__cell--meta ert-controlGroup__cell--faint',
                    text: `from ${sourceLabel}`
                });
            }

            const isSynopsisCapable = isSynopsisCapableClass(config.className);
            const isReference = !isSynopsisCapable;

            // Size must match --class-scope grid columns: repeat(3, minmax(var(--ert-input-width-sm), max-content))
            const buildScopeSelect = (
                cell: HTMLElement,
                value: SceneInclusion,
                disabled: boolean,
                modes: SceneInclusion[],
                onChange: (next: SceneInclusion) => void
            ) => {
                const select = cell.createEl('select', { cls: 'ert-input ert-input--sm' });
                modes.forEach(mode => {
                    select.createEl('option', { value: mode, text: getContributionLabel(mode) });
                });
                select.value = value;
                select.disabled = disabled;
                plugin.registerDomEvent(select, 'change', () => {
                    onChange(select.value as SceneInclusion);
                });
            };

            const updateClassConfig = (patch: Partial<InquiryClassConfig>) => {
                inquirySources = {
                    ...inquirySources,
                    classes: (inquirySources.classes || []).map(entry =>
                        entry.className === config.className ? normalizeClassContribution({ ...entry, ...patch }) : entry
                    )
                };
                void refreshClassScan();
            };

            const bookCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
            if (!isSynopsisCapable) {
                bookCell.createSpan({ cls: 'ert-controlGroup__cell--meta', text: '—' });
            } else {
                buildScopeSelect(
                    bookCell,
                    normalizeContributionMode(config.bookScope, config.className),
                    rowDisabled,
                    getContributionModesForClass(config.className),
                    (next) => {
                        updateClassConfig({ bookScope: normalizeContributionMode(next, config.className) });
                    }
                );
            }

            const sagaCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
            if (!isSynopsisCapable) {
                sagaCell.createSpan({ cls: 'ert-controlGroup__cell--meta', text: '—' });
            } else {
                buildScopeSelect(
                    sagaCell,
                    normalizeContributionMode(config.sagaScope, config.className),
                    rowDisabled,
                    getContributionModesForClass(config.className),
                    (next) => {
                        updateClassConfig({ sagaScope: normalizeContributionMode(next, config.className) });
                    }
                );
            }

            const referenceCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
            if (isReference) {
                buildScopeSelect(
                    referenceCell,
                    normalizeContributionMode(config.referenceScope, config.className),
                    rowDisabled,
                    getContributionModesForClass(config.className),
                    (next) => {
                        updateClassConfig({ referenceScope: normalizeContributionMode(next, config.className) });
                    }
                );
            } else {
                referenceCell.createSpan({ cls: 'ert-controlGroup__cell--meta', text: '—' });
            }

            const countCell = row.createDiv({
                cls: ['ert-controlGroup__cell', 'ert-controlGroup__cell--meta', 'ert-controlGroup__cell--mono']
            });
            const count = counts[config.className] ?? 0;
            countCell.setText(t('settings.inquiry.classTable.matchCount', { count }));
            if (!count) {
                countCell.addClass('ert-controlGroup__cell--faint');
            }

            nameCell.setAttribute('title', config.className);
        });

        classTableWrap.replaceChildren(...Array.from(container.children));
    };

    const applyPreset = (preset: InquirySourcesPreset) => {
        const nextClasses = (inquirySources.classes || []).map(config => buildPresetClassConfig(config, preset));
        inquirySources = {
            ...inquirySources,
            preset,
            classes: nextClasses
        };
        syncPresetButtons();
        void refreshClassScan();
    };
    syncPresetButtons();

    const getInquiryBookStatus = (classCounts: Record<string, number>) => {
        const sceneCount = classCounts.scene || 0;
        const outlineCount = classCounts.outline || 0;
        if (sceneCount > 0 && outlineCount > 0) {
            return { label: t('settings.inquiry.bookStatus.ready'), cls: 'ert-controlGroup__status--ready' };
        }
        if (sceneCount <= 0 && outlineCount <= 0) {
            return { label: t('settings.inquiry.bookStatus.missingScenesAndOutline'), cls: 'ert-controlGroup__status--warning' };
        }
        if (sceneCount <= 0) {
            return { label: t('settings.inquiry.bookStatus.missingScenes'), cls: 'ert-controlGroup__status--warning' };
        }
        return { label: t('settings.inquiry.bookStatus.missingOutline'), cls: 'ert-controlGroup__status--warning' };
    };

    const renderBooksForInquiry = (
        resolution: InquiryBookResolution,
        containerClassCounts: Record<string, Record<string, number>>
    ) => {
        const container = booksForInquiryList.ownerDocument.win.createDiv();
        container.className = booksForInquiryList.className;
        const header = container.createDiv({ cls: ['ert-controlGroup__row', 'ert-controlGroup__row--header'] });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.booksTable.sequence') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.booksTable.book') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.booksTable.detectedMaterial') });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.booksTable.status') });

        if (!resolution.candidates.length) {
            const emptyRow = container.createDiv({ cls: ['ert-controlGroup__row', 'ert-controlGroup__row--card'] });
            emptyRow.createDiv({
                cls: ['ert-controlGroup__cell', 'ert-controlGroup__cell--faint', 'ert-controlGroup__cell--span'],
                text: t('settings.inquiry.booksTable.empty')
            });
        } else {
            resolution.candidates.forEach(book => {
                const row = container.createDiv({ cls: ['ert-controlGroup__row', 'ert-controlGroup__row--card'] });
                const sequenceCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
                sequenceCell.createSpan({
                    cls: 'ert-controlGroup__sequenceBadge',
                    text: `B${book.bookNumber ?? '?'}`
                });

                const managerMatch = (plugin.settings.books || []).find(entry =>
                    normalizePath((entry.sourceFolder || '').trim()) === normalizePath(book.rootPath)
                );
                const bookCell = row.createDiv({ cls: ['ert-controlGroup__cell', 'ert-controlGroup__cell--stack'] });
                bookCell.createEl('strong', {
                    cls: 'ert-controlGroup__containerTitle',
                    text: managerMatch?.title?.trim() || (toDisplayRoot(book.rootPath).split('/').filter(Boolean).pop() || toDisplayRoot(book.rootPath))
                });
                bookCell.createDiv({
                    cls: ['ert-controlGroup__cell--meta', 'ert-controlGroup__cell--mono'],
                    text: toDisplayRoot(book.rootPath)
                });

                const counts = containerClassCounts[book.rootPath] || {};
                const sceneCount = counts.scene || 0;
                const outlineCount = counts.outline || 0;
                const countsCell = row.createDiv({ cls: ['ert-controlGroup__cell', 'ert-controlGroup__cell--meta'] });
                countsCell.setText(t('settings.inquiry.booksTable.materialCounts', { sceneCount, outlineCount }));

                const status = getInquiryBookStatus(counts);
                const statusCell = row.createDiv({ cls: 'ert-controlGroup__cell' });
                const statusText = statusCell.createSpan({ text: status.label });
                statusText.addClass('ert-controlGroup__status', status.cls);
            });
        }

        booksForInquiryList.replaceChildren(...Array.from(container.children));
    };

    const applyScanRoots = (nextRoots: string[]) => {
        const normalized = nextRoots.length ? normalizeScanRootPatterns(nextRoots) : [];
        inquirySources = { ...inquirySources, scanRoots: normalized };
        scanRootsInput?.setValue(listToText(normalized));
        autoResizeScanRootsInput();
        scanRootActionSyncers.forEach(sync => sync());
        resolvedRootCache = null;
        resolvedBookCache = null;
        void refreshClassScan();
    };

    const refreshClassScan = async () => {
        const rawRoots = inquirySources.scanRoots || [];
        const scanRoots = normalizeScanRootPatterns(rawRoots);
        const signature = scanRoots.join('|');
        if (!resolvedRootCache || resolvedRootCache.signature !== signature) {
            if (!scanRoots.length) {
                resolvedRootCache = { signature, resolvedRoots: [] };
            } else {
                const resolved = resolveScanRoots(scanRoots, plugin.app.vault, MAX_RESOLVED_SCAN_ROOTS);
                resolvedRootCache = {
                    signature,
                    resolvedRoots: resolved.resolvedRoots
                };
                if (resolved.totalMatches > MAX_RESOLVED_SCAN_ROOTS) {
                    new Notice(t('settings.inquiry.scanRoots.tooManyFolders', { count: resolved.totalMatches }));
                }
            }
        }
        const rootResolution = resolveInquirySourceRoots(plugin.app.vault, {
            scanRoots: rawRoots,
            resolvedScanRoots: resolvedRootCache.resolvedRoots
        }, plugin.settings.books);
        const { resolvedVaultRoots, supportVaultRoots, bookVaultRoots } = rootResolution;
        resolvedBookCache = resolveBookManagerInquiryBooks(plugin.settings.books);

        // Full scan (book + support roots) — used for book inventory and total counts.
        const fullScan = await scanInquiryClasses(
            resolvedVaultRoots,
            undefined,
            resolvedBookCache?.candidates || []
        );
        // Support-only scan — classes discovered only in configured support folders.
        // Subtract book roots so book-internal classes (beat, backdrop, etc.) never enter the rules table.
        const bookRootSet = new Set(bookVaultRoots);
        const exclusiveSupportRoots = supportVaultRoots.filter(root => !bookRootSet.has(root));
        const supportScan = await scanInquiryClasses(exclusiveSupportRoots);

        // Rules table: core classes (scene/outline) + genuinely discovered support classes.
        const rulesClasses = Array.from(new Set([
            ...CORE_CLASSES,
            ...supportScan.discoveredClasses
        ]));
        // Counts: support classes use support counts; core classes backfill from full scan.
        const rulesCounts: Record<string, number> = { ...supportScan.discoveredCounts };
        for (const core of CORE_CLASSES) {
            if (fullScan.discoveredCounts[core] && !rulesCounts[core]) {
                rulesCounts[core] = fullScan.discoveredCounts[core];
            }
        }

        const merged = mergeClassConfigs(inquirySources.classes || [], rulesClasses);
        const effectivePreset = inquirySources.preset ?? inferPresetFromClasses(merged) ?? undefined;
        inquirySources = {
            preset: effectivePreset,
            scanRoots: rawRoots,
            bookInclusion: {},
            classScope: ['/'],
            classes: merged,
            classCounts: rulesCounts,
            resolvedScanRoots: rootResolution.supportResolvedRoots,
            lastScanAt: new Date().toISOString()
        };
        plugin.settings.inquirySources = inquirySources;
        await plugin.saveSettings();
        plugin.getInquiryService().notifySourcesSettingsChanged();
        renderClassTable(merged, rulesCounts, supportScan.classSources);
        syncPresetButtons();
        renderBooksForInquiry(resolvedBookCache, fullScan.containerClassCounts);
    };

    function renderPromptConfiguration(targetEl: HTMLElement): void {
        const promptContainer = targetEl.createDiv({ cls: ERT_CLASSES.STACK });
        const freeCustomLimit = 3;
        const proCustomLimit = 8;
        const isPro = hasProFeatureAccess(plugin);
        const allCanonicalByZone = groupCanonicalQuestionsByZone(ALL_CANONICAL_QUESTIONS);
        const coreCanonicalByZone = groupCanonicalQuestionsByZone(CORE_CANONICAL_QUESTIONS);
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        const canonicalRowRefs: Record<InquiryZone, Map<string, HTMLElement>> = {
            setup: new Map(),
            pressure: new Map(),
            payoff: new Map()
        };

        let promptConfig: InquiryPromptConfig = normalizeInquiryPromptConfig(plugin.settings.inquiryPromptConfig);
        if (!plugin.settings.inquiryPromptConfig) {
            plugin.settings.inquiryPromptConfig = buildDefaultInquiryPromptConfig();
            promptConfig = normalizeInquiryPromptConfig(plugin.settings.inquiryPromptConfig);
            void plugin.saveSettings();
        }

        const zoneLabels: Record<InquiryZone, string> = {
            setup: t('settings.inquiry.zone.setup'),
            pressure: t('settings.inquiry.zone.pressure'),
            payoff: t('settings.inquiry.zone.payoff')
        };
        const zoneIcons: Record<InquiryZone, string> = {
            setup: 'sprout',
            pressure: 'gauge',
            payoff: 'target'
        };

        const createCustomSlot = (zone: InquiryZone): InquiryPromptSlot => ({
            id: `custom-${zone}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label: '',
            question: '',
            enabled: true,
            builtIn: false,
            canonical: undefined
        });

        const getSlotList = (zone: InquiryZone): InquiryPromptSlot[] =>
            promptConfig[zone] ?? [];

        const savePromptConfig = async (next: InquiryPromptConfig) => {
            const normalized = normalizeInquiryPromptConfig(next);
            plugin.settings.inquiryPromptConfig = normalized;
            await plugin.saveSettings();
            promptConfig = normalized;
            plugin.getInquiryService().notifyPromptSettingsChanged();
        };

        const updateSlot = async (
            zone: InquiryZone,
            slotIndex: number,
            patch: Partial<InquiryPromptSlot>
        ) => {
            const slots = getSlotList(zone);
            const current = slots[slotIndex];
            if (!current) return;
            const nextSlot = { ...current, ...patch };
            nextSlot.label = nextSlot.label ?? '';
            nextSlot.question = nextSlot.question ?? '';
            if (isCanonicalPromptSlot(current)) {
                const syncedSlot = syncCanonicalPromptSlot(nextSlot);
                const nextSlots = [...slots];
                nextSlots[slotIndex] = syncedSlot;
                await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
                return;
            }

            if (current.builtIn) {
                nextSlot.enabled = true;
                nextSlot.builtIn = true;
            } else {
                nextSlot.enabled = !!nextSlot.enabled || nextSlot.question.trim().length > 0;
                nextSlot.builtIn = false;
                nextSlot.canonical = undefined;
            }
            const nextSlots = [...slots];
            nextSlots[slotIndex] = nextSlot;
            await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
        };

        const addCustomSlot = async (
            zone: InquiryZone,
            limit: number,
            initial?: Partial<InquiryPromptSlot>
        ) => {
            const slots = getSlotList(zone);
            const customCount = slots.filter(slot => !isCanonicalPromptSlot(slot)).length;
            if (customCount >= limit) return;
            const seed = createCustomSlot(zone);
            const nextSlot = { ...seed, ...initial, builtIn: false };
            nextSlot.label = nextSlot.label ?? '';
            nextSlot.question = nextSlot.question ?? '';
            if (nextSlot.question.trim().length > 0) {
                nextSlot.enabled = true;
            }
            const nextSlots = [...slots, nextSlot];
            await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
            render();
        };

        const removeSlot = async (zone: InquiryZone, slotIndex: number) => {
            if (slotIndex === 0) return;
            const slots = getSlotList(zone);
            const target = slots[slotIndex];
            if (!target) return;
            const nextSlots = slots.filter((_, idx) => idx !== slotIndex);
            await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
            render();
        };

        const getSelectableCanonicalQuestions = (
            zone: InquiryZone,
            currentSlot?: InquiryPromptSlot
        ): InquiryCanonicalQuestionDefinition[] => {
            const allowed = isPro ? allCanonicalByZone[zone] : coreCanonicalByZone[zone];
            const questions = [...allowed];
            const currentCanonical = getCanonicalQuestionForSlot(currentSlot);
            if (!isPro && currentCanonical?.tier === 'signature' && !questions.some(question => question.id === currentCanonical.id)) {
                questions.push(currentCanonical);
            }
            return questions.sort((left, right) => left.defaultOrder - right.defaultOrder);
        };

        const getZoneSlotCapacity = (zone: InquiryZone): number =>
            (isPro ? allCanonicalByZone[zone] : coreCanonicalByZone[zone]).length;

        const getActiveCanonicalSelectionId = (
            slot: InquiryPromptSlot | undefined
        ): string => {
            if (getInquiryPromptSlotState(slot) !== 'canonical-loaded') {
                return '';
            }
            return getCanonicalQuestionForSlot(slot)?.id ?? '';
        };

        const getCanonicalTemplateOrder = (
            question: InquiryCanonicalQuestionDefinition,
            zone: InquiryZone
        ): number => {
            const ordered = getSelectableCanonicalQuestions(zone);
            const index = ordered.findIndex(candidate => candidate.id === question.id);
            return index === -1 ? question.defaultOrder : index + 1;
        };

        const findCanonicalSlotIndex = (
            zone: InquiryZone,
            canonicalId: string,
            excludeIndex?: number
        ): number => getSlotList(zone).findIndex((slot, idx) =>
            idx !== excludeIndex && getCanonicalQuestionForSlot(slot)?.id === canonicalId);

        const getCanonicalOptionLabel = (
            question: InquiryCanonicalQuestionDefinition,
            zone: InquiryZone,
            excludeIndex?: number
        ): string => {
            const parts = [question.label];
            const existingIndex = findCanonicalSlotIndex(zone, question.id, excludeIndex);
            if (question.tier === 'signature') {
                parts.push(t('settings.inquiry.prompts.proTag'));
            }
            if (existingIndex !== -1) {
                parts.push(`#${existingIndex + 1}`);
                parts.push(t('settings.inquiry.prompts.alreadyAddedTag'));
            }
            return parts.join(' · ');
        };

        const getCanonicalInsertOptionLabel = (
            question: InquiryCanonicalQuestionDefinition,
            zone: InquiryZone
        ): string => {
            const parts = [`${getCanonicalTemplateOrder(question, zone)}. ${question.label}`];
            if (question.tier === 'signature') {
                parts.push(t('settings.inquiry.prompts.proTag'));
            }
            return parts.join(' · ');
        };

        const focusCanonicalQuestionRow = (
            zone: InquiryZone,
            canonicalId: string,
            message = t('settings.inquiry.prompts.alreadyAdded')
        ): boolean => {
            const row = canonicalRowRefs[zone].get(canonicalId);
            if (!row) return false;
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            replayTransientClass(row, 'ert-inquiry-prompt-row--focusflash', { durationMs: 1800 });
            new Notice(message);
            return true;
        };

        const openReplacementConfirm = (options: {
            title: string;
            subtitle: string;
            warning?: string;
            confirmText: string;
        }): Promise<boolean> => {
            const { title, subtitle, warning, confirmText } = options;

            return new Promise(resolve => {
                const confirmModal = new Modal(plugin.app);
                const { modalEl, contentEl } = confirmModal;
                let settled = false;
                const finish = (result: boolean) => {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                };
                confirmModal.titleEl.setText('');
                contentEl.empty();
                modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
                contentEl.addClass('ert-modal-container', 'ert-stack');

                const header = contentEl.createDiv({ cls: 'ert-modal-header' });
                header.createSpan({ cls: 'ert-modal-badge', text: t('settings.inquiry.modal.badge') });
                header.createDiv({ cls: 'ert-modal-title', text: title });
                header.createDiv({
                    cls: 'ert-modal-subtitle',
                    text: subtitle
                });
                if (warning) {
                    contentEl.createDiv({
                        cls: 'ert-inquiry-prompt-warning',
                        text: warning
                    });
                }

                const footer = contentEl.createDiv({ cls: 'ert-modal-actions' });
                new ButtonComponent(footer)
                    .setButtonText(confirmText)
                    .setCta()
                    .onClick(() => {
                        finish(true);
                        confirmModal.close();
                    });
                new ButtonComponent(footer)
                    .setButtonText(t('settings.inquiry.modal.cancel'))
                    .onClick(() => {
                        finish(false);
                        confirmModal.close();
                    });

                confirmModal.onClose = () => finish(false);
                confirmModal.open();
            });
        };

        const confirmCanonicalReplacement = (nextLabel: string): Promise<boolean> => {
            const overwrittenSlots = zones
                .flatMap(zone => getSlotList(zone))
                .filter(slot => getInquiryPromptSlotState(slot) !== 'empty');
            if (!overwrittenSlots.length) return Promise.resolve(true);

            const customizedCount = overwrittenSlots
                .filter(slot => getInquiryPromptSlotState(slot) === 'customized')
                .length;
            const subtitle = customizedCount > 0
                ? t('inquiry.settingsExtra.loadCanonicalSubtitleCustomized', { label: nextLabel })
                : t('inquiry.settingsExtra.loadCanonicalSubtitleCurrent', { label: nextLabel });
            const warning = customizedCount === 1
                ? t('inquiry.settingsExtra.replaceCustomWarningOne')
                : customizedCount > 1
                    ? t('inquiry.settingsExtra.replaceCustomWarningMany')
                    : undefined;
            return openReplacementConfirm({
                title: customizedCount > 0 ? t('inquiry.settingsExtra.replaceCustomizedQuestionsTitle') : t('inquiry.settingsExtra.replaceQuestionsTitle'),
                subtitle,
                warning,
                confirmText: t('inquiry.settingsExtra.replaceQuestionsConfirm')
            });
        };

        const confirmSlotCanonicalReplacement = async (
            slot: InquiryPromptSlot | undefined,
            nextQuestion: InquiryCanonicalQuestionDefinition
        ): Promise<boolean> => {
            const slotState = getInquiryPromptSlotState(slot);
            if (slotState === 'empty') return true;
            if (slotState === 'customized') {
                return openReplacementConfirm({
                    title: t('inquiry.settingsExtra.replaceCustomTitle'),
                    subtitle: t('inquiry.settingsExtra.replaceCustomSubtitle', { label: nextQuestion.label }),
                    warning: t('inquiry.settingsExtra.replaceCustomWarningOne'),
                    confirmText: t('inquiry.settingsExtra.replaceCustomConfirm')
                });
            }
            return openReplacementConfirm({
                title: t('inquiry.settingsExtra.replaceCanonicalTitle'),
                subtitle: t('inquiry.settingsExtra.replaceCanonicalSubtitle', { label: nextQuestion.label }),
                confirmText: t('inquiry.settingsExtra.replaceCustomConfirm')
            });
        };

        const replaceSlotWithCanonical = async (
            zone: InquiryZone,
            slotIndex: number,
            canonicalId: string
        ) => {
            const slots = getSlotList(zone);
            const current = slots[slotIndex];
            const nextSlot = createCanonicalPromptSlotById(canonicalId);
            if (!current || !nextSlot) return;
            if (getCanonicalQuestionForSlot(current)?.id === canonicalId && getInquiryPromptSlotState(current) === 'canonical-loaded') {
                return;
            }
            const duplicateIndex = findCanonicalSlotIndex(zone, canonicalId, slotIndex);
            if (duplicateIndex !== -1) {
                focusCanonicalQuestionRow(zone, canonicalId);
                return;
            }
            const confirmed = await confirmSlotCanonicalReplacement(current, getCanonicalQuestionForSlot(nextSlot)!);
            if (!confirmed) return;
            const nextSlots = [...slots];
            nextSlots[slotIndex] = nextSlot;
            await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
            render();
        };

        const insertCanonicalSlot = async (
            zone: InquiryZone,
            canonicalId: string
        ) => {
            if (findCanonicalSlotIndex(zone, canonicalId) !== -1) {
                focusCanonicalQuestionRow(zone, canonicalId);
                return;
            }
            const nextSlot = createCanonicalPromptSlotById(canonicalId);
            if (!nextSlot) return;
            const nextSlots = [...getSlotList(zone), nextSlot];
            await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
            render();
        };

        const loadCanonicalSet = async (loadout: 'core' | 'full-signature') => {
            const nextLabel = loadout === 'core' ? t('inquiry.settingsExtra.coreQuestionsLabel') : t('inquiry.settingsExtra.fullProSetLabel');
            const confirmed = await confirmCanonicalReplacement(nextLabel);
            if (!confirmed) return;
            await savePromptConfig(replaceCanonicalPromptSlots(promptConfig, loadout));
            new Notice(t('inquiry.notice.coreSetLoaded', { label: nextLabel }));
            render();
        };

        const reorderSlots = async (
            zone: InquiryZone,
            fromIndex: number,
            toIndex: number
        ) => {
            if (fromIndex === toIndex) return;
            const slots = getSlotList(zone);
            if (fromIndex < 0 || fromIndex >= slots.length || toIndex < 0 || toIndex >= slots.length) return;
            const nextSlots = [...slots];
            const [moved] = nextSlots.splice(fromIndex, 1);
            nextSlots.splice(toIndex, 0, moved);
            await savePromptConfig({ ...promptConfig, [zone]: nextSlots });
            render();
        };

        const createPromptRowDragPreview = (event: DragEvent, row: HTMLElement): (() => void) => {
            if (!event.dataTransfer) return () => undefined;
            const rect = row.getBoundingClientRect();
            const preview = row.cloneNode(true) as HTMLElement;
            preview.addClass('ert-inquiry-prompt-row--dragPreview');
            preview.removeClass('is-dragging');
            preview.style.setProperty('--ert-inquiry-drag-preview-width', `${Math.ceil(rect.width)}px`);
            preview.style.setProperty('--ert-inquiry-drag-preview-height', `${Math.ceil(rect.height)}px`);
            row.ownerDocument.body.appendChild(preview);

            const offsetX = event.clientX > 0 ? Math.max(24, event.clientX - rect.left) : 28;
            const offsetY = event.clientY > 0 ? Math.max(20, event.clientY - rect.top) : 28;
            event.dataTransfer.setDragImage(preview, offsetX, offsetY);

            return () => {
                window.setTimeout(() => preview.remove(), 0);
            };
        };

        const clearPromptRowDragState = (
            dragState: {
                index: number | null;
                sourceRow: HTMLElement | null;
                placeholderEl: HTMLElement | null;
                clearDragPreview?: () => void;
            },
            listEl: HTMLElement
        ) => {
            promptContainer.removeClass('ert-inquiry-prompt-config--dragging');
            listEl.querySelectorAll('.ert-inquiry-prompt-row.is-dragover').forEach(target => {
                target.removeClass('is-dragover');
            });
            dragState.placeholderEl?.remove();
            dragState.placeholderEl = null;
            dragState.sourceRow?.removeClass('is-dragging');
            dragState.sourceRow?.removeClass('is-dragover');
            dragState.sourceRow = null;
            dragState.clearDragPreview?.();
            dragState.clearDragPreview = undefined;
        };

        const renderSlotRows = (
            listEl: HTMLElement,
            zone: InquiryZone,
            slots: InquiryPromptSlot[],
            customIndexMap: Map<string, number>,
            dragState: {
                index: number | null;
                sourceRow: HTMLElement | null;
                placeholderEl: HTMLElement | null;
                clearDragPreview?: () => void;
            }
        ) => {
            slots.forEach((slot, slotIndex) => {
                const row = listEl.createDiv({ cls: 'ert-reorder-row ert-reorder-row--two-col' });
                row.addClass('ert-inquiry-prompt-row');
                const slotState = getInquiryPromptSlotState(slot);
                const customIndex = customIndexMap.has(slot.id) ? customIndexMap.get(slot.id)! : -1;
                const isProRow = slotState === 'customized' && customIndex >= freeCustomLimit;
                const canonicalQuestion = getCanonicalQuestionForSlot(slot);
                const canRemoveSlot = slotIndex > 0;
                const isSignatureTemplateRow = slotState === 'canonical-loaded' && canonicalQuestion?.tier === 'signature';
                if (canonicalQuestion) {
                    canonicalRowRefs[zone].set(canonicalQuestion.id, row);
                }
                if (isProRow || isSignatureTemplateRow) {
                    row.addClass('ert-skin--pro', 'ert-elementBlock');
                    row.addClass('ert-reorder-row--pro');
                    if (!isPro && (isProRow || isSignatureTemplateRow)) {
                        row.addClass('ert-reorder-row--locked');
                    }
                }
                row.toggleClass('ert-inquiry-prompt-row--template', slotState === 'canonical-loaded');
                row.toggleClass('ert-inquiry-prompt-row--customized', slotState === 'customized');
                row.toggleClass(
                    'ert-inquiry-prompt-row--signature',
                    isSignatureTemplateRow
                );

                const labelCol = row.createDiv({ cls: 'ert-reorder-col ert-inquiry-prompt-col ert-inquiry-prompt-col--handle' });
                const questionCol = row.createDiv({
                    cls: 'ert-reorder-col ert-reorder-col--question ert-inquiry-prompt-col ert-inquiry-prompt-col--question'
                });

                const rowIndex = labelCol.createDiv({ cls: 'ert-inquiry-prompt-index', text: String(slotIndex + 1) });
                rowIndex.setAttribute('aria-hidden', 'true');

                const dragHandle = labelCol.createDiv({ cls: 'ert-drag-handle' });
                dragHandle.draggable = true;
                setIcon(dragHandle, 'grip-vertical');
                setTooltip(dragHandle, t('settings.inquiry.prompts.dragToReorder'));

                const topRow = questionCol.createDiv({ cls: 'ert-inquiry-prompt-topRow' });
                const labelField = topRow.createDiv({ cls: 'ert-inquiry-prompt-labelField' });
                const labelInput = new TextComponent(labelField);
                labelInput.setPlaceholder(t('settings.inquiry.prompts.labelPlaceholder'))
                    .setValue(slot.label ?? '');
                labelInput.inputEl.addClass('ert-input', 'ert-input--md', 'ert-inquiry-prompt-labelInput');
                if (slotState === 'canonical-loaded') {
                    labelInput.inputEl.readOnly = true;
                    labelInput.inputEl.addClass('is-readonly');
                    const templateMeta = topRow.createDiv({ cls: 'ert-inquiry-prompt-templateMeta' });
                    const templateIcon = templateMeta.createDiv({ cls: 'ert-inquiry-prompt-templateMeta__icon' });
                    setIcon(templateIcon, 'lock');
                    templateMeta.createSpan({ text: t('settings.inquiry.prompts.fixedTemplate') });
                } else {
                    labelInput.onChange(async (value) => {
                        await updateSlot(zone, slotIndex, { label: value });
                    });

                    const pickerWrap = topRow.createDiv({ cls: 'ert-inquiry-prompt-canonical-picker' });
                    const canonicalPicker = new DropdownComponent(pickerWrap);
                    canonicalPicker.selectEl.addClass('ert-input', 'ert-input--md');
                    canonicalPicker.addOption('', t('settings.inquiry.prompts.replaceWithTemplate'));
                    getSelectableCanonicalQuestions(zone, slot).forEach(question => {
                        canonicalPicker.addOption(question.id, getCanonicalOptionLabel(question, zone, slotIndex));
                    });
                    const activeCanonicalSelectionId = getActiveCanonicalSelectionId(slot);
                    canonicalPicker.setValue(activeCanonicalSelectionId);
                    canonicalPicker.onChange((selectedId) => {
                        if (!selectedId) return;
                        const duplicateIndex = findCanonicalSlotIndex(zone, selectedId, slotIndex);
                        if (duplicateIndex === -1) return;
                        if (activeCanonicalSelectionId === selectedId) return;
                        focusCanonicalQuestionRow(zone, selectedId);
                        canonicalPicker.setValue(activeCanonicalSelectionId);
                    });

                    const applyCanonicalButton = pickerWrap.createEl('button', { cls: ERT_CLASSES.ICON_BTN });
                    setIcon(applyCanonicalButton, 'sparkles');
                    setTooltip(applyCanonicalButton, t('settings.inquiry.prompts.applyCanonical'));
                    applyCanonicalButton.onclick = () => {
                        const selectedId = canonicalPicker.getValue();
                        if (!selectedId) return;
                        void replaceSlotWithCanonical(zone, slotIndex, selectedId);
                    };
                }

                const rowActions = topRow.createDiv({ cls: ERT_CLASSES.ICON_BTN_GROUP });
                if (canonicalQuestion && slotState === 'customized') {
                    const resetButton = rowActions.createEl('button', { cls: ERT_CLASSES.ICON_BTN });
                    setIcon(resetButton, 'rotate-ccw');
                    setTooltip(resetButton, t('settings.inquiry.prompts.resetToCanonical'));
                    resetButton.onclick = () => {
                        labelInput.setValue(canonicalQuestion.label ?? '');
                        questionInput.setValue(canonicalQuestion.standardPrompt ?? '');
                        void updateSlot(zone, slotIndex, {
                            label: canonicalQuestion.label ?? '',
                            question: canonicalQuestion.standardPrompt ?? '',
                            enabled: true
                        });
                    };
                } else if (canRemoveSlot) {
                    const deleteBtn = rowActions.createEl('button', { cls: ERT_CLASSES.ICON_BTN });
                    setIcon(deleteBtn, 'trash');
                    setTooltip(deleteBtn, t('settings.inquiry.prompts.deleteQuestion'));
                    deleteBtn.onclick = () => {
                        void removeSlot(zone, slotIndex);
                    };
                }

                const questionMain = questionCol.createDiv({ cls: 'ert-inquiry-prompt-questionRow' });
                const questionInput = new TextComponent(questionMain);
                questionInput.setPlaceholder(t('settings.inquiry.prompts.questionPlaceholder'))
                    .setValue(slot.question ?? '');
                questionInput.inputEl.addClass('ert-input', 'ert-input--full', 'ert-inquiry-prompt-questionInput');
                if (slotState === 'canonical-loaded') {
                    questionInput.inputEl.readOnly = true;
                    questionInput.inputEl.addClass('is-readonly');
                } else {
                    questionInput.onChange(async (value) => {
                        await updateSlot(zone, slotIndex, { question: value });
                    });
                }
                if (slotState === 'customized') {
                    const customizedIcon = questionMain.createDiv({ cls: 'ert-inquiry-prompt-customizedIcon' });
                    customizedIcon.toggleClass('is-signature', canonicalQuestion?.tier === 'signature' || isProRow);
                    setIcon(customizedIcon, 'pencil');
                    setTooltip(customizedIcon, t('settings.inquiry.prompts.customizedQuestion'));
                }

                plugin.registerDomEvent(dragHandle, 'dragstart', (e: DragEvent) => {
                    dragState.index = slotIndex;
                    dragState.sourceRow = row;
                    promptContainer.addClass('ert-inquiry-prompt-config--dragging');
                    row.classList.add('is-dragging');
                    e.dataTransfer?.setData('text/plain', slotIndex.toString());
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        dragState.clearDragPreview = createPromptRowDragPreview(e, row);
                    }
                });

                plugin.registerDomEvent(dragHandle, 'dragend', () => {
                    clearPromptRowDragState(dragState, listEl);
                    dragState.index = null;
                });

                plugin.registerDomEvent(row, 'dragenter', (e) => {
                    e.preventDefault();
                    row.classList.add('is-dragover');
                });

                plugin.registerDomEvent(row, 'dragover', (e: DragEvent) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    row.classList.add('is-dragover');
                });

                plugin.registerDomEvent(row, 'dragleave', () => {
                    row.classList.remove('is-dragover');
                });

                plugin.registerDomEvent(row, 'drop', (e: DragEvent) => {
                    e.preventDefault();
                    row.classList.remove('is-dragover');
                    const from = dragState.index ?? parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
                    if (Number.isNaN(from) || from < 0 || from === slotIndex) {
                        clearPromptRowDragState(dragState, listEl);
                        dragState.index = null;
                        return;
                    }
                    clearPromptRowDragState(dragState, listEl);
                    dragState.index = null;
                    void reorderSlots(zone, from, slotIndex);
                });
            });
        };

        const persistedZoneExpanded = plugin.settings.inquiryPromptZoneExpanded;
        const zoneExpanded: Record<InquiryZone, boolean> = {
            setup: persistedZoneExpanded?.setup ?? true,
            pressure: persistedZoneExpanded?.pressure ?? true,
            payoff: persistedZoneExpanded?.payoff ?? true
        };

        const renderZoneCard = (
            zone: InquiryZone,
            dragState: {
                index: number | null;
                sourceRow: HTMLElement | null;
                placeholderEl: HTMLElement | null;
                clearDragPreview?: () => void;
            }
        ) => {
            const zoneStack = promptContainer.createDiv({ cls: ERT_CLASSES.STACK });

            const headingCard = zoneStack.createDiv({ cls: ['setting-item', 'ert-inquiry-prompt-header'] });
            const headingInfo = headingCard.createDiv({ cls: 'setting-item-info' });
            const zoneColor = `var(--ert-inquiry-zone-${zone})`;
            const zoneStroke = `var(--ert-inquiry-zone-${zone}-stroke)`;
            headingInfo.style.setProperty('--ert-inquiry-zone-color', zoneColor);
            headingInfo.style.setProperty('--ert-inquiry-zone-stroke', zoneStroke);

            const headingIcon = headingInfo.createDiv({ cls: 'ert-inquiry-prompt-header__icon' });
            setIcon(headingIcon, zoneIcons[zone]);

            const headingContent = headingInfo.createDiv({ cls: 'ert-inquiry-prompt-header__content' });
            const headingName = headingContent.createDiv({ cls: 'setting-item-name' });
            const headingPill = headingName.createSpan({ cls: ['ert-badgePill', 'ert-badgePill--sm'] });
            headingPill.createSpan({
                cls: 'ert-badgePill__text',
                text: zoneLabels[zone].toUpperCase()
            });
            headingPill.style.setProperty(
                '--ert-badgePill-bg',
                `color-mix(in srgb, ${zoneColor} 18%, var(--background-secondary))`
            );
            headingPill.style.setProperty('--ert-badgePill-border', zoneStroke);
            headingPill.style.setProperty('--ert-badgePill-color', zoneStroke);
            headingPill.style.setProperty(
                '--ert-badgePill-shadow',
                `0 0 0 1px color-mix(in srgb, ${zoneStroke} 35%, transparent)`
            );
            headingContent.createDiv({
                cls: 'setting-item-description',
                text: getInquiryZoneDescription(zone)
            });

            const listCard = zoneStack.createDiv({ cls: ERT_CLASSES.PANEL });
            listCard.toggleClass('ert-settings-hidden', !zoneExpanded[zone]);
            const listEl = listCard.createDiv({ cls: ['ert-template-entries', 'ert-template-indent'] });
            listEl.style.setProperty('--ert-template-indent-accent', zoneStroke);

            const headingControl = headingCard.createDiv({ cls: 'setting-item-control' });
            const toggleButton = headingControl.createEl('button', { cls: ERT_CLASSES.ICON_BTN });
            const refreshToggle = () => {
                const expanded = zoneExpanded[zone];
                setIcon(toggleButton, expanded ? 'chevron-down' : 'chevron-right');
                setTooltip(toggleButton, expanded ? t('inquiry.settingsExtra.collapse') : t('inquiry.settingsExtra.expand'));
                listCard.toggleClass('ert-settings-hidden', !expanded);
            };
            refreshToggle();
            toggleButton.onclick = () => {
                zoneExpanded[zone] = !zoneExpanded[zone];
                plugin.settings.inquiryPromptZoneExpanded = { ...zoneExpanded };
                refreshToggle();
                void plugin.saveSettings();
            };

            const slots = getSlotList(zone);
            const customSlots = slots.filter(slot => getInquiryPromptSlotState(slot) === 'customized');
            const customIndexMap = new Map<string, number>();
            customSlots.forEach((slot, idx) => customIndexMap.set(slot.id, idx));
            renderSlotRows(listEl, zone, slots, customIndexMap, dragState);

            const showProGhost = !isPro
                && customSlots.length >= freeCustomLimit
                && customSlots.length < proCustomLimit;
            if (showProGhost) {
                const ghostRow = listEl.createDiv({
                    cls: 'ert-reorder-row ert-reorder-row--two-col ert-reorder-row--pro ert-reorder-row--ghost'
                });
                const ghostText = ghostRow.createDiv({
                    cls: 'ert-reorder-placeholder ert-reorder-placeholder--pro'
                });
                ghostText.createSpan({ text: t('settings.inquiry.prompts.unlockProGhost') });
                const ghostBadge = ghostText.createDiv({ cls: ERT_CLASSES.ICON_BTN_GROUP });
                badgePill(ghostBadge, {
                    icon: 'sparkles',
                    label: t('settings.inquiry.prompts.proTag'),
                    variant: ERT_CLASSES.BADGE_PILL_PRO,
                    size: ERT_CLASSES.BADGE_PILL_SM
                });
            }

            const addLimit = isPro ? proCustomLimit : freeCustomLimit;
            const zoneCapacity = getZoneSlotCapacity(zone);
            const insertableCanonicalQuestions = getSelectableCanonicalQuestions(zone)
                .filter(question => findCanonicalSlotIndex(zone, question.id) === -1);
            const canAddCustom = customSlots.length < addLimit;
            const canAddCanonical = insertableCanonicalQuestions.length > 0;
            const hasZoneCapacity = slots.length < zoneCapacity;

            if (hasZoneCapacity && (canAddCustom || canAddCanonical)) {
                const addRow = listEl.createDiv({ cls: 'ert-reorder-row ert-reorder-row--two-col ert-inquiry-prompt-addRow' });
                if (isPro && customSlots.length >= freeCustomLimit) {
                    addRow.addClass('ert-reorder-row--pro');
                }

                const labelCol = addRow.createDiv({ cls: 'ert-reorder-col ert-inquiry-prompt-col ert-inquiry-prompt-col--handle' });
                const questionCol = addRow.createDiv({
                    cls: 'ert-reorder-col ert-reorder-col--question ert-inquiry-prompt-col ert-inquiry-prompt-col--question'
                });

                const addIcon = labelCol.createDiv({ cls: 'ert-drag-handle ert-drag-placeholder ert-inquiry-prompt-insertIcon' });
                setIcon(addIcon, 'plus');

                const topRow = questionCol.createDiv({ cls: 'ert-inquiry-prompt-topRow' });
                const labelField = topRow.createDiv({ cls: 'ert-inquiry-prompt-labelField' });
                const labelInput = new TextComponent(labelField);
                labelInput.setPlaceholder(t('settings.inquiry.prompts.labelPlaceholder')).setValue('');
                labelInput.inputEl.addClass('ert-input', 'ert-input--md', 'ert-inquiry-prompt-labelInput');
                labelInput.setDisabled(!canAddCustom);

                const canonicalPickerWrap = topRow.createDiv({ cls: 'ert-inquiry-prompt-canonical-picker' });
                const canonicalPicker = new DropdownComponent(canonicalPickerWrap);
                canonicalPicker.selectEl.addClass('ert-input', 'ert-input--md');
                canonicalPicker.addOption('', canAddCanonical ? t('settings.inquiry.prompts.chooseCanonical') : t('settings.inquiry.prompts.noRemainingCanonical'));
                insertableCanonicalQuestions.forEach(question => {
                    canonicalPicker.addOption(question.id, getCanonicalInsertOptionLabel(question, zone));
                });
                canonicalPicker.setDisabled(!canAddCanonical);

                const addActions = topRow.createDiv({ cls: ERT_CLASSES.ICON_BTN_GROUP });
                const addBtn = addActions.createEl('button', { cls: [ERT_CLASSES.ICON_BTN, 'ert-mod-cta'] });
                setIcon(addBtn, 'plus');
                setTooltip(addBtn, t('settings.inquiry.prompts.addQuestion'));

                const questionMain = questionCol.createDiv({ cls: 'ert-inquiry-prompt-questionRow' });
                const questionInput = new TextComponent(questionMain);
                questionInput.setPlaceholder(t('settings.inquiry.prompts.questionPlaceholder')).setValue('');
                questionInput.inputEl.addClass('ert-input', 'ert-input--full', 'ert-inquiry-prompt-questionInput');
                questionInput.setDisabled(!canAddCustom);

                const clearCanonicalSelection = () => {
                    if (!canonicalPicker.getValue()) return;
                    canonicalPicker.setValue('');
                };
                labelInput.onChange(() => clearCanonicalSelection());
                questionInput.onChange(() => clearCanonicalSelection());
                canonicalPicker.onChange((selectedId) => {
                    if (!selectedId) return;
                    labelInput.setValue('');
                    questionInput.setValue('');
                });

                const commitAdd = () => {
                    const selectedCanonicalId = canonicalPicker.getValue();
                    if (selectedCanonicalId) {
                        void insertCanonicalSlot(zone, selectedCanonicalId);
                        return;
                    }
                    if (!canAddCustom) return;
                    void addCustomSlot(zone, addLimit, {
                        label: labelInput.getValue(),
                        question: questionInput.getValue()
                    });
                };

                addBtn.onclick = commitAdd;
                plugin.registerDomEvent(questionInput.inputEl, 'keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commitAdd();
                    }
                });
            } else if (!hasZoneCapacity) {
                const fullNote = listEl.createDiv({ cls: 'ert-inquiry-prompt-zoneFullNote' });
                fullNote.setText(t('settings.inquiry.prompts.zoneFullNote'));
            }
        };

        const render = () => {
            promptContainer.empty();
            zones.forEach(zone => canonicalRowRefs[zone].clear());

            const librarySetting = new Settings(promptContainer)
                .setName(t('settings.inquiry.canonicalLibrary.name'))
                .setDesc(
                    isPro
                        ? t('settings.inquiry.canonicalLibrary.descPro')
                        : t('settings.inquiry.canonicalLibrary.descFree')
                );
            librarySetting.settingEl.addClass(ERT_CLASSES.ROW, ERT_CLASSES.ROW_TIGHT);
            const libraryActions = librarySetting.controlEl.createDiv({ cls: [ERT_CLASSES.INLINE, 'ert-actions', 'ert-preset-controls'] });

            if (isPro) {
                const signatureButton = libraryActions.createEl('button', {
                    cls: `${ERT_CLASSES.PILL_BTN} ${ERT_CLASSES.PILL_BTN_PRO} ert-preset-pill`
                });
                const signatureIcon = signatureButton.createSpan({ cls: ERT_CLASSES.PILL_BTN_ICON });
                setIcon(signatureIcon, 'signature');
                signatureButton.createSpan({ cls: ERT_CLASSES.PILL_BTN_LABEL, text: t('settings.inquiry.canonicalLibrary.loadFullProSet') });
                setTooltip(signatureButton, t('settings.inquiry.canonicalLibrary.loadAllTooltip'));
                plugin.registerDomEvent(signatureButton, 'click', evt => {
                    evt.preventDefault();
                    void loadCanonicalSet('full-signature');
                });
            } else {
                const coreButton = libraryActions.createEl('button', { cls: `${ERT_CLASSES.PILL_BTN} ert-preset-pill` });
                coreButton.createSpan({ cls: ERT_CLASSES.PILL_BTN_LABEL, text: t('settings.inquiry.canonicalLibrary.loadCoreQuestions') });
                plugin.registerDomEvent(coreButton, 'click', evt => {
                    evt.preventDefault();
                    void loadCanonicalSet('core');
                });
            }

            const dragStates: Record<InquiryZone, {
                index: number | null;
                sourceRow: HTMLElement | null;
                placeholderEl: HTMLElement | null;
                clearDragPreview?: () => void;
            }> = {
                setup: { index: null, sourceRow: null, placeholderEl: null },
                pressure: { index: null, sourceRow: null, placeholderEl: null },
                payoff: { index: null, sourceRow: null, placeholderEl: null }
            };

            zones.forEach(zone => {
                renderZoneCard(zone, dragStates[zone]);
            });
        };

        render();
    }

    const renderCorpusCcSettings = (targetEl: HTMLElement) => {
        const thresholdDefaults = normalizeCorpusThresholds(plugin.settings.inquiryCorpusThresholds);
        plugin.settings.inquiryCorpusThresholds = thresholdDefaults;

        const corpusPanel = targetEl.createDiv({ cls: [ERT_CLASSES.PANEL, ERT_CLASSES.STACK] });

        const table = corpusPanel.createDiv({ cls: ['ert-controlGroup', 'ert-controlGroup--corpus'] });

        const header = table.createDiv({ cls: ['ert-controlGroup__row', 'ert-controlGroup__row--header'] });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.corpusTable.tier') });
        header.createDiv({ cls: 'ert-controlGroup__cell' });
        header.createDiv({ cls: 'ert-controlGroup__cell', text: t('settings.inquiry.corpusTable.threshold') });
        header.createDiv({ cls: 'ert-controlGroup__cell' });

        const doc = table.ownerDocument;
        const inputs: Record<keyof InquiryCorpusThresholds, HTMLInputElement> = {
            emptyMax: doc.win.createEl('input'),
            sketchyMin: doc.win.createEl('input'),
            mediumMin: doc.win.createEl('input'),
            substantiveMin: doc.win.createEl('input')
        };

        const renderRow = (label: string, key: keyof InquiryCorpusThresholds, operator = '>=') => {
            const row = table.createDiv({ cls: ['ert-controlGroup__row', 'ert-controlGroup__row--card'] });
            row.createDiv({ cls: 'ert-controlGroup__cell', text: label });
            row.createDiv({
                cls: ['ert-controlGroup__cell', 'ert-controlGroup__cell--meta', 'ert-controlGroup__cell--mono'],
                text: operator
            });
            const cell = row.createDiv({ cls: 'ert-controlGroup__cell' });
            const input = inputs[key];
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.value = String(thresholdDefaults[key]);
            input.classList.add('ert-input--sm');
            cell.appendChild(input);
            const actionCell = row.createDiv({ cls: ['ert-controlGroup__cell', 'ert-controlGroup__cell--action'] });
            if (key === 'substantiveMin') {
                const resetButton = actionCell.createDiv({
                    cls: ['clickable-icon', 'ert-corpus-reset-button'],
                    attr: {
                        role: 'button',
                        tabindex: '0',
                        'aria-label': t('settings.inquiry.corpus.resetTooltip')
                    }
                });
                setIcon(resetButton, 'rotate-ccw');
                setTooltip(resetButton, t('settings.inquiry.corpus.resetTooltip'));
                const resetThresholds = async () => {
                    const reset = normalizeCorpusThresholds(DEFAULT_SETTINGS.inquiryCorpusThresholds);
                    await commitThresholds(reset);
                };
                plugin.registerDomEvent(resetButton, 'click', () => {
                    void resetThresholds();
                });
                plugin.registerDomEvent(resetButton, 'keydown', (event: KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    void resetThresholds();
                });
            }
        };

        renderRow(t('settings.inquiry.corpusTier.empty'), 'emptyMax', '<=');
        renderRow(t('settings.inquiry.corpusTier.sketchy'), 'sketchyMin');
        renderRow(t('settings.inquiry.corpusTier.medium'), 'mediumMin');
        renderRow(t('settings.inquiry.corpusTier.substantive'), 'substantiveMin');

        const syncInputs = (values: InquiryCorpusThresholds) => {
            (Object.keys(inputs) as Array<keyof InquiryCorpusThresholds>).forEach(key => {
                inputs[key].value = String(values[key]);
            });
        };

        const commitThresholds = async (next: InquiryCorpusThresholds) => {
            const error = validateCorpusThresholds(next);
            if (error) {
                new Notice(error);
                syncInputs(thresholdDefaults);
                return;
            }
            (Object.keys(next) as Array<keyof InquiryCorpusThresholds>).forEach(key => {
                thresholdDefaults[key] = next[key];
            });
            plugin.settings.inquiryCorpusThresholds = { ...next };
            await plugin.saveSettings();
            syncInputs(next);
        };

        (Object.keys(inputs) as Array<keyof InquiryCorpusThresholds>).forEach(key => {
            const input = inputs[key];
            plugin.registerDomEvent(input, 'blur', () => {
                const next = {
                    ...thresholdDefaults,
                    [key]: Number(input.value)
                };
                void commitThresholds(next);
            });
        });

    };

    const corpusBody = createSection(containerEl, {
        title: t('settings.inquiry.corpus.name'),
        desc: t('settings.inquiry.corpus.desc'),
        icon: 'layout-grid',
        wiki: 'Settings-Inquiry#corpus'
    });
    renderCorpusCcSettings(corpusBody);

    const configBody = createSection(containerEl, {
        title: t('settings.inquiry.config.name'),
        desc: t('settings.inquiry.config.desc'),
        icon: 'settings',
        wiki: 'Settings-Inquiry'
    });

    new Settings(configBody)
        .setName(t('inquiry.settingsExtra.autopopulateName'))
        .setDesc(t('inquiry.settingsExtra.autopopulateDesc'))
        .addToggle(toggle => {
            toggle.setValue(plugin.settings.inquiryActionNotesAutoPopulate ?? false);
            toggle.onChange(async (value) => {
                plugin.settings.inquiryActionNotesAutoPopulate = value;
                await plugin.saveSettings();
            });
        });

    void refreshClassScan();
}
