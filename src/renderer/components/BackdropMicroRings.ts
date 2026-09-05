/*
 * Backdrop Micro Rings (Chronologue Mode)
 * Renders configurable micro rings between the progress ring and inner subplot ring.
 */

import type { TimelineItem } from '../../types/timeline';
import { parseDateRangeInput } from '../../utils/date';
import { escapeXml, formatNumber } from '../../utils/svg';
import { isBeatNote, sortScenes } from '../../utils/sceneHelpers';
import { MICRO_RING_WIDTH } from '../layout/LayoutConstants';

export type MicroRingSegment = {
    title: string;
    color: string;
    startAngle: number;
    endAngle: number;
    lane: number;
};

export type MicroRingTick = {
    angle: number;
    color: string;
    title: string;
    kind: 'start' | 'end';
};

export type BackdropMicroRingLayout = {
    segments: MicroRingSegment[];
    ticks: MicroRingTick[];
    laneCount: number;
};

type MicroRingConfig = {
    title: string;
    range: string;
    color: string;
};

const HEX_COLOR = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

function tooltipKeyForTitle(title: string): string {
    return encodeURIComponent(title.trim().toLowerCase());
}

function normalizeHexColor(value: string, fallback: string): string {
    if (!value || !HEX_COLOR.test(value)) return fallback;
    return value.startsWith('#') ? value : `#${value}`;
}

function collectChronologueScenes(scenes: TimelineItem[]): TimelineItem[] {
    const seenKeys = new Set<string>();
    const candidates: TimelineItem[] = [];

    scenes.forEach(scene => {
        if (isBeatNote(scene) || scene.itemType === 'Backdrop') return;
        if (!scene.when || !(scene.when instanceof Date) || isNaN(scene.when.getTime())) return;
        const key = scene.path || `${scene.title || ''}::${String(scene.when || '')}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        candidates.push(scene);
    });

    return sortScenes(candidates, true, true);
}

function mapTimestampToSceneIndexAngle(
    timeMs: number,
    sortedScenes: TimelineItem[],
    bias: 'start' | 'end'
): number {
    const startAngle = -Math.PI / 2;
    const endAngle = (3 * Math.PI) / 2;
    const totalAngle = endAngle - startAngle;
    const angularSize = totalAngle / sortedScenes.length;

    let prevIndex = -1;
    for (let i = 0; i < sortedScenes.length; i++) {
        const sceneTime = sortedScenes[i].when!.getTime();
        const condition = bias === 'start' ? sceneTime < timeMs : sceneTime <= timeMs;
        if (condition) {
            prevIndex = i;
        } else {
            break;
        }
    }

    if (prevIndex === -1) {
        return startAngle;
    }

    if (prevIndex === sortedScenes.length - 1) {
        return startAngle + (prevIndex * angularSize) + angularSize;
    }

    const prevScene = sortedScenes[prevIndex];
    const nextScene = sortedScenes[prevIndex + 1];
    const prevTime = prevScene.when!.getTime();
    const nextTime = nextScene.when!.getTime();
    const segmentDuration = nextTime - prevTime;
    const progress = segmentDuration > 0 ? (timeMs - prevTime) / segmentDuration : 0;
    const prevAngle = startAngle + (prevIndex * angularSize);
    return prevAngle + (progress * angularSize);
}

function rangesOverlap(a: MicroRingSegment, b: MicroRingSegment): boolean {
    return a.startAngle < b.endAngle && a.endAngle > b.startAngle;
}

export function buildBackdropMicroRingLayout(params: {
    scenes: TimelineItem[];
    configs: MicroRingConfig[];
}): BackdropMicroRingLayout {
    const { scenes, configs } = params;
    const sortedScenes = collectChronologueScenes(scenes);
    if (sortedScenes.length === 0) {
        return { segments: [], ticks: [], laneCount: 0 };
    }

    const viewStartMs = sortedScenes[0].when!.getTime();
    const viewEndMs = sortedScenes[sortedScenes.length - 1].when!.getTime();

    const segments: MicroRingSegment[] = [];
    const ticks: MicroRingTick[] = [];
    const fallbackColor = '#ffffff';

    configs.forEach((config) => {
        const title = (config.title || '').trim();
        const range = (config.range || '').trim();
        if (!title || !range) return;

        const parsedRange = parseDateRangeInput(range);
        if (!parsedRange?.start || !parsedRange?.end) return;
        let startMs = parsedRange.start.getTime();
        let endMs = parsedRange.end.getTime();
        if (endMs < startMs) {
            const temp = startMs;
            startMs = endMs;
            endMs = temp;
        }

        const clampedStartMs = Math.max(startMs, viewStartMs);
        const clampedEndMs = Math.min(endMs, viewEndMs);

        if (clampedStartMs >= clampedEndMs && endMs < viewStartMs) return;
        if (clampedStartMs >= clampedEndMs && startMs > viewEndMs) return;

        let startAngle = mapTimestampToSceneIndexAngle(clampedStartMs, sortedScenes, 'start');
        let endAngle = mapTimestampToSceneIndexAngle(clampedEndMs, sortedScenes, 'end');
        const totalAngle = (3 * Math.PI) / 2 - (-Math.PI / 2);
        const epsilon = 0.002;
        const span = endAngle - startAngle;
        if (span <= 0) {
            endAngle = startAngle + epsilon;
        } else if (span >= totalAngle - 1e-4) {
            endAngle = startAngle + (totalAngle - epsilon);
        }

        const color = normalizeHexColor(config.color, fallbackColor);
        segments.push({ title, color, startAngle, endAngle, lane: 0 });
        ticks.push({ angle: startAngle, color, title, kind: 'start' });
        ticks.push({ angle: endAngle, color, title, kind: 'end' });
    });

    if (segments.length === 0) {
        return { segments: [], ticks: [], laneCount: 0 };
    }

    const sortedByStart = segments.slice().sort((a, b) => a.startAngle - b.startAngle);
    const lanes: MicroRingSegment[][] = [];

    sortedByStart.forEach(segment => {
        let assigned = false;
        for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
            const laneSegments = lanes[laneIndex];
            const overlaps = laneSegments.some(existing => rangesOverlap(segment, existing));
            if (!overlaps) {
                segment.lane = laneIndex;
                laneSegments.push(segment);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            segment.lane = lanes.length;
            lanes.push([segment]);
        }
    });

    return { segments, ticks, laneCount: lanes.length };
}

export function renderBackdropMicroRings(params: {
    layout: BackdropMicroRingLayout;
    baseRadius: number;
    laneGap: number;
}): string {
    const { layout, baseRadius, laneGap } = params;
    if (!layout.segments.length) return '';

    const laneCount = Math.max(0, layout.laneCount);
    const interLaneGap = Math.max(0, laneGap - MICRO_RING_WIDTH);
    const totalBandWidth = laneCount > 0
        ? (laneCount * MICRO_RING_WIDTH) + ((laneCount - 1) * interLaneGap)
        : MICRO_RING_WIDTH;
    const backgroundRadius = baseRadius + ((totalBandWidth - MICRO_RING_WIDTH) / 2);

    let svg = '<g class="rt-backdrop-micro-rings">';
    svg += `<circle cx="0" cy="0" r="${formatNumber(backgroundRadius)}" class="rt-backdrop-micro-ring-background" stroke-width="${formatNumber(totalBandWidth)}" pointer-events="none" fill="none" />`;
    layout.segments.forEach(segment => {
        const radius = baseRadius + (segment.lane * laneGap);
        const largeArcFlag = (segment.endAngle - segment.startAngle) > Math.PI ? 1 : 0;
        const x1 = formatNumber(radius * Math.cos(segment.startAngle));
        const y1 = formatNumber(radius * Math.sin(segment.startAngle));
        const x2 = formatNumber(radius * Math.cos(segment.endAngle));
        const y2 = formatNumber(radius * Math.sin(segment.endAngle));
        const safeTitle = escapeXml(segment.title);
        const tooltipKey = escapeXml(tooltipKeyForTitle(segment.title));

        svg += `
            <path
                d="M ${x1} ${y1} A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArcFlag} 1 ${x2} ${y2}"
                class="rt-backdrop-micro-ring rt-tooltip-target"
                stroke="${segment.color}"
                stroke-width="${MICRO_RING_WIDTH}"
                fill="none"
                data-tooltip="${safeTitle}"
                data-tooltip-key="${tooltipKey}"
                data-tooltip-placement="bottom"
                data-tooltip-anchor="cursor"
            />
        `;
    });
    svg += '</g>';
    return svg;
}
