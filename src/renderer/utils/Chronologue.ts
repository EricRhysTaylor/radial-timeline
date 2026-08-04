/*
 * Helper to generate outer label data for Chronologue mode.
 */

import type { TimelineItem } from '../../types';
import { buildChronologueSceneSequence, type PluginRendererFacade } from '../../utils/sceneHelpers';
import { calculateTimeSpan, generateChronologicalTicks, durationSelectionToMs, parseDurationDetail } from '../../utils/date';
import { escapeXml, formatNumber } from '../../utils/svg';
import { startPerfSegment } from '../utils/Performance';
import {
    renderChronologueTimelineArc,
    renderChronologicalBackboneArc,
    type ChronologueSceneEntry
} from '../components/ChronologueTimeline';
import { renderBackdropRing, type BackdropRingLayout } from '../components/BackdropRing';
import { BACKDROP_RING_HEIGHT } from '../layout/LayoutConstants';
import {
    renderBackdropMicroRings,
    type BackdropMicroRingLayout,
    type MicroRingSegment,
    type MicroRingTick
} from '../components/BackdropMicroRings';
import { MICRO_RING_GAP, MICRO_RING_WIDTH } from '../layout/LayoutConstants';

export type ChronologueLabel = {
    name: string;
    shortName: string;
    angle: number;
    isMajor?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    sceneIndex?: number;
    earthDate?: string;
};

export function buildChronologueOuterLabels(
    plugin: PluginRendererFacade,
    scenes: TimelineItem[]
): ChronologueLabel[] {
    const stopChronoLabels = startPerfSegment(plugin, 'timeline.chronologue-labels');
    const startAngle = -Math.PI / 2;
    const endAngle = (3 * Math.PI) / 2;

    const sortedScenes = buildChronologueSceneSequence(scenes);

    const validDates = sortedScenes
        .map(s => s.when)
        .filter((when): when is Date => when instanceof Date && !isNaN(when.getTime()));
    const timeSpan = validDates.length > 0 ? calculateTimeSpan(validDates) : undefined;

    const sceneStartAngles: number[] = [];
    let sceneAngularSize = 0;
    if (sortedScenes.length > 0) {
        const totalAngularSpace = endAngle - startAngle;
        sceneAngularSize = totalAngularSpace / sortedScenes.length;

        sortedScenes.forEach((_, idx) => {
            const sceneStartAngle = startAngle + (idx * sceneAngularSize);
            sceneStartAngles.push(sceneStartAngle);
        });
    }

    const chronoTicks = generateChronologicalTicks(sortedScenes, sceneStartAngles, sceneAngularSize, timeSpan);
    const outerLabels = chronoTicks.map(tick => ({
        name: tick.name,
        shortName: tick.shortName,
        angle: tick.angle,
        isMajor: tick.isMajor,
        isFirst: tick.isFirst,
        isLast: tick.isLast,
        sceneIndex: tick.sceneIndex,
        earthDate: tick.earthDate
    }));
    stopChronoLabels();
    return outerLabels;
}

export type ChronologueOverlayOptions = {
    plugin: PluginRendererFacade;
    scenes: TimelineItem[];
    subplotOuterRadius: number;
    manuscriptOrderPositions?: Map<string, { startAngle: number; endAngle: number }>;
    ringStartRadii: number[];
    ringWidths: number[];
    masterSubplotOrder?: string[];
    chronologueSceneEntries?: ChronologueSceneEntry[];
    durationArcRadius?: number;
    synopsesElements?: SVGGElement[];
    maxTextWidth?: number;
    useRuntimeMode?: boolean;
    microRingLayout?: BackdropMicroRingLayout;
    microRingBaseRadius?: number;
    backdropLayout?: BackdropRingLayout;
};

export function renderChronologueOverlays({
    plugin,
    scenes,
    subplotOuterRadius,
    manuscriptOrderPositions,
    ringStartRadii,
    ringWidths,
    masterSubplotOrder = [],
    chronologueSceneEntries,
    durationArcRadius = 0,
    synopsesElements = [],
    maxTextWidth = 0,
    useRuntimeMode = false,
    microRingLayout,
    microRingBaseRadius,
    backdropLayout
}: ChronologueOverlayOptions): string {
    const stopChronoOverlays = startPerfSegment(plugin, 'timeline.chronologue-overlays');
    let svg = '';

    // Calculate cap: use null (auto) for runtime mode, duration setting for duration mode
    const durationCapMs: number | null = useRuntimeMode 
        ? null  // Runtime mode: auto-scale based on observed max
        : durationSelectionToMs(plugin.settings.chronologueDurationCapSelection);
    const chronologueTimelineArc = renderChronologueTimelineArc(
        scenes,
        subplotOuterRadius,
        manuscriptOrderPositions,
        durationCapMs,
        durationArcRadius,
        chronologueSceneEntries,
        useRuntimeMode
    );
    if (chronologueTimelineArc) {
        svg += chronologueTimelineArc;
    }

    // The backdrop layout was pre-built by Precompute so the layout engine
    // could reserve the correct radial width for it (lanes × ring height).
    // With that reservation in place, the subplot rings inside have already
    // been pushed inward correctly — and microRingBaseRadius already reflects
    // the post-allocation geometry, so no extra shift is needed here.
    const backdropSubplotIndex = masterSubplotOrder.indexOf('Backdrop');

    if (microRingLayout?.segments.length && Number.isFinite(microRingBaseRadius)) {
        svg += renderBackdropMicroRings({
            layout: microRingLayout,
            baseRadius: microRingBaseRadius as number,
            laneGap: MICRO_RING_WIDTH + MICRO_RING_GAP
        });
    }

    const outerRingIndex = ringStartRadii.length - 1;
    const outerRingInnerR = ringStartRadii[outerRingIndex];
    const outerRingOuterR = outerRingInnerR + ringWidths[outerRingIndex];

    let customThresholdMs: number | undefined = undefined;
    if (plugin.settings.discontinuityThreshold) {
        const parsed = parseDurationDetail(plugin.settings.discontinuityThreshold);
        if (parsed) {
            customThresholdMs = parsed.ms;
        }
    }

    svg += renderChronologicalBackboneArc(
        scenes,
        outerRingInnerR,
        outerRingOuterR,
        3,
        manuscriptOrderPositions,
        chronologueSceneEntries,
        customThresholdMs
    );

    // Render the Backdrop ring using the layout precomputed above.
    // The layout engine allocated `laneCount * BACKDROP_RING_HEIGHT` of
    // radial space for the Backdrop slot, so lane 0 sits at the outer
    // edge of that allocation and inner lanes stack inward into the
    // remaining space — without colliding with the next subplot ring.
    if (backdropLayout && backdropLayout.segments.length > 0 && backdropSubplotIndex !== -1) {
        const numRings = ringStartRadii.length;
        const ringIndex = numRings - 1 - backdropSubplotIndex;
        if (ringIndex >= 0 && ringIndex < numRings) {
            // Outer edge of the allocated Backdrop slot, minus half a lane
            // height — i.e. the center of lane 0 (the outermost lane).
            const slotOuterEdge = ringStartRadii[ringIndex] + ringWidths[ringIndex];
            const backdropRadius = slotOuterEdge - (BACKDROP_RING_HEIGHT / 2);

            try {
                svg += renderBackdropRing({
                    plugin,
                    scenes,
                    layout: backdropLayout,
                    availableRadius: backdropRadius,
                    synopsesElements,
                    maxTextWidth,
                    masterSubplotOrder
                });
            } catch (err) {
                 
                console.error('[radial-timeline] renderBackdropRing failed; backdrop ring skipped this render.', err);
            }
        }
    }

    stopChronoOverlays();
    return svg;
}

type OuterLabelRenderParams = {
    outerLabels: ChronologueLabel[];
    isChronologueMode: boolean;
    currentMonthIndex: number;
};

export function renderOuterLabelTexts({
    outerLabels,
    isChronologueMode,
    currentMonthIndex
}: OuterLabelRenderParams): { labelsSvg: string; boundaryLabelsHtml: string } {
    let labelsSvg = '';
    let boundaryLabelsHtml = '';

    outerLabels.forEach(({ shortName, isFirst, isLast, earthDate, sceneIndex }, index) => {
        const pathId = `monthLabelPath-${index}`;

        // Only apply past month dimming in non-chronologue modes
        const isPastMonth = !isChronologueMode && index < currentMonthIndex;

        let labelClass = 'rt-month-label-outer';
        if (isFirst) {
            labelClass = 'rt-month-label-outer rt-date-boundary rt-date-first';
        } else if (isLast) {
            labelClass = 'rt-month-label-outer rt-date-boundary rt-date-last';
        }

        let labelContent = shortName;
        if ((isFirst || isLast) && shortName.includes('\n')) {
            const lines = shortName.split('\n');
            labelContent = lines
                .map((line, i) => `<tspan x="0" dy="${i === 0 ? 0 : '0.9em'}">${line}</tspan>`)
                .join('');
        }

        // Add data-earth-date so alien (planetary) mode can swap labels
        const earthDateAttr = earthDate ? ` data-earth-date="${earthDate}"` : '';
        // Add data-scene-index so runtime mode can associate labels with scene runtimes
        const sceneIndexAttr = sceneIndex !== undefined ? ` data-scene-index="${sceneIndex}"` : '';

        const labelHtml = `
            <text class="${labelClass}"${earthDateAttr}${sceneIndexAttr} ${isPastMonth ? 'opacity="0.5"' : ''}>
                <textPath href="#${pathId}" startOffset="0" text-anchor="start">
                    ${labelContent}
                </textPath>
            </text>
        `;

        if (isChronologueMode && (isFirst || isLast)) {
            boundaryLabelsHtml += labelHtml;
        } else {
            labelsSvg += labelHtml;
        }
    });

    return { labelsSvg, boundaryLabelsHtml };
}

type ChronoTickParams = {
    outerLabels: ChronologueLabel[];
    monthTickStart: number;
    monthTickEnd: number;
    microRingSegments?: MicroRingSegment[];
    microRingTicks?: MicroRingTick[];
};

function tooltipKeyForTitle(title: string): string {
    return encodeURIComponent(title.trim().toLowerCase());
}

export function renderChronologueOuterTicks({
    outerLabels,
    monthTickStart,
    monthTickEnd,
    microRingSegments,
    microRingTicks
}: ChronoTickParams): string {
    if (!outerLabels.length) {
        return '';
    }

    let svg = '<g class="rt-chronological-outer-ticks">';
    outerLabels.forEach(({ angle, isMajor, shortName, isFirst, isLast, sceneIndex }) => {
        const tickStart = monthTickStart;
        const dataAttrs = sceneIndex !== undefined ? ` data-scene-index="${sceneIndex}"` : '';

        if (isMajor) {
            const tickEnd = monthTickEnd;
            const x1 = formatNumber(tickStart * Math.cos(angle));
            const y1 = formatNumber(tickStart * Math.sin(angle));
            const x2 = formatNumber(tickEnd * Math.cos(angle));
            const y2 = formatNumber(tickEnd * Math.sin(angle));
            const boundaryClass = isFirst ? ' rt-date-first' : (isLast ? ' rt-date-last' : '');

            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                class="rt-chronological-tick rt-chronological-tick-major${boundaryClass}"${dataAttrs}/>`;
        } else if (shortName === '') {
            const tickEnd = (monthTickStart + monthTickEnd) / 2;
            const x1 = formatNumber(tickStart * Math.cos(angle));
            const y1 = formatNumber(tickStart * Math.sin(angle));
            const x2 = formatNumber(tickEnd * Math.cos(angle));
            const y2 = formatNumber(tickEnd * Math.sin(angle));

            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                class="rt-chronological-tick rt-chronological-tick-minor"${dataAttrs}/>`;
        }
    });

    if (microRingSegments?.length) {
        const arcRadius = monthTickEnd - 2.5;
        microRingSegments.forEach(segment => {
            const largeArcFlag = (segment.endAngle - segment.startAngle) > Math.PI ? 1 : 0;
            const safeTitle = escapeXml(segment.title);
            const tooltipKey = escapeXml(tooltipKeyForTitle(segment.title));

            const arcX1 = formatNumber(arcRadius * Math.cos(segment.startAngle));
            const arcY1 = formatNumber(arcRadius * Math.sin(segment.startAngle));
            const arcX2 = formatNumber(arcRadius * Math.cos(segment.endAngle));
            const arcY2 = formatNumber(arcRadius * Math.sin(segment.endAngle));

            const startX1 = formatNumber(monthTickStart * Math.cos(segment.startAngle));
            const startY1 = formatNumber(monthTickStart * Math.sin(segment.startAngle));
            const startX2 = formatNumber(monthTickEnd * Math.cos(segment.startAngle));
            const startY2 = formatNumber(monthTickEnd * Math.sin(segment.startAngle));

            const endX1 = formatNumber(monthTickStart * Math.cos(segment.endAngle));
            const endY1 = formatNumber(monthTickStart * Math.sin(segment.endAngle));
            const endX2 = formatNumber(monthTickEnd * Math.cos(segment.endAngle));
            const endY2 = formatNumber(monthTickEnd * Math.sin(segment.endAngle));

            svg += `<g class="rt-backdrop-micro-outer rt-tooltip-target"
                data-tooltip="${safeTitle}"
                data-tooltip-placement="top"
                data-tooltip-key="${tooltipKey}">
                <path
                    d="M ${arcX1} ${arcY1} A ${formatNumber(arcRadius)} ${formatNumber(arcRadius)} 0 ${largeArcFlag} 1 ${arcX2} ${arcY2}"
                    class="rt-backdrop-micro-arc"
                    stroke="${segment.color}"
                    stroke-width="5"
                    stroke-linecap="round"
                    fill="none"
                />
                <line x1="${startX1}" y1="${startY1}" x2="${startX2}" y2="${startY2}"
                    class="rt-backdrop-micro-tick"
                    stroke="${segment.color}"
                />
                <line x1="${endX1}" y1="${endY1}" x2="${endX2}" y2="${endY2}"
                    class="rt-backdrop-micro-tick"
                    stroke="${segment.color}"
                />
            </g>`;
        });
    } else if (microRingTicks?.length) {
        microRingTicks.forEach(tick => {
            const x1 = formatNumber(monthTickStart * Math.cos(tick.angle));
            const y1 = formatNumber(monthTickStart * Math.sin(tick.angle));
            const x2 = formatNumber(monthTickEnd * Math.cos(tick.angle));
            const y2 = formatNumber(monthTickEnd * Math.sin(tick.angle));
            const safeTitle = escapeXml(tick.title);
            const tooltipKey = escapeXml(tooltipKeyForTitle(tick.title));

            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                class="rt-backdrop-micro-tick rt-tooltip-target"
                stroke="${tick.color}"
                data-tooltip="${safeTitle}"
                data-tooltip-placement="top"
                data-tooltip-key="${tooltipKey}"
            />`;
        });
    }
    svg += '</g>';
    return svg;
}
