import type { TimelineItem } from '../../types';
import { formatNumber } from '../../utils/svg';
import { isBeatNote } from '../../utils/sceneHelpers';

export function renderSceneGroup(params: {
  scene: TimelineItem;
  act: number;
  ring: number;
  idx: number;
  innerR: number;
  outerR: number;
  startAngle: number;
  endAngle: number;
  subplotIdxAttr: string | number;
  subplotColorIdxAttr?: string | number;
  titleInset: number;
  /**
   * This scene's angle is pinned to its outer-ring counterpart (Sequence
   * alignment). Interaction code must not repack the ring around it — the
   * start angle is the alignment the mode exists to show.
   */
  aligned?: boolean;
}): string {
  const { scene, act, ring, idx, innerR, outerR, startAngle, endAngle, subplotIdxAttr, subplotColorIdxAttr, titleInset, aligned } = params;
  const groupId = `scene-group-${act}-${ring}-${idx}`;
  const colorAttr = subplotColorIdxAttr !== undefined ? ` data-subplot-color-index="${String(subplotColorIdxAttr)}"` : '';
  const alignedAttr = aligned ? ' data-aligned="true"' : '';
  // Preserve high-precision angles for interaction/hover math; keep formatted angles for render attrs
  const rawStart = startAngle.toString();
  const rawEnd = endAngle.toString();
  return `
    <g class="rt-scene-group${isBeatNote(scene) ? ' beats' : ''}" data-item-type="${isBeatNote(scene) ? 'Beat' : 'Scene'}" data-act="${act}" data-ring="${ring}" data-idx="${idx}" data-start-angle="${formatNumber(startAngle)}" data-end-angle="${formatNumber(endAngle)}" data-start-angle-raw="${rawStart}" data-end-angle-raw="${rawEnd}" data-inner-r="${formatNumber(innerR)}" data-outer-r="${formatNumber(outerR)}" data-subplot-index="${String(subplotIdxAttr)}"${colorAttr}${alignedAttr} data-title-inset="${formatNumber(titleInset)}" data-path="${scene.path ? encodeURIComponent(scene.path) : ''}" id="${groupId}">
  `;
}
