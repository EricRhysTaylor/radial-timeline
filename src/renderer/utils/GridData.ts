
import type { TimelineItem } from '../../types';
import { isNonSceneItem } from '../../utils/sceneHelpers';
import { parseSceneTitle, getScenePrefixNumber } from '../../utils/text';
import { STAGES_FOR_GRID } from '../../utils/constants';
import { parseRuntimeField } from '../../utils/runtimeEstimator';
import { buildProgressSnapshot, type ProgressStageState } from '../../progress/progressSnapshot';

export interface GridDataResult {
    statusCounts: Record<string, number>;
    gridCounts: Record<string, Record<string, number>>;
    gridSceneNames: Record<string, Record<string, string[]>>;
    gridStageStates: Record<string, ProgressStageState>;
    isBookComplete: boolean;
    estimatedTotalScenes: number;
    totalRuntimeSeconds: number;
}

export function computeGridData(scenes: TimelineItem[]): GridDataResult {
    const progressSnapshot = buildProgressSnapshot(scenes);

    // 1. Calculate Status Counts (for Color Key and Estimate)
    // Only count actual scenes (not Beat, Plot, or Backdrop items)
    const statusCounts = progressSnapshot.scenes.reduce((acc, scene) => {
        const key = scene.isComplete ? scene.stage : scene.status;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    // 2. Calculate Grid Counts (Stage x Status) and track scene names
    const gridCounts: Record<string, Record<string, number>> = progressSnapshot.gridCounts;
    const gridSceneNames: Record<string, Record<string, string[]>> = {};
    // Initialize grid
    (STAGES_FOR_GRID as readonly string[]).forEach(s => {
        gridSceneNames[s] = { Todo: [], Working: [], Due: [], Completed: [] };
    });

    progressSnapshot.scenes.forEach(progressScene => {
        const scene = progressScene.item;
        // Track scene name for tooltip (include scene number prefix)
        const rawTitle = scene.title || scene.path?.split('/').pop()?.replace('.md', '') || 'Unknown';
        const baseTitle = rawTitle.replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim();
        const sceneNumber = getScenePrefixNumber(scene.title, scene.number);
        const sceneName = sceneNumber ? `${sceneNumber}. ${baseTitle}` : baseTitle;
        gridSceneNames[progressScene.stage][progressScene.status].push(sceneName);
    });

    // 3. Calculate Estimated Total Scenes
    const uniqueScenesCount = progressSnapshot.totalScenes;
    const seenForMax = new Set<string>();
    let highestPrefixNumber = 0;

    scenes.forEach(scene => {
        if (isNonSceneItem(scene)) return;
        if (!scene.path || seenForMax.has(scene.path)) return;
        seenForMax.add(scene.path);

        const { number } = parseSceneTitle(scene.title || '', scene.number);
        if (number) {
            const n = parseFloat(String(number));
            if (!isNaN(n)) {
                highestPrefixNumber = Math.max(highestPrefixNumber, n);
            }
        }
    });

    const estimatedTotalScenes = Math.max(uniqueScenesCount, Math.floor(highestPrefixNumber));

    // 4. Calculate Total Runtime (sum of all scene Runtime fields)
    const seenForRuntime = new Set<string>();
    let totalRuntimeSeconds = 0;

    scenes.forEach(scene => {
        if (isNonSceneItem(scene)) return;
        if (!scene.path || seenForRuntime.has(scene.path)) return;
        seenForRuntime.add(scene.path);

        if (scene.Runtime) {
            const seconds = parseRuntimeField(scene.Runtime);
            if (seconds !== null && seconds > 0) {
                totalRuntimeSeconds += seconds;
            }
        }
    });

    // Sort scene names naturally (numeric awareness) so tooltips show 1, 2, 3...
    Object.values(gridSceneNames).forEach(statusMap => {
        Object.values(statusMap).forEach(namesList => {
            namesList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        });
    });

    return {
        statusCounts,
        gridCounts,
        gridSceneNames,
        gridStageStates: progressSnapshot.stageStates,
        isBookComplete: progressSnapshot.bookComplete,
        estimatedTotalScenes,
        totalRuntimeSeconds
    };
}
