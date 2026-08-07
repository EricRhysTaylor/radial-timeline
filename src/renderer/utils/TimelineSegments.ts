import type { RadialTimelineSettings } from '../../types';
import { getConfiguredActCount, parseActLabels, resolveActLabel } from '../../utils/acts';
import { getSagaBooks, getTimelineScope } from '../../utils/books';

export type TimelineSegmentKind = 'act' | 'book';

export interface TimelineSegment {
    id: string;
    label: string;
    kind: TimelineSegmentKind;
    index: number;
    startAngle: number;
    endAngle: number;
}

/**
 * How many segments the wheel is divided into: one per book under saga scope,
 * one per act otherwise.
 *
 * Every ring, every angle and every act-bucket lookup divides by this number,
 * so it must be answered identically everywhere — three call sites used to
 * massage a passed-down count with their own floors, and disagreeing about it
 * is what put scenes in the wrong quadrant. Takes only the fields it needs, so
 * the renderer's narrow settings facade can ask too.
 */
export function getTimelineSegmentCount(
    settings: Pick<RadialTimelineSettings, 'timelineScope' | 'books' | 'actCount'>
): number {
    if (getTimelineScope(settings) === 'saga') {
        return Math.max(1, getSagaBooks(settings).length);
    }
    return getConfiguredActCount(settings);
}

export function buildTimelineSegments(settings: RadialTimelineSettings): TimelineSegment[] {
    const scope = getTimelineScope(settings);
    if (scope === 'saga') {
        const books = getSagaBooks(settings);
        return buildEqualSegments(
            books.map((book, index) => ({
                id: book.id,
                label: book.title,
                kind: 'book' as const,
                index
            }))
        );
    }

    const actCount = getTimelineSegmentCount(settings);
    const actLabels = parseActLabels(settings, actCount);
    return buildEqualSegments(
        Array.from({ length: actCount }, (_, index) => ({
            id: `act-${index + 1}`,
            label: resolveActLabel(index, actLabels),
            kind: 'act' as const,
            index
        }))
    );
}

function buildEqualSegments(
    items: Array<{ id: string; label: string; kind: TimelineSegmentKind; index: number }>
): TimelineSegment[] {
    const count = items.length;
    if (count === 0) return [];

    return items.map(item => {
        const startAngle = (item.index * 2 * Math.PI) / count - Math.PI / 2;
        const endAngle = ((item.index + 1) * 2 * Math.PI) / count - Math.PI / 2;
        return {
            ...item,
            startAngle,
            endAngle
        };
    });
}

export function getSegmentBoundaries(index: number, totalSegments: number): { start: number; end: number } {
    const count = Math.max(1, Math.floor(totalSegments));
    return {
        start: (index * 2 * Math.PI) / count - Math.PI / 2,
        end: ((index + 1) * 2 * Math.PI) / count - Math.PI / 2
    };
}

export function getRotationStepDegrees(segmentCount: number): number {
    return segmentCount > 0 ? 360 / segmentCount : 120;
}
