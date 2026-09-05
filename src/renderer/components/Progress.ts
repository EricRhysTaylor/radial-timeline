import { formatNumber, escapeXml } from '../../utils/svg';
import { dateToAngle } from '../../utils/date';
import type { CompletionEstimate } from '../../services/TimelineMetricsService';
import { getFormattingLocale } from '../../i18n';

// Hotspot radius for the estimate tick (large enough for easy hover/touch)
const ESTIMATE_HOTSPOT_RADIUS = 20;

export function renderEstimatedDateElements(params: {
  estimate: CompletionEstimate;
  progressRadius: number;
}): string {
  const { estimate, progressRadius } = params;
  const estimateDate = estimate.date;
  const stalenessClass = estimate.staleness ? ` estimate-${estimate.staleness}` : '';
  const stageClass = estimate.stage ? ` estimate-stage-${estimate.stage}` : '';
  const labelText = estimate.labelText;
  const displayDate = estimateDate === null ? new Date(new Date().getFullYear(), 0, 1) : estimateDate;
  const dateFormatter = new Intl.DateTimeFormat(getFormattingLocale(), { month: 'short', day: 'numeric' });
  const formattedDate = dateFormatter.format(displayDate);
  // Append 2-digit year suffix when the estimate falls in a different year than today
  // (e.g., today 2026-04-28, estimate 2027-03-08 → "Mar 8 '27")
  const yearSuffix = estimateDate !== null && estimateDate.getFullYear() !== new Date().getFullYear()
    ? ` '${String(estimateDate.getFullYear() % 100).padStart(2, '0')}`
    : '';
  const dateDisplay = labelText ?? `${formattedDate}${yearSuffix}`;

  // Build tooltip text (escaped for use in data attribute)
  const tooltipText = labelText === '?'
    ? 'Estimated completion: insufficient data'
    : `Estimated completion: ${dateDisplay}`;
  const escapedTooltip = escapeXml(tooltipText);
  
  // null date means "use default angle" (book complete, no target set)
  let absoluteDatePos: number;
  
  if (estimateDate === null) {
    // Use exact default angle (-PI/2) to match target tick default
    absoluteDatePos = -Math.PI / 2;
  } else {
    // Use same dateToAngle function as target tick (from utils/date)
    absoluteDatePos = dateToAngle(estimateDate);
  }

  const tickOuterRadius = progressRadius + 5;
  const tickInnerRadius = progressRadius - 35;
  const tickOuterX = tickOuterRadius * Math.cos(absoluteDatePos);
  const tickOuterY = tickOuterRadius * Math.sin(absoluteDatePos);
  const tickInnerX = tickInnerRadius * Math.cos(absoluteDatePos);
  const tickInnerY = tickInnerRadius * Math.sin(absoluteDatePos);

  let svg = '';
  if ([tickOuterX, tickOuterY, tickInnerX, tickInnerY].every((v) => Number.isFinite(v))) {
    // Wrap tick elements in a group for styling, but tooltip target is the hotspot only
    svg += `
      <g class="rt-estimate-tick-group${stageClass}${stalenessClass}">
        <!-- Visible tick line -->
        <line x1="${formatNumber(tickOuterX)}" y1="${formatNumber(tickOuterY)}" x2="${formatNumber(tickInnerX)}" y2="${formatNumber(tickInnerY)}" class="estimated-date-tick${stageClass}${stalenessClass}" />
        <!-- Visible dot at inner end -->
        <circle cx="${formatNumber(tickInnerX)}" cy="${formatNumber(tickInnerY)}" r="4" class="estimated-date-dot${stageClass}${stalenessClass}" />
        <!-- Large invisible hotspot centered on dot - this is the tooltip target so arrow points at dot -->
        <circle cx="${formatNumber(tickInnerX)}" cy="${formatNumber(tickInnerY)}" r="${ESTIMATE_HOTSPOT_RADIUS}" class="rt-estimate-hotspot rt-tooltip-target" data-tooltip="${escapedTooltip}" data-tooltip-placement="top" fill="transparent" />
      </g>
    `;
  }

  // Date label removed - styled tooltip on hover is cleaner since tick aligns with month ring
  return svg;
}


export function renderEstimationArc(params: {
  estimateDate: Date | null;
  progressRadius: number;
}): string {
  const { estimateDate, progressRadius } = params;
  
  // Don't render arc if date is null (default angle)
  if (estimateDate === null) {
    return '';
  }
  
  const startAngle = -Math.PI / 2; // 12 o'clock
  
  // Use same dateToAngle function for consistency
  const estimatedDateAngle = dateToAngle(estimateDate);
  
  let arcAngleSpan = estimatedDateAngle - startAngle;
  if (arcAngleSpan < 0) arcAngleSpan += 2 * Math.PI;
  const x0 = progressRadius * Math.cos(startAngle);
  const y0 = progressRadius * Math.sin(startAngle);
  const x1 = progressRadius * Math.cos(estimatedDateAngle);
  const y1 = progressRadius * Math.sin(estimatedDateAngle);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return '';
  return `
    <path d="M ${x0} ${y0} A ${progressRadius} ${progressRadius} 0 ${arcAngleSpan > Math.PI ? 1 : 0} 1 ${x1} ${y1}" class="progress-ring-base" />
  `;
}


