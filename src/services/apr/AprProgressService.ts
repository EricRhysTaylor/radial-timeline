import type RadialTimelinePlugin from '../../main';
import { buildDefaultAuthorProgressDefaults } from '../../authorProgress/authorProgressConfig';
import type { AuthorProgressDefaults, AprTrackedStage } from '../../types/settings';
import type { TimelineItem } from '../../types/timeline';
import { isBeatNote } from '../../utils/sceneHelpers';
import { STAGE_ORDER } from '../../utils/constants';
import { isCompleteStatus, normalizePublishStage } from '../../progress/progressSnapshot';

export type AprResolvedProgressMode = NonNullable<AuthorProgressDefaults['aprProgressMode']>;

export type AprStageBreakdown = Record<AprTrackedStage, number>;

export interface AprResolvedProgressState {
    mode: AprResolvedProgressMode;
    trackedStage: AprTrackedStage;
    percent: number;
    displayStage: AprTrackedStage;
    displayLabel: string;
    sceneCount: number;
    targetSceneCount?: number;
    effectiveDenominator: number;
    stageBreakdown: AprStageBreakdown;
    dateRange?: {
        start?: string;
        target?: string;
        valid: boolean;
    };
}

const FULL_STAGE_WIDTH = 100 / STAGE_ORDER.length;

function normalizeTrackedStage(value: unknown, fallback: AprTrackedStage = 'Zero'): AprTrackedStage {
    return value === 'Zero' || value === 'Author' || value === 'House' || value === 'Press'
        ? value
        : fallback;
}

function normalizeMode(value: unknown): AprResolvedProgressMode {
    return value === 'date' || value === 'full' ? value : 'stage';
}

function normalizeTargetSceneCount(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.floor(value);
}

function isCompleted(status: TimelineItem['status']): boolean {
    return isCompleteStatus(status);
}

function normalizeStage(raw: unknown): AprTrackedStage {
    return normalizeTrackedStage(normalizePublishStage(raw));
}

export class AprProgressService {
    constructor(private plugin: RadialTimelinePlugin) {}

    public resolveProgress(
        scenes: TimelineItem[],
        settings: AuthorProgressDefaults = this.plugin.settings.authorProgress?.defaults ?? buildDefaultAuthorProgressDefaults()
    ): AprResolvedProgressState {
        const mode = normalizeMode(settings.aprProgressMode);
        const trackedStage = normalizeTrackedStage(settings.aprTrackedStage, 'Zero');
        const uniqueScenes = this.getUniqueScenes(scenes);
        const targetSceneCount = normalizeTargetSceneCount(settings.aprTargetSceneCount);
        const effectiveDenominator = Math.max(uniqueScenes.length, targetSceneCount ?? 0);
        const stageBreakdown = this.countStages(uniqueScenes);

        if (mode === 'date') {
            const percent = this.calculateDateProgress(settings.aprProgressDateStart, settings.aprProgressDateTarget) ?? 0;
            const displayStage = this.stageFromPercent(percent);
            return {
                mode,
                trackedStage,
                percent,
                displayStage,
                displayLabel: displayStage.toUpperCase(),
                sceneCount: uniqueScenes.length,
                targetSceneCount,
                effectiveDenominator,
                stageBreakdown,
                dateRange: {
                    start: settings.aprProgressDateStart,
                    target: settings.aprProgressDateTarget,
                    valid: this.calculateDateProgress(settings.aprProgressDateStart, settings.aprProgressDateTarget) !== null
                }
            };
        }

        if (mode === 'full') {
            const percent = this.calculateFullProgress(uniqueScenes, effectiveDenominator);
            const displayStage = this.stageFromPercent(percent);
            return {
                mode,
                trackedStage,
                percent,
                displayStage,
                displayLabel: displayStage.toUpperCase(),
                sceneCount: uniqueScenes.length,
                targetSceneCount,
                effectiveDenominator,
                stageBreakdown
            };
        }

        const percent = this.calculateTrackedStageProgress(uniqueScenes, trackedStage, effectiveDenominator);
        return {
            mode: 'stage',
            trackedStage,
            percent,
            displayStage: trackedStage,
            displayLabel: trackedStage.toUpperCase(),
            sceneCount: uniqueScenes.length,
            targetSceneCount,
            effectiveDenominator,
            stageBreakdown
        };
    }

    public getPercent(
        scenes: TimelineItem[],
        settings: AuthorProgressDefaults = this.plugin.settings.authorProgress?.defaults ?? buildDefaultAuthorProgressDefaults()
    ): number {
        return this.resolveProgress(scenes, settings).percent;
    }

    public getDisplayStageForPercent(percent: number): AprTrackedStage {
        return this.stageFromPercent(percent);
    }

    private countStages(scenes: TimelineItem[]): AprStageBreakdown {
        const breakdown: AprStageBreakdown = { Zero: 0, Author: 0, House: 0, Press: 0 };
        scenes.forEach(scene => {
            breakdown[normalizeStage(scene['Publish Stage'])] += 1;
        });
        return breakdown;
    }

    private getUniqueScenes(scenes: TimelineItem[]): TimelineItem[] {
        const seen = new Set<string>();
        const unique: TimelineItem[] = [];
        scenes.forEach((scene, index) => {
            if (isBeatNote(scene)) return;
            if (scene?.itemType && scene.itemType !== 'Scene') return;
            const key = scene.path?.trim() || `${scene.title ?? 'scene'}::${scene.number ?? ''}::${index}`;
            if (seen.has(key)) return;
            seen.add(key);
            unique.push(scene);
        });
        return unique;
    }

    private calculateTrackedStageProgress(scenes: TimelineItem[], trackedStage: AprTrackedStage, denominator: number): number {
        if (denominator <= 0) return 0;
        // Stage-focused: count only scenes currently at the tracked stage. No pass-through.
        const inStageCount = scenes.reduce((count, scene) => {
            return normalizeStage(scene['Publish Stage']) === trackedStage ? count + 1 : count;
        }, 0);
        return this.toPercent(inStageCount / denominator);
    }

    private calculateFullProgress(scenes: TimelineItem[], denominator: number): number {
        if (denominator <= 0) return 0;
        const totalUnits = scenes.reduce((sum, scene) => {
            const stageIndex = STAGE_ORDER.indexOf(normalizeStage(scene['Publish Stage']));
            const baseUnits = Math.max(0, stageIndex);
            const completionUnits = isCompleted(scene.status) ? 1 : 0;
            return sum + baseUnits + completionUnits;
        }, 0);
        const maxUnits = denominator * STAGE_ORDER.length;
        return this.toPercent(totalUnits / maxUnits);
    }

    private calculateDateProgress(start?: string, target?: string): number | null {
        if (!start || !target) return null;
        const parseIsoDate = (value: string): number | null => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
            const parsed = new Date(`${value}T00:00:00`);
            const time = parsed.getTime();
            return Number.isFinite(time) ? time : null;
        };

        const startMs = parseIsoDate(start);
        const targetMs = parseIsoDate(target);
        if (startMs === null || targetMs === null || targetMs < startMs) return null;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const now = today.getTime();

        if (targetMs === startMs) return now >= targetMs ? 100 : 0;
        if (now <= startMs) return 0;
        if (now >= targetMs) return 100;

        return this.toPercent((now - startMs) / (targetMs - startMs));
    }

    private stageFromPercent(percent: number): AprTrackedStage {
        if (percent >= FULL_STAGE_WIDTH * 3) return 'Press';
        if (percent >= FULL_STAGE_WIDTH * 2) return 'House';
        if (percent >= FULL_STAGE_WIDTH) return 'Author';
        return 'Zero';
    }

    private toPercent(fraction: number): number {
        return Math.min(100, Math.max(0, Math.round(fraction * 100)));
    }
}
