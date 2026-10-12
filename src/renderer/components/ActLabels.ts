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
    // Left-justify each act label just clockwise of its spoke, reading into
    // the act it names.
    const anchorOffset = 0.02;
    const startAngleAct = angle + anchorOffset;
    // Long enough for long titles, but never past the next act's spoke.
    const arcLength = Math.min(Math.PI / 3, (2 * Math.PI) / numActs - 2 * anchorOffset);
    const endAngleAct = startAngleAct + arcLength;

    const actPathId = `actPath-${act}`;
    const labelText = resolveActLabel(act, actLabels);
    svg += `
      <path id="${actPathId}" d="
        M ${formatNumber(actLabelRadius * Math.cos(startAngleAct))} ${formatNumber(actLabelRadius * Math.sin(startAngleAct))}
        A ${formatNumber(actLabelRadius)} ${formatNumber(actLabelRadius)} 0 0 1 ${formatNumber(actLabelRadius * Math.cos(endAngleAct))} ${formatNumber(actLabelRadius * Math.sin(endAngleAct))}
      " fill="none" />
      <text class="rt-act-label" fill="${maxStageColor}">
        <textPath href="#${actPathId}" startOffset="0" text-anchor="start">${labelText}</textPath>
      </text>
    `;
  }
  return svg;
}

