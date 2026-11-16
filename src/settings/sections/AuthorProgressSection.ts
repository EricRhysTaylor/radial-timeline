import { setAccessibleLabel, setTooltip, withAccessibleLabel } from '../../utils/domTooltip';
import { formatDateRange, parseDateRange } from './authorProgress/dateRange';
import { App, Setting, setIcon, DropdownComponent, TextComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { AuthorProgressService } from '../../services/AuthorProgressService';
import { getAllScenes } from '../../utils/manuscript';
import { renderCampaignManagerSection } from './CampaignManagerSection';
import { ERT_CLASSES } from '../../ui/classes';
import { STAGE_ORDER } from '../../utils/constants';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { t } from '../../i18n';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { docsUrl } from '../../utils/docsUrl';
export interface AuthorProgressSectionProps {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

/**
 * Social / authorProgress settings: the hero, the reports (Default and
 * campaigns), and how progress is measured for all of them.
 */
export function renderAuthorProgressSection({ app, plugin, containerEl }: AuthorProgressSectionProps): void {
    // Social is ERT-only; avoid legacy classes.
    const section = containerEl.createDiv({
        cls: `ert-apr-section ${ERT_CLASSES.ROOT} ${ERT_CLASSES.SKIN_SOCIAL} ${ERT_CLASSES.STACK}`
    });

    const aprService = new AuthorProgressService(plugin, app);
    const needsRefresh = aprService.needsAnyRefresh();

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
    const wikiLink = withAccessibleLabel(badge.createEl('a', {
        href: docsUrl('Author-Progress-Report'),
        cls: ERT_CLASSES.BADGE_PILL_WIKI,
        attr: { 'target': '_blank', 'rel': 'noopener' }
    }), t('settings.authorProgress.hero.wikiAriaLabel'));
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
    // REPORTS
    // The Default report and the author's campaigns, one open at a time. The
    // open report carries its own preview, share file, style and settings.
    // ─────────────────────────────────────────────────────────────────────────
    // Progress settings below change every report's percent, so they redraw the list.
    const refreshPreview = renderCampaignManagerSection({ app, plugin, containerEl: section });

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
    const stageBadge = stageBadgeRow.createSpan({ cls: ERT_CLASSES.CHIP, text: t('ui.authorProgressSection.trackingStageBadge') });
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
    setAccessibleLabel(targetCountInput.inputEl, t('ui.authorProgressSection.sceneGoalTooltip'));
    const targetCountResetBtn = withAccessibleLabel(targetCountGroup.createEl('button', {
        cls: ERT_CLASSES.ICON_BTN,
        attr: { type: 'button' }
    }), t('ui.authorProgressSection.matchTargetLabel'));
    setIcon(targetCountResetBtn, 'refresh-cw');
    setTooltip(targetCountResetBtn, t('ui.authorProgressSection.matchTargetLabel'));

    // Date range input sits inline with the mode dropdown (shown only in Date Goal mode).
    const dateRangeInput = new TextComponent(modeControlRow);
    dateRangeInput.setPlaceholder(t('settings.authorProgress.progressMode.dateRangePlaceholder'));
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
        stageBadge.style.setProperty('border', `1px solid ${color}`); // SAFE: the stage colour comes from settings at runtime
        stageBadge.style.setProperty('color', color); // SAFE: the stage colour comes from settings at runtime
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
            ? t('ui.authorProgressSection.trackingStageNamed', { stage: trackedStage.toUpperCase() })
            : mode === 'date'
                ? t('ui.authorProgressSection.dateRangeBadge')
                : t('ui.authorProgressSection.fullManuscriptBadge');
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
            return t('ui.authorProgressSection.noteDateMode');
        }
        if (mode === 'full') {
            return t('ui.authorProgressSection.noteFullMode');
        }
        return t('ui.authorProgressSection.noteStageMode');
    };

    const renderFlowBar = (
        breakdown: Record<(typeof STAGE_ORDER)[number], number>,
        percent: number
    ): void => {
        STAGE_ORDER.forEach(stage => {
            const seg = flowSegments[stage];
            const count = breakdown[stage] ?? 0;
            seg.style.setProperty('flex-grow', String(count)); // SAFE: segment width is the live scene count
            seg.toggleClass('is-empty', count === 0);
            setTooltip(seg, `${stage}: ${count}`);
        });
        const clamped = Math.max(0, Math.min(100, percent));
        flowTickLine.style.setProperty('left', `${clamped}%`); // SAFE: tick position is the live percent
        flowTickLabel.style.setProperty('left', `${clamped}%`); // SAFE: tick position is the live percent
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
            const progressState = aprService.resolveProgressState(scenes);
            lastKnownSceneCount = progressState.sceneCount;
            const storedTarget = plugin.settings.authorProgress?.defaults.aprTargetSceneCount;
            const note = composeStageNote(progressState.mode);
            updateStageUI(progressState.mode, progressState.displayStage, progressState.trackedStage, note);
            stageSubNote.setText(progressState.mode === 'stage' ? t('ui.authorProgressSection.currentlyTracking', { stage: progressState.trackedStage }) : '');
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
            stageSubNote.setText(mode === 'stage' ? t('ui.authorProgressSection.currentlyTracking', { stage: trackedStage }) : '');
            stageSubNote.toggleClass('ert-hidden', mode !== 'stage');
            seedTargetCount(0, storedTarget);
            renderFlowBar({ Zero: 0, Author: 0, House: 0, Press: 0 }, 0);
            seedDateRange();
        }
    };

    modeDropdown.addOption('stage', t('ui.authorProgressSection.modeStage'));
    modeDropdown.addOption('full', t('ui.authorProgressSection.modeFull'));
    modeDropdown.addOption('date', t('ui.authorProgressSection.modeDate'));
    void refreshTrackingState();
}
