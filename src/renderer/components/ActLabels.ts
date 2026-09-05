import { resolveActLabel } from '../../utils/acts';
import { formatNumber } from '../../utils/svg';

export function renderActLabels(params: {
  numActs: number;
  actLabels: string[];
  outerMostOuterRadius: number;
  actLabelOffset: number;
  maxStageColor: string;
}): string {
  const { numActs, actLabels, outerMostOuterRadius, actLabelOffset, maxStageColor } = params;
  let svg = '';
  const actLabelRadius = outerMostOuterRadius + actLabelOffset;
  for (let act = 0; act < numActs; act++) {
    const angle = (act * 2 * Math.PI) / numActs - Math.PI / 2;
    // Right-justify act labels just to the LEFT of the Act axis spoke
    // Text reads left-to-right and ends just before the tick
    const anchorOffset = 0.02;
    const endAngleAct = angle - anchorOffset;
    const startAngleAct = endAngleAct - (Math.PI / 3); // Long enough arc for long titles
    
    const actPathId = `actPath-${act}`;
    const labelText = resolveActLabel(act, actLabels);
    svg += `
      <path id="${actPathId}" d="
        M ${formatNumber(actLabelRadius * Math.cos(startAngleAct))} ${formatNumber(actLabelRadius * Math.sin(startAngleAct))}
        A ${formatNumber(actLabelRadius)} ${formatNumber(actLabelRadius)} 0 0 1 ${formatNumber(actLabelRadius * Math.cos(endAngleAct))} ${formatNumber(actLabelRadius * Math.sin(endAngleAct))}
      " fill="none" />
      <text class="rt-act-label" fill="${maxStageColor}">
        <textPath href="#${actPathId}" startOffset="100%" text-anchor="end">${labelText}</textPath>
      </text>
    `;
  }
  return svg;
}

