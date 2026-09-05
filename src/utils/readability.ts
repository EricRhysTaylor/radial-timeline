import type { RadialTimelineSettings, ReadabilityScale } from '../types';
import { READABILITY_SCALES } from '../renderer/layout/LayoutConstants';

export function getReadabilityScale(options?: { readabilityScale?: ReadabilityScale }): ReadabilityScale {
  const value = options?.readabilityScale;
  if (value && value in READABILITY_SCALES) return value;
  return 'normal';
}

/**
 * Get the readability multiplier from plugin settings.
 * Values are defined in LayoutConstants.ts under READABILITY_SCALES.
 */
export function getReadabilityMultiplier(settings?: RadialTimelineSettings | { readabilityScale?: ReadabilityScale }): number {
  const scale = getReadabilityScale(settings);
  return READABILITY_SCALES[scale];
}
