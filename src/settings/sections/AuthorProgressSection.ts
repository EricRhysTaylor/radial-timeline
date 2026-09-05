import { App, Setting, setIcon, setTooltip, normalizePath, DropdownComponent, TextComponent, Modal, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { buildDefaultAuthorProgressDefaults } from '../../authorProgress/authorProgressConfig';
import { AuthorProgressService } from '../../services/AuthorProgressService';
import { AprStyleService } from '../../services/apr/AprStyleService';
import { DEFAULT_SETTINGS } from '../defaults';
import type { AprStyleSettings, AuthorProgressDefaults, AuthorProgressFrequency, AuthorProgressSettings, TeaserRevealLevel } from '../../types/settings';
import { getAllScenes } from '../../utils/manuscript';
import { createAprSVG } from '../../renderer/apr/AprRenderer';
import { getTeaserRevealLevel, getTeaserThresholds, teaserLevelToRevealOptions } from '../../renderer/apr/AprConstants';
import { AprPaletteModal } from '../../modals/AprPaletteModal';
import { AuthorProgressModal } from '../../modals/AuthorProgressModal';
import { renderCampaignManagerSection } from './CampaignManagerSection';
import { hasProFeatureAccess } from '../featureGate';
import { colorSwatch, type ColorSwatchHandle } from '../../ui/ui';
import { ERT_CLASSES } from '../../ui/classes';
import { STAGE_ORDER } from '../../utils/constants';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { t } from '../../i18n';
import { buildDefaultEmbedPath, normalizeAprExportFormat, type AprExportFormat } from '../../utils/aprPaths';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { mountSvgMarkup } from '../../utils/svgDom';
export interface AuthorProgressSectionProps {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

type TeaserPreviewMode = 'auto' | TeaserRevealLevel;

function inferExportFormatFromPath(path: string | undefined, fallback: AprExportFormat = 'png'): AprExportFormat {
    const normalized = path?.trim().toLowerCase() ?? '';
    if (normalized.endsWith('.svg')) return 'svg';
    if (normalized.endsWith('.png')) return 'png';
    return fallback;
}

function resolveDefaultExportFormat(settings?: AuthorProgressSettings): AprExportFormat {
    const defaults = settings?.defaults;
    if (!defaults) return 'png';
    if (typeof defaults.exportFormat === 'string' && defaults.exportFormat.trim()) {
        return normalizeAprExportFormat(defaults.exportFormat);
    }
    return inferExportFormatFromPath(defaults.exportPath, 'png');
}

function getScrollContainer(el: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = el.parentElement;
    while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
        if (isScrollable) return current;
        current = current.parentElement;
    }
    return null;
}

export function renderAuthorProgressSection({ app, plugin, containerEl }: AuthorProgressSectionProps): void {
    // Social is ERT-only; avoid legacy classes.
    const section = containerEl.createDiv({
        cls: `ert-apr-section ${ERT_CLASSES.ROOT} ${ERT_CLASSES.SKIN_SOCIAL} ${ERT_CLASSES.STACK}`
    });
    const rerenderSection = () => {
        const doc = containerEl.ownerDocument;
        const scrollContainer = getScrollContainer(containerEl);
        const scrollTop = scrollContainer?.scrollTop ?? null;
        const pageScrollTop = doc.scrollingElement?.scrollTop ?? null;
        containerEl.empty();
        renderAuthorProgressSection({ app, plugin, containerEl });
        window.requestAnimationFrame(() => {
            if (scrollContainer && scrollTop !== null) {
                scrollContainer.scrollTop = scrollTop;
            } else if (doc.scrollingElement && pageScrollTop !== null) {
                doc.scrollingElement.scrollTop = pageScrollTop;
            }
        });
    };

    // Check if APR needs refresh
    const aprService = new AuthorProgressService(plugin, app);
    const aprStyleService = new AprStyleService(plugin);
    const needsRefresh = aprService.isStale();
    const isProActive = hasProFeatureAccess(plugin);

    // ─────────────────────────────────────────────────────────────────────────
    // APR HERO SECTION
    // ─────────────────────────────────────────────────────────────────────────
    const hero = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.CARD_HERO} ${ERT_CLASSES.STACK}` });

    // Badge row with pill - turns red when refresh needed
    const badgeRow = hero.createDiv({ cls: ERT_CLASSES.INLINE });
    const badgeClasses = needsRefresh ?
        `ert-badgePill--alert ${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_APR}` :
        `${ERT_CLASSES.BADGE_PILL} ${ERT_CLASSES.BADGE_PILL_APR}`;
    const badge = badgeRow.createSpan({ cls: badgeClasses });
    // Left Icon and Text — append active book name
    setIcon(badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON }), needsRefresh ? 'alert-triangle' : 'radio');
    const activeBookTitle = plugin.getActiveBookTitle();
    const badgeText = needsRefresh
        ? t('settings.authorProgress.hero.badgeRefresh')
        : `${t('settings.authorProgress.hero.badgeDefault')} · ${activeBookTitle}`;
    badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: badgeText });

    // Right Icon (Wiki Link) - Manually constructed for ERT styling
    const wikiLink = badge.createEl('a', {
        href: 'https://github.com/EricRhysTaylor/radial-timeline/wiki/Author-Progress-Report',
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: {
            'aria-label': t('settings.authorProgress.hero.wikiAriaLabel'),
            'target': '_blank',
            'rel': 'noopener'
        }
    });
    setIcon(wikiLink, 'external-link');

    // Big headline
    hero.createEl('h3', {
        cls: `${ERT_CLASSES.SECTION_TITLE} ert-hero-title`,
        text: t('settings.authorProgress.hero.title')
    });

    // Description paragraph
    hero.createEl('p', {
        cls: `${ERT_CLASSES.SECTION_DESC} ert-hero-subtitle ert-apr-hero-subtitle`,
        text: t('settings.authorProgress.hero.desc')
    });

    // Features section
    const featuresSection = hero.createDiv({
        cls: `${ERT_CLASSES.HERO_FEATURES} ${ERT_CLASSES.STACK} ${ERT_CLASSES.STACK_TIGHT}`
    });
    featuresSection.createEl('h5', { text: t('settings.authorProgress.hero.keyBenefitsHeading'), cls: 'ert-kicker' });
    const featuresList = featuresSection.createEl('ul', { cls: ERT_CLASSES.STACK });
    [
        { icon: 'eye-off', text: t('settings.authorProgress.hero.featureSpoilerSafe') },
        { icon: 'share-2', text: t('settings.authorProgress.hero.featureShareable') },
        { icon: 'trending-up', text: t('settings.authorProgress.hero.featureStageWeighted') },
    ].forEach(feature => {
        const li = featuresList.createEl('li', { cls: `${ERT_CLASSES.INLINE} ert-feature-item` });
        const iconSpan = li.createSpan({ cls: 'ert-feature-icon' });
        setIcon(iconSpan, feature.icon);
        li.createSpan({ text: feature.text });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // APR PREVIEW MODULE
    // ─────────────────────────────────────────────────────────────────────────
    const previewCard = section.createDiv({ cls: `${ERT_CLASSES.CARD} ${ERT_CLASSES.STACK}` });

    // Size selector row
    const sizeSelectorRow = previewCard.createDiv({ cls: `${ERT_CLASSES.ROW} ${ERT_CLASSES.ROW_COMPACT}` });
    sizeSelectorRow.createSpan({ text: t('settings.authorProgress.preview.sizeLabel'), cls: ERT_CLASSES.LABEL });
    const sizeSelectorControls = sizeSelectorRow.createDiv({ cls: ERT_CLASSES.INLINE });
    let teaserPreviewMode: TeaserPreviewMode = plugin.settings.authorProgress?.defaults.aprDefaultViewMode ?? 'auto';
    let refreshPreview = () => {};
    let refreshCampaignStyleState: (() => void) | null = null;
    let teaserSelectWrap: HTMLDivElement | null = null;
    const updateTeaserPreviewVisibility = (_size: 'small' | 'medium' | 'large') => {
        // Dropdown always visible — Ring mode is valid at all sizes including thumb
    };

    const sizeButtons = [
        { size: 'small', dimension: '150' },
        { size: 'medium', dimension: '300' },
        { size: 'large', dimension: '450' },
    ] as const;

    const currentSize = plugin.settings.authorProgress?.defaults.aprSize || 'medium';
    const setSizeLabel = (el: HTMLElement, dimension: string, suffix?: string) => {
        const doc = el.ownerDocument;
        el.textContent = '';
        el.append(doc.createTextNode(dimension));
        el.append(doc.createTextNode('²'));
        if (suffix) {
            el.append(doc.createTextNode(` — ${suffix}`));
        }
    };
    let dimLabel: HTMLElement | null = null;

    sizeButtons.forEach(({ size, dimension }) => {
        const btn = sizeSelectorControls.createEl('button', {
            cls: `ert-apr-size-btn ${size === currentSize ? `ert-apr-size-btn--active ${ERT_CLASSES.IS_ACTIVE}` : ''} ${ERT_CLASSES.PILL_BTN} ${ERT_CLASSES.PILL_BTN_STANDARD}`
        });
        setSizeLabel(btn, dimension);

        btn.onclick = async () => {
            if (!plugin.settings.authorProgress) return;
            const settings = plugin.settings.authorProgress.defaults;
            const defaultFormat = resolveDefaultExportFormat(plugin.settings.authorProgress);
            const oldDefaultPath = buildDefaultEmbedPath({
                bookTitle: plugin.getActiveBookTitle(),
                updateFrequency: settings.updateFrequency,
                aprExportQuality: settings.aprExportQuality,
                exportFormat: defaultFormat
            });
            settings.aprSize = size;
            if (settings.exportPath === oldDefaultPath) {
                settings.exportPath = buildDefaultEmbedPath({
                    bookTitle: plugin.getActiveBookTitle(),
                    updateFrequency: settings.updateFrequency,
                    aprExportQuality: settings.aprExportQuality,
                    exportFormat: defaultFormat
                });
            }
            await plugin.saveSettings();

            // Update button states
            sizeSelectorRow.querySelectorAll('.ert-apr-size-btn').forEach(b => {
                b.removeClass('ert-apr-size-btn--active');
                b.removeClass(ERT_CLASSES.IS_ACTIVE);
            });
            btn.addClass('ert-apr-size-btn--active');
            btn.addClass(ERT_CLASSES.IS_ACTIVE);

            // Update dimension label
            if (dimLabel) {
                setSizeLabel(dimLabel, dimension, t('settings.authorProgress.preview.actualSizePreview'));
            }

            // Re-render preview at new size
            updateTeaserPreviewVisibility(size);
            refreshPreview?.();
        };
    });

    if (isProActive) {
        teaserSelectWrap = sizeSelectorControls.createDiv({ cls: ERT_CLASSES.SKIN_PRO });
        const teaserSelect = teaserSelectWrap.createEl('select', { cls: 'dropdown ert-input ert-input--fit-selected' });
        const teaserOptions: { value: TeaserPreviewMode; label: string }[] = [
            { value: 'auto', label: t('settings.authorProgress.preview.teaserAuto') },
            { value: 'ring', label: t('settings.authorProgress.preview.teaserRing') },
            { value: 'scenes', label: t('settings.authorProgress.preview.teaserScenes') },
            { value: 'colors', label: t('settings.authorProgress.preview.teaserColor') },
            { value: 'full', label: t('settings.authorProgress.preview.teaserComplete') },
        ];
        teaserOptions.forEach(opt => {
            teaserSelect.createEl('option', { value: opt.value, text: opt.label });
        });
        teaserSelect.value = teaserPreviewMode;
        teaserSelect.onchange = () => {
            teaserPreviewMode = teaserSelect.value as TeaserPreviewMode;
            fitSelectToSelectedLabel(teaserSelect, { extraPx: 16, minPx: 72 });
            // Persist so the Default Report and any campaign with teaser OFF render in this mode.
            const defaults = plugin.settings.authorProgress?.defaults;
            if (defaults) {
                defaults.aprDefaultViewMode = teaserPreviewMode;
                void plugin.saveSettings();
            }
            refreshPreview?.();
        };
        fitSelectToSelectedLabel(teaserSelect, { extraPx: 16, minPx: 72 });
        updateTeaserPreviewVisibility(currentSize);
    }

    // Publish — connect the setup above to the APR action workflow. Opens the
    // Author Progress modal (the single publish surface) rather than writing
    // a file in place, so static snapshots, campaign targeting, and reveal are
    // all reachable from one hub.
    const publishBtn = new ButtonComponent(sizeSelectorControls)
        .setButtonText(t('settings.authorProgress.preview.publish'))
        .setCta()
        .setTooltip(t('settings.authorProgress.preview.publishTooltip'))
        .onClick(() => {
            new AuthorProgressModal(app, plugin).open();
        });
    publishBtn.buttonEl.addClass('ert-apr-publish-btn');

    // Dimension info (second row, second column)
    const sizeMetaRow = previewCard.createDiv({ cls: `${ERT_CLASSES.ROW} ${ERT_CLASSES.ROW_TIGHT} ert-row--stack ert-apr-size-meta` });
    const currentDim = sizeButtons.find(s => s.size === currentSize)?.dimension || '300';
    dimLabel = sizeMetaRow.createEl('em', { cls: ERT_CLASSES.ROW_DESC });
    setSizeLabel(dimLabel, currentDim, t('settings.authorProgress.preview.actualSizePreview'));

    // 1:1 preview
    const previewSection = previewCard.createDiv({ cls: 'ert-apr-preview' });

    // SVG Preview container - shows at 1:1 actual size
    const previewContainer = previewSection.createDiv({ cls: `ert-apr-preview-frame ert-apr-preview--actual ${ERT_CLASSES.PREVIEW_FRAME} ert-previewFrame--flush` });
    previewContainer.createDiv({ cls: `ert-apr-preview-loading ${ERT_CLASSES.PREVIEW_INNER}`, text: t('settings.authorProgress.preview.loading') });

    // Load and render preview asynchronously at actual size
    void renderHeroPreview(app, plugin, previewContainer, currentSize, teaserPreviewMode);
    refreshPreview = () => {
        const size = plugin.settings.authorProgress?.defaults.aprSize || 'medium';
        updateTeaserPreviewVisibility(size);
        void renderHeroPreview(app, plugin, previewContainer, size, teaserPreviewMode);
    };

    // Meta tags
    const authorProgress = plugin.settings.authorProgress;
    const settings = authorProgress?.defaults;
    const lastDate = settings?.lastPublishedDate
        ? new Date(settings.lastPublishedDate).toLocaleDateString()
        : t('settings.authorProgress.preview.lastUpdateNever');

    const meta = previewCard.createDiv({ cls: ERT_CLASSES.INLINE });
    meta.createSpan({ text: t('settings.authorProgress.preview.lastUpdate', { date: lastDate }), cls: `${ERT_CLASSES.CHIP} ${ERT_CLASSES.FIELD_NOTE}` });
    meta.createSpan({ text: t('settings.authorProgress.preview.kickstarterReady'), cls: ERT_CLASSES.CHIP });
    meta.createSpan({ text: t('settings.authorProgress.preview.patreonFriendly'), cls: ERT_CLASSES.CHIP });

    // ─────────────────────────────────────────────────────────────────────────
    // CONFIGURATION SECTION
    // ─────────────────────────────────────────────────────────────────────────
    // Configuration (project setup) - placed first, close to preview
    const stylingCard = section.createDiv({ cls: ERT_CLASSES.PANEL });
    const stylingBlock = stylingCard.createDiv({ cls: ERT_CLASSES.STACK });
    const stylingHeader = stylingBlock.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
    const stylingHeading = new Setting(stylingHeader)
        .setName(t('settings.authorProgress.configuration.name'))
        .setDesc(t('settings.authorProgress.configuration.desc'))
        .setHeading();
    addHeadingIcon(stylingHeading, 'settings');
    addWikiLink(stylingHeading, 'Author-Progress-Report#progress-tracking');
    applyErtHeaderLayout(stylingHeading, { variant: 'inline' });
    const stylingBody = stylingBlock.createDiv({ cls: 'ert-typography-stack' });

    // Progress tracking
    type AprProgressMode = 'stage' | 'date' | 'full';
    const progressTrackingCard = stylingBody.createDiv({ cls: `${ERT_CLASSES.PREVIEW_FRAME} ert-previewFrame--flush ${ERT_CLASSES.STACK}` });

    const progressModeGrid = progressTrackingCard.createDiv({ cls: `${ERT_CLASSES.GRID_FORM} ert-apr-progressModeGrid` });

    const stageCell = progressModeGrid.createDiv({ cls: ERT_CLASSES.GRID_FORM_CELL });
    const stageBadgeRow = stageCell.createDiv({ cls: `${ERT_CLASSES.INLINE} ert-apr-stageBadgeRow` });
    const stageBadge = stageBadgeRow.createSpan({ cls: ERT_CLASSES.CHIP, text: 'TRACKING STAGE' });
    const stageNote = stageCell.createDiv({ cls: ERT_CLASSES.FIELD_NOTE });
    const stageSubNote = stageCell.createDiv({ cls: `${ERT_CLASSES.FIELD_NOTE} ert-apr-stageSubNote` });

    progressModeGrid.createDiv({ cls: 'ert-divider--vertical' });

    const modeCell = progressModeGrid.createDiv({ cls: `${ERT_CLASSES.GRID_FORM_CELL} ert-apr-modeCell` });
    const modeControlRow = modeCell.createDiv({ cls: 'ert-typography-controls' });
    const modeDropdown = new DropdownComponent(modeControlRow);
    modeDropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected', 'ert-typography-select');

    // Tracked-stage dropdown sits inline to the right of the mode dropdown (stage mode only).
    const trackedStageDropdown = new DropdownComponent(modeControlRow);
    trackedStageDropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected', 'ert-typography-select');
    STAGE_ORDER.forEach(stage => { trackedStageDropdown.addOption(stage, stage); });

    // Scene goal — inline with the mode + tracked-stage dropdowns.
    const targetCountGroup = modeControlRow.createDiv({ cls: 'ert-apr-targetGroup' });
    const targetCountInput = new TextComponent(targetCountGroup);
    targetCountInput.inputEl.type = 'number';
    targetCountInput.inputEl.min = '1';
    targetCountInput.inputEl.step = '1';
    targetCountInput.inputEl.addClass('ert-input', 'ert-input--xs');
    targetCountInput.setPlaceholder('—');
    setTooltip(targetCountInput.inputEl, 'Scene goal');
    const targetCountResetBtn = targetCountGroup.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button', 'aria-label': 'Match target to current scene count' }
    });
    setIcon(targetCountResetBtn, 'refresh-cw');
    setTooltip(targetCountResetBtn, 'Match target to current scene count');

    // Date range input sits inline with the mode dropdown (shown only in Date Goal mode).
    const dateRangeInput = new TextComponent(modeControlRow);
    dateRangeInput.setPlaceholder('YYYY-MM-DD to YYYY-MM-DD');
    dateRangeInput.inputEl.addClass('ert-input', 'ert-input--lg', 'ert-hidden');

    // Manuscript Flow bar — full-width, rendered at the bottom of the card.
    // Divider sits just above the bar to separate it from the controls.
    progressTrackingCard.createDiv({ cls: 'ert-divider ert-divider--previewFrame' });
    const flowBar = progressTrackingCard.createDiv({ cls: 'ert-apr-flow' });
    const flowTick = flowBar.createDiv({ cls: 'ert-apr-flow__tick' });
    const flowTickLabel = flowTick.createSpan({ cls: 'ert-apr-flow__tick-label' });
    const flowTickLine = flowTick.createSpan({ cls: 'ert-apr-flow__tick-line' });
    const flowBarTrack = flowBar.createDiv({ cls: 'ert-apr-flow__track' });
    const flowSegments: Record<(typeof STAGE_ORDER)[number], HTMLDivElement> = {} as Record<(typeof STAGE_ORDER)[number], HTMLDivElement>;
    STAGE_ORDER.forEach(stage => {
        const seg = flowBarTrack.createDiv({ cls: `ert-apr-flow__segment ert-apr-flow__segment--${stage.toLowerCase()}` });
        const color = plugin.settings.publishStageColors[stage];
        seg.style.setProperty('--ert-flow-color', color);
        setTooltip(seg, `${stage}: 0`);
        flowSegments[stage] = seg;
    });
    const flowLegend = flowBar.createDiv({ cls: 'ert-apr-flow__legend' });

    const applyStageBadgeTone = (stage: (typeof STAGE_ORDER)[number]) => {
        const color = plugin.settings.publishStageColors[stage];
        stageBadge.style.setProperty('--ert-chip-bg', `color-mix(in srgb, ${color} 18%, var(--background-secondary) 82%)`);
        stageBadge.style.setProperty('border', `1px solid ${color}`);
        stageBadge.style.setProperty('color', color);
    };

    const formatDateRange = (start?: string, target?: string): string => {
        if (!start || !target) return '';
        return `${start} to ${target}`;
    };

    const parseIsoDate = (value: string): number | null => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const parsed = new Date(`${value}T00:00:00`);
        const time = parsed.getTime();
        return Number.isFinite(time) ? time : null;
    };

    const parseDateRange = (value: string): { start?: string; target?: string; error?: string } => {
        const matches = value.match(/\d{4}-\d{2}-\d{2}/g);
        if (!matches || matches.length < 2) {
            return { error: 'Enter both start and target dates (YYYY-MM-DD).' };
        }
        const [start, target] = matches;
        const startTime = parseIsoDate(start);
        const targetTime = parseIsoDate(target);
        if (!startTime || !targetTime) {
            return { error: 'Use YYYY-MM-DD for both dates.' };
        }
        if (startTime > targetTime) {
            return { error: 'Start date must be before target date.' };
        }
        return { start, target };
    };

    const dateInputSuccessClass = 'ert-setting-input-success';
    const dateInputErrorClass = 'ert-setting-input-error';

    const flashDateInput = (cls: string, timeout: number) => {
        dateRangeInput.inputEl.addClass(cls);
        window.setTimeout(() => dateRangeInput.inputEl.removeClass(cls), timeout);
    };

    const clearDateInputState = () => {
        dateRangeInput.inputEl.removeClass(dateInputSuccessClass);
        dateRangeInput.inputEl.removeClass(dateInputErrorClass);
    };

    let isUpdatingMode = false;
    let lastKnownSceneCount = 0;
    const progressTrackingService = new AuthorProgressService(plugin, app);

    const updateModeUI = (modeOverride?: AprProgressMode) => {
        isUpdatingMode = true;
        const nextMode = modeOverride ?? (plugin.settings.authorProgress?.defaults.aprProgressMode ?? 'stage');
        modeDropdown.setValue(nextMode);
        trackedStageDropdown.selectEl.toggleClass('ert-hidden', nextMode !== 'stage');
        dateRangeInput.inputEl.toggleClass('ert-hidden', nextMode !== 'date');
        targetCountGroup.toggleClass('ert-hidden', nextMode === 'date');
        fitSelectToSelectedLabel(modeDropdown.selectEl, { minPx: 132, extraPx: 18 });
        fitSelectToSelectedLabel(trackedStageDropdown.selectEl, { minPx: 92, extraPx: 18 });
        isUpdatingMode = false;
    };

    const updateStageUI = (
        mode: AprProgressMode,
        displayStage: (typeof STAGE_ORDER)[number],
        trackedStage: (typeof STAGE_ORDER)[number],
        note: string
    ) => {
        const badgeText = mode === 'stage'
            ? `TRACKING ${trackedStage.toUpperCase()}`
            : mode === 'date'
                ? 'DATE RANGE'
                : 'FULL MANUSCRIPT';
        stageBadge.setText(badgeText);
        applyStageBadgeTone(displayStage);
        stageNote.setText(note);
        trackedStageDropdown.setValue(trackedStage);
        updateModeUI(mode);
    };

    modeDropdown.onChange(async (val) => {
        if (isUpdatingMode) return;
        if (!plugin.settings.authorProgress) return;
        const nextMode = (val === 'date' || val === 'full' ? val : 'stage');
        plugin.settings.authorProgress.defaults.aprProgressMode = nextMode;
        await plugin.saveSettings();
        await refreshTrackingState();
        refreshPreview();
    });

    trackedStageDropdown.onChange(async (val) => {
        if (isUpdatingMode || !plugin.settings.authorProgress) return;
        const nextStage = STAGE_ORDER.find(stage => stage === val) ?? 'Zero';
        plugin.settings.authorProgress.defaults.aprTrackedStage = nextStage;
        await plugin.saveSettings();
        await refreshTrackingState();
        refreshPreview();
    });

    let isUpdatingTarget = false;
    const commitTargetSceneCount = async (rawValue: string, fallbackSceneCount: number): Promise<void> => {
        if (!plugin.settings.authorProgress) return;
        const trimmed = rawValue.trim();
        if (!trimmed) {
            plugin.settings.authorProgress.defaults.aprTargetSceneCount = undefined;
        } else {
            const parsed = Number.parseInt(trimmed, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                plugin.settings.authorProgress.defaults.aprTargetSceneCount = undefined;
            } else {
                plugin.settings.authorProgress.defaults.aprTargetSceneCount = Math.max(parsed, fallbackSceneCount);
            }
        }
        await plugin.saveSettings();
        await refreshTrackingState();
        refreshPreview();
    };

    plugin.registerDomEvent(targetCountInput.inputEl, 'blur', () => {
        if (isUpdatingTarget) return;
        const sceneCount = lastKnownSceneCount;
        void commitTargetSceneCount(targetCountInput.getValue(), sceneCount);
    });
    plugin.registerDomEvent(targetCountInput.inputEl, 'keydown', (evt: KeyboardEvent) => {
        if (evt.key === 'Enter') {
            evt.preventDefault();
            targetCountInput.inputEl.blur();
        }
    });
    // SAFE: settings sections manage their own listener cleanup via the Obsidian settings tab lifecycle.
    targetCountResetBtn.addEventListener('click', () => { void (async () => {
        if (!plugin.settings.authorProgress) return;
        plugin.settings.authorProgress.defaults.aprTargetSceneCount = undefined;
        await plugin.saveSettings();
        await refreshTrackingState();
        refreshPreview();
    })(); });

    dateRangeInput.onChange(() => {
        clearDateInputState();
    });

    const handleDateRangeBlur = async (): Promise<void> => {
        if (!plugin.settings.authorProgress) return;
        clearDateInputState();
        const raw = dateRangeInput.getValue().trim();
        if (!raw) {
            plugin.settings.authorProgress.defaults.aprProgressDateStart = undefined;
            plugin.settings.authorProgress.defaults.aprProgressDateTarget = undefined;
            await plugin.saveSettings();
            await refreshTrackingState();
            refreshPreview();
            return;
        }
        const parsed = parseDateRange(raw);
        if (!parsed.start || !parsed.target) {
            flashDateInput(dateInputErrorClass, 2000);
            return;
        }
        plugin.settings.authorProgress.defaults.aprProgressDateStart = parsed.start;
        plugin.settings.authorProgress.defaults.aprProgressDateTarget = parsed.target;
        await plugin.saveSettings();
        dateRangeInput.setValue(formatDateRange(parsed.start, parsed.target));
        flashDateInput(dateInputSuccessClass, 1000);
        await refreshTrackingState();
        refreshPreview();
    };

    plugin.registerDomEvent(dateRangeInput.inputEl, 'blur', () => { void handleDateRangeBlur(); });
    plugin.registerDomEvent(dateRangeInput.inputEl, 'keydown', (evt: KeyboardEvent) => {
        if (evt.key === 'Enter') {
            evt.preventDefault();
            dateRangeInput.inputEl.blur();
        }
    });

    const seedDateRange = () => {
        const start = plugin.settings.authorProgress?.defaults.aprProgressDateStart;
        const target = plugin.settings.authorProgress?.defaults.aprProgressDateTarget;
        dateRangeInput.setValue(formatDateRange(start, target));
    };

    const seedTargetCount = (sceneCount: number, storedTarget: number | undefined): void => {
        isUpdatingTarget = true;
        const display = storedTarget && storedTarget > 0 ? String(storedTarget) : '';
        targetCountInput.setValue(display);
        targetCountInput.setPlaceholder(sceneCount > 0 ? String(sceneCount) : '—');
        isUpdatingTarget = false;
    };

    const composeStageNote = (mode: AprProgressMode): string => {
        if (mode === 'date') {
            return 'Track progress against a timeline. Measure how far you’ve moved between a start and target date.';
        }
        if (mode === 'full') {
            return 'Track all scenes across Zero → Press. See how your entire manuscript is progressing end to end.';
        }
        return 'Track progress within a single stage using a scene goal. Focus on drafting, revision, or publishing — one stage at a time.';
    };

    const renderFlowBar = (
        breakdown: Record<(typeof STAGE_ORDER)[number], number>,
        percent: number
    ): void => {
        STAGE_ORDER.forEach(stage => {
            const seg = flowSegments[stage];
            const count = breakdown[stage] ?? 0;
            seg.style.setProperty('flex-grow', String(count));
            seg.toggleClass('is-empty', count === 0);
            setTooltip(seg, `${stage}: ${count}`);
        });
        const clamped = Math.max(0, Math.min(100, percent));
        flowTickLine.style.setProperty('left', `${clamped}%`);
        flowTickLabel.style.setProperty('left', `${clamped}%`);
        flowTickLabel.setText(`${clamped}%`);
        flowLegend.empty();
        STAGE_ORDER.forEach(stage => {
            const label = flowLegend.createSpan({ cls: 'ert-apr-flow__legend-item' });
            const color = plugin.settings.publishStageColors[stage];
            label.style.setProperty('--ert-flow-color', color);
            label.createSpan({ cls: 'ert-apr-flow__legend-dot' });
            label.createSpan({ cls: 'ert-apr-flow__legend-text', text: `${stage} ${breakdown[stage] ?? 0}` });
        });
    };

    const refreshTrackingState = async (): Promise<void> => {
        try {
            const scenes = await getAllScenes(app, plugin);
            const progressState = progressTrackingService.resolveProgressState(scenes);
            lastKnownSceneCount = progressState.sceneCount;
            const storedTarget = plugin.settings.authorProgress?.defaults.aprTargetSceneCount;
            const note = composeStageNote(progressState.mode);
            updateStageUI(progressState.mode, progressState.displayStage, progressState.trackedStage, note);
            stageSubNote.setText(progressState.mode === 'stage' ? `Currently tracking: ${progressState.trackedStage} stage` : '');
            stageSubNote.toggleClass('ert-hidden', progressState.mode !== 'stage');
            seedTargetCount(progressState.sceneCount, storedTarget);
            renderFlowBar(progressState.stageBreakdown, progressState.percent);
            seedDateRange();
        } catch {
            const trackedStage = plugin.settings.authorProgress?.defaults.aprTrackedStage ?? 'Zero';
            const mode = (plugin.settings.authorProgress?.defaults.aprProgressMode ?? 'stage');
            lastKnownSceneCount = 0;
            const storedTarget = plugin.settings.authorProgress?.defaults.aprTargetSceneCount;
            updateStageUI(mode, trackedStage, trackedStage, composeStageNote(mode));
            stageSubNote.setText(mode === 'stage' ? `Currently tracking: ${trackedStage} stage` : '');
            stageSubNote.toggleClass('ert-hidden', mode !== 'stage');
            seedTargetCount(0, storedTarget);
            renderFlowBar({ Zero: 0, Author: 0, House: 0, Press: 0 }, 0);
            seedDateRange();
        }
    };

    modeDropdown.addOption('stage', 'Stage tracking');
    modeDropdown.addOption('full', 'Full manuscript');
    modeDropdown.addOption('date', 'Date goal');
    void refreshTrackingState();

    const getActiveStyleSettings = (): AprStyleSettings => aprStyleService.resolveDesignerStyle();
    const styleSettings = getActiveStyleSettings();
    const currentBg = styleSettings.aprBackgroundColor || '#0d0d0f';
    const currentTransparent = styleSettings.aprCenterTransparent ?? true; // Default to true (recommended)
    const currentTheme = styleSettings.aprTheme || 'dark';
    const currentSpokeMode = styleSettings.aprSpokeColorMode || 'dark';
    const currentSpokeColor = styleSettings.aprSpokeColor || '#ffffff';

    // ─────────────────────────────────────────────────────────────────────────
    // UNIFIED TYPOGRAPHY & COLOR CONTROLS
    // Each element: Row 1 = Label + Text Input (if applicable) + Color + Hex
    //               Row 2 = Font + Weight
    // ─────────────────────────────────────────────────────────────────────────
    const themeCard = section.createDiv({ cls: ERT_CLASSES.PANEL });
    section.insertBefore(themeCard, stylingCard); // Styling before Configuration
    const themeBlock = themeCard.createDiv({ cls: ERT_CLASSES.STACK });
    const themeHeader = themeBlock.createDiv({ cls: ERT_CLASSES.PANEL_HEADER });
    const themeHeading = new Setting(themeHeader)
        .setName(t('settings.authorProgress.styling.name'))
        .setDesc(t('settings.authorProgress.styling.desc'))
        .setHeading();
    addHeadingIcon(themeHeading, 'swatch-book');
    addWikiLink(themeHeading, 'Author-Progress-Report#styling-options');
    const themeControl = themeHeading.controlEl;
    const themeBody = themeBlock.createDiv({ cls: 'ert-typography-stack' });

    // Color picker refs
    let bookTitleColorPickerRef: ColorSwatchHandle | undefined;
    let bookTitleTextRef: TextComponent | undefined;
    let authorColorPickerRef: ColorSwatchHandle | undefined;
    let authorTextRef: TextComponent | undefined;
    let percentNumberColorPickerRef: ColorSwatchHandle | undefined;
    let percentNumberTextRef: TextComponent | undefined;
    let percentSymbolColorPickerRef: ColorSwatchHandle | undefined;
    let percentSymbolTextRef: TextComponent | undefined;

    const themeButton = themeControl.createEl('button', { cls: 'ert-pillBtn ert-pillBtn--social' });
    themeButton.type = 'button';
    const themeIcon = themeButton.createSpan({ cls: 'ert-pillBtn__icon' });
    setIcon(themeIcon, 'swatch-book');
    themeButton.createSpan({ cls: 'ert-pillBtn__label', text: t('settings.authorProgress.styling.choosePaletteButton') });
    // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
    themeButton.addEventListener('click', () => {
        const paletteSeedColor = bookTitleTextRef?.getValue().trim()
            || getActiveStyleSettings().aprBookAuthorColor
            || bookTitleColorFallback;
        const paletteDefaults = {
            ...(plugin.settings.authorProgress?.defaults ?? DEFAULT_SETTINGS.authorProgress?.defaults ?? buildDefaultAuthorProgressDefaults()),
            ...getActiveStyleSettings()
        };
        const modal = new AprPaletteModal(
            app,
            plugin,
            paletteDefaults,
            (palette) => {
                void setAprSettings({
                    aprBookAuthorColor: palette.bookTitle,
                    aprAuthorColor: palette.authorName,
                    aprPercentNumberColor: palette.percentNumber,
                    aprPercentSymbolColor: palette.percentSymbol,
                });
                bookTitleColorPickerRef?.setValue(palette.bookTitle);
                bookTitleTextRef?.setValue(palette.bookTitle);
                authorColorPickerRef?.setValue(palette.authorName);
                authorTextRef?.setValue(palette.authorName);
                percentNumberColorPickerRef?.setValue(palette.percentNumber);
                percentNumberTextRef?.setValue(palette.percentNumber);
                percentSymbolColorPickerRef?.setValue(palette.percentSymbol);
                percentSymbolTextRef?.setValue(palette.percentSymbol);
            },
            paletteSeedColor
        );
        modal.open();
    });
    // Collapse / expand toggle for the styling body
    const stylingToggleBtn = themeControl.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button', 'aria-label': 'Show styling controls' }
    });
    const refreshStylingToggle = () => {
        const expanded = plugin.settings.authorProgress?.defaults.aprStylingExpanded ?? false;
        setIcon(stylingToggleBtn, expanded ? 'chevron-down' : 'chevron-right');
        setTooltip(stylingToggleBtn, expanded ? 'Hide styling controls' : 'Show styling controls');
        stylingToggleBtn.setAttribute('aria-label', expanded ? 'Hide styling controls' : 'Show styling controls');
        themeBody.toggleClass('ert-settings-hidden', !expanded);
    };
    refreshStylingToggle();
    // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
    stylingToggleBtn.addEventListener('click', () => { void (async () => {
        if (!plugin.settings.authorProgress) return;
        plugin.settings.authorProgress.defaults.aprStylingExpanded = !(plugin.settings.authorProgress.defaults.aprStylingExpanded ?? false);
        refreshStylingToggle();
        await plugin.saveSettings();
    })(); });

    applyErtHeaderLayout(themeHeading);

    const bookTitleColorFallback = plugin.settings.publishStageColors.Press;

    // Font availability check — canvas measurement against monospace baseline
    const fontCheckCtx = containerEl.ownerDocument.win.createEl('canvas').getContext('2d') ?? null;
    const fontCheckSample = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let fontCheckBaseline: number | null = null;
    const isFontAvailable = (fontName: string): boolean => {
        if (!fontCheckCtx) return true;
        if (fontCheckBaseline === null) {
            fontCheckCtx.font = '16px monospace';
            fontCheckBaseline = fontCheckCtx.measureText(fontCheckSample).width;
        }
        fontCheckCtx.font = `16px "${fontName}", monospace`;
        return fontCheckCtx.measureText(fontCheckSample).width !== fontCheckBaseline;
    };

    // System font candidates — filtered at runtime to only show fonts the OS has loaded
    const ALL_FONT_CANDIDATES: Array<{ value: string; label: string; alwaysShow?: boolean }> = [
        { value: 'default', label: t('settings.authorProgress.styling.fontDefault'), alwaysShow: true },
        { value: 'system-ui', label: t('settings.authorProgress.styling.fontSystemUI'), alwaysShow: true },
        // Cross-platform system fonts
        { value: 'Arial', label: 'Arial' },
        { value: 'Verdana', label: 'Verdana' },
        { value: 'Georgia', label: 'Georgia' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'Trebuchet MS', label: 'Trebuchet MS' },
        { value: 'Tahoma', label: 'Tahoma' },
        // macOS system fonts
        { value: 'Avenir Next', label: 'Avenir Next' },
        { value: 'Futura', label: 'Futura' },
        { value: 'Gill Sans', label: 'Gill Sans' },
        { value: 'Baskerville', label: 'Baskerville' },
        { value: 'Didot', label: 'Didot' },
        { value: 'Optima', label: 'Optima' },
        { value: 'Palatino', label: 'Palatino' },
        // Windows system fonts
        { value: 'Segoe UI', label: 'Segoe UI' },
        { value: 'Calibri', label: 'Calibri' },
        { value: 'Cambria', label: 'Cambria' },
        { value: 'Candara', label: 'Candara' },
    ];

    const FONT_OPTIONS = ALL_FONT_CANDIDATES.filter(opt =>
        opt.alwaysShow || isFontAvailable(opt.value)
    );

    // Weight options with italic variants
    const WEIGHT_OPTIONS = [
        { value: '300', label: t('settings.authorProgress.styling.weightLight') },
        { value: '300-italic', label: t('settings.authorProgress.styling.weightLightItalic') },
        { value: '400', label: t('settings.authorProgress.styling.weightNormal') },
        { value: '400-italic', label: t('settings.authorProgress.styling.weightNormalItalic') },
        { value: '500', label: t('settings.authorProgress.styling.weightMedium') },
        { value: '500-italic', label: t('settings.authorProgress.styling.weightMediumItalic') },
        { value: '600', label: t('settings.authorProgress.styling.weightSemiBold') },
        { value: '600-italic', label: t('settings.authorProgress.styling.weightSemiBoldItalic') },
        { value: '700', label: t('settings.authorProgress.styling.weightBold') },
        { value: '700-italic', label: t('settings.authorProgress.styling.weightBoldItalic') },
        { value: '800', label: t('settings.authorProgress.styling.weightExtraBold') },
        { value: '800-italic', label: t('settings.authorProgress.styling.weightExtraBoldItalic') },
        { value: '900', label: t('settings.authorProgress.styling.weightBlack') },
        { value: '900-italic', label: t('settings.authorProgress.styling.weightBlackItalic') }
    ];

    const parseWeightValue = (val: string): { weight: number; italic: boolean } => {
        if (val.includes('-italic')) {
            return { weight: parseInt(val.split('-')[0], 10), italic: true };
        }
        return { weight: parseInt(val, 10), italic: false };
    };

    const formatWeightValue = (weight: number, italic: boolean): string => {
        return italic ? `${weight}-italic` : String(weight);
    };

    const numberFromText = (val: string): number | undefined => {
        const parsed = Number.parseFloat(val.trim());
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const styleSettingKeys = new Set<keyof AprStyleSettings>([
        'aprBackgroundColor',
        'aprCenterTransparent',
        'aprBookAuthorColor',
        'aprAuthorColor',
        'aprPercentNumberColor',
        'aprPercentSymbolColor',
        'aprTheme',
        'aprSpokeColorMode',
        'aprSpokeColor',
        'aprBookTitleFontFamily',
        'aprBookTitleFontWeight',
        'aprBookTitleFontItalic',
        'aprBookTitleFontSize',
        'aprAuthorNameFontFamily',
        'aprAuthorNameFontWeight',
        'aprAuthorNameFontItalic',
        'aprAuthorNameFontSize',
        'aprPercentNumberFontSize1Digit',
        'aprPercentNumberFontSize2Digit',
        'aprPercentNumberFontSize3Digit',
        'aprRtBadgeFontFamily',
        'aprRtBadgeFontWeight',
        'aprRtBadgeFontItalic',
        'aprRtBadgeFontSize',
        'aprShowRtAttribution',
    ]);

    const setAprSetting = async <K extends keyof AuthorProgressDefaults>(key: K, value: AuthorProgressDefaults[K] | undefined): Promise<void> => {
        if (!plugin.settings.authorProgress) return;
        const isStyleKey = styleSettingKeys.has(key as keyof AprStyleSettings);
        if (isStyleKey) {
            aprStyleService.updateDesignerStyle({ [key]: value });
        } else {
            plugin.settings.authorProgress.defaults[key] = value as AuthorProgressDefaults[K];
        }
        await plugin.saveSettings();
        refreshPreview();
        if (isStyleKey) refreshCampaignStyleState?.();
    };

    const setAprSettings = async (updates: Partial<AuthorProgressDefaults>): Promise<void> => {
        if (!plugin.settings.authorProgress) return;
        const styleUpdates: Partial<AprStyleSettings> = {};
        const defaultUpdates: Partial<AuthorProgressDefaults> = {};
        Object.entries(updates).forEach(([key, value]) => {
            if (styleSettingKeys.has(key as keyof AprStyleSettings)) {
                (styleUpdates as Record<string, unknown>)[key] = value;
            } else {
                (defaultUpdates as Record<string, unknown>)[key] = value;
            }
        });
        const hasStyleUpdates = Object.keys(styleUpdates).length > 0;
        if (hasStyleUpdates) {
            aprStyleService.updateDesignerStyle(styleUpdates);
        }
        Object.assign(plugin.settings.authorProgress.defaults, defaultUpdates);
        await plugin.saveSettings();
        refreshPreview();
        if (hasStyleUpdates) refreshCampaignStyleState?.();
    };

    const clearPercentNumberOverrides = (): void => {
        const currentStyle = getActiveStyleSettings();
        const hasOverrides = [
            currentStyle.aprPercentNumberFontSize1Digit,
            currentStyle.aprPercentNumberFontSize2Digit,
            currentStyle.aprPercentNumberFontSize3Digit
        ].some(value => value !== undefined && value !== null);
        if (!hasOverrides) return;
        void setAprSettings({
            aprPercentNumberFontSize1Digit: undefined,
            aprPercentNumberFontSize2Digit: undefined,
            aprPercentNumberFontSize3Digit: undefined
        });
    };

    clearPercentNumberOverrides();

    const applyFontDropdown = (
        drop: DropdownComponent,
        currentValue: string | undefined,
        onSave: (value: string) => Promise<void>
    ): { setValue: (value: string) => void } => {
        const customValue = '__custom__';
        let currentFont = currentValue || 'Inter';
        let isUpdating = false;
        const isCustomFont = (value: string): boolean => {
            const normalized = value.trim();
            const normalizedValue = normalized === 'Inter' ? 'default' : normalized;
            return !FONT_OPTIONS.some(opt => opt.value === normalizedValue) && normalizedValue !== 'default';
        };
        const doc = drop.selectEl.ownerDocument;
        const fontCanvas = doc.win.createEl('canvas');
        const fontContext = fontCanvas?.getContext('2d') ?? null;
        const fontSample = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const isFontLoaded = (value: string): boolean => {
            if (!isCustomFont(value)) return true;
            const trimmed = value.trim();
            if (!trimmed) return false;
            const fallback = 'monospace';
            if (!fontContext) return true;
            fontContext.font = `16px ${fallback}`;
            const baseline = fontContext.measureText(fontSample).width;
            fontContext.font = `16px "${trimmed}", ${fallback}`;
            const measured = fontContext.measureText(fontSample).width;
            const metricsMatch = measured === baseline;
            if (metricsMatch) return false;
            if (!('fonts' in doc)) return true;
            try {
                return doc.fonts.check(`16px "${trimmed}"`) || doc.fonts.check(`16px ${trimmed}`);
            } catch {
                return false;
            }
        };
        const updateWarningState = (value: string): void => {
            const normalized = value.trim();
            const showWarning = isCustomFont(normalized) && !isFontLoaded(normalized);
            drop.selectEl.classList.toggle('ert-typography-select--warning', showWarning);
            if (showWarning) {
                drop.selectEl.title = `Font not loaded: ${normalized}. Check spelling or install the font.`;
            } else {
                drop.selectEl.removeAttribute('title');
            }
        };

        const updateOptions = (value: string): void => {
            isUpdating = true;
            while (drop.selectEl.firstChild) {
                drop.selectEl.firstChild.remove();
            }
            FONT_OPTIONS.forEach(font => { drop.addOption(font.value, font.label); });
            const normalized = value === 'Inter' ? 'default' : value;
            const hasOption = FONT_OPTIONS.some(opt => opt.value === normalized);
            if (!hasOption) {
                drop.addOption(normalized, `Custom: ${normalized}`);
            }
            drop.addOption(customValue, t('settings.authorProgress.styling.customFontModal.customOption'));
            drop.setValue(normalized);
            updateWarningState(currentFont);
            isUpdating = false;
        };

        const openCustomModal = (): void => {
            const modal = new Modal(app);
            modal.modalEl.addClass('ert-typography-modal');
            modal.titleEl.setText(t('settings.authorProgress.styling.customFontModal.title'));
            modal.onClose = () => {
                updateOptions(currentFont);
            };

            const body = modal.contentEl.createDiv({ cls: 'ert-typography-modal__body' });
            body.createEl('p', { text: t('settings.authorProgress.styling.customFontModal.hint'), cls: 'ert-typography-modal__hint' });

            const input = new TextComponent(body);
            input.setPlaceholder(t('settings.authorProgress.styling.customFontModal.placeholder'));
            input.inputEl.addClass('ert-typography-modal__input');

            const normalized = currentFont === 'Inter' ? 'default' : currentFont;
            if (!FONT_OPTIONS.some(opt => opt.value === normalized)) {
                input.setValue(currentFont);
            }

            const actions = modal.contentEl.createDiv({ cls: 'ert-typography-modal__actions' });
            new ButtonComponent(actions)
                .setButtonText(t('settings.authorProgress.styling.customFontModal.save'))
                .setCta()
                .onClick(async () => {
                    const value = input.getValue().trim();
                    if (!value) {
                        input.inputEl.focus();
                        return;
                    }
                    await onSave(value);
                    currentFont = value;
                    updateOptions(currentFont);
                    modal.close();
                });

            new ButtonComponent(actions)
                .setButtonText(t('settings.authorProgress.styling.customFontModal.cancel'))
                .onClick(() => {
                    modal.close();
                });

            modal.open();
        };

        updateOptions(currentFont);

        drop.onChange(async (val) => {
            if (isUpdating) return;
            if (val === customValue) {
                openCustomModal();
                return;
            }
            const next = val === 'default' ? 'Inter' : val;
            if (next === currentFont) return;
            await onSave(next);
            currentFont = next;
            updateWarningState(currentFont);
        });

        const setValue = (value: string): void => {
            const next = value || 'Inter';
            currentFont = next;
            updateOptions(currentFont);
        };

        return { setValue };
    };

    type TypographyControlOptions = {
        familyKey: keyof AuthorProgressDefaults;
        weightKey: keyof AuthorProgressDefaults;
        italicKey: keyof AuthorProgressDefaults;
        sizeKeys?: (keyof AuthorProgressDefaults)[];
        sizePlaceholders?: string[];
        showSizeControls?: boolean;
        weightDefault: number;
        italicDefault?: boolean;
        fontDefault?: string;
    };

    type ElementBlockOptions = {
        label: string;
        desc: string;
        dataTypo: string;
        showAutoButton?: boolean;
        text?: {
            placeholder: string;
            value: string;
            onChange: (value: string) => Promise<void>;
        };
        primaryAction?: (rowEl: HTMLElement) => void;
        color?: {
            key: keyof AuthorProgressDefaults;
            value: string;
            fallback: string;
            onAfterChange?: (value: string) => void;
            setPickerRef?: (picker: ColorSwatchHandle) => void;
            setTextRef?: (text: TextComponent) => void;
        };
        typography?: TypographyControlOptions;
    };

    const buildTypographyControls = (
        rowEl: HTMLElement,
        opts: TypographyControlOptions,
        onUpdateAutoState: () => void,
        isSyncing: () => boolean
    ): {
        setFontValue: (value: string) => void;
        setStyleValue: (weight: number, italic: boolean) => void;
        sizeInputs: TextComponent[];
    } => {
        const fontDrop = new DropdownComponent(rowEl);
        fontDrop.selectEl.addClass('ert-input', 'ert-typography-select');
        const currentStyle = getActiveStyleSettings() as Record<string, unknown>;
        const currentFont = (currentStyle[opts.familyKey] as string | undefined) ?? opts.fontDefault ?? 'Inter';
        const { setValue: setFontValue } = applyFontDropdown(fontDrop, currentFont, async (val) => {
            if (isSyncing()) return;
            await setAprSetting(opts.familyKey, val as AuthorProgressDefaults[typeof opts.familyKey]);
            onUpdateAutoState();
        });

        const styleDrop = new DropdownComponent(rowEl);
        styleDrop.selectEl.addClass('ert-input', 'ert-typography-select');
        WEIGHT_OPTIONS.forEach(opt => { styleDrop.addOption(opt.value, opt.label); });
        const currentWeight = (currentStyle[opts.weightKey] as number | undefined) ?? opts.weightDefault;
        const currentItalic = (currentStyle[opts.italicKey] as boolean | undefined) ?? opts.italicDefault ?? false;
        let isStyleUpdating = false;
        styleDrop.setValue(formatWeightValue(currentWeight, currentItalic));
        styleDrop.onChange(async (val) => {
            if (isStyleUpdating || isSyncing()) return;
            const { weight, italic } = parseWeightValue(val);
            await setAprSettings({
                [opts.weightKey]: weight,
                [opts.italicKey]: italic
            });
            onUpdateAutoState();
        });

        const setStyleValue = (weight: number, italic: boolean): void => {
            isStyleUpdating = true;
            styleDrop.setValue(formatWeightValue(weight, italic));
            isStyleUpdating = false;
        };

        const sizeInputs: TextComponent[] = [];
        if (opts.sizeKeys?.length && opts.showSizeControls !== false) {
            const sizeGroup = rowEl.createDiv({ cls: 'ert-typography-size-group' });
            opts.sizeKeys.forEach((key, index) => {
                const input = new TextComponent(sizeGroup);
                input.setPlaceholder(opts.sizePlaceholders?.[index] ?? t('settings.authorProgress.styling.autoButton'));
                const currentValue = currentStyle[key] as number | undefined;
                input.setValue(currentValue !== undefined ? String(currentValue) : '');
                input.inputEl.addClass('ert-input');
                input.onChange(async (val) => {
                    if (isSyncing()) return;
                    const next = val.trim() ? numberFromText(val) : undefined;
                    if (val.trim() && next === undefined) return;
                    await setAprSetting(key, next as AuthorProgressDefaults[typeof key]);
                    onUpdateAutoState();
                });
                sizeInputs.push(input);
            });
        }

        return { setFontValue, setStyleValue, sizeInputs };
    };

    const addElementBlock = (parent: HTMLElement, opts: ElementBlockOptions): void => {
        const block = new Setting(parent).setName(opts.label).setDesc(opts.desc);
        block.settingEl.addClass('ert-elementBlock', 'ert-settingRow');
        block.settingEl.dataset.ertTypo = opts.dataTypo;
        block.controlEl.addClass('ert-elementBlock__right');
        const infoEl = block.settingEl.querySelector('.setting-item-info');
        infoEl?.classList.add('ert-elementBlock__left');

        const controlGroup = block.controlEl.createDiv({ cls: 'ert-controlGroup' });
        const rowPrimary = (opts.text || opts.typography)
            ? controlGroup.createDiv({ cls: 'ert-typography-controls' })
            : null;
        const rowSecondary = controlGroup.createDiv({ cls: 'ert-typography-controls' });

        let isSyncing = false;
        const isSyncingCheck = () => isSyncing;

        let autoButton: HTMLButtonElement | null = null;

        const normalizeHex = (val: string): string => val.trim().toLowerCase();
        const defaultFont = opts.typography?.fontDefault ?? 'Inter';
        const defaultWeight = opts.typography?.weightDefault ?? 400;
        const defaultItalic = opts.typography?.italicDefault ?? false;

        const updateAutoState = (): void => {
            const currentStyle = getActiveStyleSettings() as Record<string, unknown>;
            const colorAuto = (() => {
                if (!opts.color) return true;
                const currentColor = normalizeHex((currentStyle[opts.color.key] as string | undefined) ?? opts.color.fallback);
                const defaultColor = normalizeHex(opts.color.fallback);
                return currentColor === defaultColor;
            })();
            const typographyAuto = (() => {
                if (!opts.typography) return true;
                const currentFont = (currentStyle[opts.typography.familyKey] as string | undefined) ?? defaultFont;
                const currentWeight = (currentStyle[opts.typography.weightKey] as number | undefined) ?? defaultWeight;
                const currentItalic = (currentStyle[opts.typography.italicKey] as boolean | undefined) ?? defaultItalic;
                const isSizeAuto = opts.typography.sizeKeys?.length
                    ? opts.typography.sizeKeys.every(key => currentStyle[key] === undefined)
                    : true;
                return currentFont === defaultFont
                    && currentWeight === defaultWeight
                    && currentItalic === defaultItalic
                    && isSizeAuto;
            })();
            const isAuto = colorAuto && typographyAuto;
            if (autoButton) {
                autoButton.classList.toggle('is-active', isAuto);
            }
        };

        if (opts.text && rowPrimary) {
            const textConfig = opts.text;
            const textInput = new TextComponent(rowPrimary);
            textInput.setPlaceholder(textConfig.placeholder);
            textInput.setValue(textConfig.value);
            textInput.inputEl.addClass('ert-typography-text-input');
            textInput.inputEl.addClass('ert-input', 'ert-input--lg');
            textInput.onChange(async (val) => {
                if (isSyncing) return;
                await textConfig.onChange(val);
            });
        }

        let colorPicker: ColorSwatchHandle | null = null;
        let colorText: TextComponent | null = null;
        if (opts.color) {
            const colorConfig = opts.color;
            colorPicker = colorSwatch(rowSecondary, {
                value: colorConfig.value,
                ariaLabel: `${opts.label} color`,
                plugin,
                onChange: (val) => { void (async () => {
                    if (isSyncing) return;
                    const next = val || colorConfig.fallback;
                    await setAprSetting(colorConfig.key, next as AuthorProgressDefaults[typeof colorConfig.key]);
                    colorText?.setValue(next);
                    colorConfig.onAfterChange?.(next);
                    updateAutoState();
                })(); }
            });
            colorConfig.setPickerRef?.(colorPicker);

            colorText = new TextComponent(rowSecondary);
            colorConfig.setTextRef?.(colorText);
            colorText.inputEl.classList.add('ert-input', 'ert-input--hex');
            colorText.setPlaceholder(colorConfig.fallback).setValue(colorConfig.value);
            colorText.onChange(async (val) => {
                if (isSyncing) return;
                if (!val || !/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(val)) return;
                await setAprSetting(colorConfig.key, val as AuthorProgressDefaults[typeof colorConfig.key]);
                colorPicker?.setValue(val);
                colorConfig.onAfterChange?.(val);
                updateAutoState();
            });
        }

        opts.primaryAction?.(rowSecondary);

        if (opts.showAutoButton !== false) {
            autoButton = rowSecondary.createEl('button', { text: t('settings.authorProgress.styling.autoButton'), cls: 'ert-chip ert-typography-auto' });
            autoButton.type = 'button';
        }

        const typographyRefs = (opts.typography && rowPrimary)
            ? buildTypographyControls(rowPrimary, opts.typography, updateAutoState, isSyncingCheck)
            : null;

        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        autoButton?.addEventListener('click', () => { void (async () => {
            if (!plugin.settings.authorProgress) return;
            const updates: Partial<AuthorProgressDefaults> = {};
            if (opts.color) {
                (updates as Record<string, unknown>)[opts.color.key] = opts.color.fallback;
            }
            if (opts.typography) {
                Object.assign(updates, {
                    [opts.typography.familyKey]: defaultFont,
                    [opts.typography.weightKey]: defaultWeight,
                    [opts.typography.italicKey]: defaultItalic
                } as Partial<AuthorProgressDefaults>);
                opts.typography.sizeKeys?.forEach((key) => {
                    updates[key] = undefined;
                });
            }
            await setAprSettings(updates);
            isSyncing = true;
            if (opts.color) {
                colorPicker?.setValue(opts.color.fallback);
                colorText?.setValue(opts.color.fallback);
            }
            if (typographyRefs) {
                typographyRefs.setFontValue(defaultFont);
                typographyRefs.setStyleValue(defaultWeight, defaultItalic);
                typographyRefs.sizeInputs.forEach(input => { input.setValue(''); });
            }
            opts.color?.onAfterChange?.(opts.color.fallback);
            isSyncing = false;
            updateAutoState();
        })(); });

        updateAutoState();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // COLOR PALETTE + TITLE BLOCK
    // ─────────────────────────────────────────────────────────────────────────
    const currentBookTitleColorVal = styleSettings.aprBookAuthorColor || bookTitleColorFallback;

    // ─────────────────────────────────────────────────────────────────────────
    // ELEMENT BLOCKS (Title, Author, % Symbol, % Number, Stage Badge / RT Mark)
    // ─────────────────────────────────────────────────────────────────────────
    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.title.label'),
        desc: t('settings.authorProgress.styling.title.desc'),
        dataTypo: 'title',
        color: {
            key: 'aprBookAuthorColor',
            value: currentBookTitleColorVal,
            fallback: bookTitleColorFallback,
            setPickerRef: (picker) => {
                bookTitleColorPickerRef = picker;
            },
            setTextRef: (text) => {
                bookTitleTextRef = text;
            }
        },
        typography: {
            familyKey: 'aprBookTitleFontFamily',
            weightKey: 'aprBookTitleFontWeight',
            italicKey: 'aprBookTitleFontItalic',
            sizeKeys: ['aprBookTitleFontSize'],
            sizePlaceholders: ['Auto'],
            showSizeControls: false,
            weightDefault: 400
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AUTHOR
    // ─────────────────────────────────────────────────────────────────────────
    const authorColorFallback = styleSettings.aprBookAuthorColor || bookTitleColorFallback;
    const currentAuthorColor = styleSettings.aprAuthorColor || authorColorFallback;

    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.author.label'),
        desc: t('settings.authorProgress.styling.author.desc'),
        dataTypo: 'author',
        text: {
            placeholder: t('settings.authorProgress.styling.author.placeholder'),
            value: settings?.authorName || '',
            onChange: async (val) => {
                await setAprSetting('authorName', val as AuthorProgressDefaults['authorName']);
            }
        },
        color: {
            key: 'aprAuthorColor',
            value: currentAuthorColor,
            fallback: authorColorFallback,
            setPickerRef: (picker) => {
                authorColorPickerRef = picker;
            },
            setTextRef: (text) => {
                authorTextRef = text;
            }
        },
        typography: {
            familyKey: 'aprAuthorNameFontFamily',
            weightKey: 'aprAuthorNameFontWeight',
            italicKey: 'aprAuthorNameFontItalic',
            sizeKeys: ['aprAuthorNameFontSize'],
            sizePlaceholders: ['Auto'],
            showSizeControls: false,
            weightDefault: 400
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // % SYMBOL
    // ─────────────────────────────────────────────────────────────────────────
    const percentSymbolColorFallback = styleSettings.aprBookAuthorColor || bookTitleColorFallback;
    const currentPercentSymbolColor = styleSettings.aprPercentSymbolColor || percentSymbolColorFallback;

    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.percentSymbol.label'),
        desc: t('settings.authorProgress.styling.percentSymbol.desc'),
        dataTypo: 'percent-symbol',
        color: {
            key: 'aprPercentSymbolColor',
            value: currentPercentSymbolColor,
            fallback: percentSymbolColorFallback,
            setPickerRef: (picker) => {
                percentSymbolColorPickerRef = picker;
            },
            setTextRef: (text) => {
                percentSymbolTextRef = text;
            }
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // % NUMBER
    // ─────────────────────────────────────────────────────────────────────────
    const percentNumberColorFallback = styleSettings.aprBookAuthorColor || bookTitleColorFallback;
    const currentPercentNumberColor = styleSettings.aprPercentNumberColor || percentNumberColorFallback;

    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.percentNumber.label'),
        desc: t('settings.authorProgress.styling.percentNumber.desc'),
        dataTypo: 'percent-number',
        color: {
            key: 'aprPercentNumberColor',
            value: currentPercentNumberColor,
            fallback: percentNumberColorFallback,
            setPickerRef: (picker) => {
                percentNumberColorPickerRef = picker;
            },
            setTextRef: (text) => {
                percentNumberTextRef = text;
            }
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STAGE / RT
    // ─────────────────────────────────────────────────────────────────────────
    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.stageBadge.label'),
        desc: t('settings.authorProgress.styling.stageBadge.desc'),
        dataTypo: 'ert-badgePill',
        showAutoButton: false,
        typography: {
            familyKey: 'aprRtBadgeFontFamily',
            weightKey: 'aprRtBadgeFontWeight',
            italicKey: 'aprRtBadgeFontItalic',
            sizeKeys: ['aprRtBadgeFontSize'],
            sizePlaceholders: ['Auto'],
            showSizeControls: false,
            weightDefault: 700
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TRANSPARENT MODE, BACKGROUND COLOR, SPOKES AND BORDERS (styled like Theme rows)
    // ─────────────────────────────────────────────────────────────────────────
    const transparencySetting = new Setting(themeBody)
        .setName(t('settings.authorProgress.styling.transparentMode.name'))
        .setDesc(t('settings.authorProgress.styling.transparentMode.desc'));
    transparencySetting.settingEl.addClass('ert-elementBlock', 'ert-settingRow');

    const bgSetting = new Setting(themeBody)
        .setName(t('settings.authorProgress.styling.backgroundColor.name'))
        .setDesc(t('settings.authorProgress.styling.backgroundColor.desc'));
    bgSetting.settingEl.addClass('ert-elementBlock', 'ert-settingRow');

    let bgColorPicker: ColorSwatchHandle | null = null;
    let bgTextInput: TextComponent | null = null;
    // Assigned by the Borders setting (declared below). When background changes and the
    // border mode is 'sync', the border swatch needs to follow.
    let refreshBorderSwatchFromBg: (() => void) | null = null;

    const updateEmphasis = (isTransparent: boolean) => {
        if (isTransparent) {
            bgSetting.settingEl.classList.add('is-inactive');
            if (bgColorPicker) bgColorPicker.setDisabled(true);
            if (bgTextInput) bgTextInput.setDisabled(true);
        } else {
            bgSetting.settingEl.classList.remove('is-inactive');
            if (bgColorPicker) bgColorPicker.setDisabled(false);
            if (bgTextInput) bgTextInput.setDisabled(false);
        }
    };

    transparencySetting.addToggle(toggle => {
        toggle.setValue(currentTransparent);
        toggle.onChange(async (val) => {
            await setAprSetting('aprCenterTransparent', val as AuthorProgressDefaults['aprCenterTransparent']);
            updateEmphasis(val);
        });
    });

    // ── Source label ─────────────────────────────────────────────────────
    // Shows which preset (if any) matches the current background color.
    // Created early so onChange handlers below can reference it.
    const bgSourceLabel = bgSetting.controlEl.createDiv({ cls: 'ert-bg-source-label' });

    // Social media platform background presets
    // Dark-mode: actual card/feed background color per platform dark theme.
    // Light-mode: White is the most common light-mode feed bg.
    const platformPresets: Array<{ label: string; color: string }> = [
        // — Dark backgrounds —
        { label: 'X / Twitter', color: '#000000' },
        { label: 'Bluesky', color: '#161E27' },
        { label: 'Facebook', color: '#242526' },
        { label: 'Instagram', color: '#000000' },
        { label: 'LinkedIn', color: '#1B1F23' },
        { label: 'Threads', color: '#101010' },
        { label: 'Discord', color: '#313338' },
        { label: 'Kickstarter', color: '#0B3B2D' },
        { label: 'Patreon', color: '#141518' },
        { label: 'Substack', color: '#121212' },
        // — Light backgrounds —
        { label: 'White', color: '#FFFFFF' },
    ];

    // Custom presets (user-saved colors with custom names)
    const MAX_CUSTOM_PRESETS = 2;
    const getCustomPresets = (): Array<{ label: string; color: string }> => {
        return plugin.settings.authorProgress?.defaults.aprCustomBgPresets ?? [];
    };

    // Resolve which preset name matches a color (check built-in, then custom)
    const resolveSourceName = (hex: string): string | null => {
        const norm = hex.toUpperCase().trim();
        const builtIn = platformPresets.find(p => p.color.toUpperCase() === norm);
        if (builtIn) return builtIn.label;
        const custom = getCustomPresets().find(p => p.color.toUpperCase() === norm);
        if (custom) return custom.label;
        return null;
    };

    const updateSourceLabel = (hex: string) => {
        const name = resolveSourceName(hex);
        if (name) {
            bgSourceLabel.textContent = name;
            bgSourceLabel.classList.remove('is-hidden');
        } else {
            bgSourceLabel.textContent = '';
            bgSourceLabel.classList.add('is-hidden');
        }
    };

    const bgSwatch = colorSwatch(bgSetting.controlEl, {
        value: currentBg,
        ariaLabel: 'Background color',
        plugin,
        onChange: (val) => { void (async () => {
            const next = val || '#0d0d0f';
            await setAprSetting('aprBackgroundColor', next as AuthorProgressDefaults['aprBackgroundColor']);
            bgTextInput?.setValue(next);
            updateSourceLabel(next);
            refreshBorderSwatchFromBg?.();
        })(); }
    });
    bgColorPicker = bgSwatch;

    bgSetting.addText(text => {
        bgTextInput = text;
        text.setPlaceholder('#0d0d0f').setValue(currentBg);
        text.inputEl.classList.add('ert-input', 'ert-input--hex');
        text.onChange(async (val) => {
            if (!val) return;
            await setAprSetting('aprBackgroundColor', val as AuthorProgressDefaults['aprBackgroundColor']);
            bgColorPicker?.setValue(val);
            updateSourceLabel(val);
            refreshBorderSwatchFromBg?.();
        });
    });

    updateEmphasis(currentTransparent);

    // Initialize source label with current color
    updateSourceLabel(currentBg);

    // ── Platform preset pills ────────────────────────────────────────────
    const platformRow = themeBody.createDiv({ cls: 'ert-platform-presets' });
    platformRow.createSpan({ text: 'Platform backgrounds', cls: 'ert-platform-presets__label' });
    const platformSwatches = platformRow.createDiv({ cls: 'ert-platform-presets__swatches' });

    const applyPreset = async (color: string) => {
        await setAprSetting('aprBackgroundColor', color as AuthorProgressDefaults['aprBackgroundColor']);
        bgColorPicker?.setValue(color);
        bgTextInput?.setValue(color);
        updateSourceLabel(color);
        refreshBorderSwatchFromBg?.();
    };

    for (const preset of platformPresets) {
        const btn = platformSwatches.createEl('button', {
            cls: 'ert-platform-swatch',
            attr: { 'aria-label': `${preset.label} (${preset.color})`, type: 'button' }
        });
        btn.style.setProperty('--swatch-color', preset.color);
        btn.createSpan({ cls: 'ert-platform-swatch__color' });
        btn.createSpan({ cls: 'ert-platform-swatch__name', text: preset.label });
        btn.addEventListener('click', () => { void applyPreset(preset.color); });
    }

    // Separator between platform and custom presets
    platformSwatches.createSpan({ cls: 'ert-platform-presets__divider', text: '—' });

    // Custom preset pills (inline after the divider)
    const customSwatchContainer = platformSwatches.createSpan({ cls: 'ert-platform-presets__custom-inline' });

    const renderCustomPills = () => {
        customSwatchContainer.empty();
        const customs = getCustomPresets();

        for (let i = 0; i < MAX_CUSTOM_PRESETS; i++) {
            const saved = customs[i];
            const btn = customSwatchContainer.createEl('button', {
                cls: `ert-platform-swatch${saved ? '' : ' ert-platform-swatch--empty'}`,
                attr: {
                    'aria-label': saved ? `${saved.label} (${saved.color})` : `Custom ${i + 1} — click to set`,
                    type: 'button'
                }
            });

            if (saved) {
                btn.style.setProperty('--swatch-color', saved.color);
                btn.createSpan({ cls: 'ert-platform-swatch__color' });
                btn.createSpan({ cls: 'ert-platform-swatch__name', text: saved.label });

                // Click → apply the saved color
                btn.addEventListener('click', () => { void applyPreset(saved.color); });

                // Long-press / right-click → open editor to rename or delete
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    openCustomPresetModal(i, saved);
                });
            } else {
                const icon = btn.createSpan({ cls: 'ert-platform-swatch__icon' });
                setIcon(icon, 'plus');
                btn.createSpan({ cls: 'ert-platform-swatch__name', text: `Custom ${i + 1}` });
                btn.addEventListener('click', () => openCustomPresetModal(i, null));
            }
        }
    };

    const openCustomPresetModal = (index: number, existing: { label: string; color: string } | null) => {
        const modal = new CustomBgPresetModal(app, plugin, {
            index,
            existing,
            currentBg: getActiveStyleSettings().aprBackgroundColor ?? '#0d0d0f',
            onSave: async (preset) => {
                if (!plugin.settings.authorProgress) return;
                const presets = [...getCustomPresets()];
                presets[index] = preset;
                plugin.settings.authorProgress.defaults.aprCustomBgPresets = presets;
                await plugin.saveSettings();
                renderCustomPills();
                void applyPreset(preset.color);
            },
            onDelete: async () => {
                if (!plugin.settings.authorProgress) return;
                const presets = [...getCustomPresets()];
                presets.splice(index, 1);
                plugin.settings.authorProgress.defaults.aprCustomBgPresets = presets;
                await plugin.saveSettings();
                renderCustomPills();
                updateSourceLabel(getActiveStyleSettings().aprBackgroundColor ?? '#0d0d0f');
            }
        });
        modal.open();
    };

    renderCustomPills();

    const spokeColorSetting = new Setting(themeBody)
        .setName(t('settings.authorProgress.styling.spokesAndBorders.name'))
        .setDesc(t('settings.authorProgress.styling.spokesAndBorders.desc'));
    spokeColorSetting.settingEl.addClass('ert-elementBlock', 'ert-settingRow');
    spokeColorSetting.controlEl.addClass(ERT_CLASSES.INLINE);

    let spokeColorPickerRef: ColorSwatchHandle | undefined;
    let spokeColorInputRef: TextComponent | undefined;

    // The effective rendered border color depends on the spoke mode. Mirror resolveStructuralColors()
    // in AprRenderer.ts so the swatch + hex input always show what the renderer will actually draw.
    const effectiveBorderColor = (
        mode: 'dark' | 'light' | 'none' | 'sync' | 'custom',
        customColor: string,
        bgColor: string
    ): string => {
        if (mode === 'custom') return customColor;
        if (mode === 'sync') return bgColor;
        if (mode === 'light') return '#000000'; // "Dark Borders"
        if (mode === 'none') return 'transparent';
        return '#ffffff'; // 'dark' → "Light Borders"
    };

    const isCustomMode = currentSpokeMode === 'custom';
    const fallbackColor = '#ffffff';
    const initialEffective = effectiveBorderColor(currentSpokeMode, currentSpokeColor, currentBg);
    const spokeControlRow = spokeColorSetting.controlEl;
    const spokeColorPicker = colorSwatch(spokeControlRow, {
        value: initialEffective,
        ariaLabel: 'Spoke color',
        plugin,
        onChange: (val) => { void (async () => {
            if (/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(val)) {
                await setAprSetting('aprSpokeColor', (val || fallbackColor) as AuthorProgressDefaults['aprSpokeColor']);
                spokeColorInputRef?.setValue(val);
            }
        })(); }
    });
    spokeColorPickerRef = spokeColorPicker;
    spokeColorPicker.setDisabled(!isCustomMode);

    const spokeColorInput = new TextComponent(spokeControlRow);
    spokeColorInputRef = spokeColorInput;
    spokeColorInput.inputEl.classList.add('ert-input', 'ert-input--hex');
    spokeColorInput.setPlaceholder(fallbackColor).setValue(initialEffective);
    spokeColorInput.setDisabled(!isCustomMode);
    spokeColorInput.onChange(async (val) => {
        if (!val) return;
        if (/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(val)) {
            await setAprSetting('aprSpokeColor', val as AuthorProgressDefaults['aprSpokeColor']);
            spokeColorPickerRef?.setValue(val);
        }
    });

    // Exposed so the background-color controls can keep the border swatch in sync when mode is 'sync'.
    refreshBorderSwatchFromBg = () => {
        const style = getActiveStyleSettings();
        const mode = (style.aprSpokeColorMode ?? 'dark');
        if (mode !== 'sync') return;
        const eff = effectiveBorderColor(mode, style.aprSpokeColor ?? fallbackColor, style.aprBackgroundColor ?? currentBg);
        spokeColorPickerRef?.setValue(eff);
        spokeColorInputRef?.setValue(eff);
    };

    const spokeModeDropdown = new DropdownComponent(spokeControlRow);
    spokeModeDropdown.addOption('dark', t('settings.authorProgress.styling.strokeLightStrokes'));
    spokeModeDropdown.addOption('light', t('settings.authorProgress.styling.strokeDarkStrokes'));
    spokeModeDropdown.addOption('none', t('settings.authorProgress.styling.strokeNoStrokes'));
    spokeModeDropdown.addOption('sync', t('settings.authorProgress.styling.strokeSyncBackground'));
    spokeModeDropdown.addOption('custom', t('settings.authorProgress.styling.strokeCustomColor'));
    spokeModeDropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
    const currentValue = currentSpokeMode !== 'dark' ? currentSpokeMode : (currentTheme !== 'dark' ? currentTheme : 'dark');
    spokeModeDropdown.setValue(currentValue);
    fitSelectToSelectedLabel(spokeModeDropdown.selectEl, { minPx: 132, maxPx: 260, extraPx: 16 });
    spokeModeDropdown.onChange(async (val) => {
        const mode = (val as 'dark' | 'light' | 'none' | 'custom' | 'sync') || 'dark';
        await setAprSettings({
            aprTheme: (mode === 'custom' || mode === 'sync') ? 'dark' : (mode),
            aprSpokeColorMode: mode
        });

        const isCustom = mode === 'custom';
        spokeColorPickerRef?.setDisabled(!isCustom);
        spokeColorInputRef?.setDisabled(!isCustom);

        const style = getActiveStyleSettings();
        const eff = effectiveBorderColor(mode, style.aprSpokeColor ?? fallbackColor, style.aprBackgroundColor ?? currentBg);
        spokeColorInputRef?.setValue(eff);
        spokeColorPickerRef?.setValue(eff);
        fitSelectToSelectedLabel(spokeModeDropdown.selectEl, { minPx: 132, maxPx: 260, extraPx: 16 });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLISHING SECTION
    // Pro users use Campaign Manager instead, non-Pro users see basic publishing options
    // ─────────────────────────────────────────────────────────────────────────


    // ─────────────────────────────────────────────────────────────────────────
    // PUBLISHING SECTION
    // Pro users use Campaign Manager instead, non-Pro users see basic publishing options
    // ─────────────────────────────────────────────────────────────────────────

    // Only show basic Publishing & Automation for non-Pro users
    if (!isProActive) {
        const automationCard = section.createDiv({ cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK}` });
        const automationHeader = new Setting(automationCard)
            .setName(t('settings.authorProgress.publishing.name'))
            .setHeading();
        addHeadingIcon(automationHeader, 'rss');
        addWikiLink(automationHeader, 'Author-Progress-Report#export-and-refresh');
        applyErtHeaderLayout(automationHeader);

        const frequencySetting = new Setting(automationCard)
            .setName(t('settings.authorProgress.publishing.updateFrequency.name'))
            .setDesc(t('settings.authorProgress.publishing.updateFrequency.desc'))
            .addDropdown(dropdown => {
                dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
                dropdown
                    .addOption('manual', t('settings.authorProgress.publishing.frequencyManual'))
                    .addOption('daily', t('settings.authorProgress.publishing.frequencyDaily'))
                    .addOption('weekly', t('settings.authorProgress.publishing.frequencyWeekly'))
                    .addOption('monthly', t('settings.authorProgress.publishing.frequencyMonthly'))
                    .setValue(settings?.updateFrequency || 'manual')
                    .onChange(async (val) => {
                    if (plugin.settings.authorProgress) {
                        const current = plugin.settings.authorProgress.defaults;
                        const defaultFormat = resolveDefaultExportFormat(plugin.settings.authorProgress);
                        const oldDefaultPath = buildDefaultEmbedPath({
                            bookTitle: plugin.getActiveBookTitle(),
                            updateFrequency: current.updateFrequency,
                            aprExportQuality: current.aprExportQuality,
                            exportFormat: defaultFormat
                        });
                        // Dropdown options are limited to the AuthorProgressFrequency values above
                        current.updateFrequency = val as AuthorProgressFrequency;
                        if (current.exportPath === oldDefaultPath) {
                            current.exportPath = buildDefaultEmbedPath({
                                bookTitle: plugin.getActiveBookTitle(),
                                updateFrequency: current.updateFrequency,
                                aprExportQuality: current.aprExportQuality,
                                exportFormat: defaultFormat
                            });
                        }
                        await plugin.saveSettings();
                    }
                });
                fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 92, maxPx: 180, extraPx: 16 });
            });

        // Add red alert border when refresh is needed
        if (needsRefresh) {
            frequencySetting.settingEl.classList.add('ert-apr-refresh-alert');
        }

        // Conditional Manual Settings
        if (settings?.updateFrequency === 'manual') {
            const currentDays = settings?.stalenessThresholdDays || 30;
            const stalenessSetting = new Setting(automationCard)
                .setName(t('settings.authorProgress.publishing.refreshAlertThreshold.name'))
                .setDesc(t('settings.authorProgress.publishing.refreshAlertThreshold.desc', { days: currentDays }))
                .addSlider(slider => {
                    slider
                        .setLimits(1, 90, 1)
                        .setValue(currentDays)
                        .onChange(async (val) => {
                            if (plugin.settings.authorProgress) {
                                plugin.settings.authorProgress.defaults.stalenessThresholdDays = val;
                                await plugin.saveSettings();
                                // Update description with new value
                                const descEl = stalenessSetting.descEl;
                                if (descEl) {
                                    descEl.setText(t('settings.authorProgress.publishing.refreshAlertThreshold.desc', { days: val }));
                                }
                                // Update value label
                                if (valueLabel) {
                                    valueLabel.setText(String(val));
                                }
                            }
                        });

                    // Add value label above the slider thumb
                    const sliderEl = slider.sliderEl;
                    const valueLabel = sliderEl.parentElement?.createSpan({
                        cls: 'ert-sliderValueLabel',
                        text: String(currentDays)
                    });

                    return slider;
                });

            // Add red alert border when refresh is needed
            if (needsRefresh) {
                stalenessSetting.settingEl.classList.add('ert-apr-refresh-alert');
            }
        }

        const exportPathSetting = new Setting(automationCard)
            .setName(t('settings.authorProgress.publishing.exportPath.name'))
            .setDesc(t('settings.authorProgress.publishing.exportPath.desc'));

        exportPathSetting.settingEl.addClass('ert-setting-full-width-input');

        exportPathSetting.addText(text => {
            const defaultFormat = resolveDefaultExportFormat(plugin.settings.authorProgress);
            const defaultPath = buildDefaultEmbedPath({
                bookTitle: plugin.getActiveBookTitle(),
                updateFrequency: settings?.updateFrequency,
                aprExportQuality: settings?.aprExportQuality,
                exportFormat: defaultFormat
            });
            const successClass = 'ert-input--success';
            const errorClass = 'ert-input--error';
            const clearInputState = () => {
                text.inputEl.removeClass(successClass);
                text.inputEl.removeClass(errorClass);
            };
            const flashError = (timeout = 2000) => {
                text.inputEl.addClass(errorClass);
                window.setTimeout(() => {
                    text.inputEl.removeClass(errorClass);
                }, timeout);
            };
            const flashSuccess = (timeout = 1000) => {
                text.inputEl.addClass(successClass);
                window.setTimeout(() => {
                    text.inputEl.removeClass(successClass);
                }, timeout);
            };
            text.setPlaceholder(defaultPath)
                .setValue(settings?.exportPath || defaultPath);
            text.inputEl.addClass('ert-input', 'ert-input--full');

            // Validate on blur
            const handleBlur = async () => {
                const val = text.getValue().trim();
                clearInputState();

                if (!val) {
                    // Empty is invalid - needs a path
                    flashError();
                    return;
                }

                if (!val.toLowerCase().endsWith(`.${defaultFormat}`)) {
                    flashError();
                    return;
                }

                // Valid - save
                if (plugin.settings.authorProgress) {
                    plugin.settings.authorProgress.defaults.exportPath = val;
                    await plugin.saveSettings();
                    flashSuccess();
                }
            };

            plugin.registerDomEvent(text.inputEl, 'blur', () => { void handleBlur(); });

            // Also handle Enter key
            plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    text.inputEl.blur();
                }
            });

            exportPathSetting.addExtraButton(button => {
                button.setIcon('rotate-ccw');
                button.setTooltip(`Reset to ${defaultPath}`);
                button.onClick(async () => {
                    text.setValue(defaultPath);
                    if (!plugin.settings.authorProgress) {
                        plugin.settings.authorProgress = { ...DEFAULT_SETTINGS.authorProgress! };
                    }
                    plugin.settings.authorProgress.defaults.exportPath = normalizePath(defaultPath);
                    await plugin.saveSettings();
                    flashSuccess();
                });
            });
        });

    } // End of non-Pro publishing section

    // ─────────────────────────────────────────────────────────────────────────
    // CAMPAIGN MANAGER (PRO FEATURE)
    // Always visible; locked styling handled inside section when Pro is inactive
    // ─────────────────────────────────────────────────────────────────────────
    const proContainer = section.createDiv({ cls: `${ERT_CLASSES.SKIN_PRO} ${ERT_CLASSES.STACK}` });
    renderCampaignManagerSection({
        app,
        plugin,
        containerEl: proContainer,
        onCampaignChange: () => {
            // Refresh the hero preview when campaigns change
            refreshPreview?.();
        },
        onDesignerContextChange: () => {
            rerenderSection();
        },
        registerStyleRefresh: (fn) => {
            refreshCampaignStyleState = fn;
        }
    });

    if (isProActive) {
        const attributionCard = proContainer.createDiv({
            cls: `${ERT_CLASSES.PANEL} ${ERT_CLASSES.STACK} ${ERT_CLASSES.SKIN_PRO}`
        });

        const attributionSetting = new Setting(attributionCard)
            .setName(t('settings.authorProgress.attribution.name'))
            .setDesc(t('settings.authorProgress.attribution.desc'))
            .addToggle(toggle => {
                toggle.setValue(getActiveStyleSettings().aprShowRtAttribution !== false)
                    .onChange(async (val) => {
                        await setAprSetting('aprShowRtAttribution', val as AuthorProgressDefaults['aprShowRtAttribution']);
                    });
            });
        attributionSetting.settingEl.addClass('ert-setting--flush');
    }
}

/**
 * Render the Social SVG preview in the hero section
 * Uses the dedicated Social renderer at 1:1 actual size
 */
async function renderHeroPreview(
    app: App,
    plugin: RadialTimelinePlugin,
    container: HTMLElement,
    size: 'small' | 'medium' | 'large' = 'medium',
    teaserPreviewMode: TeaserPreviewMode = 'auto'
): Promise<void> {
    try {
        const scenes = await getAllScenes(app, plugin);

        if (scenes.length === 0) {
            container.empty();
            container.createDiv({
                cls: 'ert-apr-preview-empty',
                text: t('settings.authorProgress.preview.emptyState')
            });
            return;
        }

        // Calculate progress and style from shared APR services
        const service = new AuthorProgressService(plugin, app);
        const progressState = service.resolveProgressState(scenes);
        const progressPercent = progressState.percent;
        const resolvedStyle = service.resolveDesignerStyle();
        const activeDesignerCampaign = service.getDesignerCampaign();

        const authorProgress = plugin.settings.authorProgress;
        const aprSettings = authorProgress?.defaults;
        const isProActive = hasProFeatureAccess(plugin);
        const showRtAttribution = isProActive
            ? resolvedStyle.aprShowRtAttribution !== false
            : true;

        const baseShowSubplots = aprSettings?.showSubplots ?? true;
        const baseShowActs = aprSettings?.showActs ?? true;
        const baseShowStatusColors = aprSettings?.showStatus ?? true;
        const baseShowProgressPercent = aprSettings?.showProgressPercent ?? true;

        let showScenes = true;
        let showSubplots = baseShowSubplots;
        let showActs = baseShowActs;
        let showStatusColors = baseShowStatusColors;
        let showStageColors = true;
        let grayCompletedScenes = false;
        let grayscaleScenes = false;
        let showProgressPercent = baseShowProgressPercent;
        let showBranding = true;

        if (isProActive) {
            let previewLevel: TeaserRevealLevel | null = null;
            if (teaserPreviewMode !== 'auto') {
                previewLevel = teaserPreviewMode;
            } else {
                const campaigns = authorProgress?.campaigns ?? [];
                const activeCampaign = activeDesignerCampaign ?? campaigns.find(c => c.isActive) ?? campaigns[0];
                const teaserSettings = activeCampaign?.teaserReveal;
                if (teaserSettings?.enabled) {
                    const preset = teaserSettings.preset ?? 'standard';
                    const thresholds = getTeaserThresholds(preset, teaserSettings.customThresholds);
                    previewLevel = getTeaserRevealLevel(progressPercent, thresholds, teaserSettings.disabledStages);
                }
            }

            if (previewLevel) {
                const revealOptions = teaserLevelToRevealOptions(previewLevel);
                showScenes = revealOptions.showScenes;
                showSubplots = revealOptions.showSubplots;
                showActs = revealOptions.showActs;
                showStatusColors = revealOptions.showStatusColors;
                showStageColors = revealOptions.showStageColors;
                grayCompletedScenes = revealOptions.grayCompletedScenes;
                grayscaleScenes = revealOptions.grayscaleScenes;

                if (previewLevel === 'ring') {
                    showProgressPercent = false;
                    showBranding = false;
                }
            }
        }

        const displayPercent = progressPercent;
        const previewBookTitle = activeDesignerCampaign?.targetBookId
            ? plugin.settings.books?.find(book => book.id === activeDesignerCampaign.targetBookId)?.title?.trim() || plugin.getActiveBookTitle()
            : plugin.getActiveBookTitle();
        const { svgString, width, height } = createAprSVG(scenes, {
            size: size,
            progressPercent: displayPercent,
            bookTitle: previewBookTitle,
            authorName: aprSettings?.authorName || '',
            showScenes,
            showSubplots,
            showActs,
            showStatusColors,
            showStageColors,
            grayCompletedScenes,
            grayscaleScenes,
            showProgressPercent,
            showBranding,
            centerMark: 'none',
            stageColors: plugin.settings.publishStageColors,
            workingPatternId: plugin.settings.workingPatternId,
            customWorkingPatterns: plugin.settings.customWorkingPatterns,
            actCount: plugin.settings.actCount || undefined,
            backgroundColor: resolvedStyle.aprBackgroundColor,
            transparentCenter: resolvedStyle.aprCenterTransparent,
            bookAuthorColor: resolvedStyle.aprBookAuthorColor ?? (plugin.settings.publishStageColors?.Press),
            authorColor: resolvedStyle.aprAuthorColor ?? resolvedStyle.aprBookAuthorColor ?? (plugin.settings.publishStageColors?.Press),
            engineColor: resolvedStyle.aprEngineColor,
            percentNumberColor: resolvedStyle.aprPercentNumberColor ?? resolvedStyle.aprBookAuthorColor ?? (plugin.settings.publishStageColors?.Press),
            percentSymbolColor: resolvedStyle.aprPercentSymbolColor ?? resolvedStyle.aprBookAuthorColor ?? (plugin.settings.publishStageColors?.Press),
            theme: resolvedStyle.aprTheme || 'dark',
            spokeColor: resolvedStyle.aprSpokeColorMode === 'custom' ? resolvedStyle.aprSpokeColor
                : resolvedStyle.aprSpokeColorMode === 'sync' ? resolvedStyle.aprBackgroundColor
                : undefined,
            publishStageLabel: progressState.displayStage,
            showRtAttribution,
            teaserRevealEnabled: false,
            // Typography settings
            bookTitleFontFamily: resolvedStyle.aprBookTitleFontFamily,
            bookTitleFontWeight: resolvedStyle.aprBookTitleFontWeight,
            bookTitleFontItalic: resolvedStyle.aprBookTitleFontItalic,
            bookTitleFontSize: resolvedStyle.aprBookTitleFontSize,
            authorNameFontFamily: resolvedStyle.aprAuthorNameFontFamily,
            authorNameFontWeight: resolvedStyle.aprAuthorNameFontWeight,
            authorNameFontItalic: resolvedStyle.aprAuthorNameFontItalic,
            authorNameFontSize: resolvedStyle.aprAuthorNameFontSize,
            percentNumberFontSize1Digit: resolvedStyle.aprPercentNumberFontSize1Digit,
            percentNumberFontSize2Digit: resolvedStyle.aprPercentNumberFontSize2Digit,
            percentNumberFontSize3Digit: resolvedStyle.aprPercentNumberFontSize3Digit,
            rtBadgeFontFamily: resolvedStyle.aprRtBadgeFontFamily,
            rtBadgeFontWeight: resolvedStyle.aprRtBadgeFontWeight,
            rtBadgeFontItalic: resolvedStyle.aprRtBadgeFontItalic,
            rtBadgeFontSize: resolvedStyle.aprRtBadgeFontSize,
            portableSvg: true
        });

        container.empty();

        // Create a wrapper to ensure SVG displays at natural size
        const svgWrapper = container.createDiv({ cls: 'ert-apr-svg-wrapper' });
        const svgEl = mountSvgMarkup(svgWrapper, svgString);

        // Ensure the SVG has explicit dimensions for 1:1 display
        if (svgEl) {
            svgEl.setAttribute('width', String(width));
            svgEl.setAttribute('height', String(height));
        }

    } catch (e) {
        container.empty();
        container.createDiv({
            cls: 'ert-apr-preview-error',
            text: t('settings.authorProgress.preview.renderError')
        });
        console.error('Social settings preview error:', e);
    }
}

// ── Custom Background Preset Modal ───────────────────────────────────────────
// Small modal to create, rename, or delete a user-saved background color preset.

interface CustomBgPresetModalOpts {
    index: number;
    existing: { label: string; color: string } | null;
    currentBg: string;
    onSave: (preset: { label: string; color: string }) => Promise<void>;
    onDelete: () => Promise<void>;
}

class CustomBgPresetModal extends Modal {
    private opts: CustomBgPresetModalOpts;
    private plugin: RadialTimelinePlugin;

    constructor(app: App, plugin: RadialTimelinePlugin, opts: CustomBgPresetModalOpts) {
        super(app);
        this.plugin = plugin;
        this.opts = opts;
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');

        modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--sm');
        contentEl.addClass('ert-modal-container', 'ert-stack');

        const isEdit = !!this.opts.existing;
        const initialColor = this.opts.existing?.color ?? this.opts.currentBg;
        const initialLabel = this.opts.existing?.label ?? '';

        // Title
        contentEl.createDiv({
            cls: 'ert-modal-header',
        }).createDiv({
            cls: 'ert-modal-title',
            text: isEdit ? 'Edit custom preset' : 'Save custom preset',
        });

        // Color row
        const colorRow = new Setting(contentEl)
            .setName('Color');
        colorRow.settingEl.addClass('ert-settingRow');

        let pickedColor = initialColor;

        const swatch = colorSwatch(colorRow.controlEl, {
            value: initialColor,
            ariaLabel: 'Preset color',
            onChange: (val) => {
                pickedColor = val;
                hexInput?.setValue(val);
            }
        });

        let hexInput: TextComponent | null = null;
        colorRow.addText(text => {
            hexInput = text;
            text.setPlaceholder('#000000').setValue(initialColor);
            text.inputEl.classList.add('ert-input', 'ert-input--hex');
            text.onChange((val) => {
                if (/^#[0-9a-f]{6}$/i.test(val)) {
                    pickedColor = val;
                    swatch.setValue(val);
                }
            });
        });

        // Name row
        const nameRow = new Setting(contentEl)
            .setName('Name');
        nameRow.settingEl.addClass('ert-settingRow');

        let pickedLabel = initialLabel;
        nameRow.addText(text => {
            text.setPlaceholder('e.g. My Blog').setValue(initialLabel);
            text.onChange((val) => { pickedLabel = val.trim(); });
            // Auto-focus the name input for quick entry
            window.setTimeout(() => text.inputEl.focus(), 50);
        });

        // Action buttons
        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });

        if (isEdit) {
            const deleteBtn = new ButtonComponent(actions)
                .setButtonText('Delete')
                .setDestructive();
            deleteBtn.buttonEl.addClass('ert-btn--fit');
            deleteBtn.onClick(async () => {
                await this.opts.onDelete();
                this.close();
            });
        }

        // Spacer pushes save to the right
        actions.createDiv({ cls: 'ert-modal-actions-spacer' });

        const cancelBtn = new ButtonComponent(actions)
            .setButtonText('Cancel');
        cancelBtn.buttonEl.addClass('ert-btn--fit');
        cancelBtn.onClick(() => this.close());

        const saveBtn = new ButtonComponent(actions)
            .setButtonText('Save')
            .setCta();
        saveBtn.buttonEl.addClass('ert-btn--fit');
        saveBtn.onClick(async () => {
            const label = pickedLabel || `Custom ${this.opts.index + 1}`;
            await this.opts.onSave({ label, color: pickedColor });
            this.close();
        });
    }
}
