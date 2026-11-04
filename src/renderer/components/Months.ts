import { arcPath } from '../layout/Paths';
import { isTitleFlipped } from './SceneTitlePath';

type OuterLabelPosition = { angle: number; isFirst?: boolean; isLast?: boolean; boundaryAtSeam?: boolean };

/**
 * The arc an outer date label rides, starting just past its tick. A clockwise
 * arc reads upside down across the bottom of the wheel, so a label whose arc
 * sits below the centre runs counter-clockwise instead and ends at its tick
 * (renderOuterLabelTexts anchors it there). The first and last dates sit at
 * the top and keep their clockwise, multi-line layout.
 */
export function outerLabelArc({ angle, isFirst, isLast, boundaryAtSeam }: OuterLabelPosition): { startAngle: number; endAngle: number; flipped: boolean } {
  if (boundaryAtSeam && isFirst) return { startAngle: -Math.PI / 2 + 0.01, endAngle: -Math.PI / 2 + Math.PI / 4, flipped: false };
  if (boundaryAtSeam && isLast) return { startAngle: -Math.PI / 2 - Math.PI / 4, endAngle: -Math.PI / 2 - 0.01, flipped: false };
  const isBoundary = isFirst || isLast;
  const startAngle = angle + 0.01;
  // Longer arc for chronologue boundary labels (can span multiple lines)
  // Standard arc for regular month labels - increased to prevent clipping of long date/time strings
  const endAngle = startAngle + (isBoundary ? Math.PI / 4 : Math.PI / 6);
  return { startAngle, endAngle, flipped: !isBoundary && isTitleFlipped(startAngle, endAngle) };
}

export function renderMonthLabelDefs(params: {
  months: ({ name: string; shortName: string } & OuterLabelPosition)[];
  monthLabelRadius: number;
  chronologueDateRadius: number;
}): string {
  const { months, monthLabelRadius, chronologueDateRadius } = params;
  return months.map((label, index) => {
    const { startAngle, endAngle, flipped } = outerLabelArc(label);
    const pathId = `monthLabelPath-${index}`;

    // Use chronologue radius for first/last labels, regular radius for month labels
    const radius = (label.isFirst || label.isLast) ? chronologueDateRadius : monthLabelRadius;
    const d = flipped ? arcPath(radius, endAngle, startAngle) : arcPath(radius, startAngle, endAngle);

    return `
      <path id="${pathId}" d="${d}" fill="none" />
    `;
  }).join('');
}
