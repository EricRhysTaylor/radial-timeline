type MonthInfo = { name: string; shortName: string; angle: number };

import { renderMonthSpokesAndInnerLabels } from '../components/MonthSpokes';
import type { TimelineItem } from '../../types';
import { isNonSceneItem } from '../../utils/sceneHelpers';
import { getScenePrefixNumber } from '../../utils/text';

type CalendarSpokeOptions = {
    months: MonthInfo[];
    lineInnerRadius: number;
    monthTickEnd: number;
    currentMonthIndex: number;
    subplotOuterRadius: number;
    isChronologueMode: boolean;
    numActs: number;
    scenes?: TimelineItem[];
};

export type MonthlyCompletedData = {
    counts: number[];
    sceneNames: string[][];
};

/**
 * Calculate completed scene counts and names per month for the current year.
 * A scene counts if it has status "complete"/"done" AND a due date in that month of the current year.
 * Only counts actual scenes (not Beat/Plot/Backdrop), deduplicated by path.
 */
function calculateMonthlyCompletedData(scenes: TimelineItem[]): MonthlyCompletedData {
    const counts = new Array(12).fill(0);
    const sceneNames: string[][] = Array.from({ length: 12 }, () => []);
    const currentYear = new Date().getFullYear();
    const processedPaths = new Set<string>();

    scenes.forEach(scene => {
        // Skip Beat/Plot/Backdrop - only count actual scenes
        if (isNonSceneItem(scene)) return;

        // Skip scenes without a path, and deduplicate by path
        if (!scene.path || processedPaths.has(scene.path)) return;
        processedPaths.add(scene.path);

        // Check if completed
        let isComplete = false;
        if (scene.status) {
            const statusValue = Array.isArray(scene.status) && scene.status.length > 0
                ? String(scene.status[0]).trim().toLowerCase()
                : typeof scene.status === 'string'
                    ? scene.status.trim().toLowerCase()
                    : '';
            isComplete = statusValue === 'complete' || statusValue === 'done';
        }
        if (!isComplete) return;

        // Check due date is in current year
        const dueString = scene.due;
        if (!dueString || typeof dueString !== 'string') return;

        const parts = dueString.split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return;
        const [dueYear, dueMonth] = parts;

        if (dueYear !== currentYear) return;

        // dueMonth is 1-indexed, array is 0-indexed
        const monthIndex = dueMonth - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
            counts[monthIndex]++;
            // Get scene name with number prefix
            const baseTitle = scene.title?.replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim() || 'Untitled';
            const sceneNumber = getScenePrefixNumber(scene.title, scene.number);
            const name = sceneNumber ? `${sceneNumber}. ${baseTitle}` : baseTitle;
            sceneNames[monthIndex].push(name);
        }
    });

    return { counts, sceneNames };
}

export function renderCalendarSpokesLayer({
    months,
    lineInnerRadius,
    monthTickEnd,
    currentMonthIndex,
    subplotOuterRadius,
    isChronologueMode,
    numActs,
    scenes
}: CalendarSpokeOptions): string {
    const includeIntermediateSpokes = !isChronologueMode;
    const outerSpokeInnerRadius = isChronologueMode ? undefined : subplotOuterRadius;

    // Calculate monthly completed data if scenes provided
    const monthlyData = scenes ? calculateMonthlyCompletedData(scenes) : undefined;

    return renderMonthSpokesAndInnerLabels({
        months,
        lineInnerRadius,
        lineOuterRadius: monthTickEnd,
        currentMonthIndex,
        includeIntermediateSpokes,
        outerSpokeInnerRadius,
        numActs,
        monthlyCompletedCounts: monthlyData?.counts,
        monthlyCompletedSceneNames: monthlyData?.sceneNames
    });
}
