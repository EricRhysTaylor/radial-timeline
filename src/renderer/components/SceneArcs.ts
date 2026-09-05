import { formatNumber } from '../../utils/svg';

const TAU = Math.PI * 2;
const FULL_CIRCLE_EPSILON = 0.0001;

export function sceneArcPath(innerR: number, outerR: number, startAngle: number, endAngle: number): string {
  const span = Math.abs(endAngle - startAngle);
  const isFullCircle = span >= (TAU - FULL_CIRCLE_EPSILON);

  if (isFullCircle) {
    const midAngle = startAngle + (endAngle - startAngle) / 2;
    const innerStartX = formatNumber(innerR * Math.cos(startAngle));
    const innerStartY = formatNumber(innerR * Math.sin(startAngle));
    const outerStartX = formatNumber(outerR * Math.cos(startAngle));
    const outerStartY = formatNumber(outerR * Math.sin(startAngle));
    const outerMidX = formatNumber(outerR * Math.cos(midAngle));
    const outerMidY = formatNumber(outerR * Math.sin(midAngle));
    const innerMidX = formatNumber(innerR * Math.cos(midAngle));
    const innerMidY = formatNumber(innerR * Math.sin(midAngle));
    const outerRadius = formatNumber(outerR);
    const innerRadius = formatNumber(innerR);

    return `
    M ${innerStartX} ${innerStartY}
    L ${outerStartX} ${outerStartY}
    A ${outerRadius} ${outerRadius} 0 1 1 ${outerMidX} ${outerMidY}
    A ${outerRadius} ${outerRadius} 0 1 1 ${outerStartX} ${outerStartY}
    L ${innerStartX} ${innerStartY}
    A ${innerRadius} ${innerRadius} 0 1 0 ${innerMidX} ${innerMidY}
    A ${innerRadius} ${innerRadius} 0 1 0 ${innerStartX} ${innerStartY}
  `;
  }

  // An arc wider than a half turn has to say so, or SVG draws the short way
  // round and the cell comes out as a crescent on the opposite side of the
  // wheel. Scenes rarely get that wide, but a Sequence-aligned subplot ring
  // voids every stretch it is absent from, and those routinely exceed 180°.
  const largeArcFlag = span > Math.PI ? 1 : 0;

  return `
    M ${formatNumber(innerR * Math.cos(startAngle))} ${formatNumber(innerR * Math.sin(startAngle))}
    L ${formatNumber(outerR * Math.cos(startAngle))} ${formatNumber(outerR * Math.sin(startAngle))}
    A ${formatNumber(outerR)} ${formatNumber(outerR)} 0 ${largeArcFlag} 1 ${formatNumber(outerR * Math.cos(endAngle))} ${formatNumber(outerR * Math.sin(endAngle))}
    L ${formatNumber(innerR * Math.cos(endAngle))} ${formatNumber(innerR * Math.sin(endAngle))}
    A ${formatNumber(innerR)} ${formatNumber(innerR)} 0 ${largeArcFlag} 0 ${formatNumber(innerR * Math.cos(startAngle))} ${formatNumber(innerR * Math.sin(startAngle))}
  `;
}

export interface VoidCellMetadata {
  act?: number;
  ring?: number;
  isOuterRing?: boolean;
  className?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export function renderVoidCellPath(
  innerR: number, 
  outerR: number, 
  startAngle: number, 
  endAngle: number,
  metadata?: VoidCellMetadata
): string {
  const path = sceneArcPath(innerR, outerR, startAngle, endAngle);
  
  // Build data attributes for intelligent drop targeting
  const dataAttrs: string[] = [];
  if (metadata?.act !== undefined) {
    dataAttrs.push(`data-act="${metadata.act}"`);
  }
  if (metadata?.ring !== undefined) {
    dataAttrs.push(`data-ring="${metadata.ring}"`);
  }
  if (metadata?.isOuterRing) {
    dataAttrs.push(`data-outer-ring="true"`);
  }
  // Preserve high-precision angles for interaction math
  dataAttrs.push(`data-start-angle-raw="${startAngle}"`);
  dataAttrs.push(`data-end-angle-raw="${endAngle}"`);
  // Always include angles for positioning
  dataAttrs.push(`data-start-angle="${formatNumber(startAngle)}"`);
  dataAttrs.push(`data-end-angle="${formatNumber(endAngle)}"`);
  dataAttrs.push(`data-inner-r="${formatNumber(innerR)}"`);
  dataAttrs.push(`data-outer-r="${formatNumber(outerR)}"`);
  
  if (metadata?.className) {
    dataAttrs.push(`class="rt-void-cell ${metadata.className}"`);
  } else {
    dataAttrs.push(`class="rt-void-cell"`);
  }
  if (metadata?.fill) dataAttrs.push(`fill="${metadata.fill}"`);
  if (metadata?.stroke) dataAttrs.push(`stroke="${metadata.stroke}"`);
  if (metadata?.strokeWidth !== undefined) dataAttrs.push(`stroke-width="${metadata.strokeWidth}"`);
  
  const attrString = dataAttrs.length > 0 ? ` ${dataAttrs.join(' ')}` : '';
  return `<path d="${path}"${attrString}/>`;
}
