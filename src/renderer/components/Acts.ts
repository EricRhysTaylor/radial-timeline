import { formatNumber } from '../../utils/svg';

export function renderActBorders(params: {
  numActs: number;
  innerRadius: number;
  outerRadius: number;
  strokeWidth?: number;
  stroke?: string;
}): string {
  const { numActs, innerRadius, outerRadius, strokeWidth, stroke } = params;
  let svg = '';
  const strokeAttr = stroke ? ` stroke="${stroke}"` : '';
  const strokeWidthAttr = strokeWidth !== undefined ? ` stroke-width="${strokeWidth}"` : '';
  for (let act = 0; act < numActs; act++) {
    const angle = (act * 2 * Math.PI) / numActs - Math.PI / 2;
    svg += `
      <line x1="${formatNumber(innerRadius * Math.cos(angle))}" y1="${formatNumber(innerRadius * Math.sin(angle))}"
            x2="${formatNumber(outerRadius * Math.cos(angle))}" y2="${formatNumber(outerRadius * Math.sin(angle))}"
            class="act-border"${strokeAttr}${strokeWidthAttr} />
    `;
  }
  return svg;
}


