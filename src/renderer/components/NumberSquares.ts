import type { TimelineItem } from '../../types';
import { formatNumber } from '../../utils/svg';
import { getSceneState, buildSquareClasses, buildTextClasses, extractGradeFromScene, isBeatNote, type PluginRendererFacade, sceneKey, shouldDisplayMissingWhenWarning, usesWhenOrdering } from '../../utils/sceneHelpers';
import { getScenePrefixNumber, getNumberSquareSize } from '../../utils/text';
import { getReadabilityMultiplier } from '../../utils/readability';
import { generateNumberSquareGroup, makeSceneId } from '../../utils/numberSquareHelpers';
import { getTimelineScope } from '../../utils/books';

interface SubplotRingPlacement {
  ring: number;
  segment: number;
  sceneIndex: number;
  startAngle: number;
  radius: number;
}

/**
 * Where a scene's number square sits on its subplot ring.
 *
 * Both number-square passes (standard mode, and the inner rings under All
 * Scenes mode) place squares the same way; this is that placement, once.
 * Returns null when the scene has no place on a ring — a square drawn at a
 * derived-but-wrong angle is worse than no square.
 */
function resolveSubplotRingPlacement(params: {
  scene: TimelineItem;
  masterSubplotOrder: string[];
  NUM_RINGS: number;
  ringStartRadii: number[];
  ringWidths: number[];
  scenesByActAndSubplot: Record<number, Record<string, TimelineItem[]>>;
  sortByWhen: boolean;
  isSagaScope: boolean;
  totalSegments: number;
}): SubplotRingPlacement | null {
  const {
    scene, masterSubplotOrder, NUM_RINGS, ringStartRadii, ringWidths,
    scenesByActAndSubplot, sortByWhen, isSagaScope, totalSegments
  } = params;

  const subplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
  const subplotIndex = masterSubplotOrder.indexOf(subplot);
  if (subplotIndex === -1) return null;
  const ring = NUM_RINGS - 1 - subplotIndex;
  if (ring < 0 || ring >= NUM_RINGS) return null;

  // When date sorting collapses every scene into one full-circle segment.
  const rawSegment = sortByWhen
    ? 0
    : (isSagaScope
      ? (typeof scene.bookIndex === 'number' ? scene.bookIndex : 0)
      : ((scene.actNumber !== undefined ? scene.actNumber : 1) - 1));
  // Clamp to the nearest valid segment so this lookup agrees with how
  // Precompute.ts bucketed the scene — an unclamped index misses the scene
  // entirely and re-derives a wrapped-around angle.
  const segment = Math.min(Math.max(rawSegment, 0), totalSegments - 1);

  const ringScenes = ((scenesByActAndSubplot[segment] && scenesByActAndSubplot[segment][subplot]) || [])
    .filter(s => !isBeatNote(s));
  // Match by canonical key, not object identity: the scene handed to this
  // function is often a different instance than the one in the bucket.
  const key = sceneKey(scene);
  const sceneIndex = ringScenes.findIndex(s => sceneKey(s) === key);
  if (sceneIndex === -1) return null;

  const segmentSpan = sortByWhen ? 2 * Math.PI : (2 * Math.PI) / totalSegments;
  const segmentStart = sortByWhen ? -Math.PI / 2 : (segment * 2 * Math.PI) / totalSegments - Math.PI / 2;
  const sceneAngularSize = segmentSpan / ringScenes.length;
  const innerR = ringStartRadii[ring];

  return {
    ring,
    segment,
    sceneIndex,
    startAngle: segmentStart + (sceneIndex * sceneAngularSize),
    radius: innerR + (ringWidths[ring] / 2)
  };
}

/**
 * Unified number square rendering function
 * Handles both All Scenes mode (with pre-calculated positions) and Main Plot mode (with on-the-fly calculation)
 */
export function renderNumberSquaresUnified(params: {
  plugin: PluginRendererFacade;
  scenes: TimelineItem[];
  sceneGrades: Map<string, string>;
  // For All Scenes mode (outer ring)
  positions?: Map<number, { startAngle: number; endAngle: number }>;
  squareRadius?: number;
  act?: number;
  ringOuter?: number;
  // For Main Plot mode (standard)
  NUM_RINGS?: number;
  masterSubplotOrder?: string[];
  ringStartRadii?: number[];
  ringWidths?: number[];
  scenesByActAndSubplot?: Record<number, Record<string, TimelineItem[]>>;
  sceneNumbersMap?: Map<string, { number: string; x: number; y: number; width: number; height: number }>;
  enableSubplotColors?: boolean;
  resolveSubplotVisual?: (scene: TimelineItem) => { subplotIndex: number } | null;
  numActs?: number;
}): string {
  const {
    plugin,
    scenes,
    sceneGrades,
    positions,
    squareRadius,
    act,
    ringOuter,
    NUM_RINGS,
    masterSubplotOrder,
    ringStartRadii,
    ringWidths,
    scenesByActAndSubplot,
    sceneNumbersMap,
    enableSubplotColors = false,
    resolveSubplotVisual,
    numActs
  } = params;

  let svg = '<g class="rt-number-squares">';
  const readabilityScale = getReadabilityMultiplier(plugin.settings);
  const squareScale = readabilityScale > 1 ? 1 + (readabilityScale - 1) * 0.75 : 1; // pad more aggressively when font grows
  const isSagaScope = getTimelineScope(plugin.settings) === 'saga';
  const totalActs = isSagaScope ? Math.max(1, numActs ?? 1) : Math.max(3, numActs ?? 3);

  scenes.forEach((scene, idx) => {
    if (isBeatNote(scene) || scene.itemType === 'Backdrop') return;

    const number = getScenePrefixNumber(scene.title, scene.number);
    if (!number) return;

    let sceneStartAngle: number;
    let textPathRadius: number;
    let sceneId: string;

    const uniqueKey = sceneKey(scene);

    let posForOuter: { startAngle: number; endAngle: number } | undefined;

    if (positions && squareRadius !== undefined && act !== undefined && ringOuter !== undefined) {
      // All Scenes mode: use pre-calculated positions
      const pos = positions.get(idx);
      if (!pos) return;
      sceneStartAngle = pos.startAngle;
      textPathRadius = squareRadius;
      sceneId = makeSceneId(act, ringOuter, idx, true, true, uniqueKey);
      posForOuter = pos;
    } else if (NUM_RINGS && masterSubplotOrder && ringStartRadii && ringWidths && scenesByActAndSubplot) {
      // Main Plot mode: derive the placement from the subplot ring
      const placement = resolveSubplotRingPlacement({
        scene,
        masterSubplotOrder,
        NUM_RINGS,
        ringStartRadii,
        ringWidths,
        scenesByActAndSubplot,
        sortByWhen: usesWhenOrdering(plugin.settings),
        isSagaScope,
        totalSegments: totalActs
      });
      if (!placement) return;
      sceneStartAngle = placement.startAngle;
      textPathRadius = placement.radius;
      sceneId = makeSceneId(placement.segment, placement.ring, placement.sceneIndex, false, false, uniqueKey);
    } else {
      return; // Invalid parameters
    }

    const squareSize = getNumberSquareSize(number, squareScale);
    const squareX = textPathRadius * Math.cos(sceneStartAngle);
    const squareY = textPathRadius * Math.sin(sceneStartAngle);

    const { isSceneOpen, isSearchMatch, hasEdits } = getSceneState(scene, plugin);
    let squareClasses = buildSquareClasses(isSceneOpen, isSearchMatch, hasEdits);
    let textClasses = buildTextClasses(isSceneOpen, isSearchMatch, hasEdits);

    const grade = sceneGrades.get(sceneId);
    if (plugin.settings.enableAiSceneAnalysis && grade) {
      textClasses += ` rt-grade-${grade}`;
    }

    if (shouldDisplayMissingWhenWarning(scene)) {
      squareClasses += ' rt-missing-when';
      textClasses += ' rt-missing-when';
    }

    // Store in sceneNumbersMap if provided (Main Plot mode)
    if (sceneNumbersMap) {
      sceneNumbersMap.set(sceneId, { number, x: squareX, y: squareY, width: squareSize.width, height: squareSize.height });
    }

    const subplotVisual = enableSubplotColors && resolveSubplotVisual ? resolveSubplotVisual(scene) : null;

    const baseDataAttrs = subplotVisual
      ? {
        'data-subplot-color-index': subplotVisual.subplotIndex,
        'data-subplot-index': subplotVisual.subplotIndex
      }
      : undefined;

    const dataAttrs = posForOuter
      ? {
        ...baseDataAttrs,
        'data-outer-ring': 'true',
        'data-scene-order': idx,
        'data-act': act,
        'data-ring': ringOuter,
        'data-start-angle': formatNumber(posForOuter.startAngle),
        'data-end-angle': formatNumber(posForOuter.endAngle)
      }
      : baseDataAttrs;

    svg += generateNumberSquareGroup(
      squareX,
      squareY,
      squareSize,
      squareClasses,
      sceneId,
      number,
      textClasses,
      grade,
      {
        cornerRadius: 4,
        subplotIndex: subplotVisual?.subplotIndex,
        dataAttrs
      }
    );
  });

  svg += '</g>';
  return svg;
}

// Legacy functions - now just wrappers around the unified function
export function renderOuterRingNumberSquares(params: {
  plugin: PluginRendererFacade;
  act: number;
  ringOuter: number;
  squareRadiusOuter: number;
  positions: Map<number, { startAngle: number; endAngle: number }>;
  combined: TimelineItem[];
  sceneGrades: Map<string, string>;
  enableSubplotColors?: boolean;
  resolveSubplotVisual?: (scene: TimelineItem) => { subplotIndex: number } | null;
}): string {
  return renderNumberSquaresUnified({
    plugin: params.plugin,
    scenes: params.combined,
    sceneGrades: params.sceneGrades,
    positions: params.positions,
    squareRadius: params.squareRadiusOuter,
    act: params.act,
    ringOuter: params.ringOuter,
    enableSubplotColors: params.enableSubplotColors,
    resolveSubplotVisual: params.resolveSubplotVisual
  });
}

export function renderInnerRingsNumberSquaresAllScenes(params: {
  plugin: PluginRendererFacade;
  NUM_RINGS: number;
  masterSubplotOrder: string[];
  ringStartRadii: number[];
  ringWidths: number[];
  scenesByActAndSubplot: Record<number, Record<string, TimelineItem[]>>;
  scenes: TimelineItem[];
  sceneGrades: Map<string, string>;
  enableSubplotColors?: boolean;
  resolveSubplotVisual?: (scene: TimelineItem) => { subplotIndex: number } | null;
  numActs?: number;
}): string {
  const { plugin, NUM_RINGS, masterSubplotOrder, ringStartRadii, ringWidths, scenesByActAndSubplot, scenes, sceneGrades, enableSubplotColors = false, resolveSubplotVisual, numActs } = params;
  const readabilityScale = getReadabilityMultiplier(plugin.settings);
  const squareScale = readabilityScale > 1 ? 1 + (readabilityScale - 1) * 0.75 : 1;
  const isSagaScope = getTimelineScope(plugin.settings) === 'saga';
  const totalActs = isSagaScope ? Math.max(1, numActs ?? 1) : Math.max(3, numActs ?? 3);

  const sortByWhen = usesWhenOrdering(plugin.settings);

  let svg = '';
  scenes.forEach((scene) => {
    if (isBeatNote(scene) || scene.itemType === 'Backdrop') return;
    const number = getScenePrefixNumber(scene.title, scene.number);
    if (!number) return;
    const subplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
    // Skip Main Plot scenes - they're always in the outer ring, not inner rings
    if (subplot === 'Main Plot') return;

    const placement = resolveSubplotRingPlacement({
      scene,
      masterSubplotOrder,
      NUM_RINGS,
      ringStartRadii,
      ringWidths,
      scenesByActAndSubplot,
      sortByWhen,
      isSagaScope,
      totalSegments: totalActs
    });
    if (!placement) return;
    const { ring, segment: actIndex, sceneIndex, startAngle: sceneStartAngle, radius: textPathRadius } = placement;
    const squareSize = getNumberSquareSize(number, squareScale);
    const squareX = textPathRadius * Math.cos(sceneStartAngle);
    const squareY = textPathRadius * Math.sin(sceneStartAngle);
    const { isSceneOpen, isSearchMatch, hasEdits } = getSceneState(scene, plugin);
    let squareClasses = buildSquareClasses(isSceneOpen, isSearchMatch, hasEdits);
    let textClasses = buildTextClasses(isSceneOpen, isSearchMatch, hasEdits);
    if (shouldDisplayMissingWhenWarning(scene)) {
      squareClasses += ' rt-missing-when';
      textClasses += ' rt-missing-when';
    }
    const sceneId = makeSceneId(actIndex, ring, sceneIndex, false, false, sceneKey(scene));
    extractGradeFromScene(scene, sceneId, sceneGrades, plugin);
    const grade = sceneGrades.get(sceneId);
    if (plugin.settings.enableAiSceneAnalysis && grade) textClasses += ` rt-grade-${grade}`;
    const subplotVisual = enableSubplotColors && resolveSubplotVisual ? resolveSubplotVisual(scene) : null;
    svg += generateNumberSquareGroup(
      squareX,
      squareY,
      squareSize,
      squareClasses,
      sceneId,
      number,
      textClasses,
      grade,
      {
        cornerRadius: 4,
        subplotIndex: subplotVisual?.subplotIndex,
      }
    );
  });
  return svg;
}

export function renderNumberSquaresStandard(params: {
  plugin: PluginRendererFacade;
  NUM_RINGS: number;
  masterSubplotOrder: string[];
  ringStartRadii: number[];
  ringWidths: number[];
  scenesByActAndSubplot: Record<number, Record<string, TimelineItem[]>>;
  scenes: TimelineItem[];
  sceneGrades: Map<string, string>;
  sceneNumbersMap: Map<string, { number: string; x: number; y: number; width: number; height: number }>;
  enableSubplotColors?: boolean;
  resolveSubplotVisual?: (scene: TimelineItem) => { subplotIndex: number } | null;
  numActs?: number;
}): string {
  return renderNumberSquaresUnified({
    plugin: params.plugin,
    scenes: params.scenes,
    sceneGrades: params.sceneGrades,
    NUM_RINGS: params.NUM_RINGS,
    masterSubplotOrder: params.masterSubplotOrder,
    ringStartRadii: params.ringStartRadii,
    ringWidths: params.ringWidths,
    scenesByActAndSubplot: params.scenesByActAndSubplot,
    sceneNumbersMap: params.sceneNumbersMap,
    enableSubplotColors: params.enableSubplotColors,
    resolveSubplotVisual: params.resolveSubplotVisual,
    numActs: params.numActs
  });
}
