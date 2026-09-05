/**
 * Radial Timeline Plugin for Obsidian — Renderer
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { readSubplotColor } from './utils/subplotColors';
import { STAGE_ORDER, STAGES_FOR_GRID, STATUSES_FOR_GRID, SceneNumberInfo } from '../utils/constants';
import {
    GRID_CELL_BASE,
    GRID_CELL_WIDTH_EXTRA,
    GRID_CELL_GAP_X,
    GRID_CELL_GAP_Y,
    GRID_HEADER_OFFSET_Y,
} from './layout/LayoutConstants';
import { renderRings, type RingRenderContext } from './renderers/RingRenderer';
import { computeGridData } from './utils/GridData';
import { renderNumberSquares, type NumberSquareRenderContext } from './renderers/NumberSquareRenderer';
import type { PandocLayoutTemplate, RadialTimelineSettings, TimelineItem } from '../types';
import { dateToAngle } from '../utils/date';
import {
    extractGradeFromScene,
    isBeatNote,
    isSceneItem,
    usesWhenOrdering,
    type PluginRendererFacade
} from '../utils/sceneHelpers';
import { makeSceneId } from '../utils/numberSquareHelpers';
import type { PositionInfo } from './utils/SceneLayout';
import { buildChronologueOuterLabels, renderChronologueOverlays, renderOuterLabelTexts, renderChronologueOuterTicks } from './utils/Chronologue';
import { computeCacheableValues } from './utils/Precompute';
import {
    SVG_SIZE,
    INNER_RADIUS,
    SUBPLOT_OUTER_RADIUS_MAINPLOT,
    SUBPLOT_OUTER_RADIUS_STANDARD,
    SUBPLOT_OUTER_RADIUS_CHRONOLOGUE,
    MONTH_LABEL_RADIUS,
    CHRONOLOGUE_DATE_RADIUS,
    MONTH_TICK_END,
    MONTH_TICK_START,
    ACT_LABEL_RADIUS,
    CHRONOLOGUE_DURATION_ARC_RADIUS,
    MICRO_RING_GAP,
    MICRO_RING_WIDTH,
    PROGRESS_RING_RADIUS_OFFSET,
    MAX_TEXT_WIDTH
} from './layout/LayoutConstants';
import { startPerfSegment } from './utils/Performance';
import { renderCenterGrid } from './components/Grid';
import { renderNarrativeChapterMarkers, type NarrativePartMarker, type OuterRingChapterBoundaryGeometry } from './components/ChapterMarkers';
import { renderMonthLabelDefs } from './components/Months';
import { renderSubplotLabels } from './components/SubplotLabels';
import { renderSubplotDominanceIndicators } from './components/SubplotDominanceIndicators';
import { renderDefs } from './components/Defs';
import { renderEstimatedDateElements } from './components/Progress';
import { renderActBorders } from './components/Acts';
import { renderActLabels } from './components/ActLabels';
import { renderTargetDateTick, type TargetTickEnhancedData } from './components/ProgressTicks';
import { renderProgressRing, resolveProgressEstimate, resolveProgressRingDate } from './components/ProgressRing';
import { serializeSynopsesToString } from './components/Synopses';
import { renderCalendarSpokesLayer } from './utils/MonthSpokes';
import { shouldShowSubplotRings, shouldShowAllScenesInOuterRing, usesSequenceAlignment } from './modules/ModeRenderingHelpers';
import { collectChronologueSceneEntries, type ChronologueSceneEntry } from './components/ChronologueTimeline';
import { appendSynopsisElementForScene } from './utils/SynopsisBuilder';
import { renderGossamerOverlay, type StageColorMap } from './utils/Gossamer';
import { renderRotationToggle } from './utils/RotationToggle';
import { renderVersionIndicator } from './components/VersionIndicator';
import { renderHelpIcon } from './components/HelpIcon';
import { renderAuthorProgressIndicator } from './components/AuthorProgressIndicator';
import { renderMilestoneIndicator, type MilestoneInfo } from './components/MilestoneIndicator';
import type { CompletionEstimate } from './utils/Estimation';
import { renderProgressRingBaseLayer } from './utils/ProgressRing';
import { getReadabilityMultiplier, getReadabilityScale } from '../utils/readability';
import { getVersionCheckService } from '../services/VersionCheckService';
import { hasActiveAlerts } from '../settings/refactorAlerts';
import { buildTimelineSegments } from './utils/TimelineSegments';
import { getActiveBook, getTimelineScope } from '../utils/books';
import {
    buildTimelineChapterResolverItems,
    collapseTimelineChapterMarkersByResolvedBoundary,
    resolveTimelineChapterMarkers
} from '../utils/timelineChapters';
import { resolveActiveNovelPandocLayout } from '../utils/exportFormats';
import { resolveTimelinePartMarkers, type TimelinePartMarker } from '../utils/timelineParts';


// STATUS_COLORS and SceneNumberInfo now imported from constants

// Stage header tooltips (used for grid row headers Z/A/H/P)
const STAGE_HEADER_TOOLTIPS: Record<string, string> = {
    Zero: 'Zero stage — The raw first draft. Unpolished ideas on the page, no revisions yet.',
    Author: 'Author stage — The author revises and refines the draft after letting it rest.',
    House: 'House stage — Alpha and beta readers give feedback. Publisher or editor reviews the manuscript. Copy-edited and proofed.',
    Press: 'Press stage — Final version is ready for release.'
};

// Status header tooltips (used for grid column headers Tdo/Wrk/Due/Cmt)
const STATUS_HEADER_TOOLTIPS: Record<string, string> = {
    Todo: 'Todo — tasks or scenes not yet started',
    Working: 'Working — tasks or scenes currently in progress',
    Due: 'Due — tasks or scenes with a past-due date',
    Completed: 'Completed — tasks or scenes finished'
};

function layoutSupportsPartMarkers(layout: PandocLayoutTemplate | null): boolean {
    if (!layout) return false;
    if (layout.designedSpec?.parts?.mode && layout.designedSpec.parts.mode !== 'off') return true;
    return layout.usesModernClassicStructure === true;
}

function toRomanNumeral(value: number): string {
    const numerals: Array<[number, string]> = [
        [1000, 'M'],
        [900, 'CM'],
        [500, 'D'],
        [400, 'CD'],
        [100, 'C'],
        [90, 'XC'],
        [50, 'L'],
        [40, 'XL'],
        [10, 'X'],
        [9, 'IX'],
        [5, 'V'],
        [4, 'IV'],
        [1, 'I'],
    ];
    let remaining = Math.floor(value);
    if (!Number.isFinite(remaining) || remaining <= 0) return String(value);
    let output = '';
    for (const [amount, glyph] of numerals) {
        while (remaining >= amount) {
            output += glyph;
            remaining -= amount;
        }
    }
    return output;
}

function buildNarrativePartMarkers(params: {
    settings: RadialTimelineSettings;
    layout: PandocLayoutTemplate | null;
    partMarkers: TimelinePartMarker[];
    boundaryGeometryByScenePath: Map<string, OuterRingChapterBoundaryGeometry>;
}): NarrativePartMarker[] {
    const { settings, layout, partMarkers, boundaryGeometryByScenePath } = params;
    if (getTimelineScope(settings) !== 'book') return [];
    if (partMarkers.length === 0) return [];

    const activeBook = getActiveBook(settings);
    const layoutOptions = layout ? activeBook?.layoutOptions?.[layout.id] : undefined;
    const epigraphs = Array.isArray(layoutOptions?.partEpigraphs) ? layoutOptions.partEpigraphs : [];
    const attributions = Array.isArray(layoutOptions?.partEpigraphAttributions)
        ? layoutOptions.partEpigraphAttributions
        : [];
    const prints = layoutSupportsPartMarkers(layout);
    const layoutName = layout?.name || 'No layout selected';
    const advertisesEpigraph = layout?.designedSpec?.parts?.epigraph === true
        || layout?.hasEpigraphs === true
        || layout?.usesModernClassicStructure === true;

    return partMarkers.flatMap((marker, index) => {
        const geometry = boundaryGeometryByScenePath.get(marker.resolvedScenePath);
        if (!geometry) return [];

        // Numbering is sequential by marker order, matching the export.
        const label = `Part ${toRomanNumeral(index + 1)}`;
        const title = marker.titled && marker.title ? ` · ${marker.title}` : '';
        const quote = typeof epigraphs[index] === 'string' ? epigraphs[index].trim() : '';
        const attribution = typeof attributions[index] === 'string' ? attributions[index].trim() : '';

        // Structure first, print status second. The marker is the author's;
        // whether it prints depends on a layout they can change at any time.
        const tooltipLines = [`${label}${title}`];
        if (quote) tooltipLines.push(`Epigraph: ${quote}`);
        if (attribution) tooltipLines.push(`Attribution: ${attribution}`);

        if (!layout) {
            // No status line: nothing is selected, so nothing can be claimed.
        } else if (!prints) {
            tooltipLines.push(`${layoutName} does not print Parts.`);
        } else if (advertisesEpigraph && !quote && !attribution) {
            tooltipLines.push(`${layoutName} prints this Part without epigraph text.`);
        } else {
            tooltipLines.push(`${layoutName} prints this Part.`);
        }

        return [{ startAngle: geometry.startAngle, tooltip: tooltipLines.join('\n') }];
    });
}

/**
 * Calculate enhanced data for target tick tooltips.
 * Computes per-stage remaining scene counts for Required Pace Calculator and Stage Milestone Alerts.
 */
function calculateTargetTickEnhancedData(
    scenes: TimelineItem[],
    estimate: CompletionEstimate | null
): TargetTickEnhancedData | undefined {
    if (scenes.length === 0) return undefined;
    
    // Filter to real scenes only; beats, backdrops, and matter notes do not count for progress.
    const realScenes = scenes.filter(isSceneItem);
    if (realScenes.length === 0) return undefined;
    
    // Calculate remaining scenes per stage
    const stageRemaining: Record<typeof STAGE_ORDER[number], number> = {
        Zero: 0,
        Author: 0,
        House: 0,
        Press: 0
    };
    
    const normalizeStage = (raw: unknown): typeof STAGE_ORDER[number] => {
        const v = (typeof raw === 'string' ? raw : 'Zero').trim().toLowerCase();
        const match = STAGE_ORDER.find(stage => stage.toLowerCase() === v);
        return match ?? 'Zero';
    };
    
    const isCompleted = (status: unknown): boolean => {
        const val = Array.isArray(status) ? status[0] : status;
        const normalized = (val ?? '').toString().trim().toLowerCase();
        return normalized === 'complete' || normalized === 'completed' || normalized === 'done';
    };
    
    // Count remaining (incomplete) scenes per stage
    const seenPaths = new Set<string>();
    for (const scene of realScenes) {
        if (scene.path && seenPaths.has(scene.path)) continue;
        if (scene.path) seenPaths.add(scene.path);
        
        if (!isCompleted(scene.status)) {
            const stage = normalizeStage(scene['Publish Stage']);
            stageRemaining[stage]++;
        }
    }
    
    return {
        stageRemaining,
        currentPace: estimate?.rate ?? 0,
        estimatedStage: estimate?.stage as typeof STAGE_ORDER[number] | null ?? null,
        estimatedDate: estimate?.date ?? null
    };
}

export function createTimelineSVG(
    plugin: PluginRendererFacade,
    scenes: TimelineItem[],
    options?: { aprNeedsRefresh?: boolean; milestone?: MilestoneInfo | null; runtimeModeActive?: boolean }
): { svgString: string; maxStageColor: string } {
    const stopTotalPerf = startPerfSegment(plugin, 'timeline.total');
    const size = SVG_SIZE;
    const innerRadius = INNER_RADIUS;
    const monthLabelRadius = MONTH_LABEL_RADIUS;
    const chronologueDateRadius = CHRONOLOGUE_DATE_RADIUS;
    const monthTickStart = MONTH_TICK_START;
    const monthTickEnd = MONTH_TICK_END;
    const settings = plugin.settings as RadialTimelineSettings;
    const readabilityScale = getReadabilityScale(settings);
    const fontScale = getReadabilityMultiplier(settings);
    const maxTextWidth = MAX_TEXT_WIDTH * fontScale;
    const readabilityClass = `rt-font-scale-${readabilityScale}`;

    // Synopses are hidden by CSS until hover - no need to log anything

    const stopPrepPerf = startPerfSegment(plugin, 'timeline.scene-prep');
    const precomputed = computeCacheableValues(plugin, scenes);
    stopPrepPerf();

    // Extract precomputed values
    const {
        scenesByActAndSubplot,
        masterSubplotOrder,
        colorIndexBySubplot,
        ringWidths,
        ringStartRadii,
        lineInnerRadius,
        maxStageColor,
        subplotDominanceStates,
        microRingLayout,
        backdropLayout
    } = precomputed;

    const NUM_RINGS = masterSubplotOrder.length;
    const currentMode = settings.currentMode || 'narrative';
    const shouldApplyNumberSquareColors = currentMode !== 'gossamer';
    const isNarrativeMode = currentMode === 'narrative';

    const resolveSubplotColorIndex = (subplotName: string): number => {
        const key = subplotName && subplotName.trim().length > 0 ? subplotName : 'Main Plot';
        if (colorIndexBySubplot.has(key)) return colorIndexBySubplot.get(key)!;
        const fallback = colorIndexBySubplot.get('Main Plot');
        return fallback !== undefined ? fallback : 0;
    };

    const numberSquareVisualResolver = shouldApplyNumberSquareColors
        ? (scene: TimelineItem) => ({
            subplotIndex: resolveSubplotColorIndex(scene.subplot || 'Main Plot')
        })
        : null;

    const subplotColorFor = (subplotName: string) => readSubplotColor(activeDocument, resolveSubplotColorIndex(subplotName));

    // Determine sorting method (needed for later logic; pulled out for readability)
    const timelineSegments = buildTimelineSegments(settings);
    const numActs = Math.max(1, timelineSegments.length);
    const actLabels = timelineSegments.map(segment => segment.label);
    const segmentKind = timelineSegments[0]?.kind ?? 'act';
    const isChronologueMode = currentMode === 'chronologue';
    const isProgressMode = currentMode === 'progress';
    const isSagaScope = getTimelineScope(settings) === 'saga';
    const sortByWhen = usesWhenOrdering(settings);
    const forceChronological = isChronologueMode;
    const showChapterMarkers = isNarrativeMode && !sortByWhen && (settings.showChapterMarkers ?? false);
    const chronologueSceneEntries: ChronologueSceneEntry[] | undefined = isChronologueMode
        ? collectChronologueSceneEntries(scenes)
        : undefined;

    // Create SVG root and expose the dominant publish-stage colour for CSS via a hidden <g> element
    let svg = `<svg width="${size}" height="${size}" viewBox="-${size / 2} -${size / 2} ${size} ${size}" 
                       xmlns="http://www.w3.org/2000/svg" class="radial-timeline-svg ${readabilityClass}" data-font-scale="${readabilityScale}" data-num-acts="${numActs}" data-segment-count="${numActs}" data-segment-kind="${segmentKind}" data-subplot-alignment="${usesSequenceAlignment(plugin) ? 'sequence' : 'fill'}" data-line-inner-radius="${lineInnerRadius}"
                       preserveAspectRatio="xMidYMid meet">`;


    // Hidden config group consumed by the stylesheet (e.g. to tint buttons, etc.)
    svg += `<g id="timeline-config-data" data-max-stage-color="${maxStageColor}"></g>`;

    // Create defs for patterns and gradients


    // Create a map to store scene number information for the scene square and synopsis
    const sceneNumbersMap = new Map<string, SceneNumberInfo>();

    // Use appropriate subplot outer radius based on mode and readability scale
    const subplotOuterRadius = isChronologueMode
        ? SUBPLOT_OUTER_RADIUS_CHRONOLOGUE
        : isProgressMode
            ? SUBPLOT_OUTER_RADIUS_MAINPLOT
            : SUBPLOT_OUTER_RADIUS_STANDARD[readabilityScale];

    const standardMonths = Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
        const name = new Date(2000, i).toLocaleString('en-US', { month: 'long' });
        const shortName = new Date(2000, i).toLocaleString('en-US', { month: 'short' }).slice(0, 3);
        return { name, shortName, angle };
    });
    const months = standardMonths;

    let outerLabels: { name: string; shortName: string; angle: number; isMajor?: boolean; isFirst?: boolean; isLast?: boolean; sceneIndex?: number }[];
    if (isChronologueMode) {
        outerLabels = buildChronologueOuterLabels(plugin, scenes);
    } else {
        outerLabels = standardMonths;
    }

    // After radii are known, compute global stacking map (outer-ring narrative only)
    if (shouldShowAllScenesInOuterRing(plugin)) {
        // No global stacking computation
    }

    // Access the publishStageColors from settings
    const PUBLISH_STAGE_COLORS = plugin.settings.publishStageColors as StageColorMap;

    // Begin defs act
    svg += `<defs>`;

    // Define patterns for Working and Todo states with Progress Stage colors
    svg += renderDefs(
        PUBLISH_STAGE_COLORS,
        1.0,
        false,
        plugin.settings.workingPatternId,
        plugin.settings.customWorkingPatterns
    );


    // Define outer arc paths for months (use outerLabels which may be chronological ticks)
    // In APR Mode, skip detailed month label defs if not needed? Actually they are just paths.
    svg += renderMonthLabelDefs({ months: outerLabels, monthLabelRadius, chronologueDateRadius });


    // Close defs act
    svg += `</defs>`;

    // Open static container (non-rotating root)
    svg += `<g id="timeline-root">`;





    const progressDate = resolveProgressRingDate(plugin, scenes);

    // Get current month index (0-11)
    const currentMonthIndex = progressDate.getMonth();

    // Store boundary labels (first/last) to render on top later in chronologue mode
    let boundaryLabelsHtml = '';

    const outerLabelRender = renderOuterLabelTexts({
        outerLabels,
        isChronologueMode,
        currentMonthIndex
    });
    boundaryLabelsHtml = outerLabelRender.boundaryLabelsHtml;

    // --- Draw Act labels early (below story beat labels) into rotatable group later ---

    // First add the progress ring (RAINBOW YEAR PROGRESS)
    // Calculate year progress
    const now = progressDate;
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const yearProgress = (now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24 * 365);
    // TEMP TEST: Force full year display to see all colors
    // const yearProgress = 1; // TEMP TEST: Force 100% to display all segments

    // Create progress ring
    const hasMicroRings = isChronologueMode && (microRingLayout?.laneCount ?? 0) > 0;
    const progressRadius = lineInnerRadius + PROGRESS_RING_RADIUS_OFFSET;
    let microRingBaseRadius: number | undefined;
    if (hasMicroRings && microRingLayout) {
        const microBackdropSubplotIndex = masterSubplotOrder.indexOf('MicroBackdrop');
        if (microBackdropSubplotIndex !== -1) {
            const numRings = ringStartRadii.length;
            const ringIndex = numRings - 1 - microBackdropSubplotIndex;
            if (ringIndex >= 0 && ringIndex < numRings) {
                const ringInnerRadius = ringStartRadii[ringIndex];
                const ringOuterRadius = ringInnerRadius + ringWidths[ringIndex];
                const laneCount = microRingLayout.laneCount;
                const laneGap = MICRO_RING_WIDTH + MICRO_RING_GAP;
                const outermostRadius = ringOuterRadius - (MICRO_RING_WIDTH / 2);
                microRingBaseRadius = outermostRadius - ((laneCount - 1) * laneGap);
                if (!Number.isFinite(microRingBaseRadius) || microRingBaseRadius <= 0) {
                    microRingBaseRadius = undefined;
                }
            }
        }
    }
    const estimateResult: CompletionEstimate | null = resolveProgressEstimate(
        plugin,
        scenes,
        plugin.calculateCompletionEstimate(scenes)
    );
    const currentYearStartAngle = -Math.PI / 2; // Start at 12 o'clock

    // Define rainbow gradients for the segments
    // In APR mode, keep the ring? Yes, "Full rings and scenes preserved".
    svg += renderProgressRingBaseLayer({
        progressRadius,
        estimateResult
    });


    // Month spokes and inner labels
    svg += renderCalendarSpokesLayer({
        months,
        lineInnerRadius,
        monthTickEnd,
        currentMonthIndex,
        subplotOuterRadius,
        isChronologueMode,
        numActs,
        scenes,
    });

    // Add outer chronological tick marks in Chronologue mode
    if (isChronologueMode) {
        const ticksSvg = renderChronologueOuterTicks({
            outerLabels,
            monthTickStart,
            monthTickEnd,
            microRingSegments: microRingLayout?.segments,
            microRingTicks: microRingLayout?.ticks
        });
        if (ticksSvg) {
            svg += ticksSvg;
        }
    }
    svg += outerLabelRender.labelsSvg;


    // Draw the year progress ring segments
    svg += renderProgressRing({ progressRadius, yearProgress, currentYearStartAngle, segmentCount: 6 });

    // Calculate enhanced data for target ticks (Required Pace Calculator, Stage Milestone Alerts, Auto Mode)
    const targetTickEnhancedData = calculateTargetTickEnhancedData(scenes, estimateResult);

    // Target completion tick/marker
    svg += renderTargetDateTick({ plugin, progressRadius, dateToAngle, enhancedData: targetTickEnhancedData });


    // Synopses at end to be above all other elements
    const synopsesElements: SVGGElement[] = [];

    // Create a Map to store grade information by sceneId (NEW)
    const sceneGrades = new Map<string, string>();

    scenes.forEach((scene) => {
        // Handle undefined subplot with a default "Main Plot"
        const subplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
        const subplotIndex = masterSubplotOrder.indexOf(subplot);
        const ring = NUM_RINGS - 1 - subplotIndex;

        // Get the scenes for this act and subplot to determine correct index
        // When using When date sorting, all scenes are in act 0
        // When using manuscript order, use the scene's actual act
        const sortByWhen = usesWhenOrdering(settings);

        const sceneActNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
        const rawActIndex = sortByWhen
            ? 0
            : (isSagaScope ? (typeof scene.bookIndex === 'number' ? scene.bookIndex : 0) : (sceneActNumber - 1));
        // Clamp to the nearest valid quadrant so this lookup agrees with how
        // Precompute.ts bucketed the scene — an unclamped index here would
        // miss the scene (empty lookup, sceneIndex -1) and re-derive a
        // wrapped-around angle instead of reusing the clamped bucket.
        const actIndex = Math.min(Math.max(rawActIndex, 0), numActs - 1);
        const scenesInActAndSubplot = (scenesByActAndSubplot[actIndex] && scenesByActAndSubplot[actIndex][subplot]) || [];

        // Never generate inner-ring synopses for Plot notes here
        if (isBeatNote(scene)) {
            return;
        }

        const filteredScenesForIndex = scenesInActAndSubplot.filter(s => !isBeatNote(s));
        const sceneIndex = filteredScenesForIndex.indexOf(scene);

        const sceneUniqueKey = scene.path || `${scene.title || ''}::${scene.number ?? ''}::${String(scene.when ?? '')}`;
        const sceneId = makeSceneId(actIndex, ring, sceneIndex, false, false, sceneUniqueKey);

        // Extract grade from 2beats using helper function
        extractGradeFromScene(scene, sceneId, sceneGrades, plugin);

        appendSynopsisElementForScene({
            plugin,
            scene,
            sceneId,
            maxTextWidth,
            masterSubplotOrder,
            scenes,
            targets: synopsesElements
        });
    });

    // Open rotatable container – scenes and act labels/borders only
    svg += `<g id="timeline-rotatable">`;

    // Only show Act labels when using manuscript order (not When date sorting)
    if (!sortByWhen) {
        // --- Draw Act labels at fixed radius ---
        svg += renderActLabels({
            numActs,
            actLabels,
            outerMostOuterRadius: ACT_LABEL_RADIUS,
            actLabelOffset: 0,
            maxStageColor
        });
    }

    // Initialize beat angles map for Gossamer (clear any stale data from previous render)
    plugin._beatAngles = new Map();

    // Store manuscript-order scene positions for Level 4 duration arcs (keyed by scene path or title)
    // Initialize map if in Chronologue mode so RingRenderer can populate it
    // Where each scene sits on the all-scenes outer ring, keyed canonically.
    // Chronologue's duration and backbone arcs draw from it; RingRenderer fills
    // it from the sequence it already built.
    const outerRingPositionByKey: Map<string, PositionInfo> | undefined = isChronologueMode ? new Map() : undefined;

    // Determine how many acts to render based on sorting method
    // When date sorting: Use full 360° circle (only "act 0")
    // Manuscript order: Use configured Act zones
    const actsToRender = sortByWhen ? 1 : numActs;

    const stopRingRender = startPerfSegment(plugin, 'timeline.render-rings');

    const ringRenderContext: RingRenderContext = {
        plugin,
        scenes,
        actsToRender,
        sortByWhen,
        isChronologueMode,
        forceChronological,
        masterSubplotOrder,
        colorIndexBySubplot,
        ringStartRadii,
        ringWidths,
        scenesByActAndSubplot,
        PUBLISH_STAGE_COLORS,
        maxTextWidth,
        synopsesElements,
        outerRingPositionByKey,
        outerRingChapterBoundaryGeometry: showChapterMarkers ? new Map<string, OuterRingChapterBoundaryGeometry>() : undefined,
        maxStageColor // Pass for Gossamer mode beat strokes
    };

    svg += renderRings(ringRenderContext);

    stopRingRender();

    // After all scenes are drawn, add just the act borders (vertical lines only)
    svg += renderActBorders({
        numActs,
        innerRadius,
        outerRadius: subplotOuterRadius,
    });

    if (shouldShowSubplotRings(plugin)) {
        svg += renderSubplotDominanceIndicators({
            masterSubplotOrder,
            ringStartRadii,
            ringWidths,
            subplotStates: subplotDominanceStates,
            subplotColorFor
        });
    }

    // Calculate the actual outermost outerRadius (first ring's outer edge)
    const actualOuterRadius = ringStartRadii[NUM_RINGS - 1] + ringWidths[NUM_RINGS - 1];

    // (Act labels moved earlier to be under story beat labels)

    // Calculate grid data (status counts, grid counts, estimates, runtime)
    const {
        statusCounts,
        gridCounts,
        gridSceneNames,
        gridStageStates,
        isBookComplete,
        estimatedTotalScenes,
        totalRuntimeSeconds
    } = computeGridData(scenes);

    // Save status counts for completion estimate
    plugin.latestStatusCounts = statusCounts;

    // --- Stage × Status Grid (center) ---
    // define arrays for grid rendering
    const stagesForGrid = [...STAGES_FOR_GRID];
    const statusesForGrid = [...STATUSES_FOR_GRID];

    // Layout for grid
    const cellBase = GRID_CELL_BASE; // base size
    const cellWidth = Math.round(cellBase * 1.5) + GRID_CELL_WIDTH_EXTRA;  // widen cells further so horizontal gap can be 2px
    const cellHeight = cellBase; // restore original height
    const cellGapY = GRID_CELL_GAP_Y;   // tighter vertical gap
    const cellGapX = GRID_CELL_GAP_X; // exact horizontal gap between rectangles
    const gridWidth = statusesForGrid.length * cellWidth + (statusesForGrid.length - 1) * cellGapX;
    const gridHeight = stagesForGrid.length * cellHeight + (stagesForGrid.length - 1) * cellGapY;
    const startXGrid = -gridWidth / 2;
    const startYGrid = -gridHeight / 2;



    const currentYearLabel = String(new Date().getFullYear());
    const headerY = startYGrid - (cellGapY + GRID_HEADER_OFFSET_Y);




    svg += renderCenterGrid({
        statusesForGrid,
        stagesForGrid,
        gridCounts,
        gridSceneNames,
        gridStageStates,
        isBookComplete,
        PUBLISH_STAGE_COLORS,
        currentYearLabel,
        estimatedTotalScenes,
        totalRuntimeSeconds,
        startXGrid,
        startYGrid,
        cellWidth,
        cellHeight,
        cellGapX,
        cellGapY,
        headerY,
        stageTooltips: STAGE_HEADER_TOOLTIPS,
        statusTooltips: STATUS_HEADER_TOOLTIPS,
        runtimeContentType: plugin.settings.runtimeContentType || 'novel',
    });

    // Add number squares after background layer but before synopses
    const numberSquareContext: NumberSquareRenderContext = {
        plugin,
        scenes,
        scenesByActAndSubplot,
        masterSubplotOrder,
        ringStartRadii,
        ringWidths,
        sceneGrades,
        sceneNumbersMap,
        numberSquareVisualResolver: numberSquareVisualResolver || null,
        shouldApplyNumberSquareColors
    };

    svg += renderNumberSquares(numberSquareContext);

    if (showChapterMarkers && ringRenderContext.outerRingChapterBoundaryGeometry) {
        const chapterResolverItems = buildTimelineChapterResolverItems(scenes);
        const chapterMarkers = collapseTimelineChapterMarkersByResolvedBoundary(
            resolveTimelineChapterMarkers(chapterResolverItems)
        );
        const activeNovelLayout = resolveActiveNovelPandocLayout(settings);
        const partMarkers = buildNarrativePartMarkers({
            settings,
            layout: activeNovelLayout,
            // One `Part:` field per scene, so the resolver already yields at
            // most one marker per boundary — no collapse pass needed.
            partMarkers: resolveTimelinePartMarkers(chapterResolverItems),
            boundaryGeometryByScenePath: ringRenderContext.outerRingChapterBoundaryGeometry,
        });
        svg += renderNarrativeChapterMarkers({
            markers: chapterMarkers,
            boundaryGeometryByScenePath: ringRenderContext.outerRingChapterBoundaryGeometry,
            partMarkers
        });
    }

    // Close rotatable container
    svg += `</g>`;

    // Add tick mark for the estimated completion date outside the rotatable scene layer.
    // It belongs to calendar time, so manual timeline rotation must not move it.
    if (estimateResult && settings.showCompletionEstimate !== false) {
        svg += renderEstimatedDateElements({ estimate: estimateResult, progressRadius });
    }

    // Subplot labels - rendered OUTSIDE rotatable so they stay fixed when rotation is applied
    svg += `<g class="background-layer subplot-labels-fixed">`;
    svg += renderSubplotLabels({ NUM_RINGS, ringStartRadii, ringWidths, masterSubplotOrder, colorIndexBySubplot, plugin });
    svg += `</g>`;

    let chronologueOverlaysHtml = '';
    // Add Chronologue mode arcs
    if (isChronologueMode) {
        chronologueOverlaysHtml = renderChronologueOverlays({
            plugin,
            scenes,
            subplotOuterRadius,
            manuscriptOrderPositions: outerRingPositionByKey,
            ringStartRadii,
            ringWidths,
            masterSubplotOrder,
            chronologueSceneEntries,
            durationArcRadius: CHRONOLOGUE_DURATION_ARC_RADIUS,
            synopsesElements,
            maxTextWidth,
            useRuntimeMode: options?.runtimeModeActive ?? false,
            microRingLayout,
            microRingBaseRadius,
            backdropLayout
        });
    }

    // Serialize synopses to string and store HTML for later insertion
    const synopsisHTML = serializeSynopsesToString(synopsesElements);

    // --- Gossamer momentum layer ---
    svg += renderGossamerOverlay({
        plugin,
        scenes,
        innerRadius,
        actualOuterRadius,
        ringStartRadii,
        numRings: NUM_RINGS,
        publishStageColors: PUBLISH_STAGE_COLORS
    });

    // Add synopses LAST so they appear on top of everything (including gossamer traces and Chronologue arcs)
    svg += chronologueOverlaysHtml;

    // Render boundary date labels on top of chronologue arcs
    if (isChronologueMode && boundaryLabelsHtml) {
        svg += boundaryLabelsHtml;
    }

    svg += synopsisHTML;

    // Close static root container
    svg += `</g>`;

    // Add rotation toggle control (non-rotating UI), positioned above top edge (Act 2 marker vicinity)
    // Place the button near the Act 2 label (start of Act 2 boundary) and slightly outside along local y-axis
    svg += renderRotationToggle({ numActs, actualOuterRadius });

    // Add version indicator (bottom-left corner)
    // Returns computed X position for aligning APR indicator above it
    // Priority: Settings Alert > Update Available > Bug Report
    let versionIndicatorX: number | undefined;
    try {
        const versionService = getVersionCheckService();
        const hasSettingsAlert = hasActiveAlerts(settings);
        const versionResult = renderVersionIndicator({
            version: versionService.getCurrentVersion(),
            hasUpdate: versionService.isUpdateAvailable(),
            latestVersion: versionService.getLatestVersion() || undefined,
            hasSettingsAlert
        });
        svg += versionResult.svg;
        versionIndicatorX = versionResult.computedX;
    } catch {
        // Version service not initialized yet - render without update info
        // Will be updated on next render after version check completes
    }

    // Add help icon (bottom-right corner)
    svg += renderHelpIcon();
    
    // Add APR refresh indicator if needed (bottom-left, above version indicator)
    // Uses same X as version indicator to ensure vertical alignment
    if (options?.aprNeedsRefresh) {
        svg += renderAuthorProgressIndicator({ 
            needsRefresh: true,
            x: versionIndicatorX  // Align with version indicator
        });
    }

    // Add milestone indicator if there's a milestone (right side, above Help icon)
    // This is the MILESTONES system, separate from estimation/tick tracking
    if (options?.milestone) {
        svg += renderMilestoneIndicator({ milestone: options.milestone });
    }

    // Add JavaScript to handle synopsis visibility
    const scriptSection = ``;

    // If not in debug mode, close SVG normally
    svg += `${scriptSection}</svg>`;

    const generatedSvgString = svg; // Assuming svg holds the final string

    // Find the max stage color (assuming maxStageColor variable exists here)
    // const maxStageColor = ... // Needs to be defined/calculated earlier

    // Return both the string and the color
    stopTotalPerf();
    return { svgString: generatedSvgString, maxStageColor: maxStageColor };
}
