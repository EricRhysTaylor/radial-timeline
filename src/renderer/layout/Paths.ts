import { formatNumber } from '../../utils/svg';
import { normalizeAngleUnsigned } from '../utils/angles';

/**
 * Clockwise arc from `startAngle` to `endAngle` — the direction the ring reads.
 *
 * An end that lies behind the start is reached the long way round, never by
 * sweeping backwards. The large-arc flag has to follow the clockwise span: with
 * it pinned to 0, any span past a half turn comes out as a short arc bulging
 * off the ring on the wrong side of the wheel.
 */
export function arcPath(radius: number, startAngle: number, endAngle: number): string {
  const largeArcFlag = normalizeAngleUnsigned(endAngle - startAngle) > Math.PI ? 1 : 0;
  return `
    M ${formatNumber(radius * Math.cos(startAngle))} ${formatNumber(radius * Math.sin(startAngle))}
    A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArcFlag} 1 ${formatNumber(radius * Math.cos(endAngle))} ${formatNumber(radius * Math.sin(endAngle))}
  `;
}
