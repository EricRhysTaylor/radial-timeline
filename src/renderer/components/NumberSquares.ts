import type { TimelineItem } from '../../types';
import { formatNumber } from '../../utils/svg';
import { getSceneState, buildSquareClasses, buildTextClasses, extractGradeFromScene, isBeatNote, type PluginRendererFacade, shouldDisplayMissingWhenWarning } from '../../utils/sceneHelpers';
import { getScenePrefixNumber, getNumberSquareSize } from '../../utils/text';
import { getReadabilityMultiplier } from '../../utils/readability';
import { generateNumberSquareGroup, makeSceneId } from '../../utils/numberSquareHelpers';
import { getTimelineScope } from '../../utils/books';

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

    const uniqueKey =
      scene.path ||
      (scene.title
        ? `${scene.title}::${scene.number ?? ''}::${String(scene.when ?? '')}`
        : undefined);

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
      // Main Plot mode: calculate positions on-the-fly
      const subplot = scene.subplot || 'Main Plot';
      const subplotIndex = masterSubplotOrder.indexOf(subplot);
      const ring = NUM_RINGS - 1 - subplotIndex;

      // Check if using When date sorting
      const currentMode = plugin.settings.currentMode || 'narrative';
      const isChronologueMode = currentMode === 'chronologue';
      const sortByWhen = isChronologueMode ? true : (plugin.settings.sortByWhenDate ?? false);

      const sceneActNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
      // When using When date sorting, all scenes are in act 0
      const rawActIndex = sortByWhen
        ? 0
        : (isSagaScope ? (typeof scene.bookIndex === 'number' ? scene.bookIndex : 0) : (sceneActNumber - 1));
      // Clamp to the nearest valid quadrant so this lookup agrees with how
      // Precompute.ts bucketed the scene — an unclamped index here would
      // miss the scene (empty lookup) and re-derive a wrapped-around angle.
      const actIndex = Math.min(Math.max(rawActIndex, 0), totalActs - 1);

      const scenesInActAndSubplot = (scenesByActAndSubplot[actIndex] && scenesByActAndSubplot[actIndex][subplot]) || [];
      const filteredScenes = scenesInActAndSubplot.filter(s => !isBeatNote(s));
      const sceneIndex = filteredScenes.indexOf(scene);

      // Calculate angles based on sorting method
      let startAngle: number;
      let endAngle: number;

      if (sortByWhen) {
        // When date mode: Full 360° circle
        startAngle = -Math.PI / 2;
        endAngle = (3 * Math.PI) / 2;
      } else {
        // Manuscript mode: divide full circle by configured acts
        startAngle = (actIndex * 2 * Math.PI) / totalActs - Math.PI / 2;
        endAngle = ((actIndex + 1) * 2 * Math.PI) / totalActs - Math.PI / 2;
      }

      const totalAngularSpace = endAngle - startAngle;
      const sceneAngularSize = filteredScenes.length > 0 ? totalAngularSpace / filteredScenes.length : 0;
      let currentAngle = startAngle;
      for (let i = 0; i < sceneIndex; i++) currentAngle += sceneAngularSize;
      sceneStartAngle = currentAngle;
      textPathRadius = (ringStartRadii[ring] + (ringStartRadii[ring] + ringWidths[ring])) / 2;
      sceneId = makeSceneId(actIndex, ring, sceneIndex, false, false, uniqueKey);
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

  // Check if using When date sorting
  const currentMode = plugin.settings.currentMode || 'narrative';
  const isChronologueMode = currentMode === 'chronologue';
  const sortByWhen = isChronologueMode ? true : (plugin.settings.sortByWhenDate ?? false);

  let svg = '';
  scenes.forEach((scene) => {
    if (isBeatNote(scene) || scene.itemType === 'Backdrop') return;
    const number = getScenePrefixNumber(scene.title, scene.number);
    if (!number) return;
    const subplot = scene.subplot && scene.subplot.trim().length > 0 ? scene.subplot : 'Main Plot';
    // Skip Main Plot scenes - they're always in the outer ring, not inner rings
    if (subplot === 'Main Plot') return;
    const subplotIndex = masterSubplotOrder.indexOf(subplot);
    if (subplotIndex === -1) return;
    const ring = NUM_RINGS - 1 - subplotIndex;
    if (ring < 0 || ring >= NUM_RINGS) return;

    // When using When date sorting, all scenes are in act 0
    // When using manuscript order, use the scene's actual act
    const sceneActNumber = scene.actNumber !== undefined ? scene.actNumber : 1;
    const rawActIndex = sortByWhen
      ? 0
      : (isSagaScope ? (typeof scene.bookIndex === 'number' ? scene.bookIndex : 0) : (sceneActNumber - 1));
    // Clamp to the nearest valid quadrant — see renderNumberSquaresUnified above.
    const actIndex = Math.min(Math.max(rawActIndex, 0), totalActs - 1);

    const scenesInActAndSubplot = (scenesByActAndSubplot[actIndex] && scenesByActAndSubplot[actIndex][subplot]) || [];
    const filteredScenesForIndex = scenesInActAndSubplot.filter(s => !isBeatNote(s));
    // Find scene by path/title instead of object reference (fixes first-render bug)
    const sceneKey = scene.path || scene.title || '';
    const sceneIndex = filteredScenesForIndex.findIndex(s => (s.path || s.title || '') === sceneKey);
    if (sceneIndex === -1) return;

    // Calculate angles based on sorting method
    let startAngle: number;
    let endAngle: number;

    if (sortByWhen) {
      // When date mode: Full 360° circle
      startAngle = -Math.PI / 2;
      endAngle = (3 * Math.PI) / 2;
    } else {
      // Manuscript mode: divide full circle by configured acts
      startAngle = (actIndex * 2 * Math.PI) / totalActs - Math.PI / 2;
      endAngle = ((actIndex + 1) * 2 * Math.PI) / totalActs - Math.PI / 2;
    }
    const innerR = ringStartRadii[ring];
    const outerR = innerR + ringWidths[ring];
    const totalAngularSpace = endAngle - startAngle;
    const sceneAngularSize = filteredScenesForIndex.length > 0 ? totalAngularSpace / filteredScenesForIndex.length : 0;
    let currentAngle = startAngle;
    for (let i = 0; i < sceneIndex; i++) currentAngle += sceneAngularSize;
    const sceneStartAngle = currentAngle;
    const textPathRadius = (innerR + outerR) / 2;
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
    const uniqueKey =
      scene.path ||
      (scene.title ? `${scene.title}::${scene.number ?? ''}::${String(scene.when ?? '')}` : undefined);
    const sceneId = makeSceneId(actIndex, ring, sceneIndex, false, false, uniqueKey);
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
