import type { TimelineChapterMarker } from '../../utils/timelineChapters';
import { escapeXml, formatNumber } from '../../utils/svg';
import { NARRATIVE_CHAPTER_MARKER_RADIUS } from '../layout/LayoutConstants';

export interface OuterRingChapterBoundaryGeometry {
    startAngle: number;
    outerR: number;
}

const CHAPTER_MARKER_BADGE_SIZE = 14;
const CHAPTER_MARKER_COMBINED_BADGE_WIDTH = 30;
const CHAPTER_MARKER_BADGE_CORNER_RADIUS = 2;

export interface NarrativePartMarker {
    startAngle: number;
    tooltip: string;
}

interface AggregatedBoundaryMarker {
    startAngle: number;
    hasPart: boolean;
    hasChapter: boolean;
    chapterTitles: string[];
    tooltipSections: string[];
    scenePath?: string;
}

export function renderNarrativeChapterMarkers(params: {
    markers: TimelineChapterMarker[];
    boundaryGeometryByScenePath: Map<string, OuterRingChapterBoundaryGeometry>;
    partMarkers?: NarrativePartMarker[];
}): string {
    const { markers, boundaryGeometryByScenePath, partMarkers = [] } = params;
    if ((markers.length === 0 || boundaryGeometryByScenePath.size === 0) && partMarkers.length === 0) return '';

    const markersByBoundary = new Map<string, AggregatedBoundaryMarker>();

    const getBoundary = (startAngle: number): AggregatedBoundaryMarker => {
        const key = startAngle.toFixed(6);
        const existing = markersByBoundary.get(key);
        if (existing) return existing;
        const created: AggregatedBoundaryMarker = {
            startAngle,
            hasPart: false,
            hasChapter: false,
            chapterTitles: [],
            tooltipSections: [],
        };
        markersByBoundary.set(key, created);
        return created;
    };

    for (const partMarker of partMarkers) {
        const boundary = getBoundary(partMarker.startAngle);
        boundary.hasPart = true;
        boundary.tooltipSections.push(partMarker.tooltip);
    }

    for (const marker of markers) {
        const geometry = boundaryGeometryByScenePath.get(marker.resolvedScenePath);
        if (!geometry) continue;

        const boundary = getBoundary(geometry.startAngle);
        boundary.hasChapter = true;
        boundary.chapterTitles.push(marker.title);
        boundary.tooltipSections.push(`Chapter: ${marker.title}`);
        boundary.scenePath = marker.resolvedScenePath;
    }

    const markerSvg = Array.from(markersByBoundary.values()).map((marker) => {
        const label = marker.hasPart && marker.hasChapter
            ? 'P•C'
            : marker.hasPart
                ? 'P'
                : 'C';
        const badgeWidth = label.length > 1 ? CHAPTER_MARKER_COMBINED_BADGE_WIDTH : CHAPTER_MARKER_BADGE_SIZE;
        const badgeX = NARRATIVE_CHAPTER_MARKER_RADIUS * Math.cos(marker.startAngle);
        const badgeY = NARRATIVE_CHAPTER_MARKER_RADIUS * Math.sin(marker.startAngle);
        const tooltipText = escapeXml(marker.tooltipSections.join('\n\n'));
        const markerClasses = `ert-chapter-marker rt-tooltip-target${label.length > 1 ? ' ert-chapter-marker--combined' : ''}`;
        const titleAttr = marker.chapterTitles.length > 0 ? ` data-chapter-title="${escapeXml(marker.chapterTitles.join(' | '))}"` : '';
        const scenePathAttr = marker.scenePath ? ` data-scene-path="${escapeXml(marker.scenePath)}"` : '';

        return `
            <g class="${markerClasses}" transform="translate(${formatNumber(badgeX)}, ${formatNumber(badgeY)})"${scenePathAttr}${titleAttr} data-tooltip="${tooltipText}" data-tooltip-placement="top">
                <rect x="${formatNumber(-badgeWidth / 2)}" y="${formatNumber(-CHAPTER_MARKER_BADGE_SIZE / 2)}" width="${badgeWidth}" height="${CHAPTER_MARKER_BADGE_SIZE}" rx="${CHAPTER_MARKER_BADGE_CORNER_RADIUS}" ry="${CHAPTER_MARKER_BADGE_CORNER_RADIUS}" class="ert-chapter-marker-badge" />
                <text x="0" y="0" class="ert-chapter-marker-label" text-anchor="middle" dominant-baseline="middle" dy="0.08em">${label}</text>
            </g>
        `;
    }).filter(Boolean).join('');

    if (!markerSvg) return '';
    return `<g class="ert-chapter-markers">${markerSvg}</g>`;
}
