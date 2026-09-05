import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import type { RadialTimelineSettings } from '../../types';
import { buildTimelineSegments } from './TimelineSegments';
import { getRotationStepDegrees } from '../../view/interactions/RotationController';
import { getSegmentBoundaries, redistributeAngles, type SceneAngleData } from '../../view/interactions/SceneTitleExpansion';

describe('timeline segments', () => {
    function settingsForBooks(count: number): RadialTimelineSettings {
        return {
            ...DEFAULT_SETTINGS,
            timelineScope: 'saga',
            books: Array.from({ length: count }, (_, index) => ({
                id: `b${index + 1}`,
                title: `Book ${index + 1}`,
                sourceFolder: `Books/${index + 1}`
            }))
        };
    }

    it('builds equal saga sectors for two, three, and four books', () => {
        const expectedWidths = [
            [2, Math.PI],
            [3, (2 * Math.PI) / 3],
            [4, Math.PI / 2]
        ] as const;

        expectedWidths.forEach(([count, width]) => {
            const segments = buildTimelineSegments(settingsForBooks(count));
            expect(segments).toHaveLength(count);
            segments.forEach(segment => {
                expect(segment.kind).toBe('book');
                expect(segment.endAngle - segment.startAngle).toBeCloseTo(width, 8);
            });
        });
    });

    it('uses saga book count for rotation step', () => {
        expect(getRotationStepDegrees(2)).toBe(180);
        expect(getRotationStepDegrees(3)).toBe(120);
        expect(getRotationStepDegrees(4)).toBe(90);
    });

    it('keeps hover title expansion inside one book sector', () => {
        const bounds = getSegmentBoundaries(1, 2);
        const span = bounds.end - bounds.start;
        const elements: SceneAngleData[] = [
            {
                id: 'a',
                startAngle: bounds.start,
                endAngle: bounds.start + span / 3,
                innerRadius: 100,
                outerRadius: 120,
                isScene: true
            },
            {
                id: 'b',
                startAngle: bounds.start + span / 3,
                endAngle: bounds.start + (2 * span) / 3,
                innerRadius: 100,
                outerRadius: 120,
                isScene: true
            },
            {
                id: 'c',
                startAngle: bounds.start + (2 * span) / 3,
                endAngle: bounds.end,
                innerRadius: 100,
                outerRadius: 120,
                isScene: true
            }
        ];

        const redistributed = redistributeAngles(elements, 'b', span / 2, bounds.start, bounds.end);
        expect(redistributed[0].newStartAngle).toBeCloseTo(bounds.start, 8);
        expect(redistributed[redistributed.length - 1].newEndAngle).toBeCloseTo(bounds.end, 8);
        redistributed.forEach(result => {
            expect(result.newStartAngle).toBeGreaterThanOrEqual(bounds.start);
            expect(result.newEndAngle).toBeLessThanOrEqual(bounds.end);
        });
    });
});
