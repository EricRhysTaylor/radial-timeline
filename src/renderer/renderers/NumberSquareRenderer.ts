import type { TimelineItem } from '../../types';
import {
    isBeatNote,
    type PluginRendererFacade,
    sceneKey,
    extractGradeFromScene
} from '../../utils/sceneHelpers';
import { makeSceneId } from '../../utils/numberSquareHelpers';
import { buildOuterRingSequence } from '../utils/OuterRingSequence';
import { shouldRenderStoryBeats, shouldShowAllScenesInOuterRing } from '../modules/ModeRenderingHelpers';
import {
    renderOuterRingNumberSquares,
    renderInnerRingsNumberSquaresAllScenes,
    renderNumberSquaresStandard
} from '../components/NumberSquares';
import type { SceneNumberInfo } from '../../utils/constants';
import { getConfiguredActCount } from '../../utils/acts';
import { getTimelineScope } from '../../utils/books';

// Define the interface for the number square visual resolver logic
export type NumberSquareVisualResolver = (scene: TimelineItem) => { subplotIndex: number };

export interface NumberSquareRenderContext {
    plugin: PluginRendererFacade;
    scenes: TimelineItem[];
    scenesByActAndSubplot: Record<number, Record<string, TimelineItem[]>>;
    masterSubplotOrder: string[];
    ringStartRadii: number[];
    ringWidths: number[];
    sceneGrades: Map<string, string>;
    sceneNumbersMap: Map<string, SceneNumberInfo>;
    numberSquareVisualResolver: NumberSquareVisualResolver | null;
    shouldApplyNumberSquareColors: boolean;
    numActs: number;
}

export function renderNumberSquares(ctx: NumberSquareRenderContext): string {
    const {
        plugin,
        scenes,
        scenesByActAndSubplot,
        masterSubplotOrder,
        ringStartRadii,
        ringWidths,
        sceneGrades,
        sceneNumbersMap,
        numberSquareVisualResolver,
        shouldApplyNumberSquareColors,
        numActs
    } = ctx;

    let svg = '';
    const isSagaScope = getTimelineScope(plugin.settings) === 'saga';
    const NUM_RINGS = masterSubplotOrder.length;
    const totalActs = isSagaScope
        ? Math.max(1, numActs || 1)
        : Math.max(3, numActs || getConfiguredActCount(plugin.settings));

    if (shouldShowAllScenesInOuterRing(plugin)) {
        // In outer-ring-narrative mode, draw number squares for ALL rings

        svg += `<g class="rt-number-squares">`;

        // First, draw squares for the outer ring (all scenes combined)
        const ringOuter = NUM_RINGS - 1;
        const innerROuter = ringStartRadii[ringOuter];
        const outerROuter = innerROuter + ringWidths[ringOuter];
        const squareRadiusOuter = (innerROuter + outerROuter) / 2;

        // Determine number of acts to iterate based on sorting method
        const currentMode = plugin.settings.currentMode || 'narrative';
        const isChronologueMode = currentMode === 'chronologue';
        const sortByWhen = isChronologueMode ? true : (plugin.settings.sortByWhenDate ?? false);
        const actsToRender = sortByWhen ? 1 : totalActs;

        for (let act = 0; act < actsToRender; act++) {
            let startAngle: number;
            let endAngle: number;

            if (sortByWhen) {
                // When date mode: Full 360° circle
                startAngle = -Math.PI / 2;
                endAngle = (3 * Math.PI) / 2;
            } else {
                // Manuscript mode: divide full circle by configured acts
                startAngle = (act * 2 * Math.PI) / totalActs - Math.PI / 2;
                endAngle = ((act + 1) * 2 * Math.PI) / totalActs - Math.PI / 2;
            }

            // Same sequence the arcs were drawn from — see OuterRingSequence.
            const { items: sortedCombined, positions } = buildOuterRingSequence({
                scenes,
                segment: act,
                isSagaScope,
                sortByWhen,
                forceChronological: isChronologueMode,
                includeBeats: !isChronologueMode && shouldRenderStoryBeats(plugin),
                masterSubplotOrder,
                dominantSubplots: plugin.settings.dominantSubplots,
                innerR: innerROuter,
                outerR: outerROuter,
                startAngle,
                endAngle
            });

            if (plugin.settings.enableAiSceneAnalysis) {
                sortedCombined.forEach((sceneItem, combinedIdx) => {
                    if (isBeatNote(sceneItem)) return;
                    const combinedSceneId = makeSceneId(act, ringOuter, combinedIdx, true, true, sceneKey(sceneItem));
                    extractGradeFromScene(sceneItem, combinedSceneId, sceneGrades, plugin);
                });
            }

            // Draw squares for non-Plot scenes that have a number
            svg += renderOuterRingNumberSquares({
                plugin,
                act,
                ringOuter,
                squareRadiusOuter,
                positions,
                combined: sortedCombined,
                sceneGrades,
                enableSubplotColors: shouldApplyNumberSquareColors,
                resolveSubplotVisual: numberSquareVisualResolver || undefined
            });
        }

        // Then, draw squares for inner subplot rings (excluding Main Plot which is the outer ring)
        svg += renderInnerRingsNumberSquaresAllScenes({
            plugin,
            NUM_RINGS,
            masterSubplotOrder,
            ringStartRadii,
            ringWidths,
            scenesByActAndSubplot,
            scenes,
            sceneGrades,
            enableSubplotColors: shouldApplyNumberSquareColors,
            resolveSubplotVisual: numberSquareVisualResolver || undefined,
            numActs
        });

        svg += `</g>`;
    } else if (!shouldShowAllScenesInOuterRing(plugin)) {
        svg += renderNumberSquaresStandard({
            plugin,
            NUM_RINGS,
            masterSubplotOrder,
            ringStartRadii,
            ringWidths,
            scenesByActAndSubplot,
            scenes,
            sceneGrades,
            sceneNumbersMap,
            enableSubplotColors: shouldApplyNumberSquareColors,
            resolveSubplotVisual: numberSquareVisualResolver || undefined,
            numActs
        });
    }

    return svg;
}
