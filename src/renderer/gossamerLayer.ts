/*
 * Gossamer SVG layer helper
 */
import type { TimelineItem } from '../types';
import { GossamerRun, extractPresentBeatScores, extractBeatOrder } from '../utils/gossamer';
import { getMostAdvancedStageColor, lightenColor, getRunColorWithSaturation } from '../utils/colour';
import { escapeXml } from '../utils/svg';

export interface PolarConfig {
  innerRadius: number;
  outerRadius: number;
}

// Helper to get CSS variable value
function getCSSVar(varName: string, fallback: string): string {
  return getComputedStyle(activeDocument.documentElement).getPropertyValue(varName).trim() || fallback;
}

// Helper to map score [0..100] into a band near the outer ring
function mapScoreToRadius(score: number, inner: number, outer: number): number {
  // Linear map: 0 -> inner, 100 -> outer
  const clamped = Math.max(0, Math.min(100, score));
  return inner + (clamped / 100) * (outer - inner);
}

export interface BeatSliceInfo {
  startAngle: number;
  endAngle: number;
  innerR: number;
  outerR: number;
}

export function renderGossamerLayer(
  scenes: TimelineItem[],
  run: GossamerRun | null | undefined,
  polar: PolarConfig,
  anglesByBeat?: Map<string, number>,
  beatPathByName?: Map<string, string>,
  overlayRuns?: Array<{ label?: string; points: { beat: string; score: number }[]; color?: string; stage?: string; runIndex?: number }>,
  minBand?: { min: { beat: string; score: number }[]; max: { beat: string; score: number }[] },
  spokeEndRadius?: number,
  publishStageColorByBeat?: Map<string, string>,
  beatSlicesByName?: Map<string, BeatSliceInfo>,
  publishStageColors?: Record<string, string>,
  hasAnyScores: boolean = false // If false, use simplified view with no red zeros
): string {
  if (!run) return '';
  
  // Build a map of beat statuses for rendering (use exact beat names)
  const beatStatusMap = new Map(run.beats.map(b => [b.beat, b.status]));
  

  const defaultColor = getCSSVar('--rt-gossamer-default-color', '#7a7a7a');
  const projectStageColor = publishStageColors
    ? getMostAdvancedStageColor(scenes, publishStageColors)
    : Array.from(publishStageColorByBeat?.values() || [])[0] || defaultColor;

  // Get selected beat model from plugin settings (passed through run meta if needed)
  const selectedBeatModel = run?.meta?.model;
  
  // Extract dynamic beat order from story beat notes (itemType: Beat)
  const beatOrder = extractBeatOrder(scenes, selectedBeatModel);
  if (!beatOrder.length) {
    return '';
  }

  // Build angles map with fallback, then override with provided values from rendered plot beats
  const localAngles = (() => {
    const m = new Map<string, number>();
    // Fallback: equally-spaced angles if no rendered angles provided
    const fallbackAngles: number[] = beatOrder.map((_, i) => -Math.PI / 2 + (i / beatOrder.length) * 2 * Math.PI);
    beatOrder.forEach((name, idx) => m.set(name, fallbackAngles[idx]));
    
    // Override with actual rendered plot beat positions for perfect alignment
    if (anglesByBeat) {
      anglesByBeat.forEach((val, key) => {
        m.set(key, val);
      });
    }
    return m;
  })();

  // Build contiguous segments from present beats with numeric scores for bezier lines
  const present = extractPresentBeatScores(run);

  const { innerRadius, outerRadius } = polar;

  // Build score map for beats that have scores
  const nameToScore = new Map(present.map(p => [p.beat, p.score]));
  
  const segments: string[] = [];
  let current: { x: number; y: number }[] = [];
  const scoreTexts: string[] = [];
  const spokes: string[] = [];
  const beatOutlines: string[] = [];
  const rangeSquares: string[] = []; // Range boundary squares - rendered last (on top)

  beatOrder.forEach(name => {
    const angle = localAngles.get(name);
    if (typeof angle !== 'number') return; // Need angle to render anything
    
    // Get the specific color for this beat, with a fallback
    const beatColor = projectStageColor;
    
    const score = nameToScore.get(name);
    const beatData = run.beats.find(b => b.beat === name);
    const beatStatus = beatStatusMap.get(name);
    
    // ALWAYS render spoke and outline if we have the beat and angle
    const spokeEnd = spokeEndRadius ?? outerRadius;
    const sx1 = innerRadius * Math.cos(angle);
    const sy1 = innerRadius * Math.sin(angle);
    const sx2 = spokeEnd * Math.cos(angle);
    const sy2 = spokeEnd * Math.sin(angle);
    
    // Base spoke: render with beat-specific or most advanced color
    spokes.push(`<line class="rt-gossamer-spoke" data-beat="${escapeXml(name)}" x1="${fmt(sx1)}" y1="${fmt(sy1)}" x2="${fmt(sx2)}" y2="${fmt(sy2)}" stroke="${beatColor}"/>`);
    
    // ALWAYS render beat slice outline if we have slice info
    if (beatSlicesByName) {
      const sliceInfo = beatSlicesByName.get(name);
      if (sliceInfo) {
        const arcPath = buildCellArcPath(sliceInfo.innerR, sliceInfo.outerR, sliceInfo.startAngle, sliceInfo.endAngle);
        beatOutlines.push(`<path class="rt-gossamer-beat-outline" d="${arcPath}" stroke="${beatColor}" data-beat="${escapeXml(name)}"/>`);
      }
    }
    
    // ALWAYS render ideal range if Range field exists
    if (beatData?.range) {
      const range = beatData.range;
      const minRadius = mapScoreToRadius(range.min, innerRadius, outerRadius);
      const maxRadius = mapScoreToRadius(range.max, innerRadius, outerRadius);
      
      const rangeMinX = minRadius * Math.cos(angle);
      const rangeMinY = minRadius * Math.sin(angle);
      const rangeMaxX = maxRadius * Math.cos(angle);
      const rangeMaxY = maxRadius * Math.sin(angle);
      
      // Draw ideal range segment (between min and max)
      const idealRangeWidth = getCSSVar('--rt-gossamer-ideal-range-width', '6px');
      spokes.push(`<line class="rt-gossamer-ideal-range" data-beat="${escapeXml(name)}" x1="${fmt(rangeMinX)}" y1="${fmt(rangeMinY)}" x2="${fmt(rangeMaxX)}" y2="${fmt(rangeMaxY)}" stroke="${beatColor}" stroke-width="${idealRangeWidth}"/>`);
      
      // Range boundary text values
      rangeSquares.push(`<text class="rt-gossamer-range-value" data-beat="${escapeXml(name)}" x="${fmt(rangeMinX)}" y="${fmt(rangeMinY + 1)}">${range.min}</text>`);
      rangeSquares.push(`<text class="rt-gossamer-range-value" data-beat="${escapeXml(name)}" x="${fmt(rangeMaxX)}" y="${fmt(rangeMaxY + 1)}">${range.max}</text>`);
    }
    
    // Render SCORE TEXT if score exists OR if it's missing in sequence (show as 0 in red)
    // Only show red zeros if we have ANY scores in the system (hasAnyScores = true)
    // If no scores exist yet, use simplified view with no score indicators
    const isMissingInSequence = beatStatus === 'outlineOnly';
    const displayScore = typeof score === 'number' ? score : (isMissingInSequence && hasAnyScores ? 0 : null);
    
    if (displayScore !== null) {
      const r = mapScoreToRadius(displayScore, innerRadius, outerRadius);
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      
      current.push({ x, y });
      
      const path = beatPathByName?.get(name) || '';
      const encodedPath = path ? encodeURIComponent(path) : '';
      const data = `data-beat="${escapeXml(name)}" data-score="${String(displayScore)}"${encodedPath ? ` data-path="${escapeXml(encodedPath)}"` : ''}${run?.meta?.label ? ` data-label="${escapeXml(run.meta.label)}"` : ''}`;
      
      // Render score text with dedicated class for interaction - use missing-data class for 0 scores from missing beats
      scoreTexts.push(`<text class="rt-gossamer-score-text${isMissingInSequence ? ' rt-gossamer-missing-data' : ''}" x="${fmt(x)}" y="${fmt(y + 1)}" ${data}>${displayScore}</text>`);
      
      // Range deviation segment if range exists and we have a real score (not missing)
      if (beatData?.range && typeof score === 'number') {
        const range = beatData.range;
        const scoreRadius = mapScoreToRadius(score, innerRadius, outerRadius);
        
        const isInRange = score >= range.min && score <= range.max;
        const isBelowRange = score < range.min;
        const isAboveRange = score > range.max;
        
        let segmentStart: number;
        let segmentEnd: number;
        
        if (isInRange) {
          // Score is within range: show green segment from score to nearest range boundary
          // Find closest boundary (min or max)
          const distToMin = Math.abs(score - range.min);
          const distToMax = Math.abs(score - range.max);
          const targetBoundary = distToMin < distToMax ? range.min : range.max;
          
          segmentStart = scoreRadius;
          segmentEnd = mapScoreToRadius(targetBoundary, innerRadius, outerRadius);
        } else {
          // Score is out of range: segment from score to violated boundary
          if (isBelowRange) {
            // Too low: segment from score to range.min
            segmentStart = scoreRadius;
            segmentEnd = mapScoreToRadius(range.min, innerRadius, outerRadius);
          } else {
            // Too high: segment from score to range.max
            segmentStart = scoreRadius;
            segmentEnd = mapScoreToRadius(range.max, innerRadius, outerRadius);
          }
        }
        
        // Calculate segment coordinates
        const segX1 = segmentStart * Math.cos(angle);
        const segY1 = segmentStart * Math.sin(angle);
        const segX2 = segmentEnd * Math.cos(angle);
        const segY2 = segmentEnd * Math.sin(angle);
        
        // Color coding: green for in-range, magenta for above range (exciting!), red for below range (boring/slow)
        // Colors defined in CSS, set class to apply appropriate styling
        let segmentClass: string;
        if (isInRange) {
          segmentClass = 'rt-gossamer-range-segment rt-in-range';
        } else if (isAboveRange) {
          segmentClass = 'rt-gossamer-range-segment rt-above-range';
        } else {
          segmentClass = 'rt-gossamer-range-segment rt-below-range';
        }
        
        spokes.push(`<line class="${segmentClass}" data-beat="${escapeXml(name)}" x1="${fmt(segX1)}" y1="${fmt(segY1)}" x2="${fmt(segX2)}" y2="${fmt(segY2)}"/>`);
      }
    }
  });
  
  if (current.length > 1) segments.push(buildPath(current));

  if (segments.length === 0 && scoreTexts.length === 0 && spokes.length === 0 && beatOutlines.length === 0) return '';

  // Optional min/max band fill (rendered FIRST - behind everything)
  // Strategy: Sample the ACTUAL bezier curves of all runs at many points,
  // then compute min/max radius at each sample. This ensures the envelope
  // perfectly follows the rendered curves, even at crossovers.
  let bandSvg = '';
  if (overlayRuns && overlayRuns.length > 0) {
    // Collect all runs (current + historical)
    const allRunPoints: Array<{ x: number; y: number }[]> = [];
    
    // Current run points
    const currentPts = current.map(pt => ({ x: pt.x, y: pt.y }));
    if (currentPts.length >= 2) {
      allRunPoints.push(currentPts);
    }
    
    // Historical run points
    overlayRuns.forEach(ov => {
      const pts = toPoints(ov.points, localAngles, innerRadius, outerRadius);
      if (pts.length >= 2) {
        allRunPoints.push(pts);
      }
    });
    
    if (allRunPoints.length >= 1) {
      // Sample each run's bezier at many intermediate points
      const samplesPerSegment = 5;
      const sampledRuns: Array<{ x: number; y: number }[]> = allRunPoints.map(pts => 
        sampleBezierCurve(pts, samplesPerSegment)
      );
      
      // All runs should have same number of samples (same beat count)
      const numSamples = sampledRuns[0]?.length || 0;
      
      if (numSamples >= 2) {
        // At each sample index, find min and max radius - use actual points, not recomputed
        const minEnvelope: { x: number; y: number }[] = [];
        const maxEnvelope: { x: number; y: number }[] = [];
        
        for (let i = 0; i < numSamples; i++) {
          let minR = Infinity;
          let maxR = -Infinity;
          let minPt: { x: number; y: number } | null = null;
          let maxPt: { x: number; y: number } | null = null;
          
          for (const run of sampledRuns) {
            if (i < run.length) {
              const pt = run[i];
              const r = Math.sqrt(pt.x * pt.x + pt.y * pt.y);
              if (r < minR) {
                minR = r;
                minPt = pt;
              }
              if (r > maxR) {
                maxR = r;
                maxPt = pt;
              }
            }
          }
          
          // Use actual x,y from the runs that produced min/max, not recomputed coordinates
          if (minPt && maxPt) {
            minEnvelope.push({ x: minPt.x, y: minPt.y });
            maxEnvelope.push({ x: maxPt.x, y: maxPt.y });
          }
        }
        
        if (minEnvelope.length >= 2 && maxEnvelope.length >= 2) {
          // Build band polygon: max forward, min backward
          let bandPath = `M ${fmt(maxEnvelope[0].x)} ${fmt(maxEnvelope[0].y)}`;
          for (let i = 1; i < maxEnvelope.length; i++) {
            bandPath += ` L ${fmt(maxEnvelope[i].x)} ${fmt(maxEnvelope[i].y)}`;
          }
          for (let i = minEnvelope.length - 1; i >= 0; i--) {
            bandPath += ` L ${fmt(minEnvelope[i].x)} ${fmt(minEnvelope[i].y)}`;
          }
          bandPath += ' Z';
          
          const bandOpacity = getCSSVar('--rt-gossamer-band-opacity', '0.5');
          const lightColor = lightenColor(projectStageColor, 70);
          
          bandSvg = `<path class="rt-gossamer-band" d="${bandPath}" fill="${lightColor}" fill-opacity="${bandOpacity}"/>`;
        }
      }
    }
  }

  // Optional historical runs (rendered in reverse order: oldest to newest, so newest is on top)
  const overlayPathsWithColors: Array<{ path: string; color: string }> = [];
  const overlayDots: string[] = [];
  
  if (overlayRuns && overlayRuns.length > 0) {
    // Calculate stage-based colors with saturation gradients
    // Group runs by stage to determine position within each stage
    const runsByStage = new Map<string, number[]>();
    overlayRuns.forEach((ov, idx) => {
      const stage = ov.stage || 'unknown';
      if (!runsByStage.has(stage)) {
        runsByStage.set(stage, []);
      }
      runsByStage.get(stage)!.push(idx);
    });
    
    // Calculate color for each run based on stage and position
    const runColors = overlayRuns.map((ov, idx) => {
      const historicalColor = getCSSVar('--rt-color-muted-gray', '#c0c0c0');
      
      // If no stage info or no publishStageColors, use legacy gray
      if (!ov.stage || !publishStageColors) {
        return ov.color || historicalColor;
      }
      
      // Get the base color for this stage
      const stageColor = publishStageColors[ov.stage];
      if (!stageColor) {
        return ov.color || historicalColor;
      }
      
      // Get position within this stage's runs
      const stageRuns = runsByStage.get(ov.stage) || [idx];
      const positionInStage = stageRuns.indexOf(idx);
      const totalInStage = stageRuns.length;
      
      // Apply saturation gradient (older = less saturated, newer = more saturated)
      return getRunColorWithSaturation(stageColor, positionInStage, totalInStage);
    });
    
    // Reverse to draw oldest first (bottom layer)
    [...overlayRuns].reverse().forEach((ov, reversedIdx) => {
      const originalIdx = overlayRuns.length - 1 - reversedIdx;
      const runColor = runColors[originalIdx];
      
      const path = buildOverlayPath(ov.points, localAngles, innerRadius, outerRadius);
      if (path) {
        overlayPathsWithColors.push({
          path,
          color: runColor
        });
      }
      
      // Add dots for historical runs (red if score is 0, stage color if score > 0)
      const historicalDotRadius = getCSSVar('--rt-gossamer-dot-historical', '5');
      ov.points.forEach(point => {
        const angle = localAngles.get(point.beat);
        if (typeof angle === 'number') {
          const r = mapScoreToRadius(point.score, innerRadius, outerRadius);
          const x = r * Math.cos(angle);
          const y = r * Math.sin(angle);
          const errorColor = getCSSVar('--rt-gossamer-error-color', '#ff4444');
          const dotColor = point.score === 0 ? errorColor : runColor;
          // Historical dots: use CSS variable for size
          overlayDots.push(`<circle class="rt-gossamer-dot-historical" cx="${fmt(x)}" cy="${fmt(y)}" r="${historicalDotRadius}" fill="${dotColor}" data-beat="${escapeXml(point.beat)}" pointer-events="none"/>`);
        }
      });
    });
  }
  
  const overlaySvg = overlayPathsWithColors
    .map(({ path, color }) => `<path class="rt-gossamer-line rt-gossamer-overlay" d="${path}" stroke="${color}"/>`)
    .join('');
  const overlayDotsSvg = overlayDots.join('');

  // Main current run (Gossamer1) - on top of historical runs
  const mainPaths = segments.map(d => `<path class="rt-gossamer-line" d="${d}"/>`).join('');
  
  // Render order (SVG draw order = z-order):
  // 1. Band (behind everything)
  // 2. Historical runs (oldest to newest)
  // 3. Main current line
  // 4. Spokes (behind score text but in front of traces)
  // 5. Beat outlines
  // 6. Historical dots (small, non-interactive)
  // 7. Range boundary markers (text with white stroke)
  // 8. Current score text (on top, interactive, in front of range markers)
  const scoreTextsSvg = scoreTexts.join('');
  const spokesSvg = spokes.join('');
  const beatOutlinesSvg = beatOutlines.join('');
  const rangeMarkersSvg = rangeSquares.join('');
  
  return `<g class="rt-gossamer-layer">${bandSvg}${overlaySvg}${mainPaths}${spokesSvg}${beatOutlinesSvg}${overlayDotsSvg}${rangeMarkersSvg}${scoreTextsSvg}</g>`;
}

/**
 * Centralized Bezier path builder - ensures all gossamer curves use identical smoothing.
 * @param points Array of x,y coordinates
 * @param startWithMove If true, starts with M command; if false, continues existing path with L
 */
function buildBezierPath(points: { x: number; y: number }[], startWithMove: boolean = true): string {
  if (!points.length) return '';
  if (points.length === 1) {
    return startWithMove ? `M ${fmt(points[0].x)} ${fmt(points[0].y)}` : `L ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  }
  if (points.length === 2) {
    const start = startWithMove ? `M ${fmt(points[0].x)} ${fmt(points[0].y)}` : `L ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    return `${start} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  }
  
  // Build smooth bezier curve through all points
  let path = startWithMove ? `M ${fmt(points[0].x)} ${fmt(points[0].y)}` : `L ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  
  // Calculate control points for smooth curve with adaptive tension
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const prev = i > 0 ? points[i - 1] : current;
    const afterNext = i < points.length - 2 ? points[i + 2] : next;
    
    // Calculate distances to detect tight curves
    const distCurrNext = Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2);
    const distPrevCurr = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2);
    const distNextAfter = Math.sqrt((afterNext.x - next.x) ** 2 + (afterNext.y - next.y) ** 2);
    
    // Base tension for smooth curves
    let tension = 0.25;
    
    // Reduce tension for tight curves (when points are close together)
    const avgDist = (distPrevCurr + distCurrNext + distNextAfter) / 3;
    if (avgDist < 50) {
      tension = 0.1;
    } else if (avgDist < 100) {
      tension = 0.15;
    }
    
    // Further reduce tension if we detect a sharp angle (direction change)
    if (i > 0 && i < points.length - 1) {
      const v1x = current.x - prev.x;
      const v1y = current.y - prev.y;
      const v2x = next.x - current.x;
      const v2y = next.y - current.y;
      
      const dot = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      if (mag1 > 0 && mag2 > 0) {
        const cosAngle = dot / (mag1 * mag2);
        if (cosAngle < 0.5) {
          tension *= 0.5;
        }
      }
    }
    
    // Calculate control point distances (limit to fraction of segment length)
    const maxControlDist = distCurrNext * 0.4;
    
    // Control point 1 (outgoing from current point)
    let cp1x = current.x + (next.x - prev.x) * tension;
    let cp1y = current.y + (next.y - prev.y) * tension;
    
    const cp1dist = Math.sqrt((cp1x - current.x) ** 2 + (cp1y - current.y) ** 2);
    if (cp1dist > maxControlDist && cp1dist > 0) {
      const scale = maxControlDist / cp1dist;
      cp1x = current.x + (cp1x - current.x) * scale;
      cp1y = current.y + (cp1y - current.y) * scale;
    }
    
    // Control point 2 (incoming to next point)
    let cp2x = next.x - (afterNext.x - current.x) * tension;
    let cp2y = next.y - (afterNext.y - current.y) * tension;
    
    const cp2dist = Math.sqrt((cp2x - next.x) ** 2 + (cp2y - next.y) ** 2);
    if (cp2dist > maxControlDist && cp2dist > 0) {
      const scale = maxControlDist / cp2dist;
      cp2x = next.x + (cp2x - next.x) * scale;
      cp2y = next.y + (cp2y - next.y) * scale;
    }
    
    path += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(next.x)} ${fmt(next.y)}`;
  }
  
  return path;
}

function buildPath(points: { x: number; y: number }[]): string {
  return buildBezierPath(points, true);
}

/**
 * Sample a bezier curve at intermediate points.
 * Uses the EXACT same control point calculation as buildBezierPath to ensure perfect matching.
 * @param points Array of x,y coordinates (the beat points)
 * @param samplesPerSegment Number of samples between each pair of points
 * @returns Array of sampled x,y coordinates along the curve
 */
function sampleBezierCurve(points: { x: number; y: number }[], samplesPerSegment: number): { x: number; y: number }[] {
  if (!points.length) return [];
  if (points.length === 1) return [{ ...points[0] }];
  if (points.length === 2) {
    // Linear interpolation for 2 points
    const result: { x: number; y: number }[] = [];
    for (let s = 0; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      result.push({
        x: points[0].x + (points[1].x - points[0].x) * t,
        y: points[0].y + (points[1].y - points[0].y) * t
      });
    }
    return result;
  }
  
  const result: { x: number; y: number }[] = [];
  
  // Sample each segment using the SAME control point logic as buildBezierPath
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const prev = i > 0 ? points[i - 1] : current;
    const afterNext = i < points.length - 2 ? points[i + 2] : next;
    
    // Calculate distances to detect tight curves (same as buildBezierPath)
    const distCurrNext = Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2);
    const distPrevCurr = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2);
    const distNextAfter = Math.sqrt((afterNext.x - next.x) ** 2 + (afterNext.y - next.y) ** 2);
    
    // Base tension for smooth curves
    let tension = 0.25;
    
    // Reduce tension for tight curves
    const avgDist = (distPrevCurr + distCurrNext + distNextAfter) / 3;
    if (avgDist < 50) {
      tension = 0.1;
    } else if (avgDist < 100) {
      tension = 0.15;
    }
    
    // Further reduce tension if we detect a sharp angle
    if (i > 0 && i < points.length - 1) {
      const v1x = current.x - prev.x;
      const v1y = current.y - prev.y;
      const v2x = next.x - current.x;
      const v2y = next.y - current.y;
      
      const dot = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      if (mag1 > 0 && mag2 > 0) {
        const cosAngle = dot / (mag1 * mag2);
        if (cosAngle < 0.5) {
          tension *= 0.5;
        }
      }
    }
    
    // Calculate control point distances (same as buildBezierPath)
    const maxControlDist = distCurrNext * 0.4;
    
    // Control point 1 (outgoing from current point)
    let cp1x = current.x + (next.x - prev.x) * tension;
    let cp1y = current.y + (next.y - prev.y) * tension;
    
    const cp1dist = Math.sqrt((cp1x - current.x) ** 2 + (cp1y - current.y) ** 2);
    if (cp1dist > maxControlDist && cp1dist > 0) {
      const scale = maxControlDist / cp1dist;
      cp1x = current.x + (cp1x - current.x) * scale;
      cp1y = current.y + (cp1y - current.y) * scale;
    }
    
    // Control point 2 (incoming to next point)
    let cp2x = next.x - (afterNext.x - current.x) * tension;
    let cp2y = next.y - (afterNext.y - current.y) * tension;
    
    const cp2dist = Math.sqrt((cp2x - next.x) ** 2 + (cp2y - next.y) ** 2);
    if (cp2dist > maxControlDist && cp2dist > 0) {
      const scale = maxControlDist / cp2dist;
      cp2x = next.x + (cp2x - next.x) * scale;
      cp2y = next.y + (cp2y - next.y) * scale;
    }
    
    // Sample this cubic bezier segment
    const startSample = i === 0 ? 0 : 1; // Avoid duplicating points at segment boundaries
    for (let s = startSample; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      
      // Cubic bezier formula: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
      const x = mt3 * current.x + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * next.x;
      const y = mt3 * current.y + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * next.y;
      
      result.push({ x, y });
    }
  }
  
  return result;
}

function fmt(n: number): string { return n.toFixed(6).replace(/\.0+$/, ''); }

function toPoints(series: { beat: string; score: number }[], angles: Map<string, number>, inner: number, outer: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  series.forEach(p => {
    const a = angles.get(p.beat);
    if (typeof a !== 'number') return;
    const r = mapScoreToRadius(p.score, inner, outer);
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  });
  return pts;
}

function buildOverlayPath(points: { beat: string; score: number }[], angles: Map<string, number>, inner: number, outer: number): string | null {
  const pts = toPoints(points, angles, inner, outer);
  if (pts.length < 2) return null;
  return buildBezierPath(pts, true);
}

// Helper to build arc path for beat slices
function buildCellArcPath(innerR: number, outerR: number, startAngle: number, endAngle: number): string {
  const x1 = innerR * Math.cos(startAngle);
  const y1 = innerR * Math.sin(startAngle);
  const x2 = outerR * Math.cos(startAngle);
  const y2 = outerR * Math.sin(startAngle);
  const x3 = outerR * Math.cos(endAngle);
  const y3 = outerR * Math.sin(endAngle);
  const x4 = innerR * Math.cos(endAngle);
  const y4 = innerR * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${fmt(x1)} ${fmt(y1)} L ${fmt(x2)} ${fmt(y2)} A ${fmt(outerR)} ${fmt(outerR)} 0 ${largeArc} 1 ${fmt(x3)} ${fmt(y3)} L ${fmt(x4)} ${fmt(y4)} A ${fmt(innerR)} ${fmt(innerR)} 0 ${largeArc} 0 ${fmt(x1)} ${fmt(y1)} Z`;
}
