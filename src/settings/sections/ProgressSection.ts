import type { App, Component } from 'obsidian';
import { Setting as ObsidianSetting, Notice, setIcon, setTooltip } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { t, getFormattingLocale } from '../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import { getAllScenes } from '../../utils/manuscript';
import type { CompletionEstimate } from '../../services/TimelineMetricsService';
import { STAGE_ORDER } from '../../utils/constants';
import { getActiveBook, getActiveBookTitle, getActiveStageTargetDates } from '../../utils/books';
import { ERT_CLASSES } from '../../ui/classes';
import { IMPACT_FULL, IMPACT_PROGRESS_TICKS } from '../SettingImpact';
import { splitIntoBalancedLinesOptimal } from '../../utils/text';
import { scheduleCommunityProjectSync } from '../../communityShare/communityShareClient';

type Stage = typeof STAGE_ORDER[number];
type Quote = { text: string; author: string };

function renderQuoteBlock(
    container: HTMLElement,
    quote: Quote,
    quoteClass: string,
    authorClass: string
): void {
    const quoteEl = container.createDiv({ cls: quoteClass });
    const availableWidth = Math.max(420, Math.min(760, (container.clientWidth || 0) - 140 || 640));
    const balancedLines = splitIntoBalancedLinesOptimal(`"${quote.text}"`, availableWidth, 1.35);
    balancedLines.forEach(line => {
        quoteEl.createDiv({ cls: 'ert-completion-quote-line', text: line });
    });
    container.createDiv({ cls: authorClass, text: `— ${quote.author}` });
}

/**
 * Creates an inline SVG target tick icon for settings rows.
 * Matches the timeline target tick: line with empty square at end.
 * @param color - Hex color for the tick stroke
 * @param size - Icon size in pixels (default 16)
 */
function createTargetTickIcon(color: string, size = 16): SVGElement {
    const doc = activeDocument;
    const svg = doc.win.createSvg('svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.classList.add('ert-target-tick-icon');

    // Vertical line (pointing up like the timeline tick)
    const line = doc.win.createSvg('line');
    line.setAttribute('x1', '8');
    line.setAttribute('y1', '14');
    line.setAttribute('x2', '8');
    line.setAttribute('y2', '5');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');

    // Empty square at top (the marker)
    const rect = doc.win.createSvg('rect');
    rect.setAttribute('x', '4');
    rect.setAttribute('y', '1');
    rect.setAttribute('width', '8');
    rect.setAttribute('height', '8');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', '2');

    svg.appendChild(line);
    svg.appendChild(rect);

    return svg;
}

/**
 * Creates an inline SVG estimate tick icon for settings rows.
 * Matches the timeline estimated completion tick: line with filled dot at end.
 * @param color - Hex color for the tick stroke
 * @param size - Icon size in pixels (default 16)
 */
function createEstimateTickIcon(color: string, size = 16): SVGElement {
    const doc = activeDocument;
    const svg = doc.win.createSvg('svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.classList.add('ert-estimate-tick-icon');

    // Vertical line (pointing up)
    const line = doc.win.createSvg('line');
    line.setAttribute('x1', '8');
    line.setAttribute('y1', '14');
    line.setAttribute('x2', '8');
    line.setAttribute('y2', '6');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');

    // Filled circle at top (the dot marker)
    const circle = doc.win.createSvg('circle');
    circle.setAttribute('cx', '8');
    circle.setAttribute('cy', '4');
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '1');

    svg.appendChild(line);
    svg.appendChild(circle);

    return svg;
}

/**
 * Get the stage color from plugin settings
 */
function getStageColor(plugin: RadialTimelinePlugin, stage: Stage): string {
    return plugin.settings.publishStageColors[stage];
}

/**
 * Check if a date has passed (is overdue)
 */
function isOverdue(dateStr: string | undefined): boolean {
    if (!dateStr) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateStr + 'T00:00:00');
    return !isNaN(targetDate.getTime()) && targetDate < today;
}

/**
 * Validate stage target dates ordering.
 * Returns error message if validation fails, null if valid.
 */
function validateStageOrder(plugin: RadialTimelinePlugin, stage: Stage, newDate: string): string | null {
    const dates = getActiveStageTargetDates(plugin.settings);
    const stageIndex = STAGE_ORDER.indexOf(stage);
    const newDateObj = new Date(newDate + 'T00:00:00');

    // Check earlier stages - their dates should be before this one
    for (let i = 0; i < stageIndex; i++) {
        const earlierStage = STAGE_ORDER[i];
        const earlierDateStr = dates[earlierStage];
        if (earlierDateStr) {
            const earlierDate = new Date(earlierDateStr + 'T00:00:00');
            if (!isNaN(earlierDate.getTime()) && newDateObj <= earlierDate) {
                return t('ui.progressSection.stageMustBeAfter', { stage, otherStage: earlierStage, date: earlierDateStr });
            }
        }
    }

    // Check later stages - their dates should be after this one
    for (let i = stageIndex + 1; i < STAGE_ORDER.length; i++) {
        const laterStage = STAGE_ORDER[i];
        const laterDateStr = dates[laterStage];
        if (laterDateStr) {
            const laterDate = new Date(laterDateStr + 'T00:00:00');
            if (!isNaN(laterDate.getTime()) && newDateObj >= laterDate) {
                return t('ui.progressSection.stageMustBeBefore', { stage, otherStage: laterStage, date: laterDateStr });
            }
        }
    }

    return null;
}


export function renderCompletionEstimatePreview(params: {
    app: App;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
    frameClass?: string;
    forceExpanded?: boolean;
}): () => void {
    const { app, plugin, containerEl, frameClass } = params;

    // --- Completion Estimate Preview ---
    const previewClasses = ['ert-previewFrame', 'ert-stack'];
    if (frameClass) previewClasses.push(frameClass);
    const previewContainer = containerEl.createDiv({
        cls: previewClasses,
        attr: { 'data-preview': 'completion' }
    });
    let isExpanded = params.forceExpanded ? true : plugin.settings.coreCompletionPreviewExpanded !== false;

    // Quotes for different states
    const startingQuotes: Quote[] = [
        { text: t('ui.progressSection.quoteStart1'), author: "Mark Twain" },
        { text: t('ui.progressSection.quoteStart2'), author: "Louis L'Amour" },
        { text: t('ui.progressSection.quoteStart3'), author: "Octavia E. Butler" },
        { text: t('ui.progressSection.quoteStart4'), author: "Terry Pratchett" },
        { text: t('ui.progressSection.quoteStart5'), author: "Lewis Carroll" },
    ];

    const perseveranceQuotes: Quote[] = [
        { text: t('ui.progressSection.quotePersevere1'), author: "Jodi Picoult" },
        { text: t('ui.progressSection.quotePersevere2'), author: "W. Somerset Maugham" },
        { text: t('ui.progressSection.quotePersevere3'), author: "Ernest Hemingway" },
        { text: t('ui.progressSection.quotePersevere4'), author: "Thomas Mann" },
        { text: t('ui.progressSection.quotePersevere5'), author: "Anne Lamott" },
        { text: t('ui.progressSection.quotePersevere6'), author: "James Thurber" },
        { text: t('ui.progressSection.quotePersevere7'), author: "George Orwell" },
    ];

    function getRandomQuote(quotes: Quote[]): Quote {
        return quotes[Math.floor(Math.random() * quotes.length)];
    }

    const saveExpandedState = (next: boolean) => {
        plugin.settings.coreCompletionPreviewExpanded = next;
        void plugin.saveSettings();
    };

    const renderSummaryRow = (summary: {
        title: string;
        subtitle?: string;
        quote?: Quote;
    }, options?: { hideToggle?: boolean }) => {
        const summaryRow = previewContainer.createDiv({ cls: 'ert-completion-summary-row' });
        const summaryBody = summaryRow.createDiv({ cls: 'ert-completion-summary' });
        if (summary.quote) {
            renderQuoteBlock(
                summaryBody,
                summary.quote,
                'ert-completion-summary-text',
                'ert-completion-summary-author'
            );
        } else {
            summaryBody.createDiv({ cls: 'ert-completion-summary-text', text: summary.title });
            if (summary.subtitle) {
                summaryBody.createDiv({ cls: 'ert-completion-summary-author', text: summary.subtitle });
            }
        }

        if (options?.hideToggle) {
            return;
        }

        const toggleButton = summaryRow.createEl('button', {
            cls: 'ert-iconBtn ert-completion-summary-toggle',
            attr: {
                type: 'button',
                'aria-label': isExpanded ? t('ui.progressSection.collapsePreview') : t('ui.progressSection.expandPreview'),
                'aria-expanded': String(isExpanded)
            }
        });
        setIcon(toggleButton, isExpanded ? 'chevron-down' : 'chevron-right');
        setTooltip(toggleButton, isExpanded ? t('ui.progressSection.collapsePreview') : t('ui.progressSection.expandPreview'));
        toggleButton.addEventListener('click', () => {
            isExpanded = !isExpanded;
            saveExpandedState(isExpanded);
            void renderCompletionPreview(true);
        });
    };

    const getCachedScenes = () => {
        if (!Array.isArray(plugin.lastSceneData)) return null;
        return plugin.lastSceneData.filter(scene => scene.itemType === 'Scene' || !scene.itemType);
    };

    let pendingPreviewFetch = false;
    const schedulePreviewFetch = () => {
        if (pendingPreviewFetch) return;
        pendingPreviewFetch = true;
        const run = () => {
            pendingPreviewFetch = false;
            void renderCompletionPreview(true);
        };
        window.requestIdleCallback(run);
    };

    async function renderCompletionPreview(allowFetch: boolean): Promise<void> {
        previewContainer.empty();
        previewContainer.removeClass('ert-completion-preview-empty', 'ert-completion-preview-collapsed');

        try {
            const cachedScenes = getCachedScenes();
            const scenes = cachedScenes ?? (allowFetch ? await getAllScenes(app, plugin) : null);
            if (!cachedScenes && Array.isArray(scenes)) {
                plugin.lastSceneData = scenes;
            }
            if (!scenes) {
                const loadingMessage = t('ui.progressSection.loadingEstimates');
                renderSummaryRow({
                    title: t('ui.progressSection.completionEstimateTitle'),
                    subtitle: loadingMessage
                });
                if (!isExpanded) {
                    previewContainer.addClass('ert-completion-preview-collapsed');
                    schedulePreviewFetch();
                    return;
                }
                previewContainer.addClass('ert-completion-preview-empty');
                const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                heading.setText(t('ui.progressSection.completionEstimateTitle'));
                const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                body.createDiv({ cls: 'ert-completion-no-data', text: loadingMessage });
                schedulePreviewFetch();
                return;
            }
            if (scenes.length === 0) {
                const quote = getRandomQuote(startingQuotes);
                renderSummaryRow({
                    title: quote.text,
                    subtitle: quote.author,
                    quote
                });
                if (!isExpanded) {
                    previewContainer.addClass('ert-completion-preview-collapsed', 'ert-completion-preview-empty');
                    return;
                }
                previewContainer.addClass('ert-completion-preview-empty');
                const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                heading.setText(t('ui.progressSection.completionEstimateTitle'));
                const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                body.createDiv({ cls: 'ert-completion-empty-hint', text: t('ui.progressSection.createScenesHint') });
                return;
            }

            // Calculate completion estimate using the plugin's service
            const estimate: CompletionEstimate | null = plugin.calculateCompletionEstimate(scenes);

            if (!estimate) {
                previewContainer.removeClass('ert-completion-preview-warn', 'ert-completion-preview-late', 'ert-completion-preview-stalled');

                // Use shared MilestonesService - single source of truth
                // This ensures the hero cards match the timeline indicator exactly
                // Note: This is the MILESTONES system, separate from TimelineMetricsService (estimation/tick tracking)
                const milestone = plugin.milestonesService.detectMilestone(scenes);

                if (!milestone || !milestone.type.includes('complete')) {
                    renderSummaryRow({
                        title: t('ui.progressSection.completionEstimateTitle'),
                        subtitle: t('ui.progressSection.completeScenesHint')
                    });
                    if (!isExpanded) {
                        previewContainer.addClass('ert-completion-preview-collapsed');
                        return;
                    }
                    // Not actually complete - show a simple "no estimate available" message
                    const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                    heading.setText(t('ui.progressSection.completionEstimateTitle'));
                    const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                    body.createDiv({ cls: 'ert-completion-no-data', text: t('ui.progressSection.completeScenesHint') });
                    return;
                }

                // Show hero card based on milestone type (single source of truth)
                if (milestone.type === 'stage-press-complete' || milestone.type === 'book-complete') {
                    isExpanded = true;
                    saveExpandedState(true);
                    // Final gold celebration once Press stage is fully complete.
                    previewContainer.addClass('ert-completion-preview-book-complete');

                    const bgIcon = previewContainer.createDiv({ cls: 'ert-completion-complete-bg-icon' });
                    setIcon(bgIcon, 'shell');

                    const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                    heading.setText(t('ui.progressSection.bookCompleteHeading'));

                    const pressCelebrations = [
                        { title: t('ui.progressSection.pressCelebration1Title'), subtitle: t('ui.progressSection.pressCelebration1Subtitle') },
                        { title: t('ui.progressSection.pressCelebration2Title'), subtitle: t('ui.progressSection.pressCelebration2Subtitle') },
                        { title: t('ui.progressSection.pressCelebration3Title'), subtitle: t('ui.progressSection.pressCelebration3Subtitle') },
                        { title: t('ui.progressSection.pressCelebration4Title'), subtitle: t('ui.progressSection.pressCelebration4Subtitle') },
                        { title: t('ui.progressSection.pressCelebration5Title'), subtitle: t('ui.progressSection.pressCelebration5Subtitle') },
                        { title: t('ui.progressSection.pressCelebration6Title'), subtitle: t('ui.progressSection.pressCelebration6Subtitle') },
                        { title: t('ui.progressSection.pressCelebration7Title'), subtitle: t('ui.progressSection.pressCelebration7Subtitle') },
                        { title: t('ui.progressSection.pressCelebration8Title'), subtitle: t('ui.progressSection.pressCelebration8Subtitle') },
                    ];
                    const celebration = pressCelebrations[Math.floor(Math.random() * pressCelebrations.length)];

                    const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                    const completeContent = body.createDiv({ cls: 'ert-completion-complete' });
                    completeContent.createDiv({ cls: 'ert-completion-complete-title', text: celebration.title });
                    completeContent.createDiv({ cls: 'ert-completion-complete-subtitle', text: celebration.subtitle });
                } else if (milestone.type === 'stage-zero-complete') {
                    renderSummaryRow({
                        title: t('ui.progressSection.zeroCompleteTitle'),
                        subtitle: t('ui.progressSection.zeroCompleteSubtitle')
                    });
                    if (!isExpanded) {
                        previewContainer.addClass('ert-completion-preview-collapsed');
                        return;
                    }
                    // Zero draft complete - first major milestone! Sprout icon
                    previewContainer.addClass('ert-completion-preview-zero-complete');

                    const bgIcon = previewContainer.createDiv({ cls: 'ert-completion-complete-bg-icon' });
                    setIcon(bgIcon, 'sprout');

                    const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                    heading.setText(t('ui.progressSection.zeroCompleteTitle'));

                    const zeroCelebrations = [
                        { title: t('ui.progressSection.zeroCelebration1Title'), subtitle: t('ui.progressSection.zeroCelebration1Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration2Title'), subtitle: t('ui.progressSection.zeroCelebration2Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration3Title'), subtitle: t('ui.progressSection.zeroCelebration3Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration4Title'), subtitle: t('ui.progressSection.zeroCelebration4Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration5Title'), subtitle: t('ui.progressSection.zeroCelebration5Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration6Title'), subtitle: t('ui.progressSection.zeroCelebration6Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration7Title'), subtitle: t('ui.progressSection.zeroCelebration7Subtitle') },
                        { title: t('ui.progressSection.zeroCelebration8Title'), subtitle: t('ui.progressSection.zeroCelebration8Subtitle') },
                    ];
                    const celebration = zeroCelebrations[Math.floor(Math.random() * zeroCelebrations.length)];

                    const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                    const completeContent = body.createDiv({ cls: 'ert-completion-complete' });
                    completeContent.createDiv({ cls: 'ert-completion-complete-title', text: celebration.title });
                    completeContent.createDiv({ cls: 'ert-completion-complete-subtitle', text: celebration.subtitle });
                } else if (milestone.type === 'stage-author-complete') {
                    renderSummaryRow({
                        title: t('ui.progressSection.authorCompleteTitle'),
                        subtitle: t('ui.progressSection.authorCompleteSubtitle')
                    });
                    if (!isExpanded) {
                        previewContainer.addClass('ert-completion-preview-collapsed');
                        return;
                    }
                    // Author stage complete - the sapling grows! Tree-pine icon
                    previewContainer.addClass('ert-completion-preview-author-complete');

                    const bgIcon = previewContainer.createDiv({ cls: 'ert-completion-complete-bg-icon' });
                    setIcon(bgIcon, 'tree-pine');

                    const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                    heading.setText(t('ui.progressSection.authorCompleteTitle'));

                    const authorCelebrations = [
                        { title: t('ui.progressSection.authorCelebration1Title'), subtitle: t('ui.progressSection.authorCelebration1Subtitle') },
                        { title: t('ui.progressSection.authorCelebration2Title'), subtitle: t('ui.progressSection.authorCelebration2Subtitle') },
                        { title: t('ui.progressSection.authorCelebration3Title'), subtitle: t('ui.progressSection.authorCelebration3Subtitle') },
                        { title: t('ui.progressSection.authorCelebration4Title'), subtitle: t('ui.progressSection.authorCelebration4Subtitle') },
                        { title: t('ui.progressSection.authorCelebration5Title'), subtitle: t('ui.progressSection.authorCelebration5Subtitle') },
                        { title: t('ui.progressSection.authorCelebration6Title'), subtitle: t('ui.progressSection.authorCelebration6Subtitle') },
                        { title: t('ui.progressSection.authorCelebration7Title'), subtitle: t('ui.progressSection.authorCelebration7Subtitle') },
                        { title: t('ui.progressSection.authorCelebration8Title'), subtitle: t('ui.progressSection.authorCelebration8Subtitle') },
                    ];
                    const celebration = authorCelebrations[Math.floor(Math.random() * authorCelebrations.length)];

                    const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                    const completeContent = body.createDiv({ cls: 'ert-completion-complete' });
                    completeContent.createDiv({ cls: 'ert-completion-complete-title', text: celebration.title });
                    completeContent.createDiv({ cls: 'ert-completion-complete-subtitle', text: celebration.subtitle });
                } else if (milestone.type === 'stage-house-complete') {
                    renderSummaryRow({
                        title: t('ui.progressSection.houseCompleteTitle'),
                        subtitle: t('ui.progressSection.houseCompleteSubtitle')
                    });
                    if (!isExpanded) {
                        previewContainer.addClass('ert-completion-preview-collapsed');
                        return;
                    }
                    // House stage complete - the forest grows! Trees icon
                    previewContainer.addClass('ert-completion-preview-house-complete');

                    const bgIcon = previewContainer.createDiv({ cls: 'ert-completion-complete-bg-icon' });
                    setIcon(bgIcon, 'trees');

                    const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
                    heading.setText(t('ui.progressSection.houseCompleteTitle'));

                    const houseCelebrations = [
                        { title: t('ui.progressSection.houseCelebration1Title'), subtitle: t('ui.progressSection.houseCelebration1Subtitle') },
                        { title: t('ui.progressSection.houseCelebration2Title'), subtitle: t('ui.progressSection.houseCelebration2Subtitle') },
                        { title: t('ui.progressSection.houseCelebration3Title'), subtitle: t('ui.progressSection.houseCelebration3Subtitle') },
                        { title: t('ui.progressSection.houseCelebration4Title'), subtitle: t('ui.progressSection.houseCelebration4Subtitle') },
                        { title: t('ui.progressSection.houseCelebration5Title'), subtitle: t('ui.progressSection.houseCelebration5Subtitle') },
                        { title: t('ui.progressSection.houseCelebration6Title'), subtitle: t('ui.progressSection.houseCelebration6Subtitle') },
                        { title: t('ui.progressSection.houseCelebration7Title'), subtitle: t('ui.progressSection.houseCelebration7Subtitle') },
                        { title: t('ui.progressSection.houseCelebration8Title'), subtitle: t('ui.progressSection.houseCelebration8Subtitle') },
                    ];
                    const celebration = houseCelebrations[Math.floor(Math.random() * houseCelebrations.length)];

                    const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
                    const completeContent = body.createDiv({ cls: 'ert-completion-complete' });
                    completeContent.createDiv({ cls: 'ert-completion-complete-title', text: celebration.title });
                    completeContent.createDiv({ cls: 'ert-completion-complete-subtitle', text: celebration.subtitle });
                }
                return;
            }

            // Apply stage color and staleness styling
            previewContainer.removeClass(
                'ert-completion-preview-warn', 'ert-completion-preview-late', 'ert-completion-preview-stalled', 'ert-completion-preview-fresh',
                'ert-completion-stage-Zero', 'ert-completion-stage-Author', 'ert-completion-stage-House', 'ert-completion-stage-Press'
            );
            previewContainer.addClass(`ert-completion-stage-${estimate.stage}`);
            if (estimate.staleness !== 'fresh') {
                previewContainer.addClass(`ert-completion-preview-${estimate.staleness}`);
            }

            const summaryQuote = estimate.staleness !== 'fresh' ? getRandomQuote(perseveranceQuotes) : undefined;
            renderSummaryRow(
                summaryQuote
                    ? {
                        title: summaryQuote.text,
                        subtitle: summaryQuote.author,
                        quote: summaryQuote
                    }
                    : {
                        title: t('settings.progress.completionEstimate.heading', { stage: estimate.stage }),
                        subtitle: t('ui.progressSection.scenesCompleteSubtitle', { completed: estimate.total - estimate.remaining, total: estimate.total })
                    }
            );
            if (!isExpanded) {
                previewContainer.addClass('ert-completion-preview-collapsed');
                return;
            }

            const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
            heading.setText(t('settings.progress.completionEstimate.heading', { stage: estimate.stage }));

            const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });

            // Key metrics row
            const metricsRow = body.createDiv({ cls: 'ert-completion-metrics-row' });

            // Completed / Total
            const completedMetric = metricsRow.createDiv({ cls: 'ert-completion-metric' });
            completedMetric.createDiv({ cls: 'ert-completion-metric-value', text: t('settings.progress.completionEstimate.completedFraction', { completed: estimate.total - estimate.remaining, total: estimate.total }) });
            completedMetric.createDiv({ cls: 'ert-completion-metric-label', text: t('settings.progress.completionEstimate.scenesComplete') });

            // Remaining
            const remainingMetric = metricsRow.createDiv({ cls: 'ert-completion-metric' });
            remainingMetric.createDiv({ cls: 'ert-completion-metric-value', text: String(estimate.remaining) });
            remainingMetric.createDiv({ cls: 'ert-completion-metric-label', text: t('settings.progress.completionEstimate.remaining') });

            // Rate
            const rateMetric = metricsRow.createDiv({ cls: 'ert-completion-metric' });
            const rateValue = estimate.rate > 0 ? estimate.rate.toFixed(1) : '—';
            rateMetric.createDiv({ cls: 'ert-completion-metric-value', text: rateValue });
            rateMetric.createDiv({ cls: 'ert-completion-metric-label', text: t('settings.progress.completionEstimate.perWeek') });

            // Staleness indicator
            if (estimate.staleness !== 'fresh') {
                const stalenessRow = body.createDiv({ cls: 'ert-completion-staleness-row' });
                const stalenessText = getStalenessMessage(estimate);
                stalenessRow.createSpan({ cls: 'ert-completion-staleness-icon', text: getStalenessIcon(estimate.staleness) });
                stalenessRow.createSpan({ cls: 'ert-completion-staleness-text', text: stalenessText });
            }

            // Estimated completion date
            const dateRow = body.createDiv({ cls: 'ert-completion-date-row' });
            if (estimate.date && estimate.labelText !== '?') {
                const dateFormatter = new Intl.DateTimeFormat(getFormattingLocale(), {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                dateRow.createDiv({ cls: 'ert-completion-date-label', text: t('settings.progress.completionEstimate.estimatedCompletion') });
                dateRow.createDiv({ cls: 'ert-completion-date-value', text: dateFormatter.format(estimate.date) });

                // Days until completion
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const daysUntil = Math.ceil((estimate.date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                if (daysUntil > 0) {
                    dateRow.createDiv({ cls: 'ert-completion-days-until', text: t('settings.progress.completionEstimate.daysFromNow', { days: daysUntil }) });
                }
            } else {
                dateRow.createDiv({ cls: 'ert-completion-date-label', text: t('settings.progress.completionEstimate.estimatedCompletion') });
                dateRow.createDiv({ cls: 'ert-completion-date-value ert-completion-date-unknown', text: '?' });
                dateRow.createDiv({ cls: 'ert-completion-days-until', text: t('settings.progress.completionEstimate.insufficientData') });
            }

            // Monthly projection breakdown
            if (estimate.date && estimate.rate > 0) {
                const projectionSection = body.createDiv({ cls: 'ert-completion-projection' });
                const projectionHeading = estimate.labelText === '?'
                    ? t('settings.progress.completionEstimate.projectionHeadingLastPace')
                    : t('settings.progress.completionEstimate.projectionHeading');
                projectionSection.createDiv({ cls: 'ert-completion-projection-heading', text: projectionHeading });

                const projectionGrid = projectionSection.createDiv({ cls: 'ert-completion-projection-grid' });
                renderMonthlyProjection(projectionGrid, estimate);
            }

            // Last progress info
            if (estimate.lastProgressDate) {
                const lastProgressRow = body.createDiv({ cls: 'ert-completion-last-progress' });
                const daysSince = Math.floor((Date.now() - estimate.lastProgressDate.getTime()) / (24 * 60 * 60 * 1000));
                const dateFormatter = new Intl.DateTimeFormat(getFormattingLocale(), { month: 'short', day: 'numeric' });
                lastProgressRow.setText(t('settings.progress.completionEstimate.lastProgress', { date: dateFormatter.format(estimate.lastProgressDate), days: daysSince, window: estimate.windowDays }));
            }

        } catch (e) {
            previewContainer.empty();
            const heading = previewContainer.createDiv({ cls: 'ert-planetary-preview-heading' });
            heading.setText(t('ui.progressSection.completionEstimateTitle'));
            const body = previewContainer.createDiv({ cls: 'ert-planetary-preview-body ert-completion-preview-body' });
            body.createDiv({ cls: 'ert-completion-error', text: t('ui.progressSection.estimateError') });
            console.error('Completion estimate preview error:', e);
        }
    }

    function getStalenessIcon(staleness: CompletionEstimate['staleness']): string {
        switch (staleness) {
            case 'warn': return '⚠️';
            case 'late': return '🔴';
            case 'stalled': return '❌';
            default: return '✓';
        }
    }

    function getStalenessMessage(estimate: CompletionEstimate): string {
        if (!estimate.lastProgressDate) return t('ui.progressSection.noRecentProgress');
        const daysSince = Math.floor((Date.now() - estimate.lastProgressDate.getTime()) / (24 * 60 * 60 * 1000));
        switch (estimate.staleness) {
            case 'warn': return t('ui.progressSection.progressSlowing', { days: daysSince });
            case 'late': return t('ui.progressSection.fallingBehind', { days: daysSince });
            case 'stalled': return t('ui.progressSection.stalled', { days: daysSince });
            default: return '';
        }
    }

    function renderMonthlyProjection(container: HTMLElement, estimate: CompletionEstimate): void {
        if (!estimate.date || estimate.rate <= 0) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = estimate.date;
        const scenesPerDay = estimate.rate / 7;

        // Get the active book's stage target dates for markers
        const stageTargetDates = getActiveStageTargetDates(plugin.settings);

        let remaining = estimate.remaining;
        let cumulative = estimate.total - estimate.remaining;
        interface MonthData {
            month: string;
            monthStart: Date;
            monthEnd: Date;
            added: number;
            cumulative: number;
            isLast: boolean;
            stageTargets: { stage: Stage; date: Date; isOverdue: boolean }[];
        }
        const months: MonthData[] = [];

        // Start from current month
        let current = new Date(today.getFullYear(), today.getMonth(), 1);
        const maxMonths = 24; // Limit to 2 years

        for (let i = 0; i < maxMonths && remaining > 0; i++) {
            const monthStart = new Date(current);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

            // Calculate days in this month that fall within our projection
            const projectionStart = i === 0 ? today : monthStart;
            const projectionEnd = monthEnd > targetDate ? targetDate : monthEnd;

            if (projectionStart > projectionEnd) {
                current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
                continue;
            }

            const daysInPeriod = Math.max(0, Math.ceil((projectionEnd.getTime() - projectionStart.getTime()) / (24 * 60 * 60 * 1000)) + 1);
            const scenesThisMonth = Math.min(remaining, Math.round(daysInPeriod * scenesPerDay));

            if (scenesThisMonth > 0 || i === 0) {
                remaining -= scenesThisMonth;
                cumulative += scenesThisMonth;

                // Find stage targets that fall within this month
                const stageTargets: { stage: Stage; date: Date; isOverdue: boolean }[] = [];
                for (const stage of STAGE_ORDER) {
                    const dateStr = stageTargetDates[stage];
                    if (!dateStr) continue;
                    try {
                        const stageDate = new Date(dateStr + 'T00:00:00');
                        if (isNaN(stageDate.getTime())) continue;
                        if (stageDate >= monthStart && stageDate <= monthEnd) {
                            stageTargets.push({ stage, date: stageDate, isOverdue: stageDate < today });
                        }
                    } catch { /* skip unparsable stage dates */ }
                }

                const monthFormatter = new Intl.DateTimeFormat(getFormattingLocale(), { month: 'short' });
                const shortYear = String(monthStart.getFullYear()).slice(-2);
                months.push({
                    month: `${monthFormatter.format(monthStart)} '${shortYear}`,
                    monthStart,
                    monthEnd,
                    added: scenesThisMonth,
                    cumulative: Math.min(cumulative, estimate.total),
                    isLast: remaining <= 0 || monthEnd >= targetDate,
                    stageTargets
                });
            }

            if (monthEnd >= targetDate) break;
            current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        }

        // Render the projection table
        if (months.length === 0) return;

        const headerRow = container.createDiv({ cls: 'ert-completion-projection-header' });
        headerRow.createSpan({ text: t('ui.progressSection.projectionMonth') });
        headerRow.createSpan({ text: t('ui.progressSection.projectionAdded') });
        headerRow.createSpan({ text: t('ui.progressSection.projectionTotal') });
        headerRow.createSpan({ text: t('ui.progressSection.projectionProgress') });

        const dateFormatter = new Intl.DateTimeFormat(getFormattingLocale(), { month: 'short', day: 'numeric' });

        for (let idx = 0; idx < months.length; idx++) {
            const m = months[idx];
            const isFuture = idx > 0; // First month is current, rest are future projections
            const hasTargets = m.stageTargets.length > 0;
            const rowClasses = [
                'ert-completion-projection-row',
                m.isLast ? 'ert-completion-projection-final' : '',
                isFuture && estimate.staleness !== 'fresh' ? `ert-completion-projection-${estimate.staleness}` : '',
                hasTargets ? 'ert-completion-projection-has-target' : ''
            ].filter(Boolean).join(' ');

            const row = container.createDiv({ cls: rowClasses });

            // Month cell with target markers
            const monthCell = row.createSpan({ cls: 'ert-completion-projection-month' });
            monthCell.createSpan({ text: m.month });

            // Add target markers for this month
            if (hasTargets) {
                const markersContainer = monthCell.createSpan({ cls: 'ert-completion-target-markers' });
                for (const target of m.stageTargets) {
                    const stageColor = getStageColor(plugin, target.stage);
                    const displayColor = target.isOverdue ? '#d05e5e' : stageColor;
                    const marker = markersContainer.createSpan({ cls: 'ert-completion-target-marker' });
                    marker.setCssStyles({ backgroundColor: displayColor });

                    // Tooltip with stage and date (Obsidian's styled tooltip)
                    const tooltipText = target.isOverdue
                        ? t('ui.progressSection.stageTargetOverdueTooltip', { stage: target.stage, date: dateFormatter.format(target.date) })
                        : t('ui.progressSection.stageTargetTooltip', { stage: target.stage, date: dateFormatter.format(target.date) });
                    setTooltip(marker, tooltipText, { placement: 'top' });
                }
            }

            row.createSpan({ cls: 'ert-completion-projection-added', text: `+${m.added}` });
            row.createSpan({ cls: 'ert-completion-projection-cumulative', text: String(m.cumulative) });

            const percent = Math.round((m.cumulative / estimate.total) * 100);
            const progressContainer = row.createSpan({ cls: 'ert-completion-projection-progress' });
            const barClasses = [
                'ert-completion-projection-bar',
                isFuture && estimate.staleness !== 'fresh' ? `ert-completion-bar-${estimate.staleness}` : ''
            ].filter(Boolean).join(' ');
            const progressBar = progressContainer.createDiv({ cls: barClasses });
            progressBar.setCssStyles({ width: `${percent}%` });
            progressContainer.createSpan({ cls: 'ert-completion-projection-percent', text: `${percent}%` });
        }
    }

    // Initial render
    void renderCompletionPreview(false);

    return () => {
        void renderCompletionPreview(true);
    };
}

export function renderProgressSection(params: {
    /** Owns this render's listeners; the settings tab re-renders the section when the active book changes. */
    scope: Component;
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}): void {
    const { scope, plugin, containerEl } = params;
    containerEl.classList.add(ERT_CLASSES.STACK);

    const progressHeading = new ObsidianSetting(containerEl)
        .setName(t('settings.progress.heading'))
        .setHeading();
    addHeadingIcon(progressHeading, 'activity');
    addWikiLink(progressHeading, 'Settings-Core#progress-and-status');
    applyErtHeaderLayout(progressHeading);

    const stackEl = containerEl.createDiv({ cls: ERT_CLASSES.STACK });

    // --- Stage Target Dates (per book: read/write the ACTIVE book's profile) ---
    // Create target date settings for each progress stage (Zero, Author, House, Press)
    const stageDescriptions: Record<Stage, string> = {
        Zero: t('ui.progressSection.stageDescZero'),
        Author: t('ui.progressSection.stageDescAuthor'),
        House: t('ui.progressSection.stageDescHouse'),
        Press: t('ui.progressSection.stageDescPress')
    };

    stackEl.createDiv({
        cls: 'setting-item-description',
        text: t('ui.progressSection.targetDatesPerBook', { title: getActiveBookTitle(plugin.settings) })
    });

    for (const stage of STAGE_ORDER) {
        const stageColor = getStageColor(plugin, stage);
        const currentDateStr = getActiveStageTargetDates(plugin.settings)[stage];
        const overdue = isOverdue(currentDateStr);
        const displayColor = overdue ? '#d05e5e' : stageColor;

        const setting = new ObsidianSetting(stackEl)
            .setDesc(stageDescriptions[stage])
            .addText(text => {
                text.inputEl.type = 'date';
                text.inputEl.addClass('ert-input--md');
                text.setValue(currentDateStr || '');

                // Apply overdue styling
                if (overdue) {
                    text.inputEl.addClass('ert-setting-input-overdue');
                }

                text.onChange(() => {
                    text.inputEl.removeClass('ert-setting-input-error');
                    text.inputEl.removeClass('ert-setting-input-overdue');
                });

                scope.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        text.inputEl.blur();
                    }
                });

                const handleBlur = async () => {
                    const value = text.getValue();

                    // Target dates live on the ACTIVE book's profile.
                    const activeBook = getActiveBook(plugin.settings);
                    if (!activeBook) return;
                    if (!activeBook.stageTargetDates) {
                        activeBook.stageTargetDates = {};
                    }

                    if (!value) {
                        activeBook.stageTargetDates[stage] = undefined;
                        text.inputEl.removeClass('ert-setting-input-error');
                        text.inputEl.removeClass('ert-setting-input-overdue');
                        await plugin.saveSettings();
                        plugin.onSettingChanged(IMPACT_PROGRESS_TICKS); // Tier 2: target date tick marks on timeline
                        // Target dates ride to the website with project sync —
                        // throttled so a burst of edits lands as one push.
                        void scheduleCommunityProjectSync(plugin);
                        // Update icon color
                        const icon = setting.nameEl.querySelector('.ert-target-tick-icon');
                        if (icon) {
                            icon.remove();
                            const newIcon = createTargetTickIcon(stageColor);
                            setting.nameEl.insertBefore(newIcon, setting.nameEl.firstChild);
                        }
                        return;
                    }

                    // Validate stage ordering
                    const validationError = validateStageOrder(plugin, stage, value);
                    if (validationError) {
                        new Notice(validationError);
                        text.inputEl.addClass('ert-setting-input-error');
                        text.setValue(activeBook.stageTargetDates[stage] || ''); // SAFE: an unset target date renders as an empty date field, which is also how the author clears it
                        return;
                    }

                    activeBook.stageTargetDates[stage] = value;
                    text.inputEl.removeClass('ert-setting-input-error');

                    // Check if now overdue and update styling
                    const nowOverdue = isOverdue(value);
                    if (nowOverdue) {
                        text.inputEl.addClass('ert-setting-input-overdue');
                    } else {
                        text.inputEl.removeClass('ert-setting-input-overdue');
                    }

                    // Update icon color
                    const icon = setting.nameEl.querySelector('.ert-target-tick-icon');
                    if (icon) {
                        icon.remove();
                        const newColor = nowOverdue ? '#d05e5e' : stageColor;
                        const newIcon = createTargetTickIcon(newColor);
                        setting.nameEl.insertBefore(newIcon, setting.nameEl.firstChild);
                    }

                    await plugin.saveSettings();
                    plugin.onSettingChanged(IMPACT_PROGRESS_TICKS); // Tier 2: target date tick marks on timeline
                    void scheduleCommunityProjectSync(plugin);
                };

                scope.registerDomEvent(text.inputEl, 'blur', () => { void handleBlur(); });
            });

        // Create custom name with icon
        setting.nameEl.empty();
        const icon = createTargetTickIcon(displayColor);
        setting.nameEl.appendChild(icon);
        setting.nameEl.appendText(` ${t('ui.progressSection.stageTargetDateName', { stage })}`);

        // Add stage color indicator class
        setting.settingEl.addClass(`ert-stage-target-${stage.toLowerCase()}`);
        if (overdue) {
            setting.settingEl.addClass('ert-stage-target-overdue');
        }
    }

    // --- Show completion estimate ---
    // Estimated completion uses a dot instead of square, different from target ticks
    const estimateToggle = new ObsidianSetting(stackEl)
        .setDesc(t('settings.configuration.showEstimate.desc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showCompletionEstimate ?? true)
            .onChange(async (value) => {
                plugin.settings.showCompletionEstimate = value;
                await plugin.saveSettings();
                plugin.onSettingChanged(IMPACT_FULL); // Tier 3: estimate dot on timeline
            }));

    // Add estimate icon (line with dot at end, like the estimated completion tick)
    estimateToggle.nameEl.empty();
    const estimateIcon = createEstimateTickIcon(getStageColor(plugin, 'Press'));
    estimateToggle.nameEl.appendChild(estimateIcon);
    estimateToggle.nameEl.appendText(` ${t('settings.configuration.showEstimate.name')}`);

    // --- Zero draft mode toggle ---
    const zeroStageColor = getStageColor(plugin, 'Zero');
    const zeroDraftSetting = new ObsidianSetting(stackEl)
        .setName(t('ui.progressSection.zeroDraftModeName'))
        .setDesc(t('ui.progressSection.zeroDraftModeDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.enableZeroDraftMode ?? false)
            .onChange(async (value) => {
                plugin.settings.enableZeroDraftMode = value;
                await plugin.saveSettings();
                zeroDraftSetting.settingEl.setCssStyles({
                    backgroundColor: value ? `${zeroStageColor}20` : 'transparent'
                });
                // Zero-draft mode syncs to the active book's website shell.
                void scheduleCommunityProjectSync(plugin);
            }));

    // Apply initial styles including background tint if enabled
    const isEnabled = plugin.settings.enableZeroDraftMode ?? false;
    zeroDraftSetting.settingEl.setCssStyles({
        border: `2px dashed ${zeroStageColor}`,
        borderRadius: '8px',
        padding: '12px',
        marginTop: '8px',
        backgroundColor: isEnabled ? `${zeroStageColor}20` : 'transparent'
    });

}
