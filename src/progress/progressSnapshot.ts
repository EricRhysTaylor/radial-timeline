import type { TimelineItem } from '../types';
import { isNonSceneItem } from '../utils/sceneHelpers';
import { STAGE_ORDER, type Stage, type Status } from '../utils/constants';
import { isOverdueDateString } from '../utils/date';
import { normalizeStatus } from '../utils/text';

export interface ProgressScene {
    item: TimelineItem;
    key: string;
    stage: Stage;
    stageIndex: number;
    status: Status;
    isComplete: boolean;
}

export interface ProgressStageState {
    stage: Stage;
    stageIndex: number;
    sceneCount: number;
    completeCount: number;
    incompleteCount: number;
    clearedCount: number;
    isComplete: boolean;
}

export interface ProgressSnapshot {
    scenes: ProgressScene[];
    totalScenes: number;
    gridCounts: Record<Stage, Record<Status, number>>;
    stageStates: Record<Stage, ProgressStageState>;
    highestStageWithScenes: Stage | null;
    highestCompletedStage: Stage | null;
    bookComplete: boolean;
}

export function normalizePublishStage(raw: unknown): Stage {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const normalized = (value ?? 'Zero').toString().trim().toLowerCase();
    return STAGE_ORDER.find(stage => stage.toLowerCase() === normalized) ?? 'Zero';
}

export function isCompleteStatus(raw: unknown): boolean {
    return normalizeStatus(raw) === 'Completed';
}

export function getProgressSceneKey(scene: TimelineItem, index: number): string {
    return scene.path?.trim() || `${scene.title ?? 'scene'}::${scene.number ?? ''}::${index}`;
}

export function getProgressStatus(scene: TimelineItem): Status {
    const normalized = normalizeStatus(scene.status);
    if (normalized === 'Completed') return 'Completed';
    if (scene.due && isOverdueDateString(scene.due)) return 'Due';
    if (normalized === 'Working') return 'Working';
    return 'Todo';
}

export function getUniqueProgressScenes(scenes: TimelineItem[]): ProgressScene[] {
    const seen = new Set<string>();
    const unique: ProgressScene[] = [];

    scenes.forEach((scene, index) => {
        if (isNonSceneItem(scene)) return;
        const key = getProgressSceneKey(scene, index);
        if (seen.has(key)) return;
        seen.add(key);

        const stage = normalizePublishStage(scene['Publish Stage']);
        unique.push({
            item: scene,
            key,
            stage,
            stageIndex: STAGE_ORDER.indexOf(stage),
            status: getProgressStatus(scene),
            isComplete: isCompleteStatus(scene.status),
        });
    });

    return unique;
}

export function hasSceneClearedStage(scene: ProgressScene, stage: Stage): boolean {
    const targetIndex = STAGE_ORDER.indexOf(stage);
    return scene.stageIndex > targetIndex || (scene.stageIndex === targetIndex && scene.isComplete);
}

export function buildProgressSnapshot(scenes: TimelineItem[]): ProgressSnapshot {
    const progressScenes = getUniqueProgressScenes(scenes);
    const gridCounts = {} as Record<Stage, Record<Status, number>>;
    const stageStates = {} as Record<Stage, ProgressStageState>;

    STAGE_ORDER.forEach(stage => {
        gridCounts[stage] = { Todo: 0, Working: 0, Due: 0, Completed: 0 };
    });

    progressScenes.forEach(scene => {
        gridCounts[scene.stage][scene.status] += 1;
    });

    STAGE_ORDER.forEach((stage, stageIndex) => {
        const scenesAtStage = progressScenes.filter(scene => scene.stage === stage);
        const completeCount = scenesAtStage.filter(scene => scene.isComplete).length;
        const clearedCount = progressScenes.filter(scene => hasSceneClearedStage(scene, stage)).length;

        stageStates[stage] = {
            stage,
            stageIndex,
            sceneCount: scenesAtStage.length,
            completeCount,
            incompleteCount: scenesAtStage.length - completeCount,
            clearedCount,
            isComplete: progressScenes.length > 0 && clearedCount === progressScenes.length,
        };
    });

    const highestStageWithScenes = [...STAGE_ORDER]
        .reverse()
        .find(stage => stageStates[stage].sceneCount > 0) ?? null;
    const highestCompletedStage = [...STAGE_ORDER]
        .reverse()
        .find(stage => stageStates[stage].isComplete) ?? null;

    return {
        scenes: progressScenes,
        totalScenes: progressScenes.length,
        gridCounts,
        stageStates,
        highestStageWithScenes,
        highestCompletedStage,
        bookComplete: stageStates.Press.isComplete,
    };
}

