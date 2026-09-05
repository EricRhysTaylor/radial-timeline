import { arcPath } from '../layout/Paths';

export function renderMonthLabelDefs(params: {
  months: { name: string; shortName: string; angle: number; isFirst?: boolean; isLast?: boolean }[];
  monthLabelRadius: number;
  chronologueDateRadius: number;
}): string {
  const { months, monthLabelRadius, chronologueDateRadius } = params;
  return months.map(({ angle, isFirst, isLast }, index) => {
    const angleOffset = 0.01;
    const startAngle = angle + angleOffset;
    
    // Longer arc for chronologue boundary labels (can span multiple lines)
    // Standard arc for regular month labels - increased to prevent clipping of long date/time strings
    const arcLength = (isFirst || isLast) ? (Math.PI / 4) : (Math.PI / 6);
    const endAngle = startAngle + arcLength;
    const pathId = `monthLabelPath-${index}`;
    
    // Use chronologue radius for first/last labels, regular radius for month labels
    let radius = (isFirst || isLast) ? chronologueDateRadius : monthLabelRadius;
    
    return `
      <path id="${pathId}" d="${arcPath(radius, startAngle, endAngle)}" fill="none" />
    `;
  }).join('');
}


