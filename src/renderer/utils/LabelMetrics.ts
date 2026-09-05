import { estimateBeatLabelWidth } from './FontMetricsCache';

/**
 * Estimate pixel width for a beat label title.
 * Uses cached font metrics for accurate measurement.
 * Cache is lazily initialized on first call.
 */
export function estimatePixelsFromTitle(title: string, fontPx: number, _fudge: number, paddingPx: number): number {
    // Use the font metrics cache for accurate measurement
    // The fudge factor is no longer needed since we measure actual character widths
    return estimateBeatLabelWidth(title, fontPx, paddingPx);
}
