import { formatNumber } from '../../utils/svg';
import { normalizeAngleSigned } from '../utils/angles';

export function renderMonthSpokesAndInnerLabels(params: {
  months: { name: string; shortName: string; angle: number }[];
  lineInnerRadius: number;
  lineOuterRadius: number;
  currentMonthIndex: number;
  includeIntermediateSpokes?: boolean;
  outerSpokeInnerRadius?: number;  // Optional: if provided, render additional outer spokes from this radius
  numActs?: number;
  monthlyCompletedCounts?: number[];  // Array of 12 counts, one per month
  monthlyCompletedSceneNames?: string[][];  // Array of 12 arrays of scene names
}): string {
  const { months, lineInnerRadius, lineOuterRadius, currentMonthIndex, includeIntermediateSpokes = false, outerSpokeInnerRadius, numActs = 3, monthlyCompletedCounts, monthlyCompletedSceneNames } = params;
  const totalActs = Math.max(3, Math.floor(numActs));
  const actBoundaryAngles = Array.from({ length: totalActs }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / totalActs);
  const isActBoundaryAngle = (angle: number): boolean => {
    const tolerance = (2 * Math.PI / totalActs) / 12; // small fraction of act wedge
    return actBoundaryAngles.some(b => Math.abs(normalizeAngleSigned(angle - b)) <= tolerance);
  };
  
  // Inner calendar spokes - always render these short spokes around the calendar labels
  const innerSpokeStart = lineInnerRadius - 5;
  const innerSpokeEnd = lineInnerRadius + 30;
  
  let svg = '<g class="month-spokes">';
  
  // Render main month spokes and labels
  months.forEach(({ name, angle }, monthIndex) => {
    const isActBoundary = isActBoundaryAngle(angle);
    const isPastMonth = monthIndex < currentMonthIndex;
    
    // Inner calendar reference spokes (always rendered)
    const innerX1 = formatNumber(innerSpokeStart * Math.cos(angle));
    const innerY1 = formatNumber(innerSpokeStart * Math.sin(angle));
    const innerX2 = formatNumber(innerSpokeEnd * Math.cos(angle));
    const innerY2 = formatNumber(innerSpokeEnd * Math.sin(angle));
    
    svg += `
      <line  
        x1="${innerX1}"
        y1="${innerY1}"
        x2="${innerX2}"
        y2="${innerY2}"
        class="rt-month-spoke-line rt-inner-calendar-spoke${isActBoundary ? ' rt-act-boundary' : ''}${isPastMonth ? ' rt-past-month' : ''}"
      />`;
    
    // Outer spokes (only if outerSpokeInnerRadius is provided)
    if (outerSpokeInnerRadius !== undefined) {
      const outerX1 = formatNumber(outerSpokeInnerRadius * Math.cos(angle));
      const outerY1 = formatNumber(outerSpokeInnerRadius * Math.sin(angle));
      const outerX2 = formatNumber(lineOuterRadius * Math.cos(angle));
      const outerY2 = formatNumber(lineOuterRadius * Math.sin(angle));
      
      // For dashed lines, add stroke-dashoffset to start with a full dash at the outer edge
      const dashOffset = isActBoundary ? '' : ' stroke-dashoffset="2"';
      
      svg += `
      <line  
        x1="${outerX1}"
        y1="${outerY1}"
        x2="${outerX2}"
        y2="${outerY2}"
        class="rt-month-spoke-line${isActBoundary ? ' rt-act-boundary' : ''}${isPastMonth ? ' rt-past-month' : ''}"${dashOffset}
      />`;
    }

    // Inner month labels (curved text paths)
    const innerLabelRadius = lineInnerRadius;
    const pixelToRadian = (5 * 2 * Math.PI) / (2 * Math.PI * innerLabelRadius);
    const startAngle = angle + pixelToRadian;
    const endAngle = angle + (Math.PI / 6);
    const innerPathId = `innerMonthPath-${name}`;

    // Build the month label text - add completed count for any month with completions
    const completedCount = monthlyCompletedCounts?.[monthIndex] ?? 0;
    const sceneNames = monthlyCompletedSceneNames?.[monthIndex] ?? [];
    const labelText = completedCount > 0
      ? `${months[monthIndex].shortName} • ${completedCount}`
      : months[monthIndex].shortName;

    // Build tooltip showing scene names if there are completions
    let tooltipAttrs = '';
    if (completedCount > 0 && sceneNames.length > 0) {
      const tooltipText = `Completed in ${months[monthIndex].name}: ${sceneNames.join(', ')}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      tooltipAttrs = ` class="rt-tooltip-target" data-tooltip="${tooltipText}" data-tooltip-placement="bottom"`;
    }

    // Create hit area arc path (slightly thicker for easier hovering)
    const hitAreaInnerR = innerLabelRadius - 8;
    const hitAreaOuterR = innerLabelRadius + 8;

    svg += `
      <path id="${innerPathId}"
        d="
          M ${formatNumber(innerLabelRadius * Math.cos(startAngle))} ${formatNumber(innerLabelRadius * Math.sin(startAngle))}
          A ${formatNumber(innerLabelRadius)} ${formatNumber(innerLabelRadius)} 0 0 1 ${formatNumber(innerLabelRadius * Math.cos(endAngle))} ${formatNumber(innerLabelRadius * Math.sin(endAngle))}
        "
        fill="none"
      />
      <g${tooltipAttrs}>
        ${completedCount > 0 ? `
        <path
          d="
            M ${formatNumber(hitAreaInnerR * Math.cos(startAngle))} ${formatNumber(hitAreaInnerR * Math.sin(startAngle))}
            A ${formatNumber(hitAreaInnerR)} ${formatNumber(hitAreaInnerR)} 0 0 1 ${formatNumber(hitAreaInnerR * Math.cos(endAngle))} ${formatNumber(hitAreaInnerR * Math.sin(endAngle))}
            L ${formatNumber(hitAreaOuterR * Math.cos(endAngle))} ${formatNumber(hitAreaOuterR * Math.sin(endAngle))}
            A ${formatNumber(hitAreaOuterR)} ${formatNumber(hitAreaOuterR)} 0 0 0 ${formatNumber(hitAreaOuterR * Math.cos(startAngle))} ${formatNumber(hitAreaOuterR * Math.sin(startAngle))}
            Z
          "
          fill="transparent"
          pointer-events="all"
        />
        ` : ''}
        <text class="rt-month-label" ${isPastMonth ? 'opacity="0.5"' : ''}>
          <textPath href="#${innerPathId}" startOffset="0" text-anchor="start">
            ${labelText}
          </textPath>
        </text>
      </g>
    `;
  });

  // Render intermediate spokes (dashed mini-ticks between major month markers)
  if (includeIntermediateSpokes && months.length > 0 && outerSpokeInnerRadius !== undefined) {
    const multiplier = 3;
    const majorStep = (2 * Math.PI) / months.length;

    for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
      for (let step = 1; step < multiplier; step++) {
        const rawAngle = months[monthIndex].angle + (majorStep * step) / multiplier;
        const angle = normalizeAngleSigned(rawAngle);
        const x1 = formatNumber(outerSpokeInnerRadius * Math.cos(angle));
        const y1 = formatNumber(outerSpokeInnerRadius * Math.sin(angle));
        const x2 = formatNumber(lineOuterRadius * Math.cos(angle));
        const y2 = formatNumber(lineOuterRadius * Math.sin(angle));

        svg += `
      <line
        x1="${x1}"
        y1="${y1}"
        x2="${x2}"
        y2="${y2}"
        class="rt-month-spoke-line rt-month-spoke-intermediate"
        stroke-dashoffset="2"
      />`;
      }
    }
  }

  // Render dedicated Act boundary spokes (full length) so act wedges are always emphasized
  if (outerSpokeInnerRadius !== undefined) {
    actBoundaryAngles.forEach(angle => {
      const x1 = formatNumber(outerSpokeInnerRadius * Math.cos(angle));
      const y1 = formatNumber(outerSpokeInnerRadius * Math.sin(angle));
      const x2 = formatNumber(lineOuterRadius * Math.cos(angle));
      const y2 = formatNumber(lineOuterRadius * Math.sin(angle));
      svg += `
        <line
          x1="${x1}"
          y1="${y1}"
          x2="${x2}"
          y2="${y2}"
          class="rt-month-spoke-line rt-act-boundary"
        />`;
    });
  }
  svg += '</g>';
  return svg;
}

export function renderGossamerMonthSpokes(params: {
  innerRadius: number;
  outerRadius: number;
  numActs?: number;
}): string {
  const { innerRadius, outerRadius, numActs = 3 } = params;
  const totalActs = Math.max(3, Math.floor(numActs));
  const actBoundaryAngles = Array.from({ length: totalActs }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / totalActs);
  let spokesHtml = '';
  const monthAngles = Array.from({ length: 12 }, (_, i) => (i / 12) * 2 * Math.PI - Math.PI / 2);
  monthAngles.forEach(angle => {
    const x1 = formatNumber(innerRadius * Math.cos(angle));
    const y1 = formatNumber(innerRadius * Math.sin(angle));
    const x2 = formatNumber(outerRadius * Math.cos(angle));
    const y2 = formatNumber(outerRadius * Math.sin(angle));
    const isActBoundary = actBoundaryAngles.some(b => Math.abs(normalizeAngleSigned(angle - b)) < 1e-6);
    spokesHtml += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="rt-month-spoke-line rt-gossamer-grid-spoke${isActBoundary ? ' rt-act-boundary' : ''}"/>`;
  });
  // Explicit act spokes for non-divisible month boundaries
  actBoundaryAngles.forEach(angle => {
    const x1 = formatNumber(innerRadius * Math.cos(angle));
    const y1 = formatNumber(innerRadius * Math.sin(angle));
    const x2 = formatNumber(outerRadius * Math.cos(angle));
    const y2 = formatNumber(outerRadius * Math.sin(angle));
    spokesHtml += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="rt-month-spoke-line rt-gossamer-grid-spoke rt-act-boundary"/>`;
  });
  return `<g class="rt-gossamer-spokes">${spokesHtml}</g>`;
}

