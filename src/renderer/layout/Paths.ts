import { formatNumber } from '../../utils/svg';

/**
 * Arc from `startAngle` to `endAngle` in the direction of travel: clockwise to a
 * larger angle, counter-clockwise to a smaller one.
 *
 * The angles are taken as given, never folded round the circle. Ring positions
 * run from −π/2 at the book's opening, through to its close, so an arc between
 * two of them stays inside the book: a move back through the story sweeps
 * counter-clockwise — the long way round if need be — and never crosses the
 * seam where the closing scene meets the opening one.
 *
 * The large-arc flag follows the span; pinned to 0, any span past a half turn
 * comes out as a short arc bulging off the ring on the far side of the wheel.
 */
export function arcPath(radius: number, startAngle: number, endAngle: number): string {
  const span = endAngle - startAngle;
  const largeArcFlag = Math.abs(span) > Math.PI ? 1 : 0;
  const sweepFlag = span >= 0 ? 1 : 0;
  return `
    M ${formatNumber(radius * Math.cos(startAngle))} ${formatNumber(radius * Math.sin(startAngle))}
    A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArcFlag} ${sweepFlag} ${formatNumber(radius * Math.cos(endAngle))} ${formatNumber(radius * Math.sin(endAngle))}
  `;
}
