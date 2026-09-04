import type { TimelineItem } from '../types';
import { isMatterNote, isSceneItem, sortScenes } from './sceneHelpers';

export const SHARED_CHAPTER_FIELD_KEY = 'Chapter';
export const SHARED_CHAPTER_FIELD_SOURCE_LABEL_TITLE = 'Chapter field on scene notes';
export interface TimelineChapterMarker {
    sourcePath?: string;
    sourceType: 'Scene';
    title: string;
    resolvedScenePath: string;
    resolvedTimelinePosition: number;
}

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[\s_-]/g, '');
}

export function readSharedChapterTitle(frontmatter?: Record<string, unknown>): string | undefined {
    if (!frontmatter) return undefined;

    for (const [key, value] of Object.entries(frontmatter)) {
        if (normalizeKey(key) !== 'chapter') continue;
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
}

export function resolveTimelineChapterMarkers(
    orderedItems: TimelineItem[]
): TimelineChapterMarker[] {
    const resolved: TimelineChapterMarker[] = [];
    let resolvedTimelinePosition = 0;

    for (const item of orderedItems) {
        if (!isSceneItem(item) || !item.path) continue;
        const chapterTitle = readSharedChapterTitle(item.rawFrontmatter);
        resolvedTimelinePosition += 1;

        if (chapterTitle) {
            resolved.push({
                sourcePath: item.path,
                sourceType: 'Scene',
                title: chapterTitle,
                resolvedScenePath: item.path,
                resolvedTimelinePosition,
            });
        }
    }

    return resolved;
}

export function groupTimelineChapterMarkersByScenePath(
    markers: TimelineChapterMarker[]
): Record<string, TimelineChapterMarker[]> {
    return markers.reduce<Record<string, TimelineChapterMarker[]>>((acc, marker) => {
        if (!acc[marker.resolvedScenePath]) {
            acc[marker.resolvedScenePath] = [];
        }
        acc[marker.resolvedScenePath].push(marker);
        return acc;
    }, {});
}

export function collapseTimelineChapterMarkersByResolvedBoundary(
    markers: TimelineChapterMarker[]
): TimelineChapterMarker[] {
    const lastMarkerByBoundary = new Map<string, TimelineChapterMarker>();

    markers.forEach((marker) => {
        const boundaryKey = `${marker.resolvedScenePath}::${marker.resolvedTimelinePosition}`;
        lastMarkerByBoundary.set(boundaryKey, marker);
    });

    return markers.filter((marker) => {
        const boundaryKey = `${marker.resolvedScenePath}::${marker.resolvedTimelinePosition}`;
        return lastMarkerByBoundary.get(boundaryKey) === marker;
    });
}

export function buildTimelineChapterResolverItems(items: TimelineItem[]): TimelineItem[] {
    const orderedItems: TimelineItem[] = [];
    const uniqueScenes = new Map<string, TimelineItem>();

    items.forEach((item) => {
        if (isMatterNote(item) || item.itemType === 'BookMeta') return;
        if (!isSceneItem(item)) return;
        const sceneKey = item.path || `${item.title || ''}::${String(item.when || '')}`;
        if (!uniqueScenes.has(sceneKey)) {
            uniqueScenes.set(sceneKey, item);
        }
    });

    uniqueScenes.forEach((scene) => {
        orderedItems.push(scene);
    });

    return sortScenes(orderedItems, false, false);
}
