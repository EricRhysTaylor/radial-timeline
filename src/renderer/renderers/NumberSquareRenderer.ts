import type { TimelineItem } from '../../types';
import {
    isBeatNote,
    type PluginRendererFacade,
    sceneKey,
    usesWhenOrdering,
    extractGradeFromScene
} from '../../utils/sceneHelpers';
import { makeSceneId } from '../../utils/numberSquareHelpers';
import { buildOuterRingSequence } from '../utils/OuterRingSequence';
import { shouldRenderStoryBeats, shouldShowAllScenesInOuterRing, usesSequenceAlignment } from '../modules/ModeRenderingHelpers';
import type { PositionInfo } from '../utils/SceneLayout';
import {
    renderOuterRingNumberSquares,
    renderInnerRingsNumberSquaresAllScenes,
    renderNumberSquaresStandard
} from '../components/NumberSquares';
import type { SceneNumberInfo } from '../../utils/constants';
import { getTimelineScope } from '../../utils/books';
import { getTimelineSegmentCount } from '../utils/TimelineSegments';

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
        shouldApplyNumberSquareColors
    } = ctx;

    let svg = '';
    const isSagaScope = getTimelineScope(plugin.settings) === 'saga';
    const NUM_RINGS = masterSubplotOrder.length;
    const totalSegments = getTimelineSegmentCount(plugin.settings);

    if (shouldShowAllScenesInOuterRing(plugin)) {
        // In outer-ring-narrative mode, draw number squares for ALL rings

        svg += `<g class="rt-number-squares">`;

        // Sequence alignment: subplot squares follow their arcs to the outer
        // ring, so collect every segment's angles as the outer pass builds them.
        const isSequenceAlignment = usesSequenceAlignment(plugin);
        const outerPositionByKey = new Map<string, PositionInfo>();

        // First, draw squares for the outer ring (all scenes combined)
        const ringOuter = NUM_RINGS - 1;
        const innerROuter = ringStartRadii[ringOuter];
        const outerROuter = innerROuter + ringWidths[ringOuter];
        const squareRadiusOuter = (innerROuter + outerROuter) / 2;

        // Determine number of acts to iterate based on sorting method
        const isChronologueMode = (plugin.settings.currentMode || 'narrative') === 'chronologue';
        const sortByWhen = usesWhenOrdering(plugin.settings);
        const actsToRender = sortByWhen ? 1 : totalSegments;

        for (let act = 0; act < actsToRender; act++) {
            let startAngle: number;
            let endAngle: number;

            if (sortByWhen) {
                // When date mode: Full 360° circle
                startAngle = -Math.PI / 2;
                endAngle = (3 * Math.PI) / 2;
            } else {
                // Manuscript mode: divide full circle by configured acts
                startAngle = (act * 2 * Math.PI) / totalSegments - Math.PI / 2;
                endAngle = ((act + 1) * 2 * Math.PI) / totalSegments - Math.PI / 2;
            }

            // Same sequence the arcs were drawn from — see OuterRingSequence.
            const { items: sortedCombined, positions, positionByKey } = buildOuterRingSequence({
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

            if (isSequenceAlignment) {
                positionByKey.forEach((position, key) => outerPositionByKey.set(key, position));
            }

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
            outerPositionByKey: isSequenceAlignment ? outerPositionByKey : undefined
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
            resolveSubplotVisual: numberSquareVisualResolver || undefined
        });
    }

    return svg;
}
