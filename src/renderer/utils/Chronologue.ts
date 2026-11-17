import { compressedRingLayout } from '../../chronologue/compressedRingLayout';
import { computePositions } from './SceneLayout';
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
import { outerLabelArc } from '../components/Months';
import { BACKDROP_RING_HEIGHT, CHRONOLOGUE_BOUNDARY_LINE_SPACING } from '../layout/LayoutConstants';
import { whenTextNamesDay } from '../../utils/whenFormat';
import { splitWhenEra } from '../../utils/date';
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
    earthDate?: string;
    precision?: 'year' | 'month' | 'day' | 'time';
    labelKind?: 'year' | 'month' | 'day' | 'time' | 'datetime';
    boundaryAtSeam?: boolean;
};

/** Reserve room for the range at the seam and prefer changes of year/month. */
export function fitChronologueLabels(labels: ChronologueLabel[], radius: number): ChronologueLabel[] {
    const circle = 2 * Math.PI;
    const angle = (value: number) => ((value + Math.PI / 2) % circle + circle) % circle;
    const boundary = labels.filter(label => label.isFirst || label.isLast);
    const reserved = boundary.map(label => {
        const length = Math.min(Math.PI / 4, (Math.max(12, ...label.shortName.split('\n').map(line => [...line].length)) * 10 + 20) / radius);
        return label.isFirst ? { start: 0, end: length } : { start: circle - length, end: circle };
    });
    const major = labels.filter(label => label.isMajor && !label.isFirst && !label.isLast);
    const ranked = major.map((label, index) => {
        const previous = index ? major[index - 1] : boundary.find(item => item.isFirst);
        const date = label.earthDate ? new Date(label.earthDate) : null;
        const before = previous?.earthDate ? new Date(previous.earthDate) : null;
        const priority = date && before && date.getFullYear() !== before.getFullYear() ? 2 : date && before && date.getMonth() !== before.getMonth() ? 1 : 0;
        return { label, index, priority };
    }).sort((a, b) => b.priority - a.priority || a.index - b.index);
    const selected = new Set<ChronologueLabel>(boundary);
    for (const { label } of ranked) {
        if (selected.size >= 20) break;
        const start = angle(label.angle);
        const length = Math.min(Math.PI / 6, (Math.max(12, ...label.shortName.split('\n').map(line => [...line].length)) * 11 + 16) / radius);
        const end = start + length;
        if (end > circle || reserved.some(item => start < item.end && end > item.start)) continue;
        reserved.push({ start, end });
        selected.add(label);
    }
    return labels.map(label => label.isMajor && !selected.has(label)
        ? { ...label, name: '', shortName: '', isMajor: false, earthDate: undefined }
        : label);
}

export function buildChronologueOuterLabels(
    plugin: PluginRendererFacade,
    scenes: TimelineItem[],
    innerR: number,
    outerR: number,
    compressedTime = false
): ChronologueLabel[] {
    const stopChronoLabels = startPerfSegment(plugin, 'timeline.chronologue-labels');
    const startAngle = -Math.PI / 2;
    const endAngle = (3 * Math.PI) / 2;

    const sortedScenes = buildChronologueSceneSequence(scenes);

    const validDates = sortedScenes
        .map(s => s.when)
        .filter((when): when is Date => when instanceof Date && !isNaN(when.getTime()));
    const timeSpan = validDates.length > 0 ? calculateTimeSpan(validDates) : undefined;

    const compressed = compressedTime ? compressedRingLayout(sortedScenes, startAngle, endAngle) : null;
    const positions = compressed?.positions ?? computePositions(innerR, outerR, startAngle, endAngle, sortedScenes);
    const sceneStartAngles = sortedScenes.map((scene, idx) => {
        const range = compressed?.scale.ranges.find(item => item.id === scene.path);
        return range ? compressed!.mapAngle((range.startAngle + range.endAngle) / 2) : positions.get(idx)!.startAngle;
    });
    const sceneAngularSize = compressed ? undefined : positions.get(0)?.angularSize ?? 0;

    const datedScenes = sortedScenes.map(scene => {
        const raw = scene.rawFrontmatter?.When;
        if (typeof raw !== 'string' && typeof raw !== 'number') return scene;
        const text = String(raw);
        const body = splitWhenEra(text).body;
        const whenPrecision = scene.whenHasClock ? 'time' : /^\d{1,4}$/.test(body) ? 'year' : whenTextNamesDay(text) ? 'day' : 'month';
        return { ...scene, whenPrecision } as typeof scene & { whenPrecision: 'year' | 'month' | 'day' | 'time' };
    });
    const chronoTicks = generateChronologicalTicks(datedScenes, sceneStartAngles, sceneAngularSize, timeSpan);
    const outerLabels = chronoTicks.map(tick => ({
        name: tick.name,
        shortName: tick.shortName,
        angle: tick.angle,
        isMajor: tick.isMajor,
        isFirst: tick.isFirst,
        isLast: tick.isLast,
        earthDate: tick.earthDate,
        precision: tick.precision,
        labelKind: tick.labelKind,
        boundaryAtSeam: !compressed && !!(tick.isFirst || tick.isLast)
    }));
    // Reference dates live on their overlay tooltip and Timetable subrow.
    stopChronoLabels();
    // In the compressed layout the last date is not necessarily at the seam.
    // Reserve room around its actual position before fitting intermediate labels.
    const boundaries = compressed ? outerLabels.filter(label => label.isFirst || label.isLast) : [];
    const spacedLabels = compressed ? outerLabels.map(label => {
        if (!label.isMajor || label.isFirst || label.isLast) return label;
        const overlaps = boundaries.some(boundary => {
            const distance = Math.abs(Math.atan2(Math.sin(label.angle - boundary.angle), Math.cos(label.angle - boundary.angle)));
            return distance < (Math.max(label.shortName.length, boundary.shortName.length, 12) * 11 + 20) / outerR;
        });
        return overlaps ? { ...label, name: '', shortName: '', isMajor: false, earthDate: undefined } : label;
    }) : outerLabels;
    return fitChronologueLabels(spacedLabels, outerR);
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
    microRingLayout,
    microRingBaseRadius,
    backdropLayout
}: ChronologueOverlayOptions): string {
    const stopChronoOverlays = startPerfSegment(plugin, 'timeline.chronologue-overlays');
    let svg = '';

    const durationCapMs = durationSelectionToMs(plugin.settings.chronologueDurationCapSelection);
    const chronologueTimelineArc = renderChronologueTimelineArc(
        scenes,
        subplotOuterRadius,
        manuscriptOrderPositions,
        durationCapMs,
        durationArcRadius,
        chronologueSceneEntries
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
                    maxTextWidth
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

    outerLabels.forEach((label, index) => {
        const { shortName, isFirst, isLast, earthDate, precision, labelKind } = label;
        const pathId = `monthLabelPath-${index}`;
        // A flipped label's path runs back toward its tick, so it ends there
        const anchor = outerLabelArc(label).flipped || (label.boundaryAtSeam && isLast) ? 'startOffset="100%" text-anchor="end"' : 'startOffset="0" text-anchor="start"';

        // Only apply past month dimming in non-chronologue modes
        const isPastMonth = !isChronologueMode && index < currentMonthIndex;

        let labelClass = 'rt-month-label-outer';
        if (isFirst) {
            labelClass = 'rt-month-label-outer rt-date-boundary rt-date-first';
        } else if (isLast) {
            labelClass = 'rt-month-label-outer rt-date-boundary rt-date-last';
        }

        // Planet calendars carry the author's own month names.
        let labelContent = escapeXml(shortName);
        if ((isFirst || isLast) && shortName.includes('\n')) {
            const lines = shortName.split('\n');
            labelContent = lines
                .map((line, i) => `<tspan x="0" dy="${i === 0 ? 0 : CHRONOLOGUE_BOUNDARY_LINE_SPACING}">${escapeXml(line)}</tspan>`)
                .join('');
        }

        // Add data-earth-date so alien (planetary) mode can swap labels
        const earthDateAttr = earthDate ? ` data-earth-date="${escapeXml(earthDate)}"` : '';
        const precisionAttr = precision ? ` data-date-precision="${precision}" data-label-kind="${labelKind ?? precision}"` : '';

        const labelHtml = `
            <text class="${labelClass}"${earthDateAttr}${precisionAttr} ${isPastMonth ? 'opacity="0.5"' : ''}>
                <textPath href="#${pathId}" ${anchor}>
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
    outerLabels.forEach(({ angle: sceneAngle, isMajor, shortName, isFirst, isLast, boundaryAtSeam }) => {
        const angle = boundaryAtSeam && (isFirst || isLast) ? -Math.PI / 2 : sceneAngle;
        const tickStart = monthTickStart;

        if (isMajor) {
            const tickEnd = monthTickEnd;
            const x1 = formatNumber(tickStart * Math.cos(angle));
            const y1 = formatNumber(tickStart * Math.sin(angle));
            const x2 = formatNumber(tickEnd * Math.cos(angle));
            const y2 = formatNumber(tickEnd * Math.sin(angle));
            const boundaryClass = isFirst ? ' rt-date-first' : (isLast ? ' rt-date-last' : '');

            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                class="rt-chronological-tick rt-chronological-tick-major${boundaryClass}"/>`;
        } else if (shortName === '') {
            const tickEnd = (monthTickStart + monthTickEnd) / 2;
            const x1 = formatNumber(tickStart * Math.cos(angle));
            const y1 = formatNumber(tickStart * Math.sin(angle));
            const x2 = formatNumber(tickEnd * Math.cos(angle));
            const y2 = formatNumber(tickEnd * Math.sin(angle));

            svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                class="rt-chronological-tick rt-chronological-tick-minor"/>`;
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
