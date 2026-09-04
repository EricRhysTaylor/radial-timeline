import type { TimelineItem } from '../../types';
import type { CompletionEstimate } from '../../services/TimelineMetricsService';
import { isSceneItem, type PluginRendererFacade } from '../../utils/sceneHelpers';
import { parseLocalDateKey } from '../../utils/date';
import { clamp } from '../../utils/math';

interface TimelapseYearSimulationSettings {
    enabled?: boolean;
    startDate?: string;
    finishDate?: string;
    totalScenes?: number;
}

const TIMELAPSE_STAGE_PROGRESS_UNITS = 3;

export function renderProgressRing(params: {
    progressRadius: number;
    yearProgress: number;
    currentYearStartAngle: number;
    segmentCount?: number;
}): string {
    const { progressRadius, yearProgress, currentYearStartAngle, segmentCount = 6 } = params;
    const progress = clamp(yearProgress, 0, 1);
    if (progress <= 0) return '';

    const fullCircleAngle = 2 * Math.PI;
    const segmentAngle = fullCircleAngle / segmentCount;
    const progressSegments = progress * segmentCount;
    const completeSegments = Math.floor(progressSegments);
    const partialSegmentAngle = (progressSegments - completeSegments) * segmentAngle;
    let svg = '';
    for (let i = 0; i < segmentCount; i++) {
        const segStart = currentYearStartAngle + (i * segmentAngle);
        let segEnd = segStart + segmentAngle;
        if (i > completeSegments || (i === completeSegments && partialSegmentAngle <= 0)) continue;
        if (i === completeSegments && partialSegmentAngle > 0) {
            segEnd = segStart + partialSegmentAngle;
        }
        svg += `
            <path
                d="
                    M ${progressRadius * Math.cos(segStart)} ${progressRadius * Math.sin(segStart)}
                    A ${progressRadius} ${progressRadius} 0 ${(segEnd - segStart) > Math.PI ? 1 : 0} 1 
                    ${progressRadius * Math.cos(segEnd)} ${progressRadius * Math.sin(segEnd)}
                "
                class="progress-ring-fill"
                stroke="url(#linearColors${i+1})"
            />
        `;
    }
    return svg;
}

export function resolveProgressRingDate(plugin: PluginRendererFacade, scenes: TimelineItem[]): Date {
    const config = getTimelapseYearSimulationSettings(plugin);
    if (!config?.enabled) return new Date();

    const startDate = parseLocalDateKey(config.startDate) ?? new Date(new Date().getFullYear(), 0, 1);
    const finishDate = resolveTimelapseFinishDate(config, startDate);
    const totalScenes = Number.isFinite(config.totalScenes) && Number(config.totalScenes) > 0
        ? Number(config.totalScenes)
        : Math.max(1, scenes.length);
    const totalUnits = totalScenes * TIMELAPSE_STAGE_PROGRESS_UNITS;

    const progressScenes = scenes.filter(isSceneItem);
    const progressUnits = progressScenes.reduce((sum, scene) => sum + progressWeightForScene(scene), 0);
    const progress = clamp(progressUnits / totalUnits, 0, 1);
    const simulatedTime = startDate.getTime() + ((finishDate.getTime() - startDate.getTime()) * progress);
    const simulatedDate = new Date(simulatedTime);

    return Number.isFinite(simulatedDate.getTime()) ? simulatedDate : new Date();
}

export function resolveProgressEstimate(
    plugin: PluginRendererFacade,
    scenes: TimelineItem[],
    estimate: CompletionEstimate | null
): CompletionEstimate | null {
    const config = getTimelapseYearSimulationSettings(plugin);
    if (!config?.enabled) return estimate;

    const startDate = parseLocalDateKey(config.startDate) ?? new Date(new Date().getFullYear(), 0, 1);
    const finishDate = resolveTimelapseFinishDate(config, startDate);
    const totalScenes = Number.isFinite(config.totalScenes) && Number(config.totalScenes) > 0
        ? Number(config.totalScenes)
        : Math.max(1, scenes.length);
    const totalUnits = totalScenes * TIMELAPSE_STAGE_PROGRESS_UNITS;
    const completedUnits = scenes
        .filter(isSceneItem)
        .reduce((sum, scene) => sum + progressWeightForScene(scene), 0);

    return {
        date: finishDate,
        total: totalUnits,
        remaining: Math.max(0, totalUnits - completedUnits),
        rate: estimate?.rate ?? 0,
        stage: estimate?.stage ?? 'Press',
        staleness: 'late',
        lastProgressDate: estimate?.lastProgressDate ?? null,
        windowDays: estimate?.windowDays ?? 30,
        labelText: undefined,
        isFrozen: true,
        stragglerCount: estimate?.stragglerCount ?? 0
    };
}

function getTimelapseYearSimulationSettings(plugin: PluginRendererFacade): TimelapseYearSimulationSettings | undefined {
    return plugin.settings.timelapseYearSimulation;
}

function resolveTimelapseFinishDate(config: TimelapseYearSimulationSettings, startDate: Date): Date {
    return parseLocalDateKey(config.finishDate) ?? new Date(startDate.getFullYear(), 10, 30);
}

function progressWeightForScene(scene: TimelineItem): number {
    const status = Array.isArray(scene.status) ? scene.status[0] : scene.status;
    const normalized = String(status ?? '').trim().toLowerCase();
    const statusWeight = (() => {
        if (normalized === 'complete' || normalized === 'completed' || normalized === 'done') return 1;
        if (normalized === 'working') return 0.65;
        return 0.25;
    })();

    return stageProgressBase(scene['Publish Stage']) + statusWeight;
}

function stageProgressBase(rawStage: unknown): number {
    const stage = Array.isArray(rawStage) ? rawStage[0] : rawStage;
    const normalized = String(stage ?? 'Zero').trim().toLowerCase();
    if (normalized === 'author') return 1;
    if (normalized === 'house') return 1.5;
    if (normalized === 'press') return 2;
    return 0;
}
