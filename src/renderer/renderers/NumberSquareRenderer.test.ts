import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../../types';
import type { SceneNumberInfo } from '../../utils/constants';
import { createSearchState } from '../../services/searchState';
import { computeCacheableValues } from '../utils/Precompute';
import { renderNumberSquares } from './NumberSquareRenderer';

// Square width comes from glyphs measured in a live SVG; the Node test env has
// no DOM, and placement (what this file checks) does not depend on width.
vi.mock('../utils/FontMetricsCache', () => ({
    getNumberSquareWidthFromCache: (num: string) => num.length * 8,
}));

function makePlugin(settingsOverrides: Record<string, unknown> = {}) {
    return {
        settings: {
            currentMode: 'narrative',
            publishStageColors: { Zero: '#9900ff', Author: '#3366ff', House: '#33aa44', Press: '#ffaa00' },
            subplotColors: ['#eeeeee'],
            enableAiSceneAnalysis: false,
            actCount: 1,
            ...settingsOverrides,
        },
        searchState: createSearchState(),
        openScenePaths: new Set<string>(),
        desaturateColor: (hex: string) => hex,
        calculateCompletionEstimate: () => null,
    };
}

function scene(number: number, subplot: string): TimelineItem {
    return {
        title: `${number} Scene ${number}`,
        path: `Book/${number} Scene ${number}.md`,
        date: '',
        subplot,
        actNumber: 1,
    };
}

/** Every number square in the SVG, as its label and distance from the center. */
function readSquares(svg: string): Array<{ number: string; radius: number }> {
    const pattern = /<g class="number-square-group"[^>]*transform="translate\(([-\d.e]+), ([-\d.e]+)\)">[\s\S]*?>(\d+)<\/text>/g;
    return Array.from(svg.matchAll(pattern), m => ({
        number: m[3],
        radius: Math.hypot(Number(m[1]), Number(m[2])),
    }));
}

describe('renderNumberSquares — All Scenes outer ring', () => {
    // Regression: the inner-ring pass skipped only a subplot literally named
    // 'Main Plot'. When the busiest subplot had any other name it took the
    // outer ring (compareSubplotOrder) yet was still squared again at that
    // ring's radius with its own Fill spacing, interleaving duplicate numbers
    // ("16 2 17 4 18 6 …") around the all-scenes ring.
    const cases = [
        { outerSubplot: 'Main Plot', alignment: 'fill' },
        { outerSubplot: "Ulysses's Homecoming", alignment: 'fill' },
        { outerSubplot: "Ulysses's Homecoming", alignment: 'sequence' },
    ];

    it.each(cases)('squares each scene once on the outer ring when it is "$outerSubplot" ($alignment)', ({ outerSubplot, alignment }) => {
        const plugin = makePlugin({ subplotAlignment: alignment });
        const scenes = [
            scene(1, outerSubplot),
            scene(2, 'Voyage'),
            scene(3, outerSubplot),
            scene(4, 'Voyage'),
            scene(5, outerSubplot),
            scene(6, outerSubplot),
        ];

        const values = computeCacheableValues(plugin as never, scenes);
        expect(values.masterSubplotOrder).toEqual([outerSubplot, 'Voyage']);

        const svg = renderNumberSquares({
            plugin: plugin as never,
            scenes,
            scenesByActAndSubplot: values.scenesByActAndSubplot,
            masterSubplotOrder: values.masterSubplotOrder,
            ringStartRadii: values.ringStartRadii,
            ringWidths: values.ringWidths,
            sceneGrades: new Map<string, string>(),
            sceneNumbersMap: new Map<string, SceneNumberInfo>(),
            numberSquareVisualResolver: null,
            shouldApplyNumberSquareColors: false,
        });

        const outerRing = values.masterSubplotOrder.length - 1;
        const outerRadius = values.ringStartRadii[outerRing] + values.ringWidths[outerRing] / 2;
        const squares = readSquares(svg);
        const onOuterRing = squares
            .filter(s => Math.abs(s.radius - outerRadius) < 0.5)
            .map(s => s.number)
            .sort((a, b) => Number(a) - Number(b));

        expect(onOuterRing).toEqual(['1', '2', '3', '4', '5', '6']);
        // Outer-subplot scenes live only on the outer ring; the other
        // subplot's scenes are squared there and again on their own ring.
        expect(squares).toHaveLength(scenes.length + 2);
    });
});
