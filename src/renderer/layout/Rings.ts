export function computeRingGeometry(params: {
  size: number;
  innerRadius: number;
  subplotOuterRadius: number;  // Outer edge of subplot rings
  outerRadius: number;          // Outer boundary for month labels/ticks
  numRings: number;
  monthTickTerminal: number;
  monthTextInset: number;
  fixedRings?: Array<{ index: number; width: number }>;
  /** Space kept free just inside the outermost ring (Narrative's character lanes). */
  outerRingInset?: number;
}) {
  const { innerRadius, subplotOuterRadius, outerRadius, numRings, monthTextInset, fixedRings } = params;
  const outerRingInset = Math.max(0, params.outerRingInset ?? 0);
  // Guard against zero rings to avoid NaNs downstream
  if (!Number.isFinite(numRings) || numRings <= 0) {
    const lineInnerRadius = innerRadius;
    const lineOuterRadius = outerRadius;
    const monthLabelRadius = lineOuterRadius - monthTextInset;
    return { ringWidths: [] as number[], ringStartRadii: [] as number[], lineInnerRadius, lineOuterRadius, monthLabelRadius };
  }
  const availableSpace = subplotOuterRadius - innerRadius - outerRingInset;

  let ringWidths: number[] = [];
  const fixedRingEntries = (fixedRings ?? [])
    .filter(entry => Number.isFinite(entry.width) && entry.width > 0)
    .filter(entry => Number.isInteger(entry.index) && entry.index >= 0 && entry.index < numRings);
  const fixedRingMap = new Map<number, number>();
  fixedRingEntries.forEach(entry => fixedRingMap.set(entry.index, entry.width));
  const fixedRingCount = fixedRingMap.size;

  if (fixedRingCount > 0) {
    const totalFixedWidth = Array.from(fixedRingMap.values()).reduce((sum, width) => sum + width, 0);
    const remainingRings = numRings - fixedRingCount;
    let remainingSpace = availableSpace - totalFixedWidth;
    let fixedScale = 1;
    if (remainingSpace < 0 && totalFixedWidth > 0) {
      fixedScale = availableSpace / totalFixedWidth;
      remainingSpace = 0;
    }
    const standardWidth = remainingRings > 0 ? (remainingSpace / remainingRings) : 0;
    ringWidths = Array.from({ length: numRings }, (_, i) => {
      const fixedWidth = fixedRingMap.get(i);
      return fixedWidth !== undefined ? fixedWidth * fixedScale : standardWidth;
    });
  } else {
    const reductionFactor = 1;
    const sumOfSeries = (reductionFactor === 1) ? numRings : (1 - Math.pow(reductionFactor, numRings)) / (1 - reductionFactor);
    const initialRingWidth = availableSpace / sumOfSeries;
    ringWidths = Array.from({ length: numRings }, (_, i) => initialRingWidth * Math.pow(reductionFactor, i));
  }

  const ringStartRadii = ringWidths.reduce((acc, width, i) => {
    const previousRadius = i === 0 ? innerRadius : acc[i - 1] + ringWidths[i - 1];
    acc.push(i === numRings - 1 ? previousRadius + outerRingInset : previousRadius);
    return acc;
  }, [] as number[]);
  const lineInnerRadius = innerRadius - 20;
  const lineOuterRadius = outerRadius;  // Use the explicit outerRadius for month labels
  const monthLabelRadius = lineOuterRadius - monthTextInset;
  return { ringWidths, ringStartRadii, lineInnerRadius, lineOuterRadius, monthLabelRadius };
}

