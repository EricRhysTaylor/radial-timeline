import type { TimelineItem } from '../../types';
import { formatNumber, escapeXml } from '../../utils/svg';
import { parseSceneTitle } from '../../utils/text';
import {
    isBeatNote,
    type PluginRendererFacade,
    sceneKey,
    sortScenes
} from '../../utils/sceneHelpers';
import { makeSceneId } from '../../utils/numberSquareHelpers';
import {
    TEXTPATH_START_NUDGE_RAD,
    BEAT_TEXT_RADIUS,
    BEAT_FONT_PX,
    ESTIMATE_FUDGE_RENDER,
    PADDING_RENDER_PX,
    SCENE_TITLE_INSET
} from '../layout/LayoutConstants';
import { alignPositionsToOuterRing, computePositions, computeVoidSpans, type PositionInfo } from '../utils/SceneLayout';
import { buildOuterRingSequence } from '../utils/OuterRingSequence';
import { getFillForScene } from '../utils/SceneFill';
import { estimatePixelsFromTitle } from '../utils/LabelMetrics';
import { sceneArcPath, renderVoidCellPath } from '../components/SceneArcs';
import { renderSceneGroup } from '../components/Scenes';
import { shouldRenderStoryBeats, shouldShowAllScenesInOuterRing, usesSequenceAlignment } from '../modules/ModeRenderingHelpers';
import { appendSynopsisElementForScene } from '../utils/SynopsisBuilder';
import type { StageColorMap } from '../utils/Gossamer';
import { getReadabilityMultiplier } from '../../utils/readability';
import type { OuterRingChapterBoundaryGeometry } from '../components/ChapterMarkers';
import { getTimelineScope } from '../../utils/books';

export interface RingRenderContext {
    plugin: PluginRendererFacade;
    scenes: TimelineItem[];
    actsToRender: number;
    sortByWhen: boolean;
    isChronologueMode: boolean;
    forceChronological: boolean;
    masterSubplotOrder: string[];
    colorIndexBySubplot: Map<string, number>;
    ringStartRadii: number[];
    ringWidths: number[];
    scenesByActAndSubplot: Record<number, Record<string, TimelineItem[]>>;
    PUBLISH_STAGE_COLORS: StageColorMap;
    maxTextWidth: number;
    synopsesElements: SVGGElement[];
    /**
     * Filled by this renderer: where each scene sits on the all-scenes outer
     * ring. Chronologue's duration and backbone arcs read it afterwards.
     */
    outerRingPositionByKey?: Map<string, PositionInfo>;
    outerRingChapterBoundaryGeometry?: Map<string, OuterRingChapterBoundaryGeometry>;
    maxStageColor?: string; // Shared project stage color for Gossamer beat strokes.
}

export function renderRings(ctx: RingRenderContext): string {
    const {
        plugin,
        scenes,
        actsToRender,
        sortByWhen,
        isChronologueMode,
        forceChronological,
        masterSubplotOrder,
        colorIndexBySubplot,
        ringStartRadii,
        ringWidths,
        scenesByActAndSubplot,
        PUBLISH_STAGE_COLORS,
        maxTextWidth,
        synopsesElements,
        outerRingPositionByKey,
        outerRingChapterBoundaryGeometry
    } = ctx;

    let svg = '';
    const fontScale = getReadabilityMultiplier(plugin.settings);
    const NUM_RINGS = masterSubplotOrder.length;
    const readabilityScale = plugin.settings.readabilityScale || 'normal';
    // Use the value from constant, handling the structure
    const beatTextRadius = BEAT_TEXT_RADIUS[readabilityScale] || BEAT_TEXT_RADIUS.normal;

    const resolveSubplotColorIndex = (subplotName: string): number => {
        const key = subplotName && subplotName.trim().length > 0 ? subplotName : 'Main Plot';
        if (colorIndexBySubplot.has(key)) return colorIndexBySubplot.get(key)!;
        const fallback = colorIndexBySubplot.get('Main Plot');
        return fallback !== undefined ? fallback : 0;
    };

    // Helper for subplot color check
    const subplotColorFor = (subplotName: string) => {
        const normalized = resolveSubplotColorIndex(subplotName) % 16;
        const varName = `--rt-subplot-colors-${normalized}`;
        // Note: getComputedStyle is DOM-dependent, might not be ideal in all contexts but keeping extracted logic same
        try {
            // In node env or non-browser this might fail or return empty.
            // Assuming this runs in browser context where document exists.
            const computed = getComputedStyle(activeDocument.documentElement).getPropertyValue(varName).trim();
            return computed || '#EFBDEB';
        } catch {
            return '#EFBDEB';
        }
    };

    // Check if we need to force subplot fill colors
    const currentMode = plugin.settings.currentMode || 'narrative';
    const forceSubplotFillColors = currentMode === 'narrative' || currentMode === 'chronologue';
    const isSagaScope = getTimelineScope(plugin.settings) === 'saga';
    const isSequenceAlignment = usesSequenceAlignment(plugin);

    // Loop through Acts
    for (let act = 0; act < actsToRender; act++) {
        // Populated by this act's outer ring (drawn first, at ringOffset 0) and
        // read by its subplot rings. Stays undefined when there is no
        // all-scenes outer ring to align against.
        let outerPositionByKey: Map<string, PositionInfo> | undefined;
        const totalRings = NUM_RINGS;
        const subplotCount = masterSubplotOrder.length;
        const ringsToUse = Math.min(subplotCount, totalRings);
        const maxRingOffset = ringsToUse;
        
        for (let ringOffset = 0; ringOffset < maxRingOffset; ringOffset++) {
            const ring = totalRings - ringOffset - 1; // Start from outermost

            const innerR = ringStartRadii[ring];
            const outerR = innerR + ringWidths[ring];

            // Calculate angles
            let startAngle: number;
            let endAngle: number;

            if (sortByWhen) {
                startAngle = -Math.PI / 2;
                endAngle = (3 * Math.PI) / 2;
            } else {
                // Manuscript mode: divide full circle by configured acts
                startAngle = (act * 2 * Math.PI) / actsToRender - Math.PI / 2;
                endAngle = ((act + 1) * 2 * Math.PI) / actsToRender - Math.PI / 2;
            }

            const subplot = masterSubplotOrder[ringOffset];
            if (subplot === 'Backdrop' || subplot === 'MicroBackdrop') continue; // SKIP VIRTUAL BACKDROP SUBPLOTS

            const isOuterRing = ringOffset === 0;

            // --- Outer Ring Special Handling ---
            if (isOuterRing && shouldShowAllScenesInOuterRing(plugin)) {
                const sequence = buildOuterRingSequence({
                    scenes,
                    segment: act,
                    isSagaScope,
                    sortByWhen,
                    forceChronological,
                    includeBeats: !isChronologueMode && shouldRenderStoryBeats(plugin),
                    masterSubplotOrder,
                    dominantSubplots: plugin.settings.dominantSubplots,
                    innerR,
                    outerR,
                    startAngle,
                    endAngle
                });
                const { items: sortedCombined, positions } = sequence;
                outerPositionByKey = sequence.positionByKey;

                // A stored preference that matches no candidate is stale — drop it.
                const dominantSubplots = plugin.settings.dominantSubplots;
                if (dominantSubplots) {
                    sequence.staleDominantPaths.forEach(path => { delete dominantSubplots[path]; });
                }

                // Publish this act's outer-ring angles for later passes
                // (Chronologue's duration and backbone arcs).
                if (outerRingPositionByKey) {
                    sequence.positionByKey.forEach((position, key) => outerRingPositionByKey.set(key, position));
                }

                // Render
                let ringScenesSvg = '';
                sortedCombined.forEach((scene, idx) => {
                    const { text } = parseSceneTitle(scene.title || '', scene.number);
                    const position = positions.get(idx)!;
                    const sceneStartAngle = position.startAngle;
                    const sceneEndAngle = position.endAngle;

                    const effectiveOuterR = isBeatNote(scene) ? (outerR + 2) : outerR;

                    // Capture beat angles for Gossamer
                    if (isBeatNote(scene) && scene.title) {
                        const titleWithoutNumber = scene.title.replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim();
                        const center = (sceneStartAngle + sceneEndAngle) / 2;
                        plugin._beatAngles?.set(titleWithoutNumber, center);
                        if (!plugin._beatSlices) plugin._beatSlices = new Map();
                        plugin._beatSlices.set(titleWithoutNumber, {
                            startAngle: sceneStartAngle,
                            endAngle: sceneEndAngle,
                            innerR: innerR,
                            outerR: effectiveOuterR
                        });
                    }

                    const sceneTitleInset = SCENE_TITLE_INSET + ((fontScale - 1) * 18);
                    const textPathRadius = Math.max(innerR, outerR - sceneTitleInset);
                    const textPathLargeArcFlag = (sceneEndAngle - (sceneStartAngle + TEXTPATH_START_NUDGE_RAD)) > Math.PI ? 1 : 0;

                    const color = getFillForScene(scene, PUBLISH_STAGE_COLORS, subplotColorFor, true, forceSubplotFillColors);
                    const arcPathStr = sceneArcPath(innerR, effectiveOuterR, sceneStartAngle, sceneEndAngle);
                    const sceneUniqueKey = sceneKey(scene);
                    const sceneId = makeSceneId(act, ring, idx, true, true, sceneUniqueKey);

                    if (!isBeatNote(scene) && scene.path) {
                        outerRingChapterBoundaryGeometry?.set(scene.path, {
                            startAngle: sceneStartAngle,
                            outerR: effectiveOuterR
                        });
                    }

                    appendSynopsisElementForScene({
                        plugin,
                        scene,
                        sceneId,
                        maxTextWidth,
                        masterSubplotOrder,
                        scenes,
                        targets: synopsesElements
                    });

                    let sceneClasses = 'rt-scene-path';
                    if (scene.path && plugin.openScenePaths.has(scene.path)) sceneClasses += ' rt-scene-is-open';
                    const dyOffset = 0;

                    // Beat title estimation
                    const rawTitleFull = (() => {
                        const full = scene.title || '';
                        const m = full.match(/^(?:\s*\d+(?:\.\d+)?\s+)?(.+)/);
                        return m ? m[1] : full;
                    })();

                    const estimatedWidth = estimatePixelsFromTitle(
                        rawTitleFull,
                        BEAT_FONT_PX * fontScale,
                        ESTIMATE_FUDGE_RENDER,
                        PADDING_RENDER_PX * fontScale
                    );
                    const labelStartAngle = sceneStartAngle;
                    const labelEndAngle = sceneStartAngle + (estimatedWidth / beatTextRadius);
                    const desiredAngleArc = labelEndAngle - labelStartAngle;
                    const largeArcFlag = desiredAngleArc > Math.PI ? 1 : 0;

                    const subplotIdxAttr = (() => {
                        const name = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
                        return Math.max(0, masterSubplotOrder.indexOf(name));
                    })();
                    const subplotColorIdxAttr = resolveSubplotColorIndex(scene.subplot || 'Main Plot');

                    const plotStrokeAttr = (() => {
                        if (isBeatNote(scene)) {
                            // In Gossamer mode, use the same project stage color as the rest of the timeline.
                            const isGossamerMode = currentMode === 'gossamer';
                            if (isGossamerMode && ctx.maxStageColor) {
                                return `stroke="${ctx.maxStageColor}" stroke-width="2"`;
                            }
                            // Otherwise use the beat's own publish stage
                            const publishStage = scene['Publish Stage'] || 'Zero';
                            const stageColor = PUBLISH_STAGE_COLORS[publishStage] || PUBLISH_STAGE_COLORS.Zero;
                            return `stroke="${stageColor}" stroke-width="2"`;
                        }
                        return '';
                    })();

                    ringScenesSvg += `
                        ${renderSceneGroup({
                            scene,
                            act,
                            ring,
                            idx,
                            innerR,
                            outerR: effectiveOuterR,
                            startAngle: sceneStartAngle,
                            endAngle: sceneEndAngle,
                            subplotIdxAttr,
                            subplotColorIdxAttr,
                            titleInset: sceneTitleInset
                        })}
                            <path id="${sceneId}"
                                  d="${arcPathStr}" 
                                  fill="${color}" 
                                  ${plotStrokeAttr}
                                  class="${sceneClasses}"/>
                            ${!isBeatNote(scene) ? `
                            <path id="textPath-${act}-${ring}-outer-${idx}" 
                                  d="M ${formatNumber(textPathRadius * Math.cos(sceneStartAngle + TEXTPATH_START_NUDGE_RAD))} ${formatNumber(textPathRadius * Math.sin(sceneStartAngle + TEXTPATH_START_NUDGE_RAD))} 
                                     A ${formatNumber(textPathRadius)} ${formatNumber(textPathRadius)} 0 ${textPathLargeArcFlag} 1 ${formatNumber(textPathRadius * Math.cos(sceneEndAngle))} ${formatNumber(textPathRadius * Math.sin(sceneEndAngle))}" 
                                  fill="none"/>
                            <clipPath id="clip-${sceneId}"><use href="#${sceneId}"/></clipPath>
                            <text class="rt-scene-title${scene.path && plugin.openScenePaths.has(scene.path) ? ' rt-scene-is-open' : ''}" clip-path="url(#clip-${sceneId})" dy="${dyOffset}" data-scene-id="${sceneId}">
                                <textPath href="#textPath-${act}-${ring}-outer-${idx}" startOffset="4">
                                    ${text}
                                </textPath>
                            </text>` : isBeatNote(scene) ? `
                            <path id="plot-label-arc-${act}-${ring}-outer-${idx}" 
                                  d="M ${formatNumber(beatTextRadius * Math.cos(labelStartAngle))} ${formatNumber(beatTextRadius * Math.sin(labelStartAngle))} 
                                     A ${formatNumber(beatTextRadius)} ${formatNumber(beatTextRadius)} 0 ${largeArcFlag} 1 ${formatNumber(beatTextRadius * Math.cos(labelEndAngle))} ${formatNumber(beatTextRadius * Math.sin(labelEndAngle))}" 
                                  data-slice-start="${formatNumber(sceneStartAngle)}" data-radius="${formatNumber(beatTextRadius)}" fill="none"/>
                            <text class="rt-storybeat-title" dy="-3">
                                <textPath href="#plot-label-arc-${act}-${ring}-outer-${idx}" startOffset="2">
                                    ${escapeXml(rawTitleFull)}
                                </textPath>
                            </text>
                            ` : ``}
                        </g>`;
                });

                // Void cells are emitted before the ring's scenes so a scene that
                // grows on hover (Sequence expands into its gap) is not buried
                // under the void fill — SVG paints later siblings on top. Note
                // this order is why scene titles carry an explicit clip: with
                // voids on top they used to mask overflowing titles by accident.
                computeVoidSpans(positions.values(), startAngle, endAngle).forEach(span => {
                    svg += renderVoidCellPath(innerR, outerR, span.startAngle, span.endAngle, {
                        act,
                        ring,
                        isOuterRing: true
                    });
                });
                svg += ringScenesSvg;

                continue; // Continue to next ring loop (which iterates rings for this act)
            }

            // --- Inner Rings (or Outer when toggle off) ---
            const currentScenes = subplot ? (scenesByActAndSubplot[act][subplot] || []) : [];

            if (currentScenes && currentScenes.length > 0) {
                const sortedCurrentScenes = sortScenes(currentScenes, sortByWhen, forceChronological);

                const isAllScenesMode = shouldShowAllScenesInOuterRing(plugin);
                const effectiveScenes = sortedCurrentScenes.filter(scene => !isBeatNote(scene));

                // Sequence: each scene sits at its outer-ring angle, leaving real
                // gaps where this subplot is absent. Fill: spread across the segment.
                const isAlignedRing = isSequenceAlignment && outerPositionByKey !== undefined;
                const scenePositions = (isAlignedRing && outerPositionByKey)
                    ? alignPositionsToOuterRing(effectiveScenes, outerPositionByKey)
                    : computePositions(innerR, outerR, startAngle, endAngle, effectiveScenes);

                let ringScenesSvg = '';
                effectiveScenes.forEach((scene, idx) => {
                    const { text } = parseSceneTitle(scene.title || '', scene.number);
                    const position = scenePositions.get(idx);
                    if (!position) return;

                    const sceneStartAngle = position.startAngle;
                    const sceneEndAngle = position.endAngle;
                    const sceneTitleInset = SCENE_TITLE_INSET + ((fontScale - 1) * 18);
                    const textPathRadius = Math.max(innerR, outerR - sceneTitleInset);
                    const textPathLargeArcFlag = (sceneEndAngle - (sceneStartAngle + TEXTPATH_START_NUDGE_RAD)) > Math.PI ? 1 : 0;

                    const color = getFillForScene(
                        scene,
                        PUBLISH_STAGE_COLORS,
                        subplotColorFor,
                        isAllScenesMode,
                        forceSubplotFillColors
                    );

                    const arcPathStr = sceneArcPath(innerR, outerR, sceneStartAngle, sceneEndAngle);
                    const sceneUniqueKey = sceneKey(scene);
                    const sceneId = makeSceneId(act, ring, idx, false, false, sceneUniqueKey);

                    const subplotIdxAttr = (() => {
                        const name = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
                        return Math.max(0, masterSubplotOrder.indexOf(name));
                    })();
                    const subplotColorIdxAttr = resolveSubplotColorIndex(scene.subplot || 'Main Plot');

                    let sceneClasses = "rt-scene-path rt-scene-arc";
                    if (scene.path && plugin.openScenePaths.has(scene.path)) sceneClasses += " rt-scene-is-open";


                    ringScenesSvg += `
                        ${renderSceneGroup({
                            scene,
                            act,
                            ring,
                            idx,
                            innerR,
                            outerR,
                            startAngle: sceneStartAngle,
                            endAngle: sceneEndAngle,
                            subplotIdxAttr,
                            subplotColorIdxAttr,
                            titleInset: sceneTitleInset,
                            aligned: isAlignedRing
                        })}
                            <path id="${sceneId}"
                                  d="${arcPathStr}" 
                                  fill="${color}" 
                                  class="${sceneClasses}"/>

                            ${!isBeatNote(scene) ? `
                            <path id="textPath-${act}-${ring}-${idx}" 
                                  d="M ${formatNumber(textPathRadius * Math.cos(sceneStartAngle + TEXTPATH_START_NUDGE_RAD))} ${formatNumber(textPathRadius * Math.sin(sceneStartAngle + TEXTPATH_START_NUDGE_RAD))} 
                                     A ${formatNumber(textPathRadius)} ${formatNumber(textPathRadius)} 0 ${textPathLargeArcFlag} 1 ${formatNumber(textPathRadius * Math.cos(sceneEndAngle))} ${formatNumber(textPathRadius * Math.sin(sceneEndAngle))}" 
                                  fill="none"/>
                            <clipPath id="clip-${sceneId}"><use href="#${sceneId}"/></clipPath>
                            <text class="rt-scene-title${scene.path && plugin.openScenePaths.has(scene.path) ? ' rt-scene-is-open' : ''}" clip-path="url(#clip-${sceneId})" data-scene-id="${sceneId}">
                                <textPath href="#textPath-${act}-${ring}-${idx}" startOffset="4">
                                    ${text}
                                </textPath>
                            </text>` : ``}
                        </g>`;
                });

                // Void cells are emitted before the ring's scenes so a scene that
                // grows on hover (Sequence expands into its gap) is not buried
                // under the void fill — SVG paints later siblings on top. Note
                // this order is why scene titles carry an explicit clip: with
                // voids on top they used to mask overflowing titles by accident.
                computeVoidSpans(scenePositions.values(), startAngle, endAngle).forEach(span => {
                    svg += renderVoidCellPath(innerR, outerR, span.startAngle, span.endAngle, {
                        act,
                        ring,
                        isOuterRing: isOuterRing
                    });
                });
                svg += ringScenesSvg;
            } else {
                // No scenes, render empty void ring
                svg += renderVoidCellPath(innerR, outerR, startAngle, endAngle, {
                    act,
                    ring,
                    isOuterRing: isOuterRing
                });
            }
        }
    }

    return svg;
}
